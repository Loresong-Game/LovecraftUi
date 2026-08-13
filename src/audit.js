// The page auditor: makes the mandated defect classes machine-visible
// on any LIVE page — sibling overlap, framed-container containment, text contrast,
// scrollbar truth, interactive hit floors, and REACH (every control must actually
// be clickable — see the rule for why nothing else catches that). `runAudit(engine)` is a pure read over
// engine.paintList (plus a lazy, cached per-texture luminance sample); the `?audit=1`
// harness settles the page on the ticker, runs it, and titles `AUDIT <total>` with a
// per-violation report — the page manifest ratchets those counts, and they only fall.
//
// Design notes bound by the spec:
// - OVERLAP checks AUDIT-SOLID siblings only: interactive/focusable/isDropTarget nodes,
//   TextNodes, and composites-with-children. Bare Quad/NineSlice leaf decor is exempt BY
// TYPE — every widget legitimately layers art primitives; the reported defect is
//   logical elements colliding, not a button's own background under its label.
// - CONTAINMENT generalizes what GEOMETRY's I1 only did for clipped subtrees: any node
//   whose child NineSlice covers its full rect is a FRAMED COMPOSITE, and descendants
//   (stopping at clipChildren boundaries, where overflow is legal and clipped) must sit
//   inside its contentRect. fitExclude nodes opt out — they already declared "I overhang".
// - CONTRAST composites what actually paints beneath a TextNode's center: flat quads by
//   material.color × opacity, textured nodes by average texture luminance × tint. The
//   average is sampled LAZILY from texture.image at audit time and cached on
//   texture.userData (avgLum/avgAlpha) — zero boot cost, and dynamic canvases stay live.
// - The escape hatch, `node.auditAllow('overlap'|…)`, is RATIONED: declarations are
//   counted in the report and ratcheted like GEOMETRY's exemption cap.

import { TextNode } from './text.js';
import { QuadNode, NineSliceNode } from './primitives.js';
import { ScrollArea } from './clip.js';
import { contentRect } from './layout.js';
import { hitTest } from './hit.js';
import { COLORS } from './theme.js';
import { renumber } from './layers.js';

export const AUDIT_RULES = ['overlap', 'containment', 'contrast', 'scrollbar', 'hit', 'reach'];

const OVERLAP_TOL = 4;        // px of intersection on BOTH axes before two siblings "overlap"
const CONTAIN_TOL = 2;        // px a child may exceed a framed ancestor's content rect
const CONTAIN_TOL_TEXT = 3;   // text rasters carry shadow slop
const CONTRAST_FLOOR = 4.5;   // WCAG-ish body floor …
const CONTRAST_FLOOR_LARGE = 3; // … and the ≥18px / bold floor
const HIT_FLOOR = 24;         // STYLE §7
const MIN_AREA = 8;           // ignore nodes smaller than this on either axis for overlap

// ---- color / luminance helpers ----

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relLum(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

// #rgb, #rrggbb, rgb(), rgba() — returns {r,g,b,a} in 0..255 / 0..1, or null.
export function parseCssColor(s) {
  if (typeof s !== 'string') return null;
  s = s.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2) + 0.05, lo = Math.min(l1, l2) + 0.05;
  return hi / lo;
}

// Average luminance/alpha of a texture, sampled once from its backing canvas and cached
// on userData. Non-canvas images and tainted reads degrade to null (rule skips quietly).
function textureLum(tex) {
  if (!tex) return null;
  const ud = tex.userData ?? (tex.userData = {});
  if (ud.avgLum !== undefined) return ud;
  const img = tex.image;
  if (!img || typeof img.getContext !== 'function') { ud.avgLum = null; ud.avgAlpha = 1; return ud; }
  try {
    const ctx = img.getContext('2d');
    const w = img.width, h = img.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    // stride sampling caps the work near ~4k texels regardless of canvas size
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4096)));
    let lum = 0, alpha = 0, n = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const a = data[i + 3] / 255;
        lum += relLum(data[i], data[i + 1], data[i + 2]) * a;
        alpha += a;
        n++;
      }
    }
    ud.avgAlpha = n ? alpha / n : 0;
    ud.avgLum = alpha > 0 ? lum / alpha : 0;
  } catch {
    ud.avgLum = null;
    ud.avgAlpha = 1;
  }
  return ud;
}

// ---- classification helpers ----

const isArtLeaf = (n) => n instanceof QuadNode || n instanceof NineSliceNode;

function isAuditSolid(n) {
  if (n instanceof TextNode) return n.w > 0 && n.h > 0;
  if (isArtLeaf(n)) return false;
  if (n.interactive || n.focusable || n.isDropTarget) return true;
  return n.children.length > 0;
}

// used-tracking (honest for ALL rules): the census reports
// how many declarations suppressed NOTHING this run — `ALLOW n` alone is a
// declaration count, not a suppression measure. allows() STAMPS, so it is
// consulted only at a would-violate point (the reach rule pioneered this at
// 3.2.x; the other five kept consulting during pre-filters, which marked a
// declaration "used" for every node that would have passed anyway — five of
// six rules could never read dead). hasAllow() is the stampless existence
// check the pre-filters (containment's subtree skip) keep using.
const hasAllow = (n, rule) => n._auditAllow != null && n._auditAllow.has(rule);
const allows = (n, rule) => {
  const ok = hasAllow(n, rule);
  if (ok) { if (!n._auditAllowUsed) n._auditAllowUsed = new Set(); n._auditAllowUsed.add(rule); }
  return ok;
};

// Effective render presence: visible in paintList already; also require the fx/base
// opacity product to be non-negligible (a wash tweening to 0 is not a real surface).
function renderAlpha(n) {
  return (n.fxOpacity ?? 1) * (n.baseOpacity ?? 1);
}

// Does this subtree put any pixels on screen? Pure hit ZONES (window resize handles)
// are affordances the input system layers by paint order — they are not overlap or
// hit-floor SUBJECTS. Memoized per audit run (the census surfaced 3 false pairs per
// ModalWindow without this — controls strip vs the invisible n/e/ne handles).
function makeDrawableTest() {
  const memo = new Map();
  const test = (n) => {
    const hit = memo.get(n);
    if (hit !== undefined) return hit;
    let d = !!(n.mesh && n.material && (n.material.opacity ?? 1) > 0.03);
    if (!d) {
      for (const c of n.children) {
        if (c._visible && test(c)) { d = true; break; }
      }
    }
    memo.set(n, d);
    return d;
  };
  return test;
}

// The full-bleed NineSlice child that makes `n` a framed composite, or null.
function framedBg(n) {
  for (const c of n.children) {
    if (!(c instanceof NineSliceNode) || !c._visible || !c.frame) continue;
    if (Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1 &&
        Math.abs(c.w - n.w) <= 2 && Math.abs(c.h - n.h) <= 2) return c;
  }
  return null;
}

// PHANTOM-RANGE: an armed scroll range must lead to painted ink.
// The dead-band class: a child DECLARES extent it never paints, autoContent
// believes the declaration, and the rail scrolls to nothing (CharacterPanel
// spent 132 releases declaring 500 around 334 of paint — every shrink armed
// 166px of empty range). The walk runs in content-local units (scroll offsets
// apply at render, never in child rects; contentScale lives ONLY on
// clipChildren nodes — panzoom.js — and the walk caps at those, so scaled
// frames are never mis-measured; if contentScale ever lands on a non-clipping
// node this walk silently mis-reads, keep that invariant). A clipChildren
// subtree counts as ink exactly when its box meets the band and ANYTHING
// inside it draws (the memoized drawable test) — a KNOWN HOLE of the weak
// form: the drawable test ignores the subtree's own clip, so a clipped frame
// whose visible ink is scrolled out of ITS OWN box still clears the band.
// The weak form — ANY ink in the band — is deliberate: it can never
// false-fire on a legitimately overflowing surface whose band top still
// shows real rows. The strong form (contentH − inkExtent ≤ TOL) would also
// catch partially-dead bands and close the clip hole; recorded as a ratchet
// candidate, not law.
function bandHasInk(content, b0, b1, axis, drawable) {
  const walk = (node, off) => {
    for (const c of node.children) {
      if (!c._visible) continue;
      const p0 = off + (axis === 'y' ? c.y : c.x);
      const p1 = p0 + (axis === 'y' ? c.h : c.w);
      const leafInk = (isArtLeaf(c) || c instanceof TextNode)
        && c.mesh && c.material && (c.material.opacity ?? 1) > 0.03
        && renderAlpha(c) >= 0.05 && c.w > 0 && c.h > 0;
      if (leafInk && p1 > b0 + 1 && p0 < b1) return true;
      if (c.children.length) {
        if (c.clipChildren) {
          if (p1 > b0 + 1 && p0 < b1 && drawable(c)) return true;
        } else if (walk(c, p0)) return true;
      }
    }
    return false;
  };
  return walk(content, 0);
}

function pathOf(n) {
  const parts = [];
  let cur = n;
  while (cur && parts.length < 8) {
    parts.unshift(cur.constructor.name + (cur.name ? `#${cur.name}` : ''));
    cur = cur.parent;
  }
  const s = parts.join('>');
  return s.length > 140 ? '…' + s.slice(-139) : s;
}

// ---- the audit ----

export function runAudit(engine) {
  if (engine.paintDirty) renumber(engine); // any paintList reader renumbers first
  const paintList = engine.paintList;
  const violations = [];
  const counts = { overlap: 0, containment: 0, contrast: 0, scrollbar: 0, hit: 0, reach: 0 };
  const allowances = { overlap: 0, containment: 0, contrast: 0, scrollbar: 0, hit: 0, reach: 0 };
  const add = (rule, node, detail) => {
    counts[rule]++;
    const rec = { rule, node, path: pathOf(node), detail };
    violations.push(rec);
    return rec; // callers annotate the record they created, never violations[length-1]
  };
  const declaredPairs = [];
  for (const n of paintList) {
    if (n._auditAllow) for (const r of n._auditAllow) if (allowances[r] !== undefined) { allowances[r]++; declaredPairs.push([n, r]); }
  }

  const drawable = makeDrawableTest();

  // OVERLAP — pairwise among each parent's audit-solid, pixel-bearing children.
  for (const p of paintList) {
    if (p.children.length < 2) continue;
    const kids = p.children.filter((c) =>
      c._visible && isAuditSolid(c) && renderAlpha(c) >= 0.05 && drawable(c) &&
      c.w * c.worldScale >= MIN_AREA && c.h * c.worldScale >= MIN_AREA &&
      // scrollbar chrome OVERLAYS by design (the clip.js invariant: bars never
      // consume layout space) — the thumb rides its track and both ride the content
      // edge; scrollbar-truth is their dedicated rule (mirrors the hit-floor carve-out)
      !(p instanceof ScrollArea && (c === p.track || c === p.thumb || c === p.hTrack || c === p.hThumb)));
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i], b = kids[j];
        const ra = a.worldRect, rb = b.worldRect;
        const ox = Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0);
        const oy = Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0);
        if (ox > OVERLAP_TOL && oy > OVERLAP_TOL) {
          // consult (and stamp) only on a REAL overlap — a declaration on a
          // pair that never collides forgives nothing and must read dead
          if (allows(a, 'overlap') || allows(b, 'overlap')) continue;
          // the record carries BOTH parties (the rec.blocker precedent): the
          // stamped node is `b` by child order, so a consumer asking "was MY
          // surface in this pair?" needs the unstamped side too (the resize
 // walker's freedom-law carve reads it)
          add('overlap', b, `with ${pathOf(a).split('>').pop()} by ${Math.round(ox)}×${Math.round(oy)}px`).partner = a;
        }
      }
    }
  }

  // CONTAINMENT — descendants of a framed composite stay inside its content rect;
  // clipChildren subtrees are skipped whole (overflow there is legal and clipped).
  for (const f of paintList) {
    const bg = framedBg(f);
    if (!bg) continue;
    const ws = f.worldScale || 1;
    const c = contentRect(bg.frame, f.w, f.h);
    const cx0 = f.worldX + c.x * ws, cy0 = f.worldY + c.y * ws;
    const cx1 = cx0 + c.w * ws, cy1 = cy0 + c.h * ws;
    const walk = (node) => {
      for (const d of node.children) {
        if (!d._visible || d === bg) continue;
        // declared overhangs and fit-excluded chrome skip the SUBTREE, exactly
        // as before — but the allowance stamps only when it forgives a real
        // spill below, so an exempt in-bounds node reads dead honestly
        const exempt = d.fitExclude || hasAllow(d, 'containment');
        // only nodes that DRAW something are containment subjects — pure containers and
        // bare hit zones (window resize handles) are judged through their drawable
        // descendants, which the walk still visits
        const drawsSelf = d.mesh && d.material && (d.material.opacity ?? 1) > 0.03;
        if (drawsSelf && d.w > 0 && d.h > 0 && renderAlpha(d) >= 0.05) {
          const tol = d instanceof TextNode ? CONTAIN_TOL_TEXT : CONTAIN_TOL;
          const r = d.worldRect;
          if (r.x0 < cx0 - tol || r.y0 < cy0 - tol || r.x1 > cx1 + tol || r.y1 > cy1 + tol) {
            if (exempt) {
              if (!d.fitExclude) allows(d, 'containment'); // it just forgave a real spill
              continue;
            }
            add('containment', d,
              `spills ${f.constructor.name}${f.name ? '#' + f.name : ''} content box by ` +
              `${Math.max(0, Math.round(Math.max(cx0 - r.x0, r.x1 - cx1)))}×` +
              `${Math.max(0, Math.round(Math.max(cy0 - r.y0, r.y1 - cy1)))}px`);
            continue; // one violation per subtree root keeps counts readable
          }
        }
        if (exempt) continue; // the subtree skip the old pre-filter performed
        if (!d.clipChildren) walk(d);
      }
    };
    walk(f);
  }

  // CONTRAST — TextNode color vs what actually paints beneath its center.
  const baseBg = parseCssColor(COLORS.abyss0) ?? { r: 4, g: 6, b: 10 };
  const baseLum = relLum(baseBg.r, baseBg.g, baseBg.b);
  for (const t of paintList) {
    if (!(t instanceof TextNode)) continue;
    if (t.w <= 4 || t.h <= 4 || renderAlpha(t) < 0.05) continue;
    // WCAG 1.4.3's own exemption: "text that is part of an inactive user
    // interface component ... has no contrast requirement." A label inside a
    // disabled seal is INFORMATION-BY-DIMNESS - demanding 4.5:1 of it forced
    // disabled faces to stay nearly as bright as live ones (the textMuted
 // compromise), which is exactly how a dead pager button came to read
    // identical to a live one. Re-enabling restores the floor.
    // (the exemption runs BEFORE any allowance is consulted — a
 // declaration on disabled-subtree text forgives nothing and reads dead)
    if (t.closest((n) => n.disabled === true)) continue;
    const col = parseCssColor(t.style.color);
    if (!col) continue;
    const ws = t.worldScale || 1;
    const cx = t.worldX + (t.w * ws) / 2, cy = t.worldY + (t.h * ws) / 2;
    let bgLum = baseLum;
    for (const n of paintList) {
      if (n.paintIndex >= t.paintIndex) break; // paintList is paint-ordered
      if (n === t || n instanceof TextNode) continue;
      if (!n.mesh || !n.material || n.mesh.visible === false) continue;
      const r = n.worldRect;
      if (cx < r.x0 || cx > r.x1 || cy < r.y0 || cy > r.y1) continue;
      const opacity = n.material.opacity ?? 1;
      if (opacity < 0.03) continue;
      const map = n.material.map;
      let lum, alpha;
      if (map) {
        const m = textureLum(map);
        if (!m || m.avgLum === null) continue;
        const tint = n.material.color;
        lum = m.avgLum * (tint ? (tint.r + tint.g + tint.b) / 3 : 1);
        alpha = m.avgAlpha;
      } else {
        const mc = n.material.color;
        if (!mc) continue;
        lum = relLum(mc.r * 255, mc.g * 255, mc.b * 255);
        alpha = 1;
      }
      const a = Math.min(1, alpha * opacity);
      bgLum = bgLum * (1 - a) + lum * a;
    }
    const textLum = relLum(col.r, col.g, col.b);
    const ratio = contrastRatio(textLum, bgLum);
    const large = (t.style.size ?? 13) >= 18 || /bold|[7-9]00/.test(String(t.style.weight ?? ''));
    const floor = large ? CONTRAST_FLOOR_LARGE : CONTRAST_FLOOR;
    if (ratio < floor) {
      if (allows(t, 'contrast')) continue; // consulted (and stamped) only on a real failure
      add('contrast', t, `${t.style.color} on Lbg=${bgLum.toFixed(3)} → ${ratio.toFixed(2)}:1 < ${floor}:1`);
    }
  }

  // SCROLLBAR-TRUTH: a SHOWN rail requires real overflow (rails rest shown whenever
 // their axis overflows — the engagement-only reveal is retired; the momentary
 // hidden state during the construct→first-layout fade is legal). Horizontal
  // overflow itself stays a defect UNLESS the surface opted into horizontal
  // scrolling (`scrollX` — the Taskbar lane). The reserved-lane branch died with
  // the option.
  // a rail mid-FADE-OUT (_railShown === false, visibility lingering through the
  // 0.2s hide tween) is the sanctioned transition, not a lie; a hand-shown rail
  // (visible with _railShown unset) still counts
  const railShown = (n) => n._visible && n._railShown !== false;
  for (const s of paintList) {
    if (!(s instanceof ScrollArea)) continue;
    const vOver = s.contentH > s.boxH + 1;
    const hOver = s.contentW > s.boxW + 1;
    const vLie = (railShown(s.track) || railShown(s.thumb)) && !vOver;
    const hLie = (railShown(s.hTrack) || railShown(s.hThumb)) && !hOver;
    const hSpill = hOver && s.scrollX !== true;
    // PHANTOM-RANGE (the fourth face of scrollbar-truth): an armed range
    // must scroll TO something. Only MEASURED ranges are judged — setContentSize
    // (autoContent=false) is the synthetic-range opt: VirtualList's pooled rows
    // own their fiction and stay exempt by construction.
    const vPhantom = s.autoContent && vOver && !bandHasInk(s.content, s.boxH, s.contentH, 'y', drawable);
    const hPhantom = s.autoContent && s.scrollX === true && hOver && !bandHasInk(s.content, s.boxW, s.contentW, 'x', drawable);
    if (!vLie && !hLie && !hSpill && !vPhantom && !hPhantom) continue;
    if (allows(s, 'scrollbar')) continue; // consulted (and stamped) only when something would fire
    if (vLie) add('scrollbar', s, 'v-rail shown without vertical overflow');
    if (hLie) add('scrollbar', s, 'h-rail shown without horizontal overflow');
    if (hSpill) {
      add('scrollbar', s, `horizontal overflow ${Math.round(s.contentW - s.boxW)}px (content wider than its box)`);
    }
    if (vPhantom) add('scrollbar', s, `v-scroll range ${Math.round(s.boxH)}..${Math.round(s.contentH)}px scrolls to nothing — a declared extent with no ink behind it`);
    if (hPhantom) add('scrollbar', s, `h-scroll range ${Math.round(s.boxW)}..${Math.round(s.contentW)}px scrolls to nothing — a declared extent with no ink behind it`);
  }

  // HIT-FLOOR — visible interactive controls ≥ 24px both axes. TextNode link prose is
  // the documented STYLE §7 exception; bare hit ZONES (no visual of their own or one
  // level down) are affordances, not controls — skipped.
  for (const n of paintList) {
    if (!n.interactive || n instanceof TextNode) continue;
    // scrollbar chrome is a grab LANE, not a control: 14px paddles by design
    // (METRICS.scrollbarW), wheel/track-click primary — outside the 24px law
    const sp = n.parent;
    if (sp instanceof ScrollArea &&
        (n === sp.track || n === sp.thumb || n === sp.hTrack || n === sp.hThumb)) continue;
    const ws = n.worldScale || 1;
    const w = n.w * ws, h = n.h * ws;
    if (w <= 0 || h <= 0) continue;
    if (!drawable(n)) continue; // bare hit zones are affordances, not controls
    if (w < HIT_FLOOR - 0.5 || h < HIT_FLOOR - 0.5) {
      if (allows(n, 'hit')) continue; // consulted (and stamped) only under the floor
      add('hit', n, `${Math.round(w)}×${Math.round(h)}px < ${HIT_FLOOR}px`);
    }
  }

  // REACH — a control nobody can click is not a control.
  //
  // This rule exists because every OTHER instrument reads green on an unreachable
  // button. `?assert=1` suites drive widgets with `dispatch`, and dispatch bypasses hit
  // testing entirely — so a page can wire a perfect handler onto a button that a scrim,
  // a full-screen effect node or a mis-banded window is sitting on top of, and the test suite
  // will congratulate it. testing caught that class by hand-writing "hit-reach" asserts on
  // the handful of pages someone remembered; the ones nobody remembered shipped broken.
  //
  // The test is the REAL path a pointer takes: fire `hitTest` across the node's own box
  // and require at least ONE point to land on it (or a descendant — a row inside a list
  // answers for the list). Sampling a grid rather than just the centre is deliberate:
  // deliberately overlapping art (fanned cards, stacked plates) leaves only an edge
  // exposed, and an edge you can click is reachable. `containsPoint` already honours
  // `effectiveClipRect`, so content scrolled out of a clip contributes no valid sample
  // and is skipped rather than blamed.
  //
  // Unlike the other five, this allowance resolves UP THE CHAIN (the torture walker's
  // form). Occlusion is a container property: a world/camera surface that HUD chrome
  // legitimately covers says so once, for everything that walks around inside it —
  // declaring it on each spawned token instead would be noise, and would go stale the
  // moment the factory changed.
  // The used-stamp lands only when the allowance SUPPRESSES a real failure (3.2.x):
  // stamping during the pre-filter walk marked the allowance used for every covered
  // descendant that would have PASSED anyway, so a stale reach declaration was
  // structurally invisible to the dead-allowance census — the one rule that could
  // never read dead. Allowed nodes are sampled like any other and forgiven after.
  const reachAllower = (n) => {
    for (let cur = n; cur; cur = cur.parent) {
      if (cur._auditAllow?.has('reach')) return cur;
    }
    return null;
  };
  const SAMPLES = 5; // 5x5 grid, inset from the edges
  for (const n of paintList) {
    if (!n.interactive || n.disposed || !n._visible) continue;
    if (renderAlpha(n) < 0.05) continue;
    if (!drawable(n)) continue; // bare hit zones are affordances, judged through their art
    const ws = n.worldScale || 1;
    const w = n.w * ws, h = n.h * ws;
    if (w < MIN_AREA || h < MIN_AREA) continue;
    let sampled = 0, reached = false, blocker = null;
    for (let iy = 0; iy < SAMPLES && !reached; iy++) {
      for (let ix = 0; ix < SAMPLES && !reached; ix++) {
        const sx = n.worldX + (w * (ix + 0.5)) / SAMPLES;
        const sy = n.worldY + (h * (iy + 0.5)) / SAMPLES;
        if (!n.containsPoint(sx, sy)) continue; // outside its own shape, or clipped away
        sampled++;
        const top = hitTest(engine, sx, sy);
        if (top === n || n.isAncestorOf(top)) reached = true;
        else if (!blocker) blocker = top;
      }
    }
    if (!sampled || reached) continue; // nothing testable, or it answers — either is fine
    const allower = reachAllower(n);
    if (allower) {
      if (!allower._auditAllowUsed) allower._auditAllowUsed = new Set();
      allower._auditAllowUsed.add('reach'); // it just forgave a real failure: genuinely used
      continue;
    }
    // the covering node rides the violation so callers can judge WHO covered it — the
    // resize walker grows a window to absurd size on purpose, and a window covering the
    // page it was grown over is the windowing metaphor, not a defect
    const rec = add('reach', n, blocker
      ? `unclickable: ${pathOf(blocker)} covers every point of it`
      : 'unclickable: no point of it answers the hit probe');
    rec.blocker = blocker ?? null;
  }

  const deadAllowances = declaredPairs.filter(([n, r]) => !(n._auditAllowUsed && n._auditAllowUsed.has(r))).length;
  return { violations, counts, allowances, deadAllowances };
}

// ---- the ?audit=1 harness ----
// Rides the engine ticker (the two sanctioned timer sites stay the only timers): waits
// out the page's own boot timeline, runs the audit once, titles `AUDIT <total>`, keeps
// the full report on window.__audit, and renders the <pre id="audit"> census panel
// (-sanctioned in: a headless --dump-dom carries the DOM whole, so the panel IS
// the census's machine-readable detail channel — and the human's, in a live browser).
export function initAudit(engine, { settle = 1.6 } = {}) {
  let elapsed = 0, done = false;
  const off = engine.ticker.add((dt) => {
    if (done) return;
    elapsed += dt;
    if (elapsed < settle) return;
    done = true;
    off();
    let title;
    const lines = [];
    try {
      const report = runAudit(engine);
      const c = report.counts;
      title = `AUDIT ${report.violations.length}`;
      lines.push(`${title} [overlap ${c.overlap}, containment ${c.containment}, contrast ${c.contrast}, ` +
        `scrollbar ${c.scrollbar}, hit ${c.hit}, reach ${c.reach}; dead ${report.deadAllowances ?? 0}; allowances ` +
        `${Object.values(report.allowances).reduce((a, b) => a + b, 0)}]`);
      for (const v of report.violations) lines.push(`${v.rule.toUpperCase()} ${v.path} — ${v.detail}`);
      window.__audit = { title, counts: c, allowances: report.allowances, lines };
    } catch (err) {
      title = 'AUDIT ERROR ' + String(err && err.message ? err.message : err).slice(0, 80);
      window.__audit = { title, lines: [title] };
    }
    document.title = title;
    const pre = document.createElement('pre');
    pre.id = 'audit';
    pre.style.cssText = 'position:fixed;right:8px;top:8px;max-width:46vw;max-height:95vh;overflow:auto;'
      + 'color:#c8b47a;background:rgba(0,0,0,0.85);padding:10px;font:11px Consolas,monospace;z-index:100;margin:0;';
    pre.textContent = lines.join('\n');
    document.body.appendChild(pre);
    // freeze after reporting (the ?freeze=1 idiom): audit mode implies the timer-driven
    // ticker, and a forever-pending 16ms timer makes headless virtual time execute its
    // WHOLE budget frame by frame — quiescence lets the test suite dump immediately. The
    // settled page stays painted; the report is the product.
    engine.ticker.stop();
  });
}

// the interaction-states walker (Stage 4).
//
// The requirement ("hover/press too subtle") got its law in (theme
// INTERACTION floors) and its art in –; this instrument makes the law
// machine-checkable on ANY page: runStateTorture(engine) drives every
// hover-reactive node the input layer would actually deliver to — nodes holding
// a 'pointerenter' listener, not under a disabled seal (input.js skips targets
// with closest(disabled), so sealed subtrees are skipped and counted, never
// flagged) — through hover → press → release/leave USING THE NODE'S OWN
// dispatch(), the exact bubbling calls input.js makes. State tweens (0.1s) are
// settled by hand-stepping ONLY the ticker's tween lane (_stepTweens), never the
// page's world callbacks, so ambient tickers cannot smear the snapshots.
//
// A state is VISIBLE when anything in the node's subtree changes: a texture or
// frame swap (identity — re-rasterized text counts), a material/node opacity or
// fx move past the motion floors, a color change, or a visibility flip. Leave
// must RESTORE the resting snapshot exactly.
//
// Rules: 'hover' (enter changed nothing), 'press' (down changed nothing vs
// rest), 'restore' (leave failed to restore rest). Escape hatch: the -
// rationed auditAllow vocabulary grows the same three keys — declare
// node.auditAllow('hover') on a deliberately hover-silent interactive node and
// the declaration is COUNTED like every other allowance.
//
// ?torture=1 boots timer-driven like ?audit=1, waits out the page's boot
// timeline, STOPS the ticker (the walk owns time from there), walks, and titles
// `TORTURE <violations>`; the census panel and window.__torture carry the
// detail. The gate drives it per page via the manifest `TORTURE <max>` clause
// (ratchets — only fall).

import { renumber } from './layers.js';
import { EldTooltip } from './widgets/widgets.js';
import { runAudit } from './audit.js';

const EPS_OPACITY = 0.06; // half the theme washHover floor (0.15) still reads;
                          // below this is tween jitter, not feedback
const EPS_FX = 0.02;      // fxScale/fxOpacity motion floor (hover scale is 1.1)

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

function snapSubtree(root) {
  const rows = [];
  (function walk(n) {
    // a hidden subtree is one visual fact, not a bag of stale fields — sample the
    // flip itself and stop (a rail thumb's material decays while its parent track
    // is hidden; diffing those raw fields flags invisible motion)
    if (!n._visible) { rows.push([n, 'HIDDEN', null, null, null, null, null, null, false, null, null]); return; }
    rows.push([
      n,
      n.material?.map ?? null,
      n.material?.opacity ?? null,
      n.material?.color?.getHex?.() ?? null,
      n.frame ?? null,
      n.fxScale ?? null,
      n.fxOpacity ?? null,
      n.opacity ?? null,
      n._visible,
      n.x ?? null, // position IS feedback (the menu-row 2px press nudge)
      n.y ?? null,
    ]);
    for (const c of n.children) walk(c);
  })(root);
  return rows;
}

function moved(a, b, eps) {
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) >= eps;
}

// the first visible difference between two snapshots, described — or null.
// (differs() truthiness drives the checks; the description feeds the report.)
const FIELD = ['', 'texture', 'matOpacity', 'color', 'frame', 'fxScale', 'fxOpacity', 'opacity', 'visible', 'x', 'y'];
function firstDiff(s0, s1) {
  if (s0.length !== s1.length) return `subtree size ${s0.length} -> ${s1.length}`;
  for (let i = 0; i < s0.length; i++) {
    const a = s0[i], b = s1[i];
    if (a[0] !== b[0]) return `structure changed at row ${i}`;
    for (const [k, eps] of [[1, null], [2, EPS_OPACITY], [3, null], [4, null], [5, EPS_FX], [6, EPS_FX], [7, EPS_OPACITY], [8, null], [9, 1], [10, 1]]) {
      const changed = eps === null ? a[k] !== b[k] : moved(a[k], b[k], eps);
      if (changed) {
        const val = (v) => (typeof v === 'number' ? v.toFixed(3) : v === null ? 'null' : String(v?.name ?? v?.uuid?.slice?.(0, 6) ?? v));
        return `${a[0].constructor.name}${a[0].name ? '#' + a[0].name : ''} ${FIELD[k]} ${val(a[k])} -> ${val(b[k])}`;
      }
    }
  }
  return null;
}
const differs = (s0, s1) => firstDiff(s0, s1) !== null;

function settleTweens(engine, seconds = 0.3) {
  const tk = engine.ticker;
  const steps = Math.ceil(seconds * 60);
  for (let i = 0; i < steps; i++) {
    tk.time += 1 / 60;
    tk._stepTweens(1 / 60);
    // the engine frame applies lazy visual state (baseOpacity sync, layout,
    // paint) — without it, setBaseOpacity-class feedback never reaches the
    // sampled materials while the ticker is stopped (the ActionbarLock lesson)
    if (tk._frame) tk._frame(1 / 60, tk.time);
  }
}

function allows(n, rule) {
  for (let cur = n; cur; cur = cur.parent) {
    if (cur._auditAllow?.has(rule)) return true;
  }
  return false;
}

export function runStateTorture(engine) {
  if (engine.paintDirty) renumber(engine); // any paintList reader renumbers first
  const violations = [];
  const counts = { hover: 0, press: 0, restore: 0 };
  const allowances = { hover: 0, press: 0, restore: 0 };
  let walked = 0, sealed = 0;

  // Enumerate BEFORE driving: the walk itself may spawn nodes (washes, rings)
  const targets = [];
  for (const n of engine.paintList) {
    if (!n._listeners?.get?.('pointerenter')?.size) continue;
    if (!n._visible) continue;
    if (n.closest?.((a) => a.disabled === true)) { sealed++; continue; }
    targets.push(n);
  }
  for (const n of targets) {
    if (n._auditAllow) for (const r of ['hover', 'press', 'restore']) {
      if (n._auditAllow.has(r)) allowances[r]++;
    }
  }

  const add = (rule, node, detail) => {
    counts[rule]++;
    violations.push({ rule, node, path: pathOf(node), detail });
  };

  // a widget may render a node's feedback OUTSIDE that node's subtree (the window
  // resize handle lights the sibling grip quad) — `stateProxy` DECLARES where the
  // feedback lives and the walker diffs both subtrees as one
  const snapFor = (n) => (n.stateProxy ? snapSubtree(n).concat(snapSubtree(n.stateProxy)) : snapSubtree(n));

  for (const n of targets) {
    if (n.disposed || !n._visible) continue; // an earlier drive may have closed it
    walked++;
    const r = n.worldRect;
    const cx = r ? (r.x0 + r.x1) / 2 : 0;
    const cy = r ? (r.y0 + r.y1) / 2 : 0;
    const at = { x: cx, y: cy, pointerId: 1, button: 0 };

    settleTweens(engine); // land any tween an earlier target's bubble started
    const rest = snapFor(n);

    n.dispatch('pointerenter', { ...at });
    settleTweens(engine);
    const hov = snapFor(n);
    // a tooltip raised FOR this node is hover feedback — it lives in the tooltip
    // layer, outside the subtree the diff can see (EldTooltip.attach shows on enter)
    const tooltipUp = EldTooltip._anchor === n && EldTooltip.node?._visible;
    if (!differs(rest, hov) && !tooltipUp && !allows(n, 'hover')) {
      add('hover', n, 'pointerenter changed nothing visible in the subtree');
    }

    n.dispatch('pointerdown', { ...at });
    settleTweens(engine);
    const prs = snapFor(n);
    // press art is demanded only of ACTIONABLE nodes — ones that listen for the
    // press or the click it becomes. A tooltip-only hover target (an effect cell,
    // a readout chip) has no press to feed back.
    const actionable = (n._listeners?.get('pointerdown')?.size || n._listeners?.get('click')?.size);
    if (actionable && !differs(rest, prs) && !allows(n, 'press')) {
      add('press', n, 'pointerdown changed nothing visible vs rest');
    }

    n.dispatch('pointerup', { ...at, canceled: false });
    n.dispatch('pointerleave', { ...at });
    // a press that ACQUIRED focus holds it past leave by design (a field keeps its
    // caret until you click elsewhere) — blur, as a real elsewhere-click would,
    // before asking for the resting state back
    const f = engine.focusedNode;
    if (f && (f === n || n.isAncestorOf?.(f))) engine.setFocus(null);
    settleTweens(engine, 0.8); // leave tweens + the slowest wash/rail fade-outs
    if (n.disposed) continue;   // the up genuinely acted (a close button) — its job
    const back = snapFor(n);
    const diff = allows(n, 'restore') ? null : firstDiff(rest, back);
    if (diff) {
      add('restore', n, `release/leave did not restore the resting state (${diff})`);
    }
  }

  return { violations, counts, allowances, walked, sealed };
}

// ---- the resize walker ----
// Every resizable surface on the page — windows carrying the eight-handle kit
// (`handles.se` + `_doResize`) and ResizeGrip hosts (`makeResizable`) — is driven
// through GROW (+64/+48) → SHRINK (to its floors) → RESTORE (back to its boot
// rect), each gesture through the surface's OWN handle events (the exact
// pointerdown/move/up input.js would deliver). After every step the page auditor
// re-runs: "nothing spills, no phantom bars" IS the audit's containment/overlap/
// scrollbar law, so a resize that breaks layout shows up as NEW audit violations.
// Rules: 'dead' (the handle moved nothing in either direction), 'spill' (new
// audit violations at any step), 'pin' (an atBottom scrollback lost its pin),
// 'restore' (the boot rect did not come back within 1px). Escape hatch:
// auditAllow('resize') mutes a surface wholesale (rationed, comment required).
function driveHandle(engine, handle, toX, toY) {
  const r = handle.worldRect;
  const cx = r ? (r.x0 + r.x1) / 2 : 0;
  const cy = r ? (r.y0 + r.y1) / 2 : 0;
  handle.dispatch('pointerdown', { x: cx, y: cy, button: 0, pointerId: 1 });
  handle.dispatch('pointermove', { x: cx + toX, y: cy + toY, pointerId: 1 });
  handle.dispatch('pointerup', { x: cx + toX, y: cy + toY, button: 0, pointerId: 1, canceled: false });
  settleTweens(engine, 0.2); // layout passes apply through the frame steps
}

export function runResizeTorture(engine) {
  if (engine.paintDirty) renumber(engine);
  const violations = [];
  const counts = { dead: 0, spill: 0, pin: 0, restore: 0 };
  let walked = 0, sealed = 0, allowed = 0;
  const add = (rule, node, detail) => {
    counts[rule]++;
    violations.push({ rule, node, path: pathOf(node), detail });
  };

  // enumerate surfaces BEFORE driving (a resize may spawn nodes)
  const surfaces = [];
  for (const n of engine.paintList) {
    if (!n._visible) continue;
    const isWindow = n.handles?.se && typeof n._doResize === 'function';
    const isGrip = n.constructor?.name === 'ResizeGrip' && n.host;
    if (!isWindow && !isGrip) continue;
    const surface = isWindow ? n : n.host;
    const handle = isWindow ? n.handles.se : n;
    if (surfaces.some((s) => s.surface === surface)) continue; // one drive per surface
    if (handle.closest?.((a) => a.disabled === true)) { sealed++; continue; }
    if (surface._auditAllow?.has('resize')) { allowed++; continue; }
    // sign of the drag that GROWS this surface (a tl grip grows leftward/upward)
    const corner = isWindow ? 'br' : (handle.corner ?? 'br');
    surfaces.push({ surface, handle, sx: corner[1] === 'l' ? -1 : 1, sy: corner[0] === 't' ? -1 : 1 });
  }

  const auditBase = runAudit(engine).violations;
  const audit0 = auditBase.length;
  const baseKeys = new Set(auditBase.map((v) => v.rule + '|' + v.path));
  // The violations a resize INTRODUCED — minus window-over-window overlap, which
  // is the windowing metaphor itself (drag/grow freely, z-order resolves; the
  // BOOT composition still may not overlap — the base audit holds that line).
  // `surface` is the one being driven: a REACH violation whose blocker is that surface
  // (or anything inside it) is this walker's own doing — it slams windows to +10000px,
  // and a window covering the page it was grown over is the windowing metaphor. Same
  // carve-out, same reason, as the window-over-window overlap line below.
  const newReal = (after, surface = null) => after.filter((v) =>
    !baseKeys.has(v.rule + '|' + v.path) &&
    !(v.rule === 'reach' && surface && v.blocker &&
      (v.blocker === surface || surface.isAncestorOf?.(v.blocker))) &&
    // THE FREEDOM LAW: a drag-grown surface may COVER its
    // same-layer neighbors — pages no longer budget grips, so the walked
    // surface overlapping a sibling is the law working, not a spill. IDENTITY
    // only, never ancestors: pairs are same-parent siblings, so a pair whose
    // parties are both INSIDE the surface is the surface's own layout breaking
    // under the resize — exactly what this walker exists to catch.
    !(v.rule === 'overlap' && surface &&
      (v.node === surface || v.partner === surface)) &&
    // …and the law's shadow: a freed surface grown UNDER a standing window
    // (social-hud's chat sliding beneath the guild frame — the grip itself
    // reach-blocked by a window's row) is the windowing metaphor, same as the
    // window-over-window line below: drag the window off and the surface
    // answers again. Only WINDOW-layer blockers are forgiven, and only for the
    // surface's OWN parts — a same-layer sibling burying the surface's
    // controls still spills.
    !(v.rule === 'reach' && surface && v.node &&
      (v.node === surface || surface.isAncestorOf?.(v.node)) &&
      v.blocker?.closest?.((n) => !n.parent) === engine.layers.windows) &&
    !(v.rule === 'overlap' && /Window/.test(v.node?.constructor?.name ?? '') && /with \w*Window\b/.test(v.detail)));
  const firstNew = (list) =>
    (list.length ? ` [${list[0].rule.toUpperCase()} ${list[0].path} — ${list[0].detail}]` : '');

  for (const { surface, handle, sx, sy } of surfaces) {
    if (surface.disposed || handle.disposed) continue;
    walked++;
    const base = { x: surface.x, y: surface.y, w: surface.w, h: surface.h };
    // the pin duck-type: any descendant scrollback resting at bottom must stay there
    const pinned = [];
    (function scan(m) {
      if (m.atBottom === true && typeof m.scrollToBottom === 'function') pinned.push(m);
      for (const c of m.children) scan(c);
    })(surface);

    driveHandle(engine, handle, 64 * sx, 48 * sy);
    const grew = surface.w > base.w || surface.h > base.h;
    const growNew = newReal(runAudit(engine).violations, surface);
    if (growNew.length > 0) {
      add('spill', surface, `growing introduced ${growNew.length}${firstNew(growNew)}`);
    }
    for (const m of pinned) {
      if (m.atBottom !== true) { add('pin', surface, 'an atBottom scrollback lost its pin growing'); break; }
    }

    driveHandle(engine, handle, -10000 * sx, -10000 * sy); // slam to the floors
    const shrank = surface.w < base.w || surface.h < base.h;
    const shrinkNew = newReal(runAudit(engine).violations, surface);
    if (shrinkNew.length > 0) {
      add('spill', surface, `shrinking to the floors introduced ${shrinkNew.length}${firstNew(shrinkNew)}`);
    }
    if (!grew && !shrank) {
      add('dead', surface, 'the handle moved nothing in either direction');
    }

    // restore the boot rect exactly, through the same handle
    driveHandle(engine, handle, (base.w - surface.w) * sx, (base.h - surface.h) * sy);
    if (Math.abs(surface.w - base.w) > 1 || Math.abs(surface.h - base.h) > 1 ||
        Math.abs(surface.x - base.x) > 1 || Math.abs(surface.y - base.y) > 1) {
      const msx = surface.contentArea ? ` (content maxScrollX ${surface.contentArea.maxScrollX})` : '';
      add('restore', surface,
        `boot rect ${base.x},${base.y} ${base.w}x${base.h} came back ${surface.x},${surface.y} ${surface.w}x${surface.h}${msx}`);
    }
    const restoreNew = newReal(runAudit(engine).violations, surface);
    if (restoreNew.length > 0) {
      add('spill', surface, `the restore left ${restoreNew.length}${firstNew(restoreNew)}`);
    }
    for (const m of pinned) {
      if (m.atBottom !== true) { add('pin', surface, 'an atBottom scrollback lost its pin through the cycle'); break; }
    }
  }

  return { violations, counts, walked, sealed, allowed };
}

// ---- the ?torture=1 harness (the initAudit pattern: settle, run once, title) ----
// The settle is LONGER than the auditor's 1.6s: boot-era rail reveals and wash
// graces ride live ticker timers, and stopping before they expire freezes them
// into false "rest" states the walk then collapses (the demo boot-rail lesson).
export function initTorture(engine, { settle = 4 } = {}) {
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
      engine.ticker.stop(); // the walk owns time now; world callbacks stay parked
      settleTweens(engine, 2); // land EVERY in-flight boot tween (rail fades, boot
                               // washes) so rest snapshots are true rest
      const report = runStateTorture(engine);
      const c = report.counts;
      // WALKED rides the title so the test suite can RATCHET the denominator — a page whose
      // walked population collapses (e.g. a capability removed wholesale) then fails,
      // instead of reporting a vacuous 0 (the numerator-without-denominator class)
      title = `TORTURE ${report.violations.length} WALKED ${report.walked}`;
      lines.push(`${title} [hover ${c.hover}, press ${c.press}, restore ${c.restore}; ` +
        `walked ${report.walked}, sealed ${report.sealed}; allowances ` +
        `${Object.values(report.allowances).reduce((a, b) => a + b, 0)}]`);
      for (const v of report.violations) lines.push(`${v.rule.toUpperCase()} ${v.path} — ${v.detail}`);
      window.__torture = { title, counts: c, allowances: report.allowances, lines };
    } catch (err) {
      title = 'TORTURE ERROR ' + String(err && err.message ? err.message : err).slice(0, 80);
      window.__torture = { title, lines: [title] };
    }
    document.title = title;
    const pre = document.createElement('pre');
    pre.id = 'torture';
    pre.style.cssText = 'position:fixed;right:8px;top:8px;max-width:46vw;max-height:95vh;overflow:auto;' +
      'color:#9fd6ae;background:rgba(4,8,6,0.92);padding:10px;z-index:100;font:11px/1.5 Consolas,monospace;white-space:pre-wrap;';
    pre.textContent = lines.join('\n');
    document.body.appendChild(pre);
  });
}

// ---- the ?resize=1 harness (the same settle/stop discipline) ----
export function initResizeTorture(engine, { settle = 4 } = {}) {
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
      engine.ticker.stop();
      settleTweens(engine, 2);
      const report = runResizeTorture(engine);
      const c = report.counts;
      title = `RESIZE ${report.violations.length} WALKED ${report.walked}`;
      lines.push(`${title} [dead ${c.dead}, spill ${c.spill}, pin ${c.pin}, restore ${c.restore}; ` +
        `walked ${report.walked}, sealed ${report.sealed}, allowed ${report.allowed}]`);
      for (const v of report.violations) lines.push(`${v.rule.toUpperCase()} ${v.path} — ${v.detail}`);
      window.__resize = { title, counts: c, lines };
    } catch (err) {
      title = 'RESIZE ERROR ' + String(err && err.message ? err.message : err).slice(0, 80);
      window.__resize = { title, lines: [title] };
    }
    document.title = title;
    const pre = document.createElement('pre');
    pre.id = 'resize';
    pre.style.cssText = 'position:fixed;right:8px;top:8px;max-width:46vw;max-height:95vh;overflow:auto;' +
      'color:#9fd6ae;background:rgba(4,8,6,0.92);padding:10px;z-index:100;font:11px/1.5 Consolas,monospace;white-space:pre-wrap;';
    pre.textContent = lines.join('\n');
    document.body.appendChild(pre);
  });
}

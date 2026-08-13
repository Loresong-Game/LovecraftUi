// TextNode: Canvas2D-rasterized text on a quad. One canvas per label, reused in place.
// Crispness: canvas backed at DPR, LinearFilter, generateMipmaps OFF (CanvasTexture defaults it ON).
// Vertical metrics: text draws on the alphabetic baseline and the node height hugs the real
// font box (ascent+descent), so centering by node height is visually correct.
// IMPORTANT: growing the backing canvas requires texture.dispose() — three.js allocates
// immutable GPU storage (texStorage2D) and a larger canvas otherwise silently fails to upload,
// leaving the old pixels stretched across the bigger mesh.

import * as THREE from 'three';
import { UINode } from './node.js';
import { unitQuadGeometry, makeUIMaterial, QuadNode } from './primitives.js';
import { FONTS, COLORS, METRICS } from './theme.js';

// Text raster density base: DPR × the ui scale (text baked at DPR×uiScale
// stays crisp at TV distance). setTextScale is set by the entry at boot, reset on
// destroy; every raster path routes through getDPR so the whole type re-cuts.
let _textScale = 1;
export function setTextScale(v) { _textScale = Number.isFinite(v) && v > 0 ? Math.min(2, v) : 1; }
export function getDPR() { return Math.min(4, Math.min(window.devicePixelRatio || 1, 2) * _textScale); }

const MAX_TEXT_RASTER = 4; // raster-factor cap: DPR cap (2) × one 2x zoom bucket

const _measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const _measureCtx = _measureCanvas ? _measureCanvas.getContext('2d') : null;
const _measureCache = new Map();
const MEASURE_CACHE_MAX = 4000;
const _metricsCache = new Map();

// Full-teardown hook (Eldritch.destroy): a re-theme may swap in font families whose
// metrics differ — or whose web font finished loading after the first boot measured
// its fallback — and both caches key on the font string alone, so stale widths would
// survive into the next init. Module-internal: not part of the public entry surface.
export function resetTextCaches() {
  _measureCache.clear();
  _metricsCache.clear();
  _markupWarned.clear(); // each boot gets fresh markup warnings (destroy/init = a new session)
}

export function fontString({ size = 13, weight = '', style = '', smallCaps = false, font = FONTS.body } = {}) {
  return `${style ? style + ' ' : ''}${smallCaps ? 'small-caps ' : ''}${weight ? weight + ' ' : ''}${size}px ${font}`;
}

export function measureText(font, str, letterSpacing = 0) {
  const key = font + '|' + letterSpacing + '|' + str;
  const hit = _measureCache.get(key);
  if (hit !== undefined) {
    // LRU touch: re-insertion keeps hot keys at the tail; eviction takes the head.
    _measureCache.delete(key);
    _measureCache.set(key, hit);
    return hit;
  }
  _measureCtx.font = font;
  let wid = _measureCtx.measureText(str).width;
  if (letterSpacing && str.length > 1) wid += letterSpacing * (str.length - 1);
  if (_measureCache.size >= MEASURE_CACHE_MAX) _measureCache.delete(_measureCache.keys().next().value);
  _measureCache.set(key, wid);
  return wid;
}

// Real font box (ascent above + descent below the alphabetic baseline), cached per font string.
export function fontMetrics(font, sizePx) {
  let m = _metricsCache.get(font);
  if (m) return m;
  _measureCtx.font = font;
  const t = _measureCtx.measureText('Mgy');
  const ascent = t.fontBoundingBoxAscent ?? Math.ceil(sizePx * 1.0);
  const descent = t.fontBoundingBoxDescent ?? Math.ceil(sizePx * 0.25);
  m = { ascent, descent, height: Math.ceil(ascent + descent) };
  _metricsCache.set(font, m);
  return m;
}

export function ellipsize(font, str, maxWidth, letterSpacing = 0) {
  if (measureText(font, str, letterSpacing) <= maxWidth) return str;
  const ell = '…';
  let lo = 0, hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(font, str.slice(0, mid) + ell, letterSpacing) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return lo === 0 ? ell : str.slice(0, lo) + ell;
}

export function wrapText(font, str, maxWidth) {
  const out = [];
  for (const para of String(str).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const cand = line ? line + ' ' + word : word;
      if (line && measureText(font, cand) > maxWidth) { out.push(line); line = word; }
      else line = cand;
    }
    out.push(line);
  }
  return out;
}

// Caret index whose left edge is closest to local x (for text-field caret/selection placement).
export function caretIndexForX(font, str, x, letterSpacing = 0) {
  if (x <= 0) return 0;
  let best = str.length;
  for (let i = 0; i <= str.length; i++) {
    const w = measureText(font, str.slice(0, i), letterSpacing);
    if (w >= x) {
      const prev = i > 0 ? measureText(font, str.slice(0, i - 1), letterSpacing) : 0;
      best = (x - prev) < (w - x) ? i - 1 : i;
      break;
    }
  }
  return Math.max(0, Math.min(str.length, best));
}

const PAD = 3; // canvas bleed around text for shadows/antialiasing

// ---- Rich text ----
// Segments may carry {text, color?, font?} or {icon: name}. Icons resolve by NAME at
// draw time through this accessor (wired by the boot code to the texture registry's
// retained canvases) — TextNodes render at construction, before any engine exists, and
// segments must stay JSON-serializable. Unresolved icons draw a quiet placeholder box.
let _iconSource = null;
export function setIconSource(fn) { _iconSource = fn; }

const MARKUP_RE = /\{\{|\{color:([^}]+)\}|\{icon:([^}]+)\}|\{link:([^}]+)\}|\{hl:([^}]+)\}|\{b\}|\{i\}|\{\/\}/g;

// link-wash levels: hover matches accentFaint's weight (the VirtualList focus wash),
// press matches the Tabs active-wash tier. State changes tween 0.1s (STYLE §4).
// Link wash levels ride the interaction floors — read at EVENT time (never into
// module constants: METRICS is themable, the S43 painter rule generalized).
const linkWashHover = () => METRICS.washHover;
const linkWashPress = () => METRICS.washPress;

// Friendly-errors v2: malformed markup names the offending string. Warned
// once per distinct string (markup recompiles on every setText — a ticker feeding
// the same broken line must not warn per frame); the memory is capped.
const _markupWarned = new Set();
function warnMarkup(problem, src) {
  const key = problem + '|' + src;
  if (_markupWarned.has(key)) return;
  if (_markupWarned.size > 100) _markupWarned.clear();
  _markupWarned.add(key);
  const excerpt = src.length > 60 ? src.slice(0, 57) + '…' : src;
  console.warn(`LovecraftUI markup: ${problem} in "${excerpt}"`);
}

function runFont(style, bold, italic) {
  if (!bold && !italic) return undefined;
  return fontString({
    size: style.size ?? 13,
    weight: bold ? 'bold' : (style.weight ?? ''),
    style: italic ? 'italic' : (style.styleIt ?? ''),
    smallCaps: style.smallCaps ?? false,
    font: style.font ?? FONTS.body,
  });
}

// Markup: {color:#hex}...{/}, {b}...{/}, {i}...{/} (nesting stacks), {icon:name},
// {link:id}...{/} clickable runs (tinted COLORS.link at compile time; an inner
// {color:} overrides the tint), {hl:#hex}...{/} highlight fills (the argument is
// required — a bare {hl} renders literally), {{ for a literal brace. Unknown {tags}
// render literally (forgiving by design). Unstyled runs carry NO color/font keys so
// setColor keeps working on markup nodes. Two same-id {link:} instances never merge:
// each open takes a fresh per-call linkKey ordinal, keeping compiles pure and
// JSON-stable while washes and click payloads aggregate per INSTANCE.
export function compileMarkup(str, style = {}) {
  const segs = [];
  const stack = [];
  let color, bold, italic, link, linkKey, hl;
  let nextLinkKey = 0;
  const recompute = () => {
    color = undefined; bold = false; italic = false;
    link = undefined; linkKey = undefined; hl = undefined;
    for (const f of stack) {
      if (f.color !== undefined) color = f.color;
      if (f.bold) bold = true;
      if (f.italic) italic = true;
      if (f.link !== undefined) { link = f.link; linkKey = f.linkKey; }
      if (f.hl !== undefined) hl = f.hl;
    }
  };
  recompute();
  const push = (text) => {
    if (!text) return;
    const seg = { text };
    if (color !== undefined) seg.color = color;
    const f = runFont(style, bold, italic);
    if (f !== undefined) seg.font = f;
    if (link !== undefined) { seg.link = link; seg.linkKey = linkKey; }
    if (hl !== undefined) seg.hl = hl;
    const last = segs[segs.length - 1];
    if (last && last.text !== undefined && last.color === seg.color && last.font === seg.font &&
        last.link === seg.link && last.linkKey === seg.linkKey && last.hl === seg.hl) last.text += text;
    else segs.push(seg);
  };
  const src = String(str ?? '');
  MARKUP_RE.lastIndex = 0;
  let i = 0, m;
  while ((m = MARKUP_RE.exec(src))) {
    push(src.slice(i, m.index));
    i = MARKUP_RE.lastIndex;
    if (m[0] === '{{') push('{');
    else if (m[0] === '{/}') {
      if (!stack.length) warnMarkup('stray {/} with no open run', src); // tolerated: it closes nothing
      stack.pop();
      recompute();
    }
    else if (m[1] !== undefined) { stack.push({ color: m[1] }); recompute(); }
    else if (m[2] !== undefined) {
      const iseg = { icon: m[2] };
      if (link !== undefined) { iseg.link = link; iseg.linkKey = linkKey; } // icons inside links click
      if (hl !== undefined) iseg.hl = hl;
      segs.push(iseg);
    }
    else if (m[3] !== undefined) {
      // the frame carries the tint so precedence is free: a deeper {color:} overrides,
      // an outer one loses to the link (the innermost-wins recompute loop)
      stack.push({ link: m[3], linkKey: nextLinkKey++, color: COLORS.link });
      recompute();
    }
    else if (m[4] !== undefined) { stack.push({ hl: m[4] }); recompute(); }
    else if (m[0] === '{b}') { stack.push({ bold: true }); recompute(); }
    else { stack.push({ italic: true }); recompute(); }
  }
  push(src.slice(i));
  if (stack.length) warnMarkup(`${stack.length} unclosed run(s) - missing {/}`, src); // tolerated: styled to the end
  return segs.length ? segs : [{ text: '' }];
}

function runWidth(run, font, letterSpacing, iconSize) {
  return run.icon !== undefined ? iconSize : measureText(run.font ?? font, run.text, letterSpacing);
}

// The width the renderer actually draws for one line of segments: run widths plus the
// letterSpacing gap the per-char path advances after a text run that another segment
// follows (icons advance exactly their box; nothing trails the line's final run).
// Summing bare runWidths undercounts those boundary gaps and mis-centers/clips
// aligned markup text; single-run lines are unchanged (no boundary exists).
function lineWidth(segs, font, letterSpacing, iconSize) {
  let w = 0;
  for (let i = 0; i < segs.length; i++) {
    w += runWidth(segs[i], font, letterSpacing, iconSize);
    if (letterSpacing && i < segs.length - 1 && segs[i].icon === undefined) w += letterSpacing;
  }
  return w;
}

// Tokenize styled runs into wrap atoms: words (keeping their style), spaces, icons,
// and hard breaks. Wrapping then packs atoms so styling survives line breaks.
function tokenizeRuns(runs) {
  const atoms = [];
  for (const run of runs) {
    if (run.icon !== undefined) { atoms.push({ icon: run.icon, link: run.link, linkKey: run.linkKey, hl: run.hl }); continue; }
    const text = run.text ?? '';
    let word = '';
    const flush = () => {
      if (word) { atoms.push({ text: word, color: run.color, font: run.font, link: run.link, linkKey: run.linkKey, hl: run.hl }); word = ''; }
    };
    for (const ch of text) {
      if (ch === '\n') { flush(); atoms.push({ br: true }); }
      else if (ch === ' ') { flush(); atoms.push({ sp: true, color: run.color, font: run.font, link: run.link, linkKey: run.linkKey, hl: run.hl }); }
      else word += ch;
    }
    flush();
  }
  return atoms;
}

// Exported for the log widgets: EventLog/DebugConsole flatten one entry
// into N visual lines through the same wrap the multiline TextNode uses, so pooled
// fixed-height rows can window WRAPPED history. Module-internal to src (like
// resetTextCaches): not part of the public entry surface.
export function wrapRuns(runs, font, maxWidth, letterSpacing, iconSize) {
  const atoms = tokenizeRuns(runs);
  const lines = [];
  let line = [], lineW = 0, pendingSpace = null;
  const pushLine = () => { lines.push(line); line = []; lineW = 0; pendingSpace = null; };
  const append = (piece, w) => {
    const last = line[line.length - 1];
    if (last && last.text !== undefined && piece.text !== undefined &&
        last.color === piece.color && last.font === piece.font &&
        last.link === piece.link && last.linkKey === piece.linkKey && last.hl === piece.hl) { last.text += piece.text; lineW += w; return; }
    // un-merged boundary after a text run: the renderer advances letterSpacing there
    // (see lineWidth), so the fill decision must count it too
    if (letterSpacing && last && last.text !== undefined) lineW += letterSpacing;
    line.push(piece);
    lineW += w;
  };
  // A wrap break swallows its pending space (never drawn). When that space sat INSIDE
  // a {link:} run, the piece opening the next line carries wrapSp so the fragment text
  // linkAt aggregates keeps the word gap — the CJK char-break swallows no space, so
  // char-broken tokens keep joining glue-free. Render-internal: draw/rects untouched.
  let swallowed;
  const mark = (piece) => {
    if (swallowed !== undefined && piece.linkKey === swallowed) piece.wrapSp = true;
    swallowed = undefined;
    return piece;
  };
  for (const a of atoms) {
    if (a.br) { pushLine(); continue; }
    if (a.sp) { if (line.length) pendingSpace = a; continue; } // leading spaces vanish
    const w = a.icon !== undefined ? iconSize : measureText(a.font ?? font, a.text, letterSpacing);
    const spW = pendingSpace ? measureText(pendingSpace.font ?? font, ' ', letterSpacing) : 0;
    if (line.length && lineW + spW + w > maxWidth) {
      if (pendingSpace && pendingSpace.link !== undefined) swallowed = pendingSpace.linkKey;
      pushLine();
    } else if (pendingSpace) {
      append({ text: ' ', color: pendingSpace.color, font: pendingSpace.font, link: pendingSpace.link, linkKey: pendingSpace.linkKey, hl: pendingSpace.hl }, spW);
    }
    pendingSpace = null;
    if (a.text !== undefined && w > maxWidth) {
      // CJK / long-token fallback: break the over-wide atom by measured characters
      let chunk = '';
      for (const ch of a.text) {
        if (chunk && measureText(a.font ?? font, chunk + ch, letterSpacing) > maxWidth) {
          append(mark({ text: chunk, color: a.color, font: a.font, link: a.link, linkKey: a.linkKey, hl: a.hl }), measureText(a.font ?? font, chunk, letterSpacing));
          pushLine();
          chunk = ch;
        } else chunk += ch;
      }
      if (chunk) append(mark({ text: chunk, color: a.color, font: a.font, link: a.link, linkKey: a.linkKey, hl: a.hl }), measureText(a.font ?? font, chunk, letterSpacing));
      continue;
    }
    append(mark(a.icon !== undefined ? { icon: a.icon, link: a.link, linkKey: a.linkKey, hl: a.hl } : { text: a.text, color: a.color, font: a.font, link: a.link, linkKey: a.linkKey, hl: a.hl }), w);
  }
  pushLine();
  return lines;
}

function ellipsizeRuns(runs, font, maxWidth, letterSpacing, iconSize) {
  const total = lineWidth(runs, font, letterSpacing, iconSize);
  if (total <= maxWidth) return runs;
  const out = [];
  let used = 0;
  for (const r of runs) {
    const w = runWidth(r, font, letterSpacing, iconSize);
    if (r.icon !== undefined) {
      if (used + w + measureText(font, '…', letterSpacing) <= maxWidth) { out.push(r); used += w; continue; }
      // an icon cannot be half-shown: drop it whole, ellipsize in the prior style
      // (the '…' inherits the prior run's link/hl too, so a truncated link stays
      // clickable to its visible end)
      const prev = out[out.length - 1];
      out.push({ text: '…', color: prev?.color, font: prev?.font, link: prev?.link, linkKey: prev?.linkKey, hl: prev?.hl });
      return out;
    }
    const f = r.font ?? font;
    // a kept text run is always followed by something (a later run or the '…'), so its
    // boundary letterSpacing is real drawn width — count it into the budget
    if (used + w + measureText(f, '…', letterSpacing) <= maxWidth) {
      out.push(r); used += w + (letterSpacing && r.icon === undefined ? letterSpacing : 0); continue;
    }
    out.push({ ...r, text: ellipsize(f, r.text, Math.max(0, maxWidth - used), letterSpacing) });
    return out;
  }
  out.push({ text: '…' });
  return out;
}

export class TextNode extends UINode {
  constructor(text = '', style = {}) {
    super({});
    this.style = {
      font: FONTS.body, size: 13, color: COLORS.text, weight: '', styleIt: '',
      smallCaps: false, letterSpacing: 0, align: 'left',
      shadow: null,             // {color, dx, dy, blur}
      maxWidth: 0, ellipsis: false,
      multiline: false, lineHeight: 0, fixedW: 0,
      markup: false,            // setText parses {color:}/{icon:}/{b}/{i} markup
      // a fitWidth node treats a DRIVEN width (a box stretch, a window resize)
      // as its wrap width and re-rasters — width becomes a layout INPUT
      fitWidth: false,
      ...style,
    };
    this._markupRaw = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 1;
    this.material = makeUIMaterial({ map: this.texture });
    this.baseOpacity = 1;
    this.mesh = new THREE.Mesh(unitQuadGeometry(), this.material);
    this.mesh.userData.node = this;
    this.group.add(this.mesh);
    this._text = null;
    this._segments = null;      // array of {text, color, font?} when segment-based
    this._segmentsKey = null;
    this._canvasW = 0; this._canvasH = 0; // CSS-px canvas size (backing is ×DPR)
    this.setText(text);
  }

  get fontCss() {
    const s = this.style;
    return fontString({ size: s.size, weight: s.weight, style: s.styleIt, smallCaps: s.smallCaps, font: s.font });
  }

  setColor(color) {
    if (this.style.color === color) return;
    this.style.color = color;
    if (this._segments) {
      const segs = this._segments;
      this._segments = null; this._segmentsKey = null;
      this.setSegments(segs);
    } else {
      const t = this._text;
      this._text = null;
      this.setText(t ?? '');
    }
  }

  // the ellipsis-lane companion to fitWidth. A single-line clamp
  // cannot ride fitWidth (fitWidth implies wrapping), so a lane-tracked ellipsis
  // re-clamps through here — the caches drop exactly like setColor, because both
  // setText and setSegments no-op on unchanged keys.
  setMaxWidth(w) {
    w = Math.max(0, Math.round(w));
    if (this.style.maxWidth === w) return;
    this.style.maxWidth = w;
    if (this._segments) {
      const segs = this._segments;
      this._segments = null; this._segmentsKey = null;
      this.setSegments(segs);
    } else {
      const t = this._text;
      this._text = null;
      this.setText(t ?? '');
    }
  }

  setText(text) {
    text = String(text ?? '');
    this._pendingText = text;
    if (this.style.markup) {
      if (this._markupRaw === text && this._segments) return;
      this.setSegments(compileMarkup(text, this.style));
      this._markupRaw = text;
      return;
    }
    this._markupRaw = null;
    if (this._text === text && !this._segments) return;
    this._revealStop?.(false); // new content supersedes an active reveal (settles its promise)
    this._segments = null; this._segmentsKey = null;
    this._text = text;
    this._render([{ text, color: this.style.color }]);
  }

  // Styled runs: [{text, color?, font?} | {icon: name}]. Runs survive wrapping.
  setSegments(segments) {
    const key = JSON.stringify(segments);
    if (this._segmentsKey === key) return;
    this._revealStop?.(false); // new content supersedes an active reveal (settles its promise)
    this._markupRaw = null;
    this._segments = segments;
    this._segmentsKey = key;
    this._text = null;
    this._render(segments);
  }

  // ---- reveal mode: the typewriter seam ----
  // Pre-renders the FULL content once (the grow-only backing reaches final size and
  // the node keeps its full box), then re-rasters a growing prefix from the frame
  // hook at `cps` characters per second — each tick is clearRect + prefix fillText,
  // no texture churn, no layout drift. Plain and markup text both work (segments
  // re-slice to the char budget; an inline icon counts as one character).
  // Returns a promise that resolves on completion, on skip(), when superseded by a
  // new reveal/setText/setSegments, or at dispose — never rejects. Mechanism only:
  // reducedMotion policy belongs to the caller (reveal() then skip() = instant text).
  reveal(cps = 30, opts = {}) {
    this._revealStop?.(false);
    const segs = this._segments ?? [{ text: this._text ?? '', color: this.style.color }];
    const total = segs.reduce((n, r) => n + (r.icon !== undefined ? 1 : (r.text?.length ?? 0)), 0);
    this._render(segs); // pre-size: the backing, the mesh, and the node box all land final
    if (total === 0) return Promise.resolve(this);
    const holdW = this.w, holdH = this.h;
    let shown = 0, budget = 0, resolveFn;
    const done = new Promise((res) => { resolveFn = res; });
    const stop = (finish) => {
      if (this._revealStop !== stop) return;
      this._revealStop = null;
      this.setFrameHook(null);
      if (finish) {
        this._render(segs);
        this.w = holdW; this.h = holdH;
        this.invalidateLayout();
      }
      resolveFn(this);
    };
    this._revealStop = stop;
    this._renderPrefix(segs, 0, holdW, holdH);
    this.setFrameHook((dt) => {
      budget += cps * dt;
      const step = Math.floor(budget);
      if (step <= 0) return;
      budget -= step;
      const added = Math.min(step, total - shown);
      shown += added;
      this._renderPrefix(segs, shown, holdW, holdH);
      opts.onChar?.(added, shown, total);
      if (shown >= total) stop(false); // the last prefix IS the full text
    });
    return done;
  }

  // Instantly lands the full text and resolves the reveal promise; a no-op when
  // nothing is revealing (safe to call unconditionally from an advance affordance).
  skip() { this._revealStop?.(true); return this; }

  get isRevealing() { return !!this._revealStop; }

  _renderPrefix(segments, count, holdW, holdH) {
    const out = [];
    let left = count;
    for (const r of segments) {
      if (left <= 0) break;
      if (r.icon !== undefined) { out.push(r); left -= 1; continue; }
      const t = r.text ?? '';
      if (t.length <= left) { out.push(r); left -= t.length; }
      else { out.push({ ...r, text: t.slice(0, left) }); left = 0; }
    }
    this._render(out.length ? out : [{ text: '', color: this.style.color }]);
    // the box must not breathe while the prefix grows — hold the full-content rect
    this.w = holdW; this.h = holdH;
    this.invalidateLayout();
  }

  _render(segments) {
    const s = this.style;
    const font = this.fontCss;
    const fm = fontMetrics(font, s.size);
    const lineAdvance = s.lineHeight || Math.round(s.size * 1.35);
    const iconSize = fm.height; // inline icons fill the line box, baseline-aligned

    // BOTH branches produce arrays of run-arrays — per-run color/font/icons survive
    // wrapping (the old path flattened multiline text to plain strings).
    let lines;
    if (s.multiline && s.maxWidth > 0) {
      lines = wrapRuns(segments, font, s.maxWidth, s.letterSpacing, iconSize);
    } else {
      let line = segments;
      if (s.maxWidth > 0 && s.ellipsis) {
        line = ellipsizeRuns(segments, font, s.maxWidth, s.letterSpacing, iconSize);
      }
      lines = [line];
    }

    // Content box (CSS px). Height hugs the glyph box: ascent+descent for one line,
    // plus lineAdvance per extra line.
    let contentW = 0;
    if (s.fixedW) contentW = s.fixedW;
    else if (s.multiline && s.maxWidth > 0) contentW = s.maxWidth;
    else {
      for (const ln of lines) contentW = Math.max(contentW, lineWidth(ln, font, s.letterSpacing, iconSize));
      contentW = Math.ceil(contentW);
      // maxWidth ALONE is an honest single-line clamp — the canvas ends at the
      // stated width and overlong glyphs cut there (it was silently ignored before;
      // pass ellipsis for a graceful truncation, multiline to wrap)
      if (s.maxWidth > 0) contentW = Math.min(contentW, Math.ceil(s.maxWidth));
    }
    const contentH = fm.height + (lines.length - 1) * lineAdvance;

    // Grow-only backing store in CSS units; any device-pixel size change REQUIRES
    // texture.dispose() (immutable GPU storage). The raster factor (DPR × zoom bucket)
    // resizes the backing even when the CSS box is unchanged — a factor-only re-raster
    // into a stale-sized canvas clips going up and shrinks into a corner going down.
    const dpr = this._rasterFactor();
    const needW = contentW + PAD * 2;
    const needH = contentH + PAD * 2;
    if (needW > this._canvasW || needH > this._canvasH || this._backingFactor !== dpr) {
      this._canvasW = Math.max(needW, this._canvasW);
      this._canvasH = Math.max(needH, this._canvasH);
      this._backingFactor = dpr;
      this.canvas.width = Math.max(2, Math.ceil(this._canvasW * dpr));
      this.canvas.height = Math.max(2, Math.ceil(this._canvasH * dpr));
      this.texture.dispose();
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this._canvasW, this._canvasH);
    ctx.textBaseline = 'alphabetic';
    ctx.font = font;
    if (s.shadow) {
      ctx.shadowColor = s.shadow.color ?? 'rgba(0,0,0,0.8)';
      ctx.shadowOffsetX = (s.shadow.dx ?? 1) * dpr; // shadow offsets ignore the transform
      ctx.shadowOffsetY = (s.shadow.dy ?? 1) * dpr;
      ctx.shadowBlur = (s.shadow.blur ?? 2) * dpr;
    }

    // per-fragment link rects are RETAINED for hit-testing (linkAt) and the hover
    // washes; {hl:} runs fill behind their glyphs. Both live only on marked segments —
    // plain text allocates nothing new (_fragments stays null).
    this._fragments = null;
    this._lineAdvance = lineAdvance;
    this._fmHeight = fm.height;
    let baseline = PAD + fm.ascent;
    let lineIndex = 0;
    for (const segs of lines) {
      const lineW = lineWidth(segs, font, s.letterSpacing, iconSize);
      let x = PAD;
      if (s.align === 'center') x = PAD + (contentW - lineW) / 2;
      else if (s.align === 'right') x = PAD + contentW - lineW;
      for (const seg of segs) {
        const segW = runWidth(seg, font, s.letterSpacing, iconSize);
        if (seg.hl !== undefined) {
          // the highlight fill sits UNDER the glyphs; the house shadow must not smudge it
          const shadowColor = ctx.shadowColor;
          ctx.shadowColor = 'transparent';
          ctx.fillStyle = seg.hl;
          ctx.fillRect(x, baseline - fm.ascent, segW, fm.height);
          ctx.shadowColor = shadowColor;
        }
        if (seg.link !== undefined) {
          if (!this._fragments) this._fragments = [];
          const prev = this._fragments[this._fragments.length - 1];
          if (prev && prev.key === seg.linkKey && prev.line === lineIndex) {
            // consecutive same-instance runs on one line fold into one rect
            prev.text += seg.icon !== undefined ? '' : seg.text;
            prev.w = (x - PAD) + segW - prev.x;
          } else {
            // wrapSp restores the word gap the wrap break swallowed — text only, never a rect
            this._fragments.push({
              id: seg.link, key: seg.linkKey,
              text: (seg.wrapSp ? ' ' : '') + (seg.icon !== undefined ? '' : seg.text),
              x: x - PAD, y: lineIndex * lineAdvance, w: segW, h: fm.height, line: lineIndex,
            });
          }
        }
        if (seg.icon !== undefined) {
          const src = _iconSource ? _iconSource(seg.icon) : null;
          const yTop = baseline - fm.ascent;
          if (src) {
            ctx.drawImage(src, x, yTop, iconSize, iconSize);
          } else {
            // pre-boot or unknown icon: a quiet placeholder box, never a throw
            ctx.strokeStyle = seg.color ?? s.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1.5, yTop + 1.5, iconSize - 3, iconSize - 3);
          }
          x += iconSize;
          continue;
        }
        ctx.font = seg.font ?? font;
        ctx.fillStyle = seg.color ?? s.color;
        if (s.letterSpacing) {
          for (const ch of seg.text) { ctx.fillText(ch, x, baseline); x += measureText(ctx.font, ch) + s.letterSpacing; }
        } else {
          ctx.fillText(seg.text, x, baseline);
          x += measureText(ctx.font, seg.text);
        }
      }
      baseline += lineAdvance;
      lineIndex++;
    }
    this.texture.needsUpdate = true;
    this._renderedFactor = dpr;

    // Node rect = content box; the mesh is oversized by PAD on all sides.
    this.w = contentW; this.h = contentH;
    this._meshW = this._canvasW; this._meshH = this._canvasH;
    this.invalidateLayout();

    // a re-raster invalidates hover state (a pooled row can rebind under a parked
    // cursor — the stale rects must not keep a wash lit); wiring itself is lazy, so
    // linkless TextNodes never allocate listeners or washes.
    if (this._linkWired) this._clearLinkHover();
    else if (this._fragments) this._wireLinks();
  }

  applyOpacity(v) { this.material.opacity = this.baseOpacity * v; }

  // Raster density: DPR alone at world scale 1 (the whole classic UI), else DPR × a
  // power-of-2 zoom bucket rounded UP — texel:screen-pixel stays in [1,2), the band where
  // LinearFilter-without-mipmaps is neither blurry nor aliased, and a continuous zoom
  // re-rasters at most once per 2x of travel. The -0.02 epsilon keeps bucket boundaries
  // off round zoom values so wheel jitter parked at 1.0 or 2.0 never ping-pongs.
  _rasterFactor() {
    const ws = this.worldScale;
    if (ws === 1) return getDPR();
    const bucket = Math.pow(2, Math.ceil(Math.log2(ws) - 0.02));
    return Math.min(MAX_TEXT_RASTER, Math.max(0.25, getDPR() * bucket));
  }

  // the reflow contract. A fitWidth node adopts a driven width as
  // its wrap width and re-rasters — ONLY on a REAL width change (rasters are
  // expensive; the _fitW guard also breaks any box↔text sizing cycle: the same
  // driven width takes the plain path). After the reflow, size comes from the
  // raster truth (the driven height would be stale — the wrap just changed it).
  setRect(x, y, w, h) {
    if (this.style.fitWidth && w > 0 && w !== this._fitW) {
      this._fitW = w;
      this.style.maxWidth = w;
      this.style.multiline = true; // fitWidth implies wrapping
      this._rerender();
      super.setRect(x, y, this.w, this.h);
      return;
    }
    super.setRect(x, y, w, h);
  }

  // Re-rasterize through the normal path (cache keys are cleared first).
  _rerender() {
    if (this._segments) {
      const segs = this._segments;
      this._segments = null; this._segmentsKey = null;
      this.setSegments(segs);
    } else {
      const t = this._text;
      this._text = null;
      this.setText(t ?? '');
    }
  }

  syncSelf() {
    // Self-heal when the required raster factor (DPR × zoom bucket) drifts from what was
    // drawn: monitor-DPR moves and ancestor contentScale changes both land here. Clip-culled
    // labels defer to their first visible frame — a zoom step over a large plane must not
    // redraw every off-screen label at once.
    if (this._renderedFactor !== undefined && this.mesh.visible &&
        this._renderedFactor !== this._rasterFactor()) this._rerender();
    this.mesh.scale.set(this._meshW || 1, this._meshH || 1, 1);
    this.mesh.position.set(-PAD, PAD, 0);
  }

  // ---- inline link interaction ----
  // The hit test for {link:} runs, in NODE-LOCAL logical px. A fragment's x-range is
  // exact; its vertical band fills the whole line advance, so the stacked fragments of
  // a wrapped link tile gap-free (first match wins — the top line claims the seam).
  // Returns { id, key, text } — text is the INSTANCE's visible text (fragments joined,
  // '…' included when truncated; key on `id`, text is advisory) — or null.
  linkAt(localX, localY) {
    const frags = this._fragments;
    if (!frags) return null;
    const adv = this._lineAdvance || this._fmHeight || 0;
    for (const f of frags) {
      const y0 = f.line * adv;
      const y1 = y0 + Math.max(f.h, adv);
      if (localX >= f.x && localX <= f.x + f.w && localY >= y0 && localY < y1) {
        return { id: f.id, key: f.key, text: this._linkText(f.key) };
      }
    }
    return null;
  }

  _linkText(key) {
    let t = '';
    for (const f of this._fragments) if (f.key === key) t += f.text;
    return t;
  }

  _linkHitFromEvent(e) {
    const ws = this.worldScale || 1;
    return this.linkAt((e.x - this.worldX) / ws, (e.y - this.worldY) / ws);
  }

  // Wired ONCE, lazily, by the first _render that retains fragments. The node still
  // takes no hits until something sets `interactive = true` (EventLog flips its lines
  // per bind; raw TextNodes opt in — the documented recipe).
  _wireLinks() {
    this._linkWired = true;
    this._linkWashes = [];
    this._linkHoverKey = null;
    this._linkHoverId = null;
    this._linkHoverText = null;
    this._linkHoverX = 0;
    this._linkHoverY = 0;
    this._linkPressKey = null;
    this._linkReleasedPress = null;
    this._linkCursor = false;
    this.on('pointermove', (e) => this._onLinkMove(e));
    this.on('pointerleave', () => this._clearLinkHover());
    this.on('pointerdown', (e) => {
      if (this._linkPressKey != null) return; // a live link press owns the gesture — a second finger is deaf
      const f = this._linkHitFromEvent(e);
      this._linkPressKey = f ? f.key : null;
      this._linkPressPointer = e.pointerId ?? -1;
      this._linkReleasedPress = null;
      if (f) this._setLinkWash(f.key, linkWashPress());
    });
    this.on('pointerup', (e) => {
      if (this._linkPressKey != null && (e.pointerId ?? -1) !== this._linkPressPointer) return; // only the owner releases
      // a canceled up (touch pan promotion, a mid-press subtree seal, window blur)
      // ends dark — the panzoom-coast rule; re-lighting hover here would strand a
      // wash under a gesture that no longer belongs to this node
      if (e.canceled) { this._clearLinkHover(); return; }
      // click synthesizes AFTER pointerup — stash the pressed instance for it
      this._linkReleasedPress = this._linkPressKey;
      this._linkPressKey = null;
      this._setLinkWash(this._linkHoverKey, linkWashHover());
    });
    this.on('click', (e) => {
      const f = this._linkHitFromEvent(e);
      const pressed = this._linkReleasedPress;
      this._linkReleasedPress = null;
      // press and release must land on fragments of the SAME link instance (the
      // Button press discipline); the plain click still bubbles regardless
      if (f && f.key === pressed) this.dispatch('linkclick', { id: f.id, text: f.text, x: e.x, y: e.y });
    });
  }

  _onLinkMove(e) {
    // the input layer deliberately delivers hover into disabled subtrees (tooltips on
    // disabled controls stay useful) — the link feedback channel must seal itself
    if (this.closest((n) => n.disabled === true)) { this._clearLinkHover(); return; }
    const f = this._linkHitFromEvent(e);
    // the last position that was actually over a link — _clearLinkHover has no live
    // event (leave/cancel/re-render), and the documented payload always carries x/y
    if (f) { this._linkHoverX = e.x; this._linkHoverY = e.y; }
    if ((f ? f.key : null) === this._linkHoverKey) return;
    if (this._linkHoverKey !== null) {
      this.dispatch('linkhover', { id: this._linkHoverId, text: this._linkHoverText, over: false, x: e.x, y: e.y });
    }
    this._linkHoverKey = f ? f.key : null;
    this._linkHoverId = f ? f.id : null;
    this._linkHoverText = f ? f.text : null;
    this._setLinkWash(this._linkHoverKey,
      this._linkPressKey !== null && this._linkPressKey === this._linkHoverKey ? linkWashPress() : linkWashHover());
    const eng = this.engine;
    if (eng) {
      // applyCursor only re-evaluates when the hover TARGET changes — an in-node
      // fragment crossing must set the canvas cursor directly (idempotent)
      if (f && !this._linkCursor) { eng.input.setCursor('pointer'); this._linkCursor = true; }
      else if (!f && this._linkCursor) { eng.input.setCursor(eng.defaultCursor); this._linkCursor = false; }
    }
    if (f) this.dispatch('linkhover', { id: f.id, text: f.text, over: true, x: e.x, y: e.y });
  }

  _clearLinkHover() {
    if (!this._linkWired) return;
    if (this._linkHoverKey !== null) {
      this.dispatch('linkhover', {
        id: this._linkHoverId, text: this._linkHoverText, over: false,
        x: this._linkHoverX, y: this._linkHoverY, // last known — the payload shape is total
      });
    }
    this._linkHoverKey = null;
    this._linkHoverId = null;
    this._linkHoverText = null;
    this._linkPressKey = null;
    this._linkReleasedPress = null;
    this._setLinkWash(null, 0);
    const eng = this.engine;
    if (this._linkCursor && eng) eng.input.setCursor(eng.defaultCursor);
    this._linkCursor = false;
  }

  // One wash quad per fragment of the lit instance (a link wrapped across two lines
  // lights two rects); the pool is retained hidden and caps at one instance's fragment
  // count. Washes are children, so they ride node-local coordinates and dispose with
  // the node; levels tween 0.1s (STYLE §4 — release is a tween, never a snap).
  _setLinkWash(key, level) {
    const frags = this._fragments;
    const eng = this.engine;
    let used = 0;
    if (key !== null && frags) {
      const adv = this._lineAdvance || this._fmHeight || 0;
      for (const f of frags) {
        if (f.key !== key) continue;
        let wash = this._linkWashes[used];
        if (!wash) {
          wash = new QuadNode({ color: COLORS.accent });
          wash.fxOpacity = 0;
          this.add(wash);
          this._linkWashes.push(wash);
        }
        wash.setRect(Math.round(f.x), Math.round(f.line * adv), Math.round(f.w), Math.round(Math.max(f.h, adv)));
        wash.visible = true;
        if (eng) eng.ticker.tween(wash, { fxOpacity: level }, { dur: 0.1 });
        else wash.fxOpacity = level;
        used++;
      }
    }
    for (let i = used; i < this._linkWashes.length; i++) {
      const wash = this._linkWashes[i];
      if (!wash.visible) continue;
      if (eng) eng.ticker.tween(wash, { fxOpacity: 0 }, { dur: 0.1, onDone: () => { wash.visible = false; } });
      else { wash.fxOpacity = 0; wash.visible = false; }
    }
  }

  // disposes its OWN per-node texture (the glyph raster) but NEVER the geometry: TextNode
  // rides the shared module-level `_unitQuad` (primitives.js), so disposing it here would
  // blank every quad and text node library-wide (the §2 text-blackout class).
  disposeSelf() { this._revealStop?.(false); this.material.dispose(); this.texture.dispose(); }
}

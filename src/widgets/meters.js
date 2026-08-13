// Meters & Measures: the small universal instruments every genre reads —
// SegmentedBar (armor pips, boss phases), ArcGauge (stamina rings, QTE timers),
// Badge/attachBadge (corner count chips), ResourceChip + ResourceBar (top-bar
// resources with delta flashes), BigTimer (mono countdown with urgency tiers and a
// `timeout` event), StarRating, and SegmentedControl (+ the SpeedControl preset).
// Every instrument speaks the uniform contract (setValue(v, {silent}), `change`
// events, setDisabled); everything is built from EXISTING art — the gauge paints its
// own canvas (the NodeGraph-underlay idiom) and disposes it.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { clamp } from '../layout.js';
import { commitChange, setNodeDisabled, requireEngine, widgetsEngine, uisound } from './widgets.js';
import { isReducedMotion } from '../animate.js';
import { str } from '../strings.js';

const frame = (n) => requireEngine().textures.frame(n);
const tex = (n) => requireEngine().textures.get(n);
const SHADOW = METRICS.textShadow; // X02: the shared token (was a per-file literal)

// ---------------- SegmentedBar ----------------
// Discrete fills: `value` counts FILLED SEGMENTS (the boundary segment fills
// fractionally), `max` defaults to `segments`. Per-segment tint via `tints[i]`.

export class SegmentedBar extends UINode {
  // opts: { segments = 5, value = 0, max = segments, width = 220, height = 18,
  //         tint = COLORS.accent, tints = null }
  constructor(opts = {}) {
    super({});
    this.segments = Number.isFinite(opts.segments) ? Math.max(1, Math.floor(opts.segments)) : 5;
    this.max = Number.isFinite(opts.max) ? Math.max(1e-9, opts.max) : this.segments;
    this.tint = opts.tint ?? COLORS.accent;
    this.tints = Array.isArray(opts.tints) ? opts.tints : null;
    this.bg = new NineSliceNode(frame('progress.bg'));
    this._cells = [];
    for (let i = 0; i < this.segments; i++) {
      const cell = new QuadNode({ color: this.tints?.[i] ?? this.tint, opacity: 0.9 });
      cell.auditAllow('containment'); // pips ride the channel under the lip (bar-art class)
      this._cells.push(cell);
    }
    this.frameTop = new NineSliceNode(frame('progress.frame'));
    // layered bar art (the ruling): bg is read as the composite's frame, so the
    // full-bleed top frame and the channel it guards are declared, never fitted
    this.bg.auditAllow('containment');
    this.frameTop.auditAllow('containment');
    this.add(this.bg, ...this._cells, this.frameTop);
    this.setSize(opts.width ?? 220, opts.height ?? 18);
    this.value = clamp(opts.value ?? 0, 0, this.max);
    this._displayValue = this.value;
  }

  // The uniform contract; `value` is in [0, max] and maps onto the segment lattice.
  // The NUMBER commits instantly; the DISPLAYED fill sweeps 0.3s to it (the
  // ProgressBar contract — STYLE §9's value tempo); `animate: false` snaps.
  setValue(v, { silent = true, animate = true } = {}) {
    const next = clamp(Number.isFinite(v) ? v : 0, 0, this.max);
    if (next === this.value) return;
    this.value = next;
    const eng = widgetsEngine();
    if (animate && this.engine && eng) {
      eng.ticker.tween(this, { _displayValue: next }, { dur: 0.3, onUpdate: () => this.invalidateLayout() });
    } else {
      // the ArcGauge pin: a direct write never preempts — cancel the in-flight
      // display tween or it resurrects the OLD target and the fill travels back
      if (eng) eng.ticker.cancelPropTween(this, '_displayValue');
      this._displayValue = next;
      this.invalidateLayout();
    }
    commitChange(this, 'change', { value: next }, silent, null);
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.frameTop.setRect(0, 0, this.w, this.h);
    const inner = this.w - 12;
    const gap = 2;
    const cellW = (inner - gap * (this.segments - 1)) / this.segments;
    const filled = (this._displayValue / this.max) * this.segments; // how many cells, fractionally
    for (let i = 0; i < this.segments; i++) {
      const cell = this._cells[i];
      const fill = clamp(filled - i, 0, 1); // this cell's own fraction
      const x = 6 + Math.round(i * (cellW + gap));
      cell.visible = fill > 0.02;
      if (cell.visible) cell.setRect(x, 6, Math.max(1, Math.round(cellW * fill)), this.h - 12);
    }
  }
}

// ---------------- ArcGauge ----------------
// A 270° stone ring whose sweep is the value; threshold colors pick by fraction
// (the HIGHEST threshold at or below the current fraction wins). The arc is the
// widget's OWN canvas raster (the NodeGraph-underlay idiom) — repainted on value
// motion, disposed with the widget. The displayed value tweens (STYLE §4).

const ARC_START = Math.PI * 0.75;       // 135° — the gap sits at the bottom
const ARC_SWEEP = Math.PI * 1.5;        // 270°

export class ArcGauge extends UINode {
  // opts: { value = 0, max = 100, radius = 34, thickness = 8, label = '',
  //         thresholds = [{ pct: 0, color: COLORS.negative }, { pct: 0.35, color: COLORS.quest },
  //                       { pct: 0.65, color: COLORS.accent }] }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this.max = Number.isFinite(opts.max) ? Math.max(1e-9, opts.max) : 100;
    this.radius = Number.isFinite(opts.radius) ? Math.max(12, opts.radius) : 34;
    this.thickness = Number.isFinite(opts.thickness) ? clamp(opts.thickness, 2, this.radius - 4) : 8;
    this.thresholds = Array.isArray(opts.thresholds) && opts.thresholds.length
      ? [...opts.thresholds].sort((a, b) => a.pct - b.pct)
      : [{ pct: 0, color: COLORS.negative }, { pct: 0.35, color: COLORS.quest }, { pct: 0.65, color: COLORS.accent }];
    const D = this.radius * 2;
    this._art = createCanvasTexture(D, D, texScale()); // rides the live bake density (2 at uiScale 1)
    this._quad = new QuadNode({ texture: this._art.texture });
    this.valueText = new TextNode('', {
      font: FONTS.mono, size: Math.max(11, Math.round(this.radius * 0.42)),
      // textBright, not text: the numeral sits on the gauge's OWN ring face, which
      // is lighter than the page (the census's lighter-surface class)
      color: COLORS.textBright, shadow: SHADOW,
    });
    this.labelText = new TextNode(opts.label ?? '', {
      size: 11, color: COLORS.textFaint, shadow: SHADOW,
    });
    this.add(this._quad, this.valueText, this.labelText);
    this.setSize(D, D + (opts.label ? 14 : 0));
    this.value = clamp(opts.value ?? 0, 0, this.max);
    this._displayValue = this.value;
    this._repaint();
  }

  _colorFor(frac) {
    let c = this.thresholds[0].color;
    for (const t of this.thresholds) if (frac >= t.pct) c = t.color;
    return c;
  }

  _repaint() {
    const { ctx, texture } = this._art;
    const D = this.radius * 2;
    const cx = this.radius, cy = this.radius;
    const r = this.radius - this.thickness / 2 - 1;
    ctx.clearRect(0, 0, D, D);
    ctx.lineCap = 'round';
    // the track ring
    ctx.strokeStyle = COLORS.stoneDark;
    ctx.lineWidth = this.thickness;
    ctx.beginPath();
    ctx.arc(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP);
    ctx.stroke();
    // the value sweep
    const frac = clamp(this._displayValue / this.max, 0, 1);
    if (frac > 0.001) {
      ctx.strokeStyle = this._colorFor(frac);
      ctx.lineWidth = this.thickness - 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP * frac);
      ctx.stroke();
    }
    texture.needsUpdate = true;
    this.valueText.setText(String(Math.round(this._displayValue)));
    this.invalidateLayout();
    this.engine?.requestRender();
  }

  // The uniform contract; the DISPLAYED sweep tweens to the committed value.
  setValue(v, { silent = true, animate = true } = {}) {
    const next = clamp(Number.isFinite(v) ? v : 0, 0, this.max);
    if (next === this.value) return;
    this.value = next;
    const eng = widgetsEngine();
    if (animate && eng) {
      eng.ticker.tween(this, { _displayValue: next }, { dur: 0.3, onUpdate: () => this._repaint() });
    } else {
      // a direct write never preempts (preemption fires only on another tween()) —
      // cancel the in-flight display tween or it resurrects the OLD target ~0.7s
      // later (snap to 0, then the needle travels back on its own). Per-prop cancel:
      // a blunt cancelTweensOf would also kill animate-preset tweens riding this node
      // and strand their promises (the settle law).
      if (eng) eng.ticker.cancelPropTween(this, '_displayValue');
      this._displayValue = next;
      this._repaint();
    }
    commitChange(this, 'change', { value: next }, silent, null);
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    const D = this.radius * 2;
    this._quad.setRect(0, 0, D, D);
    this.valueText.setPos(Math.round((D - this.valueText.w) / 2), Math.round(this.radius - this.valueText.h / 2));
    this.labelText.setPos(Math.round((D - this.labelText.w) / 2), D - 2);
  }

  disposeSelf() { this._art.texture.dispose(); } // the canvas texture is ours, not a child's
}

// ---------------- Badge / attachBadge ----------------
// A corner count chip. attachBadge(node, opts) hangs one off the host's top-right
// corner (a CHILD — it moves, hides, and dies with the host) and returns it.
// setCount(0) auto-hides; counts above 99 read "99+".

export class Badge extends UINode {
  // opts: { count = 0, color = COLORS.negative }
  constructor(opts = {}) {
    super({});
    this.fitExclude = true; // corner overhang must not inflate fitChildren hosts
    this.chip = new QuadNode({ color: opts.color ?? COLORS.negative, opacity: 0.95 });
    this.rim = new NineSliceNode(frame('field.normal'));
    this.text = new TextNode('', {
      font: FONTS.mono, size: 10, color: COLORS.textBright ?? COLORS.text, shadow: SHADOW,
    });
    // a 16px badge wears the rim as DECOR — its slice insets cannot describe a
    // content box at this size (8+8 ≥ 16); the chip fill and count are the face
    this.chip.auditAllow('containment');
    this.text.auditAllow('containment');
    this.add(this.chip, this.rim, this.text);
    // NaN seed: the changed-guard must never collide with a real input — count 0 with
    // a 0 seed short-circuited setCount(0), leaving the badge visible and unsized
    this.count = NaN;
    this.setCount(opts.count ?? 0);
  }

  setCount(n, { silent = true } = {}) {
    const next = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
    if (next === this.count) return;
    this.count = next;
    this.visible = next > 0; // auto-hide at zero
    this.text.setText(next > 99 ? '99+' : String(next));
    const w = Math.max(18, this.text.w + 10);
    this.setSize(w, 16);
    commitChange(this, 'change', { value: next }, silent, null);
  }

  onLayout() {
    this.chip.setRect(1, 1, this.w - 2, this.h - 2);
    this.rim.setRect(0, 0, this.w, this.h);
    this.text.setPos(Math.round((this.w - this.text.w) / 2), 2);
    // hang off the host's top-right corner when attached to one
    if (this.parent && this.parent.w > 0) this.setPos(this.parent.w - this.w + 6, -6);
  }
}

export function attachBadge(node, opts = {}) {
  const badge = new Badge(opts);
  node.add(badge);
  return badge;
}

// ---------------- ResourceChip / ResourceBar ----------------
// Icon + value/cap with a delta flash (gain pops positive, loss pops negative) and
// a steady warn tint at or below `warnAt`. The flash is PRESENTATION — it rides any
// value change; `silent` governs only the events (the uniform discipline).

export class ResourceChip extends UINode {
  // opts: { icon = 'book', value = 0, cap = null, warnAt = null, width = 96 }
  constructor(opts = {}) {
    super({});
    this.cap = Number.isFinite(opts.cap) ? opts.cap : null;
    this.warnAt = Number.isFinite(opts.warnAt) ? opts.warnAt : null;
    // art baked AT chip size — chip.frame is designed at 96×26,
    // and the icon rides a full-height, edge-justified, BORDERED plate instead of
    // straddling the old field rim
    this.bg = new NineSliceNode(frame('chip.frame'));
    this.plate = new QuadNode({ texture: tex('chip.plate') });
    // the plate DELIBERATELY rides the chip frame's edge (full-height, edge-justified
    // the requirement), so it sits outside the frame's content rect by design:
    // the window-plaque allowance precedent
    this.plate.auditAllow('containment');
    this.icon = new QuadNode({ texture: tex(`icon.${opts.icon ?? 'book'}`) });
    this.icon.auditAllow('containment'); // rides the plate, inside its border
    this.valueText = new TextNode('', { font: FONTS.mono, size: 13, color: COLORS.text, shadow: SHADOW });
    this.add(this.bg, this.plate, this.icon, this.valueText);
    this.setSize(opts.width ?? 96, 26);
    this.value = Number.isFinite(opts.value) ? opts.value : 0;
    this._paint();
  }

  _paint() {
    const capTxt = this.cap != null ? '/' + this.cap : '';
    this.valueText.setText(String(this.value) + capTxt);
    const warned = this.warnAt != null && this.value <= this.warnAt;
    this.valueText.setColor(warned ? COLORS.negative : COLORS.text);
    this.invalidateLayout();
  }

  setValue(v, { silent = true } = {}) {
    const next = Number.isFinite(v) ? (this.cap != null ? clamp(v, 0, this.cap) : v) : 0;
    if (next === this.value) return;
    const delta = next - this.value;
    this.value = next;
    this._paint();
    const eng = widgetsEngine();
    if (eng) {
      // the delta flash: color the change, pop the text, settle back to the paint
      const warned = this.warnAt != null && this.value <= this.warnAt;
      this.valueText.setColor(delta > 0 ? COLORS.positive : COLORS.negative);
      // reducedMotion: no pop (start at rest) — the tween still runs 1→1 so the
      // color-settle onDone below keeps its clock either way
      this.valueText.fxScale = isReducedMotion() ? 1 : 1.25;
      eng.ticker.tween(this.valueText, { fxScale: 1 }, {
        dur: 0.3,
        onDone: () => this.valueText.setColor(warned ? COLORS.negative : COLORS.text),
      });
    }
    commitChange(this, 'change', { value: next }, silent, null);
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.plate.setRect(0, 0, this.h, this.h); // full-height, flush to the left edge
    this.icon.setRect(3, 3, this.h - 6, this.h - 6);
    this.valueText.setPos(this.h + 6, Math.round((this.h - this.valueText.h) / 2));
  }
}

// A row of chips: ResourceBar({ chips: [chipOpts...], gap }) — `.chips` is the array.
export class ResourceBar extends UINode {
  constructor(opts = {}) {
    super({});
    this.gap = Number.isFinite(opts.gap) ? opts.gap : 8;
    this.chips = (opts.chips ?? []).map((c) => new ResourceChip(c));
    for (const c of this.chips) this.add(c);
    const w = this.chips.reduce((s, c) => s + c.w, 0) + this.gap * Math.max(0, this.chips.length - 1);
    this.setSize(Math.max(1, w), 26);
  }

  onLayout() {
    let x = 0;
    for (const c of this.chips) {
      c.setPos(Math.round(x), 0);
      x += c.w + this.gap;
    }
  }
}

// ---------------- BigTimer ----------------
// A mono countdown reading M:SS. Urgency is STATIC color tiers (STYLE §9 — nothing
// loops): text turns quest-gold at `warnAt` seconds and negative at `urgentAt`.
// Reaching zero stops the clock and dispatches `timeout {}` exactly once.

export class BigTimer extends UINode {
  // opts: { seconds = 60, warnAt = 30, urgentAt = 10, size = 28, running = false }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this.warnAt = Number.isFinite(opts.warnAt) ? opts.warnAt : 30;
    this.urgentAt = Number.isFinite(opts.urgentAt) ? opts.urgentAt : 10;
    this.text = new TextNode('', {
      font: FONTS.mono, size: Number.isFinite(opts.size) ? opts.size : 28,
      color: COLORS.text, shadow: SHADOW,
    });
    this.add(this.text);
    this.running = false;
    this._timedOut = false;
    // NaN seed: {seconds: 0} must still take the full setValue path — a 0 seed
    // short-circuited it, so the timer never painted "0:00" or sized itself
    this.value = NaN;
    this.setValue(Number.isFinite(opts.seconds) ? opts.seconds : 60);
    if (opts.running === true) this.start();
  }

  _paint() {
    const s = Math.max(0, this.value);
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    this.text.setText(`${m}:${String(ss).padStart(2, '0')}`);
    this.text.setColor(s <= this.urgentAt ? COLORS.negative : s <= this.warnAt ? COLORS.quest : COLORS.text);
    this.setSize(this.text.w, this.text.h);
  }

  // The uniform contract: `value` is the remaining seconds.
  setValue(v, { silent = true } = {}) {
    const next = Math.max(0, Number.isFinite(v) ? v : 0);
    if (next === this.value) return;
    this.value = next;
    if (next > 0) this._timedOut = false; // re-arming the clock re-arms the event
    this._paint();
    commitChange(this, 'change', { value: next }, silent, null);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.setFrameHook((dt) => {
      if (!this.running) return;
      const next = Math.max(0, this.value - dt);
      if (next !== this.value) {
        this.value = next;
        this._paint();
      }
      if (next === 0 && !this._timedOut) {
        this._timedOut = true;
        this.stop();
        this.dispatch('timeout', {});
      }
    });
  }

  stop() {
    this.running = false;
    this.setFrameHook(null);
  }

  setDisabled(v) { setNodeDisabled(this, v); }
}

// ---------------- StarRating ----------------
// Whole stars (halves are per the cut line). Click the k-th star to set k;
// clicking the current value clears to zero (the toggle idiom); Left/Right adjust
// from keyboard focus. The glyphs are text — zero assets, house shadow.

export class StarRating extends UINode {
  // opts: { value = 0, max = 5, onChange }
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.disabled = opts.disabled ?? false;
    this.max = Number.isFinite(opts.max) ? clamp(Math.floor(opts.max), 1, 10) : 5;
    this.onChange = opts.onChange ?? null;
    this._stars = [];
    for (let i = 0; i < this.max; i++) {
      const s = new TextNode('★', { size: 18, color: COLORS.textDisabled, shadow: SHADOW });
      this._stars.push(s);
      this.add(s);
    }
    this._hoverAt = -1;
    this.setSize(this.max * 22 + 4, 24);
    this.value = clamp(Math.floor(opts.value ?? 0), 0, this.max);
    this._paint();

    this.on('pointermove', (e) => {
      // C7 (X02): the ancestor seal gates hover ART too (hover delivers into
      // sealed subtrees); C7 (X05) RULING: the star preview VOICES per stop —
      // the SegmentedControl segment convention, throttled by the star change
      if (this.disabled || this.closest((n) => n.disabled === true)) return;
      // screen delta ÷ worldScale = LOCAL px (the wartable idiom)
      const at = clamp(Math.floor((e.x - this.worldX) / (this.worldScale || 1) / 22) + 1, 1, this.max);
      if (at !== this._hoverAt) {
        this._hoverAt = at;
        this._paint();
        uisound(this, 'hover');
      }
    });
    this.on('pointerleave', () => { this._hoverAt = -1; this._paint(); });
    this.on('click', (e) => {
      if (this.disabled || this.closest((n) => n.disabled === true)) { e.stopPropagation(); return; }
      const at = clamp(Math.floor((e.x - this.worldX) / (this.worldScale || 1) / 22) + 1, 1, this.max);
      this.setValue(at === this.value ? 0 : at, { silent: false });
    });
    this.on('keydown', (e) => {
      if (this.disabled) return;
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      this.setValue(clamp(this.value + d, 0, this.max), { silent: false });
    });
  }

  _paint() {
    for (let i = 0; i < this.max; i++) {
      const lit = this._hoverAt > 0 ? i < this._hoverAt : i < this.value;
      const preview = this._hoverAt > 0 && i < this._hoverAt && i >= this.value;
      this._stars[i].setColor(this.disabled ? COLORS.textDisabled
        : preview ? COLORS.quest : lit ? COLORS.accent : COLORS.textDisabled);
    }
  }

  setValue(v, { silent = true } = {}) {
    const next = clamp(Math.floor(Number.isFinite(v) ? v : 0), 0, this.max);
    if (next === this.value) return;
    this.value = next;
    this._paint();
    commitChange(this, 'change', { value: next }, silent, this.onChange);
  }

  setDisabled(v) {
    // dedicated disabled art (_paint recolors to textDisabled) — skip the generic
    // dim or the stars double-dim (the SegmentedControl sibling passes this too)
    setNodeDisabled(this, v, { dim: false });
    this._paint();
  }

  onLayout() {
    for (let i = 0; i < this.max; i++) this._stars[i].setPos(2 + i * 22, 2);
  }
}

// ---------------- SegmentedControl / SpeedControl ----------------
// Adjacent stone buttons, exactly one selected. Left/Right walk the options from
// keyboard focus; the value is the selected option's `value` (or the string itself).

export class SegmentedControl extends UINode {
  // opts: { options: [ 'a' | { label, value } ... ], value, width, onChange }
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.disabled = opts.disabled ?? false;
    this.onChange = opts.onChange ?? null;
    this.options = (opts.options ?? []).map((o) =>
      (typeof o === 'object' && o !== null) ? { label: String(o.label), value: o.value } : { label: String(o), value: o });
    this._segs = [];
    // B5: finite-first — Math.max(44, NaN) is NaN and every segment rect dies
    const segTotal = Number.isFinite(opts.width) ? opts.width : this.options.length * 56;
    const segW = Math.max(44, Math.floor(segTotal / Math.max(1, this.options.length)));
    this.options.forEach((opt, i) => {
      const seg = new UINode({ interactive: true });
      const bg = new NineSliceNode(frame('button.normal'));
      const label = new TextNode(opt.label, {
        font: FONTS.header, size: 13, smallCaps: true, letterSpacing: 1,
        color: COLORS.textMuted, shadow: SHADOW,
      });
      label.auditAllow('containment'); // the face-label ruling: centered on the slab
      // the SELECTED segment wears the pressed face at rest, so its hover and
      // press would vanish — the wash channel carries them (the checked-Toggle rule)
      const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      wash.auditAllow('overlap', 'containment'); // interaction-state art at the widget
      seg.add(bg, label, wash);
      seg._bg = bg; seg._label = label; seg._wash = wash; seg._hover = false; seg._pressed = false;
      seg.setRect(i * segW, 0, segW, 30);
      wash.setRect(0, 0, segW, 30);
      // C7 (X02/X05): hover ART and SOUND seal TOGETHER — hover delivers into
      // sealed subtrees, so the segment's own closest() gate covers both
      seg.on('pointerenter', () => {
        if (this.closest((n) => n.disabled === true)) return;
        seg._hover = true;
        this._paint();
        uisound(seg, 'hover');
      });
      seg.on('pointerleave', () => { seg._hover = false; seg._pressed = false; this._paint(); });
      seg.on('pointerdown', (e) => { if (this.disabled) { e.stopPropagation(); return; } seg._pressed = true; this._paint(); });
      seg.on('pointerup', (e) => { seg._pressed = false; if (e.canceled) seg._hover = false; this._paint(); }); // canceled ups end dark (B3)
      seg.on('click', (e) => {
        if (this.disabled) { e.stopPropagation(); return; }
        this.setValue(opt.value, { silent: false });
      });
      this._segs.push(seg);
      this.add(seg);
    });
    this.setSize(segW * Math.max(1, this.options.length), 30);
    this.value = undefined;
    const initial = opts.value !== undefined ? opts.value : this.options[0]?.value;
    if (initial !== undefined) this.setValue(initial); // silent initial selection
    this.on('keydown', (e) => {
      if (this.disabled) return;
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d || !this.options.length) return;
      e.preventDefault();
      const i = this.options.findIndex((o) => o.value === this.value);
      const next = this.options[clamp((i < 0 ? 0 : i) + d, 0, this.options.length - 1)];
      this.setValue(next.value, { silent: false });
    });
  }

  _paint() {
    for (let i = 0; i < this._segs.length; i++) {
      const seg = this._segs[i];
      const selected = this.options[i].value === this.value;
      const state = this.disabled ? 'disabled' : selected || seg._pressed ? 'pressed' : seg._hover ? 'hover' : 'normal';
      seg._bg.setFrame(frame(`button.${state}`));
      seg._label.setColor(this.disabled ? COLORS.textDisabled : selected ? COLORS.accent : COLORS.textMuted);
      // the wash speaks where the frame can't: hover/press on the selected face
      seg._wash.setBaseOpacity(this.disabled ? 0
        : (seg._pressed && selected) ? METRICS.washPress
        : (seg._hover && selected) ? METRICS.washHover : 0);
    }
    this.invalidateLayout();
  }

  // setValue by OPTION VALUE; unknown values no-op and return false (the Select idiom).
  setValue(v, { silent = true } = {}) {
    const opt = this.options.find((o) => o.value === v);
    if (!opt || this.value === v) return false;
    this.value = v;
    this._paint();
    commitChange(this, 'change', { value: v }, silent, this.onChange);
    return true;
  }

  setDisabled(v) {
    setNodeDisabled(this, v, { dim: false });
    this._paint();
  }

  onLayout() {
    const segW = Math.floor(this.w / Math.max(1, this._segs.length));
    this._segs.forEach((seg, i) => {
      seg.setRect(i * segW, 0, segW, this.h);
      seg._bg.setRect(0, 0, segW, this.h);
      const press = (seg._pressed || this.options[i].value === this.value) && !this.disabled ? 1 : 0;
      seg._label.setPos(Math.round((segW - seg._label.w) / 2), Math.round((this.h - 4 - seg._label.h) / 2) + press);
    });
  }
}

// The tempo preset every strategy/sim screen wants: pause / 1x / 2x / 3x.
export function SpeedControl(opts = {}) {
  return new SegmentedControl({
    options: [
      { label: str('speedPause'), value: 0 },
      { label: '1×', value: 1 },
      { label: '2×', value: 2 },
      { label: '3×', value: 3 },
    ],
    value: opts.value ?? 1,
    width: opts.width ?? 224,
    onChange: opts.onChange,
  });
}

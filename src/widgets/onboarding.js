// The Guiding Hand: the onboarding kit — any game can teach itself.
// Spotlight is a scrim with a LIVE hole: a rect or circle cutout that tracks a
// target node across layout, input inert outside and passing through inside. The
// seal is ONE mechanism — an overridden containsPoint that declines the cutout —
// and it covers pointer, Tab-walk, spatial nav, and gamepad-A alike, because focus
// traversal already refuses any node a pointer could not hit (the focus.js
// occlusion predicate). Coachmark is the stone callout: procedural arrow, viewport
// flip placement (the tooltip discipline), progress dots, Next/Skip. The
// TutorialSequencer runs declarative steps over both, advancing on click/change/
// manual/predicate, recovering when a step's target dies mid-lesson.
//
// Layering: the scrim lives on the OVERLAY layer, so windows and the taskbar seal
// beneath it while popups (which re-append themselves on _present) and the
// toast/tooltip layers stay above — a confirm asked mid-tutorial is fully live.
// Dropdowns and context menus normally mount on the dropdown layer UNDER overlay;
// while a spotlight is up they rise like they do under a modal (the
// engine.spotlightActive counter, read at the two mount sites).

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture } from '../texgen.js';
import { clamp } from '../layout.js';
import { requireEngine, uisound, Button, setNodeDisabled } from './widgets.js';
import { animateIn, animateOut, isReducedMotion } from '../animate.js';
import { str } from '../strings.js';

const frame = (n) => requireEngine().textures.frame(n);
const tex = (n) => requireEngine().textures.get(n);
const SHADOW = METRICS.textShadow; // X02: the shared token (was a per-file literal)

const RIM_PAD = 10;      // rim-glow margin the patch raster carries beyond the hole
const MORPH_DUR = 0.25;  // cutout morph between steps (jump cut under reducedMotion)

// ---------------- Spotlight ----------------
// A full-viewport scrim whose containsPoint declines the cutout: hits inside the
// hole fall through to the UI beneath, hits outside land here and go nowhere. The
// visual is four void bands meeting the cutout's bounding box plus a small raster
// patch that carries the accent rim (and, for circles, the corner fill) — the
// patch re-rasters only when the hole's SIZE changes.

export class Spotlight extends UINode {
  // opts: { opacity = 0.72, pad = 8 }
  constructor(opts = {}) {
    super({ interactive: true }); // scrim role: swallows presses beneath
    this.radialItems = () => false; // the dark offers no wheel — the radial chain stops at the scrim (the cutout still passes through)
    requireEngine();
    // finite-first (the NaN-phantom class): a NaN opacity paints nothing visibly
    // wrong until the scrim is invisible, and a NaN pad poisons every cutout rect
    this._opacity = Number.isFinite(opts.opacity) ? opts.opacity : 0.72;
    this._pad = Number.isFinite(opts.pad) ? opts.pad : 8;

    this._bands = [];
    for (let i = 0; i < 4; i++) {
      const b = new QuadNode({ color: COLORS.voidBlack, opacity: this._opacity });
      this._bands.push(b);
      this.add(b);
    }
    this._patch = new QuadNode({});
    this._patch.visible = false;
    this.add(this._patch);
    this._raster = null;
    this._patchKey = '';

    // Tweenable cutout state (custom props on the node itself, so a mid-flight
    // dispose cancels the morph through the normal cancelTweensOf path).
    this._hasCut = false;
    this._cutX = 0; this._cutY = 0; this._cutW = 0; this._cutH = 0;
    this._cutEndX = 0; this._cutEndY = 0; this._cutEndW = 0; this._cutEndH = 0;
    this._cutShape = 'rect';
    this._cutTween = null;
    this._target = null;
    this._targetPad = this._pad;
    this._offTargetDispose = null;

    this.on('wheel', (e) => e.stopPropagation()); // scrims consume the wheel too
    this.setFrameHook(() => this._track());
  }

  // The pass-through hole: outside the cutout this scrim owns the point (and by the
  // focus occlusion predicate, the keyboard/gamepad too); inside, hits fall through.
  containsPoint(px, py, pad = 0) {
    if (!super.containsPoint(px, py, pad)) return false;
    return !this._insideCutout(px, py);
  }

  _insideCutout(px, py) {
    if (!this._hasCut) return false;
    const x = this._cutX, y = this._cutY, w = this._cutW, h = this._cutH;
    if (this._cutShape === 'circle') {
      const r = Math.min(w, h) / 2, cx = x + w / 2, cy = y + h / 2;
      return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
    }
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  // The END-state cutout rect (mid-morph reads the destination, not the flight) —
  // what a Coachmark should aim at. Null with no cutout.
  get cutoutRect() {
    if (!this._hasCut) return null;
    return { x: this._cutEndX, y: this._cutEndY, w: this._cutEndW, h: this._cutEndH };
  }

  // Cut the hole around a live node and keep tracking it across layout. Null clears
  // the hole (a full scrim — the narration pose). The shape sticks until the next set.
  setTarget(node, { shape = 'rect', pad = this._pad, morph = true } = {}) {
    if (this._offTargetDispose) { this._offTargetDispose(); this._offTargetDispose = null; }
    this._target = node ?? null;
    this._targetPad = Number.isFinite(pad) ? pad : this._pad;
    this._cutShape = shape === 'circle' ? 'circle' : 'rect';
    if (!this._target) { this._clearCut(); return this; }
    this._offTargetDispose = node.on('dispose', () => {
      if (this._target === node) this.setTarget(null);
    });
    // Worlds are per-frame: a just-moved target still reads last frame's rect here;
    // the frame hook re-syncs on the next tick (the S29 worlds rule).
    this._applyCut(this._desiredFor(node), morph);
    return this;
  }

  // Direct-rect variant for targets that are not nodes (a world-space region).
  setCutout(rect, { shape = 'rect', morph = true } = {}) {
    if (this._offTargetDispose) { this._offTargetDispose(); this._offTargetDispose = null; }
    this._target = null;
    this._cutShape = shape === 'circle' ? 'circle' : 'rect';
    if (rect && ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) {
      // fail closed (the NaN-phantom rule): a poisoned rect must not become an
      // invisible pass-through hole nor a NaN-sized raster
      console.warn('LovecraftUI Spotlight: setCutout received a non-finite rect - clearing the cutout.');
      rect = null;
    }
    if (!rect) { this._clearCut(); return this; }
    this._applyCut({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, morph);
    return this;
  }

  _desiredFor(node) {
    const r = node.worldRect, p = this._targetPad;
    return { x: r.x0 - p, y: r.y0 - p, w: (r.x1 - r.x0) + 2 * p, h: (r.y1 - r.y0) + 2 * p };
  }

  _clearCut() {
    this._cancelMorph();
    this._hasCut = false;
    this._layoutCut();
  }

  _cancelMorph() {
    if (this._cutTween == null) return;
    const eng = this.engine ?? this._lastEngine;
    eng?.ticker.cancelTween(this._cutTween);
    this._cutTween = null;
  }

  _applyCut(d, morph) {
    if (this._cutShape === 'circle') {
      // circles cut a square: the bbox grows to the longer side around its center
      const s = Math.max(d.w, d.h);
      d = { x: d.x - (s - d.w) / 2, y: d.y - (s - d.h) / 2, w: s, h: s };
    }
    const had = this._hasCut;
    this._hasCut = true;
    this._cutEndX = d.x; this._cutEndY = d.y; this._cutEndW = d.w; this._cutEndH = d.h;
    const eng = this.engine;
    if (morph && had && eng && !isReducedMotion()) {
      this._cutTween = eng.ticker.tween(this,
        { _cutX: d.x, _cutY: d.y, _cutW: d.w, _cutH: d.h },
        { dur: MORPH_DUR, onUpdate: () => this._layoutCut() });
    } else {
      this._cancelMorph();
      this._cutX = d.x; this._cutY = d.y; this._cutW = d.w; this._cutH = d.h;
      this._layoutCut();
    }
  }

  // Follows layout: while the target lives, any drift between its padded rect and
  // the cutout's destination re-aims the hole (hard snap — morphs announce step
  // CHANGES; a dragged window mid-step just stays lit).
  _track() {
    const t = this._target;
    if (!t || t.disposed) return;
    const d = this._desiredFor(t);
    const s = this._cutShape === 'circle' ? Math.max(d.w, d.h) : 0;
    const dx = s ? d.x - (s - d.w) / 2 : d.x, dy = s ? d.y - (s - d.h) / 2 : d.y;
    const dw = s || d.w, dh = s || d.h;
    if (dx !== this._cutEndX || dy !== this._cutEndY || dw !== this._cutEndW || dh !== this._cutEndH) {
      this._applyCut(d, false);
    }
  }

  _layoutCut() {
    const W = this.w, H = this.h;
    const [top, left, right, bottom] = this._bands;
    if (!this._hasCut) {
      top.setRect(0, 0, W, H);
      left.setRect(0, 0, 0, 0);
      right.setRect(0, 0, 0, 0);
      bottom.setRect(0, 0, 0, 0);
      this._patch.visible = false;
      return;
    }
    const x0 = Math.round(clamp(this._cutX, 0, W)), y0 = Math.round(clamp(this._cutY, 0, H));
    const x1 = Math.round(clamp(this._cutX + this._cutW, 0, W)), y1 = Math.round(clamp(this._cutY + this._cutH, 0, H));
    top.setRect(0, 0, W, y0);
    left.setRect(0, y0, x0, y1 - y0);
    right.setRect(x1, y0, W - x1, y1 - y0);
    bottom.setRect(0, y1, W, H - y1);
    const cw = Math.max(2, x1 - x0), ch = Math.max(2, y1 - y0);
    this._patch.visible = true;
    this._patch.setRect(x0 - RIM_PAD, y0 - RIM_PAD, cw + 2 * RIM_PAD, ch + 2 * RIM_PAD);
    // The raster is keyed on the DESTINATION dims, not the in-flight ones: a size
    // morph rasters ONCE at its end size and the quad stretches the art during the
    // 0.25s flight (imperceptible; exact at landing) — per-tick canvas+texture
    // churn was the measured cost.
    const ew0 = Math.round(clamp(this._cutEndX, 0, W)), eh0 = Math.round(clamp(this._cutEndY, 0, H));
    const ew1 = Math.round(clamp(this._cutEndX + this._cutEndW, 0, W)), eh1 = Math.round(clamp(this._cutEndY + this._cutEndH, 0, H));
    const rw = Math.max(2, ew1 - ew0), rh = Math.max(2, eh1 - eh0);
    const key = `${rw}x${rh}:${this._cutShape}`;
    if (key !== this._patchKey) { this._patchKey = key; this._repaintPatch(rw, rh); }
  }

  // The rim raster: an accent ring on the hole's edge, plus (for circles) the
  // scrim-colored corners between the circle and its bbox — the bands stop at the
  // bbox, the patch finishes the shape. Re-rasters on size change only (a size
  // morph re-rasters per tick like ArcGauge; the canvas is cutout-sized, not
  // screen-sized).
  _repaintPatch(cw, ch) {
    const pw = cw + 2 * RIM_PAD, ph = ch + 2 * RIM_PAD;
    // Large cutouts (a spotlit window, a whole panel) drop to 1x raster scale: the
    // rim is a 1.5px stroke — at panel sizes the memory matters and the crispness
    // does not (a 2x full-screen patch would be ~16M pixels).
    const scale = pw * ph > 360000 ? 1 : 2;
    if (!this._raster || this._raster.texture.userData.cssW !== pw ||
        this._raster.texture.userData.cssH !== ph || this._raster.scale !== scale) {
      if (this._raster) this._raster.texture.dispose();
      this._raster = createCanvasTexture(pw, ph, scale);
      this._patch.setTexture(this._raster.texture);
    }
    const ctx = this._raster.ctx;
    ctx.clearRect(0, 0, pw, ph);
    if (this._cutShape === 'circle') {
      const r = Math.min(cw, ch) / 2, cx = RIM_PAD + cw / 2, cy = RIM_PAD + ch / 2;
      ctx.save();
      ctx.globalAlpha = this._opacity;
      ctx.fillStyle = COLORS.voidBlack;
      ctx.fillRect(RIM_PAD, RIM_PAD, cw, ch); // bbox only: the margin must not double-dim the bands
      ctx.restore();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = COLORS.voidBlack; // dest-out erases by alpha; any opaque token punches
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = COLORS.accentGlow; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = COLORS.accentGlow; ctx.shadowBlur = 6;
      ctx.strokeRect(RIM_PAD - 1, RIM_PAD - 1, cw + 2, ch + 2);
      ctx.shadowBlur = 0;
    }
    this._raster.texture.needsUpdate = true;
    (this.engine ?? this._lastEngine)?.requestRender();
  }

  onLayout() {
    if (this.engine) { this.w = this.engine.width; this.h = this.engine.height; } // the veil glue idiom
    this._layoutCut();
  }

  // The dropdown-rise mirror flag (menu.js and Select read it beside modalActive):
  // a counter, not a boolean — spotlights do not own each other's lifecycles.
  onEngine(engine, old) {
    if (old) old.spotlightActive = Math.max(0, (old.spotlightActive ?? 1) - 1);
    if (engine) {
      engine.spotlightActive = (engine.spotlightActive ?? 0) + 1;
      engine.requestRender();
    }
  }

  disposeSelf() {
    if (this._offTargetDispose) { this._offTargetDispose(); this._offTargetDispose = null; }
    if (this._raster) { this._raster.texture.dispose(); this._raster = null; }
  }
}

// ---------------- Coachmark ----------------
// The stone callout: title, wrapped body (markup opt-in), progress dots, and
// the Next/Skip pair. placeNear() prefers below the lit rect, flips above, then
// tries the sides, clamping to the viewport margins (the tooltip discipline); the
// procedural arrow rides the target-facing edge, aimed at the rect's center.

const COACH_GAP = 14;   // panel-to-cutout breathing room (the arrow lives in it)
const COACH_MARGIN = 10;
const ARROW = 16;
const BTN_H = 30;

export class Coachmark extends UINode {
  // opts: { title = '', text = '', markup = false, width = 280,
  //         step = 0, total = 0, showNext = true, showSkip = true, onNext, onSkip }
  constructor(opts = {}) {
    super({ interactive: true }); // its own surface: presses stop here, not the scrim below
    requireEngine();
    this._markup = opts.markup === true;
    this._width = opts.width ?? 280;
    this.onNext = opts.onNext ?? null;
    this.onSkip = opts.onSkip ?? null;

    this.bg = new NineSliceNode(frame('tooltip.frame'));
    // the coachmark deliberately rides OVER the Spotlight scrim (that is its job) and
    // its aimed arrow wedge hangs OUTSIDE the card toward the target — both declared
    this.auditAllow('overlap');
    this._arrow = new QuadNode({ texture: tex('tut.arrow.up') });
    this._arrow.auditAllow('containment');
    this._arrow.visible = false;
    this.nextBtn = new Button(str('tutorialNext'), {
      minWidth: 86, height: BTN_H,
      onClick: () => { this.dispatch('next', {}); if (this.onNext) this.onNext(); },
    });
    this.nextBtn.label.setColor(COLORS.accent);
    this.skipBtn = new Button(str('tutorialSkip'), {
      minWidth: 86, height: BTN_H,
      onClick: () => { this.dispatch('skip', {}); if (this.onSkip) this.onSkip(); },
    });
    this.add(this.bg, this._arrow, this.nextBtn, this.skipBtn);

    this._title = null; this._body = null; this._dots = null;
    this._btnY = 0; this._dotsY = 0;
    this.setContent({
      title: opts.title ?? '', text: opts.text ?? '',
      step: opts.step ?? 0, total: opts.total ?? 0,
      showNext: opts.showNext !== false,
      showSkip: opts.showSkip !== false,
    });
  }

  // Rebuild the text content (the tooltip _build model: dispose and re-measure).
  // nextLabel swaps the Next caption (the last lesson says Finish).
  setContent({ title = '', text = '', step = 0, total = 0, showNext = true, showSkip = true, nextLabel = null } = {}) {
    if (this._title) { this._title.dispose(); this._title = null; }
    if (this._body) { this._body.dispose(); this._body = null; }
    if (this._dots) { this._dots.dispose(); this._dots = null; }
    const w = this._width, maxW = w - 28;
    let y = 12;
    if (title) {
      this._title = new TextNode(title, {
        font: FONTS.header, size: 14, weight: 'bold', smallCaps: true, letterSpacing: 1,
        color: COLORS.accent, maxWidth: maxW, multiline: true, shadow: SHADOW,
      });
      this._title.setPos(14, y);
      this.add(this._title);
      y += this._title.h + 6;
    }
    if (text) {
      this._body = new TextNode(text, {
        size: 12, color: COLORS.textMuted, multiline: true, maxWidth: maxW, markup: this._markup,
      });
      this._body.setPos(14, y);
      this.add(this._body);
      y += this._body.h + 10;
    }
    if (total > 1) {
      // B5: Array.from({length: Infinity}) throws RangeError — floor and cap the dots
      const dotCount = Math.min(64, Math.floor(Number.isFinite(total) ? total : 0));
      const marks = Array.from({ length: dotCount }, (_, i) => (i <= step ? '●' : '○')).join(' ');
      this._dots = new TextNode(marks, { size: 10, color: COLORS.accent, letterSpacing: 1 });
      this._dotsY = y;
      this.add(this._dots);
      y += this._dots.h + 8;
    }
    this.nextBtn.visible = showNext !== false;
    this.skipBtn.visible = showSkip !== false;
    this.nextBtn.setText(nextLabel ?? str('tutorialNext')); // Button.setText re-sizes; onLayout right-aligns from the new width
    this._btnY = y;
    y += BTN_H + 12;
    this.setSize(w, y);
    this.invalidateLayout();
  }

  // Place beside `rect` (engine coords — a Spotlight's cutoutRect). Preference
  // order below/above/right/left, clamped to the margins; a rect that owns the
  // whole viewport centers the panel over it.
  placeNear(rect) {
    // a null/poisoned rect (a cleared cutout, NaN worlds) falls back to the
    // narration pose instead of throwing or parking at the margin clamp
    if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return this.placeCentered();
    const eng = requireEngine();
    const W = eng.width, H = eng.height, M = COACH_MARGIN;
    const w = this.w, h = this.h;
    let side = null, x = W / 2 - w / 2, y = H / 2 - h / 2;
    if (rect.y + rect.h + COACH_GAP + h <= H - M) {
      side = 'below'; y = rect.y + rect.h + COACH_GAP; x = rect.x + rect.w / 2 - w / 2;
    } else if (rect.y - COACH_GAP - h >= M) {
      side = 'above'; y = rect.y - COACH_GAP - h; x = rect.x + rect.w / 2 - w / 2;
    } else if (rect.x + rect.w + COACH_GAP + w <= W - M) {
      side = 'right'; x = rect.x + rect.w + COACH_GAP; y = rect.y + rect.h / 2 - h / 2;
    } else if (rect.x - COACH_GAP - w >= M) {
      side = 'left'; x = rect.x - COACH_GAP - w; y = rect.y + rect.h / 2 - h / 2;
    }
    this.setPos(Math.round(clamp(x, M, Math.max(M, W - w - M))), Math.round(clamp(y, M, Math.max(M, H - h - M))));
    this._aimArrow(side, rect);
    return this;
  }

  placeCentered() {
    const eng = requireEngine();
    this.setPos(Math.round((eng.width - this.w) / 2), Math.round((eng.height - this.h) / 2));
    this._aimArrow(null, null);
    return this;
  }

  _aimArrow(side, rect) {
    if (!side) { this._arrow.visible = false; return; }
    this._arrow.visible = true;
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    if (side === 'below' || side === 'above') {
      const ax = clamp(cx - this.x - ARROW / 2, 8, this.w - 8 - ARROW);
      this._arrow.setTexture(tex(side === 'below' ? 'tut.arrow.up' : 'tut.arrow.down'));
      this._arrow.setRect(Math.round(ax), side === 'below' ? -12 : this.h - 4, ARROW, ARROW);
    } else {
      const ay = clamp(cy - this.y - ARROW / 2, 8, this.h - 8 - ARROW);
      this._arrow.setTexture(tex(side === 'right' ? 'tut.arrow.left' : 'tut.arrow.right'));
      this._arrow.setRect(side === 'right' ? -12 : this.w - 4, Math.round(ay), ARROW, ARROW);
    }
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.skipBtn.setPos(14, this._btnY);
    this.nextBtn.setPos(this.w - 14 - this.nextBtn.w, this._btnY);
    if (this._dots) this._dots.setPos(Math.round((this.w - this._dots.w) / 2), this._dotsY);
  }
}

// ---------------- TutorialSequencer ----------------
// Declarative steps over one Spotlight + one Coachmark:
//   { target: node | () => node | null,   // null = narration (full scrim, centered card)
//     title, text,                        // the lesson
//     advance: 'click' | 'change' | 'manual' | fn,  // fn(step, target) polled per frame
//     shape: 'rect' | 'circle', pad }     // cutout options
// A step whose target resolves dead is skipped; a target dying MID-step advances
// (the recover rule). Escape aborts (opt out with escapeAborts: false); Skip always
// aborts; dispose() mid-sequence is silent teardown — no scrim, no events.

export class TutorialSequencer extends UINode {
  // opts: { steps = [], opacity, pad = 8, markup = false, escapeAborts = true,
  //         onStep(index, step), onDone(completed) }
  constructor(opts = {}) {
    super();
    requireEngine();
    this.steps = opts.steps ?? [];
    this.onStep = opts.onStep ?? null;
    this.onDone = opts.onDone ?? null;
    this._escapeAborts = opts.escapeAborts !== false;
    this.spotlight = new Spotlight({ opacity: opts.opacity, pad: opts.pad });
    this.coach = new Coachmark({ markup: opts.markup });
    this.coach.visible = false;
    this.coach.on('next', () => this.next());
    this.coach.on('skip', () => this.abort());
    this.add(this.spotlight, this.coach);
    this.index = -1;
    this.running = false;
    this.done = false;
    this._offs = [];
    this._offEscape = null;
    // dispose safety mid-sequence: step wiring and the escape entry must release
    // even on a direct dispose() (no done event on that path — abort() is the loud one)
    this.on('dispose', () => {
      this._unwire();
      if (this._offEscape) { this._offEscape(); this._offEscape = null; }
      this.running = false;
      this.done = true;
    });
  }

  start() {
    if (this.running || this.done || this.disposed) return this;
    const eng = requireEngine();
    if (!this.steps.length) {
      console.warn('LovecraftUI: TutorialSequencer.start() with no steps - nothing to teach.');
      return this;
    }
    this.running = true;
    eng.layers.overlay.add(this);
    if (this._escapeAborts) this._offEscape = eng.focus.pushEscape(() => this.abort());
    uisound(this, 'open', { tutorial: true });
    animateIn(this, 'fadeScale'); // settles by contract; deliberately unawaited
    this._mount(0);
    return this;
  }

  // Manual advance — the Next button's path, also public for game-driven steps.
  next() {
    if (!this.running || this.done) return;
    this._advance();
  }

  abort() { this._finish(false); }

  _advance() {
    this._unwire();
    this._mount(this.index + 1);
  }

  _mount(i) {
    const eng = requireEngine();
    let step = null, target = null;
    while (i < this.steps.length) {
      step = this.steps[i];
      const raw = step.target;
      if (raw == null) { target = null; break; }               // narration step
      target = typeof raw === 'function' ? (raw() ?? null) : raw;
      if (target && !target.disposed) break;                    // a live lesson
      i++;                                                      // dead target: recover forward
    }
    if (i >= this.steps.length) { this._finish(true); return; }
    this.index = i;
    const mode = typeof step.advance === 'function' ? 'fn' : (step.advance ?? 'manual');

    if (target) this.spotlight.setTarget(target, { shape: step.shape, pad: step.pad });
    else this.spotlight.setTarget(null);

    if (target) {
      this._offs.push(target.on('dispose', () => this._advance())); // recover mid-step
      if (mode === 'click') this._offs.push(target.on('click', () => this._advance()));
      else if (mode === 'change') this._offs.push(target.on('change', () => this._advance()));
    }
    if (mode === 'fn') {
      const fn = step.advance;
      this.setFrameHook(() => { if (this.running && fn(step, target)) this._advance(); });
    }

    const last = i === this.steps.length - 1;
    this.coach.setContent({
      title: step.title ?? '', text: step.text ?? '',
      step: i, total: this.steps.length,
      showNext: mode === 'manual',
      nextLabel: last ? str('tutorialDone') : str('tutorialNext'),
    });
    const cut = this.spotlight.cutoutRect;
    if (cut) this.coach.placeNear(cut);
    else this.coach.placeCentered();
    animateIn(this.coach, 'rise');
    // focus follows the lesson: act-steps focus the target (Enter/A is the gamepad
    // path through the hole), read-steps focus the Next button
    eng.focus.set(mode === 'manual' || !target ? this.coach.nextBtn : target, 'api');
    // The RESOLVED lesson target rides as `stepTarget`, never `target`: the event
    // plane owns that name (UINode.dispatch stamps the emitting node over any
 // payload `target`, node.js:218 - the law). This payload used to carry
    // `target` and it was silently replaced by the sequencer itself, so the field
    // documented in API.md and the d.ts had never once been deliverable. Consumers
    // want the resolved node, because `step.target` may be a function.
    this.dispatch('stepchange', { index: i, step, stepTarget: target });
    if (this.onStep) this.onStep(i, step);
  }

  _unwire() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.setFrameHook(null);
  }

  _finish(completed) {
    if (this.done || this.disposed) return;
    this.done = true;
    this.running = false;
    this._unwire();
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    // the fading scrim must not swallow the user's next click (the popup rule)
    this.spotlight.interactive = false;
    uisound(this, 'close', { tutorial: true });
    this.dispatch('done', { completed, step: this.index });
    if (this.onDone) this.onDone(completed);
    animateOut(this, 'fadeScale').then(() => { if (!this.disposed) this.dispose(); });
  }

  onLayout() {
    if (this.engine) { this.w = this.engine.width; this.h = this.engine.height; }
    // re-place the callout on viewport/layout drift; same inputs settle (setRect
    // no-ops). NOT while an animate preset is flying it (__anim is animate.js's
    // pending record): the card enters via `rise`, and a layout pass mid-flight
    // would snap its y to the destination for a frame.
    if (this.running && this.coach.visible && !this.coach.__anim) {
      const cut = this.spotlight.cutoutRect;
      if (cut) this.coach.placeNear(cut);
      else this.coach.placeCentered();
    }
  }

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

// The Whispering Stage: the narrative/horror kit. LetterboxBars (cinematic-
// layer bars that engage EldNotify do-not-disturb), TypewriterText (the TextNode
// reveal seam wearing the 'type' voice), ChoiceList (a MenuList that commits a
// `choice` and can carry an ArcGauge countdown), Journal + DocumentViewer (the
// parchment family — own-raster painters, zero atlas cost, the ArcGauge recipe),
// SubtitleBar (speaker-colored one-liner, safe-area aware; the queue fell per the
// cut line), and SanityFX (vignette pulse + render-only node tremor riding the
// fxOffset seam; level 0 restores everything exactly).

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { isReducedMotion } from '../animate.js';
import { str } from '../strings.js';
import { commitChange, requireEngine, widgetsEngine, uisound, Button } from './widgets.js';
import { MenuList } from './metascreens.js';
import { ArcGauge } from './meters.js';
import { EldNotify } from './notify.js';

const SHADOW = METRICS.textShadow;

// Deterministic pseudo-random for procedural grain: frozen snapshots demand
// bit-stable pixels, so no painter here ever touches Math.random.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------- the parchment painter ----------------
// Aged paper composed purely from theme tokens (no new color literals):
// a bone base, ink speckle grain, ink edge-burn bands, and a ruled ink border.
function paintParchment(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.bone;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(0, 0, w, h);
  const rnd = seededRng(0x1a25);
  ctx.fillStyle = COLORS.inkParchment;
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 140; i++) {
    const gw = 1 + rnd() * 2.5;
    ctx.fillRect(rnd() * w, rnd() * h, gw, gw * (0.4 + rnd()));
  }
  // edge burn: a FEATHERED stack of thin ink bands per side (alpha does the
  // gradient — no rgba literals), capped BELOW every content inset (title 18,
  // buttons 20, body 24). The re-cut: the old three hard bands ran 26px
  // deep in three visible steps UNDER the text and the page buttons — the
  // reported "weird transparent black border". Verticals run BETWEEN their
  // horizontals, so the corners never double-darken to twice the depth.
  const edge = Math.max(4, Math.min(12, Math.min(w, h) / 5));
  const BURN_BANDS = 6;
  for (let i = 0; i < BURN_BANDS; i++) {
    const d = Math.round(edge * (1 - i / BURN_BANDS));
    ctx.globalAlpha = 0.05 - i * 0.006;
    ctx.fillRect(0, 0, w, d);
    ctx.fillRect(0, h - d, w, d);
    ctx.fillRect(0, d, d, h - d * 2);
    ctx.fillRect(w - d, d, d, h - d * 2);
  }
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = COLORS.inkParchment;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(6.5, 6.5, w - 13, h - 13);
  ctx.globalAlpha = 1;
}

// ---------------- LetterboxBars ----------------
// Two void-black bars growing in from the frame's edges on the cinematic layer
// (above tooltips, below the vignette). show() engages EldNotify do-not-disturb
// (new sends route to the log; the previous flag value is restored when hide()
// COMPLETES, so an interrupted hide keeps the scene quiet). Mounts itself — the
// cinematic layer is engine chrome a consumer should not need to know about.

export class LetterboxBars extends UINode {
  // opts: { coverage = 0.12 (each bar, fraction of engine height), dur = 0.35, dnd = true }
  constructor(opts = {}) {
    super({});
    const eng = requireEngine();
    const cov = Number(opts.coverage);
    this.coverage = Number.isFinite(cov) ? Math.min(0.4, Math.max(0.02, cov)) : 0.12;
    this.dur = Number.isFinite(opts.dur) ? Math.max(0, opts.dur) : 0.35;
    this.dnd = opts.dnd !== false;
    this.shown = false;
    this._progress = 0; // 0 hidden .. 1 shown; render fraction only
    this._dndPrev = null;
    this.top = new QuadNode({ color: COLORS.voidBlack });
    this.bottom = new QuadNode({ color: COLORS.voidBlack });
    this.add(this.top, this.bottom);
    eng.layers.cinematic.add(this);
  }

  onLayout() {
    if (this.engine) { this.w = this.engine.width; this.h = this.engine.height; } // the veil glue idiom
    this._layoutBars();
  }

  _layoutBars() {
    const barH = Math.round(this.h * this.coverage * this._progress);
    this.top.setRect(0, 0, this.w, barH);
    this.bottom.setRect(0, this.h - barH, this.w, barH);
    this.engine?.requestRender();
  }

  show({ silent } = {}) {
    if (this.shown) return this;
    this.shown = true;
    if (this.dnd && this._dndPrev === null) {
      this._dndPrev = EldNotify.doNotDisturb;
      EldNotify.doNotDisturb = true;
    }
    this._slide(1);
    if (!silent) {
      uisound(this, 'open'); // the cinema voice, not a value-commit click
      this.dispatch('change', { value: true });
    }
    return this;
  }

  hide({ silent } = {}) {
    if (!this.shown) return this;
    this.shown = false;
    this._slide(0, () => {
      // DND restores only when the bars have fully left — an interrupted hide
      // (show() mid-slide cancels this tween) keeps the scene quiet
      if (this._dndPrev !== null) {
        EldNotify.doNotDisturb = this._dndPrev;
        this._dndPrev = null;
      }
    });
    if (!silent) {
      uisound(this, 'close');
      this.dispatch('change', { value: false });
    }
    return this;
  }

  _slide(target, onDone) {
    const eng = widgetsEngine();
    if (!eng || isReducedMotion() || this.dur === 0) {
      this._progress = target;
      this._layoutBars();
      onDone?.();
      return;
    }
    eng.ticker.cancelPropTween(this, '_progress'); // surgical: preset promises elsewhere survive
    eng.ticker.tween(this, { _progress: target }, {
      dur: this.dur,
      onUpdate: () => this._layoutBars(),
      onDone,
    });
  }

  disposeSelf() {
    // a disposed letterbox must never strand the notification stream muted
    if (this._dndPrev !== null) {
      EldNotify.doNotDisturb = this._dndPrev;
      this._dndPrev = null;
    }
    widgetsEngine()?.ticker.cancelPropTween(this, '_progress');
  }
}

// ---------------- TypewriterText ----------------
// The standalone scene voice of the TextNode reveal seam (text.js): reveal()
// narrates `uisound 'type'` once per revealed batch and honors reducedMotion by
// landing the text instantly (the promise still resolves).

export class TypewriterText extends TextNode {
  reveal(cps = 30, opts = {}) {
    const p = super.reveal(cps, {
      ...opts,
      onChar: (added, shown, total) => {
        uisound(this, 'type');
        opts.onChar?.(added, shown, total);
      },
    });
    if (isReducedMotion()) this.skip(); // the no-motion law
    return p;
  }
}

// ---------------- ChoiceList ----------------
// A MenuList that commits: picking a row (pointer, Enter, gamepad-A) fires the
// uniform `choice` commit {index, id, choice, timeout:false}; an optional countdown
// (opts.timer, seconds) expires into {index:-1, timeout:true}. The ArcGauge ring is
// created but NOT auto-mounted — a VBox would stretch it into its column; the page
// places `list.timerRing` beside the list. A sealed (disabled) list holds its clock.

export class ChoiceList extends MenuList {
  // opts: { choices: [{id, text, disabled, reason, hidden}], width = 360, timer, onChoice }
  // A disabled choice with a `reason` explains itself on hover; setChoiceEnabled(id)
  // unlocks it by play (the MenuList contract, threaded through).
  constructor(opts = {}) {
    const choices = (opts.choices ?? []).filter((c) => c && !c.hidden);
    super({
      width: opts.width ?? 360,
      items: choices.map((c) => ({ id: c.id, label: c.text ?? '', disabled: !!c.disabled, reason: c.reason })),
    });
    this.choices = choices;
    this.onChoice = opts.onChoice ?? null;
    this.timerRing = null;
    this._remaining = 0;
    const t = Number(opts.timer);
    if (Number.isFinite(t) && t > 0) {
      this._remaining = t;
      this.timerRing = new ArcGauge({ value: t, max: t, radius: 16, thickness: 4 });
      this.setFrameHook((dt) => {
        if (this.closest((n) => n.disabled === true)) return; // sealed: the clock holds
        this._remaining -= dt;
        this.timerRing.setValue(Math.max(0, this._remaining), { silent: true, animate: false });
        if (this._remaining <= 0) {
          this._stopTimer();
          commitChange(this, 'choice',
            { value: -1, index: -1, id: null, choice: null, timeout: true }, false, this.onChoice);
        }
      });
    }
  }

  _stopTimer() { this.setFrameHook(null); }

  // The narrative-flavored alias: unlock (or re-lock) a choice by its id.
  setChoiceEnabled(id, enabled = true) { return this.setItemEnabled(id, enabled); }

  _select() {
    const item = this.items[this.index];
    if (!item || item.disabled) return;
    this._stopTimer();
    uisound(this._rows[this.index], 'click'); // the MenuList pick voice
    const c = this.choices[this.index];
    commitChange(this, 'choice',
      { value: this.index, index: this.index, id: c?.id ?? null, choice: c ?? null, timeout: false },
      false, this.onChoice);
  }

  disposeSelf() {
    this._stopTimer();
    if (this.timerRing && !this.timerRing.parent) this.timerRing.dispose(); // never mounted: ours to free
    super.disposeSelf?.();
  }
}

// ---------------- Journal ----------------
// The parchment book: one entry per page, rich-text body, prev/next navigation,
// an unread chip, addEntry/markRead. Own-raster parchment (zero atlas cost).

export class Journal extends UINode {
  // opts: { width = 440, height = 320, title, entries: [{id, title, body, read}], onChange }
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    const w = Number.isFinite(opts.width) ? Math.max(220, opts.width) : 440;
    const h = Number.isFinite(opts.height) ? Math.max(160, opts.height) : 320;
    this._art = createCanvasTexture(w, h, texScale());
    paintParchment(this._art.ctx, w, h);
    this._art.texture.needsUpdate = true;
    this._quad = new QuadNode({ texture: this._art.texture });
    this.add(this._quad);
    this.entries = (opts.entries ?? []).map((e) => ({ ...e, read: !!e.read }));
    this._page = 0;
    this.onChange = opts.onChange ?? null;
    this._titleFallback = opts.title ?? str('journalTitle');

    this.titleText = new TextNode(this._titleFallback, {
      font: FONTS.header, size: 17, smallCaps: true, letterSpacing: 2,
      color: COLORS.inkParchment, maxWidth: w - 110, ellipsis: true,
    });
    this.newChip = new TextNode(str('journalNew'), {
      font: FONTS.header, size: 11, smallCaps: true, letterSpacing: 1, color: COLORS.accent, shadow: SHADOW,
    });
    this.bodyText = new TextNode('', {
      size: 13, color: COLORS.inkParchment, multiline: true, markup: true,
      maxWidth: w - 48, fixedW: w - 48, lineHeight: 19,
    });
    this.prevBtn = new Button('‹', { minWidth: 34, onClick: () => this.setPage(this._page - 1) });
    this.nextBtn = new Button('›', { minWidth: 34, onClick: () => this.setPage(this._page + 1) });
    this.pageText = new TextNode('', { size: 12, color: COLORS.inkParchment });
    this.add(this.titleText, this.newChip, this.bodyText, this.prevBtn, this.nextBtn, this.pageText);
    this.setSize(w, h);
    this._renderPage();
  }

  onLayout() {
    this._quad.setRect(0, 0, this.w, this.h);
    this.titleText.setPos(24, 18);
    this.newChip.setPos(this.w - 24 - this.newChip.w, 21);
    this.bodyText.setPos(24, 24 + this.titleText.h + 8);
    const navY = this.h - 18 - this.prevBtn.h;
    this.prevBtn.setPos(20, navY);
    this.nextBtn.setPos(this.w - 20 - this.nextBtn.w, navY);
    this.pageText.setPos(Math.round((this.w - this.pageText.w) / 2),
      navY + Math.round((this.prevBtn.h - this.pageText.h) / 2));
  }

  addEntry(entry, { silent } = {}) {
    this.entries.push({ ...entry, read: !!entry?.read });
    this._page = this.entries.length - 1; // a fresh entry opens itself
    this._renderPage();
    commitChange(this, 'change',
      { value: this.entries.length, action: 'add', id: entry?.id ?? null }, silent, this.onChange);
    return this;
  }

  markRead(id, { silent } = {}) {
    const e = this.entries.find((x) => x.id === id);
    if (!e || e.read) return this;
    e.read = true;
    this._renderPage();
    commitChange(this, 'change', { value: id, action: 'read', id }, silent, this.onChange);
    return this;
  }

  // Page turns dispatch directly: the nav Buttons already carry the click voice,
  // and a second commit-click per turn would double the gesture's sound.
  setPage(i) {
    const max = this.entries.length - 1;
    const next = Math.min(Math.max(0, i), Math.max(0, max));
    if (next === this._page) return this;
    this._page = next;
    this._renderPage();
    this.dispatch('change', { value: next, action: 'page' });
    return this;
  }

  _renderPage() {
    const n = this.entries.length;
    const e = this.entries[this._page];
    if (!e) {
      this.titleText.setText(this._titleFallback);
      this.bodyText.setText(str('journalEmpty'));
      this.newChip.visible = false;
    } else {
      this.titleText.setText(e.title ?? this._titleFallback);
      this.bodyText.setText(e.body ?? '');
      this.newChip.visible = !e.read;
    }
    this.pageText.setText(n ? `${this._page + 1}/${n}` : '0/0');
    this.prevBtn.setDisabled(this._page <= 0);
    this.nextBtn.setDisabled(this._page >= n - 1);
    this.invalidateLayout();
  }

  disposeSelf() { this._art.texture.dispose(); }
}

// ---------------- DocumentViewer ----------------
// A single found document on the same parchment: title + rich-text body,
// swapped wholesale via setDocument.

export class DocumentViewer extends UINode {
  // opts: { width = 460, height = 340, title, text, onChange }
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    const w = Number.isFinite(opts.width) ? Math.max(220, opts.width) : 460;
    const h = Number.isFinite(opts.height) ? Math.max(160, opts.height) : 340;
    this._art = createCanvasTexture(w, h, texScale());
    paintParchment(this._art.ctx, w, h);
    this._art.texture.needsUpdate = true;
    this._quad = new QuadNode({ texture: this._art.texture });
    this.add(this._quad);
    this.onChange = opts.onChange ?? null;
    this.titleText = new TextNode(opts.title ?? str('docTitle'), {
      font: FONTS.header, size: 17, smallCaps: true, letterSpacing: 2,
      color: COLORS.inkParchment, maxWidth: w - 48, ellipsis: true,
    });
    this.bodyText = new TextNode(opts.text ?? '', {
      size: 13, color: COLORS.inkParchment, multiline: true, markup: true,
      maxWidth: w - 48, fixedW: w - 48, lineHeight: 19,
    });
    this.add(this.titleText, this.bodyText);
    this.setSize(w, h);
  }

  onLayout() {
    this._quad.setRect(0, 0, this.w, this.h);
    this.titleText.setPos(24, 18);
    this.bodyText.setPos(24, 24 + this.titleText.h + 8);
  }

  // silent by default (the uniform contract; the bare
 // `{ silent }` destructure defaulted undefined → falsy → LOUD, undeclared)
  setDocument({ title, text } = {}, { silent = true } = {}) {
    if (title !== undefined) this.titleText.setText(title ?? str('docTitle'));
    if (text !== undefined) this.bodyText.setText(text ?? '');
    this.invalidateLayout();
    commitChange(this, 'change', { value: title ?? null, action: 'document' }, silent, this.onChange);
    return this;
  }

  disposeSelf() { this._art.texture.dispose(); }
}

// ---------------- SubtitleBar ----------------
// One speaker-colored line near the bottom safe area; a new say() supersedes the
// last (its promise settles). The queue fell per the cut line. Mounts itself on
// the overlay (say() is show-like — the TitleCard convention).

export class SubtitleBar extends UINode {
  // opts: { width = 560, safeBottom = 48 }
  constructor(opts = {}) {
    super({});
    const eng = requireEngine();
    this.lineWidth = Number.isFinite(opts.width) ? Math.max(200, opts.width) : 560;
    this.safeBottom = Number.isFinite(opts.safeBottom) ? Math.max(0, opts.safeBottom) : 48;
    this.textNode = new TextNode('', {
      size: 14, align: 'center', color: COLORS.text, shadow: SHADOW,
      fixedW: this.lineWidth, maxWidth: this.lineWidth, multiline: true,
    });
    this.add(this.textNode);
    this.setSize(this.lineWidth, 0);
    this._resolve = null;
    eng.layers.overlay.add(this);
  }

  onLayout() {
    const E = this.engine;
    if (!E) return;
    this.setPos(Math.round((E.width - this.w) / 2),
      Math.round(E.height - this.safeBottom - this.h));
  }

  // spec: { speaker = '', text, color (speaker tint), duration = 3 } → promise that
  // resolves when the line clears (timeout, supersession, clear(), or dispose).
  say({ speaker = '', text = '', color, duration = 3 } = {}) {
    this._settle();
    const segs = speaker
      ? [{ text: `${speaker}: `, color: color ?? COLORS.accent }, { text, color: COLORS.text }]
      : [{ text, color: COLORS.text }];
    this.textNode.setSegments(segs);
    this.setSize(this.lineWidth, this.textNode.h);
    this.invalidateLayout();
    const dur = Number.isFinite(duration) ? Math.max(0.5, duration) : 3;
    let remaining = dur;
    const done = new Promise((res) => { this._resolve = res; });
    this.setFrameHook((dt) => {
      remaining -= dt;
      if (remaining <= 0) this.clear();
    });
    this.engine?.requestRender();
    return done;
  }

  clear() {
    this.setFrameHook(null);
    this.textNode.setText('');
    this.setSize(this.lineWidth, 0);
    this.invalidateLayout();
    this._settle();
    return this;
  }

  _settle() {
    const r = this._resolve;
    this._resolve = null;
    r?.(this);
  }

  disposeSelf() { this._settle(); }
}

// ---------------- SanityFX ----------------
// The "UI itself goes mad" controller: an invisible node whose set(level 0..1)
// drives a vignette pulse (the engine._vignette handle) and a render-only tremor
// (fxOffsetX/Y — layout worlds and hit rects never move). Level 0 restores every
// offset and the vignette exactly; reducedMotion freezes all motion (offsets zero,
// the vignette holds a static depth). Glyph corruption fell per the cut line.
// No voice: sanity is game state, not a gesture.

export class SanityFX extends UINode {
  // opts: { targets = [], maxOffset = 2, onChange }
  constructor(opts = {}) {
    super({});
    this.level = 0;
    this.maxOffset = Number.isFinite(opts.maxOffset) ? Math.max(0, opts.maxOffset) : 2;
    this.targets = [...(opts.targets ?? [])];
    this.onChange = opts.onChange ?? null;
    this._off = null;
    this._t = 0;
    this._rnd = seededRng(0x5a17);
    this.setSize(0, 0);
  }

  // silent by default (the uniform contract; narrative.html
 // already passed {silent: true} at every call site, so the loud default served
 // no one and contradicted the documented convention)
  set(level, { silent = true } = {}) {
    const v = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    if (v === this.level) return this;
    this.level = v;
    if (v === 0) this._stop();
    else this._ensureHook();
    if (!silent) {
      this.dispatch('change', { value: v });
      try { this.onChange?.(v, { value: v }); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); }
    }
    return this;
  }

  setTargets(nodes) {
    for (const t of this.targets) {
      if (!t.disposed) { t.fxOffsetX = 0; t.fxOffsetY = 0; }
    }
    this.targets = [...(nodes ?? [])];
    return this;
  }

  _ensureHook() {
    if (this._off) return;
    const eng = widgetsEngine();
    if (!eng) return;
    this._off = eng.ticker.add((dt) => this._tick(dt));
  }

  _tick(dt) {
    const eng = widgetsEngine();
    if (!eng) return;
    this._t += dt;
    const vg = eng._vignette;
    if (isReducedMotion()) {
      // no motion: offsets stay zero, the vignette holds a static level-scaled depth
      for (const t of this.targets) {
        if (!t.disposed) { t.fxOffsetX = 0; t.fxOffsetY = 0; }
      }
      if (vg) vg.fxOpacity = 1 - 0.175 * this.level;
    } else {
      const amp = this.maxOffset * this.level;
      for (const t of this.targets) {
        if (t.disposed) continue;
        t.fxOffsetX = (this._rnd() * 2 - 1) * amp;
        t.fxOffsetY = (this._rnd() * 2 - 1) * amp;
      }
      if (vg) {
        const breathe = 0.5 + 0.5 * Math.sin(this._t * (1.5 + 4 * this.level));
        vg.fxOpacity = 1 - 0.35 * this.level * breathe;
      }
    }
    eng.requestRender();
  }

  _stop() {
    this._off?.();
    this._off = null;
    const eng = widgetsEngine();
    for (const t of this.targets) {
      if (!t.disposed) { t.fxOffsetX = 0; t.fxOffsetY = 0; }
    }
    const vg = eng?._vignette;
    if (vg) vg.fxOpacity = 1;
    eng?.requestRender();
  }

  disposeSelf() { this._stop(); }
}

// Coda & Coin-Op: the puzzle/platformer pack — mostly COMPOSITIONS of
// shipped parts (the win banner, the hint economy, the match-board pattern, and
// the level-flow glue all live on the flagship as recipes). The one new
// instrument: ScoreTally — the counting-number rollup every arcade ending
// deserves. Lines reveal in order, each number COUNTS through its values on the
// ticker, and the rank stamps last with a pop. Under reducedMotion the whole
// tally LANDS INSTANTLY at its final numbers (the no-motion law — determinism
// is the test suite pin). SplitTimer fell per the cut line. Zero atlas
// cost: the rank seal is an instance-owned raster ring. Event payloads avoid
// `target` fields (the event plane owns it — the law).

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { isReducedMotion } from '../animate.js';
import { commitChange, requireEngine, widgetsEngine, uisound, setNodeDisabled, Button } from './widgets.js';

const SHADOW = METRICS.textShadow;
const frame = (n) => requireEngine().textures.frame(n);

// ---------------- ScoreTally ----------------
// lines: [{ label, value }]. reveal() runs the arcade ending: per-line reveal,
// counting numbers, then the rank seal; `tallydone {total}` commits loud when
// the last digit lands. skip() (or any reveal during reducedMotion) lands
// everything instantly — the numbers are the CONTRACT, the motion is juice.
// a REAL panel — bordered window frame, a title lintel, the seal as a
// centered medallion, a Continue button, and an optional modal veil that dims
// and swallows the scene beneath (`modal: true`) — a victory should not float
// naked over live controls.

const TALLY_BAND_H = 40;   // the title lintel
const TALLY_SEAL_ZONE = 88; // the medallion's breathing room below the rows
const TALLY_FOOTER_H = 54;  // the Continue lane

export class ScoreTally extends UINode {
  // opts: { lines = [], rank = null, width = 300, countDur = 0.6, onDone,
  //         title = 'Victory', modal = false, continueLabel = 'Continue', onContinue }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const w = Number(opts.width);
    this._w = Number.isFinite(w) ? Math.max(200, Math.round(w)) : 300;
    const cd = Number(opts.countDur);
    this.countDur = Number.isFinite(cd) ? Math.max(0.1, cd) : 0.6;
    this.rank = opts.rank != null ? String(opts.rank) : null;
    this.onDone = opts.onDone ?? null;
    this.onContinue = opts.onContinue ?? null;
    this.modal = opts.modal === true;
    this.revealed = false;
    this._running = false;
    this._offs = [];
    this._rowH = 26;

    // the bordered body (registry frame — zero atlas cost) under a title lintel
    this.bg = new NineSliceNode(frame('window.frame'));
    this.add(this.bg);
    this._band = new NineSliceNode(frame('window.header'));
    this._band.auditAllow('overlap', 'containment'); // the lintel seats ON the frame lip by design
    this.titleText = new TextNode(String(opts.title ?? 'Victory'), {
      font: FONTS.header, size: 18, smallCaps: true, letterSpacing: 4,
      color: COLORS.accent, shadow: SHADOW,
    });
    this.add(this._band, this.titleText);
    this._rows = [];
    this.setLines(opts.lines ?? []);

    // the rank seal: an instance-owned ring the letter stamps into (a centered medallion)
    this._sealArt = createCanvasTexture(72, 72, texScale());
    this._sealQuad = new QuadNode({ texture: this._sealArt.texture });
    this._sealQuad.visible = false;
    this._sealQuad.auditAllow('overlap'); // the seal stamps over the panel body by design
    this.rankText = new TextNode('', {
      font: FONTS.header, size: 30, weight: 'bold', color: COLORS.quest, shadow: SHADOW,
    });
    this.rankText.visible = false;
    this.rankText.auditAllow('overlap');
    this.add(this._sealQuad, this.rankText);
    this._paintSeal();

    // the Continue lane: hidden until the numbers land
    this.continueBtn = new Button(String(opts.continueLabel ?? 'Continue'), {
      minWidth: 132,
      onClick: () => this._continue(),
    });
    this.continueBtn.visible = false;
    this.add(this.continueBtn);

    // the modal veil: built lazily on first reveal (most tallies are embedded)
    this.scrim = null;
  }

  _buildScrim() {
    if (this.scrim) return;
    const eng = widgetsEngine();
    const scrim = new UINode({ name: 'tally-veil', interactive: true });
    scrim.radialItems = () => false; // the victory veil offers no wheel — the radial chain stops at the scrim
    const shade = new QuadNode({ color: COLORS.voidBlack, opacity: 0.62 });
    scrim.add(shade);
    scrim._shade = shade;
    // the veil exists to SWALLOW — its feedback is the lit panel above it; a
    // mid-count click is the impatient player's skip
    scrim.auditAllow('press');
    scrim.on('pointerdown', (e) => {
      e.stopPropagation?.();
      if (this._running) this.skip();
    });
    scrim.on('wheel', (e) => e.stopPropagation?.());
    scrim.onLayout = function () {
      const g = widgetsEngine();
      if (!g) return;
      this.setSize(g.width, g.height);
      shade.setRect(0, 0, g.width, g.height);
    };
    scrim.visible = false;
    if (eng) eng.layers.overlay.add(scrim);
    this.scrim = scrim;
  }

  // A modal reveal RAISES ITSELF (the TutorialSequencer/TitleCard precedent).
  // Re-appending to `this.parent` only outranks the veil when the consumer already
  // lives on the overlay band — anywhere else (a window, the background) the panel
  // renders UNDER its own scrim. So both move onto the overlay together, veil
  // first, and `dismiss()` puts the panel back where it came from.
  _raise() {
    const eng = widgetsEngine();
    if (!eng) return;
    if (this._home === undefined) this._home = this.parent ?? null;
    eng.layers.overlay.add(this.scrim); // append order IS paint order in a band
    eng.layers.overlay.add(this);
  }

  _lower() {
    if (this._home === undefined) return;
    const home = this._home;
    this._home = undefined;
    if (home && !home.disposed && this.parent !== home) home.add(this);
  }

  setLines(lines) {
    for (const r of this._rows) { r.label.dispose(); r.value.dispose(); }
    this._rows = [];
    this.lines = (Array.isArray(lines) ? lines : []).map((l) => ({
      label: String(l?.label ?? '?'),
      value: Number.isFinite(Number(l?.value)) ? Math.round(Number(l.value)) : 0,
    }));
    for (const line of this.lines) {
      const label = new TextNode(line.label, {
        font: FONTS.header, size: 12, smallCaps: true, letterSpacing: 1,
        color: COLORS.text, shadow: SHADOW, maxWidth: this._w - 110, ellipsis: true,
      });
      const value = new TextNode('0', {
        font: FONTS.mono, size: 14, weight: 'bold', color: COLORS.bone, shadow: SHADOW,
      });
      label.visible = false;
      value.visible = false;
      this.add(label, value);
      this._rows.push({ label, value, line });
    }
    this.revealed = false;
    if (this.continueBtn) this.continueBtn.visible = false; // fresh lines re-arm the ending
    this.setSize(this._w,
      TALLY_BAND_H + 12 + this.lines.length * this._rowH + TALLY_SEAL_ZONE + TALLY_FOOTER_H);
    this.invalidateLayout();
    return this;
  }

  get total() { return this.lines.reduce((s, l) => s + l.value, 0); }

  // The arcade ending. Under reducedMotion (or skip) everything LANDS at once.
  reveal({ instant = false } = {}) {
    if (this._running || this.revealed) return this;
    const eng = widgetsEngine();
    if (!eng) return this;
    if (this.modal) {
      // the veil dims the scene and the panel rides ABOVE it, from ANY parent
      this._buildScrim();
      this.scrim.visible = true;
      if (!isReducedMotion() && !instant) {
        this.scrim.fxOpacity = 0;
        eng.ticker.tween(this.scrim, { fxOpacity: 1 }, { dur: 0.2 });
      } else this.scrim.fxOpacity = 1;
      this._raise();
      this.visible = true;
    }
    if (instant || isReducedMotion()) {
      this._land();
      return this;
    }
    this._running = true;
    this._counting = [];
    const stepLine = (i) => {
      if (this.disposed) return;
      if (i >= this._rows.length) { this._stamp(); return; }
      const row = this._rows[i];
      row.label.visible = true;
      row.value.visible = true;
      uisound(this, 'hover'); // each line arrives with a tick
      const state = { v: 0 };
      this._counting.push(state); // skip()/dispose cancel THESE, not the rows
      eng.ticker.tween(state, { v: row.line.value }, {
        dur: this.countDur,
        onUpdate: () => { if (!row.value.disposed) row.value.setText(String(Math.round(state.v))); },
        onDone: () => {
          if (this.disposed) return;
          row.value.setText(String(row.line.value)); // the number is the contract
          stepLine(i + 1);
        },
      });
      eng.requestRender();
    };
    stepLine(0);
    return this;
  }

  // Lands every number and the seal immediately (the impatient player's right).
  skip() {
    if (this.revealed) return this;
    const eng = widgetsEngine();
    if (eng) for (const s of this._counting ?? []) eng.ticker.cancelTweensOf(s);
    this._counting = [];
    this._land();
    return this;
  }

  _land() {
    for (const row of this._rows) {
      row.label.visible = true;
      row.value.visible = true;
      row.value.setText(String(row.line.value));
    }
    this._stamp({ silent: isReducedMotion() ? false : undefined });
  }

  _stamp({ silent } = {}) {
    this._running = false;
    if (this.revealed) return;
    this.revealed = true;
    if (this.rank != null) {
      this.rankText.setText(this.rank);
      this._sealQuad.visible = true;
      this.rankText.visible = true;
      const eng = widgetsEngine();
      if (eng && !isReducedMotion()) {
        this._sealQuad.fxScale = 1.6;
        this.rankText.fxScale = 1.6;
        eng.ticker.tween(this._sealQuad, { fxScale: 1 }, { dur: 0.16 });
        eng.ticker.tween(this.rankText, { fxScale: 1 }, { dur: 0.16 });
      }
      this.invalidateLayout();
    }
    uisound(this, 'open'); // the seal lands
    this.continueBtn.visible = true; // the landed ending offers the way out
    commitChange(this, 'tallydone', { total: this.total, rank: this.rank }, silent ?? false,
      this.onDone ? (_v, e) => this.onDone(e, e) : null);
  }

  // Continue: speaks `continue`, tears the veil down, hides the panel.
  _continue() {
    this.dispatch('continue', {});
    this.dismiss();
    if (this.onContinue) {
      try { this.onContinue(); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); }
    }
  }

  // Hide the panel (and the veil, when modal). setLines re-arms a later reveal.
  // A raised panel goes back to the parent it was raised from, so a second
  // reveal starts from the same place the consumer put it.
  dismiss() {
    this.visible = false;
    if (this.scrim) this.scrim.visible = false;
    this._lower();
    return this;
  }

  _paintSeal() {
    const { ctx } = this._sealArt;
    ctx.clearRect(0, 0, 72, 72);
    ctx.strokeStyle = COLORS.quest;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(36, 36, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(36, 36, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this._sealArt.texture.needsUpdate = true;
  }

  onLayout() {
    // Paint from the LIVE box with the floor enforced on the node — the same law
    // NotificationCenter and TreeTable now follow. Painting from the constructed
    // `_w` inside whatever box a consumer actually gave the panel is how a widget
    // ends up drawing outside its own rect.
    const W = Math.max(200, Math.round(this.w > 0 ? this.w : this._w));
    if (this.w !== W) this.setSize(W, this.h);
    this._w = W;
    this.bg.setRect(0, 0, W, this.h);
    this._band.setRect(6, 6, W - 12, TALLY_BAND_H - 8);
    this.titleText.setPos(
      Math.round((W - this.titleText.w) / 2),
      Math.round(6 + (TALLY_BAND_H - 8 - this.titleText.h) / 2));
    const rowsTop = TALLY_BAND_H + 12;
    this._rows.forEach((row, i) => {
      row.label.setPos(20, rowsTop + i * this._rowH);
      row.value.setPos(W - 20 - row.value.w, rowsTop - 1 + i * this._rowH);
    });
    // the seal: a centered medallion between the rows and the Continue lane
    const sealTop = rowsTop + this._rows.length * this._rowH + 8;
    this._sealQuad.setRect(Math.round((W - 72) / 2), sealTop, 72, 72);
    this.rankText.setPos(
      Math.round(W / 2 - this.rankText.w / 2),
      Math.round(sealTop + 36 - this.rankText.h / 2));
    this.continueBtn.setPos(
      Math.round((W - this.continueBtn.w) / 2),
      this.h - TALLY_FOOTER_H + Math.round((TALLY_FOOTER_H - this.continueBtn.h) / 2) - 6);
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  disposeSelf() {
    const eng = widgetsEngine();
    if (eng) for (const s of this._counting ?? []) eng.ticker.cancelTweensOf(s);
    this._sealArt.texture.dispose();
    this.scrim?.dispose();
  }
}

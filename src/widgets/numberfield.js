// NumberField: a stepped numeric field — carved − / + steppers flanking a mono value.
// Follows the uniform value contract (docs/API.md): `.value` reads, `setValue(v,
// {silent})` snaps to step and clamps to [min, max], user gestures commit loud.
// Arrows step from keyboard focus (Home/End jump to the bounds), the Slider idiom.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { ClipRegion } from '../clip.js';
import { requireEngine, commitChange, setNodeDisabled, snapStep } from './widgets.js';
import { clamp } from '../layout.js';

const frame = (name) => requireEngine().textures.frame(name); // friendly pre-init throw

export class NumberField extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    // B5: finite-first — non-finite bounds bust clamp and pin the field at NaN
    this.min = Number.isFinite(opts.min) ? opts.min : 0;
    this.max = Number.isFinite(opts.max) ? opts.max : 99;
    if (this.min > this.max) {
      // inverted FINITE bounds wedge every setValue at min (clamp maps all input
      // there) — normalize loudly instead of freezing silently
      console.warn(`LovecraftUI: NumberField min (${this.min}) > max (${this.max}); swapping.`);
      const t = this.min; this.min = this.max; this.max = t;
    }
    this.step = opts.step > 0 ? opts.step : 1; // 0/negative would collapse _snap to NaN
    this.onChange = opts.onChange ?? null;
    this.value = this._snap(opts.value ?? this.min);

    this.frame = new NineSliceNode(frame('field.normal'));
    // the value lives in a CLIPPED lane between the steppers —
    // an over-wide number can never paint over the buttons or past the frame
    this.clipBox = new UINode({ interactive: false });
    this.clipBox.clipChildren = true;
    this.clipBox.clipRegion = new ClipRegion();
    this.valueText = new TextNode('', {
      font: FONTS.mono, size: 14, color: COLORS.textBright,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    this.clipBox.add(this.valueText);
    this.btnDown = this._stepBtn('−', -1);
    this.btnUp = this._stepBtn('+', 1);
    this.add(this.frame, this.clipBox, this.btnDown, this.btnUp);
    this.setSize(opts.width ?? 120, opts.height ?? 34);
    this._paint();

    this.on('pointerenter', () => { if (!this.disabled) this.frame.setFrame(frame('field.hover')); });
    this.on('pointerleave', () => this.frame.setFrame(frame('field.normal')));
    this.on('keydown', (e) => {
      const d = { ArrowUp: this.step, ArrowRight: this.step, ArrowDown: -this.step, ArrowLeft: -this.step }[e.key];
      if (d !== undefined) { e.preventDefault(); this.setValue(this.value + d, { silent: false }); return; }
      if (e.key === 'Home') { e.preventDefault(); this.setValue(this.min, { silent: false }); }
      else if (e.key === 'End') { e.preventDefault(); this.setValue(this.max, { silent: false }); }
    });
  }

  _stepBtn(glyph, dir) {
    const b = new UINode({ interactive: true });
    const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    const t = new TextNode(glyph, {
      font: FONTS.mono, size: 15, color: COLORS.accent,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    b.add(wash, t);
    b._wash = wash;
    b._glyph = t;
    b.on('pointerenter', () => { if (!this.disabled) wash.setBaseOpacity(METRICS.washHover); });
    b.on('pointerleave', () => wash.setBaseOpacity(0));
    b.on('pointerdown', (e) => e.stopPropagation()); // steppers never drag the field
    b.on('click', (e) => {
      e.stopPropagation();
      this.setValue(this.value + dir * this.step, { silent: false });
    });
    return b;
  }

  // Steps count from `min` (the Slider snap rule) and clamp to the bounds.
  _snap(v) {
    return clamp(snapStep(v, this.min, this.step), this.min, this.max);
  }

  setValue(v, { silent = true } = {}) {
    const next = this._snap(v);
    if (next === this.value) return;
    this.value = next;
    this._paint();
    commitChange(this, 'change', { value: next }, silent, this.onChange);
  }

  setDisabled(v) {
    setNodeDisabled(this, v);
    if (v) { // no hover art frozen under the dim
      this.frame.setFrame(frame('field.normal'));
      this.btnDown._wash.setBaseOpacity(0);
      this.btnUp._wash.setBaseOpacity(0);
    }
  }

  _paint() {
    this.valueText.setText(String(this.value));
    this.invalidateLayout();
  }

  onLayout() {
    const B = 26;
    this.frame.setRect(0, 0, this.w, this.h);
    this.btnDown.setRect(2, 2, B, this.h - 4);
    this.btnUp.setRect(this.w - 2 - B, 2, B, this.h - 4);
    for (const b of [this.btnDown, this.btnUp]) {
      b._wash.setRect(0, 0, b.w, b.h);
      b._glyph.setPos(Math.round((b.w - b._glyph.w) / 2), Math.round((b.h - b._glyph.h) / 2));
    }
    const B2 = B + 2;
    this.clipBox.setRect(B2, 2, Math.max(0, this.w - 2 * B2), this.h - 4);
    // centered in FIELD coords, expressed in the clip lane's own coordinates
    this.valueText.setPos(
      Math.round((this.w - this.valueText.w) / 2) - B2,
      Math.round((this.h - this.valueText.h) / 2) - 2);
  }
}

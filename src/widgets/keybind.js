// KeybindField: click (or Enter/Space) to arm, then the next key combo or mouse button
// becomes the binding. Combos read "Ctrl+Shift+K"; mouse buttons read "Mouse1".."Mouse5"
// (DOM button n -> Mouse n+1), modifiers included. Escape cancels the capture and is
// CONSUMED (it never also pops the escape stack); blur cancels too. An armed field
// binds a press ON itself (any button); a press anywhere else cancels the capture.
// opts.checkConflict(combo) -> falsy | label: a truthy return rejects the combo,
// reverts the display, and dispatches `conflict {combo, with}` (+ opts.onConflict).

import { UINode } from '../node.js';
import { NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS } from '../theme.js';
import { ClipRegion } from '../clip.js';
import { widgetsEngine, requireEngine, commitChange, setNodeDisabled, uisound } from './widgets.js';
import { str } from '../strings.js';

const frame = (name) => requireEngine().textures.frame(name); // friendly pre-init throw
const MODS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

function comboOf(e, keyOrButton) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(keyOrButton);
  return parts.join('+');
}

export class KeybindField extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.value = opts.value ?? null;
    this.onChange = opts.onChange ?? null;
    this.onConflict = opts.onConflict ?? null;
    this.checkConflict = opts.checkConflict ?? null;
    this.capturing = false;

    this.frame = new NineSliceNode(frame('field.normal'));
    // combo labels live in a clipped lane — a long chord can never
    // paint past the control
    this.clipBox = new UINode({ interactive: false });
    this.clipBox.clipChildren = true;
    this.clipBox.clipRegion = new ClipRegion();
    this.label = new TextNode('', {
      font: FONTS.mono, size: 13, color: COLORS.textBright,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    this.clipBox.add(this.label);
    this.add(this.frame, this.clipBox);
    this.setSize(opts.width ?? 180, opts.height ?? 34);
    this._paint();

    this.onActivate = () => this._arm(); // Enter/Space arms it, same as a click

    this.on('pointerdown', (e) => {
      e.stopPropagation();
      if (this.capturing) {
        // an armed field binds the pressed mouse button (left included)
        this._commit(comboOf(e.native ?? {}, 'Mouse' + ((e.button ?? 0) + 1)));
        return;
      }
      widgetsEngine()?.setFocus(this); // guard the stale-engine path like every sibling widget
      this._arm();
    });
    this.on('rightclick', (e) => {
      if (!this.capturing && !this._justBound) return;
      e.preventDefault();
      this._justBound = false; // one suppression only — later right-clicks menu normally
    });
    this.on('pointerenter', () => { if (!this.capturing && !this.disabled) this.frame.setFrame(frame('field.hover')); });
    this.on('pointerleave', () => { if (!this.capturing) this.frame.setFrame(frame('field.normal')); });
    this.on('blur', () => this._cancel());
    this.on('keydown', (e) => {
      if (!this.capturing) return;
      if (e.key === 'Escape') {
        e.preventDefault(); // consume: cancelling a capture must not pop the escape stack
        this._cancel();
        return;
      }
      if (MODS.has(e.key)) return; // wait for a non-modifier
      e.preventDefault();
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      this._commit(comboOf(e.native ?? e, key)); // modifier flags ride the native event
    });
  }

  _arm() {
    if (this.disabled || this.capturing) return;
    this.capturing = true;
    this._paint();
  }

  _cancel() {
    if (!this.capturing) return;
    this.capturing = false;
    this._paint();
  }

  _commit(combo) {
    this.capturing = false;
    this._justBound = combo.startsWith('Mouse3'); // suppress the menu right after binding RMB
    const clash = this.checkConflict ? this.checkConflict(combo) : null;
    if (clash) {
      this._paint(); // revert the display; the binding stays what it was
      this.dispatch('conflict', { combo, with: clash });
      uisound(this, 'error', { combo, with: clash });
      if (this.onConflict) this.onConflict(combo, clash);
      return;
    }
    this.value = combo;
    this._paint();
    commitChange(this, 'change', { value: combo }, false, this.onChange);
  }

  setValue(v, { silent = true } = {}) {
    const next = v ?? null;
    if (next === this.value) return;
    this.value = next;
    this._paint();
    commitChange(this, 'change', { value: next }, silent, this.onChange);
  }

  setDisabled(v) {
    if (v) this._cancel();
    setNodeDisabled(this, v);
    if (v) this.frame.setFrame(frame('field.normal')); // no hover art frozen under the dim
  }

  _paint() {
    this.frame.setFrame(frame(this.capturing ? 'field.focus' : 'field.normal'));
    if (this.capturing) {
      this.label.setColor(COLORS.accent);
      this.label.setText(str('keybindPrompt'));
    } else {
      this.label.setColor(this.value ? COLORS.textBright : COLORS.textDisabled);
      this.label.setText(this.value ?? str('keybindUnbound'));
    }
    this.invalidateLayout();
  }

  onLayout() {
    this.frame.setRect(0, 0, this.w, this.h);
    // X edges on the frame's declared content box (FLD = 8) — the TextField
    // clip law; a long combo may no longer paint over the frame's lip
    this.clipBox.setRect(8, 2, Math.max(0, this.w - 16), this.h - 4);
    this.label.setPos(4, Math.round((this.h - this.label.h) / 2) - 2); // clip-lane coords
  }
}

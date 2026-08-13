// Core controls: Button, IconButton, TextField, Toggle, Radio, Slider, Select, ProgressBar,
// tooltip system. Each mirrors its source-library counterpart's states and behavior.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode, measureText, fontString, caretIndexForX } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { clamp } from '../layout.js';
import { ScrollArea, ClipRegion } from '../clip.js';
// NB: layoutbox.js imports requireEngine from THIS module — the cycle is safe
// because each side touches the other only at call time (requireEngine is a
// hoisted declaration; VBox is constructed inside methods, never at module init)
import { VBox } from '../layoutbox.js';
import { EldEvents } from './events.js';
import { str } from '../strings.js';
import { isReducedMotion } from '../animate.js';

let _engineRef = null;
export function bindWidgets(engine) { _engineRef = engine; }
export function widgetsEngine() { return _engineRef; }
// Full teardown hook: clears the engine binding and every widget-module collection.
export function resetWidgets() {
  _engineRef = null;
  radioGroups.clear();
}
// Exported for the sibling widget modules: their tex/frame accessors route through
// this so a pre-init construction throws the FRIENDLY message everywhere, never a
// bare "Cannot read properties of null (reading 'textures')".
export function requireEngine() {
  if (!_engineRef) throw new Error('LovecraftUI: widget constructed before Eldritch.init() (or after Eldritch.destroy())');
  return _engineRef;
}
const tex = (name) => requireEngine().textures.get(name);
const frame = (name) => requireEngine().textures.frame(name);

// ---- Uniform widget contract helpers ----
// Programmatic setters are silent by default; `silent: false` runs the same commit a user
// gesture does — bubble the domain event, then the constructor callback. Every widget's
// value pipeline routes through here so the convention lives in exactly one place.
// the interface's sound seam. The library ships ZERO audio — it narrates
// gestures onto the bus and consumers map kinds to their own mixer:
//   engine.bus.on('uisound', ({ kind, node, data }) => mixer.play(kind));
// Curated kinds: click hover open close pickup drop swap error notify type cooldown cast.
export function uisound(node, kind, data = null) {
  if (_engineRef) _engineRef.bus.emit('uisound', { kind, node, data });
}

export function commitChange(node, type, payload, silent, callback) {
  if (silent) return;
  // every widget's loud value commit narrates a click; the losing radio's mirrored
  // deselect stays silent (one gesture, one sound)
  if (type === 'change' && payload?.checked !== false) uisound(node, 'click');
  node.dispatch(type, payload);
  if (callback) {
    // the ctor callback is a guest (X16): a throw must not break the widget's commit
    // path mid-gesture — the dispatch above already ran, listeners are unaffected
    try { callback(payload.value, payload); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); }
  }
}

// The one disabled entry point: flips the input-layer inert flag, releases focus if this
// subtree holds it, and applies the default dim. Widgets with dedicated disabled art
// (Button's frame swap, IconButton's grayscale) apply their own visuals after calling this
// with { dim: false }.
export function setNodeDisabled(node, v, { dim = true } = {}) {
  node.disabled = !!v;
  const focused = node.engine?.focusedNode;
  if (v && focused && (focused === node || node.isAncestorOf(focused))) {
    node.engine.setFocus(null);
  }
  // Convention 3's second half: a capture already held inside the subtree when it
  // seals must not keep streaming (mid-drag slider, panzoom pan, scrollbar thumb) —
  // cancel it through the same canceled-up path a window blur takes.
  if (v) node.engine?.input.cancelCapturesWithin(node);
  if (dim) node.fxOpacity = v ? METRICS.disabledDim : 1;
  node.invalidatePaint();
}

// Snap onto the min-anchored step lattice, then shed the IEEE noise the multiply
// leaves on decimal steps (3 * 0.1 -> 0.30000000000000004): round to the decimal
// places min/step themselves carry. Exponent-notation values skip the correction.
export function snapStep(v, min, step) {
  const stepped = min + Math.round((v - min) / step) * step;
  const ms = String(min), ss = String(step);
  if (ms.includes('e') || ss.includes('e')) return stepped;
  const dec = Math.max((ms.split('.')[1] ?? '').length, (ss.split('.')[1] ?? '').length);
  if (!dec) return stepped;
  const p = 10 ** dec;
  return Math.round(stepped * p) / p;
}

// ---------------- Button ----------------

export class Button extends UINode {
  constructor(text, opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.disabled = opts.disabled ?? false;
    // a button CONSTRUCTED disabled must present dead at first
    // paint — the frame used to mount 'normal' unconditionally, so a disabled
    // button stood popped-up and clickable until the first hover ran _refresh
    this.frame = new NineSliceNode(frame(this.disabled ? 'button.disabled' : 'button.normal'));
    this.label = new TextNode(text, {
      // textDisabled for the disabled face: the audit now honors WCAG
      // 's inactive-component exemption, so the "textMuted because the
      // disabled token fails 4.5:1" compromise is retired - a dead face is
      // ALLOWED to be dim, and dim is what makes it read dead.
      font: FONTS.header, size: 15, color: this.disabled ? COLORS.textDisabled : COLORS.accent,
      smallCaps: true, letterSpacing: 1, shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    // a button's label is its FACE — centered on the
    // slab, not fitted inside the 9-slice band insets (which describe fixed art
    // regions, not a content box). Short buttons would otherwise flag containment.
    this.label.auditAllow('containment');
    this.add(this.frame, this.label);
    this._minW = opts.minWidth ?? 120;
    this.setSize(Math.max(this._minW, Math.ceil(this.label.w) + 52), opts.height ?? 38);
    this._pressed = false;
    this._hover = false;

    // B10: the seal quiets the VOICE too — hover still delivers into disabled subtrees
    // by design (tooltips), so the sound needs its own closest(disabled) gate
    this.on('pointerenter', () => { this._hover = true; this._refresh(); if (!this.closest((n) => n.disabled === true)) uisound(this, 'hover'); });
    this.on('pointerleave', () => { this._hover = false; this._pressed = false; this._refresh(); });
    this.on('pointerdown', (e) => { if (this.disabled) { e.stopPropagation(); return; } this._pressed = true; this._refresh(); });
    this.on('pointerup', (e) => { this._pressed = false; if (e.canceled) this._hover = false; this._refresh(); }); // canceled ups end dark (B3)
    this.on('click', (e) => {
      if (this.disabled) { e.stopPropagation(); return; }
      uisound(this, 'click');
      if (opts.onClick) opts.onClick(e);
    });
  }

  // Re-runs the constructor sizing so longer labels never overflow the stone frame.
  setText(t) {
    this.label.setText(t);
    this.setSize(Math.max(this._minW, Math.ceil(this.label.w) + 52), this.h);
    this.invalidateLayout();
  }

  setDisabled(v) {
    setNodeDisabled(this, v, { dim: false }); // dedicated frame/label art below
    // textDisabled (the textMuted compromise is retired with the
 // audit's WCAG inactive exemption): the flat sunken button.disabled
    // frame AND a genuinely dim glyph together make a dead control unmistakable
    // beside a live one - the pager report's whole complaint.
    this.label.setColor(v ? COLORS.textDisabled : COLORS.accent);
    this._refresh();
  }

  _refresh() {
    const state = this.disabled ? 'disabled' : this._pressed ? 'pressed' : this._hover ? 'hover' : 'normal';
    this.frame.setFrame(frame(`button.${state}`));
    this.invalidateLayout();
  }

  onLayout() {
    this.frame.setRect(0, 0, this.w, this.h);
    const press = this._pressed && !this.disabled ? 2 : 0;
    this.label.setPos(Math.round((this.w - this.label.w) / 2), Math.round((this.h - 6 - this.label.h) / 2) + press);
  }
}

// ---------------- IconButton ----------------

export class IconButton extends UINode {
  constructor(kind, opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.kind = kind;
    this.disabled = opts.disabled ?? false;
    this._hover = false; // owned by enter/leave ONLY — states must not clobber it
    this._resolveIcon(kind);
    this.icon = new QuadNode({ texture: tex(this._texBase) });
    this.add(this.icon);
    this.setSize(32, 32);
    this._applyState('normal');

    this.on('pointerenter', () => { this._hover = true; if (!this.disabled) this._applyState('hover'); if (!this.closest((n) => n.disabled === true)) uisound(this, 'hover'); }); // B10: sealed = silent
    this.on('pointerleave', () => { this._hover = false; this._applyState('normal'); });
    this.on('pointerdown', (e) => { if (this.disabled) { e.stopPropagation(); return; } this._applyState('pressed'); });
    this.on('pointerup', (e) => this._applyState(!e.canceled && this._hover ? 'hover' : 'normal')); // canceled ups end dark (B3)
    this.on('click', (e) => {
      if (this.disabled) { e.stopPropagation(); return; }
      uisound(this, 'click');
      if (opts.onClick) opts.onClick(e);
    });
  }

  // Resolve ui.* chrome icons first, then ability icons (icon.*); ability icons have
  // no .active variant, so hover/press falls back to the base art + the scale tween.
  _resolveIcon(kind) {
    const reg = requireEngine().textures;
    this.kind = kind;
    this._texBase = reg.has(`ui.${kind}`) ? `ui.${kind}` : `icon.${kind}`;
    this._texActive = reg.has(`${this._texBase}.active`) ? `${this._texBase}.active` : this._texBase;
  }

  // Swap the glyph in place, re-running the ui.*/icon.* resolution; state art follows.
  setIcon(kind) {
    this._resolveIcon(kind);
    this._applyState(this._hover && !this.disabled ? 'hover' : 'normal');
  }

  setDisabled(v) {
    setNodeDisabled(this, v, { dim: false }); // dedicated grayscale art instead of the dim
    this._applyState('normal');
  }

  _applyState(s) {
    // Never derive _hover from the state applied: 'pressed' would erase the hover
    // memory pointerup needs to restore hover art under a still-resting cursor.
    const eng = _engineRef;
    if (this.disabled) {
      const grayName = `${this._texBase}.grayscale`;
      this.icon.setTexture(eng.textures.has(grayName) ? tex(grayName) : tex(this._texBase));
      this._dimmedByDisable = !eng.textures.has(grayName);
      this.fxOpacity = this._dimmedByDisable ? 0.6 : 1;
      this.fxScale = 1;
      return;
    }
    // undo OUR no-grayscale dim only, on the disabled->enabled transition — a
    // consumer-set fxOpacity (mana/cooldown cues) must survive hover/press churn
    if (this._dimmedByDisable) { this.fxOpacity = 1; this._dimmedByDisable = false; }
    this.icon.setTexture(s === 'hover' || s === 'pressed' ? tex(this._texActive) : tex(this._texBase));
    const target = s === 'hover' ? 1.1 : s === 'pressed' ? 0.95 : 1;
    if (isReducedMotion()) { eng.ticker.cancelPropTween(this, 'fxScale'); this.fxScale = target; }
    else eng.ticker.tween(this, { fxScale: target }, { dur: 0.1 });
  }

  onLayout() { this.icon.setRect(0, 0, this.w, this.h); }
}

// ---------------- TextField ----------------

export class TextField extends UINode {
  constructor(opts = {}) {
    super({ interactive: true, cursor: 'text' });
    this.value = opts.value ?? '';
    this.placeholder = opts.placeholder ?? '';
    // a host on a lighter surface can brighten its placeholder
    // (the DebugConsole field measured 3.53:1 at textMuted on its pane)
    this._placeholderColor = opts.placeholderColor ?? COLORS.textMuted;
    this.maxLength = opts.maxLength ?? null;
    this._onSubmit = opts.onSubmit ?? null;
    this.frame = new NineSliceNode(frame('field.normal'));
    // everything typed lives in a CLIPPED inner box — glyphs, caret,
    // and selection can never paint past the control (the ScrollArea.content recipe;
    // the engine propagates the planes to every descendant material)
    this.clipBox = new UINode({ interactive: false });
    this.clipBox.clipChildren = true;
    this.clipBox.clipRegion = new ClipRegion();
    // COLORS.accent, not a hardcoded verdigris: the caret/selection must follow a theme
    // (brass gold, aether cyan) — the literal froze them green under every preset
    this.selectionQuad = new QuadNode({ color: COLORS.accent, opacity: 0.3 });
    this.selectionQuad.visible = false;
    this.textNode = new TextNode('', { size: 14, color: COLORS.textBright });
    this.caret = new QuadNode({ color: COLORS.accent });
    this.caret.visible = false;
    this.clipBox.add(this.selectionQuad, this.textNode, this.caret);
    this.add(this.frame, this.clipBox);
    this.setSize(opts.width ?? 200, opts.height ?? 34);
    this.focusable = true;
    this.touchDragOwner = true; // touch drags select text, never pan
    // Keyboard/gamepad activation promotes to text-editing focus (caret at end);
    // plain traversal focus does not open the hidden input.
    this.onActivate = () => {
      _engineRef.setFocus(this, {
        text: true, value: this.value,
        selectionStart: this.value.length, selectionEnd: this.value.length,
      });
    };
    this.focused = false;
    this.selStart = this.value.length;
    this.selEnd = this.value.length;
    this.caretIndex = this.value.length;
    this._textOffset = 0;
    this._blink = 0;
    this._valueAtFocus = '';
    this._mouseAnchor = -1;
    this._lastClick = { t: 0, idx: -1 };

    this.on('pointerdown', (e) => {
      if (this._mouseAnchor >= 0) return; // a live selection drag owns the field — a second finger is deaf
      const idx = this._indexFromPointer(e.x);
      const now = performance.now();
      const dbl = now - this._lastClick.t < 400 && Math.abs(idx - this._lastClick.idx) <= 1;
      this._lastClick = { t: now, idx };
      if (dbl && this.value.length) {
        // double-click: select the word under the caret
        let a = idx, b = idx;
        while (a > 0 && /\w/.test(this.value[a - 1])) a--;
        while (b < this.value.length && /\w/.test(this.value[b])) b++;
        this._mouseAnchor = -1;
        _engineRef.setFocus(this, { text: true, value: this.value, selectionStart: a, selectionEnd: b });
        this._applySelection(a, b, b);
      } else {
        this._mouseAnchor = idx;
        this._mousePointer = e.pointerId ?? -1;
        _engineRef.setFocus(this, { text: true, value: this.value, selectionStart: idx, selectionEnd: idx });
        this._applySelection(idx, idx, idx);
      }
      e.stopPropagation();
    });
    this.on('pointermove', (e) => {
      if (this._mouseAnchor < 0 || !this.focused || (e.pointerId ?? -1) !== this._mousePointer) return;
      const idx = this._indexFromPointer(e.x);
      const a = Math.min(this._mouseAnchor, idx), b = Math.max(this._mouseAnchor, idx);
      _engineRef.input.syncHiddenInput(this.value, a, b, idx < this._mouseAnchor ? 'backward' : 'forward');
      this._applySelection(a, b, idx);
    });
    this.on('pointerup', (e) => {
      if (this._mouseAnchor >= 0 && (e.pointerId ?? -1) !== this._mousePointer) return; // only the owner ends the drag
      this._mouseAnchor = -1;
    });
    this.on('pointerenter', () => { if (!this.focused && !this.disabled) this.frame.setFrame(frame('field.hover')); });
    this.on('pointerleave', () => { if (!this.focused) this.frame.setFrame(frame('field.normal')); });
    this.on('focus', () => {
      this.focused = true;
      this._valueAtFocus = this.value;
      // mirror the length cap onto the shared hidden input so NATIVE typing and paste
      // clamp at the source; a capless field must clear the previous field's cap
      const hi = _engineRef.input.hiddenInput;
      if (this.maxLength != null) hi.maxLength = this.maxLength;
      else hi.removeAttribute('maxlength');
      this.frame.setFrame(frame('field.focus'));
      this._blink = 0;
      this.setFrameHook((dt) => this._tick(dt));
    });
    this.on('blur', () => {
      if (!this.focused) return; // spurious/duplicate blur (never focused): nothing to commit
      this.focused = false;
      this._mouseAnchor = -1;
      this.frame.setFrame(frame('field.normal'));
      this.caret.visible = false;
      this.selectionQuad.visible = false;
      this.setFrameHook(null);
      if (this.value !== this._valueAtFocus) this.dispatch('change', { value: this.value });
    });
    this.on('textinput', (e) => {
      let v = e.value;
      // belt-and-braces beside the hidden input's native cap (programmatic syncs bypass it)
      if (this.maxLength != null && v.length > this.maxLength) {
        v = v.slice(0, this.maxLength);
        _engineRef.input.syncHiddenInput(v, Math.min(e.selectionStart ?? v.length, v.length),
          Math.min(e.selectionEnd ?? v.length, v.length));
      }
      this.value = v;
      this._applySelection(
        Math.min(e.selectionStart ?? v.length, v.length),
        Math.min(e.selectionEnd ?? v.length, v.length),
        Math.min(e.selectionEnd ?? v.length, v.length));
      this._blink = 0;
      this._refreshText();
      this.dispatch('input', { value: this.value });
      uisound(this, 'type');
    });
    this.on('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault(); // consume: blurring the field must not also pop the escape stack
        _engineRef.setFocus(null);
      } else if (e.key === 'Enter') {
        // commit in place: submit fires without blurring (chat boxes, search fields)
        this.dispatch('submit', { value: this.value });
        if (this._onSubmit) this._onSubmit(this.value);
      }
    });
    this._refreshText();
  }

  _indexFromPointer(px) {
    // screen delta ÷ worldScale = LOCAL px (the wartable idiom): inside a
    // zoomed plane the caret landed zoom× too far along the line
    const localX = (px - this.worldX) / (this.worldScale || 1) - 12 + this._textOffset;
    return caretIndexForX(this.textNode.fontCss, this.value, localX);
  }

  _applySelection(a, b, caret) {
    this.selStart = a; this.selEnd = b; this.caretIndex = caret;
    this._blink = 0;
    this._scrollCaretIntoView();
    this.invalidateLayout();
  }

  // The hand-the-keyboard verb: focus this field in its EDITING state — the
  // same promotion a click performs — with the caret at the end. The Enter-to-chat
  // idiom rides it: Eldritch.onKey('Enter', { down: () => chat.focusInput() }) fires
  // only while nothing holds focus, so a focused control's Enter still activates
  // that control and a field mid-edit is never stolen from. A sealed field refuses.
  focusEdit() {
    if (this.closest((n) => n.disabled === true)) return;
    const end = this.value.length;
    // requireEngine, not the bare ref: a stale Enter-to-chat binding
    // firing after destroy() read null and threw the exact bare message the
    // friendly guard exists to prevent
    requireEngine().setFocus(this, { text: true, value: this.value, selectionStart: end, selectionEnd: end });
    this._applySelection(end, end, end);
  }

  setValue(v, { silent = true } = {}) {
    const next = String(v ?? '');
    if (next === this.value) return;
    this.value = next;
    this._applySelection(
      Math.min(this.selStart, this.value.length),
      Math.min(this.selEnd, this.value.length),
      Math.min(this.caretIndex, this.value.length));
    if (this.focused) {
      _engineRef.input.syncHiddenInput(this.value, this.caretIndex, this.caretIndex);
      // rebase the blur commit: it must fire only for what the USER edits after this set
      // (a loud set already commits below; a silent one must not ghost-commit on blur)
      this._valueAtFocus = this.value;
    }
    this._refreshText();
    commitChange(this, 'change', { value: this.value }, silent, null);
  }

  setDisabled(v) {
    if (v && this.focused) _engineRef.setFocus(null); // blur first: no caret in a dead field
    setNodeDisabled(this, v);
    if (v) this.frame.setFrame(frame('field.normal')); // no hover art frozen under the dim
  }

  _tick(dt) {
    // caret blink (530ms) + mirror the hidden input's selection (arrows/home/end/ctrl-A are native)
    this._blink += dt;
    this.caret.visible = this.focused && this.selStart === this.selEnd && (this._blink % 1.06) < 0.53;
    const hi = _engineRef.input.hiddenInput;
    if (!this.focused || hi.selectionStart === null) return;
    const caret = hi.selectionDirection === 'backward' ? hi.selectionStart : hi.selectionEnd;
    if (hi.selectionStart !== this.selStart || hi.selectionEnd !== this.selEnd || caret !== this.caretIndex) {
      this._applySelection(hi.selectionStart, hi.selectionEnd, caret);
    }
  }

  _scrollCaretIntoView() {
    const font = this.textNode.fontCss;
    const caretX = measureText(font, this.value.slice(0, this.caretIndex));
    const inner = this.w - 24;
    if (caretX - this._textOffset > inner) this._textOffset = caretX - inner;
    if (caretX - this._textOffset < 0) this._textOffset = caretX;
    this._textOffset = Math.max(0, Math.min(this._textOffset, Math.max(0, this.textNode.w - inner)));
  }

  _refreshText() {
    const empty = this.value.length === 0;
    if (empty) {
      // textMuted by default, not textDisabled — the disabled token passes
      // 4.5:1 on abyss1 but the field's recessed void is darker (4.18:1 on the
      // game-hud census line); hosts on lighter surfaces override
      this.textNode.style.color = this._placeholderColor;
      this.textNode.setText(this.placeholder);
      this._textOffset = 0;
    } else {
      this.textNode.style.color = COLORS.textBright;
      this.textNode.setText(this.value);
      this._scrollCaretIntoView();
    }
    this.invalidateLayout();
  }

  onLayout() {
    this.frame.setRect(0, 0, this.w, this.h);
    // the clip's X edges sit ON the frame's declared content box (FLD = 8, the
    // 9-slice inset the art's ~7.5px chrome matches) — the old x=2 origin left
    // a 10px unclipped gutter over the frame's lip, and a scrolled run painted
    // straight into it (left-spill report). X ONLY: the
    // vertical edges keep the 2px hug — a symmetric 8 would clip the 18px
    // selection quad at the default h=34 and shave legal text-shadow slop.
    // Children below live in the clip's coordinates (field coords minus the
    // 8px origin — the glyph lane stays at field-x 12, so lane x = 4).
    this.clipBox.setRect(8, 2, Math.max(0, this.w - 16), this.h - 4);
    const textY = Math.round((this.h - this.textNode.h) / 2) - 2;
    this.textNode.setPos(4 - this._textOffset, textY);
    const font = this.textNode.fontCss;
    const caretX = this.value.length ? measureText(font, this.value.slice(0, this.caretIndex)) : 0;
    this.caret.setRect(4 + caretX - this._textOffset, Math.round((this.h - 16) / 2) - 2, 1.5, 16);
    if (this.focused && this.selStart !== this.selEnd && this.value.length) {
      const x0 = measureText(font, this.value.slice(0, this.selStart)) - this._textOffset;
      const x1 = measureText(font, this.value.slice(0, this.selEnd)) - this._textOffset;
      const inner = this.w - 24;
      const sx = Math.max(0, x0), ex = Math.min(inner, x1);
      this.selectionQuad.visible = ex > sx;
      this.selectionQuad.setRect(4 + sx, Math.round((this.h - 18) / 2) - 2, Math.max(0, ex - sx), 18);
    } else {
      this.selectionQuad.visible = false;
    }
  }
}

// ---------------- Toggle / Radio ----------------

export class Toggle extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.checked = opts.checked ?? false;
    this.onChange = opts.onChange ?? null;
    this.quad = new QuadNode({ texture: tex(this.checked ? 'toggle.checked' : 'toggle.normal') });
    // the checked texture WINS the swap slot, so hover on a checked box (and
    // press on any box) speak through the standard wash instead — the states-walker
    // law; floors from METRICS at event time (the S43 painter rule)
    this.wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    this.wash.auditAllow('overlap', 'containment'); // interaction-state art at the widget
    this.add(this.quad, this.wash);
    this.setSize(24, 24);
    this._hover = false; this._pressed = false;
    this.on('pointerenter', () => { if (!this.disabled) { this._hover = true; this._refresh(true); } });
    this.on('pointerleave', () => { this._hover = false; this._pressed = false; this._refresh(false); });
    this.on('pointerdown', () => { if (!this.disabled) { this._pressed = true; this._refresh(this._hover); } });
    this.on('pointerup', (e) => { this._pressed = false; if (e.canceled) this._hover = false; this._refresh(!e.canceled && this._hover); }); // canceled ups end dark (B3)
    this.on('click', () => {
      this.checked = !this.checked;
      this._refresh(true);
      commitChange(this, 'change', { checked: this.checked, value: this.checked }, false, this.onChange);
    });
  }
  setChecked(v, { silent = true } = {}) {
    v = !!v;
    if (v === this.checked) return;
    this.checked = v;
    this._refresh(false);
    commitChange(this, 'change', { checked: v, value: v }, silent, this.onChange);
  }
  setDisabled(v) { setNodeDisabled(this, v); if (v) { this._hover = false; this._pressed = false; this._refresh(false); } } // drop hover art under the dim
  _refresh(hover) {
    this.quad.setTexture(tex(this.checked ? 'toggle.checked' : hover ? 'toggle.hover' : 'toggle.normal'));
    this.wash.setBaseOpacity(this.disabled ? 0
      : this._pressed ? METRICS.washPress
      : (hover && this.checked) ? METRICS.washHover : 0);
  }
  onLayout() { this.quad.setRect(0, 0, this.w, this.h); this.wash.setRect(0, 0, this.w, this.h); }
}

export class ToggleLabel extends UINode {
  constructor(text, opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.toggle = new Toggle(opts);
    this.toggle.focusable = false; // the label row is the single tab stop
    this.label = new TextNode(text, { size: 13, color: COLORS.text });
    this.add(this.toggle, this.label);
    this.setSize(this.toggle.w + 8 + Math.ceil(this.label.w), Math.max(24, this.label.h));
    this.on('click', (e) => {
      if (e.target === this) this.toggle.emit('click', { target: this.toggle });
    });
  }
  get checked() { return this.toggle.checked; }
  setChecked(v, opts) { this.toggle.setChecked(v, opts); }
  setDisabled(v) { setNodeDisabled(this, v); } // subtree-scoped: the inner toggle goes inert too
  onLayout() {
    this.toggle.setPos(0, Math.round((this.h - 24) / 2));
    this.label.setPos(32, Math.round((this.h - this.label.h) / 2));
  }
}

const radioGroups = new Map();

// Arrow keys walk the radio group from whichever node holds focus (a bare Radio or its
// RadioLabel row); selection follows focus, matching platform radio semantics.
function radioNeighbor(radio, dir) {
  const group = [...(radioGroups.get(radio.groupName) ?? [])];
  if (!group.length) return null;
  const i = group.indexOf(radio);
  return group[((i + dir) % group.length + group.length) % group.length];
}

function wireRadioKeys(node, getRadio) {
  node.on('keydown', (e) => {
    const d = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const cur = getRadio();
    const next = radioNeighbor(cur, d);
    if (!next || next === cur) return;
    next.select();
    const focusTarget = next.closest(n => n.focusable) ?? next;
    node.engine?.focus.set(focusTarget, 'key');
  });
}

export class Radio extends UINode {
  constructor(group, opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.groupName = group;
    this._onChange = opts.onChange ?? null;
    this.checked = opts.checked ?? false;
    this.value = opts.value ?? null; // names this radio for the group statics
    this.quad = new QuadNode({ texture: tex(this.checked ? 'radio.checked' : 'radio.normal') });
    // same wash channel as Toggle — the checked texture wins the swap slot,
    // so a checked radio's hover and every press speak through the wash
    this.wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    this.wash.auditAllow('overlap', 'containment'); // interaction-state art at the widget
    this.add(this.quad, this.wash);
    this.setSize(24, 24); // the interactive hit floor; the art stays at its 20px bake
    this._hover = false; this._pressed = false;
    let set = radioGroups.get(group);
    if (!set) { set = new Set(); radioGroups.set(group, set); }
    set.add(this);
    this.on('pointerenter', () => { if (!this.disabled) { this._hover = true; this._refresh(true); } });
    this.on('pointerleave', () => { this._hover = false; this._pressed = false; this._refresh(false); });
    this.on('pointerdown', () => { if (!this.disabled) { this._pressed = true; this._refresh(this._hover); } });
    this.on('pointerup', (e) => { this._pressed = false; if (e.canceled) this._hover = false; this._refresh(!e.canceled && this._hover); }); // canceled ups end dark (B3)
    this.on('click', () => this.select(opts.onChange));
    wireRadioKeys(this, () => this);
  }
  // The checked radio's `value` (constructor opt), or null when none carries one / none checked.
  static groupValue(group) {
    for (const r of radioGroups.get(group) ?? []) { if (r.checked) return r.value; }
    return null;
  }
  // Select the group member whose `value` matches; returns false when none does.
  static selectValue(group, value, { silent = true } = {}) {
    for (const r of radioGroups.get(group) ?? []) {
      if (r.value === value) { r.select(r._onChange, { silent }); return true; }
    }
    return false;
  }
  select(onChange = this._onChange, { silent = false } = {}) {
    // Deselect fires each losing radio's OWN change {checked:false} — never the winner's
    // callback; the winner fires exactly once below with {checked:true}.
    for (const r of radioGroups.get(this.groupName)) {
      if (r !== this && r.checked) {
        r.checked = false;
        r._refresh(false);
        commitChange(r, 'change', { checked: false, value: false }, silent, r._onChange);
      }
    }
    if (!this.checked) {
      this.checked = true;
      this._refresh(false);
      commitChange(this, 'change', { checked: true, value: true }, silent, onChange);
    }
  }
  setDisabled(v) { setNodeDisabled(this, v); if (v) { this._hover = false; this._pressed = false; this._refresh(false); } } // drop hover art under the dim
  _refresh(hover) {
    this.quad.setTexture(tex(this.checked ? 'radio.checked' : hover ? 'radio.hover' : 'radio.normal'));
    this.wash.setBaseOpacity(this.disabled ? 0
      : this._pressed ? METRICS.washPress
      : (hover && this.checked) ? METRICS.washHover : 0);
  }
  onLayout() { this.quad.setRect(2, 2, this.w - 4, this.h - 4); this.wash.setRect(2, 2, this.w - 4, this.h - 4); } // 20px art centered in the 24px zone
  disposeSelf() { radioGroups.get(this.groupName)?.delete(this); }
}

export class RadioLabel extends UINode {
  constructor(group, text, opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.radio = new Radio(group, opts);
    this.radio.focusable = false; // the label row is the single tab stop
    this.label = new TextNode(text, { size: 13, color: COLORS.text });
    this.add(this.radio, this.label);
    this.setSize(this.radio.w + 8 + Math.ceil(this.label.w), Math.max(24, this.label.h)); // the row is a hit target
    this.on('click', (e) => { if (e.target === this) this.radio.select(opts.onChange); });
    wireRadioKeys(this, () => this.radio);
  }
  get checked() { return this.radio.checked; }
  setDisabled(v) { setNodeDisabled(this, v); } // subtree-scoped: the inner radio goes inert too
  onLayout() {
    this.radio.setPos(0, Math.round((this.h - this.radio.h) / 2));
    this.label.setPos(this.radio.w + 8, Math.round((this.h - this.label.h) / 2));
  }
}

// ---------------- Slider ----------------

export class Slider extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    // B5: finite-first — non-finite BOUNDS bust clamp itself (clamp guards its
    // value, not its bounds) and NaN-poison the thumb ratio and change payloads
    this.min = Number.isFinite(opts.min) ? opts.min : 0;
    this.max = Number.isFinite(opts.max) ? opts.max : 100;
    this.step = opts.step > 0 ? opts.step : 1; // 0/negative would collapse _snap to NaN
    this.value = this._snap(opts.value ?? 50); // on the lattice from birth (NumberField parity)
    this.track = new NineSliceNode(frame('slider.track'));
    this.thumb = new QuadNode({ texture: tex('slider.thumb.normal'), interactive: false });
    this.add(this.track, this.thumb);
    this.setSize(opts.width ?? 200, 24);
    this.focusable = true;
    this.touchDragOwner = true; // a touch on the slider drags the slider, never pans
    // a press SETS THE VALUE (click-to-set) and the value persists — restore
    // does not apply to a control whose press is a legitimate state commit
    this.auditAllow('restore');
    this._dragging = false;
    this.onInput = opts.onInput ?? null;    // continuous, during the drag
    this.onChange = opts.onChange ?? null;  // committed, on release (or loud setValue)

    this.on('keydown', (e) => {
      const delta = { ArrowLeft: -this.step, ArrowRight: this.step }[e.key];
      if (delta !== undefined) { e.preventDefault(); this.setValue(this.value + delta, { silent: false }); return; }
      if (e.key === 'Home') { e.preventDefault(); this.setValue(this.min, { silent: false }); }
      else if (e.key === 'End') { e.preventDefault(); this.setValue(this.max, { silent: false }); }
    });

    // labeled tick variant (settings quality slider)
    if (opts.labels) {
      this.labels = opts.labels.map(txt => new TextNode(txt, { size: 10, color: COLORS.textDisabled }));
      this.add(...this.labels);
      this.h = 40;
    }

    this.on('pointerdown', (e) => {
      if (this._dragging) return; // one gesture, one pointer (the C3 law) — a second finger is deaf
      this._dragging = true; this._dragPointer = e.pointerId ?? -1;
      this._downValue = this.value; this._fromPointer(e.x); this.thumb.setTexture(tex('slider.thumb.pressed')); e.stopPropagation();
    });
    this.on('pointermove', (e) => { if (this._dragging && (e.pointerId ?? -1) === this._dragPointer) this._fromPointer(e.x); });
    this.on('pointerup', (e) => {
      if (!this._dragging || (e.pointerId ?? -1) !== this._dragPointer) return;
      this._dragging = false;
      // a CANCELED up whose gesture was TAKEN by another surface (touch-pan
      // promotion, window blur) REVERTS the half-slide — the user wasn't sliding.
      // A canceled up from the widget's OWN seal (disable mid-drag) keeps the
      // shipped law: the drag was real input while the slider was live,
      // so the moved value commits once. `disabled` is the distinguishing fact.
      if (e.canceled && !this.disabled) {
        this.setValue(this._downValue); // silent — nothing was committed
        this.thumb.setTexture(tex('slider.thumb.normal'));
        return;
      }
      this.thumb.setTexture(tex(!e.canceled && this._hover ? 'slider.thumb.hover' : 'slider.thumb.normal'));
      // change = committed VALUE: a press that never moved off the down value commits nothing
      if (this.value !== this._downValue) commitChange(this, 'change', { value: this.value }, false, this.onChange);
    });
    this.on('pointerenter', () => { this._hover = true; if (!this._dragging && !this.disabled) this.thumb.setTexture(tex('slider.thumb.hover')); });
    this.on('pointerleave', () => { this._hover = false; if (!this._dragging) this.thumb.setTexture(tex('slider.thumb.normal')); });
  }

  // Steps count from `min` (a step of 10 with min 5 lands on 5, 15, 25 — not 10, 20).
  _snap(v) {
    return clamp(snapStep(v, this.min, this.step), this.min, this.max);
  }

  _fromPointer(px) {
    // screen delta ÷ worldScale = LOCAL px (the wartable idiom): inside a
    // zoomed plane the raw delta saturated the rail by its midpoint
    const ws = this.worldScale || 1;
    const inner = this.w - 24;
    const ratio = clamp(((px - this.worldX) / ws - 12) / inner, 0, 1);
    const v = this._snap(this.min + ratio * (this.max - this.min));
    if (v !== this.value) {
      this.value = v;
      this.invalidateLayout();
      this.dispatch('input', { value: v });
      if (this.onInput) this.onInput(v);
    }
  }

  setValue(v, { silent = true } = {}) {
    const next = this._snap(v);
    if (next === this.value) return;
    this.value = next;
    this.invalidateLayout();
    commitChange(this, 'change', { value: next }, silent, this.onChange);
  }

  setDisabled(v) { setNodeDisabled(this, v); if (v) this.thumb.setTexture(tex('slider.thumb.normal')); } // drop hover art under the dim

  onLayout() {
    this.track.setRect(0, 0, this.w, 20);
    const inner = this.w - 24;
    const ratio = (this.value - this.min) / Math.max(1e-6, this.max - this.min);
    this.thumb.setRect(Math.round(ratio * inner), -2, 24, 24);
    if (this.labels) {
      const n = this.labels.length;
      this.labels.forEach((l, i) => {
        const cx = 12 + (inner * i) / Math.max(1, n - 1);
        l.setPos(Math.round(cx - l.w / 2), 24);
      });
    }
  }
}

// ---------------- Select ----------------

export class Select extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.options = Select._normalize(opts.options);
    const items = this.options.filter(o => !o.separator);
    this.selectedIndex = Math.max(0, items.findIndex(o => o.value === opts.value));
    this.display = new NineSliceNode(frame('field.normal'));
    this.displayText = new TextNode(items[this.selectedIndex]?.label ?? '', { size: 14, color: COLORS.textBright, maxWidth: (opts.width ?? 180) - 48, ellipsis: true });
    this.arrow = new QuadNode({ texture: tex('select.arrow') });
    this.add(this.display, this.displayText, this.arrow);
    this.setSize(opts.width ?? 180, opts.height ?? 34);
    this.isOpen = false;
    this.dropdown = null;
    this.onChange = opts.onChange ?? null;
    // selects toggle on press, not click — synthetic activation must mirror that
    this.onActivate = () => this.toggle();

    this.on('pointerdown', (e) => {
      e.stopPropagation();
      _engineRef.setFocus(this);
      this.toggle();
    });
    this.on('pointerenter', () => { if (!this.isOpen && !this.disabled) this.display.setFrame(frame('field.hover')); });
    this.on('pointerleave', () => { if (!this.isOpen) this.display.setFrame(frame('field.normal')); });
    this.on('keydown', (e) => {
      const { key } = e;
      if (key === 'Enter' || key === ' ') { e.preventDefault(); this.toggle(); }
      else if (key === 'Escape') {
        if (this.isOpen) e.preventDefault(); // consume: one Escape = one surface
        this.close();
      }
      else if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        const list = this.options.filter(o => !o.separator);
        const next = clamp(this.selectedIndex + (key === 'ArrowDown' ? 1 : -1), 0, list.length - 1);
        if (next !== this.selectedIndex) this._select(next);
      }
    });
    this.on('blur', () => this.close());

    // outside click closes (source library: document click closes any open select)
    this._offOutside = null;
  }

  static _normalize(options) {
    const list = (options ?? []).filter(o => o != null); // data holes crash on `.separator` otherwise
    if (list.length !== (options ?? []).length) console.warn('LovecraftUI: Select options contained null/undefined entries; skipped.');
    return list.map(o => typeof o === 'string' ? (o === '---' ? { separator: true } : { value: o, label: o }) : o);
  }

  get value() { return this.options.filter(o => !o.separator)[this.selectedIndex]?.value; }

  // Uniform value contract: returns false when no option carries the value.
  setValue(value, { silent = true } = {}) {
    const items = this.options.filter(o => !o.separator);
    const idx = items.findIndex(o => o.value === value);
    if (idx === -1) return false;
    if (idx !== this.selectedIndex) this._commit(idx, silent);
    return true;
  }

  // Replace the option list (closes an open dropdown first). `value` picks the new
  // selection; otherwise the current value is kept when it still exists, else the first.
  setOptions(options, { value, silent = true } = {}) {
    const prev = this.value;
    this.close();
    this.options = Select._normalize(options);
    const items = this.options.filter(o => !o.separator);
    const want = value !== undefined ? value : prev;
    const idx = items.findIndex(o => o.value === want);
    this.selectedIndex = Math.max(0, idx);
    const opt = items[this.selectedIndex];
    this.displayText.setColor(COLORS.textBright);
    this.displayText.setText(opt?.label ?? '');
    this.invalidateLayout();
    if (!silent && opt && opt.value !== prev) {
      this.dispatch('change', { value: opt.value, label: opt.label, index: this.selectedIndex });
      if (this.onChange) this.onChange(opt.value, opt.label, this.selectedIndex);
    }
  }

  getOptions() { return this.options.map(o => ({ ...o })); }

  setDisabled(v) {
    this.close();
    setNodeDisabled(this, v);
    if (v) this.display.setFrame(frame('field.normal')); // no hover art frozen under the dim
  }

  // The open dropdown is reparented to the root dropdown layer; clicking it must not blur us.
  focusOwns(target) {
    return !!this.dropdown && this.dropdown.isAncestorOf(target);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.display.setFrame(frame('field.focus'));
    const eng = _engineRef;
    const dd = new UINode({ interactive: true });
    dd.name = 'select-dropdown';
    const bg = new NineSliceNode(frame('dropdown.frame'));
    dd.add(bg);
    // rows ride a VBox stretched to the dropdown's inner width; separators are
    // fixed lanes; the overflow path moves the WHOLE box into a ScrollArea (one
    // re-parent, not per-row surgery)
    const rowBox = new VBox({ gap: 0, align: 'stretch', autoWidth: false });
    rowBox.setSize(this.w - 8, 10);
    const list = this.options.filter(o => !o.separator);
    let itemIdx = 0;
    const itemTexts = []; // per enabled item, for live selection re-tint while open
    for (const opt of this.options) {
      if (opt.separator) {
        const sep = new UINode({});
        sep.setSize(10, 6);
        const rule = new QuadNode({ color: 0x39443a, opacity: 0.7 });
        sep.add(rule);
        sep.onLayout = () => rule.setRect(4, 2, sep.w - 8, 1.5);
        rowBox.add(sep);
        continue;
      }
      const idx = itemIdx++;
      const row = new UINode({ interactive: true });
      row.setSize(10, 26); // the box stretches every row to its width
      const hover = new QuadNode({ texture: tex('table.rowHover') });
      hover.visible = false;
      const txt = new TextNode(opt.label, { size: 14, color: idx === this.selectedIndex ? COLORS.accent : COLORS.textBright });
      txt.setPos(8, 5);
      row.add(hover, txt);
      itemTexts.push(txt);
      row.on('pointerenter', () => { hover.visible = true; txt.setColor('#ffffff'); }); // hover brightens PAST textBright (theme-neutral emphasis; the wash carries the rest)
      row.on('pointerleave', () => { hover.visible = false; txt.setColor(idx === this.selectedIndex ? COLORS.accent : COLORS.textBright); });
      row.on('pointerdown', (e) => e.stopPropagation());
      row.on('click', (e) => { e.stopPropagation(); this._select(idx); this.close(); });
      row.onLayout = () => { hover.setRect(0, 0, row.w, row.h); };
      rowBox.add(row);
    }
    rowBox.onLayout(); // pre-measure (the box idiom): the cap math needs true height NOW
    // size: the full list, capped to the viewport — a too-tall list scrolls inside the frame
    const rowsH = rowBox.h + 12;
    const availH = eng.height - 2 * METRICS.tooltipMargin;
    const ddH = Math.min(rowsH, availH);
    if (rowsH > availH) {
      const sa = new ScrollArea({});
      sa.setRect(4, 4, this.w - 8, ddH - 8);
      sa.content.add(rowBox);
      dd.add(sa);
    } else {
      rowBox.setPos(4, 6);
      dd.add(rowBox);
    }
    dd.setRect(0, 0, this.w, ddH);
    bg.setRect(0, 0, this.w, ddH);
    // B9: an open dropdown SEALS the wheel — the page beneath must not scroll under
    // the cursor (the DebugConsole precedent; the overflowing form scrolls first,
    // this catches what its ScrollArea releases at the extremes)
    dd.on('wheel', (e) => e.stopPropagation());
    // Above a live modal or a tutorial Spotlight the dropdown must overtop the scrim
    // (the menu.js rule) — it otherwise opens buried beneath it, visible only as a
    // stale Escape-stack entry.
    (eng.modalActive || eng.spotlightActive ? eng.layers.overlay : eng.layers.dropdown).add(dd);
    this.dropdown = dd;
    this._ddItemTexts = itemTexts;
    this._positionDropdown();
    // re-glue every frame the layout ran (window drags move the anchor): postlayout fires
    // after world computation and before sync, so the surface tracks with no visible lag
    this._offGlue = eng.bus.on('postlayout', () => this._positionDropdown());
    this._offOutside = eng.bus.on('pointerdown', ({ target }) => {
      if (!target || (!this.isAncestorOf(target) && !dd.isAncestorOf(target))) this.close();
    });
    // the open dropdown is a transient surface: Escape/gamepad-B close it first
    this._offEscape = eng.focus.pushEscape(() => this.close());
    this.dispatch('open', {});
    uisound(this, 'open');
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.display.setFrame(frame('field.normal'));
    if (this._offOutside) { this._offOutside(); this._offOutside = null; }
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    if (this._offGlue) { this._offGlue(); this._offGlue = null; }
    if (this.dropdown) { this.dropdown.dispose(); this.dropdown = null; }
    this._ddItemTexts = null;
    this.dispatch('close', {});
    uisound(this, 'close');
  }

  // Place the open dropdown against its anchor: below by default, flipped above when the
  // viewport bottom is near (the tooltip/menu discipline), clamped to the edge margins.
  // An anchor scrolled fully out of its clip means the select left the screen: close.
  _positionDropdown() {
    const dd = this.dropdown;
    if (!dd) return;
    const clip = this.effectiveClipRect;
    if (clip) {
      const r = this.worldRect;
      if (r.x1 <= clip.x0 || r.x0 >= clip.x1 || r.y1 <= clip.y0 || r.y0 >= clip.y1) { this.close(); return; }
    }
    const eng = _engineRef;
    const M = METRICS.tooltipMargin;
    let x = this.worldX;
    let y = this.worldY + this.h + 2;
    if (y + dd.h > eng.height - M) y = this.worldY - dd.h - 2; // flip above the field
    x = Math.round(clamp(x, M, Math.max(M, eng.width - M - dd.w)));
    y = Math.round(clamp(y, M, Math.max(M, eng.height - M - dd.h)));
    if (dd.x !== x || dd.y !== y) {
      dd.setPos(x, y);
      _engineRef.layoutDirty = true; // hit rects follow next frame (the window-glue idiom)
    }
  }

  _select(idx) { this._commit(idx, false); }

  // The one commit path for selection: user gestures run it loud; setValue may run it silent.
  _commit(idx, silent) {
    this.selectedIndex = idx;
    const opt = this.options.filter(o => !o.separator)[idx];
    this.displayText.setColor(COLORS.textBright);
    this.displayText.setText(opt.label);
    // an open dropdown tracks the selection live (arrows move it without pointer help)
    if (this._ddItemTexts) {
      this._ddItemTexts.forEach((t, i) => t.setColor(i === idx ? COLORS.accent : COLORS.textBright));
    }
    this.invalidateLayout();
    if (!silent) {
      this.dispatch('change', { value: opt.value, label: opt.label, index: idx });
      if (this.onChange) this.onChange(opt.value, opt.label, idx);
    }
  }

  onLayout() {
    this.display.setRect(0, 0, this.w, this.h);
    this.displayText.setPos(12, Math.round((this.h - this.displayText.h) / 2));
    this.arrow.setRect(this.w - 26, Math.round((this.h - 16) / 2), 16, 16);
    // the open dropdown re-glues on the postlayout bus (see _positionDropdown)
  }

  // Detaching (even without dispose) must close the dropdown: it lives reparented in the
  // dropdown layer and holds a bus subscription that would otherwise outlive this select.
  onEngine(engine, _old) { if (!engine && this.isOpen) this.close(); }

  disposeSelf() { this.close(); }
}

// ---------------- ProgressBar ----------------

export class ProgressBar extends UINode {
  constructor(opts = {}) {
    super({});
    this.bg = new NineSliceNode(frame('progress.bg'));
    this.fill = new QuadNode({ texture: tex('progress.fill') });
    this.frameTop = new NineSliceNode(frame('progress.frame'));
    // bg + fill deliberately run under frameTop's lip, and frameTop itself is
    // full-bleed chrome OVER them (the audit reads the first NineSlice — bg — as
    // the composite's frame, so the stone frame reads as a "child" outside bg's
    // content box) — classic layered bar art, declared
    this.bg.auditAllow('containment');
    this.fill.auditAllow('containment');
    this.frameTop.auditAllow('containment');
    // Segment ticks (the XP-bar segment art): thin dividers across the fill
    // band, over the fill but under the stone frame — the STYLE-legal divider-quad
    // role. `segments: n` draws n-1 ticks; absent/0/1/non-finite draws none (unchanged
    // art). Finite-first: Math.floor(Infinity) would spin the build loop forever.
    this.segments = Number.isFinite(opts.segments) ? Math.max(0, Math.floor(opts.segments)) : 0;
    this._ticks = [];
    for (let i = 0; i < Math.max(0, this.segments - 1); i++) {
      const tick = new QuadNode({ color: COLORS.voidBlack, opacity: 0.55 });
      tick.auditAllow('containment'); // rides the fill band under the lip, like the fill
      this._ticks.push(tick);
    }
    this.add(this.bg, this.fill, ...this._ticks, this.frameTop);
    this.setSize(opts.width ?? 300, opts.height ?? 32);
    this.value = clamp(opts.value ?? 0, 0, 100);
    this._displayValue = this.value;
  }

  setValue(pct, { animate = true, silent = true } = {}) {
    const next = clamp(pct, 0, 100);
    const moved = next !== this.value;
    this.value = next;
    if (animate && this.engine) {
      this.engine.ticker.tween(this, { _displayValue: this.value }, {
        dur: 0.3,
        onUpdate: () => this.invalidateLayout(),
      });
    } else {
      this._displayValue = this.value;
      this.invalidateLayout();
    }
    if (moved) commitChange(this, 'change', { value: next }, silent, null);
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.frameTop.setRect(0, 0, this.w, this.h);
    const inner = this.w - 12;
    this.fill.setRect(6, 6, Math.max(0, Math.round(inner * this._displayValue / 100)), this.h - 12);
    this.fill.visible = this._displayValue > 0.5;
    this._ticks.forEach((t, i) => {
      t.setRect(6 + Math.round(inner * (i + 1) / this.segments), 6, 1, this.h - 12);
    });
  }
}

// ---------------- Tooltip system ----------------

export const EldTooltip = {
  engine: null,
  node: null,
  hideTimer: 0,

  init(engine) {
    this.engine = engine;
    this.node = new UINode({ name: 'tooltip' });
    this.node.visible = false;
    engine.layers.tooltip.add(this.node);
  },

  _build(spec) {
    for (const c of [...this.node.children]) c.dispose();
    const bg = new NineSliceNode(frame('tooltip.frame'));
    this.node.add(bg);
    // Opt-in: spec.markup parses body text (lines/desc/stats/flavor) for
    // {color}/{icon}/{b}/{i} runs; the title stays single-run styled.
    const mk = spec.markup === true;
    const maxW = 252;
    let y = 10;
    let wMax = 120;
    const put = (textNode, x) => {
      textNode.setPos(x, y);
      this.node.add(textNode);
      y += textNode.h + 2;
      wMax = Math.max(wMax, textNode.w + 2 * x);
    };
    if (spec.title) {
      put(new TextNode(spec.title, {
        font: FONTS.header, size: 14, weight: 'bold', color: spec.titleColor ?? COLORS.accent,
        maxWidth: maxW, ellipsis: false, multiline: measureText(fontString({ size: 14, weight: 'bold', font: FONTS.header }), spec.title) > maxW,
        shadow: { color: 'rgba(0,0,0,0.8)', dx: 1, dy: 1, blur: 2 },
      }), 12);
      y += 2;
    }
    for (const line of spec.lines ?? []) {
      put(new TextNode(line.text, { size: 12, color: line.color ?? COLORS.textMuted, multiline: true, maxWidth: maxW, markup: mk }), 12);
    }
    if (spec.desc) {
      put(new TextNode(spec.desc, { size: 12, color: COLORS.textMuted, multiline: true, maxWidth: maxW, markup: mk }), 12);
    }
    if (spec.stats && spec.stats.length) {
      y += 4;
      const rule = new QuadNode({ color: 0x6fd18b, opacity: 0.3 });
      rule.setRect(10, y, Math.max(100, wMax - 20), 1);
      this.node.add(rule);
      y += 5;
      for (const s of spec.stats) {
        put(new TextNode(s, { size: 12, color: COLORS.positive, multiline: true, maxWidth: maxW, markup: mk }), 12);
      }
    }
    if (spec.flavor) {
      y += 3;
      put(new TextNode(spec.flavor, { size: 12, styleIt: 'italic', color: COLORS.bone, multiline: true, maxWidth: maxW, markup: mk }), 12);
    }
    const w = Math.min(280, Math.max(140, wMax));
    const h = y + 8;
    this.node.setSize(w, h);
    bg.setRect(0, 0, w, h);
  },

  show(spec, x, y) {
    if (!spec) return;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = 0; }
    if (typeof spec === 'string') spec = { title: spec };
    this._build(spec);
    this.node.visible = true;
    this.updatePosition(x, y);
  },

  updatePosition(x, y) {
    if (!this.node.visible) return;
    const M = METRICS.tooltipMargin, O = METRICS.tooltipOffset;
    const eng = this.engine;
    let fx = x + O, fy = y + O;
    if (fx + this.node.w > eng.width - M) fx = x - this.node.w - O;
    if (fy + this.node.h > eng.height - M) fy = y - this.node.h - O;
    this.node.setPos(Math.max(M, Math.round(fx)), Math.max(M, Math.round(fy)));
  },

  hide() {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { this.node.visible = false; this.hideTimer = 0; this._anchor = null; }, METRICS.tooltipHideDelay);
  },

  // Immediate hide with no grace delay (target vanished, teardown).
  hideNow() {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = 0; }
    if (this.node) this.node.visible = false;
    this._anchor = null;
  },

  // Wire hover tooltips on a node. specOrFn: spec object or () => spec.
  // Returns a detach function; disposing the node detaches (and hides) automatically.
  attach(node, specOrFn) {
    if (node._tooltipDetach) return node._tooltipDetach;
    node.interactive = true;
    const spec = () => (typeof specOrFn === 'function' ? specOrFn() : specOrFn);
    const offs = [
      node.on('pointerenter', (e) => { this._anchor = node; this.show(spec(), e.x, e.y); }),
      node.on('pointermove', (e) => this.updatePosition(e.x, e.y)),
      node.on('pointerleave', () => this.hide()),
      // touch has no hover: long-press shows the tooltip; the next tap anywhere hides it
      node.on('longpress', (e) => {
        this._anchor = node;
        this.show(spec(), e.x, e.y);
        if (!this._offTouchHide) {
          this._offTouchHide = this.engine.bus.on('pointerdown', () => {
            this._offTouchHide?.();
            this._offTouchHide = null;
            this.hideNow();
          });
        }
      }),
      node.on('dispose', () => this.detach(node)),
    ];
    node._tooltipDetach = () => {
      for (const off of offs) off();
      node._tooltipDetach = null;
      if (this._anchor === node) this.hideNow();
    };
    return node._tooltipDetach;
  },

  detach(node) { node._tooltipDetach?.(); },

  // Teardown hook: drop timers and node refs (the node itself dies with its layer).
  _reset() {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = 0; }
    if (this._offTouchHide) { this._offTouchHide(); this._offTouchHide = null; }
    this._anchor = null;
    this.node = null;
    this.engine = null;
  },
};

// Lovecraft-flavored ability compendium (same icon ids as the source library).
export const ABILITY_DATA = {
  fireball: { name: 'Balefire', desc: 'Hurls a gout of witch-flame that sears the mind as it burns.', stats: '45 Eldritch Damage | 2.5s Incantation' },
  fireball2: { name: 'Greater Balefire', desc: 'A roaring sphere of void-fire that detonates on impact.', stats: '78 Eldritch Damage | 3s Incantation | AoE' },
  shield: { name: 'Elder Ward', desc: 'Inscribes the Elder Sign before you, turning aside claw and curse.', stats: '+50% Ward Chance | 6s Duration' },
  sword: { name: 'Ritual Blade', desc: 'A consecrated cut that the ancient ones cannot ignore.', stats: '25 + 150% Weapon Damage' },
  arrows: { name: 'Barbed Volley', desc: 'Looses a fan of bone darts carved from things best unnamed.', stats: '35 Physical Damage | Hits 3 targets' },
  blindinglight: { name: 'Blinding Radiance', desc: 'The lidless eye opens, and nearby horrors avert their gaze.', stats: '3s Blind | 8 yd radius' },
  book: { name: 'Necronomicon', desc: 'Passive: forbidden knowledge empowers your incantations.', stats: '+15 Spell Power' },
  deathkiss: { name: "Death's Kiss", desc: 'Drains the warmth of the living into your own veins.', stats: '30 Void Damage | Heals 50%' },
  leafs: { name: 'Grave Moss', desc: 'Strange herbs from the churchyard knit flesh unnaturally fast.', stats: 'Heals 20/sec | 10s Duration' },
};

export function formatIconName(name) {
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function abilityData(iconName) {
  return ABILITY_DATA[iconName] ?? { name: formatIconName(iconName), desc: str('abilityFallbackDesc'), stats: str('abilityFallbackStats') };
}

// Item metadata registry (the inventory suite's compendium). Module-level like
// ABILITY_DATA, so registrations persist across destroy/init re-theme cycles.
// rarity: 'common' | 'rare' | 'epic' | 'legendary' (the COLORS.rarity* tokens).
export const ITEM_DATA = {};

export function registerItemData(id, { name, desc, icon = null, rarity = 'common', stackMax = 1, data = null } = {}) {
  ITEM_DATA[id] = {
    name: name ?? formatIconName(id),
    desc: desc ?? str('itemFallbackDesc'), // baked at REGISTRATION time by design
    icon, rarity, stackMax: Number.isFinite(stackMax) ? Math.max(1, Math.floor(stackMax)) : 1, data,
  };
  return ITEM_DATA[id];
}

export function itemData(id) {
  return ITEM_DATA[id] ?? {
    name: formatIconName(id), desc: str('itemFallbackDesc'),
    icon: null, rarity: 'common', stackMax: 1, data: null,
  };
}

export function rarityColor(rarity) {
  const key = 'rarity' + String(rarity ?? 'common').replace(/^\w/, (c) => c.toUpperCase());
  return COLORS[key] ?? COLORS.rarityCommon;
}

export { EldEvents };

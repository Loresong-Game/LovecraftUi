// DevPanel (REBUILT on the window furniture in — the design requirement): the studio
// cheat panel is a REAL window now — stone frame, header plaque, honest title,
// close button, header drag — with the cheat-panel extras: click-the-header
// collapse and a bus hotkey ('F2') that toggles visibility no matter what holds
// focus. Rows dogfood the Store bindings (one line per field, both directions).
// Build with DevPanel.fromSpec({ title, fields, hotkey, x, y }, store); fields:
//   { type: 'toggle',  label, path }
//   { type: 'slider',  label, path, min, max, step }
//   { type: 'select',  label, path, options }
//   { type: 'button',  label, onClick }
//   { type: 'readout', label, path, fmt }
// The close button HIDES the panel (the hotkey recalls it). The panel adds itself
// to engine.layers.overlay and cleans its bus subscription on dispose.

import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { requireEngine, Button, ToggleLabel, Slider, Select, uisound } from './widgets.js';
import { Window } from './windows.js';
import { bind, bindText } from '../store.js';
import { str } from '../strings.js';
import { clamp } from '../layout.js';

const PANEL_W = 264;
const PAD = 8;

export class DevPanel extends Window {
  constructor(opts = {}) {
    super({ title: opts.title ?? 'DEV', width: PANEL_W, height: 80, autoSize: false });
    const eng = requireEngine();
    this.interactive = true;
    this.body = this.contentArea.content; // rows land here (the surface)
    this.collapsed = false;
    this._openH = 80;

    // collapse chevron beside the plaque (rides the header band like the title)
    this.caret = new TextNode('▾', { size: 12, color: COLORS.accent });
    this.caret.auditAllow('containment');
    this.caret.setPos(10, 10);
    this.add(this.caret);
    this.titleText = this.title; // compat alias

    // the header is live chrome here: click collapses, drag moves (the ModalWindow
    // idiom, engine-clamped — the cheat panel is overlay furniture, not a managed
    // window). The close button's own click stops its bubble, so it never collapses.
    this.header.interactive = true;
    this.header.cursor = 'move';
    this.header.touchDragOwner = true;
    this._drag = null;
    this.header.on('pointerdown', (e) => {
      this._drag = { sx: e.x, sy: e.y, left: this.x, top: this.y, moved: false };
      e.stopPropagation();
    });
    this.header.on('pointermove', (e) => {
      if (!this._drag) return;
      const dx = e.x - this._drag.sx, dy = e.y - this._drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) this._drag.moved = true;
      this.setPos(
        Math.round(clamp(this._drag.left + dx, 0, Math.max(0, eng.width - this.w))),
        Math.round(clamp(this._drag.top + dy, 0, Math.max(0, eng.height - this.h))),
      );
    });
    this.header.on('pointerup', () => {
      this._lastDragMoved = this._drag?.moved === true;
      this._drag = null;
    });
    this.header.on('click', (e) => {
      e.stopPropagation();
      if (this._dragConsumed()) return; // a drag release is not a collapse click
      this.setCollapsed(!this.collapsed);
    });
    this.on('close', () => {
      // hidden, not disposed — the hotkey recalls. Hiding must not leave a hidden row
      // keyboard-live (the windows.js minimize guard, mirrored): release any focus held
      // inside first, or an invisible Slider keeps writing into the bound Store.
      this._releaseFocusWithin();
      this.visible = false;
    });

    if (opts.hotkey) {
      // bus keydown arrives while nothing holds engine focus, or falls through a
      // focused non-text widget that left the key unconsumed — a focused
      // FIELD still keeps its keys until blurred (text editing never falls
      // through), so the recall cannot fire mid-typing.
      this._offHotkey = eng.bus.on('keydown', (e) => {
        if (e.key === opts.hotkey) {
          if (this.visible) this._releaseFocusWithin();
          this.visible = !this.visible;
        }
      });
    }
    this.setPos(opts.x ?? 16, opts.y ?? 16);
  }

  _releaseFocusWithin() {
    const focused = this.engine?.focusedNode;
    if (focused && (focused === this || this.isAncestorOf(focused))) this.engine.setFocus(null);
  }

  _dragConsumed() {
    const moved = this._lastDragMoved === true;
    this._lastDragMoved = false;
    return moved;
  }

  setCollapsed(v) {
    this.collapsed = v === true;
    this.body.visible = !this.collapsed;
    this.contentArea.visible = !this.collapsed;
    this.caret.setText(this.collapsed ? '▸' : '▾');
    this.setSize(PANEL_W, this.collapsed ? METRICS.windowHeaderH + 4 : this._openH);
  }

  disposeSelf() { if (this._offHotkey) { this._offHotkey(); this._offHotkey = null; } }

  // The one-call constructor: rows bind themselves to the store (two-way where the
  // row edits, one-way for readouts) — the panel IS the bind() dogfood. Rows live
  // in the WINDOW's content box, so the stone border insets are honored natively
  // (the old hand-rolled panel drew rows 8px from the raw frame edge — the design requirement's
  // "Cheats - F2" exhibit).
  static fromSpec({ title, fields = [], hotkey, x, y } = {}, store) {
    const panel = new DevPanel({ title, hotkey, x, y });
    const eng = requireEngine();
    const fr = eng.textures.frame('window.frame');
    const CW = PANEL_W - fr.l - fr.r; // the content box width the window will lay out
    let cy = 2;
    for (const f of fields) {
      if (f.type === 'toggle') {
        const t = new ToggleLabel(f.label ?? f.path, {});
        t.setPos(0, cy);
        panel.body.add(t);
        if (f.path) bind(t, store, f.path);
        cy += 30;
      } else if (f.type === 'slider') {
        const lab = new TextNode(f.label ?? f.path, { size: 11, color: COLORS.textFaint });
        lab.setPos(0, cy);
        const val = new TextNode('', { font: FONTS.mono, size: 11, color: COLORS.text });
        val.setPos(CW - 48, cy);
        const s = new Slider({ min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1, width: CW - 8 });
        s.setPos(0, cy + 16);
        panel.body.add(lab, val, s);
        if (f.path) {
          bind(s, store, f.path);
          bindText(val, store, f.path, f.fmt ?? ((v) => String(v ?? '')));
        }
        cy += 46;
      } else if (f.type === 'select') {
        const lab = new TextNode(f.label ?? f.path, { size: 11, color: COLORS.textFaint });
        lab.setPos(0, cy + 8);
        const sel = new Select({ options: f.options ?? [], width: 132 });
        sel.setPos(CW - 132, cy);
        panel.body.add(lab, sel);
        if (f.path) bind(sel, store, f.path);
        cy += 40;
      } else if (f.type === 'button') {
        const b = new Button(f.label ?? str('devButtonDefault'), { minWidth: CW, onClick: f.onClick });
        b.setPos(0, cy);
        panel.body.add(b);
        cy += 44;
      } else if (f.type === 'readout') {
        const lab = new TextNode(f.label ?? f.path, { size: 11, color: COLORS.textFaint });
        lab.setPos(0, cy);
        const val = new TextNode('', { font: FONTS.mono, size: 12, color: COLORS.positive });
        val.setPos(CW - 90, cy);
        panel.body.add(lab, val);
        if (f.path) bindText(val, store, f.path, f.fmt ?? null);
        cy += 22;
      }
    }
    panel._openH = METRICS.windowHeaderH + 4 + cy + PAD + fr.b;
    panel.setSize(PANEL_W, panel._openH);
    eng.layers.overlay.add(panel);
    uisound(panel, 'open');
    return panel;
  }
}

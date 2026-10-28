// The Inspector's Lens, half one: DebugConsole — a drop-down developer
// console built on VirtualList (pooled rows, unbounded-feeling scrollback with a
// hard cap). Backtick toggles it whenever nothing holds focus (the DevPanel
// bus-hotkey shape); `?console=1` arms one at boot (the entry wires it, like
// ?debug). Commands live in a registry — `register(name, fn, help)`; fn receives
// the argument string and its return value (if any) prints. Every EldEvents line
// echoes here through the non-stealing tap, so the game's own EventLog keeps its
// sink. History recalls on Up/Down; Tab completes a unique prefix.

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode, compileMarkup, fontString, fontMetrics, wrapRuns } from '../text.js';
import { COLORS, FONTS } from '../theme.js';
import { requireEngine, uisound, TextField, setNodeDisabled } from './widgets.js';
import { VirtualList } from './virtual.js';
import { EldEvents } from './events.js';
import { animateIn, animateOut } from '../animate.js';
import { str } from '../strings.js';

const MAX_LINES = 1000;
const ROW_H = 16;

export class DebugConsole extends UINode {
  // opts: { height = 0.4 (viewport fraction), hotkey = '`' }
  constructor(opts = {}) {
    super({ interactive: true }); // its own surface: presses stop at the pane
    const eng = requireEngine();
    this._frac = Number.isFinite(opts.height) && opts.height > 0 && opts.height < 1 ? opts.height : 0.4;
    this._hotkey = typeof opts.hotkey === 'string' ? opts.hotkey : '`';

    this.bg = new QuadNode({ color: COLORS.abyss1 }); // a solid sheet: scrollback must not bleed the scene through
    this.rule = new QuadNode({ color: COLORS.accent, opacity: 0.4 });
    this.list = new VirtualList({
      rowH: ROW_H,
      renderRow: (node, item) => {
        if (!node._t) {
          // items are PRE-WRAPPED lines (law — the EventLog flatten
 // idiom); the clamp guards the odd sub-pixel overshoot, not the reading path
          node._t = new TextNode('', { font: FONTS.mono, size: 11, color: COLORS.textBright, maxWidth: Math.max(24, this.w - 12), ellipsis: true }); // textBright base: unstyled runs keep the console voice
          node._t.setPos(6, 2);
          node.add(node._t);
        }
        node._t.setMaxWidth(Math.max(24, this.w - 12));
        node._t.setSegments(item.segs);
      },
    });
    this.field = new TextField({ placeholder: str('consolePrompt'), width: 400, placeholderColor: COLORS.textBright });
    this.add(this.bg, this.list, this.rule, this.field);

    this._lines = [];
    this._rows = []; // the wrap law: _lines flattened to visual lines
    this._lineRowN = []; // per-line row counts, so trims drop a WHOLE printed line
    this._history = [];
    this._hIdx = -1;
    this._commands = new Map();
    this._registerBuiltins();

    this.isOpen = false;
    this.visible = false;
    this._prevFocus = null;
    this._offEscape = null;

    // the bus hotkey fires only while NOTHING holds focus (typing a backtick into
    // a TextField stays typing); while the console is open its own field holds
    // focus, so closing rides the field's keydown below plus the Escape stack
    this._offKey = eng.bus.on('keydown', (e) => {
      if (e.key === this._hotkey) {
        e.native?.preventDefault?.();
        this.toggle();
      }
    });

    // the handleKey carve-out: while this field holds
    // focus, Tab reaches its keydown below and COMPLETES instead of walking focus —
    // the shipped feature was dead code until this flag existed
    this.field._consumesTab = true;
    this.field.on('submit', (e) => {
      const line = String(e.value ?? '').trim();
      this.field.setValue('', { silent: true });
      if (line) this.exec(line);
    });
    this.field.on('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); this._recall(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this._recall(-1); }
      else if (e.key === 'Tab') { e.preventDefault(); this._complete(); }
      else if (e.key === this._hotkey) { e.preventDefault(); this.close(); }
      // ONE Escape dismisses the console: the field's own handler consumes the press
      // and blurs first (insertion order), so without this ride-along the pane would
      // need a second press — the prompt-popup rule, same wiring
      else if (e.key === 'Escape') this.close();
    });
    this.on('wheel', (e) => e.stopPropagation()); // pane manners: never scroll the page beneath

    // the non-stealing echo: the game's own EventLog keeps the sink
    this._offTap = EldEvents.tap((msg, type) => {
      this.print(`{color:${COLORS.textFaint}}[${type}]{/} ${msg}`);
    });

    this.print(str('consoleGreeting'));
  }

  // ---- the registry ----

  register(name, fn, help = '') {
    this._commands.set(String(name), { fn, help });
    return this;
  }

  unregister(name) { return this._commands.delete(String(name)); }

  exec(line) {
    this._history.push(line);
    if (this._history.length > 100) this._history.shift();
    this._hIdx = -1;
    // the echo escapes braces: typed input must render LITERALLY (a stray {color:
    // would otherwise style the echo and spam the markup-syntax warnings); command
    // OUTPUT stays raw — print() renders markup, and `echo` doubles as a previewer
    this.print(`{color:${COLORS.accent}}>{/} ${line.replace(/\{/g, '{{')}`);
    const sp = line.indexOf(' ');
    const name = sp === -1 ? line : line.slice(0, sp);
    const rest = sp === -1 ? '' : line.slice(sp + 1).trim();
    const cmd = this._commands.get(name);
    if (!cmd) {
      this.print(`{color:${COLORS.negative}}${str('consoleUnknown', name)}{/}`);
      uisound(this, 'error', { console: true });
      return this;
    }
    try {
      const out = cmd.fn(rest, this);
      if (out != null) this.print(String(out));
    } catch (err) {
      this.print(`{color:${COLORS.negative}}${str('consoleErr', name, err?.message ?? String(err))}{/}`);
    }
    return this;
  }

  // One printed line -> N pooled rows (law): long output and \n
  // multi-line output (help) both read whole instead of clipping at the pane edge.
  _wrapLine(src) {
    const font = fontString({ size: 11, font: FONTS.mono });
    const lane = Math.max(24, (this.w || requireEngine().width) - 12);
    const lines = wrapRuns(compileMarkup(src, { font: FONTS.mono, size: 11 }), font, lane, 0, fontMetrics(font, 11).height);
    return lines.map((l) => ({ segs: l.length ? l : [{ text: '' }] }));
  }

  print(line) {
    const src = String(line);
    this._lines.push(src);
    const rows = this._wrapLine(src);
    this._lineRowN.push(rows.length);
    this._rows.push(...rows);
    while (this._lines.length > MAX_LINES) { this._lines.shift(); this._rows.splice(0, this._lineRowN.shift()); }
    this.list.setItems(this._rows);
    this.list.scrollToIndex(this._rows.length - 1);
    return this;
  }

  clear() {
    this._lines.length = 0;
    this._rows.length = 0;
    this._lineRowN.length = 0;
    this.list.setItems([]);
    return this;
  }

  _registerBuiltins() {
    this.register('help', () => {
      const names = [...this._commands.keys()].sort().map((n) => {
        const h = this._commands.get(n).help;
        return h ? `${n} — ${h}` : n;
      });
      return str('consoleKnown', '\n  ' + names.join('\n  '));
    }, str('consoleHelpDesc'));
    this.register('clear', () => { this.clear(); }, str('consoleClearDesc'));
    this.register('stats', () => {
      const eng = requireEngine();
      const s = eng.stats();
      return `draws ${s.calls} · nodes ${eng.paintList.length} · tweens ${eng.ticker.tweens.size}`
        + ` · hooks ${eng.frameHooks.size} · textures ${s.textures}`;
    }, str('consoleStatsDesc'));
    this.register('echo', (rest) => rest, str('consoleEchoDesc'));
  }

  // ---- history + completion ----

  _recall(dir) {
    const H = this._history;
    if (!H.length) return;
    if (dir > 0) { // Up: older
      this._hIdx = this._hIdx === -1 ? H.length - 1 : Math.max(0, this._hIdx - 1);
    } else { // Down: newer; stepping past the newest returns to a blank line
      if (this._hIdx === -1) return;
      this._hIdx = this._hIdx >= H.length - 1 ? -1 : this._hIdx + 1;
    }
    this.field.setValue(this._hIdx === -1 ? '' : H[this._hIdx], { silent: true });
  }

  _complete() {
    const cur = String(this.field.value ?? '');
    if (!cur || cur.includes(' ')) return;
    const hits = [...this._commands.keys()].filter((n) => n.startsWith(cur));
    if (hits.length === 1) this.field.setValue(hits[0] + ' ', { silent: true });
    else if (hits.length > 1) this.print(hits.sort().join('  '));
  }

  // ---- open/close ----

  open() {
    if (this.isOpen || this.disposed) return this;
    const eng = requireEngine();
    this.isOpen = true;
    this.visible = true;
    this._prevFocus = eng.focusedNode ?? null;
    this._prevSource = eng.focus.source; // C1: hand back with the source we took over from
    this._offEscape = eng.focus.pushEscape(() => this.close());
    uisound(this, 'open', { console: true });
    animateIn(this, 'fall');
    // promote straight to typing (the popup prompt shape)
    const v = String(this.field.value ?? '');
    eng.setFocus(this.field, { text: true, value: v, selectionStart: v.length, selectionEnd: v.length });
    return this;
  }

  close() {
    if (!this.isOpen || this.disposed) return this;
    const eng = requireEngine();
    this.isOpen = false;
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    uisound(this, 'close', { console: true });
    animateOut(this, 'rise');
    // C1: skip a holder DISABLED while the console was open; keep the captured source
    if (this._prevFocus && !this._prevFocus.disposed && !this._prevFocus.closest((a) => a.disabled === true)) eng.focus.set(this._prevFocus, this._prevSource ?? 'api');
    else eng.setFocus(null);
    this._prevFocus = null;
    this._prevSource = null;
    return this;
  }

  toggle() { return this.isOpen ? this.close() : this.open(); }

  onLayout() {
    const eng = this.engine;
    if (!eng) return;
    this.w = eng.width;
    this.h = Math.round(eng.height * this._frac);
    // the wrap law rides the pane width (the EventLog lane-latch idiom): an engine
    // resize rewraps the whole scrollback once, steady state stays free
    if (this._laneW !== this.w) {
      this._laneW = this.w;
      this._rows = []; this._lineRowN = [];
      for (const s of this._lines) { const r = this._wrapLine(s); this._lineRowN.push(r.length); this._rows.push(...r); }
      this.list.setItems(this._rows);
    }
    this.bg.setRect(0, 0, this.w, this.h);
    this.rule.setRect(0, this.h - 1, this.w, 1);
    this.list.setRect(0, 4, this.w, this.h - 40);
    this.field.setPos(8, this.h - 32);
    this.field.setSize(this.w - 16, this.field.h); // the ChatBox width-glue rule
  }

  disposeSelf() {
    if (this._offKey) { this._offKey(); this._offKey = null; }
    if (this._offTap) { this._offTap(); this._offTap = null; }
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
  }

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

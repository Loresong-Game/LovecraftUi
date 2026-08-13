// ChatBox: the COOKBOOK chat composite as a first-class widget — an EventLog
// scrollback over a TextField whose Enter submits WITHOUT blurring (you keep typing),
// with ArrowUp/Down history recall. Channel tabs stay a composition: a Tabs strip
// whose builds swap which log is visible (docs/COOKBOOK.md keeps that recipe).

import { UINode } from '../node.js';
import { VBox } from '../layoutbox.js';
import { TextField, setNodeDisabled, requireEngine } from './widgets.js';
import { EventLog } from './components.js';
import { makeResizable } from './grip.js';
import { str } from '../strings.js';

const FIELD_GAP = 6; // the game-hud composite's shipped spacing

export class ChatBox extends UINode {
  // opts: { width = 360, height = 170 (scrollback + gap + field), placeholder,
  //         maxEntries, register (forwarded to the EventLog's EldEvents registration —
  //         default true, so EldEvents.log lines land in the chat like the flagship),
  //         markup (forwarded to the scrollback: logged messages parse
 // {color}/{icon}/{b}/{i} runs — opt-in),
  //         virtual (forwarded: the scrollback windows over pooled rows — bounded
 // GPU, unbounded history — opt-in), onSubmit(value) }
  constructor(opts = {}) {
    super({});
    requireEngine(); // friendly pre-init message before any child constructs
    this.onSubmit = opts.onSubmit ?? null;
    // echo: false — a VOICED chat owns its lines: the page renders the
    // send in its channel voice off the `submit` event, so the widget's raw SAY
    // echo would double every line. Default true keeps the MUD/command form.
    this.echo = opts.echo !== false;
    this.history = [];
    // the ArrowUp/Down recall buffer is capped (X07: it was unbounded — a long MUD
    // session grew it without limit; the scrollback has its own maxEntries). Per
    // instance, so it dies with the widget, but a session-long field still shouldn't leak.
    this.maxHistory = Number.isFinite(opts.maxHistory) ? Math.max(1, Math.floor(opts.maxHistory)) : 200;
    this._at = 0; // the recall cursor (a local, never shadowing window.history)
    const width = opts.width ?? 360;
    const height = opts.height ?? 170;

    this.field = new TextField({
      placeholder: opts.placeholder ?? str('chatPlaceholder'),
      width,
      onSubmit: (v) => this._submit(v),
    });
    this.scrollback = new EventLog({
      width,
      height: Math.max(40, height - this.field.h - FIELD_GAP),
      maxEntries: opts.maxEntries,
      register: opts.register,
      markup: opts.markup,
      virtual: opts.virtual,
    });
    // the two lanes ride a VBox — the scrollback flexes into whatever the
    // field leaves free, both stretch to the widget width; a grip resize just
    // re-drives the lane and the box re-derives the split
    this.lane = new VBox({ gap: FIELD_GAP, align: 'stretch', autoWidth: false, autoHeight: false });
    this.lane.add(this.scrollback, this.field);
    this.lane.flex(this.scrollback, 1);
    this.add(this.lane);

    // The field's own `submit {value}` BUBBLES through this node — that bubble IS the
    // ChatBox's submit event (never re-dispatch what bubbles: the UnitFrame lesson).
    // Empty lines stop here so a ChatBox-level submit always means a real submission.
    this.field.on('submit', (e) => { if (!e.value.trim()) e.stopPropagation(); });

    this.field.on('keydown', (e) => {
      if (e.key === 'ArrowUp' && this.history.length) {
        e.preventDefault();
        this._at = Math.max(0, this._at - 1);
        this.field.setValue(this.history[this._at]);
      } else if (e.key === 'ArrowDown' && this.history.length) {
        e.preventDefault();
        this._at = Math.min(this.history.length, this._at + 1);
        this.field.setValue(this.history[this._at] ?? '');
      }
    });

    this.setSize(width, height);

    // The opt-in resize grip — default corner 'tl' by requirement;
    // the grip's pin duck-type keeps an at-bottom reader pinned through the
    // resize, and onLayout re-lays the scrollback/field at every new size.
    this.grip = null;
    if (opts.resizable) {
      const r = opts.resizable === true ? {} : opts.resizable;
      this.grip = makeResizable(this, {
        corner: r.corner ?? 'tl', minW: r.minW ?? 220, minH: r.minH ?? 120,
        maxW: r.maxW, maxH: r.maxH, onResize: r.onResize,
      });
    }
  }

  _submit(v) {
    if (!v.trim()) return;
    if (this.echo) this.scrollback.log(v, 'SAY');
    this.history.push(v);
    if (this.history.length > this.maxHistory) this.history.shift(); // drop the oldest recall line
    this._at = this.history.length;
    this.field.setValue('');
    if (this.onSubmit) this.onSubmit(v);
  }

  // The scrollback's own surface, re-exposed so consumers never reach inside.
  log(message, type) { this.scrollback.log(message, type); }
  clear() { this.scrollback.clear(); }
  get atBottom() { return this.scrollback.atBottom; } // the pin predicate
  scrollToBottom() { this.scrollback.scrollToBottom(); } // the explicit re-pin

  // Enter-to-chat: hand the keyboard to the input bar — the
  // MMO convention. Bind it page-side with Eldritch.onKey('Enter', { down: () =>
  // chat.focusInput() }); the bus door only opens while nothing holds focus, so a
  // focused button's Enter still activates the button and typing is never stolen.
  // Whether a SUBMIT hands the keyboard back is the page's call: a chat does
  // (engine.setFocus(null) in onSubmit — send and return to the game), a MUD
  // command line does not (you keep typing commands).
  focusInput() { this.field.focusEdit(); }

  // the pin holds through ANY resize, not only the grip's — the contract
  // reads "pin-to-bottom holds through resize", and a consumer's resize IS a resize.
  // Same idiom as the grip: read the pin BEFORE the mutation.
  // the hook hangs on setRect, THE funnel — setSize/setPos both delegate down
  // to it (node.js), so a setSize override is invisible to every setRect caller (the
  // grip drives resizes with host.setRect). Position-only writes fall through the
  // size guard untouched.
  setRect(x, y, w, h) {
    if (w === this.w && h === this.h) return super.setRect(x, y, w, h);
    const pin = this.scrollback ? this.atBottom === true : false;
    super.setRect(x, y, w, h);
    if (pin) this.scrollToBottom();
  }

  setDisabled(v) { setNodeDisabled(this, v); } // seals typing, scrolling, and recall

  onLayout() {
    this.lane.setRect(0, 0, this.w, this.h); // the box derives the two-lane split
  }
}

// Gamepad navigation: standard-mapping pads drive the focus manager.
// Polled from the ticker; edge detection and repeat timing run on TICKER time, so tab
// suspends and virtual-time test harnesses stay coherent (performance.now would burst
// after a suspend). The pad source is injectable for tests:
//   new GamepadNav(engine, { getGamepads: () => [fakePad] })
// Mapping (standard layout): A activates, B cancels (routed as Escape through the
// focused widget first), LB/RB cycle focus, d-pad / left stick route through the
// focused widget FIRST as arrow keys (a menu walks its rows, a slider nudges, a
// virtual list steps its focus row — keyboard parity) and fall back to spatial
// moves, right stick scrolls the focused (else hovered) scroll area.

const DEADZONE = 0.5;
const REPEAT_DELAY = 0.35; // seconds of ticker time before the first repeat
const REPEAT_RATE = 0.12;  // seconds between repeats while held
const SCROLL_SPEED = 600;  // px/second at full stick deflection

const DEFAULT_MAP = {
  activate: 0, cancel: 1, prevFocus: 4, nextFocus: 5,
  dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
};

export class GamepadNav {
  constructor(engine, { getGamepads = null, map = null } = {}) {
    this.engine = engine;
    this.map = { ...DEFAULT_MAP, ...(map ?? {}) };
    this.getGamepads = getGamepads ??
      (typeof navigator !== 'undefined' && navigator.getGamepads
        ? navigator.getGamepads.bind(navigator)
        : () => []);
    this._prev = [];
    this._hadPad = false; // set on first sight of a pad; cleared on disconnect
    this._moveHeld = null;
    this._moveNext = 0;
    this._off = engine.ticker.add((dt, t) => this._poll(dt, t));
  }

  dispose() { this._off?.(); this._off = null; }

  _poll(dt, t) {
    const pads = this.getGamepads() || [];
    let pad = null;
    for (const p of pads) { if (p && p.connected !== false) { pad = p; break; } }
    if (!pad) { this._prev = []; this._moveHeld = null; this._hadPad = false; return; }
    if (!this._hadPad) {
      // first sight (connect or RE-connect): seed edges from the current state so a
      // button held across the gap doesn't fire a spurious activate/cancel this poll
      this._hadPad = true;
      this._prev = (pad.buttons ?? []).map(b => !!b?.pressed);
    }

    const focus = this.engine.focus;
    const pressed = (i) => !!pad.buttons?.[i]?.pressed;
    const edge = (i) => pressed(i) && !this._prev[i];
    let used = false; // any consumed edge/direction/stick marks the pad as the live device

    if (edge(this.map.activate)) {
      used = true;
      if (focus.node) focus.activate('gamepad');
      else focus.next('gamepad'); // first press enters the interface
    }
    if (edge(this.map.cancel)) { used = true; this._cancel(); }
    if (edge(this.map.nextFocus)) { used = true; focus.next('gamepad'); }
    if (edge(this.map.prevFocus)) { used = true; focus.prev('gamepad'); }

    // direction: d-pad wins, else the left stick past its deadzone
    const ax = pad.axes?.[0] ?? 0, ay = pad.axes?.[1] ?? 0;
    let dir = null;
    if (pressed(this.map.dpadLeft) || ax < -DEADZONE) dir = 'left';
    else if (pressed(this.map.dpadRight) || ax > DEADZONE) dir = 'right';
    else if (pressed(this.map.dpadUp) || ay < -DEADZONE) dir = 'up';
    else if (pressed(this.map.dpadDown) || ay > DEADZONE) dir = 'down';

    if (dir) {
      used = true;
      if (dir !== this._moveHeld) {
        this._moveHeld = dir;
        this._move(dir);
        this._moveNext = t + REPEAT_DELAY;
      } else if (t >= this._moveNext) {
        this._move(dir);
        this._moveNext = t + REPEAT_RATE;
      }
    } else {
      this._moveHeld = null;
    }

    const ry = pad.axes?.[3] ?? 0;
    if (Math.abs(ry) > DEADZONE) { used = true; this._scroll(ry * SCROLL_SPEED * dt); }
    const rx = pad.axes?.[2] ?? 0;
    if (Math.abs(rx) > DEADZONE) { used = true; this._scrollX(rx * SCROLL_SPEED * dt); }

    if (used) this.engine.noteDevice('pad'); // real input, not mere presence, flips the device
    this._prev = (pad.buttons ?? []).map(b => !!b?.pressed);
  }

  _move(dir) {
    const focus = this.engine.focus;
    if (!focus.node) { focus.next('gamepad'); return; }
    // The direction routes through the focused widget FIRST (the _cancel/Escape
    // shape): every arrow-consuming widget preventDefaults, so a menu walks its
    // rows, a slider nudges, a select steps its options, a panzoom pans — exactly
    // what the keyboard does. Spatial movement is the unconsumed fallback.
    const key = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir];
    const evt = focus.node.dispatch('keydown', { key, code: key });
    if (evt.defaultPrevented) return;
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    focus.move(dx, dy, 'gamepad');
  }

  // B routes as Escape through the focused widget FIRST (a text field consumes it and
  // blurs; a select closes its dropdown); the stack/blur fallback mirrors the keyboard.
  _cancel() {
    const node = this.engine.focus.node;
    if (node) {
      const evt = node.dispatch('keydown', { key: 'Escape', code: 'Escape' });
      if (evt.defaultPrevented) return;
      this.engine.focus.cancel();
      return;
    }
    // B10: nothing focused — mirror the keyboard plane EXACTLY (input.js emits the bus
    // keydown there; the drag system's Escape listener and the focus manager both hear
    // it, so gamepad B now cancels a live drag with keyboard-Escape parity)
    this.engine.bus.emit('keydown', { key: 'Escape', code: 'Escape' });
  }

  _scroll(dy) {
    let area = this.engine.focus.node ?? this.engine.hover.target;
    // hover can rest inside a disabled subtree (enter/leave still deliver there), and a
    // sealed area is inert to the stick exactly as it is to the wheel — but the walk
    // continues PAST it so an enclosing live area still scrolls (scroll-chaining parity)
    while (area) {
      if (typeof area.scrollBy === 'function' && area.maxScroll > 0 &&
          !area.closest(n => n.disabled === true)) { area.scrollBy(dy); return; }
      area = area.parent;
    }
  }

  // The stick's X mirrors _scroll on the horizontal duck-type (setScrollX/maxScrollX) —
  // horizontal-only lanes like the overflowed taskbar strip scroll too. Same seal chain.
  _scrollX(dx) {
    let area = this.engine.focus.node ?? this.engine.hover.target;
    while (area) {
      if (typeof area.setScrollX === 'function' && area.maxScrollX > 0 &&
          !area.closest(n => n.disabled === true)) { area.setScrollX(area.content.scrollX + dx); return; }
      area = area.parent;
    }
  }
}

// Canvas pointer plumbing, click synthesis, keyboard routing via a hidden DOM input (IME/repeat/paste
// for free), and cursor application. Pointer capture keeps drags alive outside the canvas.

import { hitTest } from './hit.js';
import { UIEvent } from './node.js';

export class Emitter {
  constructor() { this._m = new Map(); }
  on(t, fn) { let s = this._m.get(t); if (!s) { s = new Set(); this._m.set(t, s); } s.add(fn); return () => s.delete(fn); }
  off(t, fn) { this._m.get(t)?.delete(fn); }
  emit(t, data) { const s = this._m.get(t); if (s) for (const fn of [...s]) fn(data); }
}

export class InputSystem {
  constructor(engine, canvas) {
    this.engine = engine;
    this.canvas = canvas;
    this._cursor = '';
    this._rect = null;
    this._downTargets = new Map(); // pointerId -> {target, pos, button}
    this._inertRightDowns = new Map(); // pointerId -> {target, pos} — sealed hits whose right-click still asks the radial chain
    this._pan = null;
    this._offs = [];
    this._suppressMenuOnce = false;
    this._longPress = new Map();   // pointerId -> {target, x, y, stop}
    this._longFired = new Set();   // pointerIds whose long-press consumed the tap
    this._touchPan = new Map();    // pointerId -> {area, startY, startScroll, active, lastY, lastT, vel}
    this._inertiaStops = new Set();

    this.hiddenInput = document.createElement('input');
    this.hiddenInput.type = 'text';
    this.hiddenInput.setAttribute('autocomplete', 'off');
    // never a host tab stop - an invisible input in the document tab order
    // was the one no-click way the keyboard "woke up", which is a bug wearing a
    // feature's clothes (bootFocus owns waking the keyboard now).
    this.hiddenInput.setAttribute('tabindex', '-1');
    this.hiddenInput.style.cssText =
      'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;border:0;padding:0;background:transparent;color:transparent;caret-color:transparent;pointer-events:none;z-index:-1;';
    document.body.appendChild(this.hiddenInput);

    this._attach();
  }

  _pos(e) {
    if (!this._rect) this._rect = this.canvas.getBoundingClientRect();
    const s = this.engine.uiScale || 1; // client css → the engine's LOGICAL px
    return { x: (e.clientX - this._rect.left) / s, y: (e.clientY - this._rect.top) / s };
  }

  refreshRect() { this._rect = null; }

  // Every listener registers through here so dispose() can unwind them all.
  _listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._offs.push(() => target.removeEventListener(type, fn, opts));
  }

  dispose() {
    this._endPan();
    for (const lp of this._longPress.values()) lp.stop();
    this._longPress.clear();
    for (const stop of this._inertiaStops) stop();
    this._inertiaStops.clear();
    this._touchPan.clear();
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._downTargets.clear();
    this.hiddenInput.remove();
  }

  // Widget-initiated mid-gesture ownership transfer (the touch drag-vs-scroll promotion
  // at pointermove, exposed as a public seam): capture moves to `node`, the previous
  // holder gets a canceled pointerup (press visuals release), the press is forgotten so
  // no click will synthesize, and any long-press arm dies. Returns the previous holder.
  // PanZoomSurface promotes its drag-pan through here once the drag threshold is crossed.
  claimDrag(pointerId, node) {
    const engine = this.engine;
    const held = engine.captures.get(pointerId) ?? null;
    this._downTargets.delete(pointerId);
    this._touchPan.delete(pointerId); // a claimed pointer must not keep scroll-panning
    this._cancelLongPress(pointerId);
    engine.captures.set(pointerId, node);
    if (held && held !== node) {
      held.dispatch('pointerup', { x: engine.pointer.x, y: engine.pointer.y, button: 0, pointerId, canceled: true });
    }
    return held;
  }

  // Subtree-scoped gesture seal (convention 3: disabled = no capture). Every in-flight
  // gesture whose owner sits inside `root` cancels through the SAME canceled-finish path
  // a native pointercancel / window blur takes, so each owner's own canceled-up cleanup
  // runs: a slider commits its moved value, panzoom clears its press map, a touch pan
  // just stops, long-press arms die. setNodeDisabled calls this when a subtree seals.
  cancelCapturesWithin(root) {
    const engine = this.engine;
    const inside = (n) => !!n && !!n.closest((a) => a === root);
    const ids = new Set();
    for (const [id, node] of engine.captures) if (inside(node)) ids.add(id);
    for (const [id, dt] of this._downTargets) if (inside(dt.target)) ids.add(id);
    for (const [id, tp] of this._touchPan) if (inside(tp.area)) ids.add(id);
    for (const [id, lp] of this._longPress) if (inside(lp.target)) ids.add(id);
    // A flick already coasting a scroll area inside the subtree stops dead.
    for (const stop of [...this._inertiaStops]) if (inside(stop.area)) stop();
    // A middle-button pan of an area inside the subtree dies too (pans hold no capture).
    // Any OTHER live pan must also end before the loop: finish()'s cancel short-circuit
    // would otherwise consume the first id (cancelActive ends pans the same way).
    if (this._pan && (inside(this._pan.area) || ids.size)) this._endPan();
    if (!ids.size) return;
    if (!this._rect) this._rect = this.canvas.getBoundingClientRect(); // the _pos cache idiom (this path re-measured twice per id)
    const rect = this._rect;
    const us = engine.uiScale || 1; // pointer is logical; the synthetic event speaks client css
    for (const id of ids) {
      this._finish({
        clientX: rect.left + engine.pointer.x * us, clientY: rect.top + engine.pointer.y * us,
        pointerId: id, button: -1, pointerType: 'mouse',
      }, true);
    }
  }

  // ---- touch helpers: long-press, drag-vs-scroll pan intent, inertia ----

  _armLongPress(id, target, p) {
    const ticker = this.engine.ticker;
    const start = ticker.time;
    const entry = {
      target, x: p.x, y: p.y,
      stop: ticker.add(() => {
        if (ticker.time - start < 0.45) return;
        entry.stop();
        this._longPress.delete(id);
        this._longFired.add(id); // the release must not also synthesize a click
        target.dispatch('longpress', { x: entry.x, y: entry.y, pointerId: id });
      }),
    };
    this._longPress.set(id, entry);
  }

  _cancelLongPress(id) {
    const lp = this._longPress.get(id);
    if (lp) { lp.stop(); this._longPress.delete(id); }
  }

  _haltInertia() {
    for (const stop of this._inertiaStops) stop();
    this._inertiaStops.clear();
  }

  _startInertia(area, velocity, axis = 'y') {
    if (Math.abs(velocity) < 50) return;
    let vel = -velocity; // content moves opposite the finger
    const ticker = this.engine.ticker;
    // axis 'x' rides setScrollX (ScrollArea has no scrollByX); 'y' keeps the shipped path
    const read = () => (axis === 'x' ? area.content.scrollX : area.content.scrollY);
    const step = (d) => (axis === 'x' ? area.setScrollX(area.content.scrollX + d) : area.scrollBy(d));
    const stop = ticker.add((dt) => {
      vel *= Math.max(0, 1 - 4 * dt); // exponential-ish decay
      if (Math.abs(vel) < 20) { remove(); return; }
      const before = read();
      step(vel * dt);
      if (read() === before) remove(); // hit an edge
    });
    const remove = () => { stop(); this._inertiaStops.delete(remove); };
    remove.area = area; // cancelCapturesWithin stops coasts inside a sealing subtree
    this._inertiaStops.add(remove);
  }

  _attach() {
    const canvas = this.canvas;
    const engine = this.engine;
    canvas.style.touchAction = 'none';

    // The cached canvas rect goes stale whenever the page scrolls or the window resizes.
    // Both sizing modes need this (fixed-size engines previously installed no listeners,
    // so their rect was captured once and never corrected).
    this._listen(window, 'scroll', () => this.refreshRect(), { capture: true, passive: true });
    this._listen(window, 'resize', () => this.refreshRect());

    this._listen(canvas, 'pointerenter', () => { engine.pointerInside = true; });
    this._listen(canvas, 'pointerleave', (e) => {
      engine.pointerInside = false;
      engine.requestRender(); // hover-art reverts happen without any further activity
      if (!engine.capturedNode) engine.hover.update(-1, -1, true);
      engine.bus.emit('pointerleavecanvas', e);
    });

    this._listen(canvas, 'pointerdown', (e) => {
      const p = this._pos(e);
      const id = e.pointerId ?? 1;
      engine.pointer.x = p.x; engine.pointer.y = p.y;
      engine.pointerInside = true;
      if (e.button === 1) {
        // middle-button pan: browser autoscroll can't drive our custom scroll areas, so provide it
        e.preventDefault();
        this._startPan(p, id);
        return;
      }
      if (e.button !== 0 && e.button !== 2) return; // back/forward etc.: native behavior
      if (this._pan) this._endPan();
      this._haltInertia(); // a new touch grabs any coasting scroll
      // Scope keyboard routing to the interface: while the canvas (or the hidden text
      // input, focused below by text widgets) holds DOM focus, keys route to the UI;
      // a host page's own inputs keep their keys otherwise. Must happen BEFORE widget
      // dispatch so a text widget's hiddenInput.focus() wins afterwards.
      try { canvas.focus({ preventScroll: true }); } catch { /* detached canvas */ }
      try { canvas.setPointerCapture(id); } catch { /* synthetic events */ }
      const isTouch = e.pointerType === 'touch';
      const target = hitTest(engine, p.x, p.y, isTouch ? 4 : 0); // touch hit-slop
      // A disabled widget (or anything inside a disabled container) is inert: it still
      // occludes what is beneath it, but takes no press, no capture, and can never
      // synthesize a click — including for listeners consumers attached themselves.
      // Enter/leave still deliver (tooltips on a locked control stay useful), and the
      // bus event below still fires so windows raise when their chrome is clicked.
      const inert = target ? !!target.closest(n => n.disabled === true) : false;
      // Clicking anywhere the focused widget doesn't own blurs it (DOM semantics).
      // `focusOwns` lets a widget claim detached subtrees (e.g. a select's reparented dropdown).
      const focused = engine.focusedNode;
      if (focused && !(target && (target === focused || focused.isAncestorOf(target) || focused.focusOwns?.(target)))) {
        engine.setFocus(null);
      }
      engine.focus.source = 'pointer'; // pointer presses never show the focus ring
      if (!inert && target) {
        this._downTargets.set(id, { target, pos: p, button: e.button });
        engine.captures.set(id, target);
      } else {
        this._downTargets.delete(id);
        engine.captures.delete(id);
      }
      // A sealed widget stays DEAF (convention 3: no capture, no rightclick
      // synthesis) — but the right-click GESTURE still deserves an answer, so
      // remember the inert hit and let finish() walk the radial chain from the
      // first enabled ancestor.
      if (inert && target && e.button === 2) this._inertRightDowns.set(id, { target, pos: p });
      else this._inertRightDowns.delete(id);
      engine.requestRender(); // press visuals (fx fields) have no layout signal
      engine.noteDevice('kbm'); // presses flip the last-used device; motion never does
      engine.bus.emit('pointerdown', { x: p.x, y: p.y, button: e.button, pointerId: id, target, native: e });
      if (target && !inert) {
        target.dispatch('pointerdown', { x: p.x, y: p.y, button: e.button, pointerId: id, native: e });
      }
      // Touch intents: long-press (tooltips) and drag-vs-scroll. A touch that lands on a
      // drag-owning widget (slider, scrollbar thumb, window header, draggable icon, text
      // field) belongs to that widget; anything else inside a scrollable area may become
      // a pan once it moves past the intent threshold.
      if (isTouch && target && !inert && e.button === 0) {
        this._armLongPress(id, target, p);
        if (!target.closest(n => n.touchDragOwner === true)) {
          // horizontal-only lanes (the taskbar strip) pan too: either axis qualifies
          let area = target;
          while (area && !(typeof area.scrollBy === 'function' && (area.maxScroll > 0 || area.maxScrollX > 0))) area = area.parent;
          if (area) {
            this._touchPan.set(id, {
              area, startY: p.y, startScroll: area.content.scrollY,
              startX: p.x, startScrollX: area.content.scrollX, lastX: p.x, velX: 0,
              active: false, lastY: p.y, lastT: engine.ticker.time, vel: 0,
            });
          }
        }
      }
      e.preventDefault();
    });

    this._listen(canvas, 'pointermove', (e) => {
      const p = this._pos(e);
      const id = e.pointerId ?? 1;
      engine.pointer.x = p.x; engine.pointer.y = p.y;
      engine.pointerMoved = true;

      // long-press dies the moment the finger travels
      const lp = this._longPress.get(id);
      if (lp && Math.hypot(p.x - lp.x, p.y - lp.y) > 5) this._cancelLongPress(id);

      // drag-vs-scroll: past the intent threshold the gesture becomes a pan — the
      // pressed widget is released (canceled up) and this pointer stops clicking.
      const tp = this._touchPan.get(id);
      if (tp) {
        const dy = p.y - tp.startY;
        const dx = p.x - tp.startX;
        // promotion needs movement along an axis the area can actually scroll —
        // a horizontal swipe on a vertical-only area must stay a click
        const canY = tp.area.maxScroll > 0, canX = tp.area.maxScrollX > 0;
        if (!tp.active && ((canY && Math.abs(dy) > 6) || (canX && Math.abs(dx) > 6))) {
          tp.active = true;
          this._cancelLongPress(id);
          const held = engine.captures.get(id);
          engine.captures.delete(id);
          this._downTargets.delete(id);
          held?.dispatch('pointerup', { x: p.x, y: p.y, button: 0, pointerId: id, canceled: true, native: e });
        }
        if (tp.active) {
          if (canY) tp.area.setScroll(tp.startScroll - dy);
          if (canX) tp.area.setScrollX(tp.startScrollX - dx);
          const t = engine.ticker.time;
          tp.vel = (p.y - tp.lastY) / Math.max(1e-3, t - tp.lastT);
          tp.velX = (p.x - tp.lastX) / Math.max(1e-3, t - tp.lastT);
          tp.lastY = p.y; tp.lastX = p.x; tp.lastT = t;
          engine.bus.emit('pointermove', { x: p.x, y: p.y, pointerId: id, native: e });
          return; // the pan owns this pointer's moves
        }
      }

      engine.bus.emit('pointermove', { x: p.x, y: p.y, pointerId: id, native: e });
      const routed = engine.captures.get(id);
      if (routed) {
        routed.dispatch('pointermove', { x: p.x, y: p.y, pointerId: id, native: e });
      } else if (engine.captures.size === 0) {
        engine.hover.update(p.x, p.y);
        if (engine.hover.target) engine.hover.target.dispatch('pointermove', { x: p.x, y: p.y, pointerId: id, native: e });
      }
      // an uncaptured pointer during someone else's gesture does nothing (interaction guard)
    });

    const finish = (e, canceled) => {
      // A real pointercancel during a live middle-button pan ends the pan AND
      // falls through to release that pointer's capture/press state (// the early return stranded the other pointer's drag forever; the
 // synthetic cancel paths were safe only because they end the pan first).
      // A middle-button POINTERUP still returns: pans hold no capture.
      if (this._pan && (e.button === 1 || canceled)) {
        this._endPan();
        if (!canceled) return;
      }
      // pointercancel reports button -1; it must still clear capture/press state
      // or a canceled touch/stylus drag leaves the gesture stuck forever.
      if (e.button !== 0 && e.button !== 2 && !canceled) return;
      const p = this._pos(e);
      const id = e.pointerId ?? 1;
      this._cancelLongPress(id);
      // read+delete BELOW finish's early returns by design (review): a
      // chorded middle-button up on the same pointer takes those returns and
      // must NOT eat a live sealed right press — its right-up is still coming
      const inertDown = this._inertRightDowns.get(id) ?? null;
      this._inertRightDowns.delete(id);
      const tp = this._touchPan.get(id);
      if (tp) {
        this._touchPan.delete(id);
        if (tp.active) {
          // a completed pan releases with inertia (per capable axis) and never clicks
          if (!canceled) {
            if (tp.area.maxScroll > 0) this._startInertia(tp.area, tp.vel);
            if (tp.area.maxScrollX > 0) this._startInertia(tp.area, tp.velX, 'x');
          }
          engine.bus.emit(canceled ? 'pointercancel' : 'pointerup', { x: p.x, y: p.y, button: e.button, pointerId: id, native: e });
          engine.hover.update(p.x, p.y, true);
          return;
        }
      }
      if (this._longFired.has(id)) {
        // the long-press consumed this tap: release state quietly, no click
        this._longFired.delete(id);
        const held = engine.captures.get(id);
        engine.captures.delete(id);
        this._downTargets.delete(id);
        held?.dispatch('pointerup', { x: p.x, y: p.y, button: e.button, pointerId: id, canceled: true, native: e });
        engine.hover.update(p.x, p.y, true);
        return;
      }
      const captured = engine.captures.get(id) ?? null;
      engine.captures.delete(id);
      const down = this._downTargets.get(id) ?? null;
      this._downTargets.delete(id);
      engine.requestRender(); // release visuals + hover re-evaluation below
      engine.bus.emit(canceled ? 'pointercancel' : 'pointerup', { x: p.x, y: p.y, button: e.button, pointerId: id, native: e });
      const upHit = hitTest(engine, p.x, p.y, e.pointerType === 'touch' ? 4 : 0);
      if (captured) captured.dispatch('pointerup', { x: p.x, y: p.y, button: e.button, pointerId: id, canceled, native: e });
      else if (upHit && !upHit.closest(n => n.disabled === true)) upHit.dispatch('pointerup', { x: p.x, y: p.y, button: e.button, pointerId: id, canceled, native: e });
      if (!canceled && down &&
          upHit && (upHit === down.target || down.target.isAncestorOf(upHit))) {
        if (down.button === 2) {
          // Right-click synthesis: preventDefault() on it suppresses the next native
          // context menu (once), so consumers can hang their own menus on it.
          const evt = down.target.dispatch('rightclick', { x: p.x, y: p.y, pointerId: id, native: e });
          if (evt.defaultPrevented) this._suppressMenuOnce = true;
          // The radial chain: an UNCONSUMED right-click asks the fallback
          // dispatcher (installed by the lantern bearer at boot) — the nearest
          // radialItems provider up the parent chain, else the registered ground
          // wheel. A wheel that opens arms the same one-shot native suppression.
          else if (!evt.stopped && engine.radialFallback
              && engine.radialFallback(down.target, p.x, p.y, e) === true) this._suppressMenuOnce = true;
        } else {
          down.target.dispatch('click', { x: p.x, y: p.y, pointerId: id, native: e });
        }
      } else if (!canceled && inertDown && upHit
          && (upHit === inertDown.target || inertDown.target.isAncestorOf(upHit))) {
        // Sealed-target right-click: the widget never hears it (convention 3
        // holds — no rightclick synthesis into a disabled subtree), but the CHAIN
        // starts above the outermost sealed ancestor: "an object with no custom
        // radial always falls back", disabled included. Providers inside the seal
        // are skipped by construction.
        let outer = null;
        for (let a = inertDown.target; a; a = a.parent) if (a.disabled === true) outer = a;
        const from = outer ? outer.parent : null;
        if (from && engine.radialFallback && engine.radialFallback(from, p.x, p.y, e) === true) {
          this._suppressMenuOnce = true;
        }
      }
      engine.hover.update(p.x, p.y, true);
    };
    this._listen(canvas, 'pointerup', (e) => finish(e, false));
    this._listen(canvas, 'pointercancel', (e) => finish(e, true));
    this._finish = finish; // cancelCapturesWithin routes subtree cancels through this funnel

    // Losing the window mid-gesture (alt-tab, an OS dialog) never delivers a pointerup:
    // cancel every active pointer through the same path a native pointercancel takes,
    // or drags, ghosts, and pressed states stay stuck until the next real pointer event.
    const cancelActive = () => {
      if (this._pan) this._endPan();
      const ids = new Set([
        ...engine.captures.keys(),
        ...this._downTargets.keys(),
        ...this._touchPan.keys(),
      ]);
      if (!ids.size) return;
      if (!this._rect) this._rect = canvas.getBoundingClientRect(); // the _pos cache idiom
      const rect = this._rect;
      const us = engine.uiScale || 1; // pointer is logical; the synthetic event speaks client css (the sibling at cancelCapturesWithin had this multiply; this path lacked it, so a uiScale-2 blur-cancel landed at HALF the pointer position and canceled the wrong node)
      for (const id of ids) {
        finish({
          clientX: rect.left + engine.pointer.x * us, clientY: rect.top + engine.pointer.y * us,
          pointerId: id, button: -1, pointerType: 'mouse',
        }, true);
      }
    };
    this._listen(window, 'blur', cancelActive);
    this._listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') cancelActive();
    });

    this._listen(canvas, 'contextmenu', (e) => {
      if (this._suppressMenuOnce) {
        this._suppressMenuOnce = false;
        e.preventDefault();
        return;
      }
      // init({ contextMenu: false }) — the canvas owns its right-click wholesale
      // pages that wire radial context wheels pass it, and because the
      // listener is CANVAS-scoped a host document around an embedded stage keeps
      // its native menu outside the canvas. Default true: behavior unchanged.
      if (!this.engine.contextMenu) e.preventDefault();
      // otherwise: native context menu keeps its behavior
    });

    this._listen(canvas, 'wheel', (e) => {
      const p = this._pos(e);
      // Normalize: Firefox reports line-mode deltas (~3 per notch), page mode is rare.
      // B9: deltaX rides the same multiplier — native trackpad horizontal swipes and
      // tilt-wheels must reach the X lanes instead of dying here.
      const mul = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? engine.height : 1;
      const dy = e.deltaY * mul;
      const dx = e.deltaX * mul;
      const target = hitTest(engine, p.x, p.y);
      // Disabled is inert for wheel too, subtree-scoped like the press paths — but with
      // scroll-chaining semantics: dispatch from the nearest ancestor OUTSIDE the
      // outermost disabled subtree, so a disabled control inside a live scroll area
      // never kills its scrolling, while a disabled (sealed) scroll area never consumes.
      let wheelTarget = target;
      if (target) {
        let sealed = null;
        for (let n = target; n; n = n.parent) if (n.disabled === true) sealed = n;
        if (sealed) wheelTarget = sealed.parent;
      }
      let consumed = false;
      if (wheelTarget) {
        const evt = wheelTarget.dispatch('wheel', { x: p.x, y: p.y, deltaY: dy, deltaX: dx, native: e });
        consumed = evt.stopped || evt.defaultPrevented;
      }
      engine.bus.emit('wheel', { x: p.x, y: p.y, deltaY: dy, deltaX: dx, target });
      // Only claim the wheel when something in the UI actually consumed it (a scrollable
      // area, the popup scrim). Otherwise the host page keeps scrolling normally.
      if (consumed) e.preventDefault();
    }, { passive: false });

    this._listen(window, 'keydown', (e) => {
      if (e.isComposing) return; // IME composition delivers text via the hidden input
      // Keyboard routing is scoped: only while the canvas or the hidden text input holds
      // DOM focus does the interface see keys. A host page's own form fields keep theirs.
      const ae = document.activeElement;
      if (ae !== canvas && ae !== this.hiddenInput) return;
      engine.noteDevice('kbm'); // any UI-scoped key marks keyboard+mouse as current
      // The focus manager owns Tab traversal outright.
      if (engine.focus.handleKey(e)) { e.preventDefault(); return; }
      const focused = engine.focusedNode;
      if (focused) {
        const evt = focused.dispatch('keydown', { key: e.key, code: e.code, native: e });
        if (evt.defaultPrevented) { e.preventDefault(); return; }
        // Unconsumed by the widget: Escape walks the escape stack; Enter/Space activate.
        if (e.key === 'Escape') {
          if (engine.focus.cancel()) e.preventDefault();
        } else if (e.key === 'Enter' || e.key === ' ') {
          if (engine.focus.activate('key')) e.preventDefault();
        } else if (!focused._wantsTextInput) {
          // 3.2.x: an unconsumed key on a focused NON-TEXT widget falls through to the
          // bus. Without this, one Tab press (focus lands on a button) left every
          // Eldritch.onKey hotkey deaf until a click cleared focus — a live-input
          // drive caught social-hud's whole keyboard dead after a single traversal.
          // Text-bearing widgets never leak (typing stays typing); a widget that wants
          // a key for itself preventDefaults it (KeybindField's capture); Escape,
          // Enter and Space stay with the focus system above.
          engine.bus.emit('keydown', { key: e.key, code: e.code, native: e });
        }
      } else {
        engine.bus.emit('keydown', { key: e.key, code: e.code, native: e });
      }
    });

    // KEYUP rides the same DOM scoping as keydown, but is NOT gated on focus the way
    // keydown is. A release is a state RESET: a page holding "sprint" or "scoreboard
    // open" that misses its keyup because the user clicked a text field mid-hold is
    // stuck on forever, which is worse than a spurious release. Consumers that must not
    // see strays use Eldritch.onKey, which only delivers `up` for keys it saw go down.
    this._listen(window, 'keyup', (e) => {
      if (e.isComposing) return;
      const ae = document.activeElement;
      if (ae !== canvas && ae !== this.hiddenInput) return;
      const focused = engine.focusedNode;
      if (focused) focused.dispatch('keyup', { key: e.key, code: e.code, native: e });
      engine.bus.emit('keyup', { key: e.key, code: e.code, native: e });
    });

    this._listen(this.hiddenInput, 'input', () => {
      const focused = engine.focusedNode;
      if (focused) {
        focused.dispatch('textinput', {
          value: this.hiddenInput.value,
          selectionStart: this.hiddenInput.selectionStart,
          selectionEnd: this.hiddenInput.selectionEnd,
        });
      }
    });
    this._listen(this.hiddenInput, 'blur', () => {
      if (engine.focusedNode && engine.focusedNode._wantsTextInput) engine.setFocus(null);
    });

    // cancelActive (the blur listener registered above) has already emptied every
    // capture by the time this second listener runs — only the emit is live here.
    this._listen(window, 'blur', () => {
      engine.bus.emit('windowblur', {});
    });
  }

  setFocus(node, opts = {}) {
    const engine = this.engine;
    const old = engine.focusedNode;
    if (old === node) {
      if (node && opts.text) {
        node._wantsTextInput = true; // activation may promote an already-focused field
        this.syncHiddenInput(opts.value ?? '', opts.selectionStart, opts.selectionEnd);
        // Re-clicking the focused field: pointerdown moved DOM focus to the canvas;
        // reclaim it or the hidden input stops receiving keystrokes.
        this.hiddenInput.focus({ preventScroll: true });
      }
      return;
    }
    // Commit the slot BEFORE any emit: a blur/change handler that re-enters setFocus
    // (form advance: field.on('change', () => engine.setFocus(next)) — TextField
    // dispatches 'change' from its blur) must see the new state, never re-blur `old`
    // off a stale slot (double change / infinite recursion). After each emit, a
    // re-entrant transition supersedes this one: the winner owns the DOM focus below.
    engine.focusedNode = node;
    if (old) {
      old._wantsTextInput = false;
      old.emit('blur', new UIEvent('blur', { target: old }));
      if (engine.focusedNode !== node) return; // superseded from a blur handler
    }
    if (node) {
      node.emit('focus', new UIEvent('focus', { target: node }));
      if (engine.focusedNode !== node) return; // superseded from a focus handler
      if (opts.text) {
        node._wantsTextInput = true;
        this.syncHiddenInput(opts.value ?? '', opts.selectionStart, opts.selectionEnd);
        this.hiddenInput.focus({ preventScroll: true });
      } else {
        // Keep DOM focus on the canvas (NOT hiddenInput.blur(): that drops focus to
        // the page body and kills the keyboard gate for every subsequent key).
        try { this.canvas.focus({ preventScroll: true }); } catch { /* detached */ }
      }
    } else {
      try { this.canvas.focus({ preventScroll: true }); } catch { /* detached */ }
    }
  }

  syncHiddenInput(value, selStart = value.length, selEnd = selStart, direction = 'none') {
    this.hiddenInput.value = value;
    try { this.hiddenInput.setSelectionRange(selStart, selEnd, direction); } catch { /* not focusable yet */ }
  }

  setCursor(cursor) {
    const c = cursor || 'default';
    if (this._cursor === c) return;
    this._cursor = c;
    this.canvas.style.cursor = c;
  }

  // ---- middle-button pan-scroll (browser autoscroll equivalent for custom scroll areas) ----

  // True while a pan-scroll gesture owns the pointer (middle-button autoscroll or an
  // active touch pan). Pans deliberately hold no engine capture, so HoverManager checks
  // this to keep hover suppressed for the gesture like any captured drag.
  get isPanning() {
    if (this._pan) return true;
    for (const tp of this._touchPan.values()) { if (tp.active) return true; }
    return false;
  }

  // Autoscroll velocity from the cursor's offset off the anchor (px → px/s).
  // Firefox's accelerate() curve: a 12px dead band around the anchor, then
  // (|d|/12)^1.5 − 1 signed "steps" at 50 px/s per step — superlinear, so speed
  // genuinely climbs as the cursor leaves the anchor (~57 px/s at 20px offset,
  // ~1150 at 100px, ~3350 at 200px). The old linear form (5 px/s per px) crawled
  // everywhere and the far range read no faster than the near one.
  _panVelocity(d) {
    const val = d / 12;
    if (val > 1) return (val * Math.sqrt(val) - 1) * 50;
    if (val < -1) return (val * Math.sqrt(-val) + 1) * 50;
    return 0;
  }

  _startPan(p, pointerId) {
    const engine = this.engine;
    // deepest LIVE scrollable under the cursor: either axis qualifies, and a sealed
    // (disabled-subtree) area chains PAST to an enclosing live one — wheel parity
    const hit = hitTest(engine, p.x, p.y);
    let area = hit;
    while (area && !(typeof area.scrollBy === 'function' && (area.maxScroll > 0 || area.maxScrollX > 0)
                     && !area.closest(n => n.disabled === true))) area = area.parent;
    if (!area) return;
    try { this.canvas.setPointerCapture(pointerId); } catch { /* synthetic */ }
    const canY = area.maxScroll > 0, canX = area.maxScrollX > 0;
    this.setCursor(canY && canX ? 'move' : canY ? 'ns-resize' : 'ew-resize');
    const anchorY = p.y, anchorX = p.x;
    // remX/remY carry the sub-pixel residue across frames: setScroll/setScrollX round
    // to whole px, so applying raw `vel*dt` each frame would round a slow creep (or any
    // speed on a high-Hz display: 50 px/s is 0.35 px/frame at 144Hz) down to nothing.
    const pan = {
      area, remX: 0, remY: 0,
      stop: this.engine.ticker.add((dt) => {
        if (canY) {
          pan.remY += this._panVelocity(this.engine.pointer.y - anchorY) * dt;
          const s = Math.round(pan.remY);
          if (s) { pan.remY -= s; area.scrollBy(s); }
        }
        if (canX) {
          pan.remX += this._panVelocity(this.engine.pointer.x - anchorX) * dt;
          const s = Math.round(pan.remX);
          if (s) { pan.remX -= s; area.setScrollX(area.content.scrollX + s); }
        }
      }),
    };
    this._pan = pan;
  }

  _endPan() {
    if (!this._pan) return;
    this._pan.stop();
    this._pan = null;
    this.setCursor(this.engine.defaultCursor);
    // hover sat suppressed for the whole pan; resync path + cursor to what now sits
    // under the pointer (update ends in applyCursor)
    this.engine.hover.update(this.engine.pointer.x, this.engine.pointer.y, true);
  }
}

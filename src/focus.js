// FocusManager: keyboard/gamepad focus over the single engine.setFocus slot.
// Traversal follows paint order; spatial moves pick the nearest candidate in the
// pressed direction; activation NEVER reaches a node a pointer could not hit
// (occlusion/scrim predicate). Transient surfaces (dropdowns, popups, menus)
// register on the Escape stack; Escape/gamepad-B pop the top, else blur.

import { renumber } from './layers.js';
import { hitTest } from './hit.js';
import { NineSliceNode } from './primitives.js';
import { UINode } from './node.js';

// The ONE pointer-reach probe: candidates() and activate() used to
// disagree — activate() learned the grid lesson (a hole-shaped hit area
// like RadialMenu's annulus fails at its own box center) while candidates()
// still probed only the center, so the wheel was reachable by Enter yet
// invisible to Tab/next/prev/spatial move. Center fast-path, then the same
// (i+0.5)/5 inset grid the audit reach rule samples (instrument agreement —
// deliberately NOT true edges: the audit's insets are the shared law), the
// center cell skipped (the fast path owns it). containsPoint gates each
// hitTest (the audit's own pre-filter): out-of-shape and clipped probes cost
// O(1), and the occluder that answers a covered probe sits ABOVE the node in
// paint order, so failing walks terminate early. Returns the first {x, y} a
// pointer could land on the node (or a descendant), else null. Callers
// renumber first — both do.
function reachablePoint(engine, node) {
  const ws = node.worldScale || 1; // the house guard: a poisoned scale must not collapse probes onto the corner
  const probe = (px, py) => {
    if (!node.containsPoint(px, py)) return null;
    const hit = hitTest(engine, px, py);
    return hit && (hit === node || node.isAncestorOf(hit)) ? { x: px, y: py } : null;
  };
  let at = probe(node.worldX + node.w * ws / 2, node.worldY + node.h * ws / 2);
  for (let gy = 0; !at && gy < 5; gy++) {
    for (let gx = 0; !at && gx < 5; gx++) {
      if (gx === 2 && gy === 2) continue; // the fast path already probed the center cell
      at = probe(node.worldX + node.w * ws * (gx + 0.5) / 5, node.worldY + node.h * ws * (gy + 0.5) / 5);
    }
  }
  return at;
}

export class FocusManager {
  constructor(engine) {
    this.engine = engine;
    this.source = 'api'; // 'pointer' | 'key' | 'gamepad' | 'api' — ring shows for key/gamepad
    this._ring = null;
    this._escape = [];
    this._tabIntercepts = []; // open surfaces that consume Tab (a context menu dismissing)
    this._offDispose = null;
    // With nothing focused, Escape (the gamepad's B — the one bus-keydown emitter for
    // it) pops open surfaces. No path puts Tab on the bus: the input layer consumes
    // Tab in handleKey before its unfocused branch, so the old Tab arm here was dead
    // code (removed; the audit read-confirmed it unreachable).
    this._offBus = engine.bus.on('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.cancel()) e.native?.preventDefault?.();
      }
    });
  }

  get node() { return this.engine.focusedNode; }

  // Focus candidates, in paint order: focusable, enabled, un-clipped, and actually
  // reachable by a pointer (the shared reachablePoint fence — excludes
  // scrim-covered and buried nodes; annular/odd-shaped hit areas join the walk
  // through the same grid activate() fires by).
  candidates() {
    const engine = this.engine;
    if (engine.paintDirty) renumber(engine);
    const out = [];
    for (const n of engine.paintList) {
      if (!n.focusable || n.disposed) continue;
      if (n.closest(a => a.disabled === true)) continue;
      // L12 zero-alpha ruling: a mid-fade ghost is not a stop — a node whose own
      // alpha is 0 (a ~200ms fade-out tail, a culled plate) never takes the walk
      if (n.fxOpacity === 0) continue;
      if (!reachablePoint(engine, n)) continue;
      out.push(n);
    }
    return out;
  }

  set(node, source = 'api') {
    this.source = source;
    this.engine.setFocus(node); // engine.setFocus calls back into _syncRing
  }

  clear() { this.set(null, this.source); }

  next(source = 'key') { this._step(1, source); }
  prev(source = 'key') { this._step(-1, source); }

  _step(dir, source) {
    const list = this.candidates();
    if (!list.length) return;
    let idx = list.indexOf(this.node);
    if (idx === -1) idx = dir > 0 ? -1 : 0;
    this.set(list[((idx + dir) % list.length + list.length) % list.length], source);
  }

  // Nearest candidate in the pressed direction: forward progress weighted against
  // perpendicular misalignment (2x), the house spatial-navigation rule.
  move(dx, dy, source = 'key') {
    const list = this.candidates();
    if (!list.length) return;
    const cur = this.node;
    if (!cur || !list.includes(cur)) { this.set(list[0], source); return; }
    const cx = cur.worldX + cur.w * cur.worldScale / 2, cy = cur.worldY + cur.h * cur.worldScale / 2;
    let best = null, bestScore = Infinity;
    for (const n of list) {
      // Never move onto an ancestor: a focusable container (PanZoomSurface) encloses its
      // content, so its center is a near "forward" target from every node inside it.
      // Entering it from outside and Tab order are unaffected.
      if (n === cur || n.isAncestorOf(cur)) continue;
      const vx = (n.worldX + n.w * n.worldScale / 2) - cx, vy = (n.worldY + n.h * n.worldScale / 2) - cy;
      const along = vx * dx + vy * dy;
      if (along <= 0) continue;
      const score = along + 2 * Math.abs(vx * dy - vy * dx);
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) this.set(best, source);
  }

  // Enter/Space/gamepad-A. Widgets define onActivate for gestures a click cannot
  // express (slots trigger, text fields promote to editing); the fallback is a
  // synthetic click at the node's center. Raises the containing window.
  activate(source = 'key') {
    const node = this.node;
    if (!node || node.disposed || node.closest(a => a.disabled === true)) return false;
    if (node._wantsTextInput) return false; // typing space/enter is typing, not activation
    if (this.engine.paintDirty) renumber(this.engine); // hitTest below needs a current paintList (candidates() does the same)
    // The pointer-reach fence, taught the audit's own lesson: the box
    // CENTER is not the only honest probe — a hole-shaped hit area (RadialMenu's
    // containsPoint annulus) deliberately fails at its own center, and the
    // center-only fence left Enter AND gamepad-A dead on the whole wheel.
    // the SAME fence guards candidates() now (it kept the center-only
    // probe for a release, so the wheel answered Enter yet never joined
    // Tab/next/prev/spatial move) — reachablePoint above is the one predicate.
    const at = reachablePoint(this.engine, node);
    if (!at) return false;
    this.source = source;
    const win = node.closest(a => a._isEldWindow);
    win?.bringToFront?.();
    if (node.onActivate) node.onActivate();
    else node.dispatch('click', { x: at.x, y: at.y, synthetic: true });
    this._syncRing();
    return true;
  }

  // Escape stack. push returns an off() token; the surface's close path MUST call it
  // (Select.close and EldPopup.hide are the single funnels for theirs).
  pushEscape(fn) {
    const entry = { fn };
    this._escape.push(entry);
    return () => {
      const i = this._escape.indexOf(entry);
      if (i !== -1) this._escape.splice(i, 1);
    };
  }

  cancel() {
    const top = this._escape[this._escape.length - 1];
    if (top) { top.fn(); return true; }
    if (this.node) { this.clear(); return true; }
    return false;
  }

  // An open surface (e.g. a context menu) registers to consume the next Tab —
  // dismissing itself instead of letting focus walk behind it. Returns the off().
  interceptTab(fn) {
    this._tabIntercepts.push(fn);
    return () => {
      const i = this._tabIntercepts.indexOf(fn);
      if (i !== -1) this._tabIntercepts.splice(i, 1);
    };
  }

  // Called by the input layer for every UI-scoped keydown BEFORE node dispatch.
  handleKey(e) {
    if (e.key !== 'Tab') return false;
    // The console-only carve-out: a focused node declaring
    // _consumesTab keeps Tab for itself (DebugConsole's field completes commands);
    // the input layer then delivers the keydown to the node as usual. Scoped to the
    // FOCUSED node, so Tab semantics change nowhere else.
    if (this.engine.focusedNode?._consumesTab) return false;
    // Tab walking focus behind an open surface orphaned it (Tab
 // DISMISSES — the outside-press analogy); the press is consumed, the next Tab walks.
    for (const fn of [...this._tabIntercepts]) {
      if (fn(e) === true) return true;
    }
    if (e.shiftKey) this.prev('key'); else this.next('key');
    return true;
  }

  // Runs on every focus change (engine.setFocus funnels here): maintains the
  // dispose watch and the visual ring. Ring is lazy — art exists by first use.
  _syncRing() {
    if (this._disposed) return; // teardown may blur widgets after this manager died
    const node = this.node;
    if (this._offDispose) { this._offDispose(); this._offDispose = null; }
    if (!node) { this._detachRing(); return; }
    this._offDispose = node.on('dispose', () => {
      this._detachRing();
      if (this.engine.focusedNode === node) this.engine.setFocus(null);
    });
    if (this.source !== 'key' && this.source !== 'gamepad') { this._detachRing(); return; }
    if (!this._ring) {
      this._ring = new NineSliceNode(this.engine.textures.frame('focus.ring'));
      this._ring.name = 'focus-ring';
      // Chrome, not content: the ring hangs 3px outside its parent, so a focusable
      // container that fitChildren()s itself would otherwise grow around its own ring
      // every layout pass (ring re-fits to the new size — runaway inflation).
      this._ring.fitExclude = true;
      this._ring.onLayout = function () {
        if (this.parent) this.setRect(-3, -3, this.parent.w + 6, this.parent.h + 6);
      };
    }
    if (this._ring.parent !== node) {
      this._detachRing();
      // Bypass add() overrides (PanZoomSurface forwards into its clipped, zoom-scaled
      // plane): the ring must frame the focused node itself, as a direct child.
      UINode.prototype.add.call(node, this._ring);
    }
  }

  _detachRing() {
    if (this._ring?.parent) this._ring.removeFromParent();
  }

  dispose() {
    this._disposed = true;
    this._offBus?.();
    this._offDispose?.();
    if (this._ring) {
      this._detachRing();
      this._ring.dispose();
      this._ring = null;
    }
    this._escape.length = 0;
    this._tabIntercepts.length = 0; // same teardown as the escape stack
  }
}

// UINode: base of the retained-mode component tree.
// Coordinates are CSS pixels, top-left origin, y-down, local to the parent's content box.
// Three.js is mirrored through `group` (self meshes) + `childGroup` (children), with y negated.

import * as THREE from 'three';

let _nextId = 1;

// Local warn-once (the trees.js idiom): node.js is the import leaf (three.js only),
// so the friendly-error voice lives here rather than importing one.
const _warned = new Set();
function warnOnce(key, message) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(message);
}

export class UIEvent {
  constructor(type, data = {}) {
    this.type = type;
    Object.assign(this, data);
    this.target = data.target ?? null;
    this.currentTarget = null;
    this.stopped = false;
    this.defaultPrevented = false;
  }
  stopPropagation() { this.stopped = true; }
  preventDefault() { this.defaultPrevented = true; }
}

export class UINode {
  constructor(opts = {}) {
    this.id = _nextId++;
    this.name = opts.name ?? '';
    this.parent = null;
    this.children = [];
    this.engine = null;
    this._lastEngine = null; // survives detach so dispose() can still cancel tweens

    this.x = opts.x ?? 0; this.y = opts.y ?? 0;
    this.w = opts.w ?? 0; this.h = opts.h ?? 0;

    this._visible = opts.visible ?? true;
    this.interactive = opts.interactive ?? false;
    this.isDropTarget = false;
    this.cursor = opts.cursor ?? null;

    this.clipChildren = false;
    this.clipRegion = null;      // set by clip.js when clipChildren
    this.scrollX = 0; this.scrollY = 0;

    // Real content-space scale: children's coordinate space is multiplied by this.
    // Unlike fxScale (render-only, below) it DOES affect layout worlds, hit rects,
    // clipping, and culling. scrollX/scrollY stay in content units under it.
    this.contentScale = 1;

    // Render-only FX: never affect layout or hit rects.
    this.fxScale = 1;
    this.fxOpacity = 1;
    // Render-only position jitter (SanityFX tremor): folded into the group
    // position at sync time; x/y, layout worlds, and hit rects never see it.
    this.fxOffsetX = 0;
    this.fxOffsetY = 0;
    this._appliedOpacity = -1;

    // Computed by engine passes.
    this.worldX = 0; this.worldY = 0;
    this.worldScale = 1;         // product of ancestor contentScales (engine pass)
    this.effectiveClipRect = null;   // {x0,y0,x1,y1} intersection of ancestor clips, or null
    this.paintIndex = 0;

    this.focusOrder = 0;             // used by the WINDOWS layer sort

    this.group = new THREE.Group();
    this.childGroup = new THREE.Group();
    this.group.add(this.childGroup);

    this._listeners = null;
    this._frameHook = null;
    this.disposed = false;
  }

  get visible() { return this._visible; }
  set visible(v) {
    if (this._visible === v) return;
    this._visible = v;
    this.invalidateLayout();
    this.invalidatePaint();
  }

  // ---- tree ----

  add(...nodes) {
    for (const child of nodes) {
      if (!child || !(child instanceof UINode)) {
        // friendly error: raw three.js objects (or anything else) skip layout, clipping,
        // and hits entirely — the classic "my mesh floats over everything" mistake
        console.warn('LovecraftUI: add() takes UINodes — three.js objects go inside an '
          + `Accent3DNode's content group (got ${child?.isObject3D ? child.type : typeof child}); skipped.`);
        continue;
      }
      if (child === this || child.isAncestorOf(this)) {
        // friendly error: a cycle would infinitely recurse the next frame's layout
        // walk, dying deep inside the engine where the stack never names the culprit
        console.warn('LovecraftUI: add() would create a tree cycle (adding a node to itself or its descendant); skipped.');
        continue;
      }
      if (child.parent) child.parent.remove(child);
      child.parent = this;
      this.children.push(child);
      this.childGroup.add(child.group);
      child._propagateEngine(this.engine);
    }
    this.invalidateLayout();
    this.invalidatePaint();
    return nodes[0];
  }

  remove(child) {
    const i = this.children.indexOf(child);
    if (i === -1) return;
    this.children.splice(i, 1);
    this.childGroup.remove(child.group);
    child.parent = null;
    child._propagateEngine(null);
    this.invalidateLayout();
    this.invalidatePaint();
  }

  removeFromParent() { if (this.parent) this.parent.remove(this); }

  _propagateEngine(engine) {
    if (this.engine === engine) return;
    const old = this.engine;
    this.engine = engine;
    if (engine) this._lastEngine = engine;
    if (old && this._frameHook) old.frameHooks.delete(this);
    if (engine && this._frameHook) engine.frameHooks.add(this);
    this.onEngine(engine, old);
    for (const c of this.children) c._propagateEngine(engine);
  }

  onEngine(_engine, _old) {} // override: react to attach/detach from a rooted tree

  // Order matters: the 'dispose' event and children run while the engine is still
  // propagated (detaching first would null `engine` down the subtree and orphan
  // every tween and frame hook).
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.emit('dispose', {});
    for (const c of [...this.children]) c.dispose();
    // The attach-time snapshot covers the remove()-then-dispose() path: detaching nulls
    // `engine`, but the ticker would keep stepping this node's tweens forever otherwise.
    const eng = this.engine ?? this._lastEngine;
    if (eng) eng.ticker.cancelTweensOf(this);
    this.setFrameHook(null);
    this.removeFromParent();
    this._listeners = null;
    this.disposeSelf();
  }

  disposeSelf() {} // override: release own three resources (materials, geometries)

  closest(pred) {
    let n = this;
    while (n) { if (pred(n)) return n; n = n.parent; }
    return null;
  }

  // Phase : declare a DELIBERATE exception to a page-audit rule ('overlap',
  // 'containment', 'contrast', 'scrollbar', 'hit') — badges over content, a focus
  // ring's overhang. Declarations are counted in the audit report and ratcheted like
  // the GEOMETRY exemption cap: the table only ever shrinks.
  auditAllow(...rules) {
    if (!this._auditAllow) this._auditAllow = new Set();
    for (const r of rules) this._auditAllow.add(r);
    return this;
  }

  isAncestorOf(node) {
    let n = node;
    while (n) { if (n === this) return true; n = n.parent; }
    return false;
  }

  get root() { let n = this; while (n.parent) n = n.parent; return n; }

  visibleInTree() {
    let n = this;
    while (n) { if (!n._visible) return false; n = n.parent; }
    return true;
  }

  // ---- events ----

  on(type, fn) {
    if (!this._listeners) this._listeners = new Map();
    let set = this._listeners.get(type);
    if (!set) { set = new Set(); this._listeners.set(type, set); }
    set.add(fn);
    return () => set.delete(fn);
  }

  off(type, fn) { this._listeners?.get(type)?.delete(fn); }

  // Fire listeners on this node only.
  emit(type, data = {}) {
    const evt = data instanceof UIEvent ? data : new UIEvent(type, { ...data, target: data.target ?? this });
    evt.currentTarget = this;
    const set = this._listeners?.get(type);
    if (set) for (const fn of [...set]) fn(evt);
    return evt;
  }

  // Fire on this node, then bubble to ancestors until stopped.
  dispatch(type, data = {}) {
    const evt = data instanceof UIEvent ? data : new UIEvent(type, { ...data, target: this });
    let n = this;
    while (n && !evt.stopped) {
      n.emit(type, evt);
      n = n.parent;
    }
    return evt;
  }

  // ---- invalidation ----

  invalidateLayout() { if (this.engine) this.engine.layoutDirty = true; }
  invalidatePaint() { if (this.engine) this.engine.paintDirty = true; }

  // ---- per-frame hook ----

  setFrameHook(fn) {
    this._frameHook = fn;
    if (!this.engine) return;
    if (fn) this.engine.frameHooks.add(this);
    else this.engine.frameHooks.delete(this);
  }

  // ---- geometry helpers ----

  setRect(x, y, w, h) {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h))) {
      // EVERY geometry mutation funnels through here (setSize/setPos delegate), and the
      // downstream "floors" launder non-finite input (Math.max(2, NaN) === NaN) — so the
      // NaN class seals at this single gate: the write is IGNORED and the last finite
      // rect stands. (containsPoint is already sealed positive-form; this seals layout,
      // rasters and worldRect the same way.)
      warnOnce(`setRect:${this.name || this.constructor.name}`,
        `LovecraftUI: non-finite setRect(${x}, ${y}, ${w}, ${h}) ignored on '${this.name || this.constructor.name}'.`);
      return;
    }
    if (x === this.x && y === this.y && w === this.w && h === this.h) return;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.invalidateLayout();
  }

  setSize(w, h) { this.setRect(this.x, this.y, w, h); }
  setPos(x, y) { this.setRect(x, y, this.w, this.h); }

  get worldRect() {
    const ws = this.worldScale;
    return { x0: this.worldX, y0: this.worldY, x1: this.worldX + this.w * ws, y1: this.worldY + this.h * ws };
  }

  // `pad` is touch hit-slop: it widens the node's own box (in screen px, regardless of
  // ancestor scale) but never defeats clipping.
  containsPoint(px, py, pad = 0) {
    const ws = this.worldScale;
    // Positive-form on purpose: NaN geometry (a consumer setRect/setPos fed NaN) must
    // test as NOT contained. The inverted early-return form let every comparison fail,
    // making a NaN node "contain" the half-plane — an invisible click-eating phantom.
    if (!(px >= this.worldX - pad && py >= this.worldY - pad &&
          px <= this.worldX + this.w * ws + pad && py <= this.worldY + this.h * ws + pad)) return false;
    const c = this.effectiveClipRect;
    if (c && !(px >= c.x0 && py >= c.y0 && px <= c.x1 && py <= c.y1)) return false;
    return true;
  }

  // ---- overridables ----

  // Position/size children. Called top-down during the layout pass.
  onLayout() {}

  // Sync own meshes with x/y/w/h (called every frame by the sync pass, after transforms).
  syncSelf() {}
}

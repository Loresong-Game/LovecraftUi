// EldritchEngine: renderer setup, root layers, and the per-frame pass pipeline:
// ticker/tweens -> frame hooks -> layout -> renumber -> hover -> sync -> render (bg pass, UI pass).

import * as THREE from 'three';
import { Ticker } from './anim.js';
import { UINode } from './node.js';
import { renumber, LAYER_ORDER } from './layers.js';
import { HoverManager } from './hit.js';
import { InputSystem, Emitter } from './input.js';
import { FocusManager } from './focus.js';
import { TextureRegistry } from './texgen.js';
import { COLORS } from './theme.js';
import { intersectRects } from './layout.js';

// The shipped couch-distance steps. Fractional values between them snap
// to the nearest step with a warning — texture bakes and pointer math both key on
// the scale, and untested fractions buy nothing but blur.
const UI_SCALE_STEPS = [1, 1.25, 1.5, 2];
function snapUiScale(v) {
  if (v == null) return 1;
  if (!Number.isFinite(v) || v <= 0) {
    console.warn(`LovecraftUI: init({uiScale}) must be one of ${UI_SCALE_STEPS.join('/')} (got ${v}); using 1.`);
    return 1;
  }
  let best = 1;
  for (const s of UI_SCALE_STEPS) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  if (best !== v) console.warn(`LovecraftUI: uiScale ${v} snapped to ${best} (shipped steps: ${UI_SCALE_STEPS.join('/')}).`);
  return best;
}

export class EldritchEngine {
  constructor(options = {}) {
    this.container = options.container ?? document.body;
    this.fixedW = options.width ?? 0;
    this.fixedH = options.height ?? 0;
    // Camera-level logical scaling: layout/hit run in LOGICAL px (css / uiScale);
    // the renderer's pixel ratio carries the difference, so nothing else changes.
    this.uiScale = snapUiScale(options.uiScale);

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.tabIndex = -1; // programmatically focusable: keyboard routing is scoped to the canvas
    this.canvas.style.outline = 'none';
    this.container.appendChild(this.canvas);

    // options.transparent=true makes the canvas a true guest: the WebGL context
    // keeps an alpha channel (a CONSTRUCTION-time attribute) and _render clears to
    // alpha 0, so the host page's own layers show through wherever the UI is not.
    this.transparent = options.transparent === true;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: this.transparent });
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.sortObjects = true;

    this.uiScene = new THREE.Scene();
    this.uiCamera = new THREE.OrthographicCamera(0, 100, 0, -100, -2000, 2000);
    this.bgScene = null;   // set by fx.js
    this.bgCamera = null;
    this.onBackgroundFrame = null;
    // options.background=false disables the ambiance scene; only a string overrides the clear color
    this.clearColor = new THREE.Color(typeof options.background === 'string' ? options.background : COLORS.abyss0);
    // options.contextMenu=false: the ENGINE CANVAS suppresses the native context
    // menu wholesale (pages wiring right-click surfaces pass it; the
 // one-shot rightclick-preventDefault suppression keeps working either way).
    // Canvas-scoped by construction: a host document around an embedded stage
    // keeps its own menu outside the canvas.
    this.contextMenu = options.contextMenu !== false;

    // Lights only affect the lit 3D accent meshes; MeshBasicMaterial UI quads ignore them.
    const dir = new THREE.DirectionalLight(0xcfe8d8, 1.6);
    dir.position.set(-0.4, 0.7, 1);
    this.uiScene.add(dir);
    this.uiScene.add(new THREE.AmbientLight(0x4a5a52, 1.2));

    this.layers = {};
    for (const name of LAYER_ORDER) {
      const layer = new UINode({ name: `layer:${name}` });
      layer._propagateEngine(this);
      this.layers[name] = layer;
      this.uiScene.add(layer.group);
    }
    this.layers.windows.sortChildrenByFocus = true;

    this.ticker = new Ticker();
    if (options.timerDriven) this.ticker.timerDriven = true;
    this.ticker.setFrame((dt, t) => this._frame(dt, t));

    this.textures = new TextureRegistry();
    this.bus = new Emitter();
    this.pointer = { x: -1, y: -1 };
    this.pointerInside = false;
    this.pointerMoved = false;
    this.captures = new Map(); // pointerId -> captured node (multi-pointer safe)
    this.focusedNode = null;
    // The last-used input device ('kbm' | 'pad'), fed by real presses only — pointer
    // motion never flips it. InputPrompt re-glyphs on the change event.
    this.lastInputDevice = 'kbm';
    this.paintList = [];
    this.layoutDirty = true;
    this.paintDirty = true;
    this.frameHooks = new Set();
    this.defaultCursor = 'default';

    this.hover = new HoverManager(this);
    this.input = new InputSystem(this, this.canvas);
    this.focus = new FocusManager(this);

    this.disposed = false;
    this._disposers = [];
    this._ro = null;
    this._dprCleanup = null;

    // Dirty-gate rendering: identical frames are skipped unless something moved.
    // alwaysRender = true reverts wholesale; requestRender() wakes one frame (used by
    // texture/color mutators and press/release input activity that layout can't see).
    this.alwaysRender = false;
    this._renderRequests = 5; // always present the first few boot frames

    // The renderer re-uploads GPU state on restore; retained texgen canvases just need
    // a re-upload mark. preventDefault on loss is what allows the restore to happen.
    this._onContextLost = (e) => e.preventDefault();
    this._onContextRestored = () => { this.textures.refreshAll(); this.paintDirty = true; this.layoutDirty = true; };
    this.canvas.addEventListener('webglcontextlost', this._onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored);

    this.width = 0; this.height = 0;
    if (this.fixedW && this.fixedH) {
      this.resize(this.fixedW, this.fixedH);
    } else {
      this._ro = new ResizeObserver(() => this._containerResize());
      this._ro.observe(this.container);
      this._containerResize();
    }

    // Re-apply the pixel ratio when the window moves to a monitor with a different DPR
    // (no size change fires in that case). Each firing re-arms for the new ratio.
    const armDpr = () => {
      if (this.disposed || !window.matchMedia) return;
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => { this._dprCleanup = null; this.resize(this._cssW, this._cssH); armDpr(); };
      mq.addEventListener('change', onChange, { once: true });
      this._dprCleanup = () => mq.removeEventListener('change', onChange);
    };
    armDpr();
  }

  // Register teardown work owned by systems built on this engine (fx scenes etc.).
  addDisposer(fn) { this._disposers.push(fn); }

  requestRender(frames = 1) { this._renderRequests = Math.max(this._renderRequests, frames); }

  // Record which device the player last pressed; emits `devicechange {device}` on
  // the bus only when it actually changes (glyph swaps ride this).
  noteDevice(kind) {
    if (this.lastInputDevice === kind) return;
    this.lastInputDevice = kind;
    this.bus.emit('devicechange', { device: kind });
  }

  // Full teardown: stops the frame loop, frees every node/material/texture, removes
  // all listeners and the canvas. The engine is dead afterwards; build a new one to reboot.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ticker.stop();
    this.ticker.setFrame(null);
    this.ticker.callbacks.clear();
    this.ticker.tweens.clear();
    this.ticker.byTarget.clear();
    for (const fn of this._disposers) fn();
    this._disposers.length = 0;
    this.gamepad?.dispose();
    this.gamepad = null;
    this.focus.dispose();
    for (const name of LAYER_ORDER) this.layers[name].dispose();
    this.input.dispose();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._dprCleanup) { this._dprCleanup(); this._dprCleanup = null; }
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    this.frameHooks.clear();
    this.paintList.length = 0;
    this.focusedNode = null;
    this.captures.clear();
    this.textures.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  setFocus(node, opts = {}) {
    this.input.setFocus(node, opts);
    this.focus._syncRing(); // ring + dispose-watch track the single focus slot
  }

  // The primary capture (earliest still-held pointer). Hover suppression and the
  // single-pointer code paths read this; per-pointer routing uses `captures` directly.
  get capturedNode() { return this.captures.size ? this.captures.values().next().value : null; }

  _containerResize() {
    const w = Math.max(2, this.container.clientWidth || window.innerWidth);
    const h = Math.max(2, this.container.clientHeight || window.innerHeight);
    if (w !== this._cssW || h !== this._cssH) this.resize(w, h); // both sides in CSS units
  }

  // `cssW/cssH` arrive in CSS px (the container's client box); the engine runs in
  // LOGICAL px = css / uiScale. The drawing buffer stays full resolution because
  // the pixel ratio multiplies the scale back in (logical × ratio = css × DPR).
  resize(cssW, cssH) {
    const s = this.uiScale || 1;
    this._cssW = cssW; this._cssH = cssH; // internal resize callers re-enter in CSS units
    const w = Math.max(2, Math.round(cssW / s));
    const h = Math.max(2, Math.round(cssH / s));
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * s);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.uiCamera.left = 0; this.uiCamera.right = w;
    this.uiCamera.top = 0; this.uiCamera.bottom = -h;
    this.uiCamera.updateProjectionMatrix();
    if (this.bgCamera) {
      this.bgCamera.aspect = w / h;
      this.bgCamera.updateProjectionMatrix();
    }
    for (const name of LAYER_ORDER) {
      const l = this.layers[name];
      l.x = 0; l.y = 0; l.w = w; l.h = h;
    }
    this.layoutDirty = true;
    this.input.refreshRect();
    this.bus.emit('resize', { w, h });
  }

  start() { this.ticker.start(); return this; }
  stop() { this.ticker.stop(); }

  stats() { return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, textures: this.renderer.info.memory.textures, geometries: this.renderer.info.memory.geometries }; }

  // ---- frame pipeline ----

  _frame(dt, t) {
    // Render-gate inputs are captured BEFORE the passes below consume them.
    const tweensStepped = this.ticker.tweensStepped === true;
    this.ticker.tweensStepped = false;
    const pointerActive = this.pointerMoved;
    const paintWasDirty = this.paintDirty;

    for (const n of [...this.frameHooks]) {
      if (n.engine === this && n._frameHook) {
        // a consumer hook that throws must not break the frame — or, on the rAF
        // driver, the whole ticker (X16). Warn once per node, keep the frame going.
        try { n._frameHook(dt, t); } catch (err) {
          if (!this._hookWarned) this._hookWarned = new WeakSet();
          if (!this._hookWarned.has(n)) {
            this._hookWarned.add(n);
            console.warn('LovecraftUI: a frame hook threw and was skipped (further throws from this node are silent).', err);
          }
        }
      }
    }

    let layoutRan = false;
    if (this.layoutDirty) {
      this.layoutDirty = false;
      this._layoutPass();
      layoutRan = true;
      this.bus.emit('postlayout', {});
    }
    if (this.paintDirty) renumber(this);
    if (this.pointerMoved || layoutRan) {
      this.pointerMoved = false;
      this.hover.update(this.pointer.x, this.pointer.y, layoutRan);
    }
    this._syncPass();

    // The gate, evaluated last so requests made during hooks/layout/hover/sync count.
    const active = this.alwaysRender || layoutRan || paintWasDirty || this.paintDirty ||
      tweensStepped || this.frameHooks.size > 0 || !!this.bgScene ||
      pointerActive || this._renderRequests > 0;
    if (this._renderRequests > 0) this._renderRequests--;
    if (active) this._render(dt, t);
  }

  _layoutPass() {
    for (const name of LAYER_ORDER) this._layoutNode(this.layers[name]);
    for (const name of LAYER_ORDER) this._computeWorld(this.layers[name], 0, 0, null, null, 1);
  }

  _layoutNode(n) {
    if (!n._visible) return;
    n.onLayout();
    for (const c of n.children) this._layoutNode(c);
  }

  _computeWorld(n, ox, oy, clipRect, region, scale) {
    n.worldX = ox + n.x * scale;
    n.worldY = oy + n.y * scale;
    n.worldScale = scale;
    n.effectiveClipRect = clipRect;
    if (n.material && n._clipAssigned !== region) {
      n._clipAssigned = region;
      n.material.clippingPlanes = region ? region.planes : null;
      n.material.needsUpdate = true;
    }
    let childClip = clipRect, childRegion = region;
    // scrollX/scrollY are content units; contentScale converts them to this node's space.
    const childScale = scale * n.contentScale;
    const childOx = n.worldX - (n.clipChildren ? n.scrollX * childScale : 0);
    const childOy = n.worldY - (n.clipChildren ? n.scrollY * childScale : 0);
    if (n.clipChildren && n.clipRegion) {
      // Intersect with the inherited clip so a single 4-plane set encodes the whole nesting:
      // visual clipping, hit rects, and culling all share this one rect.
      childClip = intersectRects(clipRect, { x0: n.worldX, y0: n.worldY, x1: n.worldX + n.w * scale, y1: n.worldY + n.h * scale });
      n.clipRegion.setRect(childClip.x0, childClip.y0, childClip.x1, childClip.y1);
      childRegion = n.clipRegion;
    }
    for (const c of n.children) this._computeWorld(c, childOx, childOy, childClip, childRegion, childScale);
  }

  _syncPass() {
    for (const name of LAYER_ORDER) this._syncNode(this.layers[name], 1);
  }

  _syncNode(n, opInherited) {
    n.group.visible = n._visible;
    if (!n._visible) return;
    let px = n.x + n.fxOffsetX, py = n.y + n.fxOffsetY;
    const f = n.fxScale;
    if (f !== 1) {
      n.group.scale.set(f, f, 1);
      px += n.w * (1 - f) / 2;
      py += n.h * (1 - f) / 2;
    } else if (n.group.scale.x !== 1) {
      n.group.scale.set(1, 1, 1);
    }
    n.group.position.set(px, -py, 0);
    const cs = n.contentScale;
    if (cs !== 1) n.childGroup.scale.set(cs, cs, 1);
    else if (n.childGroup.scale.x !== 1) n.childGroup.scale.set(1, 1, 1);
    if (n.clipChildren) n.childGroup.position.set(-n.scrollX * cs, n.scrollY * cs, 0);

    const eff = opInherited * n.fxOpacity;
    if (n._appliedOpacity !== eff) {
      n._appliedOpacity = eff;
      if (n.applyOpacity) n.applyOpacity(eff);
    }
    n.syncSelf();

    if (n.mesh) {
      // a fully transparent mesh is a whole draw call for nothing — washes
      // REST at opacity 0 by design, so cull them from the render list
      // until they speak; the next sync re-admits anything a tween wakes
      const solid = !n.material || n.material.opacity > 0.001;
      const c = n.effectiveClipRect;
      if (c) {
        const pad = 4;
        const ws = n.worldScale;
        const out = n.worldX + n.w * ws + pad < c.x0 || n.worldX - pad > c.x1 || n.worldY + n.h * ws + pad < c.y0 || n.worldY - pad > c.y1;
        n.mesh.visible = solid && !out;
      } else {
        n.mesh.visible = solid;
      }
    }
    for (const c of n.children) this._syncNode(c, eff);
  }

  _render(dt, t) {
    this.renderer.setClearColor(this.clearColor, this.transparent ? 0 : 1);
    this.renderer.clear(true, true, true);
    if (this.bgScene && this.bgCamera) {
      if (this.onBackgroundFrame) this.onBackgroundFrame(dt, t);
      this.renderer.render(this.bgScene, this.bgCamera);
      this.renderer.clearDepth();
    }
    this.renderer.render(this.uiScene, this.uiCamera);
  }
}

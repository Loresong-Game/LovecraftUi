// PanZoomSurface: a pannable/zoomable coordinate plane — the viewport onto large content
// (skill trees, tech graphs, maps). ScrollArea's clipped-content pattern with the
// contentScale channel: children live in PLANE units on `content`; pan is
// content.scrollX/scrollY (plane units), zoom is content.contentScale. No scrollbars.
//
// Gestures (the surface owns them all — touchDragOwner keeps the system touch-pan out):
// drag (mouse button 0 or one touch, from anywhere including over plates) pans after the
// 5px threshold via input.claimDrag, so under-threshold clicks reach children untouched;
// wheel zooms at the cursor; two touches pinch-zoom around their midpoint; release
// coasts with inertia on a frame hook. Right-stick / middle-button vertical pan arrive
// through the scrollBy/maxScroll duck-type.
//
// Zoom-aware limits: widgets whose gestures interpret raw screen deltas or that
// position detached surfaces (Slider, TextField, Select dropdowns, scrollbar thumb drags,
// window chrome) are not zoom-aware — keep form controls in unzoomed chrome. Plane content
// is for click/hover/tooltip/focus targets, which are fully supported.

import { UINode } from '../node.js';
import { ClipRegion } from '../clip.js';
import { clamp } from '../layout.js';
import { METRICS } from '../theme.js';
import { setNodeDisabled, EldTooltip } from './widgets.js';

export class PanZoomSurface extends UINode {
  constructor(opts = {}) {
    super({ ...opts, interactive: true });
    this.focusable = true;
    this.touchDragOwner = true; // touches here belong to this widget, never the system pan

    // B5: finite-first — a NaN plane busts the pan-range clamp's own bounds and
    // every piece of plane content renders at a NaN offset (vanishes)
    this.planeW = Math.max(1, Number.isFinite(opts.planeW) ? opts.planeW : 2000);
    this.planeH = Math.max(1, Number.isFinite(opts.planeH) ? opts.planeH : 2000);
    // a zoom that reaches exactly 0 divides the plane math by zero (screenToPlane,
    // scrollBy, the pinch anchor) — floor the range at a sane epsilon. Bounds must be
    // FINITE first: Math.max launders NaN (Math.max(1e-4, NaN) === NaN), and an
    // Infinity bound poisons clamp/contentScale the same way — non-finite → default.
    const mz = Number.isFinite(opts.minZoom) ? opts.minZoom : 0.25;
    const xz = Number.isFinite(opts.maxZoom) ? opts.maxZoom : 3;
    this.minZoom = Math.max(1e-4, mz);
    this.maxZoom = Math.max(this.minZoom, xz);
    this.zoom = clamp(opts.zoom ?? 1, this.minZoom, this.maxZoom);
    this.zoomStep = opts.zoomStep ?? 1.25; // multiplicative, per wheel notch
    this.wheelZoom = opts.wheelZoom ?? true;
    this.inertia = opts.inertia ?? true;

    this.content = new UINode({ interactive: false });
    this.content.clipChildren = true;
    this.content.clipRegion = new ClipRegion();
    this.content.contentScale = this.zoom;
    super.add(this.content);

    this._presses = new Map(); // pointerId -> press/gesture state
    this._pinch = null;        // { d0, p0: {x, y}, zoom0 }

    this.on('wheel', (e) => {
      if (this.disabled) return;
      if (!this.wheelZoom || this.minZoom >= this.maxZoom) return; // bubble to the page
      this._stopInertia();
      this._setZoomAt(this.zoom * Math.pow(this.zoomStep, -e.deltaY / 100), e.x, e.y, false);
      e.stopPropagation(); // consumed: a zoomable surface owns its wheel even at the stops
    });

    this.on('pointerdown', (e) => {
      if (this.disabled || e.button !== 0) return;
      // Gesture-owning descendants (thumbs, sliders, window headers…) keep their drags.
      if (e.target !== this && e.target.closest((n) => n.touchDragOwner === true && n !== this)) return;
      this._stopInertia(); // grab-to-stop
      const touch = e.native?.pointerType === 'touch';
      const press = {
        id: e.pointerId, touch, sx: e.x, sy: e.y,
        panX0: this.content.scrollX, panY0: this.content.scrollY,
        panning: false, lastX: e.x, lastY: e.y,
        lastT: this.engine ? this.engine.ticker.time : 0, vx: 0, vy: 0,
      };
      this._presses.set(e.pointerId, press);
      if (touch) {
        const touches = [...this._presses.values()].filter((p) => p.touch);
        if (touches.length === 2) this._beginPinch(touches);
      }
    });

    this.on('pointermove', (e) => {
      const press = this._presses.get(e.pointerId);
      if (!press) return;
      press.lastSeenX = e.x; press.lastSeenY = e.y;
      if (this._pinch) { this._pinchMove(); return; }
      if (!press.panning) {
        if (Math.hypot(e.x - press.sx, e.y - press.sy) <= METRICS.dragThreshold) return;
        press.panning = true; // set BEFORE claimDrag: its canceled-up echo must be ignored
        EldTooltip.hideNow(); // hover is capture-suppressed during the pan: no leave will hide it
        this.engine?.input.claimDrag(e.pointerId, this);
      }
      const k = this._k();
      this._setPan(press.panX0 - (e.x - press.sx) / k, press.panY0 - (e.y - press.sy) / k, false);
      const t = this.engine ? this.engine.ticker.time : press.lastT + 1e-3;
      press.vx = (e.x - press.lastX) / Math.max(1e-3, t - press.lastT);
      press.vy = (e.y - press.lastY) / Math.max(1e-3, t - press.lastT);
      press.lastX = e.x; press.lastY = e.y; press.lastT = t;
    });

    const release = (e) => {
      const press = this._presses.get(e.pointerId);
      if (!press) return;
      // claimDrag's canceled-up echo bubbles from the previous holder — not a release.
      if (press.panning && e.target !== this) return;
      if (this._pinch) {
        // C3: the pinch pair is the FIRST TWO touches (the same rule _pinchMove reads);
        // a BYSTANDER finger lifting must not tear the pinch down — the old blanket
        // teardown snapped the view and left both pinch fingers panning stale anchors
        const pair = [...this._presses.values()].filter((p) => p.touch).slice(0, 2);
        this._presses.delete(e.pointerId);
        if (!pair.includes(press)) return; // a bystander lifted; the pinch pair is intact
        this._pinch = null;
        const rest = [...this._presses.values()].filter((p) => p.touch);
        if (rest.length === 1) this._anchor(rest[0]); // the remaining finger keeps panning fresh
        else if (rest.length >= 2) this._beginPinch(rest.slice(0, 2)); // a survivor pair re-forms
        return; // pinch release never coasts
      }
      this._presses.delete(e.pointerId);
      if (press.panning && !e.canceled && this.inertia && Math.hypot(press.vx, press.vy) > 50) {
        this._startInertia(press.vx, press.vy);
      } else if (press.panning) {
        this._settle();
      }
    };
    this.on('pointerup', release);

    this.on('keydown', (e) => {
      // the chain law's keyboard face: a descendant that CONSUMED its key (the
      // talent grid's refund Minus, a list's arrows) is answered once, not twice
      if (e.defaultPrevented) return;
      if (this.disabled) return;
      const pan = 40; // screen px per arrow press
      const k = this._k();
      if (e.key === 'ArrowLeft') this._setPan(this.content.scrollX - pan / k, this.content.scrollY, false);
      else if (e.key === 'ArrowRight') this._setPan(this.content.scrollX + pan / k, this.content.scrollY, false);
      else if (e.key === 'ArrowUp') this._setPan(this.content.scrollX, this.content.scrollY - pan / k, false);
      else if (e.key === 'ArrowDown') this._setPan(this.content.scrollX, this.content.scrollY + pan / k, false);
      else if (e.key === '+' || e.key === '=') this.zoomBy(this.zoomStep, { silent: false });
      else if (e.key === '-') this.zoomBy(1 / this.zoomStep, { silent: false });
      else return;
      e.preventDefault();
    });
  }

  // Consumers add plane-coordinate content here (the ScrollArea.add convention).
  add(...nodes) { return this.content.add(...nodes); }

  // The uniform contract's disabled entry point; every gesture handler above guards on it.
  // setNodeDisabled cancels an in-flight pan/pinch capture; a coast already in motion
  // rides a frame hook instead of a capture, so a sealed surface stops it here.
  setDisabled(v) { setNodeDisabled(this, v); if (v) this._stopInertia(); }

  get panX() { return this.content.scrollX; }
  get panY() { return this.content.scrollY; }

  // World px per plane unit (worldScale makes nesting correct).
  _k() { return (this.content.worldScale || 1) * this.zoom; }

  screenToPlane(sx, sy) {
    const k = this._k();
    return {
      x: this.content.scrollX + (sx - this.content.worldX) / k,
      y: this.content.scrollY + (sy - this.content.worldY) / k,
    };
  }

  planeToScreen(px, py) {
    const k = this._k();
    return {
      x: this.content.worldX + (px - this.content.scrollX) * k,
      y: this.content.worldY + (py - this.content.scrollY) * k,
    };
  }

  // Per-axis pan range in plane units. Larger-than-view planes pin edge-to-edge
  // ([0, d]); smaller planes float fully visible ([d, 0]); continuous at the crossover.
  _rangeX() { const d = this.planeW - this.w / this.zoom; return { lo: Math.min(0, d), hi: Math.max(0, d) }; }
  _rangeY() { const d = this.planeH - this.h / this.zoom; return { lo: Math.min(0, d), hi: Math.max(0, d) }; }

  _setPan(x, y, silent) {
    const rx = this._rangeX(), ry = this._rangeY();
    const nx = clamp(x, rx.lo, rx.hi), ny = clamp(y, ry.lo, ry.hi);
    if (nx === this.content.scrollX && ny === this.content.scrollY) return;
    this.content.scrollX = nx;
    this.content.scrollY = ny;
    this.invalidateLayout();
    if (!silent) this.dispatch('panchange', { x: nx, y: ny, zoom: this.zoom });
  }

  _setZoomAt(z, sx, sy, silent) {
    z = clamp(z, this.minZoom, this.maxZoom);
    if (z === this.zoom) return;
    if (!this.engine) { // pre-attach: no world coords yet; set and clamp only
      this.zoom = z;
      this.content.contentScale = z;
      return;
    }
    const p = this.screenToPlane(sx, sy); // anchor plane point under the OLD transform
    this.zoom = z;
    this.content.contentScale = z;
    const k = this._k();
    this._setPan(p.x - (sx - this.content.worldX) / k, p.y - (sy - this.content.worldY) / k, true);
    this.invalidateLayout();
    if (!silent) this.dispatch('zoomchange', { zoom: z, x: this.content.scrollX, y: this.content.scrollY });
  }

  setZoom(z, { silent = true, anchor = null } = {}) {
    const r = this.worldRect;
    const ax = anchor ? anchor.x : (r.x0 + r.x1) / 2;
    const ay = anchor ? anchor.y : (r.y0 + r.y1) / 2;
    this._setZoomAt(z, ax, ay, silent);
  }

  zoomBy(f, opts) { this.setZoom(this.zoom * f, opts); }

  panTo(x, y, { silent = true } = {}) { this._setPan(x, y, silent); }

  // Center a plane point in the viewport. Before the first layout the viewport has no
  // size yet, so the request is parked and applied by the next layout pass (the
  // ScrollArea scrollToBottom idiom).
  centerOn(x, y, { silent = true } = {}) {
    if (!this.w || !this.h) {
      this._pendingCenter = { x, y, silent };
      this.invalidateLayout();
      return;
    }
    this._setPan(x - this.w / this.zoom / 2, y - this.h / this.zoom / 2, silent);
  }

  setPlaneSize(w, h) {
    // B5: the setter takes the same finite-first floor as the constructor
    this.planeW = Math.max(1, Number.isFinite(w) ? w : this.planeW);
    this.planeH = Math.max(1, Number.isFinite(h) ? h : this.planeH);
    this.invalidateLayout(); // layout re-clamps the pan
  }

  // Duck-type for gamepad right-stick and middle-button pan (vertical, screen px).
  get maxScroll() { const r = this._rangeY(); return r.hi - r.lo; }
  scrollBy(dy) { this._setPan(this.content.scrollX, this.content.scrollY + dy / this._k(), false); }

  _anchor(press) {
    press.sx = press.lastSeenX ?? press.lastX;
    press.sy = press.lastSeenY ?? press.lastY;
    press.panX0 = this.content.scrollX;
    press.panY0 = this.content.scrollY;
    press.lastX = press.sx; press.lastY = press.sy;
    press.vx = 0; press.vy = 0;
  }

  _beginPinch(touches) {
    this._stopInertia();
    EldTooltip.hideNow(); // same rule as the drag-pan claim: no leave will hide it mid-gesture
    for (const p of touches) {
      p.panning = true; // pinch owns both pointers; ignore claim echoes
      p.lastSeenX = p.lastSeenX ?? p.sx;
      p.lastSeenY = p.lastSeenY ?? p.sy;
      this.engine?.input.claimDrag(p.id, this);
    }
    const [a, b] = touches;
    const mx = (a.lastSeenX + b.lastSeenX) / 2, my = (a.lastSeenY + b.lastSeenY) / 2;
    this._pinch = {
      d0: Math.max(1, Math.hypot(a.lastSeenX - b.lastSeenX, a.lastSeenY - b.lastSeenY)),
      p0: this.screenToPlane(mx, my), // gesture-start plane point rides the live midpoint
      zoom0: this.zoom,
    };
  }

  _pinchMove() {
    const touches = [...this._presses.values()].filter((p) => p.touch);
    if (touches.length < 2 || !this._pinch) return;
    const [a, b] = touches;
    const mx = (a.lastSeenX + b.lastSeenX) / 2, my = (a.lastSeenY + b.lastSeenY) / 2;
    const d = Math.max(1, Math.hypot(a.lastSeenX - b.lastSeenX, a.lastSeenY - b.lastSeenY));
    const z = clamp(this._pinch.zoom0 * (d / this._pinch.d0), this.minZoom, this.maxZoom);
    this.zoom = z;
    this.content.contentScale = z;
    const k = this._k();
    this._setPan(this._pinch.p0.x - (mx - this.content.worldX) / k,
                 this._pinch.p0.y - (my - this.content.worldY) / k, false);
    this.invalidateLayout();
    this.dispatch('zoomchange', { zoom: z, x: this.content.scrollX, y: this.content.scrollY });
  }

  _startInertia(vx, vy) {
    this._coastVx = vx;
    this._coastVy = vy;
    this.setFrameHook((dt) => {
      // An ANCESTOR seal must stop the coast too (convention 3's in-flight seal):
      // cancelCapturesWithin can't see frame hooks, so the hook checks its own chain —
      // our own setDisabled already calls _stopInertia directly.
      if (this.closest((n) => n.disabled === true)) { this._stopInertia(); return; }
      const decay = Math.max(0, 1 - 4 * dt);
      this._coastVx *= decay;
      this._coastVy *= decay;
      if (Math.hypot(this._coastVx, this._coastVy) < 20) { this._stopInertia(); return; }
      const k = this._k();
      const bx = this.content.scrollX, by = this.content.scrollY;
      this._setPan(bx - this._coastVx * dt / k, by - this._coastVy * dt / k, false);
      if (this.content.scrollX === bx) this._coastVx = 0; // pinned at a bound:
      if (this.content.scrollY === by) this._coastVy = 0; // glide along the edge
      if (!this._coastVx && !this._coastVy) this._stopInertia();
    });
  }

  _stopInertia() {
    if (this._frameHook) this.setFrameHook(null);
    this._settle();
  }

  // Integer pan at rest when unzoomed keeps text/stone crisp (fractional pan is
  // inherent mid-gesture and under fractional zoom).
  _settle() {
    if (this.zoom !== 1) return;
    const sx = Math.round(this.content.scrollX), sy = Math.round(this.content.scrollY);
    if (sx === this.content.scrollX && sy === this.content.scrollY) return;
    this.content.scrollX = sx;
    this.content.scrollY = sy;
    this.invalidateLayout();
  }

  onLayout() {
    this.content.setRect(0, 0, this.w, this.h); // the viewport box
    this.content.contentScale = this.zoom;
    if (this._pendingCenter && this.w && this.h) {
      const { x, y, silent } = this._pendingCenter;
      this._pendingCenter = null;
      this._setPan(x - this.w / this.zoom / 2, y - this.h / this.zoom / 2, silent);
    }
    const rx = this._rangeX(), ry = this._rangeY();
    // resize/zoom re-clamp writes silently (the ScrollArea layout idiom)
    this.content.scrollX = clamp(this.content.scrollX, rx.lo, rx.hi);
    this.content.scrollY = clamp(this.content.scrollY, ry.lo, ry.hi);
  }

  onEngine(engine, _old) {
    if (!engine) { // a detach mid-gesture must not resume on re-attach
      if (this._frameHook) this.setFrameHook(null);
      this._presses.clear();
      this._pinch = null;
    }
  }
}

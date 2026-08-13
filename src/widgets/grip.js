// ResizeGrip: a DRAWN corner resize
// affordance for panel-class widgets, driving the same edge-anchored math the
// ModalWindow handles use. The grip is a 24px knurled stone wedge (STYLE §7 floor),
// self-positioned into its host's corner, with visible hover/press steps (law)
// and the pin-duck-type: a host exposing `atBottom`/`scrollToBottom` (EventLog,
// ChatBox — the pin surface) keeps a pinned reader pinned through the resize.
//
// THE FREEDOM LAW: a drag-resized host's maximum is not
// inhibited by other elements — pages no longer budget grip ceilings off their
// neighbors. The ONLY built-in ceiling keeps the DRAG GRIP within the visible
// screen: the moving edge (whose outer face IS the grip's outer face — see
// onLayout) may not leave the engine viewport. The bounds snapshot at
// pointerdown (world coords are frame-computed and go stale between the
// synchronous moves of one gesture; the anchor is fresh at the down). Floors
// stay sovereign — clamp() is min-wins, so a host born at the screen edge still
// honors minW/minH. maxW/maxH remain honored when a consumer passes them. A
// host nested in a PanZoom plane sees the ENGINE viewport, not the plane's clip
// (no shipped page nests a gripped host in a plane).

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { clamp } from '../layout.js';
import { requireEngine } from './widgets.js';

const tex = (name) => requireEngine().textures.get(name);

const GRIP = 24;
const CURSORS = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize' };
const REST_A = 0.55, HOVER_A = 0.85, PRESS_A = 1;

export class ResizeGrip extends UINode {
  // opts: { corner: 'tl'|'tr'|'bl'|'br' (default 'br'), minW, minH, maxW, maxH,
  //         onResize(w, h) } — the host also hears a bubbling `resize {w, h}`.
  constructor(host, opts = {}) {
    const corner = opts.corner ?? 'br';
    super({ interactive: true, cursor: CURSORS[corner] ?? 'se-resize' });
    this.host = host;
    this.corner = CURSORS[corner] ? corner : 'br';
    // B5: finite-first — clamp returns its MIN bound when that bound is NaN, so a NaN
    // floor collapses the host to a NaN rect on the first drag; non-finite max = no max
    this.minW = Number.isFinite(opts.minW) ? opts.minW : 60;
    this.minH = Number.isFinite(opts.minH) ? opts.minH : 40;
    this.maxW = Number.isFinite(opts.maxW) ? opts.maxW : Infinity;
    this.maxH = Number.isFinite(opts.maxH) ? opts.maxH : Infinity;
    // inverted finite bounds wedge clamp at the min forever (the NumberField class) —
    // normalize loudly instead of freezing
    if (this.minW > this.maxW) { console.warn(`LovecraftUI: ResizeGrip minW (${this.minW}) > maxW (${this.maxW}); swapping.`); const t = this.minW; this.minW = this.maxW; this.maxW = t; }
    if (this.minH > this.maxH) { console.warn(`LovecraftUI: ResizeGrip minH (${this.minH}) > maxH (${this.maxH}); swapping.`); const t = this.minH; this.minH = this.maxH; this.maxH = t; }
    this.onResize = opts.onResize ?? null;
    this.fitExclude = true;          // auto-sizing hosts and boxes ignore the grip
    this.auditAllow('overlap', 'containment'); // a corner overlay by design (rationed)
    this.quad = new QuadNode({ texture: tex(`grip.${this.corner}`), opacity: REST_A });
    this.add(this.quad);
    this.setSize(GRIP, GRIP);
    this.touchDragOwner = true;      // touching the grip resizes, never pans

    this._drag = null;
    this.on('pointerenter', () => {
      if (this.closest((n) => n.disabled === true)) return; // the hover seal
      if (!this._drag) this.quad.setBaseOpacity(HOVER_A);
    });
    this.on('pointerleave', () => { if (!this._drag) this.quad.setBaseOpacity(REST_A); });
    this.on('pointerdown', (e) => {
      if (e.button !== 0 || this.closest((n) => n.disabled === true)) return;
      e.stopPropagation();
      if (this._drag) return; // one gesture, one pointer — a second finger cannot hijack the resize (C3 law)
      // the screen-bounds ceiling (the freedom law): per-corner, the moving edge
      // stays inside the engine viewport — growing right/down is bounded by the
      // far edge, growing left/up by the FIXED anchor edge reaching the origin.
      // Snapshot at the down: worldX/worldY are frame truth here and stale later.
      const eng = requireEngine();
      const wsd = this.worldScale || 1;
      const vMaxW = this.corner[1] === 'l'
        ? (host.worldX + host.w * wsd) / wsd
        : (eng.width - host.worldX) / wsd;
      const vMaxH = this.corner[0] === 't'
        ? (host.worldY + host.h * wsd) / wsd
        : (eng.height - host.worldY) / wsd;
      this._drag = {
        id: e.pointerId ?? -1, sx: e.x, sy: e.y,
        x: host.x, y: host.y, w: host.w, h: host.h,
        vMaxW, vMaxH,
      };
      this.quad.setBaseOpacity(PRESS_A);
    });
    this.on('pointermove', (e) => {
      const d = this._drag;
      if (!d || (e.pointerId ?? -1) !== d.id) return;
      // screen delta ÷ worldScale = LOCAL px (the wartable idiom — the
 // sweep missed this site: any makeResizable host inside a zoomed plane
 // resized at zoom× the pointer motion)
      const ws = this.worldScale || 1;
      const dx = (e.x - d.sx) / ws, dy = (e.y - d.sy) / ws;
      const left = this.corner[1] === 'l', top = this.corner[0] === 't';
      // the explicit ceiling AND the screen-bounds ceiling compose; min-wins
      // keeps the floors sovereign at the screen edge (the windows precedent)
      const w = Math.round(clamp(d.w + (left ? -dx : dx), this.minW, Math.min(this.maxW, d.vMaxW)));
      const h = Math.round(clamp(d.h + (top ? -dy : dy), this.minH, Math.min(this.maxH, d.vMaxH)));
      const x = left ? d.x + (d.w - w) : d.x;
      const y = top ? d.y + (d.h - h) : d.y;
      if (w === host.w && h === host.h && x === host.x && y === host.y) return;
      // userPlaced (claim tightened): the host's box actually
      // CHANGED under a real pointer — page layout that re-sizes the host
      // should skip it once true (the chat-lane idiom, hand-rolled as
 // chatTaken/feedTaken before it lived here). A press alone claims
      // nothing: the no-op check above already knows press ≠ resize.
      host.userPlaced = true;
      const wasBottom = host.atBottom === true; // the pin duck-type, read BEFORE the move
      host.setRect(x, y, w, h);
      if (wasBottom && typeof host.scrollToBottom === 'function') host.scrollToBottom();
      host.dispatch('resize', { w, h });
      if (this.onResize) this.onResize(w, h);
    });
    this.on('pointerup', (e) => {
      if (!this._drag || (e.pointerId ?? -1) !== this._drag.id) return; // only the owner releases
      this._drag = null;
      this.quad.setBaseOpacity(e.canceled ? REST_A : HOVER_A); // canceled gestures end dark
    });
  }

  onLayout() {
    // self-position into the host corner (the parent laid out first — top-down law)
    const p = this.parent;
    if (!p) return;
    const x = this.corner[1] === 'l' ? 0 : p.w - GRIP;
    const y = this.corner[0] === 't' ? 0 : p.h - GRIP;
    this.setPos(x, y);
    this.quad.setRect(0, 0, GRIP, GRIP);
  }
}

// Attach a grip to any panel-class node: makeResizable(chat, { corner: 'tl' }).
export function makeResizable(host, opts = {}) {
  const grip = new ResizeGrip(host, opts);
  host.add(grip);
  return grip;
}

// Between Worlds: the UI reaches into the game world, and every prompt
// shows the right button. WorldAnchorLayer projects consumer world-space points
// through a consumer-supplied camera fn and parks UI nodes on them (one frame hook
// drives every anchor — pooled records, not per-anchor hooks); OffscreenIndicator
// is the edge-clamped arrow variant for objectives beyond the viewport. KeyGlyph
// bakes procedural keycap/mouse/gamepad-button art on demand into the texture
// registry (one bake per atom, then cache hits); InputPrompt shows the bind for
// the LAST-USED DEVICE and re-glyphs on the engine's `devicechange` event;
// InteractPrompt is the world-anchorable "press E" plate with an optional
// hold-to-confirm ring (the own-raster recipe — the ArcGauge WIDGET is gauge
// furniture: 270° sweep, center numeral; a hold ring wants a bare full circle).

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode, measureText, fontString } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { clamp } from '../layout.js';
import { requireEngine, uisound, setNodeDisabled } from './widgets.js';

const frame = (n) => requireEngine().textures.frame(n);
const tex = (n) => requireEngine().textures.get(n);
const SHADOW = METRICS.textShadow; // X02: the shared token (was a per-file literal)

// ---------------- glyph baking ----------------
// One registry texture per atom, baked on first use: `glyph.key.E`, `glyph.pad.A`,
// `glyph.mouse.1`. Names are data-driven (never literal tex('...') lookups), and
// re-init re-bakes naturally because the registry itself is per-engine.

const GLYPH_H = 22; // authored CSS height; consumers scale by node size

const KEY_DISPLAY = {
  ' ': 'Space', Spacebar: 'Space', Control: 'Ctrl', Escape: 'Esc', Delete: 'Del',
  Insert: 'Ins', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
// Resolved at PAINT time, not module load: painters run at bake, after applyTheme
// has re-pointed the live COLORS table — a snapshot here would pin stock hues onto
// every themed boot (caught by the brass gallery shot).
const FACE_ATOMS = new Set(['A', 'B', 'X', 'Y']);
const padColor = (atom) => ({ A: COLORS.accent, B: COLORS.negative, X: COLORS.manaTop, Y: COLORS.quest })[atom];

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function normKeyAtom(a) {
  const s = String(a);
  const mapped = KEY_DISPLAY[s] ?? (s.length === 1 ? s.toUpperCase() : s);
  return mapped;
}

// bind → [{ device, atom }] atoms. Strings are keyboard ('E', 'Ctrl+E', 'Space');
// { pad: 'A' } and { mouse: 1|2|3 } select the other devices; { key } unwraps.
export function normalizeBind(bind) {
  if (bind == null) return [];
  if (typeof bind === 'object') {
    if (bind.pad != null) return [{ device: 'pad', atom: String(bind.pad).toUpperCase() }];
    if (bind.mouse != null) return [{ device: 'mouse', atom: String(clamp(Math.round(bind.mouse), 1, 3)) }];
    if (bind.key != null) bind = bind.key;
    else return [];
  }
  return String(bind).split('+').filter(Boolean).map((a) => ({ device: 'key', atom: normKeyAtom(a) }));
}

function paintKeycap(ctx, w, h, label) {
  roundedRect(ctx, 1, 1, w - 2, h - 2, 4);
  ctx.fillStyle = COLORS.stoneMid; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
  roundedRect(ctx, 2.5, 2.5, w - 5, h - 5, 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.font = `bold 11px ${FONTS.mono}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2 - 1);
}

function paintPad(ctx, w, h, atom) {
  const c = padColor(atom);
  if (c) {
    // face button: dark disc, colored ring, colored letter (console convention)
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.stoneDark; ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = c;
    ctx.font = `bold 11px ${FONTS.mono}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(atom, w / 2, h / 2 + 0.5);
    return;
  }
  if (atom === 'LS' || atom === 'RS') {
    // stick: outer ring + offset nub
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.stoneDark; ctx.fill();
    ctx.strokeStyle = COLORS.textMuted; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2 - 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.textMuted; ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold 7px ${FONTS.mono}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(atom, w / 2, h - 6);
    return;
  }
  // bumpers and the long tail (LT/RT/Start/…): the labeled pill
  roundedRect(ctx, 1, h / 2 - 8, w - 2, 16, 7);
  ctx.fillStyle = COLORS.stoneMid; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.font = `bold 10px ${FONTS.mono}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(atom, w / 2, h / 2);
}

function paintMouse(ctx, w, h, atom) {
  // body
  roundedRect(ctx, 2, 1, w - 4, h - 2, (w - 4) / 2);
  ctx.fillStyle = COLORS.stoneDark; ctx.fill();
  ctx.strokeStyle = COLORS.textMuted; ctx.lineWidth = 1.5; ctx.stroke();
  // the pressed region lights accent: 1 = left half, 2 = right half, 3 = the wheel
  ctx.save();
  roundedRect(ctx, 2, 1, w - 4, h - 2, (w - 4) / 2);
  ctx.clip();
  ctx.fillStyle = COLORS.accent;
  if (atom === '1') ctx.fillRect(2, 1, (w - 4) / 2, h * 0.42);
  else if (atom === '2') ctx.fillRect(w / 2, 1, (w - 4) / 2, h * 0.42);
  else { roundedRect(ctx, w / 2 - 2, 4, 4, 8, 2); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w / 2, 1); ctx.lineTo(w / 2, h * 0.42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2, h * 0.42); ctx.lineTo(w - 2, h * 0.42); ctx.stroke();
}

// Bake (once) and return the registry texture for one bind atom. `bakeH` requests
// a larger authored height (billboard prompts): non-default sizes bake under an
// `@h`-suffixed name — the painters draw in 22px space and the canvas scales up,
// so a 44px glyph is crisp, not a stretched 22 (closed). Default
// names stay unsuffixed: every existing identity holds.
export function keyGlyphTexture(atomOrBind, bakeH = GLYPH_H) {
  const eng = requireEngine();
  const reg = eng.textures;
  const atoms = normalizeBind(atomOrBind);
  const a = atoms[0] ?? { device: 'key', atom: '?' };
  const hq = Number.isFinite(bakeH) && bakeH > 0 ? Math.round(bakeH) : GLYPH_H;
  const k = hq / GLYPH_H;
  const name = `glyph.${a.device}.${a.atom}${hq === GLYPH_H ? '' : `@${hq}`}`;
  if (!reg.textures.has(name)) {
    let baseW, paint;
    if (a.device === 'pad') {
      const wide = !FACE_ATOMS.has(a.atom) && a.atom !== 'LS' && a.atom !== 'RS';
      baseW = wide ? Math.max(26, Math.ceil(measureText(fontString({ size: 10, weight: 'bold', font: FONTS.mono }), a.atom)) + 12) : GLYPH_H;
      paint = paintPad;
    } else if (a.device === 'mouse') {
      baseW = 16;
      paint = paintMouse;
    } else {
      baseW = Math.max(GLYPH_H, Math.ceil(measureText(fontString({ size: 11, weight: 'bold', font: FONTS.mono }), a.atom)) + 12);
      paint = paintKeycap;
    }
    reg.make(name, Math.round(baseW * k), hq, (ctx, cw, ch) => {
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.scale(k, k); // painters draw in the authored 22px space
      paint(ctx, baseW, GLYPH_H, a.atom);
      ctx.restore();
    });
  }
  return reg.get(name);
}

// ---------------- KeyGlyph ----------------
// A bind rendered as its glyph row: 'E' is one keycap, 'Ctrl+E' is two, {pad:'A'}
// is the face button, {mouse:1} the mouse. setBind re-renders in place.

export class KeyGlyph extends UINode {
  // opts: { size = 22 }
  constructor(bind, opts = {}) {
    super({});
    requireEngine();
    this._size = Number.isFinite(opts.size) ? Math.max(10, opts.size) : GLYPH_H;
    this._quads = [];
    this.bind = null;
    this.setBind(bind ?? null);
  }

  setBind(bind) {
    for (const q of this._quads) q.dispose();
    this._quads.length = 0;
    this.bind = bind ?? null;
    const atoms = normalizeBind(bind);
    const h = this._size;
    let x = 0;
    for (const a of atoms) {
      // sizes past the authored 22px bake their own crisp texture; smaller ones
      // downscale the default (LinearFilter handles down gracefully, not up)
      const t = keyGlyphTexture({ [a.device === 'key' ? 'key' : a.device]: a.atom }, h > GLYPH_H ? h : GLYPH_H);
      const w = Math.round(t.userData.cssW * (h / t.userData.cssH));
      const q = new QuadNode({ texture: t });
      q.setRect(x, 0, w, h);
      this._quads.push(q);
      this.add(q);
      x += w + 4;
    }
    this.setSize(Math.max(0, x - 4), h);
    this.invalidateLayout();
    return this;
  }
}

// ---------------- InputPrompt ----------------
// InputPrompt(action, label): action = { key: 'E', pad: 'A', mouse: 1 } — the bind
// per device family. Shows the one for engine.lastInputDevice and re-glyphs on the
// bus `devicechange` event (fed by real presses; see engine.noteDevice).

export class InputPrompt extends UINode {
  // opts: { size = 22 }
  constructor(action = {}, label = '', opts = {}) {
    super({});
    const eng = requireEngine();
    this.action = action ?? {};
    this.glyph = new KeyGlyph(this._bindFor(eng.lastInputDevice), { size: opts.size });
    this.labelText = new TextNode(label ?? '', { size: 12, color: COLORS.text, shadow: SHADOW });
    this.add(this.glyph, this.labelText);
    this._offDevice = eng.bus.on('devicechange', ({ device }) => {
      this.glyph.setBind(this._bindFor(device));
      this._layout();
    });
    this._layout();
  }

  _bindFor(device) {
    const a = this.action;
    if (device === 'pad' && a.pad != null) return { pad: a.pad };
    if (a.key != null) return a.key;
    if (a.mouse != null) return { mouse: a.mouse };
    if (a.pad != null) return { pad: a.pad }; // pad-only actions show the pad bind everywhere
    return null;
  }

  setAction(action) {
    this.action = action ?? {};
    this.glyph.setBind(this._bindFor(requireEngine().lastInputDevice));
    this._layout();
    return this;
  }

  setLabel(t) {
    this.labelText.setText(t ?? '');
    this._layout();
    return this;
  }

  _layout() {
    const gw = this.glyph.w, gh = this.glyph.h;
    const h = Math.max(gh, this.labelText.h); // center BOTH in the row (a small glyph
    this.glyph.setPos(0, Math.round((h - gh) / 2)); // beside a taller label sat high)
    this.labelText.setPos(gw + (gw ? 8 : 0), Math.round((h - this.labelText.h) / 2));
    this.setSize(gw + (gw ? 8 : 0) + this.labelText.w, h);
    this.invalidateLayout();
  }

  disposeSelf() {
    if (this._offDevice) { this._offDevice(); this._offDevice = null; }
  }
}

// ---------------- WorldAnchorLayer ----------------
// project(x, y, z) -> { sx, sy, visible } is the consumer's camera. One frame hook
// drives every anchor record; anchored nodes are children (they die with the
// layer — the pool drains on dispose). Anchors center their node on the projected
// point (+ dx/dy); clampToEdge keeps it inside the viewport margins and reports
// the clamped direction to the node's optional onEdge(dir) — 'left'/'right'/
// 'up'/'down' while clamped, null when free (OffscreenIndicator's contract).
// A point BEHIND the camera (visible: false) under clampToEdge is mirrored across
// the screen center first — the classic flip that keeps the arrow honest.

export class WorldAnchorLayer extends UINode {
  // opts: { project: (x, y, z) => { sx, sy, visible } }  — required
  constructor(opts = {}) {
    super({});
    requireEngine();
    if (typeof opts.project !== 'function') {
      throw new Error('LovecraftUI WorldAnchorLayer: opts.project(x, y, z) -> { sx, sy, visible } is required.');
    }
    this.project = opts.project;
    // a transparent projection REGION, not a panel: tenants sit wherever the
    // world puts them — the audit's overlap/containment rules were never its law
    this.auditAllow('overlap', 'containment');
    this._anchors = [];
    this.setFrameHook(() => { for (const rec of [...this._anchors]) this._place(rec); });
  }

  // target: { x, y, z } (live-read each frame) or () => ({ x, y, z }) | null.
  // opts: { clampToEdge = false, edgeMargin = 24, fadeWith = null, dx = 0, dy = 0 }
  // fadeWith(target, p) -> 0..1 drives the node's fxOpacity per frame.
  anchor(node, target, { clampToEdge = false, edgeMargin = 24, fadeWith = null, dx = 0, dy = 0 } = {}) {
    this.release(node); // re-anchoring REPLACES the record (two would fight per frame)
    this.add(node);
    const rec = {
      node, target,
      clampToEdge: clampToEdge === true,
      edgeMargin: Number.isFinite(edgeMargin) ? edgeMargin : 24,
      fadeWith: typeof fadeWith === 'function' ? fadeWith : null,
      dx: Number.isFinite(dx) ? dx : 0,
      dy: Number.isFinite(dy) ? dy : 0,
      offDispose: null,
    };
    rec.offDispose = node.on('dispose', () => this.release(node));
    this._anchors.push(rec);
    this._place(rec);
    return node;
  }

  // Stops tracking; the node stays parented (the consumer owns it from here).
  release(node) {
    const i = this._anchors.findIndex((r) => r.node === node);
    if (i === -1) return false;
    const [rec] = this._anchors.splice(i, 1);
    if (rec.offDispose) rec.offDispose();
    return true;
  }

  get anchorCount() { return this._anchors.length; }

  _place(rec) {
    const eng = this.engine;
    if (!eng) return;
    const node = rec.node;
    // A reparented/removed tenant is the CONSUMER's node again — never write to what
    // this layer no longer owns. UINode.remove emits no event, so the ownership check
    // lives here (add() reassigns parent, making the test always current); the record
    // stays until release()/dispose, and re-anchoring replaces it.
    if (node.parent !== this) return;
    const t = typeof rec.target === 'function' ? rec.target() : rec.target;
    const p = t ? this.project(t.x ?? 0, t.y ?? 0, t.z ?? 0) : null;
    if (!p || !Number.isFinite(p.sx) || !Number.isFinite(p.sy)) {
      node.visible = false;
      if (node.onEdge) node.onEdge(null);
      return;
    }
    const W = eng.width, H = eng.height;
    let sx = p.sx, sy = p.sy;
    const behind = p.visible === false;
    if (!rec.clampToEdge) {
      node.visible = !behind;
      if (!behind) node.setPos(Math.round(sx - node.w / 2 + rec.dx), Math.round(sy - node.h / 2 + rec.dy));
      if (node.onEdge) node.onEdge(null);
    } else {
      if (behind) { sx = W - sx; sy = H - sy; } // mirror a behind-camera point
      const x = sx - node.w / 2 + rec.dx, y = sy - node.h / 2 + rec.dy;
      const M = rec.edgeMargin;
      const cx = clamp(x, M, Math.max(M, W - node.w - M));
      const cy = clamp(y, M, Math.max(M, H - node.h - M));
      node.visible = true;
      node.setPos(Math.round(cx), Math.round(cy));
      const offX = x - cx, offY = y - cy;
      let edge = null;
      if (behind || offX || offY) {
        edge = Math.abs(offX) >= Math.abs(offY)
          ? (offX < 0 ? 'left' : offX > 0 ? 'right' : (offY < 0 ? 'up' : 'down'))
          : (offY < 0 ? 'up' : 'down');
        if (behind && !offX && !offY) edge = 'down'; // dead-center behind: any honest edge
      }
      if (node.onEdge) node.onEdge(edge);
    }
    if (rec.fadeWith) {
      const a = rec.fadeWith(t, p);
      node.fxOpacity = Number.isFinite(a) ? clamp(a, 0, 1) : 1;
    }
  }

  onLayout() {
    if (this.engine) { this.w = this.engine.width; this.h = this.engine.height; } // the veil glue idiom
  }

  disposeSelf() {
    for (const rec of this._anchors) { if (rec.offDispose) rec.offDispose(); }
    this._anchors.length = 0;
  }
}

// ---------------- OffscreenIndicator ----------------
// The edge-clamped marker: a stone chip (optional icon) that hides while its
// target is on screen and, when the WorldAnchorLayer clamps it, shows with an
// accent arrow on the target-facing side. Anchor it with clampToEdge: true.

export class OffscreenIndicator extends UINode {
  // opts: { icon = null (a REGISTRY texture name — grep it first), size = 34,
  //         showWhenOnscreen = false }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const size = Number.isFinite(opts.size) ? Math.max(24, opts.size) : 34;
    this._showOn = opts.showWhenOnscreen === true;
    this.plate = new NineSliceNode(frame('button.normal'));
    this.plate.setRect(0, 0, size, size);
    this.add(this.plate);
    if (opts.icon) {
      this.icon = new QuadNode({ texture: tex(opts.icon) });
      this.icon.setRect(5, 5, size - 10, size - 10);
      this.add(this.icon);
    }
    this._arrow = new QuadNode({ texture: tex('tut.arrow.up') });
    this._arrow.visible = false;
    this.add(this._arrow);
    this.setSize(size, size);
    this.visible = this._showOn;
  }

  // The WorldAnchorLayer's per-frame contract: dir while clamped, null when free.
  onEdge(dir) {
    if (!dir) {
      this.visible = this._showOn;
      this._arrow.visible = false;
      return;
    }
    this.visible = true;
    this._arrow.visible = true;
    this._arrow.setTexture(tex(`tut.arrow.${dir}`));
    const s = this.w, A = 16, mid = Math.round((s - A) / 2);
    if (dir === 'left') this._arrow.setRect(-13, mid, A, A);
    else if (dir === 'right') this._arrow.setRect(s - 3, mid, A, A);
    else if (dir === 'up') this._arrow.setRect(mid, -13, A, A);
    else this._arrow.setRect(mid, s - 3, A, A);
  }
}

// ---------------- InteractPrompt ----------------
// The "press E" plate: InputPrompt on a stone callout, world-anchorable like any
// node. With opts.hold, beginHold()/cancelHold() drive a full-circle progress ring
// around the glyph (game code owns the actual key state); at full it dispatches
// `confirm {}` once and resets. setProgress(v) drives it manually.

const RING_PAD = 6;

export class InteractPrompt extends UINode {
  // opts: { action = { key: 'E', pad: 'A' }, label = '', hold = 0 (seconds), size = 22 }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this.onConfirm = opts.onConfirm ?? null;
    this._hold = Number.isFinite(opts.hold) && opts.hold > 0 ? opts.hold : 0;
    this._progress = 0;
    this._holding = false;
    this.bg = new NineSliceNode(frame('tooltip.frame'));
    this.prompt = new InputPrompt(opts.action ?? { key: 'E', pad: 'A' }, opts.label ?? '', { size: opts.size });
    this.add(this.bg, this.prompt);
    this._ring = null;
    this._ringArt = null;
    if (this._hold) {
      const D = (Number.isFinite(opts.size) ? Math.max(10, opts.size) : GLYPH_H) + RING_PAD * 2;
      this._ringArt = createCanvasTexture(D, D, texScale()); // rides the live bake density
      this._ring = new QuadNode({ texture: this._ringArt.texture });
      this._ring.auditAllow('containment'); // the hold ring wraps the glyph across the plate edge by design
      this._ring.setSize(D, D);
      this.add(this._ring);
      this._paintRing();
    }
    // the plate must track the glyph swap: 'Space' and pad-A differ wildly in width
    // (the child InputPrompt's own listener registered first, so it re-glyphs first)
    this._offDevice = requireEngine().bus.on('devicechange', () => this._fit());
    this._fit();
  }

  // The uniform disabled entry point; a seal mid-hold cancels the climb (the
  // disabled-subtree gesture rule — a sealed prompt must not confirm).
  setDisabled(v) {
    setNodeDisabled(this, v);
    if (v) this.cancelHold();
  }

  _fit() {
    const pw = this.prompt.w, ph = this.prompt.h;
    this.setSize(pw + 24, Math.max(ph + 16, 36));
    this.invalidateLayout();
  }

  get progress() { return this._progress; }

  setProgress(v) {
    this._progress = Number.isFinite(v) ? clamp(v, 0, 1) : 0;
    this._paintRing();
    return this;
  }

  beginHold() {
    if (!this._hold || this._holding || this.disabled) return this;
    this._holding = true;
    uisound(this, 'cast', { hold: true });
    this._arm();
    return this;
  }

  cancelHold() {
    if (this._holding && this._progress > 0) uisound(this, 'close', { hold: true });
    this._holding = false; // the armed hook drains what remains
    return this;
  }

  _arm() {
    if (this._frameHook) return;
    this.setFrameHook((dt) => {
      // an ANCESTOR sealing mid-hold must stop the climb too (frame hooks self-check
      // their disabled chain — the panzoom coast rule; cancelCapturesWithin can't see us)
      if (this._holding && this.closest((n) => n.disabled === true)) this.cancelHold();
      if (this._holding) {
        this._progress = Math.min(1, this._progress + dt / this._hold);
        this._paintRing();
        if (this._progress >= 1) {
          this._holding = false;
          this._progress = 0;
          this._paintRing();
          this.setFrameHook(null);
          uisound(this, 'click', { confirm: true });
          this.dispatch('confirm', {});
          if (this.onConfirm) this.onConfirm();
        }
      } else if (this._progress > 0) {
        this._progress = Math.max(0, this._progress - (dt * 3) / this._hold);
        this._paintRing();
      } else {
        this.setFrameHook(null); // idle: release the render wake
      }
    });
  }

  _paintRing() {
    if (!this._ringArt) return;
    const { ctx, texture } = this._ringArt;
    const D = texture.userData.cssW, r = D / 2 - 2;
    ctx.clearRect(0, 0, D, D);
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.stoneDark;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(D / 2, D / 2, r, 0, Math.PI * 2); ctx.stroke();
    if (this._progress > 0.001) {
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(D / 2, D / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this._progress);
      ctx.stroke();
    }
    texture.needsUpdate = true;
    (this.engine ?? this._lastEngine)?.requestRender();
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.prompt.setPos(12, Math.round((this.h - this.prompt.h) / 2));
    if (this._ring) {
      const g = this.prompt.glyph;
      // centered on the glyph block (holds are single-key affairs; a combo just
      // gets a wider-than-round halo)
      this._ring.setPos(
        12 + Math.round(g.x + g.w / 2 - this._ring.w / 2),
        this.prompt.y + Math.round(g.y + g.h / 2 - this._ring.h / 2),
      );
    }
  }

  disposeSelf() {
    if (this._offDevice) { this._offDevice(); this._offDevice = null; }
    if (this._ringArt) { this._ringArt.texture.dispose(); this._ringArt = null; }
  }
}

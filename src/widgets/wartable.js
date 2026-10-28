// The War Table: the strategy/management kit — an RTS/city-builder HUD
// out of the box. SelectionMarquee (a drag-rect that begins ONLY on empty space —
// no interactive hit — and narrates its phases; THE GAME does entity selection,
// shift rides every payload for add-to-selection), CommandCard (the command grid:
// icon + KeyGlyph hotkey + cost + disabled states, hotkeys dispatch from the
// bus while nothing holds focus; a display-only unit tray — click-to-filter fell
// to the cut line), BuildQueue (horizontal slots, head-of-queue progress underbar,
// click-cancel with the data-driven protocol, count stacking), and TacticalMap
// (minimap v2: RECTANGULAR, an optional terrain painter over the own-raster
// recipe, a viewport rect, click-to-move — drag-to-move fell to the cut line —
// and finite ping/waypoint pulses; §9-legal: event-driven juice, never idle).

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS, socketInset } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { clamp } from '../layout.js';
import { requireEngine, uisound, commitChange, setNodeDisabled, EldTooltip } from './widgets.js';
import { isReducedMotion } from '../animate.js';
import { attachBadge } from './meters.js';
import { keyGlyphTexture } from './worldui.js';

const frame = (n) => requireEngine().textures.frame(n);
const tex = (n) => requireEngine().textures.get(n);
// Icons accept BARE ability ids ('shield' means 'icon.shield') and full dotted
// registry names. A bare id rides the icon.* door UNCONDITIONALLY: the
// engine law bakes a QUIET pending plate for an unknown icon.* name and
// the pack re-bakes that NAME in place, so the plate's quad FOLLOWS the pack.
// The old `has(bare)` guard predated the purge — with no procedural ability
// painters left, nothing pre-bakes icon.*, so every bare id fell through to
// reg.get('shield'): the LOUD magenta fallback under a name the pack never
// re-bakes (the frozen strategy card wore a wall of magenta '?', and the live
// card could never adopt the pack either).
const iconTex = (n) => {
  const reg = requireEngine().textures;
  return String(n).includes('.') ? reg.get(n) : reg.get(`icon.${n}`);
};
const SHADOW = METRICS.textShadow; // X02: the shared token (was a per-file literal)

// ---------------- SelectionMarquee ----------------
// Mount it on engine.layers.ghost (above the scene, above panels — the classic
// RTS read). It watches the BUS: a primary press whose hit target is NULL (empty
// stone) arms it; crossing the drag threshold makes it live and narrates
// `marquee {x, y, w, h, phase: 'start'|'drag', shift}` per move, then
// `marqueeend {x, y, w, h, shift, canceled}` on release. Sub-threshold presses
// stay clicks (no events). The GAME intersects the rect with its entities.

export class SelectionMarquee extends UINode {
  // opts: { onSelect = null } — onSelect(payload) fires with marqueeend (never on cancel)
  constructor(opts = {}) {
    super({}); // never interactive: the rect is chrome, not a hit surface
    const eng = requireEngine();
    this.onSelect = opts.onSelect ?? null;
    this.fill = new QuadNode({ color: COLORS.accent, opacity: 0.1 });
    this._edges = [];
    for (let i = 0; i < 4; i++) {
      const e = new QuadNode({ color: COLORS.accent, opacity: 0.8 });
      this._edges.push(e);
      this.add(e);
    }
    this.add(this.fill);
    this.visible = false;
    this._drag = null;
    this._offs = [
      eng.bus.on('pointerdown', (e) => {
        if (this.disposed || e.button !== 0 || e.target) return; // ONLY empty space
        if (this.closest((n) => n.disabled === true)) return;    // sealed chain
        if (this._drag) return; // C3: an armed marquee ignores further presses — one gesture, one pointer
        this._drag = { id: e.pointerId, x0: e.x, y0: e.y, live: false };
      }),
      eng.bus.on('pointermove', (e) => {
        const d = this._drag;
        if (!d || e.pointerId !== d.id) return;
        // a seal landing MID-DRAG halts the gesture (the panzoom-coast rule):
        // a live rect ends marked canceled, an armed-but-quiet press just dies
        if (this.closest((n) => n.disabled === true)) {
          this._drag = null;
          if (d.live) {
            this.visible = false;
            this.dispatch('marqueeend', { ...this._rect(d, e.x, e.y), shift: !!e.native?.shiftKey, canceled: true });
          }
          return;
        }
        d.x1 = e.x; d.y1 = e.y; // last seen position — shapes the rect if disposed mid-drag
        const shift = !!e.native?.shiftKey;
        const r = this._rect(d, e.x, e.y);
        if (!d.live) {
          if (Math.max(Math.abs(e.x - d.x0), Math.abs(e.y - d.y0)) < METRICS.dragThreshold) return;
          d.live = true;
          this.visible = true;
          this.dispatch('marquee', { ...r, phase: 'start', shift });
        }
        this.setRect(r.x, r.y, r.w, r.h);
        this.dispatch('marquee', { ...r, phase: 'drag', shift });
      }),
      eng.bus.on('pointerup', (e) => this._finish(e, false)),
      eng.bus.on('pointercancel', (e) => this._finish(e, true)),
    ];
  }

  _rect(d, x1, y1) {
    return {
      x: Math.min(d.x0, x1), y: Math.min(d.y0, y1),
      w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0),
    };
  }

  _finish(e, canceled) {
    const d = this._drag;
    if (!d || e.pointerId !== d.id) return;
    this._drag = null;
    if (!d.live) return; // it stayed a click: no marquee happened
    this.visible = false;
    const shift = !!e.native?.shiftKey;
    const r = this._rect(d, e.x, e.y);
    const payload = { ...r, shift, canceled };
    this.dispatch('marqueeend', payload);
    if (!canceled && this.onSelect) this.onSelect(payload);
  }

  onLayout() {
    this.fill.setRect(0, 0, this.w, this.h);
    this._edges[0].setRect(0, 0, this.w, 1);
    this._edges[1].setRect(0, Math.max(0, this.h - 1), this.w, 1);
    this._edges[2].setRect(0, 0, 1, this.h);
    this._edges[3].setRect(Math.max(0, this.w - 1), 0, 1, this.h);
  }

  disposeSelf() {
    // disposed mid-gesture: the consumer still hears the end (the B4 rule — no gesture
    // ends silently); the last stashed move position shapes the final rect
    const d = this._drag;
    if (d?.live) {
      this._drag = null;
      this.dispatch('marqueeend', { ...this._rect(d, d.x1 ?? d.x0, d.y1 ?? d.y0), shift: false, canceled: true });
    }
    for (const off of this._offs) off();
    this._offs.length = 0;
  }
}

// ---------------- CommandCard ----------------
// The selected-units tray (display chips with counts — filtering fell to the cut
// line) over the command grid: slot plates with an icon, an keycap in the
// corner, a cost in quest-gold, and per-command disabled states. Clicks and BUS
// HOTKEYS (single-atom keyboard binds, matched while nothing holds focus) both
// funnel into one loud `command {id, cost}`.

const CMD_SLOT = 56;

export class CommandCard extends UINode {
  // opts: { commands = [{id, icon, hotkey, cost, disabled}], units = [{id, icon, count}],
  //         cols = 4, gap = 6, onCommand = null }
  constructor(opts = {}) {
    super({ interactive: true }); // its own surface: presses on the card stop here
    const eng = requireEngine();
    // Math.max(1, …): round() maps (0, 0.5) to 0, and a 0 column count is NaN/Infinity
    // plate coords (i % 0, i / 0) — the floor keeps hostile-but-positive input drawable
    this._cols = Number.isFinite(opts.cols) && opts.cols > 0 ? Math.max(1, Math.round(opts.cols)) : 4;
    this._gap = Number.isFinite(opts.gap) ? opts.gap : 6;
    this.onCommand = opts.onCommand ?? null;
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.add(this.bg);
    this._tray = new UINode({ name: 'unit-tray' });
    this._grid = new UINode({ name: 'command-grid' });
    this.add(this._tray, this._grid);
    this._plates = new Map();
    this._hotkeys = new Map();
    this._offKey = eng.bus.on('keydown', (e) => {
      // a hidden or sealed card keeps its subscription but is DEAF — bus hotkeys are
      // visibility-scoped for a card (two mounted cards sharing a letter must not both
      // fire, and an invisible card gives no feedback for its command)
      if (!this.visibleInTree() || this.closest((n) => n.disabled === true)) return;
      const cmd = this._hotkeys.get(String(e.key ?? '').toUpperCase());
      if (!cmd) return;
      e.native?.preventDefault?.();
      this._fire(cmd);
    });
    this.setUnits(opts.units ?? []);
    this.setCommands(opts.commands ?? []);
  }

  setUnits(units) {
    for (const c of [...this._tray.children]) c.dispose();
    this._units = units ?? [];
    let x = 0;
    for (const u of this._units) {
      const chip = new UINode({ name: `unit:${u.id}` });
      const bg = new QuadNode({ texture: tex('slot.frame') });
      bg.setRect(0, 0, 40, 40);
      const icon = new QuadNode({ texture: iconTex(u.icon ?? 'shield') });
      const ci = socketInset(40); // the socket law (was 6/28 — 15%)
      icon.setRect(ci, ci, 40 - ci * 2, 40 - ci * 2);
      chip.add(bg, icon);
      chip.setRect(x, 0, 40, 40);
      if ((u.count ?? 1) > 1) attachBadge(chip, { count: u.count });
      this._tray.add(chip);
      x += 46;
    }
    this._tray.setSize(Math.max(0, x - 6), 40);
    this._fit();
    return this;
  }

  setCommands(commands) {
    for (const c of [...this._grid.children]) c.dispose();
    this._plates.clear();
    this._hotkeys.clear();
    this._commands = (commands ?? []).map((c) => ({ ...c, id: String(c.id) }));
    this._commands.forEach((cmd, i) => {
      const plate = new UINode({ interactive: true, name: `cmd:${cmd.id}` });
      plate.focusable = true;
      const bg = new QuadNode({ texture: tex('slot.frame') });
      bg.setRect(0, 0, CMD_SLOT, CMD_SLOT);
      const icon = new QuadNode({ texture: iconTex(cmd.icon ?? 'sword') });
      const pi = socketInset(CMD_SLOT); // the socket law (was 10/36 — 17.9%)
      icon.setRect(pi, pi, CMD_SLOT - pi * 2, CMD_SLOT - pi * 2);
      plate.add(bg, icon);
      if (cmd.hotkey != null) {
        const t = keyGlyphTexture(cmd.hotkey);
        const g = new QuadNode({ texture: t });
        const h = 20; // the ActionSlot keycap size — one convention, both bars
        g.setRect(3, 3, Math.round(t.userData.cssW * (h / t.userData.cssH)), h);
        plate.add(g);
        if (typeof cmd.hotkey === 'string' && !cmd.hotkey.includes('+')) {
          this._hotkeys.set(cmd.hotkey.toUpperCase(), cmd);
        }
      }
      if (cmd.cost != null) {
        const cost = new TextNode(String(cmd.cost), { font: FONTS.mono, size: 10, color: COLORS.quest, shadow: SHADOW });
        cost.setPos(CMD_SLOT - 6 - Math.ceil(cost.w), CMD_SLOT - 16);
        plate.add(cost);
      }
      plate.setRect((i % this._cols) * (CMD_SLOT + this._gap), Math.floor(i / this._cols) * (CMD_SLOT + this._gap), CMD_SLOT, CMD_SLOT);
      // plates had NO states at all (the census's named CommandCard finding) —
      // the wash floors land, sealed against disabled like every hover channel
      const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      wash.setRect(0, 0, CMD_SLOT, CMD_SLOT);
      plate.add(wash);
      plate._wash = wash;
      let hov = false;
      plate.on('pointerenter', () => { if (!plate.closest((n) => n.disabled === true)) { hov = true; wash.setBaseOpacity(METRICS.washHover); } });
      plate.on('pointerleave', () => { hov = false; wash.setBaseOpacity(0); });
      plate.on('pointerdown', () => wash.setBaseOpacity(METRICS.washPress));
      plate.on('pointerup', (e) => wash.setBaseOpacity(!e.canceled && hov ? METRICS.washHover : 0));
      plate.on('click', (e) => {
        if (this.disabled) { e.stopPropagation(); return; }
        this._fire(cmd);
      });
      if (cmd.disabled) setNodeDisabled(plate, true);
      // a sealed command with a `reason` explains itself on hover (dead
 // controls must say why) — hover still reaches sealed plates by design
      if (cmd.disabled && cmd.reason) {
        plate._reasonDetach = EldTooltip.attach(plate, () => ({
          title: cmd.label ?? cmd.id, desc: cmd.reason,
          stats: cmd.cost != null ? [['Cost', String(cmd.cost)]] : undefined,
        }));
      }
      this._plates.set(cmd.id, plate);
      this._grid.add(plate);
    });
    const rows = Math.ceil(this._commands.length / this._cols);
    this._grid.setSize(this._cols * (CMD_SLOT + this._gap) - this._gap, Math.max(0, rows * (CMD_SLOT + this._gap) - this._gap));
    this._fit();
    return this;
  }

  setCommandDisabled(id, v) {
    const cmd = this._commands.find((c) => c.id === String(id));
    const plate = this._plates.get(String(id));
    if (!cmd || !plate) return false;
    cmd.disabled = v === true;
    setNodeDisabled(plate, cmd.disabled);
    // the lock-reason tooltip lives exactly as long as the lock does
    if (cmd.disabled && cmd.reason && !plate._reasonDetach) {
      plate._reasonDetach = EldTooltip.attach(plate, () => ({
        title: cmd.label ?? cmd.id, desc: cmd.reason,
        stats: cmd.cost != null ? [['Cost', String(cmd.cost)]] : undefined,
      }));
    } else if (!cmd.disabled && plate._reasonDetach) {
      plate._reasonDetach();
      plate._reasonDetach = null;
    }
    return true;
  }

  _fire(cmd) {
    if (this.disabled || cmd.disabled) {
      uisound(this, 'error', { command: cmd.id });
      return;
    }
    // the ctor callback receives the PAYLOAD first (the payload has no .value for
    // commitChange to project; arg2 stays the payload for legacy (_, e) consumers)
    commitChange(this, 'command', { id: cmd.id, cost: cmd.cost ?? null }, false,
      this.onCommand ? (_v, e) => this.onCommand(e, e) : null);
  }

  _fit() {
    const trayH = this._tray.children.length ? 40 + 8 : 0;
    this.setSize(
      Math.max(this._grid.w, this._tray.w) + 24,
      trayH + this._grid.h + 24,
    );
    this.invalidateLayout();
  }

  setDisabled(v) {
    setNodeDisabled(this, v);
    // W09 (L12): the seal RE-DERIVES hover — a cursor parked on a plate when the
    // seal lands must not leave its wash lit until a leave finally fires
    if (v) for (const plate of this._plates.values()) plate._wash?.setBaseOpacity(0);
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    const trayH = this._tray.children.length ? 40 + 8 : 0;
    this._tray.setPos(12, 12);
    this._grid.setPos(12, 12 + trayH);
  }

  disposeSelf() {
    if (this._offKey) { this._offKey(); this._offKey = null; }
  }
}

// ---------------- BuildQueue ----------------
// Horizontal production slots: the head wears a progress underbar, any filled
// slot cancels on click (`cancel {index, id}` — the game mutates and calls
// setQueue back, the data-driven protocol), and repeat entries stack a count.

const BQ_SLOT = 48;

export class BuildQueue extends UINode {
  // opts: { slots = 5, gap = 6, onCancel = null }
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    this._slots = Number.isFinite(opts.slots) && opts.slots > 0 ? Math.max(1, Math.round(opts.slots)) : 5;
    this._gap = Number.isFinite(opts.gap) ? opts.gap : 6;
    this.onCancel = opts.onCancel ?? null;
    this.bg = new NineSliceNode(frame('panel.dark'));
    this._row = new UINode({ name: 'queue-row' });
    this._bar = new QuadNode({ color: COLORS.accent, opacity: 0.9 });
    this._bar.visible = false;
    this.add(this.bg, this._row, this._bar);
    this._progress = 0;
    this.setQueue(opts.queue ?? []);
    this.setSize(this._slots * (BQ_SLOT + this._gap) - this._gap + 24, BQ_SLOT + 24);
  }

  setQueue(items) {
    for (const c of [...this._row.children]) c.dispose();
    this.queue = (items ?? []).map((it) => ({ ...it, id: String(it.id) }));
    for (let i = 0; i < this._slots; i++) {
      const it = this.queue[i] ?? null;
      const cell = new UINode({ name: `bq:${i}`, interactive: !!it });
      const bg = new QuadNode({ texture: tex('slot.frame'), opacity: it ? 1 : 0.35 });
      bg.setRect(0, 0, BQ_SLOT, BQ_SLOT);
      cell.add(bg);
      if (it) {
        const icon = new QuadNode({ texture: iconTex(it.icon ?? 'sword') });
        const qi = socketInset(BQ_SLOT); // the socket law (was 8/32 — 16.7%)
        icon.setRect(qi, qi, BQ_SLOT - qi * 2, BQ_SLOT - qi * 2);
        cell.add(icon);
        if ((it.count ?? 1) > 1) attachBadge(cell, { count: it.count });
        cell.on('click', (e) => {
          if (this.disabled) { e.stopPropagation(); return; }
          commitChange(this, 'cancel', { index: i, id: it.id }, false,
            this.onCancel ? (_v, e2) => this.onCancel(e2, e2) : null);
        });
      }
      cell.setRect(i * (BQ_SLOT + this._gap), 0, BQ_SLOT, BQ_SLOT);
      this._row.add(cell);
    }
    this._row.setSize(this._slots * (BQ_SLOT + this._gap) - this._gap, BQ_SLOT);
    this._paintBar();
    return this;
  }

  // The head-of-queue fill, 0..1 (presentation only; the game clocks production).
  setProgress(v) {
    this._progress = Number.isFinite(v) ? clamp(v, 0, 1) : 0;
    this._paintBar();
    return this;
  }

  _paintBar() {
    const on = this.queue.length > 0 && this._progress > 0.001;
    this._bar.visible = on;
    if (on) this._bar.setRect(12, 12 + BQ_SLOT - 4, Math.round(BQ_SLOT * this._progress), 3);
    this.invalidatePaint();
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this._row.setPos(12, 12);
    this._paintBar();
  }
}

// ---------------- TacticalMap ----------------
// Minimap v2, rectangular: an own-raster ground (the optional `terrain(ctx, w, h)`
// painter hook, else a quiet default), a viewport rect in world coordinates, a
// loud `moveto {x, y}` on click (drag-to-move fell to the cut line), and finite
// ping/waypoint pulses (event-driven juice; nothing idles).

const MAP_INSET = 4;

export class TacticalMap extends UINode {
  // opts: { width = 220, height = 160, world = { w: 1000, h: 1000 },
  //         terrain = null, onMove = null }
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    this.world = {
      w: Number.isFinite(opts.world?.w) && opts.world.w > 0 ? opts.world.w : 1000,
      h: Number.isFinite(opts.world?.h) && opts.world.h > 0 ? opts.world.h : 1000,
    };
    this.onMove = opts.onMove ?? null;
    const w = Number.isFinite(opts.width) ? Math.max(80, opts.width) : 220;
    const h = Number.isFinite(opts.height) ? Math.max(60, opts.height) : 160;
    this.bg = new NineSliceNode(frame('panel.dark'));
    this._mapW = w - MAP_INSET * 2;
    this._mapH = h - MAP_INSET * 2;
    this._ground = createCanvasTexture(this._mapW, this._mapH, texScale());
    this._groundQuad = new QuadNode({ texture: this._ground.texture });
    this.add(this.bg, this._groundQuad);
    this._paintGround(typeof opts.terrain === 'function' ? opts.terrain : null);
    this._vp = null;
    this._vpEdges = [];
    for (let i = 0; i < 4; i++) {
      const e = new QuadNode({ color: COLORS.accent, opacity: 0.85 });
      e.visible = false;
      this._vpEdges.push(e);
      this.add(e);
    }
    this.setSize(w, h);
    this.on('click', (e) => {
      if (this.disabled) { e.stopPropagation(); return; }
      // screen deltas divide out ancestor scale first — a map nested in a zoomed plane
      // reads its inset/board math in LOCAL px (correct at any worldScale, not just 1)
      const ws = this.worldScale || 1;
      const lx = clamp(((e.x - this.worldX) / ws - MAP_INSET) / this._mapW, 0, 1);
      const ly = clamp(((e.y - this.worldY) / ws - MAP_INSET) / this._mapH, 0, 1);
      commitChange(this, 'moveto', { x: lx * this.world.w, y: ly * this.world.h }, false,
        this.onMove ? (_v, e2) => this.onMove(e2, e2) : null);
    });
  }

  _paintGround(terrain) {
    const { ctx, texture } = this._ground;
    const w = this._mapW, h = this._mapH;
    ctx.clearRect(0, 0, w, h);
    if (terrain) {
      terrain(ctx, w, h);
    } else {
      ctx.fillStyle = COLORS.abyss2;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = COLORS.mossDark;
      for (let gx = 8; gx < w; gx += 16) {
        for (let gy = 8; gy < h; gy += 16) {
          if (((gx * 7 + gy * 13) % 5) === 0) ctx.fillRect(gx, gy, 2, 2);
        }
      }
    }
    texture.needsUpdate = true;
    (this.engine ?? this._lastEngine)?.requestRender();
  }

  // World-space viewport rect (the camera's footprint); null hides it.
  setViewport(rect) {
    this._vp = rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ? { ...rect } : null;
    this._layoutViewport();
    return this;
  }

  _layoutViewport() {
    const on = !!this._vp;
    for (const e of this._vpEdges) e.visible = on;
    if (!on) return;
    const sx = this._mapW / this.world.w, sy = this._mapH / this.world.h;
    const x = MAP_INSET + clamp(this._vp.x * sx, 0, this._mapW);
    const y = MAP_INSET + clamp(this._vp.y * sy, 0, this._mapH);
    const w = clamp(this._vp.w * sx, 2, this._mapW);
    const h = clamp(this._vp.h * sy, 2, this._mapH);
    this._vpEdges[0].setRect(x, y, w, 1);
    this._vpEdges[1].setRect(x, y + h - 1, w, 1);
    this._vpEdges[2].setRect(x, y, 1, h);
    this._vpEdges[3].setRect(x + w - 1, y, 1, h);
  }

  // A finite ping pulse at world coords; waypoints ring in quest-gold. Returns the
  // pulse node (auto-disposes when the pulse lands).
  ping(x, y, { waypoint = false } = {}) {
    const eng = requireEngine();
    const reg = eng.textures;
    const name = waypoint ? 'tactmap.waypoint' : 'tactmap.ping';
    if (!reg.textures.has(name)) {
      reg.make(name, 24, 24, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = waypoint ? COLORS.quest : COLORS.accent;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); ctx.stroke();
      });
    }
    const px = MAP_INSET + clamp(x / this.world.w, 0, 1) * this._mapW;
    const py = MAP_INSET + clamp(y / this.world.h, 0, 1) * this._mapH;
    const pulse = new QuadNode({ texture: reg.get(name) });
    pulse.setRect(Math.round(px - 12), Math.round(py - 12), 24, 24);
    pulse.fxScale = 0.3;
    this.add(pulse);
    uisound(this, 'notify', { ping: true, waypoint });
    if (!isReducedMotion()) eng.ticker.tween(pulse, { fxScale: 1.4 }, { dur: 0.7 }); // the fade below still runs (and cleans the ping up)
    eng.ticker.tween(pulse, { fxOpacity: 0 }, {
      dur: 0.7,
      onDone: () => { if (!pulse.disposed) pulse.dispose(); },
    });
    // dispose-cancel can swallow onDone (the veil rule): a map dying mid-pulse
    // takes the pulse with it through the normal child chain — nothing leaks.
    return pulse;
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this._groundQuad.setRect(MAP_INSET, MAP_INSET, this._mapW, this._mapH);
    this._layoutViewport();
  }

  disposeSelf() {
    if (this._ground) { this._ground.texture.dispose(); this._ground = null; }
  }
}

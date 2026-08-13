// The Lantern Bearer: the action/adventure kit. RadialMenu — the summoning
// circle: an own-raster annulus whose HIT AREA IS THE RING (a containsPoint override,
// the Spotlight precedent — corners and the center hole fall through to whatever is
// below; the same predicate fences focus, so gamepad-A can only land on real
// sectors), atan2 sector picking for mouse AND left stick, one focus stop with
// arrow-walk (the MenuList convention), the EldContextMenu token discipline on the
// Escape stack, click-toggle protocol (hold-open fell per the cut line). NESTED
// RINGS shipped (the graduation): an item with
// `children` is a PARENT — activating it swaps the SAME ring in place for the
// child items plus one Back sector, `select` fires on LEAVES only with the
// breadcrumb `path`, and Escape/gamepad-B pops ONE level per press (the child
// ring is the top surface — API convention 8). Same radius, same frozen canvas,
// same annulus hit law, so the focus fence's 5x5 reach grid never re-learns.
// BossBar — a name plate over SegmentedBar phases with an enrage BigTimer slot
// (damage-flash fell per the cut line). Zero atlas cost: the circle is
// own-raster, everything else composes shipped parts.

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { isReducedMotion } from '../animate.js';
import { commitChange, requireEngine, widgetsEngine, uisound, EldTooltip, setNodeDisabled } from './widgets.js';
import { SegmentedBar, BigTimer } from './meters.js';
import { str } from '../strings.js';

const SHADOW = METRICS.textShadow;

// ---------------- RadialMenu ----------------
// items: [{ id, icon, label, disabled, reason, children, onSelect }]. Mounts itself
// HIDDEN on the radial band (its own layer above every page surface, so a
// wheel can never be buried by later overlay mounts; a presenting modal popup makes
// it CLOSE instead); open(x, y) shows it centered there (NaN centers on the engine —
// clamp lesson), close() hides it and releases every token. Both
// commits narrate: loud `open {x, y}` / `close {}` (the Select open/close parity —
// {silent} gates only the voice, never the event). The stick is
// self-polled (GamepadNav publishes no axis state); inject getGamepads for tests.
// `children` makes a sector a PARENT: activating it swaps the ring in place
// for the child items + a Back sector; `this.items` stays the ROOT array forever
// (consumers and drives read it — only the DISPLAYED `_ring` swaps).

export class RadialMenu extends UINode {
  // opts: { items = [], rOut = 120, rIn = 44, onSelect, getGamepads }
  constructor(opts = {}) {
    super({ interactive: true });
    const eng = requireEngine();
    const rOut = Number(opts.rOut);
    const rIn = Number(opts.rIn);
    this.rOut = Number.isFinite(rOut) ? Math.max(40, rOut) : 120;
    this.rIn = Number.isFinite(rIn) && rIn > 0 && rIn < this.rOut ? rIn : Math.round(this.rOut * 0.37);
    this.items = opts.items ?? [];
    this.onSelect = opts.onSelect ?? null;
    // ground registration: { ground: true } makes THIS wheel the radial
    // chain's terminus — the wheel an unconsumed right-click lands on when no
    // radialItems provider answers. Last registration wins; dispose unregisters.
    this._isGround = opts.ground === true;
    if (this._isGround) eng.radialGround = this;
    this._getGamepads = opts.getGamepads
      ?? (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => []);
    this.isOpen = false;
    this.index = -1;
    this._offEscape = null;
    this._offTab = null;
    this._offDown = null;
    this._prevFocus = null;
    this._prevSource = null;
    // the nesting state: _ring is what the wheel DISPLAYS; _level stacks
    // {ring, index} frames so Back re-lights the sector you descended through
    this._ring = this.items;
    this._level = [];
    this._path = [];

    const D = this.rOut * 2;
    this._art = createCanvasTexture(D, D, texScale());
    this._quad = new QuadNode({ texture: this._art.texture });
    this.add(this._quad);
    this.setSize(D, D);

    // sector furniture: registry icons + face labels (widget-owned containment,
 // the Button ruling — the label rides the painted ring by design)
    this._icons = [];
    this._labels = [];
    this._reasonAt = -1; // which sealed sector's reason tooltip is up (-1 none)
    this._buildFurniture(this._ring);

    this.focusable = true;
    this.onActivate = () => this._activate(); // Enter / gamepad-A through the focus fence
    this.on('keydown', (e) => {
      if (this.disabled) return;
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      this._walk(d);
    });
    this.on('pointermove', (e) => {
      if (this.closest((n) => n.disabled === true)) return;
      const i = this._sectorAt(e.x, e.y);
      if (i !== -1 && i !== this.index && !this._ring[i]?.disabled) this._setIndex(i, true);
      // A sealed sector with a `reason` explains itself at the cursor: dead
      // controls must say why. The wheel is ONE raster with no per-wedge node to
      // hang EldTooltip.attach on, so the spec is driven from here — but it still
      // owes the attach contract everything else: the line FOLLOWS the cursor
      // while it is up (it used to freeze where the wedge was entered) and it is
      // taken down when this node dies (see disposeSelf).
      const sealed = i !== -1 && this._ring[i]?.disabled && this._ring[i]?.reason ? i : -1;
      if (sealed !== this._reasonAt) {
        this._reasonAt = sealed;
        if (sealed !== -1) {
          EldTooltip._anchor = this;
          EldTooltip.show({ title: this._ring[sealed].label ?? '', desc: this._ring[sealed].reason }, e.x, e.y);
        } else this._hideReason();
      } else if (sealed !== -1 && EldTooltip._anchor === this) {
        EldTooltip.updatePosition(e.x, e.y); // every other tooltip tracks; so does this
      }
    });
    this.on('pointerleave', () => this._hideReason());
    // the wheel OWNS its ring (review): a right-click on the open annulus
    // is consumed — no native menu over the wheel on contextMenu:true hosts,
    // and the radial chain never walks from the wheel's own surface
    this.on('rightclick', (e) => e.preventDefault());
    this.on('click', (e) => {
      if (this.disabled) { e.stopPropagation(); return; }
      const i = this._sectorAt(e.x, e.y);
      if (i === -1) return;
      if (this._ring[i]?.disabled) return; // a dead sector refuses silently (the MenuList walk rule)
      this._setIndex(i, false);
      this._activate();
    });

    this.visible = false;
    eng.layers.radial.add(this);
    this._paint();
  }

  // THE new hit path: the ring is the hit area. Corners and the center hole fall
  // through to the scene below; the focus fence reuses this same predicate.
  containsPoint(px, py, pad = 0) {
    if (!super.containsPoint(px, py, pad)) return false;
    const ws = this.worldScale;
    const cx = this.worldX + this.rOut * ws;
    const cy = this.worldY + this.rOut * ws;
    const d = Math.hypot(px - cx, py - cy);
    return d >= this.rIn * ws - pad && d <= this.rOut * ws + pad;
  }

  open(x, y, { silent } = {}) {
    if (this.isOpen) return this;
    const eng = widgetsEngine();
    if (!eng) return this;
    this.isOpen = true;
    // NaN or offscreen centers clamp to a reachable spot (the EldContextMenu lesson)
    const cxWant = Number.isFinite(x) ? x : eng.width / 2;
    const cyWant = Number.isFinite(y) ? y : eng.height / 2;
    const cx = Math.min(Math.max(this.rOut, cxWant), Math.max(this.rOut, eng.width - this.rOut));
    const cy = Math.min(Math.max(this.rOut, cyWant), Math.max(this.rOut, eng.height - this.rOut));
    this.setPos(Math.round(cx - this.rOut), Math.round(cy - this.rOut));
    this.visible = true;
    const first = this._ring.findIndex((it) => it && !it.disabled);
    this._setIndex(first, false);
    this._prevFocus = eng.focusedNode;
    this._prevSource = eng.focus.source ?? 'api'; // C1: hand back with the CAPTURED source (menu.js law)
    eng.focus.set(this, 'api');
    // ONE token, level-aware: cancel() invokes the top entry WITHOUT
    // popping it (focus.js), so the child ring ascends and the root ring closes —
    // one press, one surface, and close() keeps its one-token unwind
    this._offEscape = eng.focus.pushEscape(() => {
      if (this._level.length) this._ascend({ voice: 'close' });
      else this.close();
    });
    this._offTab = eng.focus.interceptTab(() => { this.close(); return true; });
    // The liveness token: the bus emit iterates a SNAPSHOT, so when a
    // re-seat (toggle aimed elsewhere) closes-and-reopens DURING the very
    // press that aimed it, the OLD registration — though detached — is still
    // called by that emit and would close the freshly moved wheel. The token
    // lets a stale registration recognize itself and stand down.
    const downTok = {};
    this._downTok = downTok;
    this._offDown = eng.bus.on('pointerdown', (e) => {
      if (this._downTok !== downTok) return;
      if (e.target === this) return;
      if (e.target && this.isAncestorOf(e.target)) return;
      this.close();
    });
    this.setFrameHook((dt) => this._pollStick(dt));
    if (!isReducedMotion()) {
      this.fxScale = 0.88;
      eng.ticker.cancelPropTween(this, 'fxScale');
      eng.ticker.tween(this, { fxScale: 1 }, { dur: 0.12 });
    }
    if (!silent) uisound(this, 'open');
    this.dispatch('open', { x: cx, y: cy }); // the CLAMPED center — where the wheel really stands
    eng.requestRender();
    return this;
  }

  close({ silent } = {}) {
    if (!this.isOpen) return this;
    this.isOpen = false;
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    if (this._offTab) { this._offTab(); this._offTab = null; }
    if (this._offDown) { this._offDown(); this._offDown = null; this._downTok = null; }
    this._hideReason(); // a wheel closed under a sealed wedge leaves no ghost line
    this._resetToRoot(); // a wheel NEVER reopens nested, and closed state always shows root furniture
    this.setFrameHook(null);
    this.visible = false;
    const eng = widgetsEngine();
    if (eng && eng.focusedNode === this) {
      const prev = this._prevFocus;
      // C1: never re-light a holder disabled/disposed while we were open; hand
      // back with the CAPTURED source so a keyboard-driven open keeps its ring
      if (prev && !prev.disposed && !prev.closest((a) => a.disabled === true)) eng.focus.set(prev, this._prevSource ?? 'api');
      else eng.focus.clear();
    }
    this._prevFocus = null;
    this._prevSource = null;
    if (!silent) uisound(this, 'close');
    this.dispatch('close', {});
    eng?.requestRender();
    return this;
  }

  toggle(x, y, opts) {
    if (!this.isOpen) return this.open(x, y, opts);
    // The re-seat law (wheels "stuck at the last place they
 // were"): a toggle AIMED beyond the standing wheel's disc MOVES it there
    // in one gesture — close (which resets to root) then reopen at the new
    // point. A toggle at or inside the disc keeps the click-toggle protocol
    // and closes. Keyboard toggles repeat their fixed coords, so they land
    // inside the disc and keep closing (the social E-wheel contract).
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const ws = this.worldScale || 1;
      const cx = this.worldX + this.rOut * ws;
      const cy = this.worldY + this.rOut * ws;
      if (Math.hypot(x - cx, y - cy) > this.rOut * ws) {
        this.close({ silent: true });
        return this.open(x, y, opts);
      }
    }
    return this.close(opts);
  }

  _sectorAt(px, py) {
    const n = this._ring.length;
    if (!n) return -1;
    const ws = this.worldScale;
    const cx = this.worldX + this.rOut * ws;
    const cy = this.worldY + this.rOut * ws;
    const d = Math.hypot(px - cx, py - cy);
    if (d < this.rIn * ws || d > this.rOut * ws) return -1;
    return this._sectorFromAngle(px - cx, py - cy);
  }

  // 0 at the top, clockwise; sector i is CENTERED on its axis (boundaries halfway)
  _sectorFromAngle(dx, dy) {
    const n = this._ring.length;
    if (!n) return -1;
    const step = 360 / n;
    const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    return Math.floor(((deg + step / 2) % 360) / step);
  }

  _walk(d) {
    const n = this._ring.length;
    if (!n) return;
    let i = this.index < 0 ? (d > 0 ? -1 : 0) : this.index;
    for (let s = 0; s < n; s++) {
      i = ((i + d) % n + n) % n;
      if (!this._ring[i].disabled) { this._setIndex(i, true); return; }
    }
  }

  _pollStick() {
    // The modal law: the radial band paints above 'overlay', so a
    // presenting popup could never rise over an open wheel — the wheel YIELDS
    // instead. Frame hooks run before renumber/render, so no buried frame paints.
    const meng = widgetsEngine();
    if (meng?.modalActive && this.isOpen) { this.close(); return; }
    if (this.closest((n) => n.disabled === true)) return;
    const pads = this._getGamepads() || [];
    let pad = null;
    for (const p of pads) { if (p && p.connected !== false) { pad = p; break; } }
    if (!pad || !pad.axes) return;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (Math.hypot(ax, ay) < 0.5) return; // the GamepadNav dead zone
    const i = this._sectorFromAngle(ax, ay);
    if (i !== -1 && i !== this.index && !this._ring[i]?.disabled) this._setIndex(i, true);
  }

  _setIndex(i, loud) {
    if (i === this.index) return;
    this.index = i;
    this._paint();
    if (loud) uisound(this, 'hover');
    this.dispatch('sectorfocus', { index: i, item: this._ring[i] ?? null });
  }

  // Enable/disable a sector at runtime — sealed wedges can UNLOCK by play.
  // The id form searches the WHOLE tree so a nested leaf can unlock while
  // its ring is hidden — furniture follows on the next descend; the index form
  // stays an index into the CURRENTLY displayed ring. Disabling a parent seals
  // descent into its whole subtree (the ChoiceList disabled-walk law).
  setItemEnabled(idOrIndex, enabled = true) {
    const deepFind = (list) => {
      for (const it of list) {
        if (it && it.id === idOrIndex) return it;
        const hit = it?.children?.length ? deepFind(it.children) : null;
        if (hit) return hit;
      }
      return null;
    };
    const item = typeof idOrIndex === 'number' ? this._ring[idOrIndex] : deepFind(this.items);
    if (!item || item.disabled === !enabled) return this;
    item.disabled = !enabled;
    const i = this._ring.indexOf(item);
    if (i !== -1) { // displayed: recolor live; hidden: the flag renders at the next _rebuild
      this._labels[i]?.setColor(enabled ? COLORS.accent : COLORS.textMuted);
      if (!enabled && this.index === i) this.index = -1;
      this._paint();
    }
    return this;
  }

  // Enter/gamepad-A/click all land here: Back ascends, a parent descends, a
  // LEAF selects — one gesture, one voice (the descend/ascend rings are silent
  // themselves; the activating click already spoke).
  _activate() {
    const item = this._ring[this.index];
    if (!item || item.disabled) return;
    if (item._back) { uisound(this, 'click'); this._ascend({ voice: null }); return; }
    if (item.children && item.children.length) { uisound(this, 'click'); this._descend(item); return; }
    this._select();
  }

  _descend(item) {
    this._level.push({ ring: this._ring, index: this.index });
    this._path.push(item.id ?? this.index);
    // a FRESH array: consumer item arrays are never mutated; Back sits LAST so
    // it lands adjacent-counterclockwise of 12 o'clock, out of the prime arc
    this._rebuild([...item.children, { id: '__back', label: str('radialBack'), _back: true }]);
    this.dispatch('descend', { id: item.id ?? null, item, path: [...this._path] });
    this._swapPop();
  }

  _ascend({ voice = 'close' } = {}) {
    const frame = this._level.pop();
    if (!frame) return;
    this._path.pop();
    this._rebuild(frame.ring, frame.index); // the parent sector you came through re-lights
    this.dispatch('ascend', { path: [...this._path], depth: this._level.length });
    if (voice) uisound(this, voice);
    this._swapPop();
  }

  // close()'s funnel: a wheel never reopens nested, and CLOSED state always
  // shows root furniture (drives and suites inspect the wheel while closed).
  _resetToRoot() {
    if (!this._level.length) return;
    this._level.length = 0;
    this._path.length = 0;
    this._rebuild(this.items);
  }

  // The dispatcher's seam: swap the ROOT array wholesale. Consumer wheels
  // keep `items` forever (identity law); only the engine-owned shared
  // fallback wheel re-arms per right-click target through this.
  _setRoot(items) {
    this.items = items ?? [];
    this._level.length = 0;
    this._path.length = 0;
    this._rebuild(this.items);
    return this;
  }

  _swapPop() { // the ring-swap micro-pop (reducedMotion: instant, like every preset)
    const eng = widgetsEngine();
    if (!eng || isReducedMotion()) return;
    this.fxScale = 0.94;
    eng.ticker.cancelPropTween(this, 'fxScale');
    eng.ticker.tween(this, { fxScale: 1 }, { dur: 0.1 });
  }

  _select() {
    const item = this._ring[this.index];
    if (!item || item.disabled) return;
    uisound(this, 'click');
    const payload = { index: this.index, id: item.id ?? null, item, path: [...this._path, item.id ?? null] };
    this.dispatch('select', payload);
    // per-leaf onSelect (the EldContextMenu per-entry onClick precedent):
    // provider items carry their verbs without any page-level select router
    if (item.onSelect) {
      try { item.onSelect(payload); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); }
    }
    if (this.onSelect) {
      try { this.onSelect(this.index, item); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); }
    }
    this.close({ silent: true }); // the pick voice already spoke
  }

  // how deep the wheel stands: 0 = the root ring, 1 = inside one submenu, …
  get depth() { return this._level.length; }

  // The dynamic ground form: a page registers a FUNCTION deciding
  // per-gesture — the strategy-hud partition law (mustered → null keeps the
  // gesture silent) — or clears with null. The instance form is { ground: true }.
  static setGround(menuOrFn) {
    requireEngine().radialGround = menuOrFn ?? null;
    return RadialMenu;
  }

  // ONE furniture path for construction and every ring swap: the ctor
  // and _rebuild both land here, so a child ring is built by exactly the code
  // that built the root — icons resolve, labels color, placement runs.
  _buildFurniture(items) {
    const eng = requireEngine();
    const iconTex = (id) => {
      const t = eng.textures;
      return t.has?.(`icon.${id}`) ? t.get(`icon.${id}`) : t.get(id);
    };
    items.forEach((item) => {
      let iq = null;
      if (item.icon) {
        iq = new QuadNode({ texture: iconTex(item.icon) });
        iq.setSize(30, 30);
        iq.auditAllow('containment');
        this.add(iq);
      }
      this._icons.push(iq);
      const lb = new TextNode(item.label ?? '', {
        font: FONTS.header, size: 11, smallCaps: true, letterSpacing: 1,
        color: item.disabled ? COLORS.textMuted : COLORS.accent, shadow: SHADOW,
        align: 'center', maxWidth: 84, ellipsis: true,
      });
      lb.auditAllow('containment', 'overlap');
      this._labels.push(lb);
      this.add(lb);
    });
    this._placeFurniture();
  }

  // The nesting seam: swap the DISPLAYED ring in place — same canvas, same
  // radii, same annulus hit law; only items and furniture change.
  _rebuild(ringItems, seatIndex) {
    this._hideReason(); // a swap under a sealed wedge leaves no ghost line
    for (const iq of this._icons) iq?.dispose();
    for (const lb of this._labels) lb.dispose();
    this._icons = [];
    this._labels = [];
    this._ring = ringItems;
    this._buildFurniture(ringItems);
    this.index = -1;
    const seat = Number.isInteger(seatIndex) && !ringItems[seatIndex]?.disabled
      ? seatIndex
      : ringItems.findIndex((it) => it && !it.disabled);
    this._setIndex(seat, false);
    this._paint();
  }

  _placeFurniture() {
    const n = this._ring.length;
    const rMid = (this.rIn + this.rOut) / 2;
    for (let i = 0; i < n; i++) {
      const a = (-90 + i * (360 / n)) * Math.PI / 180;
      const cx = this.rOut + Math.cos(a) * rMid;
      const cy = this.rOut + Math.sin(a) * rMid;
      const iq = this._icons[i];
      const lb = this._labels[i];
      if (iq) {
        iq.setPos(Math.round(cx - 15), Math.round(cy - 15 - (lb.h ? 7 : 0)));
        lb.setPos(Math.round(cx - lb.w / 2), Math.round(cy + 4));
      } else {
        lb.setPos(Math.round(cx - lb.w / 2), Math.round(cy - lb.h / 2));
      }
    }
  }

  _paint() {
    const { ctx } = this._art;
    const D = this.rOut * 2;
    const c = this.rOut;
    const n = this._ring.length;
    ctx.clearRect(0, 0, D, D);
    // the ring plate
    ctx.fillStyle = COLORS.voidBlack;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.arc(c, c, this.rOut - 1, 0, Math.PI * 2);
    ctx.arc(c, c, this.rIn + 1, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.globalAlpha = 1;
    // the selected wedge glows
    if (this.index >= 0 && n) {
      const step = (Math.PI * 2) / n;
      const a0 = -Math.PI / 2 + this.index * step - step / 2;
      ctx.fillStyle = COLORS.accent;
      ctx.globalAlpha = this._ring[this.index]?.disabled ? 0.05 : 0.16;
      ctx.beginPath();
      ctx.arc(c, c, this.rOut - 2, a0, a0 + step);
      ctx.arc(c, c, this.rIn + 2, a0 + step, a0, true);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // sector separators
    if (n > 1) {
      ctx.strokeStyle = COLORS.accent;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      const step = (Math.PI * 2) / n;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * step - step / 2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * (this.rIn + 2), c + Math.sin(a) * (this.rIn + 2));
        ctx.lineTo(c + Math.cos(a) * (this.rOut - 2), c + Math.sin(a) * (this.rOut - 2));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // rims + deterministic rune ticks (the summoning circle)
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(c, c, this.rOut - 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(c, c, this.rIn + 1.5, 0, Math.PI * 2); ctx.stroke();
    // Rim ticks, EVENLY SPACED and aligned to the sectors.
    //
    // This used to be 36 ticks at random angles, random lengths AND random radii. It was
    // seeded, so it was at least the same mess every boot, but a scatter of strokes is
    // not ornament - it is noise, and it read (accurately) as programmer art. A radial
    // menu is a DIAL: the ring's marks should agree with the thing they surround, so a
    // long tick now falls on every sector boundary, exactly where the separators are,
    // with short ticks subdividing between them.
    const sectors = Math.max(1, n);
    const per = 6;                                   // subdivisions per sector
    const ticks = sectors * per;
    const boundary = -Math.PI / 2 - Math.PI / sectors; // where separator 0 sits
    const r0 = this.rOut - 4;
    for (let i = 0; i < ticks; i++) {
      const a = boundary + (i / ticks) * Math.PI * 2;
      const major = n > 1 && i % per === 0;
      const len = major ? 7 : 3.5;
      ctx.globalAlpha = major ? 0.6 : 0.28;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * (r0 - len), c + Math.sin(a) * (r0 - len));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // the nesting affordances, own-raster like everything here: a parent
    // sector wears an outward chevron at the rim ("more beyond"), the Back
    // sector an inward double-chevron near the hole ("home lies inward") — the
    // marks agree with the dial they sit on, rotated to each sector's own axis
    if (n) {
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      const chev = (angle, r, size, inward, alpha) => {
        const ax = c + Math.cos(angle) * r;
        const ay = c + Math.sin(angle) * r;
        const dir = inward ? -1 : 1;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(ax - Math.cos(angle + 0.5) * size * dir, ay - Math.sin(angle + 0.5) * size * dir);
        ctx.lineTo(ax, ay);
        ctx.lineTo(ax - Math.cos(angle - 0.5) * size * dir, ay - Math.sin(angle - 0.5) * size * dir);
        ctx.stroke();
      };
      this._ring.forEach((item, i) => {
        const a = (-90 + i * (360 / n)) * Math.PI / 180;
        if (item.children && item.children.length) chev(a, this.rOut - 11, 4.5, false, 0.6);
        else if (item._back) { chev(a, this.rIn + 14, 5, true, 0.8); chev(a, this.rIn + 20, 5, true, 0.5); }
      });
      ctx.globalAlpha = 1;
    }
    // dim dead sectors' furniture through the same channel every widget uses
    this._ring.forEach((item, i) => {
      const dim = item.disabled ? METRICS.disabledDim : 1;
      if (this._icons[i]) this._icons[i].fxOpacity = dim;
      this._labels[i].fxOpacity = dim;
    });
    this._art.texture.needsUpdate = true;
    (this.engine ?? null)?.requestRender();
  }

  onLayout() {
    this._quad.setRect(0, 0, this.w, this.h); // the raster quad fills the wheel (ArcGauge pattern)
  }

  // The reason line is ours while `_reasonAt` names a sector: take it down on
  // leave, on close, and on dispose. EldTooltip.attach does this for a normal
  // node via its own dispose hook; a hand-driven tooltip must do it by hand, or
  // a wheel disposed with a sealed wedge under the cursor leaves a ghost line.
  _hideReason() {
    if (this._reasonAt !== -1 && EldTooltip._anchor === this) EldTooltip.hideNow();
    this._reasonAt = -1;
  }

  disposeSelf() {
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    if (this._offTab) { this._offTab(); this._offTab = null; }
    if (this._offDown) { this._offDown(); this._offDown = null; this._downTok = null; }
    const geng = widgetsEngine();
    if (geng && this._isGround && geng.radialGround === this) geng.radialGround = null;
    if (geng && geng.radialShared === this) geng.radialShared = null;
    this._hideReason();
    this.setFrameHook(null);
    this._art.texture.dispose();
  }

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

// ---------------- the radial chain dispatcher ----------------
// input.js completes an UNCONSUMED right-click and asks engine.radialFallback
// (installed here at boot — input.js stays widget-free). The walk from the hit:
// the nearest ancestor carrying `radialItems` wins — an ARRAY opens the
// engine-owned shared wheel with those items, a FUNCTION is asked
// ({target, x, y, native}), null/[] declines onward, `false` SEALS the chain
// (the scrim rule); no provider → the registered ground wheel
// (engine.radialGround: a wheel, or a per-gesture function). Returns true iff
// a wheel opened — the caller then arms the same one-shot native-menu
// suppression a preventDefault would. All state is engine-scoped: destroy()
// takes the dispatcher, the shared wheel, and the registration with it.
export function initRadialFallback(engine) {
  engine.radialGround = null;
  engine.radialShared = null; // lazy: the one engine-owned wheel provider items ride
  engine.radialFallback = (from, x, y, native) => {
    // A target disposed by its OWN rightclick handler has been ANSWERED (// review): its parent chain is already severed, so walking the corpse would
    // skip every live provider and raise a ground ghost over a dead object.
    if (!from || from.disposed) return false;
    const e = { target: from, x, y, native };
    for (let n = from; n; n = n.parent) {
      if (n.radialItems === undefined) continue;
      let items = n.radialItems;
      if (typeof items === 'function') {
        try { items = items(e); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); items = null; }
      }
      if (items === false) return false; // sealed: the chain stops at the dark
      if (Array.isArray(items) && items.length) {
        if (!engine.radialShared || engine.radialShared.disposed) engine.radialShared = new RadialMenu({ items: [] });
        // a re-armed wheel RE-SEATS (review): the direct API path has no
        // closing pointerdown before it, and open() early-returns while open —
        // without this close the wheel stayed stranded at its old center
        if (engine.radialShared.isOpen) engine.radialShared.close({ silent: true });
        engine.radialShared._setRoot(items);
        engine.radialShared.open(x, y);
        return true;
      }
      // null / undefined / [] → decline, keep walking up
    }
    let g = engine.radialGround;
    if (typeof g === 'function') {
      try { g = g(e); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); g = null; }
    }
    if (g && !g.disposed) {
      if (typeof g.open !== 'function') { // a registration that is not a wheel
        console.warn('LovecraftUI: the registered radial ground is not a wheel — ignored.');
        return false;
      }
      if (g.isOpen) g.close({ silent: true }); // the API path re-seats (see above)
      g.open(x, y);
      return true;
    }
    return false;
  };
}

// ---------------- BossBar ----------------
// A name plate over SegmentedBar phases with an enrage BigTimer slot. Phases are the
// boss's health story: `setPhase(p)` fills p segments (loud commits `change
// {value, action:'phase'}`); `enrage(seconds)` raises the timer and its timeout
// re-dispatches as `enrage`. Damage-flash fell per the cut line.

export class BossBar extends UINode {
  // opts: { name = '', phases = 3, width = 360, onChange }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const ph = Number(opts.phases);
    this.phases = Number.isFinite(ph) ? Math.max(1, Math.round(ph)) : 3;
    const w = Number.isFinite(opts.width) ? Math.max(180, opts.width) : 360;
    this.phase = this.phases;
    this.onChange = opts.onChange ?? null;
    this.nameText = new TextNode(opts.name ?? '', {
      font: FONTS.header, size: 16, smallCaps: true, letterSpacing: 3,
      color: COLORS.accent, shadow: SHADOW, maxWidth: w - 74, ellipsis: true,
    });
    this.bar = new SegmentedBar({ segments: this.phases, value: this.phases, width: w, height: 14 });
    this.timer = new BigTimer({ seconds: 60, size: 22, running: false });
    this.timer.visible = false;
    this.timer.on('timeout', () => this.dispatch('enrage', {}));
    this.add(this.nameText, this.bar, this.timer);
    this.setSize(w, 24 + this.bar.h + 6);
  }

  onLayout() {
    this.nameText.setPos(0, 0);
    this.timer.setPos(this.w - this.timer.w, -4);
    this.bar.setPos(0, 24);
  }

  setPhase(p, { silent } = {}) {
    const v = Number.isFinite(p) ? Math.min(this.phases, Math.max(0, Math.round(p))) : this.phase;
    if (v === this.phase) return this;
    this.phase = v;
    this.bar.setValue(v, { silent: true });
    commitChange(this, 'change', { value: v, action: 'phase' }, silent, this.onChange);
    return this;
  }

  // Arms the enrage clock; at zero the BigTimer's timeout re-dispatches as `enrage`.
  enrage(seconds) {
    const s = Number.isFinite(seconds) ? Math.max(0.05, seconds) : 60;
    this.timer.setValue(s);
    this.timer.visible = true;
    this.timer.start();
    this.invalidateLayout();
    return this;
  }

  clearEnrage() {
    this.timer.stop();
    this.timer.visible = false;
    return this;
  }
}

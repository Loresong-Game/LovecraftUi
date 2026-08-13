// The Speaking Stones: the MUD/text-game kit — a body-condition figure and typed
// worn-equipment zones. The text half of the kit ({link}/{hl} markup runs, the pinned
// scrollback) lives in the core (text.js, components.js) — this file is the furniture.
//
// BodyDoll: a thirteen-part humanoid condition figure. Parts are focusable child
// regions (the NodeGraph plate pattern) over per-part REGISTRY textures — never one
// shared raster: a missing limb must truly vanish, and damage tint must follow the
// limb's shape (material.color multiplies the light-painted plates). All state is
// data-driven — {damage 0..3, bleed, missing, scars 0..3} per part; the game owns the
// model, the doll AFFORDS (partclick) and narrates (partchange).
//
// EquipmentRack: labeled zone collections over REAL ItemGrids (the ProcessPanel
// composition), so the whole drag protocol — stacks, splits, tooltips, locks,
// durability — interops with zero new drag code. Zone typing rides the grid-level
// `accepts` predicate (the ItemGrid extension); refusals stay polite and mutate
// nothing. Sides on the doll are the CHARACTER's own: l-* renders on the viewer's
// right, the mirror convention every paper doll uses.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { widgetsEngine, requireEngine, commitChange, setNodeDisabled, uisound, EldTooltip } from './widgets.js';
import { isReducedMotion } from '../animate.js';
import { ItemGrid } from './itemgrid.js';
import { str } from '../strings.js';
import { clamp } from '../layout.js';

const tex = (name) => requireEngine().textures.get(name);      // friendly pre-init throw
const frame = (name) => requireEngine().textures.frame(name);
const SHADOW = METRICS.textShadow; // X02: the shared token (was a per-file literal)

const _warned = new Set(); // one warning per offending id, not one per frame
function warnOnce(key, message) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(message);
}

// B8: diagnostics re-surface per boot (warn parity)
export function resetStonesWarnings() { _warned.clear(); }

// ---------------- BodyDoll ----------------

// The thirteen-part humanoid. Regions are FRACTIONS of the figure box (150×280 at the
// default width), hand-authored to abut; every region holds the STYLE §7 24px floor at
// the default size (the selftest walks all thirteen). `back` reads as the shoulder
// yoke on the front-facing figure.
const FIGURE_W = 150, FIGURE_H = 330; // 100:220 — THE figure ratio (art-icons.js FIG_W/FIG_H x 1.5); change only with FIG_BANDS
const DEFAULT_PARTS = [
  { id: 'head',    key: 'dollHead',  tex: 'doll.part.head',  hov: 'doll.hover.head',  r: { x: 0.3620, y: 0.0000, w: 0.2760, h: 0.1364 } },
  { id: 'neck',    key: 'dollNeck',  tex: 'doll.part.neck',  hov: 'doll.hover.neck',  lap: true, r: { x: 0.3770, y: 0.1136, w: 0.2460, h: 0.0864 } },
  { id: 'back',    key: 'dollBack',  tex: 'doll.part.back',  hov: 'doll.hover.back',  r: { x: 0.2650, y: 0.1591, w: 0.4700, h: 0.0909 } },
  { id: 'chest',   key: 'dollChest', tex: 'doll.part.chest', hov: 'doll.hover.chest', lap: true, r: { x: 0.2980, y: 0.2318, w: 0.4040, h: 0.1682 } },
  { id: 'abdomen', key: 'dollGut',   tex: 'doll.part.gut',   hov: 'doll.hover.gut',   r: { x: 0.3160, y: 0.3864, w: 0.3680, h: 0.1682 } },
  { id: 'l-arm',   key: 'dollArmL',  tex: 'doll.part.arml',  hov: 'doll.hover.arml',  lap: true, r: { x: 0.6250, y: 0.1864, w: 0.1650, h: 0.3818 } },
  { id: 'r-arm',   key: 'dollArmR',  tex: 'doll.part.armr',  hov: 'doll.hover.armr',  lap: true, r: { x: 0.2100, y: 0.1864, w: 0.1650, h: 0.3818 } },
  { id: 'l-hand',  key: 'dollHandL', tex: 'doll.part.handl', hov: 'doll.hover.handl', r: { x: 0.6400, y: 0.5545, w: 0.1620, h: 0.1455 } },
  { id: 'r-hand',  key: 'dollHandR', tex: 'doll.part.handr', hov: 'doll.hover.handr', r: { x: 0.1980, y: 0.5545, w: 0.1620, h: 0.1455 } },
  { id: 'l-leg',   key: 'dollLegL',  tex: 'doll.part.legl',  hov: 'doll.hover.legl',  lap: true, r: { x: 0.5120, y: 0.5182, w: 0.1720, h: 0.3636 } },
  { id: 'r-leg',   key: 'dollLegR',  tex: 'doll.part.legr',  hov: 'doll.hover.legr',  lap: true, r: { x: 0.3160, y: 0.5182, w: 0.1720, h: 0.3636 } },
  { id: 'l-foot',  key: 'dollFootL', tex: 'doll.part.footl', hov: 'doll.hover.footl', r: { x: 0.5010, y: 0.8636, w: 0.1840, h: 0.1045 } },
  { id: 'r-foot',  key: 'dollFootR', tex: 'doll.part.footr', hov: 'doll.hover.footr', r: { x: 0.3150, y: 0.8636, w: 0.1840, h: 0.1045 } },
];

// Static severity tiers (STYLE §9 — never a pulse): the durability idiom, one rung
// longer. rank 0 reads carved stone; 1 bruised gold; 2 the palette's one orange; 3 blood.
const DAMAGE_TINTS = [COLORS.stoneHi, COLORS.quest, COLORS.rarityLegendary, COLORS.negative];
const MAX_SCARS = 3;
const DOLL_PAD = 10;
const MIN_DOLL_W = FIGURE_W + DOLL_PAD * 2; // the width that proves the 24px part floor

class BodyPartNode extends UINode {
  constructor(doll, part, active) {
    super({ interactive: active });
    this.focusable = active;
    this.doll = doll;
    this.part = part;
    // The anatomical plates INTERLOCK: a band box pads past its art
    // for the seam stroke and the 24px hit floor, so six boxes overlap their
    // neighbors by design. The six `lap` parts cover every overlapping pair
    // (each declaration provably suppresses at least one — the vertex cover of
    // the pair graph); the ALLOW raise is recorded on mud-hud's manifest row.
    if (part.lap) this.auditAllow('overlap');
    this.quad = new QuadNode({ texture: tex(part.tex) });
    this.add(this.quad);
    this.scarMarks = [];
    for (let i = 0; i < MAX_SCARS; i++) {
      const m = new QuadNode({ texture: tex('mark.scar') });
      m.visible = false;
      this.scarMarks.push(m);
      this.add(m);
    }
    this.bleedMark = new QuadNode({ texture: tex('mark.bleed') });
    this.bleedMark.visible = false;
    this.add(this.bleedMark);
    // the wound flash is the SILHOUETTE flashing red, not the box: the
    // part's own raster tinted arterial, riding the same fxOpacity fade
    this.flashWash = new QuadNode({ texture: tex(part.tex), color: COLORS.healthTop });
    this.flashWash.visible = false;
    this.add(this.flashWash);
    // the hover is a BORDER around the part's graphic (the request, verbatim):
    // the baked accent outline traced along the same band path. The property
    // name and its .visible flip are the pinned channel — both kept.
    this.hoverWash = new QuadNode({ texture: tex(part.hov) });
    this.hoverWash.visible = false;
    this.add(this.hoverWash);
    if (!active) return; // inactive parts draw the silhouette but stay inert + untipped

    EldTooltip.attach(this, () => this.doll._tooltipSpec(this.part.id));

    // hover is silent by design — thirteen dense regions would spam the hover voice
    // (the Minimap-marker precedent)
    this.on('pointerenter', () => {
      // the input layer delivers hover into disabled subtrees (the tooltip rule) —
      // the wash channel seals itself, closest(disabled) first, like every such channel
      if (this.closest((n) => n.disabled === true)) return;
      this.hoverWash.visible = true;
    });
    this.on('pointerleave', () => { this.hoverWash.visible = false; this._releaseFx(); });
    this.on('pointerdown', (e) => {
      if (this.doll.disabled) { e.stopPropagation(); return; }
      const g = widgetsEngine();
      if (g) { if (isReducedMotion()) { g.ticker.cancelPropTween(this, 'fxScale'); this.fxScale = 0.95; } else g.ticker.tween(this, { fxScale: 0.95 }, { dur: 0.1 }); }
    });
    this.on('pointerup', () => this._releaseFx());
    const fire = () => {
      if (this.doll.disabled) return;
      const state = this.doll.getPart(this.part.id);
      const evt = this.doll.dispatch('partclick', { part: this.part.id, ...state });
      this.doll.onPartClick?.(evt);
    };
    this.on('click', (e) => { if (this.doll.disabled) { e.stopPropagation(); return; } fire(); });
    this.onActivate = fire; // Enter/gamepad-A from focus takes the same path as a click
  }

  _releaseFx() {
    if (this.fxScale === 1) return;
    const g = widgetsEngine();
    if (g) { if (isReducedMotion()) { g.ticker.cancelPropTween(this, 'fxScale'); this.fxScale = 1; } else g.ticker.tween(this, { fxScale: 1 }, { dur: 0.1 }); }
  }

  onLayout() {
    this.quad.setRect(0, 0, this.w, this.h);
    this.hoverWash.setRect(0, 0, this.w, this.h);
    this.flashWash.setRect(0, 0, this.w, this.h);
    // scars row-fit the part (small parts take small stitches; never overflow)
    const s = Math.max(6, Math.min(12, Math.floor((this.w - 6) / MAX_SCARS) - 1));
    for (let i = 0; i < this.scarMarks.length; i++) {
      this.scarMarks[i].setRect(3 + i * (s + 1), 3, s, s);
    }
    this.bleedMark.setRect(
      Math.round(this.w - 16 - METRICS.badgeInset / 2),
      Math.round(this.h - 16 - METRICS.badgeInset / 2), 16, 16);
  }
}

export class BodyDoll extends UINode {
  // opts: { parts: string[] (subset of the thirteen ids; unknown ids warn once and
  //         skip — non-listed parts still DRAW so the figure stays whole, but are
  //         inert and stateless), labels: {id: text} tooltip-title overrides
  //         (consumer data, rendered verbatim), state: {id: patch} applied silent,
  //         width (>= 170; height derives from the figure's aspect),
  //         onPartChange(v, e), onPartClick(e), disabled }
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    this.onPartChange = opts.onPartChange ?? null;
    this.onPartClick = opts.onPartClick ?? null;
    this._labels = opts.labels ?? null;
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.add(this.bg);

    const known = new Set(DEFAULT_PARTS.map((p) => p.id));
    const wanted = opts.parts ?? DEFAULT_PARTS.map((p) => p.id);
    const active = new Set();
    for (const id of wanted) {
      if (!known.has(id)) { warnOnce(`doll:${id}`, `LovecraftUI BodyDoll: unknown part "${id}" (skipped)`); continue; }
      active.add(id);
    }
    this.parts = Object.freeze(DEFAULT_PARTS.filter((p) => active.has(p.id)).map((p) => p.id));
    this._states = new Map();
    this._nodes = new Map();
    for (const part of DEFAULT_PARTS) {
      const isActive = active.has(part.id);
      const node = new BodyPartNode(this, part, isActive);
      this._nodes.set(part.id, node);
      this.add(node);
      if (isActive) this._states.set(part.id, { damage: 0, bleed: false, missing: false, scars: 0 });
      this._refreshPart(part.id);
    }

    // B5 finite-first: Math.max(MIN, NaN) is NaN, so a non-numeric width used to
    // launder straight into the figure geometry. `??` only catches null/undefined.
    const wOpt = Number(opts.width);
    const width = Number.isFinite(wOpt) ? Math.max(MIN_DOLL_W, Math.round(wOpt)) : MIN_DOLL_W;
    this._figW = width - DOLL_PAD * 2;
    this._figH = Math.round(this._figW * (FIGURE_H / FIGURE_W));
    this.setSize(width, this._figH + DOLL_PAD * 2);

    if (opts.state) this.setParts(opts.state);
    if (opts.disabled) this.setDisabled(true);
  }

  // Merge-patch one part: {damage, bleed, missing, scars} in any subset. Ranks clamp
  // to 0..3 and floor; NON-FINITE rank values are ignored (the field keeps its value —
  // finite-first); flags coerce. A no-op patch emits nothing; programmatic patches are
  // silent by default ({silent: false} runs the gesture commit path).
  setPart(id, patch, { silent = true } = {}) {
    const cur = this._states.get(id);
    if (!cur) {
      warnOnce(`doll:set:${id}`, `LovecraftUI BodyDoll: unknown or inactive part "${id}" (setPart ignored)`);
      return this;
    }
    const next = { ...cur };
    if (patch && Number.isFinite(patch.damage)) next.damage = clamp(Math.floor(patch.damage), 0, 3);
    if (patch && Number.isFinite(patch.scars)) next.scars = clamp(Math.floor(patch.scars), 0, MAX_SCARS);
    if (patch && 'bleed' in patch) next.bleed = !!patch.bleed;
    if (patch && 'missing' in patch) next.missing = !!patch.missing;
    if (next.damage === cur.damage && next.bleed === cur.bleed &&
        next.missing === cur.missing && next.scars === cur.scars) return this;
    // finite, event-driven juice only (STYLE §9): a fresh wound flashes once
    const flash = (next.bleed && !cur.bleed) || next.damage > cur.damage;
    this._states.set(id, next);
    this._refreshPart(id);
    if (flash) this._flashPart(id);
    commitChange(this, 'partchange', { part: id, ...next }, silent,
      this.onPartChange ? (_v, e) => this.onPartChange(e, e) : null);
    return this;
  }

  setParts(map, opts) {
    for (const [id, patch] of Object.entries(map ?? {})) this.setPart(id, patch, opts);
    return this;
  }

  getPart(id) {
    const st = this._states.get(id);
    return st ? { ...st } : null; // a fresh copy, never the live record
  }

  getParts() {
    const out = {};
    for (const [id, st] of this._states) out[id] = { ...st };
    return out;
  }

  // ONE method computes a part's visual state; nothing else touches the plates.
  _refreshPart(id) {
    const node = this._nodes.get(id);
    if (!node) return;
    const st = this._states.get(id);
    if (!st) { // inactive: the silhouette plate, carved and quiet
      node.quad.setColor(DAMAGE_TINTS[0]);
      node.quad.setBaseOpacity(0.9);
      return;
    }
    if (st.missing) {
      // ghost limb: the region stays alive (a bleeding stump is a real state, and
      // games inspect what is gone), the flesh does not
      node.quad.setColor(COLORS.voidBlack);
      node.quad.setBaseOpacity(0.45);
    } else {
      node.quad.setColor(DAMAGE_TINTS[st.damage]);
      node.quad.setBaseOpacity(0.95);
    }
    for (let i = 0; i < node.scarMarks.length; i++) {
      node.scarMarks[i].visible = !st.missing && i < st.scars;
    }
    node.bleedMark.visible = st.bleed;
    this.engine?.requestRender();
  }

  _flashPart(id) {
    const node = this._nodes.get(id);
    const eng = widgetsEngine();
    if (!node || !eng) return;
    const wash = node.flashWash;
    wash.visible = true;
    wash.fxOpacity = 0.55;
    eng.ticker.tween(wash, { fxOpacity: 0 }, { dur: 0.3, onDone: () => { wash.visible = false; } });
  }

  _tooltipSpec(id) {
    const part = DEFAULT_PARTS.find((p) => p.id === id);
    const st = this._states.get(id);
    const title = this._labels?.[id] ?? str(part.key);
    if (!st) return { title };
    const lines = [];
    if (st.missing) lines.push({ text: str('dollMissing'), color: COLORS.textDisabled });
    else if (st.damage > 0) lines.push({ text: str('dollDamage' + st.damage), color: DAMAGE_TINTS[st.damage] });
    if (st.bleed) lines.push({ text: str('dollBleeding'), color: COLORS.healthTop });
    if (st.scars > 0) lines.push({ text: str('dollScar' + st.scars), color: COLORS.textFaint });
    if (!lines.length) lines.push({ text: str('dollHealthy'), color: COLORS.textMuted });
    return {
      title,
      titleColor: st.missing ? COLORS.textDisabled : DAMAGE_TINTS[st.damage],
      lines,
    };
  }

  setDisabled(v) {
    setNodeDisabled(this, v);
    // a cursor parked on a part gets no leave when the seal lands — douse lit washes
    if (v) for (const node of this._nodes.values()) node.hoverWash.visible = false;
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    const fx = Math.round((this.w - this._figW) / 2);
    const fy = DOLL_PAD;
    for (const part of DEFAULT_PARTS) {
      const node = this._nodes.get(part.id);
      node.setRect(
        fx + Math.round(part.r.x * this._figW),
        fy + Math.round(part.r.y * this._figH),
        Math.round(part.r.w * this._figW),
        Math.round(part.r.h * this._figH));
    }
  }
}

// ---------------- EquipmentRack ----------------

export class EquipmentRack extends UINode {
  // opts: { zones: [{ id, label, slots = 1, cols, accepts, items }], gap = 10,
  //         locked = false, onEquipChange(v, e) }
  // Zones are CONSTRUCTOR-FIXED (the NodeGraph data rule) so the rack sizes itself
  // once. `label` is consumer data rendered verbatim (fallback: the id); `accepts`
  // rides the zone's ItemGrid (the typing predicate); `items` seed silent as
  // [{index?, id, count?, durability?}]. Zone grids are REAL ItemGrids — getZone(id)
  // hands back the whole grid surface, and every drag behavior interops free.
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    this.onEquipChange = opts.onEquipChange ?? null;
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.add(this.bg);
    this._gap = opts.gap ?? 10;
    this.locked = false;
    this.zones = [];
    for (const spec of opts.zones ?? []) {
      const sOpt = Number(spec.slots); // B5 finite-first (see the doll width above)
      const slots = Number.isFinite(sOpt) ? Math.max(1, Math.floor(sOpt)) : 1;
      let cols = slots;
      if (spec.cols != null) {
        if (slots % spec.cols === 0) cols = spec.cols;
        else console.warn(`LovecraftUI EquipmentRack: zone "${spec.id}" slots (${slots}) not divisible by cols (${spec.cols}) — falling back to a single row`);
      }
      const grid = new ItemGrid({ cols, rows: slots / cols, accepts: spec.accepts, spacing: 4 });
      const labelNode = new TextNode(String(spec.label ?? spec.id), {
        font: FONTS.header, size: 10, smallCaps: true, letterSpacing: 1,
        color: COLORS.textMuted, shadow: SHADOW, // the translucent panel rides arbitrary ground; textFaint died at 4.14:1 when the rack grew onto a lighter resident
      });
      // re-dispatch with ZONE CONTEXT: bubbled itemchange slot ids are grid-local
      // ('item:0' exists in every zone), so the zone id + numeric index are new
      // information — the raw itemchange/transfer still bubble untouched beneath.
      grid.on('itemchange', (e) => {
        const detail = {
          zone: spec.id, index: Number(String(e.slot).slice(5)),
          item: e.item, count: e.count, action: e.action,
        };
        commitChange(this, 'equipchange', detail, false,
          this.onEquipChange ? (_v, e2) => this.onEquipChange(e2, e2) : null);
      });
      this.zones.push({ id: spec.id, label: String(spec.label ?? spec.id), grid, labelNode });
      this.add(labelNode, grid);
      if (Array.isArray(spec.items)) {
        spec.items.forEach((it, i) => grid.setItem(it.index ?? i, it.id, it.count ?? 1, { durability: it.durability }));
      }
    }
    if (opts.locked) this.setLocked(true);

    // sized ONCE — zones never mutate (the constructor-fixed rule above)
    let w = 0, y = 12;
    for (const z of this.zones) {
      w = Math.max(w, z.grid.w);
      y += 15 + z.grid.h + this._gap;
    }
    this.setSize(w + 24, Math.max(40, y - this._gap + 12));
  }

  getZone(id) { return this.zones.find((z) => z.id === id)?.grid ?? null; }

  // Passthroughs (the ChatBox re-exposure principle). setItem stays GAME-AUTHORITATIVE:
  // like the grid's own, it bypasses the zone's accepts predicate by design.
  setItem(zoneId, index, itemId, count, opts) { this.getZone(zoneId)?.setItem(index, itemId, count, opts); return this; }
  getItem(zoneId, index) { return this.getZone(zoneId)?.getItem(index) ?? null; }
  clearSlot(zoneId, index, opts) { this.getZone(zoneId)?.clearSlot(index, opts); return this; }

  // Arms shift-click quick-UNEQUIP toward the bag on every zone. Dragging remains the
  // way INTO zones (a grid's linkTransfer names one destination).
  linkTransfer(bag) {
    for (const z of this.zones) z.grid.linkTransfer(bag);
    return this;
  }

  // The strip: sweeps every zone into the bag; returns total stacks moved (each zone
  // keeps the partial-sweep semantics — refused or roomless stacks stay worn). ONE
  // gesture, one voice: the zone sweeps run quiet and the rack voices the whole strip —
  // one 'swap' if anything moved, one 'error' if anything stayed worn (an empty rack
  // over a locked bag ends silent: the gesture was vacuous).
  transferAll(bag) {
    let moved = 0;
    for (const z of this.zones) moved += z.grid.transferAll(bag, { quiet: true });
    const stuck = this.zones.some((z) => z.grid.slots.some((s) => s.icon));
    if (moved) uisound(this, 'swap', { transferAll: true });
    if (stuck) uisound(this, 'error', { transferAll: true });
    return moved;
  }

  setLocked(v) {
    this.locked = !!v;
    for (const z of this.zones) z.grid.setLocked(this.locked);
    return this;
  }

  setZoneLocked(zoneId, v) {
    const grid = this.getZone(zoneId);
    if (!grid) return false;
    grid.setLocked(!!v);
    return true;
  }

  setDisabled(v) {
    setNodeDisabled(this, v);
    // a cursor parked on a slot gets no leave when the seal lands — douse lit overlays
    // (the BodyDoll.setDisabled precedent)
    if (v) for (const z of this.zones) for (const s of z.grid.slots) s.hoverOverlay.visible = false;
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    let y = 12;
    for (const z of this.zones) {
      z.labelNode.setPos(14, y);
      y += 15;
      z.grid.setPos(12, y);
      y += z.grid.h + this._gap;
    }
  }
}

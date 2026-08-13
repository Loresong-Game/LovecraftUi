// The talent grid: the WoW-Classic law, carved in stone. A TalentTree is
// ONE discipline pane — a fixed grid of tiers (rows) by up to four columns, where
// every talent holds RANKS (n/m), a LEFT click learns one rank and a RIGHT click
// unlearns one — Minus or Delete on the FOCUSED plate unlearns the same way (the
// plate CONSUMES the right-clicks and refund keys it uses — the radial chain and
// the hotkey bus stay out of the grid), each tier unlocks at five points spent
// per tier above it IN THIS
// TREE, and a prerequisite must be MAXED before its dependent opens (the golden
// arrow). No pan, no zoom, no selection state: a click has exactly one meaning
// per plate, and the tooltip's red lines answer "why not" — the confusions the
// reports named (buy/explain/clear overloading, chain rings that read as
// multi-selection, pan-vs-click ambiguity) are designed OUT, not patched.
// TalentPanes composes N panes around one shared unspent pool with the header
// and the confirm-guarded Reset (the SkillTree respec epoch guard, kept).
// Arrows ride ONE own-raster underlay canvas (zero atlas); plates reuse the
// graphnode.* stone family plus the gilt `graphnode.maxed` cut.
// TalentPlate is shared with the drawn hand's RunMap (imported directly, not a
// barrel export — the trees.js -> nodegraph.js precedent).

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS, socketInset } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { isReducedMotion } from '../animate.js';
import {
  commitChange, requireEngine, widgetsEngine, uisound, EldTooltip, setNodeDisabled,
  Button, abilityData,
} from './widgets.js';
import { EldPopup } from './windows.js';
import { str } from '../strings.js';

const SHADOW = METRICS.textShadow;
const tex = (name) => requireEngine().textures.get(name);

export const TIER_POINTS = 5; // the test suite law: tier t unlocks at 5*(t-1) spent in-tree
const COLS = 4;                 // the classic four-column pane
const PLATE_DEFAULT = 48;
const COL_GAP = 22;
const TIER_GAP = 34;
const PAD = 12;
const RAIL_W = 64;              // the left rail where sealed tiers state their price
const FOOTER_H = 22;

// warn-once per boot (the B8 parity law: re-init warns again)
let _warned = new Set();
function warnOnce(key, msg) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(`LovecraftUI: ${msg}`);
}
export function resetTalentWarnings() { _warned = new Set(); }

// ---------------- TalentPlate (shared with RunMap) ----------------
// One stone cell: state art from the graphnode.* family, a sigil, a hover glow,
// an optional ring overlay, and a corner badge. The OWNER decides everything
// through the spec functions; the plate only renders and reports gestures.
export class TalentPlate extends UINode {
  // opts: { id, icon, size = 48, getArt() -> 'locked'|'available'|'owned'|'maxed',
  //         getBadge() -> {text, color}|null, tooltip() -> spec|null,
  //         onClick(plate), onRightClick(plate, e), onHover(plate, over) }
  // Minus/Delete on the focused plate route onRightClick too (the keyboard refund).
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.id = opts.id;
    const size = Math.max(24, Number.isFinite(opts.size) ? opts.size : PLATE_DEFAULT);
    this._spec = opts;
    this.setSize(size, size);

    this.bg = new QuadNode({ texture: tex(`graphnode.${opts.getArt?.() ?? 'locked'}`) });
    this.add(this.bg);
    this.icon = null;
    if (opts.icon != null) {
      this.icon = new QuadNode({ texture: tex(`icon.${opts.icon}`) });
      this.add(this.icon);
    }
    this.hoverFx = new QuadNode({ texture: tex('graphnode.hover') });
    this.hoverFx.visible = false;
    this.add(this.hoverFx);
    this.ring = new QuadNode({ texture: tex('graphnode.highlight') });
    this.ring.visible = false;
    this.add(this.ring);
    // the rank chip: a dark backing under the badge, so the n/m stays legible over
    // ANY sigil art — the painted icon pack put a grey badge on a dark painting at
    // 1.77:1 and the audit drew blood (contrast must not depend on the art beneath)
    this.badgeBg = new QuadNode({ color: COLORS.voidBlack, opacity: 0.8 });
    this.add(this.badgeBg);
    this.badge = new TextNode('', {
      size: 11, weight: 'bold', color: COLORS.bone, font: FONTS.body,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    this.add(this.badge);
    this._refresh();

    if (opts.tooltip) EldTooltip.attach(this, () => this._spec.tooltip?.() ?? null);

    this.on('pointerenter', () => {
      // a sealed pane dispatches NOTHING outward (the nodegraph partial-seal law)
      if (this.closest((n) => n.disabled === true)) return;
      this.hoverFx.visible = true;
      this._spec.onHover?.(this, true);
    });
    this.on('pointerleave', () => {
      this.hoverFx.visible = false;
      this._releaseFx();
      this._spec.onHover?.(this, false);
    });
    this.on('pointerdown', (e) => {
      if (this.closest((n) => n.disabled === true)) { e.stopPropagation(); return; }
      const g = widgetsEngine();
      if (g) { if (isReducedMotion()) { g.ticker.cancelPropTween(this, 'fxScale'); this.fxScale = 0.95; } else g.ticker.tween(this, { fxScale: 0.95 }, { dur: 0.1 }); }
    });
    this.on('pointerup', () => this._releaseFx());
    this.on('click', (e) => {
      if (this.closest((n) => n.disabled === true)) { e.stopPropagation(); return; }
      this._spec.onClick?.(this);
    });
    this.on('rightclick', (e) => {
      if (this.closest((n) => n.disabled === true)) return;
      this._spec.onRightClick?.(this, e);
    });
    this.on('keydown', (e) => {
      // The refund verb on the keyboard: Minus or Delete ride the same callback,
      // the same oracle, the same consume seam as the right-click. An UNWIRED
      // plate (RunMap's) lets the key fall through — hotkeys on the bus keep
      // their minus, exactly as the chain keeps its right-clicks.
      if (e.key !== '-' && e.key !== 'Delete') return;
      if (!this._spec.onRightClick) return;
      if (this.closest((n) => n.disabled === true)) return;
      e.preventDefault();
      this._spec.onRightClick(this, e);
    });
    this.onActivate = () => { if (!this.closest((n) => n.disabled === true)) this._spec.onClick?.(this); };
  }

  _releaseFx() {
    if (this.fxScale === 1) return;
    const g = widgetsEngine();
    if (g) { if (isReducedMotion()) { g.ticker.cancelPropTween(this, 'fxScale'); this.fxScale = 1; } else g.ticker.tween(this, { fxScale: 1 }, { dur: 0.1 }); }
  }

  // ONE method computes the visual state; nothing else swaps textures.
  _refresh() {
    const art = this._spec.getArt?.() ?? 'locked';
    this.bg.setTexture(tex(`graphnode.${art}`));
    if (this.icon) this.icon.setColor(art === 'locked' ? COLORS.textDisabled : COLORS.textWhite);
    const b = this._spec.getBadge?.() ?? null;
    if (b && b.text) {
      this.badge.visible = true;
      this.badgeBg.visible = true;
      this.badge.setText(b.text);
      this.badge.setColor(b.color ?? COLORS.bone);
      this.invalidateLayout();
    } else { this.badge.visible = false; this.badgeBg.visible = false; }
  }

  setRing(v) { this.ring.visible = !!v; }

  onLayout() {
    const s = this.w;
    this.bg.setRect(0, 0, s, s);
    this.hoverFx.setRect(0, 0, s, s);
    this.ring.setRect(0, 0, s, s);
    if (this.icon) { const ti = socketInset(s); this.icon.setRect(ti, ti, s - ti * 2, s - ti * 2); } // the socket law (was a 16.7% literal)
    const bx = Math.round(s - this.badge.w - METRICS.badgeInset);
    const by = Math.round(s - this.badge.h - METRICS.badgeInset);
    this.badge.setPos(bx, by);
    this.badgeBg.setRect(bx - 3, by - 1, this.badge.w + 6, this.badge.h + 2);
  }
}

// ---------------- TalentTree ----------------
// data: { name = '', talents: [{ id, icon, tier (1-based), col (0..3),
//   maxRank (1..5, default 1), requires: prereqId|null, name?, desc?,
//   rankDesc?: [one string per rank] }] }
// One pane. `points` is the FED unspent pool (a page or TalentPanes grants it);
// spending takes one point per rank — the WoW law, no per-node prices.
function normalizeTalents(data) {
  const name = typeof data?.name === 'string' ? data.name : '';
  const seen = new Map();
  const cells = new Set();
  const out = [];
  for (const raw of data?.talents ?? []) {
    if (!raw || raw.id == null) { warnOnce('talent-noid', 'a talent without an id was dropped.'); continue; }
    const id = String(raw.id);
    if (seen.has(id)) { warnOnce(`talent-dup-${id}`, `duplicate talent id '${id}' — the first kept, later dropped.`); continue; }
    const tier = Number.isFinite(raw.tier) ? Math.max(1, Math.round(raw.tier)) : 1;
    const col = Number.isFinite(raw.col) ? Math.min(COLS - 1, Math.max(0, Math.round(raw.col))) : 0;
    const cell = `${tier}:${col}`;
    if (cells.has(cell)) { warnOnce(`talent-cell-${cell}`, `two talents share cell tier ${tier} col ${col} — '${id}' dropped.`); continue; }
    const maxRank = Number.isFinite(raw.maxRank) ? Math.min(5, Math.max(1, Math.round(raw.maxRank))) : 1;
    let requires = raw.requires != null ? String(raw.requires) : null;
    if (requires === id) { warnOnce(`talent-self-${id}`, `talent '${id}' requires itself — the prerequisite was dropped.`); requires = null; }
    const t = {
      id, icon: raw.icon ?? 'book', tier, col, maxRank, requires,
      name: raw.name ?? null, desc: raw.desc ?? null,
      rankDesc: Array.isArray(raw.rankDesc) ? raw.rankDesc : null,
    };
    seen.set(id, t);
    cells.add(cell);
    out.push(t);
  }
  for (const t of out) {
    if (t.requires && !seen.has(t.requires)) {
      warnOnce(`talent-req-${t.id}`, `talent '${t.id}' requires unknown '${t.requires}' — it stays locked forever.`);
    }
  }
  return { name, talents: out, byId: seen };
}

export class TalentTree extends UINode {
  // opts: { data, points = 0, plateSize = 48, onSpend = null, onRefund = null }
  constructor(opts = {}) {
    super({ interactive: false }); // the wall between plates falls through (the radial chain may answer)
    requireEngine();
    this.plateSize = Math.max(24, Number.isFinite(opts.plateSize) ? opts.plateSize : PLATE_DEFAULT);
    this.points = Number.isFinite(opts.points) ? Math.max(0, Math.round(opts.points)) : 0;
    this.onSpend = opts.onSpend ?? null;
    this.onRefund = opts.onRefund ?? null;
    this._arrows = null;
    this._arrowQuad = null;
    this._plates = new Map();
    this._rails = [];
    this._arrowRevision = 0;
    this._footer = new TextNode('', { size: 11, color: COLORS.textMuted, font: FONTS.body, shadow: SHADOW });
    this.setData(opts.data ?? { talents: [] });
  }

  // Rebuild wholesale (the constructor-fixed data law: skins re-seat, they do not mutate).
  setData(data) {
    const model = normalizeTalents(data);
    this.name = model.name;
    this._talents = model.talents;
    this._byId = model.byId;
    this._ranks = new Map();
    for (const t of this._talents) this._ranks.set(t.id, 0);
    // tear down the previous grid whole
    for (const p of this._plates.values()) p.dispose();
    this._plates.clear();
    for (const r of this._rails) r.dispose();
    this._rails = [];
    if (this._arrowQuad) { this._arrowQuad.dispose(); this._arrowQuad = null; }
    if (this._arrows) { this._arrows.texture.dispose(); this._arrows = null; }
    this._tiers = this._talents.reduce((m, t) => Math.max(m, t.tier), 1);
    // the rail: a sealed tier states its price until the test suite opens — built FIRST
    // so the rail lane is MEASURED from the widest label (a guessed width put the
    // longest "Needs N pts" 5px into the col-0 plates; the audit drew blood)
    for (let k = 2; k <= this._tiers; k++) {
      const rail = new TextNode(str('talentTierNeeds', TIER_POINTS * (k - 1)), {
        size: 10, smallCaps: true, letterSpacing: 1, color: COLORS.textFaint,
        font: FONTS.header, shadow: SHADOW,
      });
      rail._tier = k;
      this._rails.push(rail); // built DETACHED: measured here, mounted after the underlay
    }
    this._railW = Math.max(RAIL_W, this._rails.reduce((m, r) => Math.max(m, r.w), 0) + 12);
    // geometry: [PAD measured-rail][grid], footer lane beneath
    const gridW = COLS * this.plateSize + (COLS - 1) * COL_GAP;
    const gridH = this._tiers * this.plateSize + (this._tiers - 1) * TIER_GAP;
    this._gridX = PAD + this._railW;
    this._gridY = PAD;
    this.setSize(this._gridX + gridW + PAD, PAD + gridH + FOOTER_H + PAD);
    // the arrow underlay FIRST — plates paint over it
    this._arrows = createCanvasTexture(gridW + COL_GAP, gridH + TIER_GAP, texScale());
    this._arrowQuad = new QuadNode({ texture: this._arrows.texture });
    this.add(this._arrowQuad);
    for (const rail of this._rails) this.add(rail); // the measured rail lane rides over the underlay
    // one plate per talent
    for (const t of this._talents) {
      const plate = new TalentPlate({
        id: t.id, icon: t.icon, size: this.plateSize,
        getArt: () => this._artOf(t),
        getBadge: () => this._badgeOf(t),
        tooltip: () => this._tooltipOf(t),
        onClick: () => this._trySpend(t),
        onRightClick: (_p, e) => { e.preventDefault(); this._tryRefund(t); }, // the grid OWNS its right-clicks
        onHover: (_p, over) => this.dispatch('talenthover', { id: t.id, over, rank: this._ranks.get(t.id), state: this.getState(t.id) }),
      });
      this._plates.set(t.id, plate);
      this.add(plate);
    }
    this.add(this._footer); // re-add keeps the footer above the underlay after rebuilds
    this._refreshAll();
    return this;
  }

  // ---- the derivation oracle ----
  _spentByTier() {
    const spent = new Array(this._tiers + 1).fill(0);
    for (const t of this._talents) spent[t.tier] += this._ranks.get(t.id);
    return spent;
  }
  _spentBelow(tier, spent = this._spentByTier()) {
    let s = 0;
    for (let k = 1; k < tier; k++) s += spent[k];
    return s;
  }
  getSpent() { let s = 0; for (const v of this._ranks.values()) s += v; return s; }
  getRank(id) { return this._ranks.get(String(id)) ?? 0; }
  getRanks() {
    const out = {};
    for (const [id, r] of this._ranks) if (r > 0) out[id] = r;
    return out;
  }

  // locked-tier | locked-prereq | available | ranked | maxed
  getState(id) {
    const t = this._byId.get(String(id));
    if (!t) return null;
    const rank = this._ranks.get(t.id);
    if (rank >= t.maxRank) return 'maxed';
    if (rank > 0) return 'ranked'; // invariants keep a ranked talent unlocked
    if (this._spentBelow(t.tier) < TIER_POINTS * (t.tier - 1)) return 'locked-tier';
    if (t.requires) {
      const pre = this._byId.get(t.requires);
      if (!pre || this._ranks.get(pre.id) < pre.maxRank) return 'locked-prereq';
    }
    return 'available';
  }

  _artOf(t) {
    const s = this.getState(t.id);
    if (s === 'maxed') return 'maxed';
    if (s === 'ranked') return 'owned';
    if (s === 'available') return 'available';
    return 'locked';
  }
  _badgeOf(t) {
    const s = this.getState(t.id);
    const color = s === 'maxed' ? COLORS.talentGold
      : (s === 'available' || s === 'ranked') ? COLORS.positive
        : COLORS.textDisabled;
    return { text: `${this._ranks.get(t.id)}/${t.maxRank}`, color };
  }

  _tooltipOf(t) {
    const rank = this._ranks.get(t.id);
    const s = this.getState(t.id);
    const base = abilityData(t.icon);
    const title = t.name ?? base?.name ?? t.id;
    const titleColor = s === 'maxed' ? COLORS.talentGold
      : (s === 'available' || s === 'ranked') ? COLORS.accent : COLORS.textMuted;
    const lines = [{ text: str('talentRank', rank, t.maxRank), color: COLORS.bone }];
    const rd = t.rankDesc;
    const desc = rank > 0 ? (rd?.[rank - 1] ?? t.desc ?? base?.desc ?? null) : (t.desc ?? base?.desc ?? null);
    if (rank < t.maxRank && rd?.[rank] != null) {
      lines.push({ text: str('talentNextRank'), color: COLORS.textFaint });
      lines.push({ text: rd[rank], color: COLORS.textMuted });
    }
    if (s === 'locked-tier') {
      lines.push({ text: str('talentReqTier', TIER_POINTS * (t.tier - 1), this.name || '—'), color: COLORS.negative });
    }
    if (s === 'locked-prereq' || (s === 'locked-tier' && t.requires)) {
      const pre = this._byId.get(t.requires ?? '');
      if (t.requires && (!pre || this._ranks.get(pre.id) < pre.maxRank)) {
        const preName = pre ? (pre.name ?? abilityData(pre.icon)?.name ?? pre.id) : t.requires;
        lines.push({ text: str('talentReqTalent', pre?.maxRank ?? '?', preName), color: COLORS.negative });
      }
    }
    if (s === 'maxed') lines.push({ text: str('talentMaxed'), color: COLORS.talentGold });
    return { title, titleColor, lines, desc };
  }

  // ---- the verbs ----
  canSpend(id) {
    const s = this.getState(String(id));
    return (s === 'available' || s === 'ranked') && this.points > 0;
  }
  _trySpend(t) {
    if (this.disabled) return;
    const s = this.getState(t.id);
    if (s === 'maxed') return; // a full talent rests; the tooltip already says so
    if (s === 'locked-tier' || s === 'locked-prereq') { uisound(this, 'error', { reason: 'sealed' }); return; }
    if (this.points <= 0) { uisound(this, 'error', { reason: 'essence' }); return; }
    this._ranks.set(t.id, this._ranks.get(t.id) + 1);
    this.points -= 1;
    this._refreshAll();
    uisound(this, 'click');
    commitChange(this, 'spend',
      { id: t.id, rank: this._ranks.get(t.id), tier: t.tier, spent: this.getSpent(), points: this.points },
      false, this.onSpend ? (_v, e) => this.onSpend(e, e) : null);
  }

  // The refund legality oracle — removing one point from T is legal iff BOTH:
  // (a) no dependent of T holds a rank (a dependent's point pins its prereq at max);
  // (b) every HIGHER tier that holds points keeps its gate: spentBelow(k)-1 >= 5*(k-1).
  canRefund(id) {
    const t = this._byId.get(String(id));
    if (!t || this._ranks.get(t.id) <= 0) return false;
    for (const d of this._talents) {
      if (d.requires === t.id && this._ranks.get(d.id) > 0) return false;
    }
    const spent = this._spentByTier();
    for (let k = t.tier + 1; k <= this._tiers; k++) {
      if (spent[k] > 0 && this._spentBelow(k, spent) - 1 < TIER_POINTS * (k - 1)) return false;
    }
    return true;
  }
  _tryRefund(t) {
    if (this.disabled) return;
    if (!this.canRefund(t.id)) { uisound(this, 'error', { reason: 'bound' }); return; }
    this._ranks.set(t.id, this._ranks.get(t.id) - 1);
    this.points += 1;
    this._refreshAll();
    uisound(this, 'click');
    commitChange(this, 'refund',
      { id: t.id, rank: this._ranks.get(t.id), tier: t.tier, spent: this.getSpent(), points: this.points },
      false, this.onRefund ? (_v, e) => this.onRefund(e, e) : null);
  }

  // Bulk restore (the silent load path). Applies tier-ascending, two passes per
  // tier for same-tier prerequisites; whatever stays illegal is dropped with a
  // warning — a saved build from other data never corrupts the invariants.
  setRanks(map, { silent = true } = {}) {
    for (const id of this._ranks.keys()) this._ranks.set(id, 0);
    const want = map ?? {};
    for (let k = 1; k <= this._tiers; k++) {
      for (let pass = 0; pass < 2; pass++) {
        for (const t of this._talents) {
          if (t.tier !== k || this._ranks.get(t.id) > 0) continue;
          const w = Math.min(t.maxRank, Math.max(0, Math.round(Number(want[t.id]) || 0)));
          if (w <= 0) continue;
          if (this._spentBelow(t.tier) < TIER_POINTS * (t.tier - 1)) continue;
          if (t.requires) {
            const pre = this._byId.get(t.requires);
            if (!pre || this._ranks.get(pre.id) < pre.maxRank) continue;
          }
          this._ranks.set(t.id, w);
        }
      }
    }
    for (const [id, w] of Object.entries(want)) {
      const got = this._ranks.get(String(id)) ?? null;
      const asked = Math.max(0, Math.round(Number(w) || 0));
      if (asked > 0 && (got === null || got < Math.min(asked, this._byId.get(String(id))?.maxRank ?? asked))) {
        warnOnce(`talent-restore-${id}`, `setRanks dropped or trimmed '${id}' — the saved build breaks the tier/prerequisite law here.`);
      }
    }
    this._refreshAll();
    commitChange(this, 'rankschange', { ranks: this.getRanks() }, silent, null);
    return this;
  }

  // Zero every rank and credit the refund back to the fed pool. No confirm here —
  // confirmation is chrome (TalentPanes carries the guarded Reset button).
  reset({ silent = true } = {}) {
    const refunded = this.getSpent();
    if (!refunded) return this;
    for (const id of this._ranks.keys()) this._ranks.set(id, 0);
    this.points += refunded;
    this._refreshAll();
    commitChange(this, 'reset', { refunded, points: this.points }, silent, null);
    return this;
  }

  setPoints(v, { silent = true } = {}) {
    const want = Number.isFinite(v) ? Math.max(0, Math.round(v)) : this.points;
    if (want === this.points) return this;
    this.points = want;
    commitChange(this, 'pointschange', { points: this.points }, silent, null);
    return this;
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  // ---- rendering ----
  _refreshAll() {
    for (const p of this._plates.values()) p._refresh();
    const spent = this._spentByTier();
    for (const rail of this._rails) {
      rail.visible = this._spentBelow(rail._tier, spent) < TIER_POINTS * (rail._tier - 1);
    }
    this._footer.setText(str('talentTreeSpent', this.name || '—', this.getSpent()));
    this._redrawArrows();
    this.invalidateLayout();
  }

  _plateXY(t) {
    return {
      x: this._gridX + t.col * (this.plateSize + COL_GAP),
      y: this._gridY + (t.tier - 1) * (this.plateSize + TIER_GAP),
    };
  }

  // WoW arrows on the one underlay: straight down a column, an elbow across
  // columns; GOLD once the prerequisite is maxed, stone-quiet until then.
  _redrawArrows() {
    if (!this._arrows) return;
    const { ctx } = this._arrows;
    const cw = COLS * this.plateSize + COLS * COL_GAP;
    const ch = this._tiers * this.plateSize + this._tiers * TIER_GAP;
    ctx.clearRect(0, 0, cw, ch);
    const half = this.plateSize / 2;
    const head = (x, y, dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x - dx * 7 - dy * 4, y - dy * 7 - dx * 4);
      ctx.lineTo(x, y);
      ctx.lineTo(x - dx * 7 + dy * 4, y - dy * 7 + dx * 4);
      ctx.stroke();
    };
    for (const t of this._talents) {
      if (!t.requires) continue;
      const pre = this._byId.get(t.requires);
      if (!pre) continue;
      const met = this._ranks.get(pre.id) >= pre.maxRank;
      ctx.strokeStyle = met ? COLORS.talentGold : COLORS.border;
      ctx.lineWidth = 3;
      ctx.shadowColor = met ? COLORS.talentGoldGlow : 'rgba(0,0,0,0)';
      ctx.shadowBlur = met ? 5 : 0;
      const a = this._plateXY(pre);
      const b = this._plateXY(t);
      const ax = a.x - this._gridX + half;
      const ay = a.y - this._gridY + half;
      const bx = b.x - this._gridX + half;
      const by = b.y - this._gridY + half;
      ctx.beginPath();
      if (pre.col === t.col) {
        ctx.moveTo(ax, ay + half - 2);
        ctx.lineTo(bx, by - half + 2);
        ctx.stroke();
        head(bx, by - half + 2, 0, 1);
      } else if (pre.tier === t.tier) {
        const dir = bx > ax ? 1 : -1;
        ctx.moveTo(ax + dir * (half - 2), ay);
        ctx.lineTo(bx - dir * (half - 2), by);
        ctx.stroke();
        head(bx - dir * (half - 2), by, dir, 0);
      } else {
        const dir = bx > ax ? 1 : -1;
        ctx.moveTo(ax, ay + half - 2);
        ctx.lineTo(ax, by);
        ctx.lineTo(bx - dir * (half - 2), by);
        ctx.stroke();
        head(bx - dir * (half - 2), by, dir, 0);
      }
      ctx.shadowBlur = 0;
    }
    this._arrows.texture.needsUpdate = true;
    this._arrowRevision++;
    widgetsEngine()?.requestRender();
  }

  onLayout() {
    // bare arithmetic by design: a fixed talent grid is coordinates, not a flow —
    // boxes would fight the tier/column law (the DELTA-7 carve-out, named here)
    if (this._arrowQuad) {
      this._arrowQuad.setRect(this._gridX, this._gridY,
        COLS * this.plateSize + COLS * COL_GAP, this._tiers * this.plateSize + this._tiers * TIER_GAP);
    }
    for (const t of this._talents) {
      const p = this._plates.get(t.id);
      const { x, y } = this._plateXY(t);
      p.setPos(Math.round(x), Math.round(y));
    }
    for (const rail of this._rails) {
      const y = this._gridY + (rail._tier - 1) * (this.plateSize + TIER_GAP) + Math.round((this.plateSize - rail.h) / 2);
      // right-aligned against the grid edge, inside the MEASURED rail lane
      rail.setPos(Math.max(PAD, this._gridX - 8 - rail.w), Math.round(y));
    }
    this._footer.setPos(this._gridX, this.h - PAD - this._footer.h);
  }

  disposeSelf() {
    if (this._arrows) { this._arrows.texture.dispose(); this._arrows = null; }
  }
}

// ---------------- TalentPanes ----------------
// N disciplines around ONE unspent pool: the header (unspent + total spent),
// the confirm-guarded Reset Talents, and the pool law — a spend in any pane
// drains the shared pool; a refund anywhere refills it. The reset confirm keeps
// the SkillTree epoch + re-entry guard verbatim (EldPopup QUEUES repeat shows,
// and each queued OK would refund the same capture again — points from nothing).
export class TalentPanes extends UINode {
  // opts: { panes: [{id, data}], points = 0, plateSize, onSpend, onRefund, onReset }
  constructor(opts = {}) {
    super({ interactive: false });
    requireEngine();
    this.onSpend = opts.onSpend ?? null;
    this.onRefund = opts.onRefund ?? null;
    this.onReset = opts.onReset ?? null;
    this._epoch = 0;
    this._resetPending = false;
    this._paneIds = [];
    this._panes = new Map();
    this.points = Number.isFinite(opts.points) ? Math.max(0, Math.round(opts.points)) : 0;

    this.unspentText = new TextNode('', { size: 13, weight: 'bold', color: COLORS.accent, font: FONTS.body, shadow: SHADOW });
    this.add(this.unspentText);
    this.spentText = new TextNode('', { size: 12, color: COLORS.textMuted, font: FONTS.body, shadow: SHADOW });
    this.add(this.spentText);
    this.resetBtn = new Button(str('talentReset'), { onClick: () => this.reset() });
    this.add(this.resetBtn);

    for (const spec of opts.panes ?? []) {
      const pane = new TalentTree({ data: spec.data, points: this.points, plateSize: opts.plateSize });
      pane._paneId = spec.id ?? String(this._paneIds.length);
      this._paneIds.push(pane._paneId);
      this._panes.set(pane._paneId, pane);
      this.add(pane);
    }
    // the pool law rides the BUBBLE: the child's loud event passes through here,
    // gains its `tree` name, and the pool re-feeds every pane silently
    this.on('spend', (e) => {
      if (!e.target || e.target === this || !e.target._paneId) return;
      e.tree = e.target._paneId;
      this.points = Math.max(0, this.points - 1);
      this._feedPool();
      if (this.onSpend) { try { this.onSpend(e, e); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); } }
    });
    this.on('refund', (e) => {
      if (!e.target || e.target === this || !e.target._paneId) return;
      e.tree = e.target._paneId;
      this.points += 1;
      this._feedPool();
      if (this.onRefund) { try { this.onRefund(e, e); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); } }
    });
    this._measure();
    this._paintHeader();
  }

  _measure() {
    const panes = [...this._panes.values()];
    const gap = 16;
    const w = panes.reduce((s, p) => s + p.w, 0) + Math.max(0, panes.length - 1) * gap + PAD * 2;
    const h = 40 + (panes.length ? Math.max(...panes.map((p) => p.h)) : 0) + PAD;
    this.setSize(Math.max(w, 260), h);
  }

  _feedPool() {
    for (const p of this._panes.values()) p.setPoints(this.points, { silent: true });
    this._paintHeader();
  }

  _paintHeader() {
    this.unspentText.setText(str('talentUnspent', this.points));
    this.spentText.setText(str('talentSpent', this.getSpent()));
    this.invalidateLayout();
  }

  pane(id) { return this._panes.get(String(id)) ?? null; }
  getSpent() { let s = 0; for (const p of this._panes.values()) s += p.getSpent(); return s; }

  setPoints(v, { silent = true } = {}) {
    const want = Number.isFinite(v) ? Math.max(0, Math.round(v)) : this.points;
    if (want === this.points) return this;
    this.points = want;
    this._feedPool();
    commitChange(this, 'pointschange', { points: this.points }, silent, null);
    return this;
  }

  // The guarded Reset: one confirm at a time, epoch-voided by restore/setData.
  reset() {
    if (this.disabled || this._resetPending) return this;
    if (!this.getSpent()) return this;
    const epoch = this._epoch;
    this._resetPending = true;
    EldPopup.show({
      title: str('talentResetTitle'),
      message: str('talentResetPrompt'),
      onOkay: () => {
        if (this._epoch !== epoch || this.disposed) return; // the panes moved on
        let refunded = 0;
        for (const p of this._panes.values()) {
          refunded += p.getSpent();
          p.setRanks({}, { silent: true });
        }
        this.points += refunded;
        this._feedPool();
        commitChange(this, 'reset', { refunded, points: this.points }, false,
          this.onReset ? (_v, e) => this.onReset(e, e) : null);
      },
    }).finally(() => { this._resetPending = false; }); // OK, Cancel, hide — the test suite re-arms regardless
    return this;
  }

  // The silent load path (the serializeLayout pattern): no events, invariants enforced.
  restore({ points, ranks } = {}) {
    this._epoch++;
    this.points = Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0;
    for (const [id, p] of this._panes) p.setRanks(ranks?.[id] ?? {}, { silent: true });
    this._feedPool();
    return this;
  }

  serialize() {
    const ranks = {};
    for (const [id, p] of this._panes) ranks[id] = p.getRanks();
    return { points: this.points, ranks };
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    // bare arithmetic by design: one header lane over N fixed-size panes (the
    // DELTA-7 carve-out — the panes' sizes are data-derived, not flowed)
    this.unspentText.setPos(PAD, Math.round((40 - this.unspentText.h) / 2));
    this.spentText.setPos(PAD + this.unspentText.w + 18, Math.round((40 - this.spentText.h) / 2));
    this.resetBtn.setPos(this.w - PAD - this.resetBtn.w, Math.round((40 - this.resetBtn.h) / 2));
    let x = PAD;
    for (const id of this._paneIds) {
      const p = this._panes.get(id);
      p.setPos(x, 40);
      x += p.w + 16;
    }
  }
}

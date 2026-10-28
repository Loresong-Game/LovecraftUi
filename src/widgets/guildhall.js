// The Guildhall: the fellowship kit, cut on the rule that razed
// the gathering (the compact rail column, the scoreboard, the nameplate pool, and
// the ping chip died with their page). PartyPanel — party UNIT frames: each member
// row wraps a REAL UnitFrame (portrait, level, tweened health/mana, the buff
// strip), and the panel owns what a group adds on top — the leader crown, the role
// glyph, dead/offline treatments, the selection ring, and the ready-check chips —
// all instance-raster (zero atlas cost). The panel AFFORDS; the game owns the
// roster: `setMembers`/`setMember` are the model verbs (silent, the data-driven
// protocol), a click on a living or fallen row commits loud `target {id, index}`
// (the event plane owns `target` — the payload carries ids), an offline row
// refuses with the error voice, and the ready check is display over game truth
// (`beginReadyCheck`/`setReady`/`clearReadyCheck` — the GAME clocks the answers).
// `effectclick` bubbles up from each row's buff strip untouched.

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { str } from '../strings.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { commitChange, requireEngine, widgetsEngine, uisound, setNodeDisabled, EldTooltip } from './widgets.js';
import { UnitFrame } from './components.js';
import { VBox } from '../layoutbox.js';

const SHADOW = METRICS.textShadow;
const ROLES = ['tank', 'healer', 'damage'];
const STATES = ['alive', 'dead', 'offline'];
const ROW_W = 250;  // UnitFrame's fixed footprint — the panel is frame-wide by construction
const ROW_H = 118;

// ---- the chip painters (instance raster; COLORS read at paint time — themable) ----

function paintCrown(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  const g = COLORS.talentGold ?? COLORS.accent;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 3.5;
  crownPath(ctx, s);
  ctx.stroke();
  ctx.fillStyle = g;
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.4;
  crownPath(ctx, s);
  ctx.fill();
  ctx.stroke();
}
function crownPath(ctx, s) {
  const x = 3, y = 7, w = s - 6, h = s - 14;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + 2);
  ctx.lineTo(x + w * 0.28, y + h * 0.45);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.72, y + h * 0.45);
  ctx.lineTo(x + w, y + 2);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function paintRole(ctx, s, role) {
  ctx.clearRect(0, 0, s, s);
  // a dark seat so the glyph reads over any portrait corner
  ctx.fillStyle = 'rgba(4,7,9,0.85)';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.lineWidth = 1.6;
  const c = s / 2;
  if (role === 'tank') {
    // a shield
    ctx.strokeStyle = COLORS.accent;
    ctx.fillStyle = 'rgba(111,209,139,0.25)';
    ctx.beginPath();
    ctx.moveTo(c, c - 5.5);
    ctx.quadraticCurveTo(c + 5, c - 4.5, c + 5, c - 1.5);
    ctx.quadraticCurveTo(c + 5, c + 3.5, c, c + 6);
    ctx.quadraticCurveTo(c - 5, c + 3.5, c - 5, c - 1.5);
    ctx.quadraticCurveTo(c - 5, c - 4.5, c, c - 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (role === 'healer') {
    // a cross
    ctx.strokeStyle = COLORS.positive;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c, c - 5);
    ctx.lineTo(c, c + 5);
    ctx.moveTo(c - 5, c);
    ctx.lineTo(c + 5, c);
    ctx.stroke();
  } else {
    // crossed blades
    ctx.strokeStyle = COLORS.negative;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c - 5, c - 5);
    ctx.lineTo(c + 5, c + 5);
    ctx.moveTo(c + 5, c - 5);
    ctx.lineTo(c - 5, c + 5);
    ctx.stroke();
  }
}

function paintReady(ctx, s, state) {
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(4,7,9,0.85)';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  const c = s / 2;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  if (state === 'yes') {
    ctx.strokeStyle = COLORS.accent;
    ctx.beginPath();
    ctx.moveTo(c - 5, c);
    ctx.lineTo(c - 1.5, c + 4);
    ctx.lineTo(c + 5, c - 4);
    ctx.stroke();
  } else if (state === 'no') {
    ctx.strokeStyle = COLORS.negative;
    ctx.beginPath();
    ctx.moveTo(c - 4.5, c - 4.5);
    ctx.lineTo(c + 4.5, c + 4.5);
    ctx.moveTo(c + 4.5, c - 4.5);
    ctx.lineTo(c - 4.5, c + 4.5);
    ctx.stroke();
  } else {
    // pending: an hourglass in the quest amber
    ctx.strokeStyle = COLORS.quest;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(c - 4, c - 5);
    ctx.lineTo(c + 4, c - 5);
    ctx.lineTo(c - 4, c + 5);
    ctx.lineTo(c + 4, c + 5);
    ctx.closePath();
    ctx.stroke();
  }
}

// A 24px chip (the STYLE §7 hit floor) whose art is an instance canvas the chip
// owns; `repaint(fn)` re-inks in place. Interactive only when a tooltip rides it.
function makeChip(painter, { interactive = false } = {}) {
  const node = new UINode({ interactive });
  const art = createCanvasTexture(24, 24, texScale());
  painter(art.ctx, 24);
  const quad = new QuadNode({ texture: art.texture });
  node.add(quad);
  node.setSize(24, 24);
  quad.setRect(0, 0, 24, 24);
  node._art = art;
  node.repaint = (fn) => {
    fn(art.ctx, 24);
    art.texture.needsUpdate = true;
    widgetsEngine()?.requestRender();
  };
  const dispose = node.disposeSelf?.bind(node);
  node.disposeSelf = () => { art.texture.dispose(); dispose?.(); };
  return node;
}

const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

// ---- the member row: a UnitFrame plus the panel's group chrome ----

class PartyRow extends UINode {
  constructor(panel, member) {
    super({ interactive: true });
    this.panel = panel;
    this.member = member;
    this.frame = new UnitFrame({
      name: member.name, portrait: member.portrait,
      level: member.level, health: [member.hp, member.hpMax], mana: [member.mp, member.mpMax],
    });
    this.add(this.frame);

    // the selection ring + fill: the "this is your target" read (rests hidden).
    // Interaction-state art rides the whole plate by design.
    this.selFill = new QuadNode({ color: COLORS.accent, opacity: 1 });
    this.selFill.fxOpacity = 0;
    this.selFill.auditAllow('overlap', 'containment');
    this.add(this.selFill);
    this.selEdges = [0, 0, 0, 0].map(() => {
      const q = new QuadNode({ color: COLORS.accent, opacity: 1 });
      q.fxOpacity = 0;
      q.auditAllow('overlap', 'containment');
      this.add(q);
      return q;
    });

    // the row is clickable, so hover AND press must read — the wash channel
    this.wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    this.wash.auditAllow('overlap', 'containment');
    this.add(this.wash);
    this.on('pointerenter', () => { if (!this.closest((n) => n.disabled === true)) this.wash.setBaseOpacity(METRICS.washHover); });
    this.on('pointerleave', () => this.wash.setBaseOpacity(0));
    this.on('pointerdown', (e) => {
      if (this.closest((n) => n.disabled === true)) return;
      if (e.button != null && e.button !== 0) return;
      this.wash.setBaseOpacity(METRICS.washPress);
    });
    this.on('pointerup', () => this.wash.setBaseOpacity(this._hovered ? METRICS.washHover : 0));
    this.on('click', (e) => {
      if (this.closest((n) => n.disabled === true)) { e.stopPropagation(); return; }
      this.panel._rowClicked(this);
    });

    // the crown (leader), the role glyph, and the ready chip — 24px chips over
    // the plate corners (declared overlap: group chrome rides the frame art)
    this.crown = makeChip((ctx, s) => paintCrown(ctx, s), { interactive: true });
    this.crown.auditAllow('overlap', 'containment');
    EldTooltip.attach(this.crown, () => ({ title: str('partyLeader') }));
    this.roleChip = makeChip((ctx, s) => paintRole(ctx, s, member.role), { interactive: true });
    this.roleChip.auditAllow('overlap', 'containment');
    EldTooltip.attach(this.roleChip, () => ({ title: this.panel._roleLabel(this.member.role) }));
    this.readyChip = makeChip((ctx, s) => paintReady(ctx, s, 'pending'));
    this.readyChip.auditAllow('overlap', 'containment');
    this.readyChip.visible = false;
    this.add(this.crown, this.roleChip, this.readyChip);

    // the state plaque: Dead/Offline across the bars (the bars are moot — say so)
    // near-solid: at 0.82 the rail's numerals ghosted through a Dead read
    this.stateBg = new QuadNode({ color: COLORS.voidBlack, opacity: 0.94 });
    this.stateText = new TextNode('', {
      font: FONTS.header, size: 13, smallCaps: true, letterSpacing: 1,
      color: COLORS.negative, shadow: SHADOW,
    });
    this.stateBg.auditAllow('overlap', 'containment');
    this.stateText.auditAllow('overlap', 'containment');
    this.stateBg.visible = false;
    this.stateText.visible = false;
    this.add(this.stateBg, this.stateText);

    this._hovered = false;
    this.on('pointerenter', () => { this._hovered = true; });
    this.on('pointerleave', () => { this._hovered = false; });

    this.setSize(ROW_W, ROW_H);
    this.applyState();
  }

  // state re-treatment: alive | dead | offline (idempotent — called on every patch)
  applyState() {
    const m = this.member;
    const dead = m.state === 'dead';
    const off = m.state === 'offline';
    this.frame.fxOpacity = off ? 0.45 : 1;
    this.frame.portrait.setBaseOpacity(dead ? 0.5 : 1);
    this.frame.nameNode.setColor(off ? COLORS.textDisabled : COLORS.bone);
    this.roleChip.fxOpacity = off ? 0.45 : 1;
    if (dead) this.frame.setHealth(0);
    this.stateBg.visible = dead || off;
    this.stateText.visible = dead || off;
    // the plaque REPLACES the rail's reading: the numerals hide under it and
    // come back on a live patch (this is the every-patch path — idempotent)
    this.frame.healthBar.text.visible = !(dead || off);
    if (dead || off) {
      this.stateText.setText(dead ? str('partyDead') : str('partyOffline'));
      this.stateText.setColor(dead ? COLORS.negative : COLORS.textFaint);
    }
    this.crown.visible = !!m.leader;
    this.invalidateLayout();
  }

  setReadyState(state) { // 'pending' | 'yes' | 'no' | null
    this.readyChip.visible = state != null;
    if (state != null) this.readyChip.repaint((ctx, s) => paintReady(ctx, s, state));
  }

  setSelected(v) {
    this.selFill.fxOpacity = v ? 0.10 : 0;
    for (const q of this.selEdges) q.fxOpacity = v ? 0.9 : 0;
  }

  onLayout() {
    // seats derive from UnitFrame's own layout constants (portrait 16,17..72,73;
    // plate 90 tall; bars 84..w-14 x 32..75) — corner chips and the plaque are
    // group chrome a box cannot seat over another widget's art
    const plate = 90;
    this.frame.setPos(0, 0);
    this.wash.setRect(0, 0, ROW_W, plate);
    this.selFill.setRect(0, 0, ROW_W, plate);
    const e = this.selEdges;
    e[0].setRect(0, 0, ROW_W, 2);
    e[1].setRect(0, plate - 2, ROW_W, 2);
    e[2].setRect(0, 0, 2, plate);
    e[3].setRect(ROW_W - 2, 0, 2, plate);
    this.crown.setPos(2, 2);
    this.roleChip.setPos(56, 52);
    this.readyChip.setPos(ROW_W - 30, plate - 30);
    // EXACTLY the health bar's rect (the plaque may not
 // stick past the frame's side) — the constants mirror UnitFrame.onLayout
    // (components.js: healthBar.setRect(84, 32, w - 98, 20)); a live child-rect
    // read here would lag a layout pass (the shot-race class), so the source is
    // named instead of read. The rail's numerals hide under a plaque state
    // (applyState), so nothing peeks past the covered bar.
    this.stateBg.setRect(84, 32, ROW_W - 98, 20);
    this.stateText.setPos(
      84 + Math.round((ROW_W - 98 - this.stateText.w) / 2),
      32 + Math.round((20 - this.stateText.h) / 2));
  }
}

// ---- the panel ----

export class PartyPanel extends UINode {
  // opts: { members = [], gap = 4, onTarget }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const gap = Number(opts.gap);
    this.gap = Number.isFinite(gap) ? Math.max(0, gap) : 4;
    this.onTarget = opts.onTarget ?? null;
    this.target = null;      // the selected member id (null = none)
    this._ready = null;      // Map<id, 'pending'|'yes'|'no'> while a check stands
    this.rows = [];
    // the column rides a VBox (the law); rows carry their own overlay seats
    this.lane = new VBox({ gap: this.gap, autoWidth: false, autoHeight: false });
    this.add(this.lane);
    this.setMembers(opts.members ?? []);
  }

  _roleLabel(role) {
    return role === 'tank' ? str('partyRoleTank')
      : role === 'healer' ? str('partyRoleHealer') : str('partyRoleDamage');
  }

  _normalize(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || raw.id == null) { warnOnce('party-noid', 'PartyPanel: a member without an id was dropped'); continue; }
      const id = String(raw.id);
      if (seen.has(id)) { warnOnce(`party-dup-${id}`, `PartyPanel: duplicate member id "${id}" dropped`); continue; }
      seen.add(id);
      const hpMax = Number.isFinite(raw.hpMax) ? Math.max(1, raw.hpMax) : 100;
      const mpMax = Number.isFinite(raw.mpMax) ? Math.max(0, raw.mpMax) : 100;
      out.push({
        id,
        name: String(raw.name ?? id),
        level: Number.isFinite(raw.level) ? raw.level : 1,
        role: ROLES.includes(raw.role) ? raw.role : 'damage',
        leader: !!raw.leader,
        portrait: raw.portrait ?? 'portrait.player',
        hp: Number.isFinite(raw.hp) ? Math.max(0, Math.min(raw.hp, hpMax)) : hpMax,
        hpMax,
        mp: Number.isFinite(raw.mp) ? Math.max(0, Math.min(raw.mp, mpMax)) : mpMax,
        mpMax,
        state: STATES.includes(raw.state) ? raw.state : 'alive',
      });
    }
    // one crown: the first declared leader keeps it
    let crowned = false;
    for (const m of out) {
      if (m.leader && crowned) m.leader = false;
      else if (m.leader) crowned = true;
    }
    return out;
  }

  // the model verbs (silent — the data-driven protocol)
  setMembers(list) {
    for (const r of this.rows) r.dispose();
    this.rows = [];
    this.members = this._normalize(list);
    for (const m of this.members) {
      const row = new PartyRow(this, m);
      this.lane.add(row);
      this.rows.push(row);
    }
    if (this.target != null && !this.members.some((m) => m.id === this.target)) this.target = null;
    if (this._ready) for (const id of [...this._ready.keys()]) {
      if (!this.members.some((m) => m.id === id)) this._ready.delete(id);
    }
    this._refreshSelection();
    this._refreshReady();
    this._resize();
    return this;
  }

  // merge-patch one member; hp/mp ride the frame's tweens, state re-treats
  setMember(id, patch = {}) {
    const i = this.members.findIndex((m) => m.id === String(id));
    if (i === -1) return this;
    const m = this.members[i];
    const row = this.rows[i];
    if (patch.leader === true) {
      for (let k = 0; k < this.members.length; k++) {
        if (this.members[k].leader && k !== i) { this.members[k].leader = false; this.rows[k].applyState(); }
      }
      m.leader = true;
    } else if (patch.leader === false) m.leader = false;
    if (patch.name != null) { m.name = String(patch.name); row.frame.setName(m.name); }
    if (Number.isFinite(patch.level)) { m.level = patch.level; row.frame.setLevel(m.level); }
    if (patch.portrait != null) { m.portrait = patch.portrait; row.frame.setPortrait(m.portrait); }
    if (ROLES.includes(patch.role)) {
      m.role = patch.role;
      row.roleChip.repaint((ctx, s) => paintRole(ctx, s, m.role));
    }
    if (Number.isFinite(patch.hpMax)) m.hpMax = Math.max(1, patch.hpMax);
    if (Number.isFinite(patch.mpMax)) m.mpMax = Math.max(0, patch.mpMax);
    if (Number.isFinite(patch.hp)) m.hp = Math.max(0, Math.min(patch.hp, m.hpMax));
    if (Number.isFinite(patch.mp)) m.mp = Math.max(0, Math.min(patch.mp, m.mpMax));
    if (STATES.includes(patch.state)) m.state = patch.state;
    if (m.state !== 'dead') row.frame.setHealth(m.hp, m.hpMax);
    row.frame.setMana(m.mp, m.mpMax);
    row.applyState();
    return this;
  }

  removeMember(id) {
    const i = this.members.findIndex((m) => m.id === String(id));
    if (i === -1) return this;
    this.members.splice(i, 1);
    const [row] = this.rows.splice(i, 1);
    row.dispose();
    if (this.target === String(id)) this.target = null;
    this._ready?.delete(String(id));
    this._resize();
    return this;
  }

  memberOf(id) { return this.members.find((m) => m.id === String(id)) ?? null; }
  rowOf(id) { return this.rows[this.members.findIndex((m) => m.id === String(id))] ?? null; }

  // the target: uniform value contract — programmatic set silent; a row click
  // runs the same commit loud. Offline members refuse with the error voice.
  setTarget(id, { silent = true } = {}) {
    const next = id == null ? null : String(id);
    if (next != null) {
      const m = this.memberOf(next);
      if (!m) return false;
      if (m.state === 'offline') { if (!silent) uisound(this, 'error'); return false; }
    }
    if (next === this.target) return true;
    this.target = next;
    this._refreshSelection();
    const i = this.members.findIndex((m) => m.id === next);
    commitChange(this, 'target', { id: next, index: i === -1 ? null : i, member: i === -1 ? null : this.members[i] }, silent, this.onTarget);
    return true;
  }

  _rowClicked(row) {
    const m = row.member;
    if (m.state === 'offline') { uisound(this, 'error'); return; }
    this.setTarget(m.id, { silent: false });
  }

  _refreshSelection() {
    for (const r of this.rows) r.setSelected(r.member.id === this.target);
  }

  // the ready check: DISPLAY over game truth — the game collects the answers
  beginReadyCheck() {
    this._ready = new Map();
    for (const m of this.members) if (m.state !== 'offline') this._ready.set(m.id, 'pending');
    this._refreshReady();
    return this;
  }

  setReady(id, v) {
    if (!this._ready || !this._ready.has(String(id))) return this;
    this._ready.set(String(id), v ? 'yes' : 'no');
    this._refreshReady();
    return this;
  }

  clearReadyCheck() {
    this._ready = null;
    this._refreshReady();
    return this;
  }

  readyState(id) { return this._ready?.get(String(id)) ?? null; }

  _refreshReady() {
    for (const r of this.rows) r.setReadyState(this._ready ? (this._ready.get(r.member.id) ?? null) : null);
  }

  // buff-strip pass-through; `effectclick` bubbles up through the panel untouched
  addEffect(id, spec) { return this.rowOf(id)?.frame.addEffect(spec) ?? null; }
  removeEffect(id, fx) { this.rowOf(id)?.frame.removeEffect(fx); return this; }
  clearEffects(id) { this.rowOf(id)?.frame.clearEffects(); return this; }

  // sized at mutation time (the EffectBar idiom) so hosts read .w/.h immediately
  _resize() {
    const n = this.rows.length;
    this.setSize(ROW_W, n ? n * ROW_H + (n - 1) * this.gap : 0);
    this.lane.setSize(ROW_W, this.h);
    this.invalidateLayout();
  }

  onLayout() { this.lane.setPos(0, 0); }

  setDisabled(v) { setNodeDisabled(this, v); }
}

// The Drawn Hand: the deckbuilder kit. Card — a procedural own-raster frame
// family (rarity trims via the COLORS.rarity* tokens, a painted cost gem, an art
// plate from the icon registry, a compileMarkup rich-text body; the INSTANCE owns
// its canvas, the TextNode/NodeGraph model — ZERO atlas cost). HandFan — the arc
// that holds them: overlap-resolving layout at 1..12 cards, hover-lift with parting
// neighbors, and drag-to-play under the drag laws (one gesture one pointer at the
// ENTRY [C3], Escape cancels a live gesture [B7], a card disposed mid-flight
// cancels [B4], pointer-id ownership throughout); the flying card IS the ghost —
// the target arrow fell per the cut line. The landing node rides the loud `play`
// as `onto` (the event plane owns `target`). An unclaimed play flies home: the
// consumer owns the model and removes the card when it accepts. Pile — draw and
// discard mounds over card DEFS (plain objects, never nodes) with a painted count
// badge and a click-to-browse Window of inert Cards. RunMap — the third graph skin
// (trees.js sent it here per its own cut line): floors ascend bottom-up,
// reachability derives from the CURRENT position, the traveled path stays lit, and
// `advance` is the loud affordance while the run MODEL belongs to the consumer.
// Reward-pick and the energy counter ship as recipes on deckbuilder.html.

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode, compileMarkup } from '../text.js';
import { str } from '../strings.js';
import { hitTest } from '../hit.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { isReducedMotion } from '../animate.js';
import { commitChange, requireEngine, widgetsEngine, uisound, rarityColor, setNodeDisabled, abilityData } from './widgets.js';
import { Window } from './windows.js';
import { PanZoomSurface } from './panzoom.js';
import { TalentPlate } from './talents.js';

const SHADOW = METRICS.textShadow;
const RARITIES = ['common', 'rare', 'epic', 'legendary'];

export const CARD_SIZES = { hand: { w: 126, h: 176 }, full: { w: 180, h: 252 } };

function roundedPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// registry icons resolve like every icon consumer: `icon.<id>` first, bare id second
function iconTex(eng, id) {
  const t = eng.textures;
  return t.has?.(`icon.${id}`) ? t.get(`icon.${id}`) : t.get(id);
}

// ---------------- Card ----------------
// A card is FURNITURE OVER PAINT: the frame (plate, rarity trim, gem socket, art
// well, name band, divider) is one instance-owned raster; the cost number, name,
// type line, body markup, and the registry art ride it as declared children.

export class Card extends UINode {
  // opts: { id, name = '', cost = 0, type = '', body = '', art = null,
  //         rarity = 'common', size = 'hand' }
  constructor(opts = {}) {
    super({ interactive: true });
    const eng = requireEngine();
    this.id = opts.id != null ? String(opts.id) : '';
    this.rarity = RARITIES.includes(opts.rarity) ? opts.rarity : 'common';
    this.cardSize = opts.size === 'full' ? 'full' : 'hand';
    const { w: CW, h: CH } = CARD_SIZES[this.cardSize];
    const cost = Number(opts.cost);
    this.cost = Number.isFinite(cost) ? Math.max(0, Math.round(cost)) : 0;
    this.name = String(opts.name ?? '');
    this.type = String(opts.type ?? '');
    this.body = String(opts.body ?? '');
    this.art = opts.art ?? null;
    this.playable = false;

    this._art = createCanvasTexture(CW, CH, texScale());
    this._quad = new QuadNode({ texture: this._art.texture });
    this.add(this._quad);

    // press is the DRAG ARM (the DraggableIcon precedent) — pickup feedback
    // rides the drag threshold by protocol design; a still finger is quiet
    this.auditAllow('press');

    // the playable glow: a full-frame film the fan/page toggles (declared wash)
    this._glow = new QuadNode({ color: COLORS.accent, opacity: 0 });
    this._glow.auditAllow('containment');
    this.add(this._glow);

    const full = this.cardSize === 'full';
    if (this.art != null) {
      this._artQuad = new QuadNode({ texture: iconTex(eng, this.art) });
      this._artQuad.auditAllow('containment');
      this.add(this._artQuad);
    } else this._artQuad = null;

    this.costText = new TextNode(String(this.cost), {
      font: FONTS.header, size: full ? 16 : 13, weight: 'bold',
      color: COLORS.textWhite, shadow: SHADOW,
    });
    this.costText.auditAllow('containment', 'overlap');
    // the name reads in BONE, not the rarity color — mid-tier rarity tints fail
    // the 4.5:1 contrast law on the void plate; the trim, gem ring, and glow
    // carry the rarity identity instead
    this.nameText = new TextNode(this.name, {
      font: FONTS.header, size: full ? 14 : 11, smallCaps: true, letterSpacing: 1,
      color: COLORS.bone, shadow: SHADOW,
      align: 'center', maxWidth: CW - 14, ellipsis: true,
    });
    this.nameText.auditAllow('containment', 'overlap');
    this.typeText = new TextNode(this.type, {
      font: FONTS.header, size: full ? 11 : 10, smallCaps: true, letterSpacing: 2,
      color: COLORS.text, shadow: SHADOW,
      align: 'center', maxWidth: CW - 20, ellipsis: true,
    });
    this.typeText.auditAllow('containment', 'overlap');
    this.bodyText = new TextNode('', {
      size: full ? 12 : 10, color: COLORS.text, shadow: SHADOW,
      maxWidth: CW - 24, multiline: true, lineHeight: full ? 16 : 13,
    });
    this.bodyText.auditAllow('containment', 'overlap');
    if (this.body) this.bodyText.setSegments(compileMarkup(this.body, this.bodyText.style));
    this.add(this.costText, this.nameText, this.typeText, this.bodyText);

    this.setSize(CW, CH);
    this._paint();
  }

  // The affordance film: the page lights what the current energy can pay for.
  setPlayable(v) {
    this.playable = !!v;
    this._glow.setBaseOpacity(this.playable ? 0.1 : 0);
    return this;
  }

  onLayout() {
    const { w: CW, h: CH } = CARD_SIZES[this.cardSize];
    this._quad.setRect(0, 0, this.w, this.h);
    this._glow.setRect(2, 2, this.w - 4, this.h - 4);
    const artTop = Math.round(CH * 0.16);
    const artH = Math.round(CH * 0.3);
    if (this._artQuad) {
      const s = Math.min(artH - 8, 52);
      this._artQuad.setRect(Math.round((CW - s) / 2), artTop + Math.round((artH - s) / 2), s, s);
    }
    this.costText.setPos(Math.round(16 - this.costText.w / 2), Math.round(16 - this.costText.h / 2));
    this.nameText.setPos(Math.round((CW - this.nameText.w) / 2), artTop + artH + 6);
    this.typeText.setPos(Math.round((CW - this.typeText.w) / 2), artTop + artH + 6 + this.nameText.h + 4);
    this.bodyText.setPos(12, artTop + artH + 6 + this.nameText.h + 4 + this.typeText.h + 8);
  }

  _paint() {
    const { ctx } = this._art;
    const { w: CW, h: CH } = CARD_SIZES[this.cardSize];
    const trim = rarityColor(this.rarity);
    ctx.clearRect(0, 0, CW, CH);
    // the plate
    roundedPath(ctx, 1, 1, CW - 2, CH - 2, 8);
    ctx.fillStyle = COLORS.voidBlack;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    // the rarity trim: an outer stroke and an inset echo
    ctx.strokeStyle = trim;
    ctx.lineWidth = 1.5;
    roundedPath(ctx, 1.5, 1.5, CW - 3, CH - 3, 8);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    roundedPath(ctx, 4.5, 4.5, CW - 9, CH - 9, 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // the art well
    const artTop = Math.round(CH * 0.16);
    const artH = Math.round(CH * 0.3);
    ctx.fillStyle = COLORS.accent;
    ctx.globalAlpha = 0.06;
    ctx.fillRect(8, artTop, CW - 16, artH);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = COLORS.border;
    ctx.strokeRect(8.5, artTop + 0.5, CW - 17, artH - 1);
    ctx.globalAlpha = 1;
    // the gem socket (the cost number rides it as text)
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.voidBlack;
    ctx.fill();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // the divider under the name band
    const divY = artTop + artH + (this.cardSize === 'full' ? 44 : 38);
    ctx.strokeStyle = COLORS.dividerDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, divY + 0.5);
    ctx.lineTo(CW - 12, divY + 0.5);
    ctx.stroke();
    this._art.texture.needsUpdate = true;
    (this.engine ?? null)?.requestRender();
  }

  disposeSelf() {
    this._art.texture.dispose();
  }
}

// ---------------- HandFan ----------------
// The fan owns PRESENTATION (arc layout, lift, flight); the game owns the MODEL.
// THE AIM LAW ("highlight the monster nearest the card"):
// while a drag stands over the BOARD (above the fan line, no occluding chrome),
// the fan aims at the NEAREST registered target by center distance —
// `targetchange {card, onto, prev}` narrates every re-seat (onto null over the
// fan zone or over chrome) so consumer chrome can light the aimed plate — and
// the release commits loud `play {card, onto}` with the AIMED target (`onto` =
// the aimed node or null; the event plane owns `target`). A release over
// occluding chrome or back in the fan zone cancels home; if the consumer's
// handler leaves the card in the fan, it flies home (an unclaimed play bounces).

export class HandFan extends UINode {
  // opts: { cards = [], maxWidth = 560, lift = 20, arc = 14, onPlay }
  constructor(opts = {}) {
    super({ interactive: true });
    const eng = requireEngine();
    this.touchDragOwner = true; // card gestures never pan a host surface
    const mw = Number(opts.maxWidth);
    this.maxWidth = Number.isFinite(mw) ? Math.max(CARD_SIZES.hand.w + 20, mw) : 560;
    const lift = Number(opts.lift);
    this.lift = Number.isFinite(lift) ? Math.max(0, lift) : 20;
    const arc = Number(opts.arc);
    this.arc = Number.isFinite(arc) ? Math.max(0, arc) : 14;
    this.onPlay = opts.onPlay ?? null;
    this.cards = [];
    this._targets = [];
    this._gesture = null;
    this._hover = null;
    this._offCardDispose = null;
    this.setSize(this.maxWidth, CARD_SIZES.hand.h + this.lift + this.arc + 8);

    // the opening hand seats instantly: detached nodes have no layout world yet,
    // and the frozen/census boots demand a settled fan on frame one
    for (const c of opts.cards ?? []) this.addCard(c, { animate: false });

    // gesture plumbing lives on the bus for the drag's whole life (guarded when idle)
    this._offs = [
      eng.bus.on('pointermove', (e) => this._onMove(e)),
      eng.bus.on('pointerup', (e) => this._onUp(e, false)),
      eng.bus.on('pointercancel', (e) => this._onUp(e, true)),
      // B7: Escape cancels a live gesture — presses blur focus, so the key
      // arrives on the bus plane (the EldDragDrop funnel)
      eng.bus.on('keydown', (e) => {
        if (e.key === 'Escape' && this._gesture) {
          this._cancelGesture();
          e.native?.preventDefault?.();
        }
      }),
    ];
  }

  // Nodes a release may land on (enemy plates, the play zone chrome). The page
  // re-lights its own targets off `dragstart`/`dragend` — consumer chrome,
  // consumer truth (the NodeGraph philosophy).
  setTargets(nodes) {
    this._targets = [...(nodes ?? [])];
    return this;
  }

  // `from: {x, y}` (engine coords — the removeCard `to` convention) seats the card
  // there first, so the reflow tween reads as a DEAL from the mound; `animate`
  // tweens the whole fan's reflow (collapses under reducedMotion / detached).
  addCard(card, { from = null, animate = true } = {}) {
    if (!card || card.disposed || this.cards.includes(card)) return this;
    this.cards.push(card);
    this.add(card);
    card._fanOwner = this;
    // a card that cycles back in (discard -> reshuffle -> redraw) is already wired;
    // the handlers delegate to _fanOwner, so a card changing fans follows its owner
    if (!card._fanWired) {
      card._fanWired = true;
      card.auditAllow('overlap'); // fan overlap is the LAYOUT, declared by its owner
      this._wireCard(card);
    }
    if (from && this.engine && !isReducedMotion()) {
      const s = this.worldScale || 1;
      card.setPos(
        Math.round((from.x - this.worldX) / s - card.w / 2),
        Math.round((from.y - this.worldY) / s - card.h / 2));
    }
    this._layoutFan(animate);
    return this;
  }

  // Removes from the fan; the consumer holds the card's fate unless `dispose` is
  // asked for. `to: {x, y}` flings the card there (engine coords) first — with
  // `dispose: true` the card dies when the fling lands (the discard flow).
  removeCard(card, { to = null, dispose = false, animate = true } = {}) {
    const i = this.cards.indexOf(card);
    if (i === -1) return this;
    this.cards.splice(i, 1);
    if (card._fanOwner === this) card._fanOwner = null;
    if (this._hover === card) this._hover = null;
    if (this._gesture?.card === card) this._cancelGesture({ skipHome: true });
    const eng = widgetsEngine();
    if (to && eng && !isReducedMotion()) {
      const lx = (to.x - this.worldX) / (this.worldScale || 1) - card.w / 2;
      const ly = (to.y - this.worldY) / (this.worldScale || 1) - card.h / 2;
      eng.ticker.tween(card, { x: lx, y: ly, fxOpacity: 0 }, {
        dur: 0.18,
        onDone: () => {
          if (card.disposed) return;
          if (dispose) { card.dispose(); return; }
          if (card.parent === this) this.remove(card);
          card.fxOpacity = 1;
        },
      });
    } else if (dispose) card.dispose();
    else this.remove(card);
    this._layoutFan(animate); // the survivors reflow on the house tween
    return this;
  }

  _wireCard(card) {
    card.on('pointerdown', (e) => {
      const fan = card._fanOwner;
      if (!fan || fan.disposed) return;
      if (e.button != null && e.button !== 0) return;
      // C3: one gesture, one pointer — a second finger's press is DEAF
      if (fan._gesture) return;
      if (fan.closest((n) => n.disabled === true)) return;
      e.stopPropagation?.();
      fan._gesture = {
        pointerId: e.pointerId ?? null,
        x0: e.x, y0: e.y, card, dragging: false,
        home: { x: card._fanX ?? card.x, y: card._fanY ?? card.y },
      };
      // B4: the card disposing mid-gesture cancels — a release after that would
      // fly a corpse
      fan._offCardDispose?.();
      fan._offCardDispose = card.on('dispose', () => fan._cancelGesture({ skipHome: true }));
    });
    // only a FLYING drag suppresses hover — a pre-threshold pending must not (the
    // EldDragDrop model: isDragging gates chrome, isPending never does; a synthetic
    // press whose release skips the bus would otherwise wedge the whole fan)
    card.on('pointerenter', () => {
      const fan = card._fanOwner;
      if (!fan || fan.disposed || fan._gesture?.dragging) return;
      if (fan.closest((n) => n.disabled === true)) return;
      fan._setHover(card);
    });
    card.on('pointerleave', () => {
      const fan = card._fanOwner;
      if (!fan || fan.disposed || fan._gesture?.dragging) return;
      if (fan._hover === card) fan._setHover(null);
    });
  }

  _ownsGesture(e) {
    const pid = this._gesture?.pointerId;
    return pid == null || e.pointerId == null || e.pointerId === pid;
  }

  _onMove(e) {
    const g = this._gesture;
    if (!g || !this._ownsGesture(e)) return;
    if (!g.dragging) {
      if (Math.hypot(e.x - g.x0, e.y - g.y0) <= METRICS.dragThreshold) return;
      g.dragging = true;
      this.add(g.card); // the flying card rides the top of the fan's paint order
      g.card.fxOpacity = 0.85;
      uisound(g.card, 'pickup');
      this.dispatch('dragstart', { card: g.card });
    }
    const ws = this.worldScale || 1;
    g.card.setPos(
      Math.round((e.x - this.worldX) / ws - g.card.w / 2),
      Math.round((e.y - this.worldY) / ws - g.card.h / 2));
    // THE AIM LAW: the nearest target over the board is the aim, narrated on
    // every re-seat so the consumer can light the aimed plate (consumer chrome,
    // consumer truth — the page re-lights off this event)
    const aim = this._aimAt(e.x, e.y);
    if (aim !== (g.aim ?? null)) {
      const prev = g.aim ?? null;
      g.aim = aim;
      this.dispatch('targetchange', { card: g.card, onto: aim, prev });
    }
  }

  _onUp(e, canceled) {
    const g = this._gesture;
    if (!g || !this._ownsGesture(e)) return;
    this._offCardDispose?.();
    this._offCardDispose = null;
    this._gesture = null;
    if (!g.dragging) return; // the still-finger click path: the fan has no click verb
    g.card.fxOpacity = 1;
    if (canceled) {
      this._flyHome(g.card, g.home);
      this.dispatch('dragend', { card: g.card, canceled: true, played: false });
      return;
    }
    // the release re-derives the aim at the landing point — one oracle for the
    // narration and the commit (chrome may have moved between the last move and
    // the up; the highlight is presentation, the oracle is law)
    const aim = this._aimAt(e.x, e.y);
    const overBoard = !this._chromeAt(e.x, e.y) && e.y < this.worldY - 6; // above the fan line = the board
    if (overBoard) {
      // the AIMED node rides as `onto` — the event plane OWNS `target` (dispatch
      // stamps the emitting node there, the DOM convention)
      commitChange(this, 'play', { card: g.card, onto: aim }, false,
        this.onPlay ? (_v, ev) => this.onPlay(ev, ev) : null);
      if (this.cards.includes(g.card)) this._flyHome(g.card, g.home); // unclaimed: bounce
      this.dispatch('dragend', { card: g.card, canceled: false, played: !this.cards.includes(g.card) });
    } else {
      this._flyHome(g.card, g.home);
      this.dispatch('dragend', { card: g.card, canceled: false, played: false });
    }
    this._layoutFan();
  }

  _cancelGesture({ skipHome = false } = {}) {
    const g = this._gesture;
    if (!g) return;
    this._offCardDispose?.();
    this._offCardDispose = null;
    this._gesture = null;
    if (g.card.disposed) return;
    g.card.fxOpacity = 1;
    if (!skipHome && g.dragging) this._flyHome(g.card, g.home);
    if (g.dragging) this.dispatch('dragend', { card: g.card, canceled: true, played: false });
  }

  // The aim oracle: null unless the point stands over the open board (above the
  // fan line, no occluding chrome), else the nearest live target by CENTER
  // distance to the POINTER — the dragged card rides pointer-centered (see
  // _onMove), so the pointer IS the card's center ("nearest the
 // card" ruling); the card node's own world seat lags a layout pass mid-drag.
  _aimAt(x, y) {
    if (!this._targets.length) return null;
    if (y >= this.worldY - 6) return null; // the fan zone: no aim
    if (this._chromeAt(x, y)) return null; // C10: chrome occludes the board
    let best = null;
    let bestD = Infinity;
    for (const t of this._targets) {
      if (!t || t.disposed || !t._visible) continue;
      if (t.closest((n) => n.disabled === true)) continue;
      const d = Math.hypot(t.worldX + t.w / 2 - x, t.worldY + t.h / 2 - y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  // C10: chrome OCCLUDES the board — a point over a window or dropdown surface
  // is off the board entirely (the EldDragDrop occlusion rule). A registered
  // target still answers when it IS the topmost chain.
  _chromeAt(x, y) {
    const eng = widgetsEngine();
    const top = eng ? hitTest(eng, x, y) : null;
    if (!top) return false;
    const topRoot = top.closest((n) => !n.parent);
    if (topRoot !== eng.layers.windows && topRoot !== eng.layers.dropdown) return false;
    for (const t of this._targets) {
      if (t && !t.disposed && (t === top || t.isAncestorOf?.(top))) return false;
    }
    return true;
  }

  _flyHome(card, home) {
    const eng = widgetsEngine();
    if (!eng || isReducedMotion()) {
      card.setPos(home.x, home.y);
      return;
    }
    eng.ticker.cancelPropTween(card, 'x');
    eng.ticker.cancelPropTween(card, 'y');
    eng.ticker.tween(card, { x: home.x, y: home.y }, { dur: 0.16 });
  }

  // Lift a card as though the pointer were on it — the public verb for a game that
  // wants to highlight a card it chose (a tutorial pointing at the play, an AI
  // preview, a `?pose=` review hook). Pass null to drop the lift. Ignores anything
  // that is not in this fan, so it can never desync the arc.
  setHover(card) {
    if (card != null && !this.cards.includes(card)) return this;
    this._setHover(card ?? null);
    return this;
  }

  _setHover(card) {
    if (this._hover === card) return;
    const prev = this._hover;
    this._hover = card;
    if (card) this.add(card); // the lifted card reads whole over its neighbors
    const eng = widgetsEngine();
    // a FIRST-FRAME kick so the pointer's arrival answers instantly (an accepted
    // walker channel), while the lift itself rides the house tween below — the
    // states walker settles tweens 0.3s before sampling, so animated hover is legal;
    // only reducedMotion demands the instant full lift (the suites' contract)
    if (card && eng && !isReducedMotion()) {
      card.fxScale = 1.04;
      eng.ticker.tween(card, { fxScale: 1 }, { dur: 0.14 });
    } else if (prev && eng) {
      eng.ticker.cancelPropTween(prev, 'fxScale');
      prev.fxScale = 1;
    }
    // the lift + neighbor-part ANIMATE (0.12s); _applyPositions collapses to a
    // snap under reducedMotion, which keeps the instant-full-lift asserts green
    this._applyPositions(true);
  }

  // The arc: spacing resolves overlap into the width budget; the hovered card
  // lifts and its neighbors part to breathe.
  _layoutFan(animate = false) {
    this._applyPositions(animate);
    this.invalidateLayout();
  }

  _applyPositions(animate) {
    const n = this.cards.length;
    if (!n) return;
    const CW = CARD_SIZES.hand.w;
    // the cap used to be CW * 0.72, which forced a 28% overlap even when the
    // width budget had room to spare - a FIVE card hand at maxWidth 560 buried every
    // name behind its neighbour ("Lantern Oa...", "Drowning G..."), which is a
    // readability defect, not a fan. A hand fan compresses when it is CROWDED; with
    // room it separates. The cap is now one card plus a hair of air, so the budget
    // is what decides, and a twelve-card hand still overlaps hard because it must.
    const spacing = n === 1 ? 0 : Math.min(CW + 8, (this.maxWidth - CW) / (n - 1));
    const total = CW + spacing * (n - 1);
    const x0 = (this.w - total) / 2;
    const hi = this._hover ? this.cards.indexOf(this._hover) : -1;
    const eng = widgetsEngine();
    this.cards.forEach((card, i) => {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      let x = x0 + i * spacing;
      let y = this.lift + this.arc * t * t;
      if (hi !== -1) {
        if (i === hi) y -= this.lift;
        else if (i === hi - 1 || i === hi + 1) x += (i < hi ? -1 : 1) * Math.min(14, spacing * 0.35);
      }
      x = Math.round(x); y = Math.round(y);
      card._fanX = x; card._fanY = y;
      if (this._gesture?.card === card && this._gesture.dragging) {
        this._gesture.home = { x, y }; // a mid-drag relayout retargets home
        return;
      }
      if (!animate || !eng || isReducedMotion()) {
        eng?.ticker.cancelPropTween(card, 'x');
        eng?.ticker.cancelPropTween(card, 'y');
        card.setPos(x, y);
      } else {
        eng.ticker.cancelPropTween(card, 'x');
        eng.ticker.cancelPropTween(card, 'y');
        eng.ticker.tween(card, { x, y }, { dur: 0.12 });
      }
    });
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  disposeSelf() {
    if (this._offs) { for (const off of this._offs) off(); this._offs = null; }
    this._offCardDispose?.();
    this._offCardDispose = null;
    this._gesture = null;
  }
}

// ---------------- Pile ----------------
// A mound of card DEFS (plain objects — nodes are built only to browse). The count
// badge is painted; click/Enter browses a Window of inert Cards; Escape or a second
// activation closes it. push/pop are the model verbs and speak `pilechange`.

export class Pile extends UINode {
  // opts: { kind = 'draw' | 'discard', label, cards = [], browse = true, onChange }
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    this.kind = opts.kind === 'discard' ? 'discard' : 'draw';
    this.label = String(opts.label ?? (this.kind === 'draw' ? 'Draw' : 'Discard'));
    this.browse = opts.browse !== false;
    this.onChange = opts.onChange ?? null;
    this._cards = Array.isArray(opts.cards) ? [...opts.cards] : [];
    this._win = null;
    this._offEscape = null;

    const W = 64, H = 92;
    this._art = createCanvasTexture(W, H, texScale());
    this._quad = new QuadNode({ texture: this._art.texture });
    this.add(this._quad);
    this.countText = new TextNode('', {
      font: FONTS.mono, size: 12, weight: 'bold', color: COLORS.textWhite, shadow: SHADOW,
    });
    this.countText.auditAllow('containment', 'overlap');
    this.labelText = new TextNode(this.label, {
      font: FONTS.header, size: 10, smallCaps: true, letterSpacing: 1,
      color: COLORS.textMuted, shadow: SHADOW, align: 'center', maxWidth: W + 20, ellipsis: true,
    });
    this.add(this.countText, this.labelText);
    this.setSize(W, H + 14);

    this.focusable = true;
    this.onActivate = () => this._toggleBrowse();
    this.on('click', (e) => {
      if (this.closest((n) => n.disabled === true)) { e.stopPropagation?.(); return; }
      this._toggleBrowse();
    });
    this.on('pointerenter', () => {
      if (this.closest((n) => n.disabled === true)) return;
      this.fxOpacity = 0.9;
    });
    this.on('pointerleave', () => { this.fxOpacity = 1; this.fxScale = 1; });
    // pressed is mandatory — the mound dips underhand (snap, motion-free)
    this.on('pointerdown', () => {
      if (this.closest((n) => n.disabled === true)) return;
      this.fxScale = 0.96;
    });
    this.on('pointerup', () => { this.fxScale = 1; });
    this._paint();
  }

  get count() { return this._cards.length; }
  get cards() { return [...this._cards]; }

  setCards(defs, { silent = true } = {}) {
    this._cards = Array.isArray(defs) ? [...defs] : [];
    this._refresh(silent, 'set');
    return this;
  }

  push(def, { silent = true } = {}) {
    if (def != null) {
      this._cards.push(def);
      this._refresh(silent, 'push');
    }
    return this;
  }

  pop({ silent = true } = {}) {
    if (!this._cards.length) return null;
    const def = this._cards.pop();
    this._refresh(silent, 'pop');
    return def;
  }

  _refresh(silent, action) {
    this._paint();
    commitChange(this, 'pilechange', { count: this._cards.length, action }, silent,
      this.onChange ? (_v, e) => this.onChange(e, e) : null);
  }

  _toggleBrowse() {
    if (this._win) { this.closeBrowse(); return; }
    if (!this.browse || !this._cards.length) return;
    const eng = widgetsEngine();
    if (!eng) return;
    const defs = [...this._cards];
    // C6 said "a deep mound must not tower a window off-screen" and capped the browse at
    // twelve cards in a THREE-wide grid. Three wide is four rows, and four rows of
    // 126x176 cards is a 432x790 window — taller than the 665px viewport it has to fit
    // in. It was positioned at y=8 and ran off the bottom of the screen with its cards
    // clipped, which is why it read as a frame smaller than the cards inside it.
    //
    // The cap has to come from the ROOM AVAILABLE, not from a number someone picked. The
    // grid is as wide as the viewport allows and as deep as it allows, the cards stay
    // full size because a browse you cannot read is pointless, and the remainder is named
    // exactly as before.
    const CW = CARD_SIZES.hand.w, CH = CARD_SIZES.hand.h;
    const maxW = Math.max(CW + 24, eng.width - 80);
    const maxH = Math.max(CH + 66, eng.height - 80);
    const perRow = Math.max(1, Math.min(defs.length, Math.floor((maxW - 24) / (CW + 10))));
    const maxRows = Math.max(1, Math.floor((maxH - 66) / (CH + 10)));
    const shown = defs.slice(0, perRow * maxRows);
    const rows = Math.max(1, Math.ceil(shown.length / perRow));
    const more = defs.length - shown.length;
    const win = new Window({
      title: `${this.label} (${defs.length})`,
      width: 24 + perRow * (CW + 10),
      height: 46 + rows * (CH + 10) + (more > 0 ? 20 : 0),
      onClose: () => this.closeBrowse(), // the header X funnels through the one exit
      content: (c) => {
        shown.forEach((def, i) => {
          const card = new Card({ ...def, size: 'hand' });
          card.interactive = false; // browse cards are exhibits, not gestures
          card.setPos(10 + (i % perRow) * (CW + 10), 6 + Math.floor(i / perRow) * (CH + 10));
          c.add(card);
        });
        if (more > 0) {
          const t = new TextNode(str('pileMoreCards', more), {
            size: 11, color: COLORS.textMuted, shadow: SHADOW,
          });
          t.setPos(10, 8 + rows * (CH + 10));
          c.add(t);
        }
      },
    });
    win.setPos(
      Math.round(Math.max(8, (eng.width - win.w) / 2)),
      Math.round(Math.max(8, (eng.height - win.h) / 2)));
    // C5: windows live in the WINDOWS band (the EldWindow.open home) — above the
    // board, below dropdown/overlay chrome, so a Select inside one still drops OVER it
    eng.layers.windows.add(win);
    this._win = win;
    this._offEscape = eng.focus.pushEscape(() => this.closeBrowse());
    uisound(this, 'open');
    this.dispatch('browse', { count: defs.length });
  }

  closeBrowse() {
    if (!this._win) return this;
    this._offEscape?.();
    this._offEscape = null;
    const w = this._win;
    this._win = null;
    if (!w.disposed) w.dispose();
    uisound(this, 'close');
    return this;
  }

  _paint() {
    const { ctx } = this._art;
    const W = 64, H = 92;
    ctx.clearRect(0, 0, W, H);
    const n = this._cards.length;
    // the mound: up to three offset backs, drawn deepest first
    const backs = Math.max(1, Math.min(3, n));
    for (let i = backs - 1; i >= 0; i--) {
      const ox = i * 3, oy = i * 3;
      roundedPath(ctx, 2 + ox, 2 + oy, W - 10, H - 14, 6);
      ctx.fillStyle = COLORS.voidBlack;
      ctx.globalAlpha = n === 0 ? 0.35 : 0.92;
      ctx.fill();
      ctx.globalAlpha = n === 0 ? 0.4 : 1;
      ctx.strokeStyle = i === 0 ? COLORS.accent : COLORS.border;
      ctx.lineWidth = i === 0 ? 1.5 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // the back sigil: a spiral of ticks (deterministic, the summoning-circle kin)
    if (n > 0) {
      ctx.strokeStyle = COLORS.accent;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      const cx = 2 + (W - 10) / 2, cy = 2 + (H - 14) / 2;
      for (let i = 0; i < 10; i++) {
        const a = i * 0.63, r = 4 + i * 2.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a + 0.5) * (r + 2), cy + Math.sin(a + 0.5) * (r + 2));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // the count chip
    ctx.beginPath();
    ctx.arc(W - 13, H - 13, 11, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.voidBlack;
    ctx.fill();
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this._art.texture.needsUpdate = true;
    this.countText?.setText(String(n));
    this.invalidateLayout();
    (this.engine ?? null)?.requestRender();
  }

  onLayout() {
    this._quad.setRect(0, 0, 64, 92);
    this.countText.setPos(Math.round(51 - this.countText.w / 2), Math.round(79 - this.countText.h / 2));
    this.labelText.setPos(Math.round((this.w - this.labelText.w) / 2), 94);
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  disposeSelf() {
    this.closeBrowse();
    this._art.texture.dispose();
  }
}

// ---------------- RunMap ----------------
// The roguelike floor map, re-cut in the talent language: floors climb
// BOTTOM-UP (floor 0 at the bottom); `requires` carries the path edges upward.
// Reachability derives from the CURRENT position — the traveled set and the
// standing position wear the GILT (`graphnode.maxed`, the ring marks where you
// stand), forward doors read green `available`, everything else grey `locked`;
// the arrows on the own-raster underlay run gold along the traveled path and
// verdigris toward the open doors. Clicking an open door commits a loud
// `advance` — the run MODEL (fights, shops, rewards) belongs to the consumer.
// Plates are TalentPlates (imported directly from talents.js, not the barrel);
// their right-clicks are NOT consumed, so the radial chain may answer over the
// map. `getState(id)` reads owned | available | locked (the `.graph` window
// into the old core is gone with the core).

export class RunMap extends UINode {
  // opts: { data: { nodes: [{id, icon, floor|rank, requires: []}] }, position = null,
  //         width = 520, height = 420, plateSize = 52, floorGap = 46, colGap = 42,
  //         floorLabels = null (array | (floor) => string), onAdvance = null }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this._plate = Number.isFinite(opts.plateSize) ? Math.max(24, opts.plateSize) : 52;
    this._floorGap = Number.isFinite(opts.floorGap) ? opts.floorGap : 46;
    this._colGap = Number.isFinite(opts.colGap) ? opts.colGap : 42;
    this._floorLabels = opts.floorLabels ?? null;
    this.onAdvance = opts.onAdvance ?? null;
    this.surface = null;
    this.position = null;
    this.visited = new Set();
    this._plates = new Map();
    this._arrowRevision = 0;
    this._arrows = null;
    this._arrowQuad = null;
    this.setSize(
      Number.isFinite(opts.width) ? opts.width : 520,
      Number.isFinite(opts.height) ? opts.height : 420);
    this.setData(opts.data ?? { nodes: [] }, { position: opts.position ?? null });
  }

  _floorLabel(floor, index) {
    if (Array.isArray(this._floorLabels)) return this._floorLabels[index] ?? String(floor + 1);
    if (typeof this._floorLabels === 'function') return String(this._floorLabels(floor));
    return str('runFloor', floor + 1);
  }

  // A fresh dataset rebuilds surface + plates wholesale (the skin pattern).
  setData(data, { position = null } = {}) {
    this._nodes = [];
    for (const n of data?.nodes ?? []) {
      if (n?.id == null) continue;
      this._nodes.push({
        id: String(n.id),
        icon: n.icon ?? 'book',
        floor: Number.isFinite(n.floor) ? n.floor : Number.isFinite(n.rank) ? n.rank : 0,
        requires: (n.requires ?? []).map(String),
      });
    }
    this._byId = new Map(this._nodes.map((n) => [n.id, n]));
    this.visited = new Set();
    this.position = position != null && this._byId.has(String(position)) ? String(position) : null;

    const floors = new Map();
    for (const n of this._nodes) {
      if (!floors.has(n.floor)) floors.set(n.floor, []);
      floors.get(n.floor).push(n);
    }
    const sorted = [...floors.entries()].sort((a, b) => a[0] - b[0]);
    const S = this._plate;
    const stepX = S + this._colGap;
    const stepY = S + this._floorGap;
    const widest = sorted.reduce((m, [, list]) => Math.max(m, list.length), 1);
    const PAD = 60;
    const planeW = Math.max(this.w, widest * stepX + PAD * 2);
    const planeH = Math.max(this.h, sorted.length * stepY + PAD * 2 - this._floorGap);
    const maxIdx = sorted.length - 1;
    sorted.forEach(([, list], fi) => {
      list.forEach((n, i) => {
        n.x = Math.round(planeW / 2 + (i - (list.length - 1) / 2) * stepX);
        n.y = Math.round(PAD + (maxIdx - fi) * stepY + S / 2);
      });
    });

    for (const p of this._plates.values()) p.dispose();
    this._plates.clear();
    if (this._arrowQuad) { this._arrowQuad.dispose(); this._arrowQuad = null; }
    if (this._arrows) { this._arrows.texture.dispose(); this._arrows = null; }
    if (this._labels) this._labels.dispose();
    if (this.surface) this.surface.dispose();
    this.surface = new PanZoomSurface({ planeW, planeH, zoom: 1, minZoom: 0.4, maxZoom: 2.5 });
    this.add(this.surface);
    // the arrow underlay first — plates paint over it; raster capped like every
    // large own-raster (the 2048 device-px long-side law)
    this._planeW = planeW; this._planeH = planeH;
    const scale = Math.min(texScale(), 2048 / Math.max(planeW, planeH));
    this._arrows = createCanvasTexture(planeW, planeH, scale);
    this._arrowQuad = new QuadNode({ texture: this._arrows.texture });
    this._arrowQuad.setRect(0, 0, planeW, planeH);
    this.surface.add(this._arrowQuad);
    for (const n of this._nodes) {
      const plate = new TalentPlate({
        id: n.id, icon: n.icon, size: S,
        getArt: () => {
          const s = this.getState(n.id);
          return s === 'owned' ? 'maxed' : s; // the traveled set wears the gilt
        },
        getBadge: () => null,
        tooltip: () => {
          const d = abilityData(n.icon);
          return { title: d.name, desc: d.desc, flavor: d.flavor };
        },
        onClick: () => {
          if (this.disabled) return;
          if (this.getState(n.id) !== 'available') { uisound(this, 'error'); return; }
          this._advance(n.id);
        },
        // NO onRightClick: the map does not consume — the radial chain may answer
      });
      plate.setPos(Math.round(n.x - S / 2), Math.round(n.y - S / 2));
      this._plates.set(n.id, plate);
      this.surface.add(plate);
    }
    // floor labels ride the plane's left rail (the era-label pattern)
    this._labels = new UINode({ name: 'floor-labels' });
    sorted.forEach(([floor], fi) => {
      const t = new TextNode(this._floorLabel(floor, fi), {
        font: FONTS.header, size: 12, smallCaps: true, letterSpacing: 2,
        color: COLORS.bone, shadow: SHADOW,
      });
      t.setPos(14, Math.round(PAD + (maxIdx - fi) * stepY + S / 2 - t.h / 2));
      this._labels.add(t);
    });
    this.surface.add(this._labels);

    this._rederive();
    const cur = this.position ? this._byId.get(this.position) : null;
    this.surface.centerOn(planeW / 2, cur ? cur.y : planeH - PAD);
    this.invalidateLayout();
    return this;
  }

  // owned (traveled or standing) | available (a forward door) | locked
  getState(id) {
    const n = this._byId.get(String(id));
    if (!n) return null;
    if (this.visited.has(n.id) || n.id === this.position) return 'owned';
    if (this.position == null) {
      const minFloor = this._nodes.reduce((m, x) => Math.min(m, x.floor), Infinity);
      return n.floor === minFloor ? 'available' : 'locked';
    }
    return n.requires.includes(this.position) ? 'available' : 'locked';
  }

  _advance(id) {
    if (this.position != null) this.visited.add(this.position);
    this.position = String(id);
    this._rederive();
    const n = this._byId.get(this.position);
    commitChange(this, 'advance', { id: this.position, floor: n?.floor ?? 0 }, false,
      this.onAdvance ? (_v, e) => this.onAdvance(e, e) : null);
  }

  // Programmatic position (load/restore). Silent by default; the click path is loud.
  setPosition(id, { silent = true } = {}) {
    const key = id == null ? null : String(id);
    if (key != null && !this._byId.has(key)) return this;
    if (key === this.position) return this;
    if (this.position != null) this.visited.add(this.position);
    this.position = key;
    this._rederive();
    if (!silent && key != null) {
      const n = this._byId.get(key);
      commitChange(this, 'advance', { id: key, floor: n?.floor ?? 0 }, false, null);
    }
    return this;
  }

  _rederive() {
    for (const [id, p] of this._plates) {
      p._refresh();
      p.setRing(id === this.position); // the ring marks where you STAND
    }
    this._redrawArrows();
  }

  // Straight shafts with heads, the direction of travel: gold along the traveled
  // path, verdigris from the standing position to its open doors, stone-quiet
  // elsewhere. One repaint per derivation, never per frame.
  _redrawArrows() {
    if (!this._arrows) return;
    const { ctx } = this._arrows;
    ctx.clearRect(0, 0, this._planeW, this._planeH);
    const half = this._plate / 2;
    const traveled = new Set(this.position == null ? [] : [...this.visited, this.position]);
    for (const n of this._nodes) {
      for (const r of n.requires) {
        const from = this._byId.get(r);
        if (!from) continue;
        const onPath = traveled.has(from.id) && traveled.has(n.id);
        const invites = from.id === this.position && this.getState(n.id) === 'available';
        ctx.strokeStyle = onPath ? COLORS.talentGold : invites ? COLORS.accent : COLORS.border;
        ctx.lineWidth = onPath || invites ? 3 : 2;
        ctx.shadowColor = onPath ? COLORS.talentGoldGlow : invites ? COLORS.accentGlow : 'rgba(0,0,0,0)';
        ctx.shadowBlur = onPath || invites ? 5 : 0;
        const dx = n.x - from.x;
        const dy = n.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const x0 = from.x + ux * (half + 2), y0 = from.y + uy * (half + 2);
        const x1 = n.x - ux * (half + 2), y1 = n.y - uy * (half + 2);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1 - ux * 7 - uy * 4, y1 - uy * 7 + ux * 4);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x1 - ux * 7 + uy * 4, y1 - uy * 7 - ux * 4);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    this._arrows.texture.needsUpdate = true;
    this._arrowRevision++;
    widgetsEngine()?.requestRender();
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    if (this.surface) this.surface.setRect(0, 0, this.w, this.h);
  }

  disposeSelf() {
    if (this._arrows) { this._arrows.texture.dispose(); this._arrows = null; }
  }
}

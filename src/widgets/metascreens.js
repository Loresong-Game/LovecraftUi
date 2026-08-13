// Thresholds: the meta-screens kit — every game's first and last five
// minutes out of the box. MenuList/MenuScreen (big stone menus, WRAPPED keyboard/
// gamepad walking, submenu push/pop riding the Escape stack, transitions),
// TitleCard (queued area/turn/round banners: entrance, hold, exit), SaveSlotList
// (slot cards with timestamps, playtime, a procedural-thumbnail painter hook, and
// delete-with-confirm), LevelSelectGrid (locked/open/done plates with star rows and
// paging), and CreditsScroller (auto-scroll, speed, skip). Thumbnails and nothing
// else are the widgets' own canvas rasters (the ArcGauge recipe) — disposed with
// their cards; every other pixel comes from the registry.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { ClipRegion } from '../clip.js';
import { clamp, contentRect } from '../layout.js';
import { VBox } from '../layoutbox.js';
import { commitChange, setNodeDisabled, requireEngine, widgetsEngine, uisound, Button, EldTooltip } from './widgets.js';
import { EldPopup } from './windows.js';
import { animateIn, animateOut, stagger, isReducedMotion } from '../animate.js';
import { str } from '../strings.js';

const frame = (n) => requireEngine().textures.frame(n);
const tex = (n) => requireEngine().textures.get(n);
const SHADOW = METRICS.textShadow; // X02: the shared token (was a per-file literal)

// ---------------- MenuList ----------------
// One focus stop; Up/Down WRAP around the enabled rows (menus circle, unlike form
// strips), Enter/gamepad-A selects, pointer hover moves the highlight. Rows are big
// stone buttons; disabled rows dim and the walk skips them.

const MENU_ROW_H = 46;
const MENU_GAP = 8;

export class MenuList extends VBox {
  // opts: { items: [{ label, onSelect, disabled }], width = 320 }
  // the list IS a VBox — rows stack with the box's gap and stretch to the
  // list's width; each row centers its own label (the press-shift included).
  constructor(opts = {}) {
    super({ interactive: true, gap: MENU_GAP, align: 'stretch', autoWidth: false, autoHeight: true });
    this.focusable = true;
    this.items = opts.items ?? [];
    this.index = -1;
    this._rows = [];
    const w = opts.width ?? 320;
    this.items.forEach((item, i) => {
      const row = new UINode({ interactive: true });
      const bg = new NineSliceNode(frame('button.normal'));
      const label = new TextNode(item.label, {
        font: FONTS.header, size: 16, smallCaps: true, letterSpacing: 2,
        color: item.disabled ? COLORS.textMuted : COLORS.accent, shadow: SHADOW,
      });
      // the SELECTED row already wears the hover face, so entering IT would
      // read silent — the wash channel carries that case (the checked-Toggle rule)
      const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      wash.auditAllow('overlap', 'containment'); // interaction-state art at the widget
      // A LOCKED ROW WEARS A PADLOCK. A dimmed label plus a hover tooltip is not an
      // affordance: on a dark stone button, muted-vs-accent is nearly invisible, and a
      // reason you must hover for and WAIT for is a reason nobody reads. A user hit
      // exactly this on narrative.html — "Burn the ledger" is deliberately locked until
      // Sanity passes 65, and it read as a button that simply did not work.
      const lock = new QuadNode({ texture: tex('lock.locked') });
      lock.visible = !!item.disabled;
      row.add(bg, label, wash, lock);
      row._bg = bg; row._label = label; row._wash = wash; row._lock = lock;
      row._pressed = false; row._hovered = false;
      row.setSize(w, MENU_ROW_H);
      // hover MOVES THE SELECTION and the selection stays where you left it —
      // menu convention, not a defect; the states walker must not demand rest back.
      // (Hover art itself is live: entering an unselected row visibly re-lights.)
      row.auditAllow('restore');
      row.onLayout = () => {
        bg.setRect(0, 0, row.w, row.h);
        const press = row._pressed ? 2 : 0;
        // the padlock seats inside the BUTTON FRAME's content box, not at a guessed
        // inset — at a flat 14px it spilled the box by 6px (one containment violation)
        const cr = contentRect(bg.frame, row.w, row.h);
        const lockW = lock.visible ? 26 : 0;
        label.setPos(
          Math.round((row.w - lockW - label.w) / 2) + lockW,
          Math.round((MENU_ROW_H - 6 - label.h) / 2) + press);
        lock.setRect(cr.x + 4, Math.round((MENU_ROW_H - 6 - 20) / 2) + press, 20, 20);
      };
      if (!item.disabled) this._wireRow(row, i);
      else this._lockRow(row, i);
      this._rows.push(row);
      this.add(row);
    });
    // width is law; the height is what the VBox derives anyway — setting it exact
    // means the first pass converges to itself (zero-mutation steady state)
    this.setSize(w, Math.max(0, this.items.length * (MENU_ROW_H + MENU_GAP) - MENU_GAP));
    const first = this.items.findIndex((it) => !it.disabled);
    if (first !== -1) this._setIndex(first, false);

    this.onActivate = () => this._select(); // Enter / gamepad-A
    this.on('keydown', (e) => {
      if (this.disabled) return;
      const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      this._walk(d);
    });
    this.on('focus', () => this._paint());
    this.on('blur', () => this._paint());
  }

  // Enabled-row interaction wiring — once per row; a later unlock reuses it, and a
  // RE-lock keeps the handlers but every one guards on the item flag, so locked
  // rows fall silent again without unwiring.
  _wireRow(row, i) {
    if (row._wired) return;
    row._wired = true;
    row.on('pointerenter', () => {
      // a sealed list holds its selection AND stays silent — B10 sealed only the
      // sound; the selection move + menufocus leaked (the partial-seal class)
      if (this.items[i].disabled) return;
      if (this.closest((n) => n.disabled === true)) return;
      row._hovered = true; this._setIndex(i, false); this._paint(); uisound(row, 'hover');
    });
    row.on('pointerleave', () => { row._hovered = false; row._pressed = false; this._paint(); });
    row.on('pointerdown', (e) => {
      if (this.items[i].disabled) return;
      if (this.disabled) { e.stopPropagation(); return; }
      row._pressed = true; this._paint();
    });
    row.on('pointerup', (e) => { row._pressed = false; if (e.canceled) row._hovered = false; this._paint(); }); // canceled ups end dark (B3)
    row.on('click', (e) => {
      if (this.items[i].disabled) return;
      if (this.disabled) { e.stopPropagation(); return; }
      this._setIndex(i, false);
      this._select();
    });
  }

  // A locked row with a `reason` TELLS the player why on hover (a control a
 // viewer can see but never use must explain itself or unlock by play).
  _lockRow(row, i) {
    const item = this.items[i];
    if (item.reason && !row._reasonDetach) {
      row._reasonDetach = EldTooltip.attach(row, () => ({ title: item.label, desc: this.items[i].reason }));
    }
  }

  // Enable/disable an item at runtime — locked choices can UNLOCK by play.
  // Accepts the item's `id` or its index. Speaks nothing itself; callers narrate.
  setItemEnabled(idOrIndex, enabled = true) {
    const i = typeof idOrIndex === 'number'
      ? idOrIndex
      : this.items.findIndex((it) => it.id === idOrIndex);
    const item = this.items[i];
    if (!item || item.disabled === !enabled) return this;
    item.disabled = !enabled;
    const row = this._rows[i];
    if (row._lock) { row._lock.visible = !enabled; row.invalidateLayout(); } // the padlock follows the lock
    if (enabled) {
      row._reasonDetach?.();
      row._reasonDetach = null;
      this._wireRow(row, i);
      if (this.index === -1) this._setIndex(i, false);
    } else {
      row._hovered = false;
      row._pressed = false;
      this._lockRow(row, i);
      if (this.index === i) {
        this.index = -1;
        const first = this.items.findIndex((it) => !it.disabled);
        if (first !== -1) this._setIndex(first, false);
        else this._paint();
      }
    }
    this._paint();
    return this;
  }

  // wrap around the enabled rows — a menu is a circle, not a strip
  _walk(d) {
    const n = this.items.length;
    if (!n) return;
    let i = this.index < 0 ? (d > 0 ? -1 : 0) : this.index;
    for (let step = 0; step < n; step++) {
      i = ((i + d) % n + n) % n;
      if (!this.items[i].disabled) { this._setIndex(i, true); return; }
    }
  }

  _setIndex(i, loud) {
    if (i === this.index) return;
    this.index = i;
    this._paint();
    if (loud) uisound(this._rows[i] ?? this, 'hover');
    this.dispatch('menufocus', { index: i, item: this.items[i] });
  }

  _select() {
    const item = this.items[this.index];
    if (!item || item.disabled) return;
    uisound(this._rows[this.index], 'click');
    this.dispatch('select', { index: this.index, item });
    item.onSelect?.();
  }

  _paint() {
    const focused = this.engine?.focusedNode === this;
    this._rows.forEach((row, i) => {
      const item = this.items[i];
      const lit = i === this.index;
      const state = item.disabled ? 'disabled' : row._pressed ? 'pressed' : lit ? 'hover' : 'normal';
      row._bg.setFrame(frame(`button.${state}`));
      // the wash speaks where the lit face can't: hovering the already-selected row
      // (the LIST-level seal douses too — a parked cursor gets no leave; B1 sweep).
      // closest(): an ANCESTOR seal must douse exactly like the own flag
      row._wash.setBaseOpacity(!this.closest((n) => n.disabled === true) && !item.disabled && lit && row._hovered && !row._pressed ? METRICS.washHover : 0);
      // disabled rows read at textMuted: the disabled token passes on abyss1
      // but 3.93:1 on the slab face — the darker button.disabled frame carries the
      // disabled look, the label stays legible (the surface-fitness lesson)
      row._label.setColor(item.disabled ? COLORS.textMuted : lit && focused ? COLORS.accent : lit ? COLORS.accent : COLORS.textMuted);
    });
    this.invalidateLayout();
  }

  setDisabled(v) { setNodeDisabled(this, v, { dim: false }); this._paint(); }
}

// ---------------- MenuScreen ----------------
// The full-screen menu shell: an abyss scrim glued to the engine, a spaced-caps
// title, and a MenuList — with SUBMENUS: push({title, items}) slides the current
// list out and the new one in (presets; reducedMotion collapses them), and
// every pushed level registers on the Escape stack, so Escape/gamepad-B pops back
// exactly one level (the house one-surface-per-press rule).

export class MenuScreen extends UINode {
  // opts: { title = '', items = [], width = 320, scrimOpacity = 0.88 }
  //
  // `scrimOpacity` exists because the scrim's JOB is not the same in both places this
  // widget is used. Over live gameplay (a pause menu) 0.88 is the point: the world is
  // sealed away and the menu is all there is. But a TITLE screen has nothing behind it
  // to seal — its backdrop IS the game's first impression — and at 0.88 a painted
  // backdrop comes through at twelve percent, which measures as black. The press-
  // swallowing role is unaffected at any value; only the veil thins.
  constructor(opts = {}) {
    super({ interactive: true }); // scrim role: swallows presses beneath
    this.radialItems = () => false; // a menu shell offers no wheel — the radial chain stops at the scrim
    requireEngine();
    // B5 finite-first: a non-numeric opt must not laundered into an opacity uniform
    const veil = Number.isFinite(opts.scrimOpacity) ? clamp(opts.scrimOpacity, 0, 1) : 0.88;
    this.scrim = new QuadNode({ color: COLORS.voidBlack, opacity: veil });
    this.titleText = new TextNode(opts.title ?? '', {
      font: FONTS.header, size: 26, smallCaps: true, letterSpacing: 4, color: COLORS.accent,
      shadow: SHADOW,
    });
    this.add(this.scrim, this.titleText);
    this.on('wheel', (e) => e.stopPropagation()); // scrims consume the wheel too
    this._width = opts.width ?? 320;
    this._stack = [];        // [{ list, title, offEscape }]
    this._root = { title: opts.title ?? '', items: opts.items ?? [] };
    this.list = null;
    this._mount(this._root, false);
  }

  get depth() { return this._stack.length; } // 0 = the root menu

  _mount(spec, animate) {
    const list = new MenuList({ items: spec.items, width: this._width });
    this.add(list);
    this.list = list;
    this.titleText.setText(spec.title ?? '');
    this.invalidateLayout();
    const eng = this.engine ?? widgetsEngine();
    if (eng) eng.focus.set(list, 'api');
    if (animate) animateIn(list, 'stoneSlide');
    return list;
  }

  push(spec) {
    const old = this.list;
    if (old) animateOut(old, 'stoneSlide').then(() => old.dispose());
    const offEscape = (this.engine ?? widgetsEngine())?.focus.pushEscape(() => this.pop()) ?? null;
    this._stack.push({ spec, offEscape });
    this._mount(spec, true);
    uisound(this, 'open');
    return this;
  }

  pop() {
    const top = this._stack.pop();
    if (!top) return this; // at the root: nothing to pop
    top.offEscape?.();
    const old = this.list;
    if (old) animateOut(old, 'stoneSlide').then(() => old.dispose());
    const spec = this._stack.length ? this._stack[this._stack.length - 1].spec : this._root;
    this._mount(spec, true);
    uisound(this, 'close');
    return this;
  }

  disposeSelf() {
    for (const level of this._stack) level.offEscape?.();
    this._stack.length = 0;
  }

  onLayout() {
    if (this.engine) { this.w = this.engine.width; this.h = this.engine.height; } // the veil glue idiom
    this.scrim.setRect(0, 0, this.w, this.h);
    this.titleText.setPos(Math.round((this.w - this.titleText.w) / 2), Math.round(this.h * 0.16));
    if (this.list && !this.list.disposed) {
      this.list.setPos(Math.round((this.w - this.list.w) / 2), Math.round(this.h * 0.16) + 64);
    }
  }
}

// ---------------- TitleCard ----------------
// Queued area/turn/round banners: entrance (fall), hold, exit (rise). One at a
// time; show() returns a promise that resolves when ITS card has left the stage.

export const TitleCard = {
  _queue: [],
  _current: null,

  // spec: { title, subtitle = '', hold = 1.6 }
  show(spec = {}) {
    const eng = widgetsEngine();
    if (!eng) return Promise.resolve();
    return new Promise((resolve) => {
      this._queue.push({ spec, resolve });
      this._drain();
    });
  },

  _drain() {
    if (this._current || !this._queue.length) return;
    const eng = widgetsEngine();
    if (!eng) { // engine died with cards pending: settle everything
      for (const q of this._queue.splice(0)) q.resolve();
      return;
    }
    const { spec, resolve } = this._queue.shift();
    const node = new UINode({ name: 'titlecard' });
    const bg = new NineSliceNode(eng.textures.frame('tooltip.frame'));
    const title = new TextNode(spec.title ?? '', {
      font: FONTS.header, size: 24, smallCaps: true, letterSpacing: 4, color: COLORS.accent,
      align: 'center', fixedW: 480, maxWidth: 480, ellipsis: true, shadow: SHADOW,
    });
    title.setPos(10, 16);
    let h = 16 + title.h + 14;
    node.add(bg, title);
    if (spec.subtitle) {
      const sub = new TextNode(spec.subtitle, {
        size: 13, color: COLORS.textMuted, align: 'center', fixedW: 480,
        maxWidth: 480, ellipsis: true, shadow: SHADOW,
      });
      sub.setPos(10, 16 + title.h + 4);
      node.add(sub);
      h = 16 + title.h + 4 + sub.h + 14;
    }
    node.setSize(500, h);
    bg.setRect(0, 0, 500, h);
    node.onLayout = () => node.setPos(Math.round((eng.width - 500) / 2), Math.round(eng.height * 0.22));
    eng.layers.overlay.add(node);
    const rec = { node, resolve, off: null, t: 0, held: false };
    this._current = rec;
    uisound(node, 'notify', { card: true });
    animateIn(node, 'fall');
    const hold = Number.isFinite(spec.hold) ? Math.max(0, spec.hold) : 1.6;
    rec.off = eng.ticker.add((dt) => {
      rec.t += dt;
      // entrance + hold; under reducedMotion the entrance is INSTANT, so counting
      // its 0.2s would silently stretch every card's hold (fixed)
      if (rec.t < (isReducedMotion() ? 0 : 0.2) + hold || rec.held) return;
      rec.held = true;
      rec.off?.();
      animateOut(node, 'rise').then(() => {
        node.dispose();
        if (this._current === rec) this._current = null;
        resolve();
        this._drain();
      });
    });
  },

  // Teardown hook: pending cards settle; the live node dies with the overlay layer.
  _reset() {
    this._current?.off?.();
    if (this._current) { this._current.resolve(); this._current = null; }
    for (const q of this._queue.splice(0)) q.resolve();
  },
};

// ---------------- SaveSlotList ----------------
// A column of save cards. Filled slots show a procedural THUMBNAIL (the consumer's
// painter hook, or the house sigil), name, timestamp, and playtime, plus an Erase
// button that confirms through EldPopup before dispatching `slotdelete {index}` —
// the CONSUMER mutates its data and calls setSlots (data-driven, like Table). A
// null slot renders the New Vessel card and dispatches `slotnew {index}` on click.

const CARD_H = 72;
const CARD_GAP = 10;
const THUMB_W = 84, THUMB_H = 56;

function houseSigil(ctx, w, h, seedText) {
  // the default thumbnail: a seeded rune-circle, zero assets
  let seed = 0;
  for (const ch of String(seedText)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = COLORS.voidBlack;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = COLORS.accent;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const a1 = rand() * Math.PI * 2, a2 = rand() * Math.PI * 2;
    const r = Math.min(w, h) * 0.34;
    ctx.beginPath();
    ctx.moveTo(w / 2 + Math.cos(a1) * r, h / 2 + Math.sin(a1) * r);
    ctx.lineTo(w / 2 + Math.cos(a2) * r, h / 2 + Math.sin(a2) * r);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export class SaveSlotList extends UINode {
  // opts: { slots: [ { name, timestamp, playtime, thumbnail(ctx,w,h)? } | null ... ],
  //         width = 400, onSelect(index, slot), onDelete(index, slot), onNew(index) }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this.onSelect = opts.onSelect ?? null;
    this.onDelete = opts.onDelete ?? null;
    this.onNew = opts.onNew ?? null;
    this._width = opts.width ?? 400;
    this._cards = [];
    this._rasters = [];
    this.setSlots(opts.slots ?? []);
  }

  setSlots(slots) {
    for (const c of this._cards) c.dispose();
    for (const r of this._rasters) r.texture.dispose();
    this._cards = [];
    this._rasters = [];
    this.slots = slots ?? [];
    this.slots.forEach((slot, i) => this._buildCard(slot, i));
    this.setSize(this._width, Math.max(1, this.slots.length * (CARD_H + CARD_GAP) - CARD_GAP));
    this.invalidateLayout();
  }

  _buildCard(slot, i) {
    const card = new UINode({ interactive: true });
    const bg = new NineSliceNode(frame('button.normal'));
    card.add(bg);
    card._bg = bg;
    card.setRect(0, i * (CARD_H + CARD_GAP), this._width, CARD_H);
    card.focusable = true;
    if (slot) {
      const raster = createCanvasTexture(THUMB_W, THUMB_H, texScale());
      (slot.thumbnail ?? ((ctx, w, h) => houseSigil(ctx, w, h, slot.name)))(raster.ctx, THUMB_W, THUMB_H);
      raster.texture.needsUpdate = true;
      this._rasters.push(raster);
      const thumb = new QuadNode({ texture: raster.texture });
      thumb.setRect(8, 8, THUMB_W, THUMB_H);
      // the screenshot bleeds to the card frame's edge BY DESIGN (closer than the
      // frame's inset content box) — declared, like every deliberate bleed
      thumb.auditAllow('containment');
      const name = new TextNode(slot.name ?? '', {
        font: FONTS.header, size: 14, smallCaps: true, letterSpacing: 1, color: COLORS.accent,
        maxWidth: this._width - THUMB_W - 120, ellipsis: true, shadow: SHADOW,
      });
      name.setPos(THUMB_W + 18, 10);
      const stamp = new TextNode(slot.timestamp ?? '', { size: 11, color: COLORS.textFaint, shadow: SHADOW });
      stamp.setPos(THUMB_W + 18, 32);
      const played = new TextNode(slot.playtime ?? '', { font: FONTS.mono, size: 11, color: COLORS.textMuted, shadow: SHADOW });
      played.setPos(THUMB_W + 18, 50);
      const erase = new Button(str('saveErase'), { minWidth: 78, height: 30 });
      // position from the button's REAL width — it sizes to its label, and the old
      // `width - 88` assumed minWidth held (it overflowed the card at every width;
      // the L13 audit caught it the first time a page showed the list unclipped)
      erase.setPos(this._width - erase.w - 22, Math.round((CARD_H - 30) / 2));
      erase.on('click', (e) => {
        e.stopPropagation(); // the card must not also select
        EldPopup.show({
          title: str('saveEraseTitle'),
          message: str('saveErasePrompt', slot.name ?? ''),
          onOkay: () => {
            this.dispatch('slotdelete', { index: i, slot });
            this.onDelete?.(i, slot);
          },
        });
      });
      card.add(thumb, name, stamp, played, erase);
      // ONE fire for both channels (the LevelSelectGrid idiom below): the
      // old inline onActivate duplicated the click body and DROPPED the voice —
      // Enter/gamepad-A selected a save in silence
      const fireSelect = () => {
        uisound(card, 'click');
        this.dispatch('slotselect', { index: i, slot });
        this.onSelect?.(i, slot);
      };
      card.on('click', fireSelect);
      card.onActivate = fireSelect;
    } else {
      const plus = new TextNode('＋', { size: 26, color: COLORS.accent, shadow: SHADOW });
      plus.setPos(26, 18);
      const name = new TextNode(str('saveNewTitle'), {
        font: FONTS.header, size: 14, smallCaps: true, letterSpacing: 1, color: COLORS.bone,
        shadow: SHADOW,
      });
      name.setPos(70, 16);
      const desc = new TextNode(str('saveNewDesc'), { size: 11, color: COLORS.textFaint, shadow: SHADOW });
      desc.setPos(70, 38);
      card.add(plus, name, desc);
      const fireNew = () => {
        uisound(card, 'click');
        this.dispatch('slotnew', { index: i });
        this.onNew?.(i);
      };
      card.on('click', fireNew);
      card.onActivate = fireNew;
    }
    // B10: the seal quiets art AND voice (hover still delivers into sealed subtrees)
    card.on('pointerenter', () => { if (this.closest((n) => n.disabled === true)) return; card._bg.setFrame(frame('button.hover')); uisound(card, 'hover'); });
    card.on('pointerleave', () => card._bg.setFrame(frame('button.normal')));
    this._cards.push(card);
    this.add(card);
  }

  setDisabled(v) {
    setNodeDisabled(this, v);
    // W09 (L12): the seal RE-DERIVES hover — a cursor parked on a card when the
    // seal lands must not leave its hover frame lit until a leave finally fires
    if (v) for (const card of this._cards) card._bg?.setFrame(frame('button.normal'));
  }

  onLayout() {
    this._cards.forEach((card, i) => {
      card.setRect(0, i * (CARD_H + CARD_GAP), this.w, CARD_H);
      card._bg.setRect(0, 0, this.w, CARD_H);
    });
  }

  disposeSelf() {
    for (const r of this._rasters) r.texture.dispose();
    this._rasters = [];
  }
}

// ---------------- LevelSelectGrid ----------------
// Stone plates in a grid: `state` is 'locked' | 'open' | 'done' (locked plates still
// click and focus — locked is DATA, the page decides; the NodeGraph rule), `stars`
// draws a 0..3 row under done plates. `pageSize` pages the grid (‹ › buttons).

const PLATE = 64;
const PLATE_GAP = 10;

export class LevelSelectGrid extends UINode {
  // opts: { levels: [{ id, label, state, stars }], cols = 4, pageSize = 0 (all),
  //         onSelect(e) }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this.levels = (opts.levels ?? []).map((l) => ({ stars: 0, state: 'open', ...l }));
    // B5: finite-first — a NaN cols reaches si % cols and poisons every plate rect;
    // an Infinity pageSize made start = 0 * Infinity = NaN and the level slice EMPTY
    this.cols = Math.max(1, Math.floor(Number.isFinite(opts.cols) ? opts.cols : 4));
    this.pageSize = Math.max(0, Math.floor(Number.isFinite(opts.pageSize) ? opts.pageSize : 0)) || this.levels.length;
    this.page = 0;
    this.onSelect = opts.onSelect ?? null;
    this._plates = [];
    this._pageText = null;
    this._build();
  }

  get pages() { return Math.max(1, Math.ceil(this.levels.length / this.pageSize)); }

  _build() {
    for (const p of this._plates) p.dispose();
    this._plates = [];
    this._prevBtn?.dispose(); this._nextBtn?.dispose(); this._pageText?.dispose();
    this._prevBtn = this._nextBtn = this._pageText = null;

    const start = this.page * this.pageSize;
    const slice = this.levels.slice(start, start + this.pageSize);
    slice.forEach((level, si) => {
      const plate = new UINode({ interactive: true });
      plate.focusable = true;
      // THE PLATE WAS NEVER LAID OUT. `bg` got no rect, so every level tile's
      // stone frame painted at ZERO SIZE: the grid rendered as bare floating labels
      // over the panel (arcade.html and meta-screens.html both). A NineSliceNode with
      // no rect is invisible rather than small, which is why it read as "no tiles"
      // instead of "wrong tiles" and survived every gate. Giving it a surface then
      // exposed what the invisibility had hidden - the star row sat at a HARD
      // y (PLATE - 20) and spilled the frame's CONTENT rect by 13px, three
      // containment violations (the SaveSlotList lesson, again: clipping and
 // invisibility both hide real defects). Everything now derives from the frame's
      // own inset and the measured text, so the tile is correct at any frame border.
      const fr = frame(level.state === 'locked' ? 'button.disabled' : 'button.normal');
      const bg = new NineSliceNode(fr);
      bg.setRect(0, 0, PLATE, PLATE);
      const inner = contentRect(fr, PLATE, PLATE);
      const label = new TextNode(String(level.label ?? level.id), {
        font: FONTS.header, size: 16, smallCaps: true,
        color: level.state === 'locked' ? COLORS.textDisabled : COLORS.accent, shadow: SHADOW,
      });
      const starred = level.state === 'done' && level.stars > 0;
      label.setPos(
        Math.round(inner.x + (inner.w - label.w) / 2),
        Math.round(inner.y + (inner.h - label.h) / 2) - (starred ? 5 : 0),
      );
      plate.add(bg, label);
      plate._bg = bg; plate._label = label; plate._level = level;
      if (level.state === 'locked') {
        const lock = new QuadNode({ texture: tex('lock.locked'), opacity: 0.9 });
        lock.setRect(inner.x + inner.w - 18, inner.y, 18, 18);
        plate.add(lock);
      }
      if (starred) {
        const stars = new TextNode('★'.repeat(clamp(Math.floor(level.stars), 0, 3)), {
          size: 10, color: COLORS.quest, shadow: SHADOW,
        });
        stars.setPos(
          Math.round(inner.x + Math.max(0, (inner.w - stars.w) / 2)),
          Math.round(inner.y + Math.max(0, inner.h - stars.h)),
        );
        plate.add(stars);
      }
      const col = si % this.cols, row = Math.floor(si / this.cols);
      plate.setRect(col * (PLATE + PLATE_GAP), row * (PLATE + PLATE_GAP), PLATE, PLATE);
      plate.on('pointerenter', () => {
        if (this.closest((n) => n.disabled === true)) return; // B10: GRID seal = silent; LOCKED plates keep voicing (S51 design)
        if (level.state !== 'locked') plate._bg.setFrame(frame('button.hover'));
        uisound(plate, 'hover');
      });
      plate.on('pointerleave', () => {
        if (level.state !== 'locked') plate._bg.setFrame(frame('button.normal'));
      });
      const fire = () => {
        uisound(plate, level.state === 'locked' ? 'error' : 'click');
        const payload = { id: level.id, state: level.state, stars: level.stars };
        this.dispatch('levelclick', payload);
        this.onSelect?.(payload);
      };
      plate.on('click', fire);
      plate.onActivate = fire;
      this._plates.push(plate);
      this.add(plate);
    });

    const rows = Math.ceil(slice.length / this.cols);
    let h = Math.max(1, rows * (PLATE + PLATE_GAP) - PLATE_GAP);
    if (this.pages > 1) {
      this._prevBtn = new Button('‹', { minWidth: 44, height: 30 });
      this._nextBtn = new Button('›', { minWidth: 44, height: 30 });
      this._pageText = new TextNode('', { font: FONTS.mono, size: 12, color: COLORS.textMuted, shadow: SHADOW });
      this._prevBtn.setPos(0, h + 8);
      this._nextBtn.setPos(this.cols * (PLATE + PLATE_GAP) - PLATE_GAP - 44, h + 8);
      this._prevBtn.on('click', () => this.setPage(this.page - 1, { silent: false }));
      this._nextBtn.on('click', () => this.setPage(this.page + 1, { silent: false }));
      this.add(this._prevBtn, this._nextBtn, this._pageText);
      this._pageText.setText(`${this.page + 1} / ${this.pages}`);
      this._pageText.setPos(Math.round((this.cols * (PLATE + PLATE_GAP) - PLATE_GAP - this._pageText.w) / 2), h + 15);
      h += 46;
    }
    this.setSize(this.cols * (PLATE + PLATE_GAP) - PLATE_GAP, h);
    this.invalidateLayout();
  }

  // B6: silent by default (the library setter convention; the selectTab
 // precedent) — the ‹ › buttons pass {silent:false}, so the GESTURE stays loud
  setPage(p, { silent = true } = {}) {
    const next = clamp(Math.floor(p), 0, this.pages - 1);
    if (next === this.page) return;
    this.page = next;
    this._build();
    commitChange(this, 'pagechange', { page: next }, silent, null);
  }

  setLevelState(id, state, { silent = true } = {}) {
    const level = this.levels.find((l) => l.id === id);
    if (!level || level.state === state) return false;
    level.state = state;
    this._build();
    commitChange(this, 'levelchange', { id, state }, silent, null);
    return true;
  }

  setDisabled(v) { setNodeDisabled(this, v); }
}

// ---------------- CreditsScroller ----------------
// Auto-scrolls its roll upward; `speed` is px/sec (setSpeed adjusts live); skip()
// jumps to the end. Reaching the end — scrolled or skipped — stops the clock and
// dispatches `done {}` exactly once.

export class CreditsScroller extends UINode {
  // opts: { entries: [{ header } | { role, name } | { text }], width = 420,
  //         height = 280, speed = 28, autoStart = true }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this.speed = Number.isFinite(opts.speed) ? Math.max(1, opts.speed) : 28;
    this.bg = new NineSliceNode(frame('panel.dark'));
    // the viewport clips the roll to our box (the engine syncs any clipChildren +
    // clipRegion node from its world rect each frame — the ScrollArea recipe)
    this._viewport = new UINode({ name: 'credits-viewport' });
    this._viewport.clipChildren = true;
    this._viewport.clipRegion = new ClipRegion();
    this._pane = new UINode({ name: 'credits-pane' });
    this._viewport.add(this._pane);
    this.add(this.bg, this._viewport);
    this.setSize(opts.width ?? 420, opts.height ?? 280);
    this._offset = 0;
    this._done = false;
    this._entries = [...(opts.entries ?? [])];
    this._builtW = -1;
    this._buildRoll();
    // The roll is wheel-scrubbable at any time: under reducedMotion it
    // is the ONLY way the credits move — user-initiated motion is the player's,
    // not the interface's — and outside it a reader may still scrub ahead.
    // Reaching the end by wheel takes the same single done path a natural
    // finish takes.
    this.interactive = true;
    this.on('wheel', (e) => {
      const next = clamp(this._offset + e.deltaY, 0, this._endOffset);
      if (next === this._offset) return;
      e.stopPropagation();
      this._offset = next;
      if (next >= this._endOffset) this._finish();
      else this._syncPane();
    });
    if (opts.autoStart !== false) this.start();
    this._syncPane();
  }

  // The roll is rebuilt whenever the LANE WIDTH changes, not once at construction.
  // Centred headers carry `fixedW` and the role/name columns split the lane, so a roll
  // built at 420 and then shown in a 700px window used to sit centred on the old width
  // — a static box inside a resizable frame. A widget that accepts a resize has to mean
  // it (and the credits window is resizable, so it must).
  _buildRoll() {
    const w = Math.max(80, this.w - 24);
    if (w === this._builtW) return;
    this._builtW = w;
    for (const n of [...this._pane.children]) n.dispose();
    let y = 0;
    for (const e of this._entries) {
      if (e.header != null) {
        const n = new TextNode(e.header, {
          font: FONTS.header, size: 15, smallCaps: true, letterSpacing: 2, color: COLORS.accent,
          align: 'center', fixedW: w, shadow: SHADOW,
        });
        n.setPos(12, y + 10);
        this._pane.add(n);
        y += n.h + 20;
      } else if (e.role != null || e.name != null) {
        const role = new TextNode(e.role ?? '', { size: 12, color: COLORS.textFaint, shadow: SHADOW });
        const name = new TextNode(e.name ?? '', { size: 12, color: COLORS.text, shadow: SHADOW });
        role.setPos(12, y);
        name.setPos(Math.round(w / 2) + 12, y);
        this._pane.add(role, name);
        y += 20;
      } else {
        const n = new TextNode(e.text ?? '', {
          size: 12, color: COLORS.textMuted, align: 'center', fixedW: w,
          multiline: true, maxWidth: w, shadow: SHADOW,
        });
        n.setPos(12, y);
        this._pane.add(n);
        y += n.h + 8;
      }
    }
    this._rollH = y;
  }

  get _endOffset() { return this._rollH + this.h; } // fully climbed past the top

  _syncPane() {
    this._pane.setPos(0, Math.round(this.h - this._offset));
    this.engine?.requestRender();
  }

  start() {
    // reducedMotion = NO MOTION (the standing ruling; — this widget was
 // the one auto-mover with no gate at all): the roll rests readable at its
    // current offset instead of crawling. The wheel scrubs it, skip() lands it,
    // and both reach the same done path, so a credits->menu flow still closes.
    if (isReducedMotion()) return;
    if (this._hookOn || this._done) return;
    this._hookOn = true;
    this.setFrameHook((dt) => {
      this._offset += this.speed * dt;
      if (this._offset >= this._endOffset) {
        this._offset = this._endOffset;
        this._finish();
        return;
      }
      this._syncPane();
    });
  }

  stop() {
    this._hookOn = false;
    this.setFrameHook(null);
  }

  setSpeed(v) { this.speed = Math.max(1, Number.isFinite(v) ? v : this.speed); }

  // jump to the end; the same single `done` path a natural finish takes
  skip() {
    this._offset = this._endOffset;
    this._finish();
  }

  _finish() {
    this._syncPane();
    this.stop();
    if (this._done) return;
    this._done = true;
    this.dispatch('done', {});
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this._viewport.setRect(6, 6, this.w - 12, this.h - 12);
    this._buildRoll(); // no-op unless the lane width actually moved
    this._syncPane();
  }
}

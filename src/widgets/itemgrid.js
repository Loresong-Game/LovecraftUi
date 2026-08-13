// ItemGrid: the inventory lattice — a stone panel of item slots holding stacks. Items
// are registered metadata (Eldritch.registerItem: name/desc/icon/rarity/stackMax/data);
// a slot shows the item's icon, a rarity-tinted ring, and a count badge. Dragging rides
// EldDragDrop with the stacking protocol: drop on the same item merges up to
// stackMax (remainder stays behind), on a different item swaps, on an empty item slot
// moves, on empty space cancels back (items are owned, never discarded by dropping).
// Right-click on a stack opens the context menu; "Split Stack…" prompts for a count and
// places it in the first empty slot. A locked grid is sealed: no drag-out, no drop-in,
// no splitting (clicks and tooltips keep working).

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { requireEngine, itemData, rarityColor, uisound, commitChange, setNodeDisabled } from './widgets.js';
import { EldDragDrop, DraggableIcon } from './dragdrop.js';
import { EldPopup } from './windows.js';
import { EldContextMenu } from './menu.js';
import { EldEvents } from './events.js';
import { str } from '../strings.js';

const tex = (name) => requireEngine().textures.get(name); // friendly pre-init throw
const frame = (name) => requireEngine().textures.frame(name);

export class ItemSlot extends UINode {
  constructor(grid, index) {
    super({ interactive: true });
    this.focusable = true;
    this.isDropTarget = true;
    this.slotKind = 'item';
    this.grid = grid;
    this.index = index;
    this.slotId = `item:${index}`;
    this.bg = new QuadNode({ texture: tex('itemslot.frame') });
    this.rarityRing = new QuadNode({ texture: tex('itemslot.rarity') });
    this.rarityRing.visible = false;
    this.hoverOverlay = new QuadNode({ texture: tex('cpslot.hover') });
    this.hoverOverlay.visible = false;
    this.countText = new TextNode('', {
      font: FONTS.mono, size: 13, weight: 'bold', color: COLORS.textWhite,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    this.countText.auditAllow('overlap'); // the count badge rides the icon corner by design
    this.countText.visible = false;
    // durability underbar: a 0..1 fraction on the ITEM BAG (it rides drags
    // with the icon) paints a static tier-tinted bar — accent > quest > negative,
    // STYLE §9 tiers, never pulses
    this.duraBar = new QuadNode({ color: COLORS.accent, opacity: 0.95 });
    this.duraBar.visible = false;
    this.icon = null;
    this.add(this.bg, this.rarityRing, this.hoverOverlay, this.countText, this.duraBar);
    this.setSize(METRICS.itemSlotSize, METRICS.itemSlotSize);
    this._dragOver = false;
    // the input layer delivers hover into disabled subtrees (the tooltip rule) —
    // the overlay channel seals itself, closest(disabled) first (locked stays hoverable:
    // a locked grid keeps tooltips and clicks by design, disabled is the full seal)
    this.on('pointerenter', () => {
      if (!EldDragDrop.isDragging && !this.closest((n) => n.disabled === true)) this.hoverOverlay.visible = true;
    });
    this.on('pointerleave', () => { if (!this._dragOver) this.hoverOverlay.visible = false; });
    // quick-transfer: shift-click sends the stack to the linked grid
    this.on('click', (e) => {
      if (e.native?.shiftKey && this.icon && !this.grid.locked) this.grid._quickMove(this);
    });
    this.on('rightclick', (e) => {
      if (!this.icon || this.grid.locked) return;
      const entries = [];
      if (this.icon.count > 1) entries.push({ label: str('splitMenuEntry'), onClick: () => this._promptSplit() });
      // consume only when a menu actually shows: a 1-count stack has no
      // entries, and a consumed-then-dropped gesture would dead-end the radial chain
      if (!entries.length) return;
      e.preventDefault();
      EldContextMenu.show(entries, e.x, e.y);
    });
  }

  // The EldDragDrop slot interface (shared with ActionSlot/CpSlot).
  setIcon(iconNode) {
    this.icon = iconNode;
    if (iconNode) {
      iconNode.setSize(METRICS.itemSlotIcon, METRICS.itemSlotIcon);
      this.add(iconNode);
      // overlays and the badge stay above the icon in paint order
      this.add(this.rarityRing, this.hoverOverlay, this.countText);
    }
    this._refresh();
    this.invalidateLayout();
  }

  takeIcon() { const ic = this.icon; this.icon = null; this._refresh(); return ic; }

  setDragOver(v) {
    if (this._dragOver === v) return;
    this._dragOver = v;
    this.hoverOverlay.visible = v;
    this.bg.material.color.set(v ? 0x9adfb2 : 0xffffff);
  }

  setCooldown() {} // items carry no rite cooldown

  // ONE method computes the slot's visual state: ring, tint, badge. Common items wear
  // no ring — rarity accents are scarce by design; the ring marks the notable.
  _refresh() {
    const ic = this.icon;
    const d = ic && ic.itemId != null ? itemData(ic.itemId) : null;
    if (d && d.rarity !== 'common') {
      this.rarityRing.visible = true;
      this.rarityRing.setColor(rarityColor(d.rarity));
    } else {
      this.rarityRing.visible = false;
    }
    if (ic && ic.itemId != null && ic.count > 1) {
      this.countText.visible = true;
      this.countText.setText(String(ic.count));
    } else {
      this.countText.visible = false;
    }
    const dura = ic?.durability;
    if (ic && Number.isFinite(dura)) {
      this.duraBar.visible = true;
      this.duraBar.setColor(dura > 0.5 ? COLORS.accent : dura > 0.25 ? COLORS.quest : COLORS.negative);
    } else {
      this.duraBar.visible = false;
    }
    this.invalidateLayout();
  }

  _promptSplit() {
    const ic = this.icon;
    if (!ic || ic.count < 2) return;
    const d = itemData(ic.itemId);
    EldPopup.show({
      title: str('splitTitle'),
      message: str('splitPrompt', d.name, ic.count - 1),
      prompt: { value: String(Math.floor(ic.count / 2)) },
    }).then(({ action, value }) => {
      if (action !== 'ok') return;
      // confirm-time re-check (the discard-hook discipline): the grid may have locked
      // or the stack changed hands while the prompt was up
      if (this.grid.locked || this.icon !== ic || ic.count < 2) return;
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n < 1 || n > ic.count - 1) {
        EldEvents.log(str('splitRefused'));
        uisound(this, 'error');
        return;
      }
      const empty = this.grid.firstEmpty();
      if (!empty) {
        EldEvents.log(str('splitNoRoom'));
        uisound(this, 'error');
        return;
      }
      ic.count -= n;
      this._refresh();
      this.grid._placeItem(empty, ic.itemId, n);
      EldDragDrop._dispatchItemChange(this, ic.itemId, ic.count, 'split');
      EldDragDrop._dispatchItemChange(empty, ic.itemId, n, 'split');
      EldEvents.log(str('splitDone', n, d.name, empty.slotId));
    });
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.rarityRing.setRect(0, 0, this.w, this.h);
    this.hoverOverlay.setRect(0, 0, this.w, this.h);
    if (this.icon) this.icon.setPos(Math.round((this.w - this.icon.w) / 2), Math.round((this.h - this.icon.h) / 2));
    this.countText.setPos(
      Math.round(this.w - this.countText.w - METRICS.badgeInset),
      Math.round(this.h - this.countText.h - METRICS.badgeInset));
    if (this.duraBar.visible) {
      const dura = Math.min(1, Math.max(0, this.icon?.durability ?? 0));
      this.duraBar.setRect(4, this.h - 7, Math.max(1, Math.round((this.w - 8) * dura)), 3);
    }
  }
}

export class ItemGrid extends UINode {
  // opts: { cols = 4, rows = 4, locked = false, spacing = 6,
  // accepts: (itemId, count) => boolean } — zone typing: gates ENTRY
  //         from another container (drag drop + quick-move; merge/swap/move all ask);
  //         same-grid rearranges never ask, and programmatic setItem/clearSlot stay
  //         game-authoritative. null accepts everything (the 1.14 behavior verbatim).
  constructor(opts = {}) {
    super({ interactive: true });
    // B5: finite-first + capped — the slot-build loop below multiplies these, and
    // an Infinity (or 1e6) would hang the tab building ItemSlots forever (the
    // ProgressBar-segments precedent). 64 a side is far past any shipped grid.
    const dim = (v, d) => Math.max(1, Math.min(64, Math.floor(Number.isFinite(v) ? v : d)));
    this.cols = dim(opts.cols, 4);
    this.rows = dim(opts.rows, 4);
    this.locked = opts.locked ?? false;
    this.accepts = opts.accepts ?? null;
    // B5: finite-first — _spacing multiplies into the grid rect and every slot position
    this._spacing = Number.isFinite(opts.spacing) ? Math.max(0, opts.spacing) : 6;
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.add(this.bg);
    this.slots = [];
    for (let i = 0; i < this.cols * this.rows; i++) {
      const slot = new ItemSlot(this, i);
      this.slots.push(slot);
      this.add(slot);
    }
    const S = METRICS.itemSlotSize, g = this._spacing;
    this.setSize(20 + this.cols * (S + g) - g, 20 + this.rows * (S + g) - g);
  }

  // Place/replace a stack programmatically. Count clamps to the item's stackMax.
  // opts.durability (0..1) rides the item bag — it travels with drags and paints
  // the slot's underbar.
  setItem(index, itemId, count = 1, { silent = true, durability } = {}) {
    const slot = this.slots[index];
    if (!slot) return null;
    if (slot.icon) { const old = slot.takeIcon(); old.dispose(); }
    const icon = this._placeItem(slot, itemId, count);
    if (Number.isFinite(durability)) {
      icon.durability = Math.min(1, Math.max(0, durability)); // on the ICON: it is what rides drags
      slot._refresh();
    }
    if (!silent) EldDragDrop._dispatchItemChange(slot, icon.itemId, icon.count, 'set');
    return icon;
  }

  // Durability is presentation on the item bag; null clears the bar.
  setDurability(index, v) {
    const slot = this.slots[index];
    if (!slot || !slot.icon) return this;
    if (Number.isFinite(v)) slot.icon.durability = Math.min(1, Math.max(0, v));
    else delete slot.icon.durability;
    slot._refresh();
    return this;
  }

  // ---- grid sort (the cut line, graduated) ----
  // Consolidate then order: same-id stacks MERGE first (stackMax honored — the drag
  // protocol's rule; durability-bearing stacks never merge, a worn fraction is not
  // averageable), then everything packs from slot 0 ordered by the comparator
  // (default: rarity tier descending, then item id, then count descending). Locked
  // grids refuse loudly (the action-lock seal). Silent by default like every mutator;
  // a loud call dispatches ONE `itemchange {action:'sort'}` summary, never per-slot
  // spam. Sorting under a drag FROM this grid is safe: setItem disposes the flying
  // source icon and the icon watch cancels the gesture.
  sort({ comparator = null, silent = true } = {}) {
    if (this.locked) { uisound(this, 'error', { sort: 'locked' }); return this; }
    const stacks = [];
    for (const s of this.slots) {
      if (s.icon && s.icon.itemId != null) stacks.push({ id: s.icon.itemId, count: s.icon.count, durability: s.icon.durability });
    }
    const merged = [];
    for (const st of stacks) {
      if (!Number.isFinite(st.durability)) {
        const max = itemData(st.id)?.stackMax ?? 1;
        const open = merged.find((m) => m.id === st.id && !Number.isFinite(m.durability) && m.count < max);
        if (open) {
          const take = Math.min(st.count, max - open.count);
          open.count += take;
          st.count -= take;
          if (st.count <= 0) continue;
        }
      }
      merged.push(st);
    }
    const rank = { legendary: 3, epic: 2, rare: 1, common: 0 };
    const cmp = typeof comparator === 'function' ? comparator : (a, b) => {
      const ra = rank[itemData(a.id)?.rarity] ?? 0;
      const rb = rank[itemData(b.id)?.rarity] ?? 0;
      if (ra !== rb) return rb - ra;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return b.count - a.count;
    };
    merged.sort(cmp);
    for (let i = 0; i < this.slots.length; i++) {
      const st = merged[i];
      if (st) this.setItem(i, st.id, st.count, { durability: st.durability });
      else if (this.slots[i].icon) this.clearSlot(i);
    }
    if (!silent) EldDragDrop._dispatchItemChange(this.slots[0], null, 0, 'sort');
    return this;
  }

  // ---- the quick-transfer protocol ----
  // linkTransfer names the destination; shift-click on a stack quick-moves it:
  // MERGE into same-id stacks first (stackMax honored, the drag protocol's rule),
  // then the first empty slot; a destination with no room refuses with the error
  // voice and dispatches nothing. Success dispatches `transfer {index, id, count,
  // to}` on THIS grid ('transfer' is not 'change', so batches stay quiet).
  linkTransfer(other) {
    this._transferTarget = other ?? null;
    return this;
  }

  _quickMove(slot, { quiet = false } = {}) {
    const other = this._transferTarget;
    const ic = slot.icon;
    if (!other || other === this || !ic || this.locked || other.locked) {
      if (!quiet) uisound(this, 'error', { transfer: true });
      return false;
    }
    // zone typing: entry into a typed destination is gated here too; the sweep's
    // quiet path counts a refusal as stuck, so transferAll keeps its one-error voice
    // and its partial-move counts.
    if (other.accepts && !other.accepts(ic.itemId, ic.count)) {
      if (!quiet) { EldEvents.log(str('zoneRefused')); uisound(this, 'error', { transfer: true }); }
      return false;
    }
    const id = ic.itemId;
    const d = itemData(id);
    const durability = ic.durability;
    const total = ic.count;
    let remaining = total;
    for (const s of other.slots) { // merge-first
      if (!remaining) break;
      if (s.icon && s.icon.itemId === id && s.icon.count < d.stackMax) {
        const take = Math.min(remaining, d.stackMax - s.icon.count);
        s.icon.count += take; // the split precedent: mutate + refresh + dispatch
        s._refresh();
        EldDragDrop._dispatchItemChange(s, id, s.icon.count, 'transfer');
        remaining -= take;
      }
    }
    if (remaining) {
      const empty = other.firstEmpty();
      if (empty) {
        const placed = other._placeItem(empty, id, remaining);
        if (Number.isFinite(durability)) { placed.durability = durability; empty._refresh(); }
        EldDragDrop._dispatchItemChange(empty, id, remaining, 'transfer');
        remaining = 0;
      }
    }
    const moved = total - remaining;
    if (!moved) {
      if (!quiet) uisound(this, 'error', { transfer: true });
      return false;
    }
    if (remaining) {
      ic.count = remaining;
      slot._refresh();
      EldDragDrop._dispatchItemChange(slot, id, remaining, 'transfer');
    } else {
      const old = slot.takeIcon();
      old.dispose();
      slot._refresh();
      EldDragDrop._dispatchItemChange(slot, id, 0, 'transfer');
    }
    if (!quiet) uisound(this, 'swap', { transfer: true });
    commitChange(this, 'transfer', { index: slot.index, id, count: moved, to: other }, false, null);
    return true;
  }

  // take-all and deposit-all are the SAME sweep pointed both ways:
  // chest.transferAll(bag) empties the chest; bag.transferAll(chest) deposits.
  // Every stack is tried (a full destination can still absorb merges); one 'swap'
  // voices any success, one 'error' voices anything left behind. Returns the
  // number of stacks fully or partially moved. {quiet: true} silences the voices
  // (the _quickMove precedent) so a composite sweeping several grids — one gesture —
  // can voice ONCE itself; events still dispatch (data truth is never quieted).
  transferAll(other, { quiet = false } = {}) {
    const target = other ?? this._transferTarget;
    if (!target || target === this || this.locked || target.locked) {
      if (!quiet) uisound(this, 'error', { transferAll: true });
      return 0;
    }
    const prev = this._transferTarget;
    this._transferTarget = target;
    let moved = 0, stuck = 0;
    for (const slot of this.slots) {
      if (!slot.icon) continue;
      if (this._quickMove(slot, { quiet: true })) {
        moved++;
        if (slot.icon) stuck++; // a partial move: the remainder stayed behind
      } else {
        stuck++;
      }
    }
    this._transferTarget = prev;
    if (moved && !quiet) uisound(this, 'swap', { transferAll: true });
    if (stuck && !quiet) uisound(this, 'error', { transferAll: true });
    return moved;
  }

  getItem(index) {
    const ic = this.slots[index]?.icon;
    return ic && ic.itemId != null ? { item: ic.itemId, count: ic.count } : null;
  }

  clearSlot(index, { silent = true } = {}) {
    const slot = this.slots[index];
    if (!slot || !slot.icon) return;
    const itemId = slot.icon.itemId;
    const old = slot.takeIcon();
    old.dispose();
    if (!silent) EldDragDrop._dispatchItemChange(slot, itemId, 0, 'clear');
  }

  setLocked(v) { this.locked = !!v; }

  setDisabled(v) {
    setNodeDisabled(this, v);
    // a cursor parked on a slot gets no leave when the seal lands — douse lit
    // overlays (the BodyDoll/EquipmentRack precedent; B1 class sweep)
    if (v) for (const s of this.slots) { s.hoverOverlay.visible = false; s._dragOver = false; }
  }

  firstEmpty() { return this.slots.find((s) => !s.icon) ?? null; }

  _placeItem(slot, itemId, count) {
    const d = itemData(itemId);
    const icon = new DraggableIcon(d.icon ?? String(itemId), {
      size: METRICS.itemSlotIcon,
      // finite-first: a NaN count (parseInt gone wrong) would store a corrupt stack
      item: { id: itemId, count: Number.isFinite(count) ? Math.min(Math.max(1, Math.floor(count)), d.stackMax) : 1 },
    });
    slot.setIcon(icon);
    return icon;
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    const S = METRICS.itemSlotSize, g = this._spacing;
    this.slots.forEach((slot, i) => {
      slot.setPos(10 + (i % this.cols) * (S + g), 10 + Math.floor(i / this.cols) * (S + g));
    });
  }
}

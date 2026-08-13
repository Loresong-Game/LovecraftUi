// VirtualList: a pooled, fixed-row-height list over ScrollArea. Ten thousand rows cost
// what one screenful costs: rows are pooled nodes rebound to new indices as the view
// scrolls (children sit at absolute content coordinates; the engine applies the scroll
// offset). The consumer's renderRow(rowNode, item, index) fills IMPERATIVELY — create
// the row's child nodes on first call, update them on later calls, never re-create.
//
// Contract notes:
// - setItems() rebinds every visible row unconditionally (an in-place sort of the same
//   array must repaint; identity checks would show stale rows). refresh() does the same
//   for in-place mutations.
// - Tooltips on rows: attach once per pooled row with a FUNCTION spec that reads the
//   row's current binding; a rebind under the cursor hides any open tooltip.
// - The row-focus contract (opt-in `rowFocus: true`): the LIST is one Tab
//   stop; ArrowUp/Down (and Home/End) walk ITEM indices — across the window
//   boundary, auto-scrolling and rebinding as they go — a selection wash rides the
//   focused row, Enter dispatches `rowactivate {index, item}` and every move
//   dispatches `rowfocus {index, item}`. Ten thousand rows, one focus stop.

import { ScrollArea } from '../clip.js';
import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { COLORS } from '../theme.js';
import { clamp } from '../layout.js';
import { EldTooltip, setNodeDisabled } from './widgets.js';

export class VirtualList extends ScrollArea {
  constructor(opts = {}) {
    super(opts);
    // finite-first (Math.max launders NaN — a NaN rowH renders a silent empty list);
    // fractional row heights stay legal, so no floor here
    this.rowH = Number.isFinite(opts.rowH) ? Math.max(1, opts.rowH) : 26;
    this.overscan = Number.isFinite(opts.overscan) ? Math.max(0, opts.overscan) : 3;
    this.renderRow = opts.renderRow ?? null;
    this.items = [];
    this._pool = []; // [{node, index, version}]
    this._version = 0;
    this.setContentSize(0, 0); // no auto-measure: content height is synthetic
    this.focusIndex = -1;
    if (opts.rowFocus === true) {
      this.focusable = true;
      // the wash lives at ABSOLUTE content coordinates (the engine applies the
      // scroll offset), so it repositions only on focus moves — the pooling loop
      // stays untouched. Added before any pooled row: it paints beneath them.
      this._focusWash = new QuadNode({ color: COLORS.accent, opacity: 0.12 });
      this._focusWash.visible = false;
      this.content.add(this._focusWash);
      this.on('focus', () => {
        if (this.focusIndex < 0 && this.items.length) this._setFocusIndex(0, true);
        else this._syncWash();
      });
      this.on('blur', () => { this._focusWash.visible = false; });
      this.on('keydown', (e) => {
        if (this.disabled) return;
        const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (d) {
          e.preventDefault();
          if (!this.items.length) return;
          this._setFocusIndex(clamp((this.focusIndex < 0 ? 0 : this.focusIndex) + d, 0, this.items.length - 1), true);
          return;
        }
        if (e.key === 'Home' && this.items.length) { e.preventDefault(); this._setFocusIndex(0, true); return; }
        if (e.key === 'End' && this.items.length) { e.preventDefault(); this._setFocusIndex(this.items.length - 1, true); return; }
        if (e.key === 'Enter' && this.focusIndex >= 0 && this.focusIndex < this.items.length) {
          // the upper bound matters: a consumer splice without refresh() could leave a
          // stale index, and rowactivate must never carry item: undefined
          e.preventDefault();
          this.dispatch('rowactivate', { index: this.focusIndex, item: this.items[this.focusIndex] });
        }
      });
      // The mouse-to-keyboard handoff: a real click in the lane seats
      // the keyboard model on the row UNDER THE POINTER. Before this, a click
      // selected a row while focus — and so the arrows, and Enter — stayed
      // wherever Tab last left them: the vault's first drive clicked a tile and
      // found the whole keyboard dead. The row resolves by GEOMETRY, not by hit
      // target — bare rows are deliberately not interactive (making them so
      // would move every torture census), and clicks on interactive row
      // children bubble here with the same y. Pointer source keeps the
      // key-focus ring hidden per the ring rule.
      this.on('click', (e) => {
        if (this.disabled) return;
        // screen delta ÷ worldScale = LOCAL px (the wartable idiom):
        // scrollY and rowH are local units; the raw screen delta seated the
        // wrong row inside a zoomed plane
        const idx = Math.floor(((e.y - this.worldY) / (this.worldScale || 1) + this.content.scrollY) / this.rowH);
        if (idx < 0 || idx >= this.items.length) return;
        // Seat BEFORE focusing: focus.set emits 'focus' synchronously,
        // and the never-focused default above (focusIndex < 0 → seat 0 with
        // scrollIntoView) used to run FIRST — the first click on a scrolled
        // list snapped the viewport to the top and spoke a phantom rowfocus{0}
        // before seating the clicked row off-screen. Seated first, the focus
        // handler's else-branch just syncs the wash.
        this._setFocusIndex(idx, false);
        this.engine?.focus.set(this, 'pointer');
      });
    }
  }

  setItems(items) {
    this.items = items ?? [];
    this._version++;
    this.setContentSize(0, this.items.length * this.rowH);
    // a shrink drags the focus back inside the data; an empty list clears it.
    // Through _setFocusIndex: focus MOVED, so rowfocus fires — the old direct write
    // changed focus state silently (index -1 + item undefined = "focus cleared")
    if (this.focusIndex >= this.items.length) {
      this._setFocusIndex(this.items.length - 1, false);
    }
  }

  // Scroll the given item index into view (the row-focus contract's mover; public
  // because "jump to row" is a consumer need in its own right).
  scrollToIndex(index) {
    const i = clamp(index, 0, Math.max(0, this.items.length - 1));
    const top = i * this.rowH;
    const bottom = top + this.rowH;
    if (top < this.content.scrollY) this.setScroll(top);
    else if (bottom > this.content.scrollY + this.h) this.setScroll(bottom - this.h);
    return this;
  }

  _setFocusIndex(index, scrollIntoView) {
    this.focusIndex = index;
    if (scrollIntoView) this.scrollToIndex(index);
    this._syncWash();
    this.dispatch('rowfocus', { index, item: this.items[index] });
  }

  _syncWash() {
    if (!this._focusWash) return;
    const focused = this.engine?.focusedNode === this;
    if (this.focusIndex < 0 || !focused) { this._focusWash.visible = false; return; }
    this._focusWash.visible = true;
    this._focusWash.setRect(0, this.focusIndex * this.rowH, Math.max(this.content.w, this.w), this.rowH);
  }

  // Rebind every visible row (the items array was mutated in place, e.g. sorted).
  refresh() {
    this._version++;
    // an in-place splice can shrink the array under the focus — same clamp as
    // setItems, loudly (rowfocus), never a stale index Enter would activate
    if (this.focusIndex >= this.items.length) {
      this._setFocusIndex(this.items.length - 1, false);
    }
    this.invalidateLayout();
  }

  itemAt(node) {
    const slot = this._pool.find(p => p.node === node);
    return slot && slot.index >= 0 ? this.items[slot.index] : null;
  }

  // How many row nodes actually exist — one screenful plus overscan, no matter how
  // long `items` is. That IS the pooling claim, so it deserves to be readable
  // without reaching into the pool (big-data.html prints it as the proof).
  get poolSize() { return this._pool.length; }

  _ensurePool() {
    const visible = Math.ceil(Math.max(1, this.h) / this.rowH) + 2 * this.overscan;
    const need = Math.min(this.items.length, visible);
    while (this._pool.length < need) {
      const node = new UINode({});
      this.content.add(node);
      this._pool.push({ node, index: -1, version: -1 });
    }
    return need;
  }

  onLayout() {
    super.onLayout(); // settles the box, clamps scroll, honors scrollToBottom
    if (!this.renderRow) return;
    const need = this._ensurePool();
    const poolN = this._pool.length;
    if (!poolN) return;
    // Stable slot assignment: index -> pool[index % poolN]. A one-row window shift
    // therefore rebinds only the row that entered, not the whole window.
    const first = Math.max(0, Math.floor(this.content.scrollY / this.rowH) - this.overscan);
    const last = Math.min(this.items.length - 1, first + need - 1);
    const rowW = this.content.w;
    const hovered = this.engine?.hover?.target ?? null;
    const used = new Set();
    for (let index = first; index <= last; index++) {
      const slot = this._pool[index % poolN];
      used.add(slot);
      slot.node.visible = true;
      slot.node.setRect(0, index * this.rowH, rowW, this.rowH);
      if (slot.index !== index || slot.version !== this._version) {
        // a row rebinding under the cursor must not leave a stale tooltip showing
        if (hovered && (hovered === slot.node || slot.node.isAncestorOf(hovered))) {
          EldTooltip.hideNow();
        }
        slot.index = index;
        slot.version = this._version;
        this.renderRow(slot.node, this.items[index], index);
      }
    }
    for (const slot of this._pool) {
      if (!used.has(slot)) {
        // hiding the row under the cursor (list shrank / scrolled past the end) must
        // hide a consumer-attached tooltip too — same rule as the rebind branch above
        if (slot.node.visible && hovered && (hovered === slot.node || slot.node.isAncestorOf(hovered))) {
          EldTooltip.hideNow();
        }
        slot.node.visible = false; slot.index = -1;
      }
    }
  }

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

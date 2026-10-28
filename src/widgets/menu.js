// EldContextMenu: the right-click menu. One menu at a time, drawn on the dropdown layer
// in a stone dropdown frame; rows are 26px (the Select idiom) with a verdigris hover
// wash. Closes on entry click, Escape/gamepad-B (escape stack), or any press outside.
// Consumers wire it from the rightclick synthesis:
//   node.on('rightclick', (e) => { e.preventDefault(); EldContextMenu.show(entries, e.x, e.y); });
// Entries: [{ label, onClick, disabled }] or { separator: true }. Keyboard row
// navigation shipped: while open, ArrowUp/Down walk the enabled rows and
// Enter activates the highlighted one.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, METRICS } from '../theme.js';
import { VBox } from '../layoutbox.js';
import { uisound } from './widgets.js';
import { animateOut, isReducedMotion } from '../animate.js';

const ROW_H = 26;
const PAD = 6;
const MIN_W = 140;

export const EldContextMenu = {
  engine: null,
  node: null,
  isOpen: false,
  transitions: false, // Opt-in: close() fades the menu out before disposal
  _offEscape: null,
  _offDown: null,

  init(engine) {
    this.engine = engine;
    return this;
  },

  show(entries, x, y) {
    if (!this.engine) return this;
    if (this.isOpen) this.close();
    const eng = this.engine;

    const rows = (entries ?? []).filter((e) => e && (e.separator || e.label != null));
    if (!rows.length) return this;
    // a non-finite anchor (a bad rightclick payload) would place the menu at NaN and
    // paint an invisible, unreachable surface — clamp to the origin, the flip math
    // below re-fits it onto the viewport
    x = Number.isFinite(x) ? x : 0;
    y = Number.isFinite(y) ? y : 0;

    const menu = new UINode({ interactive: true, name: 'context-menu' });
    // B9: an open menu SEALS the wheel — the page beneath must not scroll under it
    menu.on('wheel', (e) => e.stopPropagation());
    const bg = new NineSliceNode(eng.textures.frame('dropdown.frame'));
    menu.add(bg);
    // rows ride a VBox — width-to-content comes from the box (the widest row
    // stretches its siblings), not a hand-measure loop; separators are fixed lanes
    const rowBox = new VBox({ gap: 0, align: 'stretch', minW: MIN_W - 6 });
    rowBox.setPos(3, PAD);
    const navRows = []; // enabled rows in order, for keyboard walking

    for (const e of rows) {
      if (e.separator) {
        const sep = new UINode({});
        sep.setSize(20, 7);
        const rule = new QuadNode({ color: COLORS.divider });
        sep.add(rule);
        sep.onLayout = () => rule.setRect(5, 3, sep.w - 10, 1);
        rowBox.add(sep);
        continue;
      }
      const row = new UINode({ interactive: true });
      // law: the hover wash rides the tokens, read at event time (the 0.12
      // hardcode predates the floors)
      const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      const label = new TextNode(e.label, {
        size: 13, color: e.disabled ? COLORS.textDisabled : COLORS.text,
        shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
      });
      row.add(wash, label);
      row.setSize(Math.ceil(label.w) + 28, ROW_H); // intrinsic: the box takes the widest
      row.onLayout = () => {
        wash.setRect(0, 0, row.w, row.h);
        label.setPos(12, Math.round((ROW_H - label.h) / 2));
      };
      if (!e.disabled) {
        const nav = { wash, entry: e };
        navRows.push(nav);
        row.on('pointerenter', () => {
          // sealed (or closing — close() flips the inert flag) menus stay dark and
          // SILENT: hover delivers into sealed subtrees by the tooltip rule, so the
          // seal lives here (the SaveSlotList form — the worst partial-seal member)
          if (row.closest((n) => n.disabled === true)) return;
          // one lit row at a time — hover takes over from any keyboard highlight
          this._navIndex = navRows.indexOf(nav);
          this._navHot = true; // a row is VISIBLY lit — Enter may activate
          navRows.forEach((r, i) => r.wash.setBaseOpacity(i === this._navIndex ? METRICS.washHover : 0));
          uisound(row, 'hover');
        });
        row.on('pointerleave', () => {
          wash.setBaseOpacity(0);
          // the ANCHOR survives leave by design (the r16 pinned law: one ArrowDown
          // from a left row continues from it) — but nothing is lit anymore, so the
          // hot latch drops: Enter must never activate a row no wash is showing
          this._navHot = false;
        });
        row.on('click', (evt) => {
          evt.stopPropagation();
          // a dying menu (transitions fade) or a sealed one must not fire entries —
          // the fade keeps real hit rects, and this is a SINGLETON reading live state
          if (row.closest((n) => n.disabled === true)) return;
          this.close(); // close first: the entry may open a popup that takes modal focus
          e.onClick?.();
        });
      }
      rowBox.add(row);
    }
    menu.add(rowBox);
    rowBox.onLayout(); // pre-measure (the box idiom): the flip math needs true w/h NOW
    const w = rowBox.w + 6;
    const h = rowBox.h + PAD * 2;
    bg.setRect(0, 0, w, h);

    // Keyboard rows: arrows walk the enabled entries, Enter activates. The menu
    // takes program focus while open (no ring for pointer users) and hands it back on
    // close only if it still holds it — an outside press moves focus on its own.
    this._navRows = navRows;
    this._navIndex = -1;
    this._navHot = false;
    menu.focusable = true;
    menu.on('keydown', (evt) => {
      const d = { ArrowDown: 1, ArrowUp: -1 }[evt.key];
      if (d) {
        evt.preventDefault();
        if (!navRows.length) return;
        const n = navRows.length;
        // -1 = nothing highlighted yet: ArrowDown starts on the first row, ArrowUp on
        // the last (the wrap formula below would land a fresh ArrowUp on n-2)
        if (this._navIndex < 0) this._navIndex = d > 0 ? 0 : n - 1;
        else this._navIndex = ((this._navIndex + d) % n + n) % n;
        this._navHot = true; // the walk lights its row — Enter is live again
        navRows.forEach((r, i) => r.wash.setBaseOpacity(i === this._navIndex ? METRICS.washHover : 0));
        return;
      }
      if (evt.key === 'Enter' && this._navIndex >= 0 && this._navHot) {
        evt.preventDefault();
        const entry = navRows[this._navIndex].entry;
        this.close();
        entry.onClick?.();
      }
    });
    this._prevFocus = eng.focusedNode ?? null;
    this._prevSource = eng.focus.source; // C1: hand back with the source we took over from
    eng.focus.set(menu, 'api');

    // Cursor placement with viewport flip (the tooltip rule: 10px margin).
    let mx = x, my = y;
    if (mx + w > eng.width - 10) mx = Math.max(10, x - w);
    if (my + h > eng.height - 10) my = Math.max(10, y - h);
    menu.setRect(Math.round(mx), Math.round(my), w, h);

    // Above a live modal the menu must overtop the scrim — it otherwise opens buried
    // and unusable while still topping the Escape stack (the recorded -era gap).
    // The overlay layer paints scrim-then-menu in add order; normal menus keep the
    // dropdown layer (a popup arriving LATER still supersedes by closing us). The flags
    // ride the engine because menu.js cannot import windows.js (windows imports menu);
    // spotlightActive is the twin — a Spotlight scrim also lives on overlay,
    // above the dropdown layer, so a menu opened mid-tutorial must rise the same way.
    (eng.modalActive || eng.spotlightActive ? eng.layers.overlay : eng.layers.dropdown).add(menu);
    this.node = menu;
    this.isOpen = true;
    this._offEscape = eng.focus.pushEscape(() => this.close());
    // Tab dismisses the open menu instead of walking focus behind it (// — the Tab-orphans-menu record); the press is consumed like an
    // outside-press, and the NEXT Tab traverses normally.
    this._offTab = eng.focus.interceptTab(() => { this.close(); return true; });
    // Any press that is not inside the menu dismisses it (capture the NEXT press).
    this._offDown = eng.bus.on('pointerdown', (e) => {
      if (e.target && menu.isAncestorOf(e.target)) return;
      if (e.target === menu) return;
      this.close();
    });
    menu.fxOpacity = 0;
    eng.ticker.tween(menu, { fxOpacity: 1 }, { dur: 0.1 });
    uisound(menu, 'open');
    return this;
  },

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    if (this._offTab) { this._offTab(); this._offTab = null; }
    if (this._offDown) { this._offDown(); this._offDown = null; }
    const menu = this.node;
    this.node = null;
    if (menu && this.engine?.focusedNode === menu) {
      const prev = this._prevFocus;
      // C1: never re-light a holder DISABLED while we were open (auto-blur only guards
      // the CURRENTLY focused node), and hand back with the captured source — a
      // keyboard-driven open keeps its focus ring through the close
      if (prev && !prev.disposed && !prev.closest((a) => a.disabled === true)) this.engine.focus.set(prev, this._prevSource ?? 'api');
      else this.engine.focus.clear();
    }
    this._prevFocus = null;
    this._prevSource = null;
    this._navRows = null;
    this._navIndex = -1;
    if (menu) {
      uisound(menu, 'close');
      // Opt-in (EldContextMenu.transitions = true): the menu fades out before
      // disposal; it is already orphaned from this object, so a new show() is clean.
      // The dying surface keeps REAL hit rects through the fade, so it goes INERT
      // (raw flag — no dim; the row handlers' closest(disabled) guards honor it):
      // a click or hover on a half-faded row must not fire entries or move _navIndex.
      menu.disabled = true;
      if (this.transitions === true && !isReducedMotion() && menu.engine) {
        animateOut(menu, 'fadeScale', { dur: 0.12 }).then(() => menu.dispose());
      } else {
        menu.dispose();
      }
    }
  },

  // Teardown hook: the node dies with the dropdown layer; drop refs and listeners.
  _reset() {
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    if (this._offTab) { this._offTab(); this._offTab = null; }
    if (this._offDown) { this._offDown(); this._offDown = null; }
    this.isOpen = false;
    this.node = null;
    this._prevFocus = null; // dead-tree refs must not survive into the next boot
    this._navRows = null;
    this._navIndex = -1;
    this.engine = null;
  },
};

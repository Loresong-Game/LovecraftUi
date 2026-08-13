// Game components: EventLog, Table, UnitFrame, Minimap, QuestTracker, CharacterPanel,
// SettingsPanel, plus the LovecraftUI bonus pieces: Globe (volumetric orb) and CastBar.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode, Accent3DNode } from '../primitives.js';
import { TextNode, compileMarkup, fontString, fontMetrics, wrapRuns } from '../text.js';
import { ScrollArea } from '../clip.js';
import { COLORS, FONTS, METRICS, socketInset } from '../theme.js';
import { makeResizable } from './grip.js';
import { clamp, column, contentRect, contentExtent } from '../layout.js';
import { EldTooltip, widgetsEngine, requireEngine, Button, commitChange, setNodeDisabled, uisound } from './widgets.js';
import { isReducedMotion } from '../animate.js';
import { EldEvents } from './events.js';
import { CpSlot, EldDragDrop } from './dragdrop.js';
import { VirtualList } from './virtual.js';
import { makeOrbMesh } from '../fx.js';
import { str } from '../strings.js';

const tex = (name) => requireEngine().textures.get(name); // friendly pre-init throw
const frame = (name) => requireEngine().textures.frame(name);

function componentScrollSkin() {
  return {
    track: tex('scrollbar.track'),
    thumb: frame('scrollbar.thumb.normal'),
    thumbHover: frame('scrollbar.thumb.hover'),
    thumbPressed: frame('scrollbar.thumb.pressed'),
    trackH: tex('scrollbar.trackH'),
    thumbH: frame('scrollbar.thumbH.normal'),
    thumbHHover: frame('scrollbar.thumbH.hover'),
    thumbHPressed: frame('scrollbar.thumbH.pressed'),
  };
}

// ---------------- EventLog ----------------

// The shared line pitch (both modes; the 1.0 constant the whole scrollback
// geometry — trims, pins, pooled rows — has always assumed).
const LOG_ROW = 18;

export class EventLog extends UINode {
  constructor(opts = {}) {
    super({});
    this.bg = new NineSliceNode(frame('panel.dark'));
    // Opt-in: `virtual: true` windows the scrollback — entries become DATA
    // records ({segs, lineN}) over pooled rows, so GPU cost is one screenful while
    // the history itself is UNBOUNDED (maxEntries still trims the data when set).
    // The wrap law: the pooled items are the entries' WRAPPED visual lines
    // (this._lines), so a long entry windows as several fixed-height rows.
    this.virtual = opts.virtual === true;
    if (this.virtual) {
      this.scroll = new VirtualList({
        skin: componentScrollSkin(), rowH: LOG_ROW,
        renderRow: (node, item) => {
          if (!node._line) {
            // items are PRE-WRAPPED to the lane, so the clamp is a guard for the
            // odd sub-pixel overshoot, not the reading path (kept)
            node._line = new TextNode('', { font: FONTS.mono, size: 12, maxWidth: this.w - 40, multiline: false, ellipsis: true });
            node._line.setPos(8, 3);
            node.add(node._line);
          }
          // pooled rows outlive resizes — re-clamp to the CURRENT lane every
          // bind (setMaxWidth early-returns on the same value, so steady state is free)
          node._line.setMaxWidth(this.w - 40);
          node._line.setSegments(item.segs);
          // re-evaluated EVERY bind — a pooled line rebinding from a linked entry
          // to a link-free one flips back to inert (zero delta for link-free logs)
          node._line.interactive = item.segs.some((sg) => sg.link !== undefined);
        },
      });
      this.maxEntries = opts.maxEntries ?? Infinity;
      this._lines = []; // the flattened visual lines the list windows
    } else {
      this.scroll = new ScrollArea({ skin: componentScrollSkin() });
      this.maxEntries = opts.maxEntries ?? 150;
    }
    this.add(this.bg, this.scroll);
    this.setSize(opts.width ?? 380, opts.height ?? 200);
    // opt-in resize grip; the grip's pin duck-type keeps an
    // at-bottom reader pinned through the resize
    this.grip = null;
    if (opts.resizable) {
      const r = opts.resizable === true ? {} : opts.resizable;
      this.grip = makeResizable(this, {
        corner: r.corner ?? 'tl', minW: r.minW ?? 200, minH: r.minH ?? 90,
        maxW: r.maxW, maxH: r.maxH, onResize: r.onResize,
      });
    }
    this.entries = [];
    // Opt-in: parse appended MESSAGES for {color}/{icon}/{b}/{i} runs. The
    // timestamp/type prefix stays library-styled; unstyled runs keep the message color.
    this.markup = opts.markup === true;
    if (opts.register !== false) EldEvents.register(this);
  }

  _buildSegs(ts, type, message) {
    const segs = [
      { text: ts + ' ', color: COLORS.textFaint },
      { text: type + ' ', color: COLORS.eventType },
    ];
    if (this.markup) {
      for (const s of compileMarkup(message, { font: FONTS.mono, size: 12 })) {
        segs.push(s.icon !== undefined ? s : { ...s, color: s.color ?? COLORS.positive });
      }
    } else {
      segs.push({ text: message, color: COLORS.positive });
    }
    return segs;
  }

  // ---- the wrap law: a log line WRAPS at the lane instead
  // of ellipsizing — these boxes exist to show LONG text, and a message you cannot
  // read is a message the widget swallowed. Both modes share the geometry: the
  // legacy LOG_ROW pitch per visual line, so single-line histories are bit-stable
  // against every shipped baseline and pin.
  _lineFont() { return fontString({ size: 12, font: FONTS.mono }); }
  _wrapW() { return Math.max(24, this.w - 40); }
  // one entry's segs -> its wrapped visual lines (virtual mode's item records)
  _wrapEntry(segs) {
    const font = this._lineFont();
    const lines = wrapRuns(segs, font, this._wrapW(), 0, fontMetrics(font, 12).height);
    return lines.map((l) => ({ segs: l.length ? l : [{ text: '' }] }));
  }
  // inter-entry lead: a single-line entry advances exactly LOG_ROW (the legacy
  // pitch), a wrapped one by its measured height plus the same breathing gap
  _lead() { return LOG_ROW - fontMetrics(this._lineFont(), 12).height; }
  _restack() {
    let y = 6;
    for (const line of this.entries) { line.setPos(8, y); y += line.h + this._lead(); }
  }

  append(ts, type, message) {
    // pin-to-bottom: capture the predicate BEFORE any mutation (virtual setItems
    // moves contentH synchronously) — append follows the tail only when the reader
    // was already there; a scrolled-up reading position is never yanked.
    const wasAtBottom = this.scroll.content.scrollY >= this.scroll.maxScroll - 1;
    const segs = this._buildSegs(ts, type, message);
    if (this.virtual) {
      // windowed: one entry -> its wrapped lines; push data, rebind, pin the tail
      const lines = this._wrapEntry(segs);
      this.entries.push({ segs, lineN: lines.length });
      this._lines.push(...lines);
      let removed = 0;
      if (this.entries.length > this.maxEntries) {
        // trim by ENTRY: the oldest record leaves with ALL its wrapped lines
        removed = this.entries.shift().lineN;
        this._lines.splice(0, removed);
      }
      this.scroll.setItems(this._lines);
      if (wasAtBottom) this.scroll.scrollToBottom();
      // the trim slid all content up; compensate or a scrolled-up reader creeps
      // one entry per append and the pin's held position is a fiction
      else if (removed) this.scroll.setScroll(this.scroll.content.scrollY - removed * LOG_ROW);
      return;
    }
    // the line node WRAPS at the lane (maxWidth + multiline); lineHeight pins the
    // wrapped pitch to the legacy rows, so the stack reads as one column of lines
    const line = new TextNode('', { font: FONTS.mono, size: 12, maxWidth: this._wrapW(), multiline: true, lineHeight: LOG_ROW });
    line.setSegments(segs);
    // only lines whose segs carry {link:} runs take hits — link-free logs keep
    // today's hover/wheel/pan behavior bit-identical (the Table pooled-row precedent)
    line.interactive = segs.some((sg) => sg.link !== undefined);
    const prev = this.entries[this.entries.length - 1];
    line.setPos(8, prev ? prev.y + prev.h + this._lead() : 6);
    this.entries.push(line);
    this.scroll.content.add(line);
    let removedH = 0;
    if (this.entries.length > this.maxEntries) {
      const old = this.entries.shift();
      removedH = old.h + this._lead(); // the trimmed entry's REAL stack advance
      old.dispose();
      this._restack();
    }
    this.invalidateLayout();
    if (wasAtBottom) this.scroll.scrollToBottom(); // pins using the NEXT layout pass's measurement
    // the trim restacked every line up by the removed height; hold the reader still
    else if (removedH) this.scroll.setScroll(this.scroll.content.scrollY - removedH);
  }

  // the pin predicate, live — append() follows the tail only while this is true.
  get atBottom() { return this.scroll.content.scrollY >= this.scroll.maxScroll - 1; }

  // the explicit re-pin (a "jump to now" affordance builds on these two).
  scrollToBottom() { this.scroll.scrollToBottom(); }

  // the pin holds through ANY resize, not only the grip's — the contract
  // reads "pin-to-bottom holds through resize", and a consumer's resize IS a resize.
  // Same idiom as the grip: read the pin BEFORE the mutation. (ScrollArea's
  // scrollToBottom pins against the NEXT layout pass's measurement, so this is
  // stale-proof — the append path above rides the same mechanism.)
  // the hook hangs on setRect, THE funnel — setSize/setPos both delegate down
  // to it (node.js), so a setSize override is invisible to every setRect caller. The
  // grip drives its drags with host.setRect, which is exactly how the lane clamp
  // below went dead: a warlog dragged to its floor kept the wider appended clamp and
  // spilled a horizontal rail. Position-only writes fall through the size guard.
  setRect(x, y, w, h) {
    if (w === this.w && h === this.h) return super.setRect(x, y, w, h);
    const pin = this.scroll ? this.atBottom === true : false;
    super.setRect(x, y, w, h);
    if (pin) this.scrollToBottom();
  }

  // Write a line directly into THIS log (EldEvents.log routes to the registered sink).
  log(message, type = 'EVENT') {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.append(`[${ts}]`, type, message);
  }

  clear() {
    if (this.virtual) {
      this.entries.length = 0;
      this._lines.length = 0;
      this.scroll.setItems([]);
      this.scroll.setScroll(0);
      return;
    }
    for (const line of this.entries) line.dispose();
    this.entries.length = 0;
    this.scroll.setScroll(0);
    this.invalidateLayout();
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    // scroll box = the panel frame's content box, so the overlay scrollbar clears the border
    const c = contentRect(this.bg.frame, this.w, this.h);
    this.scroll.setRect(c.x, c.y, c.w, c.h);
    // re-seated @lines clamp to the width they were APPENDED at, so a
    // narrowed log must re-clamp to the LIVE lane or old rows spill a horizontal
    // rail. Deriving it here (not in a geometry setter) means EVERY path that moves
    // the box — grip drag, consumer setRect/setSize, a parent's layout — lands the
    // same clamp; the _laneW latch keeps the steady state free.
    if (this._laneW !== this.w) {
      this._laneW = this.w;
      if (this.virtual) {
        // the wrap law rides the lane: REWRAP every entry at the live width (a
        // narrowed log grows lines, a widened one hands them back), then force
        // the rebind — a resize alone never rebinds a pool
        if (this.entries?.length) {
          const lines = [];
          for (const en of this.entries) {
            const w = this._wrapEntry(en.segs);
            en.lineN = w.length;
            lines.push(...w);
          }
          this._lines = lines;
          this.scroll.setItems(this._lines);
        }
        this.scroll.refresh?.();
      } else {
        // entries lands after the ctor's own setSize — hence the guards. setMaxWidth
        // REWRAPS each entry (heights move), so the stack re-derives afterwards.
        for (const line of (this.entries ?? [])) line.setMaxWidth?.(this._wrapW());
        if (this.entries?.length) this._restack();
      }
    }
  }

  disposeSelf() { EldEvents.unregister(this); }
}

// ---------------- Table ----------------

export class Table extends UINode {
  constructor(opts = {}) {
    super({});
    // [{label, width}] — B5: finite-first per column: one NaN width poisons every
    // cell x after it, tableW, and the header/body rects (records copied; floor 1)
    this.columns = opts.columns.map((c) => ({ ...c, width: Number.isFinite(c.width) ? Math.max(1, c.width) : 120 }));
    this.rowsData = (opts.rows ?? []).map(r => [...r]);
    this.sort = { column: -1, ascending: true };
    this.headerH = 36;
    this.rowH = 32;

    this.headerBg = new NineSliceNode(frame('table.header'));
    this.add(this.headerBg);
    this.headerCells = [];
    this.indicators = [];
    let cx = 0;
    this.columns.forEach((col, ci) => {
      const cell = new UINode({ interactive: true, name: 'th-' + ci });
      cell.setRect(cx, 0, col.width, this.headerH);
      const label = new TextNode(col.label, {
        font: FONTS.header, size: 14, color: COLORS.accent, smallCaps: true,
        shadow: { color: 'rgba(0,0,0,0.8)', dx: 1, dy: 1, blur: 2 },
      });
      label.setPos(12, Math.round((this.headerH - label.h) / 2));
      // The sort arrow is an OVERLAY, not a flow item: right-anchored in the
      // header cell, sized to be SEEN (the 12px inline speck read as a dot),
      // and never a participant in column math — the label keeps its
      // measurements and the cell its width whether an arrow shows or not.
      const ind = new TextNode(' ', {
        size: 15, color: COLORS.accent,
        shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 3 },
      });
      ind._seat = () => ind.setPos(col.width - ind.w - 6, Math.round((this.headerH - ind.h) / 2));
      ind._seat();
      ind.fxOpacity = 0.5;
      cell.add(label, ind);
      cell.on('click', () => this.sortByColumn(ci));
      this.indicators.push(ind);
      this.headerCells.push(cell);
      this.add(cell);
      cx += col.width;
    });
    this.tableW = cx;

    // virtual: true (or a viewport height in px) pools rows over a VirtualList —
    // the full rowsData model stays resident and sortable, only visible rows render.
    this.virtual = opts.virtual ? (typeof opts.virtual === 'number' ? opts.virtual : 300) : 0;
    this.rowNodes = [];
    if (this.virtual) {
      this.vlist = new VirtualList({
        rowH: this.rowH,
        renderRow: (node, row, i) => this._renderVirtualRow(node, row, i),
      });
      this.add(this.vlist);
      this.vlist.setItems(this.rowsData);
      this.setSize(cx, this.headerH + this.virtual);
    } else {
      this._buildRows();
      this.setSize(cx, this.headerH + this.rowsData.length * this.rowH);
    }

    // Boot sort — opts.sort: { column, ascending } orders the model before first
    // paint, SILENTLY: construction is not an interaction, so no `sort` event and
    // no ledger line (a loud boot sort would stamp wall-clock timestamps into
    // frozen shots). Header clicks toggle from this state exactly as if it had
    // been clicked into place, and living-data mutators re-apply it.
    if (opts.sort && Number.isInteger(opts.sort.column)
        && opts.sort.column >= 0 && opts.sort.column < this.columns.length) {
      // isInteger, not isFinite: a fractional column passed every
      // bound above and then indexed a hole — this.indicators[2.5].setText
      // threw out of the constructor (the B5 finite-first idiom two lines up
      // guards NaN, not holes)
      this.sort = { column: opts.sort.column, ascending: opts.sort.ascending !== false };
      this._applySort();
      const ind = this.indicators[this.sort.column];
      ind.setText(this.sort.ascending ? '▲' : '▼');
      ind._seat();
      ind.fxOpacity = 1;
      this.invalidateLayout();
    }
  }

  _renderVirtualRow(node, row, i) {
    if (!node._cells) {
      node.interactive = true;
      node._bg = new QuadNode({ texture: tex('table.row') });
      node.add(node._bg);
      node._cells = this.columns.map((col) => {
        const t = new TextNode('', { size: 13, color: COLORS.text, maxWidth: col.width - 20, ellipsis: true });
        node.add(t);
        return t;
      });
      node.on('pointerenter', () => { node._hovered = true; node._bg.setTexture(tex('table.rowHover')); });
      node.on('pointerleave', () => { node._hovered = false; node._bg.setTexture(tex(node._stripeEven ? 'table.row' : 'table.rowAlt')); });
      node.on('click', () => this.dispatch('rowclick', { row: node._row, index: this.rowsData.indexOf(node._row) }));
    }
    node._row = row;
    node._stripeEven = i % 2 === 0;
    // a rebind under a stationary cursor (sort/refresh) must keep the hover wash —
    // pooled rows get no fresh pointerenter, so re-derive it from the live hover
    const hov = this.engine?.hover?.target ?? null;
    node._hovered = !!(hov && (hov === node || node.isAncestorOf(hov)));
    node._bg.setTexture(tex(node._hovered ? 'table.rowHover' : node._stripeEven ? 'table.row' : 'table.rowAlt'));
    node._bg.setRect(0, 0, this.tableW, this.rowH);
    let cx = 0;
    // iterate the COLUMNS, not the row: pooled cells past a ragged row's length would
    // otherwise keep the text of whatever row they were bound to last
    this.columns.forEach((col, ci) => {
      const t = node._cells[ci];
      t.setText(String(row[ci] ?? ''));
      t.setPos(cx + 12, Math.round((this.rowH - t.h) / 2));
      cx += col.width;
    });
  }

  _buildRows() {
    for (const r of this.rowNodes) r.node.dispose();
    this.rowNodes = [];
    this.rowsData.forEach((row) => {
      const node = new UINode({ interactive: true });
      const bg = new QuadNode({ texture: tex('table.row') });
      node.add(bg);
      let cx = 0;
      row.forEach((val, ci) => {
        const t = new TextNode(String(val), { size: 13, color: COLORS.text, maxWidth: this.columns[ci].width - 20, ellipsis: true });
        t.setPos(cx + 12, Math.round((this.rowH - t.h) / 2));
        node.add(t);
        cx += this.columns[ci].width;
      });
      node.on('pointerenter', () => { node._hovered = true; bg.setTexture(tex('table.rowHover')); });
      node.on('pointerleave', () => { node._hovered = false; bg.setTexture(tex(this._stripe(node) ? 'table.row' : 'table.rowAlt')); });
      node.on('click', () => this.dispatch('rowclick', { row, index: this.rowsData.indexOf(row) }));
      if (row.length >= 4) {
        // label-driven: the 1.0 form hardcoded `Level {row[2]} {row[1]}`
        // / `Role: {row[3]}` — the flagship's old column order baked into every
        // consumer's hover; a roster table read gibberish. The labels are the truth.
        EldTooltip.attach(node, () => ({
          title: String(row[0]),
          lines: this.columns.slice(1).map((c, i) => ({
            text: `${c.label}: ${row[i + 1]}`, color: COLORS.textMuted,
          })),
        }));
      }
      node._bg = bg;
      node._row = row;
      this.rowNodes.push({ node, row });
      this.add(node);
    });
  }

  _stripe(node) {
    const idx = this.rowNodes.findIndex(r => r.node === node);
    return idx % 2 === 0;
  }

  sortByColumn(ci) {
    if (this.sort.column === ci) this.sort.ascending = !this.sort.ascending;
    else { this.sort.column = ci; this.sort.ascending = true; }
    this._applySort();
    this.indicators.forEach((ind, i) => {
      if (i === this.sort.column) { ind.setText(this.sort.ascending ? '▲' : '▼'); ind.fxOpacity = 1; }
      else { ind.setText(' '); ind.fxOpacity = 0.5; }
      ind._seat();
    });
    this.dispatch('sort', { column: this.sort.column, ascending: this.sort.ascending });
    EldEvents.log(str('tableSorted', ci + 1, str(this.sort.ascending ? 'sortAscending' : 'sortDescending')), 'TABLE');
    this.invalidateLayout();
  }

  // Sorts the current model by the active sort (a no-op before any header click).
  _applySort() {
    const ci = this.sort.column;
    if (ci < 0) return;
    const asc = this.sort.ascending;
    const cmp = (rowA, rowB) => {
      const av = String(rowA[ci]).trim(), bv = String(rowB[ci]).trim();
      const an = parseFloat(av), bn = parseFloat(bv);
      const c = (!isNaN(an) && !isNaN(bn)) ? an - bn : av.localeCompare(bv);
      return asc ? c : -c;
    };
    if (this.virtual) {
      this.rowsData.sort(cmp);   // the model sorts; visible rows rebind on refresh
      this.vlist.refresh();
    } else {
      this.rowsData.sort(cmp);
      this.rowNodes.sort((a, b) => cmp(a.row, b.row));
    }
  }

  // ---- living-data mutators: the active sort re-applies after every change ----

  getRows() { return this.rowsData.map(r => [...r]); }

  setRows(rows) {
    this.rowsData = (rows ?? []).map(r => [...r]);
    this._afterModelChange();
  }

  addRow(row) {
    this.rowsData.push([...row]);
    this._afterModelChange();
  }

  removeRow(index) {
    if (index < 0 || index >= this.rowsData.length) return false;
    this.rowsData.splice(index, 1);
    this._afterModelChange();
    return true;
  }

  updateCell(rowIndex, colIndex, value) {
    const row = this.rowsData[rowIndex];
    if (!row || colIndex < 0 || colIndex >= row.length) return false;
    row[colIndex] = value;
    this._afterModelChange();
    return true;
  }

  _afterModelChange() {
    this._applySort();
    if (this.virtual) {
      this.vlist.setItems(this.rowsData);
    } else {
      this._buildRows();
      this.setSize(this.tableW, this.headerH + this.rowsData.length * this.rowH);
    }
    this.invalidateLayout();
  }

  onLayout() {
    this.headerBg.setRect(0, 0, this.tableW, this.headerH);
    if (this.virtual) {
      this.vlist.setRect(0, this.headerH, this.tableW, this.virtual);
      return;
    }
    this.rowNodes.forEach(({ node }, i) => {
      node.setRect(0, this.headerH + i * this.rowH, this.tableW, this.rowH);
      node._bg.setRect(0, 0, this.tableW, this.rowH);
      if (!node._hovered) node._bg.setTexture(tex(i % 2 === 0 ? 'table.row' : 'table.rowAlt'));
    });
  }

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

// ---------------- UnitFrame ----------------

class StatBar extends UINode {
  constructor(fillTex, opts = {}) {
    super({});
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.fill = new QuadNode({ texture: tex(fillTex) });
    // the fill deliberately tucks under the frame lip (2px inset vs the panel's
    // declared content box) — classic bar art, declared per the allowance rule
    this.fill.auditAllow('containment');
    this.text = new TextNode('', { size: 10, color: COLORS.textWhite, shadow: { color: '#000', dx: 1, dy: 1, blur: 1 } });
    this.add(this.bg, this.fill, this.text);
    this.pct = opts.pct ?? 100;
    this._displayPct = this.pct;
  }
  set(cur, max, animate = true) {
    // finite-first: a NaN max reads an empty 0/0 bar, never a "N/NaN" label (the
    // clamp value-guard already handles the fill; the TEXT was the leak — Math.round(NaN))
    cur = Number.isFinite(cur) ? cur : 0;
    max = Number.isFinite(max) ? max : 0;
    this.pct = max > 0 ? (cur / max) * 100 : 0;
    this.text.setText(`${Math.round(cur)}/${Math.round(max)}`);
    const eng = widgetsEngine();
    if (animate && eng) {
      eng.ticker.tween(this, { _displayPct: this.pct }, { dur: 0.3, onUpdate: () => this.invalidateLayout() });
    } else {
      this._displayPct = this.pct;
      this.invalidateLayout();
    }
  }
  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    const inner = this.w - 4;
    this.fill.setRect(2, 2, Math.max(0, Math.round(inner * clamp(this._displayPct, 0, 100) / 100)), this.h - 4);
    this.fill.visible = this._displayPct > 1;
    this.text.setPos(this.w - this.text.w - 6, Math.round((this.h - this.text.h) / 2));
  }
}

// The buff/debuff strip: a public, reusable row of effect sigils. UnitFrame hosts one
// below its plate; consumers can place one anywhere. Clicking a sigil dispatches
// `effectclick {name, node}` on the bar (UnitFrame re-dispatches it on itself).
export class EffectBar extends UINode {
  constructor() {
    super({});
    this._resize(); // self-sizes as sigils come and go, so it can truly be placed anywhere
  }

  // 24px sigils (the interactive hit floor) on a 27px pitch, no trailing
  // gap: n sigils -> 27n - 3. Sized at mutation time (not in onLayout) so hosts
  // can read .w when laying the bar out.
  _resize() { this.setSize(Math.max(0, this.children.length * 27 - 3), 24); }

  addEffect({ icon, name, desc, duration, buff = true }) {
    const fx = new UINode({ interactive: true });
    const S = 24;
    const border = new QuadNode({ color: buff ? 0x2e6b4f : 0x6b2e2e, opacity: 0.95 });
    const inner = new QuadNode({ color: 0x050807, opacity: 0.9 });
    const ic = new QuadNode({ texture: tex(`icon.${icon}`) });
    fx.add(border, inner, ic);
    fx.setSize(S, S);
    border.setRect(0, 0, S, S);
    inner.setRect(1, 1, S - 2, S - 2);
    ic.setRect(2, 2, S - 4, S - 4);
    fx.effectName = name;
    // the sigil is CLICKABLE (dispel/inspect), so press must read — the icon
    // dips under the finger; hover feedback is the tooltip (attached below)
    fx.on('pointerdown', () => { if (!fx.closest((a) => a.disabled === true)) ic.setBaseOpacity(0.6); });
    fx.on('pointerup', () => ic.setBaseOpacity(1));
    fx.on('pointerleave', () => ic.setBaseOpacity(1));
    fx.on('click', () => this.dispatch('effectclick', { name, node: fx }));
    EldTooltip.attach(fx, {
      title: name,
      titleColor: buff ? COLORS.positive : COLORS.negative,
      desc,
      lines: duration ? [{ text: duration, color: COLORS.textFaint }] : [],
    });
    this.add(fx);
    this._resize();
    this.invalidateLayout();
    return fx;
  }

  removeEffect(fx) {
    if (!fx || fx.parent !== this) return false;
    fx.dispose();
    this._resize();
    this.invalidateLayout();
    return true;
  }

  clearEffects() {
    for (const fx of [...this.children]) fx.dispose();
    this._resize();
    this.invalidateLayout();
  }

  // A standalone bar rows its own sigils; UnitFrame only places the bar node.
  onLayout() {
    let ex = 0;
    for (const fx of this.children) { fx.setPos(ex, 0); ex += 27; } // 24px + 3 gap
  }

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

export class UnitFrame extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    this.bg = new QuadNode({ texture: tex('unitframe.bg') });
    this.portrait = new QuadNode({ texture: tex(opts.portrait ?? 'portrait.player') });
    this.ring = new QuadNode({ texture: tex('avatar.ring') });
    this.nameNode = new TextNode(opts.name ?? 'Unknown', {
      font: FONTS.header, size: 15, weight: '600',
      color: opts.nameColor ?? COLORS.bone,
      shadow: { color: 'rgba(0,0,0,0.9)', dx: 1, dy: 1, blur: 2 },
      maxWidth: 140, ellipsis: true,
    });
    this.healthBar = new StatBar('fill.health');
    this.manaBar = new StatBar('fill.mana');
    this.levelBadge = new QuadNode({ texture: tex('level.badge') });
    this.levelText = new TextNode(String(opts.level ?? 1), { size: 12, weight: 'bold', color: COLORS.accent, shadow: { color: '#000', dx: 1, dy: 1, blur: 1 } });
    this.add(this.bg, this.portrait, this.ring, this.nameNode, this.healthBar, this.manaBar, this.levelBadge, this.levelText);
    this.effectsRow = new EffectBar();
    // effectclick reaches this frame by bubbling from the EffectBar child — a re-dispatch
    // here would double-fire every consumer listener
    this.add(this.effectsRow);
    this._plateH = 90; // the stone plate; the node is taller so the effects strip stays inside it
    this.setSize(250, 118);
    // finite-first on max (the NaN class): `?? 100` catches only null/undefined, so a
    // NaN pair element would flow into clamp/render as NaN (StatBar guards the leaf, but
    // the stored max must not perpetuate through setHealth(cur)'s `max = this.health.max`)
    this.health = { cur: opts.health?.[0] ?? 100, max: Number.isFinite(opts.health?.[1]) ? opts.health[1] : 100 };
    this.mana = { cur: opts.mana?.[0] ?? 100, max: Number.isFinite(opts.mana?.[1]) ? opts.mana[1] : 100 };
    this.healthBar.set(this.health.cur, this.health.max, false);
    this.manaBar.set(this.mana.cur, this.mana.max, false);
  }

  setHealth(cur, max = this.health.max) {
    if (!Number.isFinite(max)) max = this.health.max; // never store a NaN max (it perpetuates)
    this.health = { cur: clamp(cur, 0, max), max };
    this.healthBar.set(this.health.cur, max);
  }

  setMana(cur, max = this.mana.max) {
    if (!Number.isFinite(max)) max = this.mana.max;
    this.mana = { cur: clamp(cur, 0, max), max };
    this.manaBar.set(this.mana.cur, max);
  }

  addEffect(spec) { return this.effectsRow.addEffect(spec); }
  removeEffect(fx) { return this.effectsRow.removeEffect(fx); }
  clearEffects() { this.effectsRow.clearEffects(); }

  setName(name) { this.nameNode.setText(name); this.invalidateLayout(); }
  setLevel(level) { this.levelText.setText(String(level)); this.invalidateLayout(); }
  setPortrait(texName) { this.portrait.setTexture(tex(texName)); }

  onLayout() {
    const plate = this._plateH;
    this.bg.setRect(0, 0, this.w, plate);
    this.portrait.setRect(16, 17, 56, 56);
    this.ring.setRect(13, 14, 62, 62);
    this.nameNode.setPos(86, 12);
    this.healthBar.setRect(84, 32, this.w - 98, 20);
    this.manaBar.setRect(84, 55, this.w - 98, 20);
    this.levelBadge.setRect(4, plate - 30, 26, 26);
    this.levelText.setPos(4 + Math.round((26 - this.levelText.w) / 2), plate - 30 + Math.round((26 - this.levelText.h) / 2));
    // effect sigils sit in a row just below the plate — inside the widget's own rect,
    // so an ancestor clip region never crops them away. The bar sizes and rows itself
    // (EffectBar._resize/onLayout); this frame only right-aligns the bar node.
    this.effectsRow.setPos(this.w - 10 - this.effectsRow.w, plate + 3);
  }

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

// ---------------- Minimap ----------------

export class Minimap extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    const eng = widgetsEngine();
    this.zoom = 1;
    this._zoomDisplay = 1;

    this.mapQuad = new QuadNode({ texture: tex('minimap.image') });
    this.mapQuad.material.alphaMap = tex('minimap.maskCircle');
    this.mapQuad.material.needsUpdate = true;
    // the map texture zooms via UV transform; the circular alpha mask stays fixed
    this.mapTex = this.mapQuad.material.map;
    this.mapTex.matrixAutoUpdate = true;

    this.frameQuad = new QuadNode({ texture: tex('minimap.frame') });
    this.pin = new QuadNode({ texture: tex('minimap.pin') });
    this._applyHeading(-Math.PI / 4); // initial 45deg heading
    this.add(this.mapQuad, this.frameQuad);

    this.markers = [];
    this.add(this.pin);

    // zoom buttons
    this.btnIn = this._zoomBtn('+', () => this.zoomBy(1));
    this.btnOut = this._zoomBtn('−', () => this.zoomBy(-1));
    this.add(this.btnIn, this.btnOut);

    // zone label
    this.zonePlaque = new QuadNode({ texture: tex('minimap.zone') });
    this.zoneName = new TextNode(opts.zone ?? str('minimapZone'), { font: FONTS.header, size: 13, color: COLORS.accent, smallCaps: true });
    this.zoneLevel = new TextNode(opts.zoneLevel ?? '', { size: 11, color: COLORS.textFaint });
    this.add(this.zonePlaque, this.zoneName, this.zoneLevel);

    this.edgeArrow = new TextNode('▲', { size: 14, color: COLORS.accent, shadow: { color: '#000', dx: 0, dy: 0, blur: 3 } });
    this.add(this.edgeArrow);

    this.setSize(200, 236); // 200 map + zone label below
    void eng;
  }

  _zoomBtn(glyph, onClick) {
    const b = new UINode({ interactive: true });
    const bg = new QuadNode({ texture: tex('minimap.btn') });
    const t = new TextNode(glyph, { size: 17, weight: 'bold', color: COLORS.accent });
    // the multiply-tint hover is DEAD (tinting a dark texture darker read as
 // nothing — named example). A wash at the floors + a press state.
    const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    b.add(bg, t, wash);
    b.setSize(28, 28);
    bg.setRect(0, 0, 28, 28);
    wash.setRect(0, 0, 28, 28);
    t.setPos(Math.round((28 - t.w) / 2), Math.round((28 - t.h) / 2) - 1);
    let hov = false;
    b.on('pointerenter', () => { if (!b.closest((n) => n.disabled === true)) { hov = true; wash.setBaseOpacity(METRICS.washHover); } });
    b.on('pointerleave', () => { hov = false; wash.setBaseOpacity(0); });
    b.on('pointerdown', () => wash.setBaseOpacity(METRICS.washPress));
    b.on('pointerup', (e) => wash.setBaseOpacity(!e.canceled && hov ? METRICS.washHover : 0));
    b.on('click', onClick);
    b._wash = wash;
    return b;
  }

  setDisabled(v) {
    setNodeDisabled(this, v);
    // a cursor parked on a zoom button or marker gets no leave when the seal
    // lands — douse washes and settle marker fx to rest (B1 class sweep)
    if (v) {
      this.btnIn._wash.setBaseOpacity(0);
      this.btnOut._wash.setBaseOpacity(0);
      for (const m of this.markers) { m.fxScale = 1; m.visual.setBaseOpacity(1); }
    }
  }

  addMarker(kind, xPct, yPct, spec) {
    // kind: 'enemy' | 'ally' | 'quest-exclaim' | 'quest-question'
    const isDot = kind === 'enemy' || kind === 'ally';
    const texName = kind === 'enemy' ? 'dot.enemy' : kind === 'ally' ? 'dot.ally' : kind === 'quest-exclaim' ? 'mark.exclaim' : 'mark.question';
    // the marker is a 24px hit zone (the interactive floor) carrying its small
    // visual centered inside — a 10px dot stays a 10px dot on the glass, but a finger
    // can actually land on it. Zone rects may touch where visuals don't: declared.
    const m = new UINode({ interactive: true });
    const size = isDot ? 10 : 16;
    m.visual = new QuadNode({ texture: tex(texName) });
    m.visual.setRect(Math.round((24 - size) / 2), Math.round((24 - size) / 2), size, size);
    m.add(m.visual);
    m.setSize(24, 24);
    m.auditAllow('overlap');
    m.marker = { xPct, yPct, kind };
    if (isDot) {
      m.on('pointerenter', () => { const g = widgetsEngine(); if (!g) return; if (isReducedMotion()) { g.ticker.cancelPropTween(m, 'fxScale'); m.fxScale = 1.3; } else g.ticker.tween(m, { fxScale: 1.3 }, { dur: 0.1 }); });
      m.on('pointerleave', () => { const g = widgetsEngine(); if (!g) return; if (isReducedMotion()) { g.ticker.cancelPropTween(m, 'fxScale'); m.fxScale = 1; } else g.ticker.tween(m, { fxScale: 1 }, { dur: 0.1 }); });
    }
    const defaults = {
      enemy: { title: str('markerEnemyTitle'), titleColor: COLORS.negative, desc: str('markerEnemyDesc') },
      ally: { title: str('markerAllyTitle'), titleColor: COLORS.positive, desc: str('markerAllyDesc') },
      'quest-exclaim': { title: str('markerQuestTitle'), titleColor: COLORS.quest, desc: str('markerQuestBangDesc') },
      'quest-question': { title: str('markerQuestTitle'), titleColor: COLORS.quest, desc: str('markerQuestAskDesc') },
    };
    EldTooltip.attach(m, spec ?? defaults[kind]);
    // markers are CLICKABLE (markerclick), so press must read — the visual
    // dips under the finger (dots also carry the hover grow above)
    m.on('pointerdown', () => { if (!m.closest((a) => a.disabled === true)) m.visual.setBaseOpacity(0.55); });
    m.on('pointerup', () => m.visual.setBaseOpacity(1));
    m.on('pointerleave', () => m.visual.setBaseOpacity(1));
    m.on('click', () => this.dispatch('markerclick', {
      kind: m.marker.kind, xPct: m.marker.xPct, yPct: m.marker.yPct, node: m,
    }));
    this.markers.push(m);
    this.add(m);
    this.invalidateLayout();
    return m;
  }

  removeMarker(m) {
    if (!m || !this.markers.includes(m)) return false;
    m.dispose(); // the layout pass prunes disposed markers from the list
    this.invalidateLayout();
    return true;
  }

  clearMarkers() {
    for (const m of [...this.markers]) m.dispose();
    this.markers.length = 0;
    this.invalidateLayout();
  }

  moveMarker(m, xPct, yPct) {
    if (!m?.marker) return false;
    m.marker.xPct = xPct;
    m.marker.yPct = yPct;
    this.invalidateLayout();
    return true;
  }

  setZone(zone, zoneLevel) {
    this.zoneName.setText(zone ?? '');
    if (zoneLevel !== undefined) this.zoneLevel.setText(zoneLevel ?? '');
    this.invalidateLayout();
  }

  // Heading in degrees, clockwise from north (matches the pin art's initial 45).
  setHeading(deg) {
    this._applyHeading(-deg * Math.PI / 180);
    widgetsEngine()?.requestRender();
  }

  // The pin rides the shared unit quad (origin top-left), so a bare mesh.rotation would
  // orbit it around that corner. Compensate with p = (I−R)·c so the spin re-centers on
  // the quad's own middle (c = half the 24px pin rect; mesh-local y points down as −y).
  _applyHeading(rad) {
    this.pin.mesh.rotation.z = rad;
    const c = 12, cos = Math.cos(rad), sin = Math.sin(rad);
    this.pin.mesh.position.set(c - c * cos - c * sin, -c - c * sin + c * cos, 0);
  }

  zoomBy(dir, opts) {
    this.setZoom(clamp(this.zoom + dir * 0.5, 1, 3), opts);
  }

  // LOUD by default — the shipped contract routes the +/- buttons through here and
  // consumers listen for it, so convention 1's silent default deliberately does not
  // apply; state-restore code passes { silent: true } to zoom without an event or log.
  setZoom(z, { silent = false } = {}) {
    z = clamp(z, 1, 3);
    if (z === this.zoom) return;
    this.zoom = z;
    widgetsEngine()?.ticker.tween(this, { _zoomDisplay: z }, {
      dur: 0.3,
      onUpdate: () => { this._applyZoom(); this.invalidateLayout(); },
    });
    if (silent) return;
    this.dispatch('zoomchange', { zoom: z });
    EldEvents.log(str('minimapZoom', z.toFixed(1)), 'MAP');
  }

  _applyZoom() {
    const inv = 1 / this._zoomDisplay;
    this.mapTex.repeat.set(inv, inv);
    this.mapTex.offset.set((1 - inv) / 2, (1 - inv) / 2);
  }

  onLayout() {
    const S = 200;
    this.mapQuad.setRect(13, 13, S - 26, S - 26);
    this.frameQuad.setRect(0, 0, S, S);
    this.pin.setRect(S / 2 - 12, S / 2 - 12, 24, 24);
    // zoom buttons live in the square's right-hand corners — the only spots inside the
    // widget whose nearest point still clears the circular rim band entirely
    this.btnIn.setPos(S - 28, 0);
    this.btnOut.setPos(S - 28, S - 28);
    const cx = S / 2, cy = S / 2;
    const rimR = S / 2 - 18; // markers must stay inside the circular glass, not the square
    if (this.markers.some(m => m.disposed)) this.markers = this.markers.filter(m => !m.disposed);
    for (const m of this.markers) {
      const ex = 50 + (m.marker.xPct - 50) * this._zoomDisplay;
      const ey = 50 + (m.marker.yPct - 50) * this._zoomDisplay;
      const px = cx + ((ex - 50) / 100) * (S - 30);
      const py = cy + ((ey - 50) / 100) * (S - 30);
      const dist = Math.hypot(px - cx, py - cy);
      const vis = dist <= rimR;
      m.fxOpacity = vis ? 1 : 0;
      m.interactive = vis;
      m.setPos(Math.round(px - m.w / 2), Math.round(py - m.h / 2));
    }
    this.edgeArrow.setPos(Math.round(S / 2 - this.edgeArrow.w / 2), 2);
    // zone plaque wraps its labels (name + optional level line)
    const hasLevel = (this.zoneLevel._text ?? '').length > 0;
    this.zoneLevel.visible = hasLevel;
    const padX = 14, padY = 5;
    const zw = Math.max(120, Math.max(this.zoneName.w, hasLevel ? this.zoneLevel.w : 0) + padX * 2);
    const nameY = S + 8 + padY;
    const levelY = nameY + this.zoneName.h + 1;
    const zh = (hasLevel ? levelY + this.zoneLevel.h : nameY + this.zoneName.h) + padY - (S + 8);
    this.zonePlaque.setRect(Math.round((S - zw) / 2), S + 8, zw, zh);
    this.zoneName.setPos(Math.round((S - this.zoneName.w) / 2), nameY);
    this.zoneLevel.setPos(Math.round((S - this.zoneLevel.w) / 2), levelY);
    this.setSize(this.w, S + 8 + zh);
    void cy;
  }
}

// ---------------- QuestTracker ----------------

export class QuestTracker extends UINode {
  constructor(opts = {}) {
    super({});
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.header = new TextNode(opts.header ?? str('questHeader'), {
      font: FONTS.header, size: 14, color: COLORS.accent, smallCaps: true, letterSpacing: 1,
      shadow: { color: 'rgba(0,0,0,0.8)', dx: 1, dy: 1, blur: 2 },
    });
    this.rule = new QuadNode({ color: 0x39443a, opacity: 0.8 });
    this.add(this.bg, this.header, this.rule);
    this.questNodes = [];
    this._questSeq = 0;
    // Opt-in: objective TEXT parses {color}/{icon}/{b}/{i} runs (the progress
    // counter stays library-styled; unstyled runs keep the muted objective color).
    this.markup = opts.markup === true;
    for (const q of opts.quests ?? []) this.addQuest(q);
    this.setSize(opts.width ?? 250, 10);
  }

  // Returns the quest's id handle (auto-generated when the spec carries none).
  // Titles and objectives WRAP to the tracker's width: onLayout drives
  // their maxWidth from this.w, so a resized host re-flows the prose live.
  addQuest({ id, title, objectives }) {
    id = id ?? `q${++this._questSeq}`;
    const t = new TextNode(title, { size: 12, weight: 'bold', color: COLORS.accent, multiline: true, maxWidth: this.w - 24 });
    this.add(t);
    const data = { id, title, objectives: (objectives ?? []).map(o => ({ ...o })) };
    const objs = data.objectives.map((o) => {
      const line = new TextNode('', { size: 11, multiline: true, maxWidth: this.w - 34 });
      this._paintObjective(line, o);
      this.add(line);
      return line;
    });
    this.questNodes.push({ id, t, objs, data, complete: false });
    this.invalidateLayout();
    return id;
  }

  _paintObjective(line, o) {
    const segs = [{ text: o.progress + '  ', color: o.done ? COLORS.positive : COLORS.negative }];
    if (this.markup) {
      for (const s of compileMarkup(o.text, { size: 11 })) {
        segs.push(s.icon !== undefined ? s : { ...s, color: s.color ?? COLORS.textMuted });
      }
    } else {
      segs.push({ text: o.text, color: COLORS.textMuted });
    }
    line.setSegments(segs);
  }

  _entry(id) { return this.questNodes.find(q => q.id === id) ?? null; }

  getQuest(id) {
    const q = this._entry(id);
    return q ? { id: q.id, title: q.data.title, complete: q.complete, objectives: q.data.objectives.map(o => ({ ...o })) } : null;
  }

  updateObjective(id, index, patch) {
    const q = this._entry(id);
    const o = q?.data.objectives[index];
    if (!o) return false;
    Object.assign(o, patch);
    this._paintObjective(q.objs[index], o);
    this.dispatch('questchange', { id, action: 'objective', index });
    this.invalidateLayout();
    return true;
  }

  completeQuest(id) {
    const q = this._entry(id);
    if (!q) return false;
    q.complete = true;
    q.t.setColor(COLORS.positive);
    for (let i = 0; i < q.data.objectives.length; i++) {
      q.data.objectives[i].done = true;
      this._paintObjective(q.objs[i], q.data.objectives[i]);
      q.objs[i].fxOpacity = 0.65;
    }
    this.dispatch('questchange', { id, action: 'complete' });
    this.invalidateLayout();
    return true;
  }

  removeQuest(id) {
    const i = this.questNodes.findIndex(q => q.id === id);
    if (i === -1) return false;
    const q = this.questNodes[i];
    q.t.dispose();
    for (const o of q.objs) o.dispose();
    this.questNodes.splice(i, 1);
    this.dispatch('questchange', { id, action: 'remove' });
    this.invalidateLayout();
    return true;
  }

  onLayout() {
    this.header.setPos(12, 10);
    this.rule.setRect(10, 30, this.w - 20, 1);
    let y = 40;
    for (const q of this.questNodes) {
      // wrap widths derive from the LIVE width (setMaxWidth no-ops when unchanged,
      // so steady-state passes are free; a real resize re-flows once)
      q.t.setMaxWidth(this.w - 24);
      q.t.setPos(12, y); y += q.t.h + 3;
      for (const o of q.objs) {
        o.setMaxWidth(this.w - 34);
        o.setPos(22, y); y += o.h + 2;
      }
      y += 8;
    }
    this.h = y + 4;
    this.bg.setRect(0, 0, this.w, this.h);
  }
}

// ---------------- CharacterPanel ----------------

const EQUIP_LEFT = ['head', 'neck', 'shoulder', 'back'];
const EQUIP_RIGHT = ['chest', 'wrist', 'hands', 'waist'];

// CharacterPanel geometry: ONE set of constants drives BOTH the layout
// (onLayout below) and the panel's declared size, so the declaration can never
// drift from what the layout paints. The panel had declared 470x500 around a
// 440x334 composition since the initial commit — the dead band made every
// window fitted to it a third empty, and turned an honest shrink into a
// scrollbar over nothing (Investigator-dialog report).
const CP_SLOT = METRICS.cpSlotSize;                              // 44px equip/satchel slots
const CP_COL_GAP = 6;                                            // vertical gap in the equip columns
const CP_DOLL = { x: CP_SLOT + 8, y: 0, w: 120, h: 200 };        // the mannequin between the columns
const CP_RIGHT_COL_X = CP_DOLL.x + CP_DOLL.w + 6;                // 178: the right equip column
// the stats Y DERIVES from the taller of the doll block and the equip
// columns (4 slots + 3 gaps) plus a 20px seam — the old literal 214 was
// measured against 44px slots and left a 4px seam at 48
const CP_COL_BOTTOM = Math.max(CP_DOLL.y + CP_DOLL.h, 4 * CP_SLOT + 3 * CP_COL_GAP);
const CP_STATS = { x: 0, y: CP_COL_BOTTOM + 20, w: 222, h: 120 }; // stats box under the doll block
const CP_INV_X = 252, CP_INV_GAP = 4, CP_INV_Y = 26;             // the 4x4 satchel grid, label above
const CP_W = CP_INV_X + 4 * (CP_SLOT + CP_INV_GAP) - CP_INV_GAP; // 440: the satchel's right edge
const CP_H = CP_STATS.y + CP_STATS.h;                            // 334: the stats box bottom

export class CharacterPanel extends UINode {
  constructor(opts = {}) {
    super({});
    this.doll = new QuadNode({ texture: tex('doll.character') });
    this.add(this.doll);
    this.slots = new Map();
    for (const id of [...EQUIP_LEFT, ...EQUIP_RIGHT]) {
      const s = new CpSlot(id);
      EldTooltip.attach(s, () => s.icon
        ? null // icon has its own tooltip
        : { title: id.charAt(0).toUpperCase() + id.slice(1), desc: str('slotEmptyDesc') });
      this.slots.set(id, s);
      this.add(s);
    }
    // stats box
    this.categories = opts.categories ?? [];
    this.catIndex = 0;
    this.statsBg = new NineSliceNode(frame('panel.dark'));
    this.statsTitle = new TextNode('', { size: 12, weight: 'bold', color: COLORS.accent });
    this.statsRows = new UINode({});
    this.btnPrev = this._arrowBtn('◀', () => this.cycleStats(-1));
    this.btnNext = this._arrowBtn('▶', () => this.cycleStats(1));
    this.add(this.statsBg, this.statsTitle, this.statsRows, this.btnPrev, this.btnNext);

    // inventory
    this.invLabel = new TextNode(opts.inventoryLabel ?? 'Satchel', { font: FONTS.header, size: 14, color: COLORS.accent, smallCaps: true });
    this.add(this.invLabel);
    this.invSlots = [];
    for (let i = 0; i < 16; i++) {
      const s = new CpSlot('inv' + i);
      this.invSlots.push(s);
      this.add(s);
    }

    // currency
    this.currency = new UINode({});
    this.add(this.currency);
    const cur = opts.currency ?? { gold: 0, silver: 0, copper: 0 };
    for (const kind of ['gold', 'silver', 'copper']) {
      const ic = new QuadNode({ texture: tex(`currency.${kind}`) });
      ic.setSize(16, 16);
      const t = new TextNode(String(cur[kind] ?? 0), { size: 12, color: COLORS.text });
      this.currency.add(ic, t);
    }

    this.setSize(CP_W, CP_H); // 440x334 — derived from the layout constants, never a parallel literal
    this._renderStats();
  }

  _arrowBtn(glyph, onClick) {
    const b = new UINode({ interactive: true });
    const bg = new QuadNode({ color: 0x18201a, opacity: 0.9 });
    const t = new TextNode(glyph, { size: 11, color: COLORS.accent });
    // the ±14-per-channel hover delta was imperceptible — wash floors + press.
    const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    b.add(bg, t, wash);
    b.setSize(24, 24);
    bg.setRect(0, 0, 24, 24);
    wash.setRect(0, 0, 24, 24);
    t.setPos(Math.round((24 - t.w) / 2), Math.round((24 - t.h) / 2));
    let hov = false;
    b.on('pointerenter', () => { if (!b.closest((n) => n.disabled === true)) { hov = true; wash.setBaseOpacity(METRICS.washHover); } });
    b.on('pointerleave', () => { hov = false; wash.setBaseOpacity(0); });
    b.on('pointerdown', () => wash.setBaseOpacity(METRICS.washPress));
    b.on('pointerup', (e) => wash.setBaseOpacity(!e.canceled && hov ? METRICS.washHover : 0));
    b.on('click', onClick);
    b._wash = wash;
    return b;
  }

  cycleStats(dir) {
    const n = this.categories.length;
    if (!n) return;
    this.catIndex = (this.catIndex + dir + n) % n;
    this._renderStats();
    EldEvents.log(str('statsCategory', this.categories[this.catIndex].name), 'UI');
  }

  _renderStats() {
    const cat = this.categories[this.catIndex];
    if (!cat) return;
    this.statsTitle.setText(cat.name);
    for (const c of [...this.statsRows.children]) c.dispose();
    cat.rows.forEach(([label, val], i) => {
      const line = new TextNode('', { size: 11 });
      line.setSegments([{ text: label + '  ', color: COLORS.textMuted }, { text: String(val), color: COLORS.bone }]);
      line.setPos(0, i * 16);
      this.statsRows.add(line);
    });
    this.invalidateLayout();
  }

  equip(slotId, iconName) {
    const slot = this.slots.get(slotId) ?? this.invSlots.find(s => s.slotId === slotId);
    if (!slot) return;
    if (slot.icon) { const old = slot.takeIcon(); old.dispose(); } // re-equip replaces, never ghosts
    EldDragDrop.createIconInSlot(slot, iconName);
  }

  // Empties the fitting and returns what it held (null when it was already empty).
  unequip(slotId) {
    const slot = this.slots.get(slotId) ?? this.invSlots.find(s => s.slotId === slotId);
    const name = slot?.icon?.iconName ?? null;
    if (slot?.icon) { slot.icon.dispose(); slot.icon = null; }
    return name;
  }

  getEquipped() {
    const out = {};
    for (const [id, slot] of this.slots) out[id] = slot.icon?.iconName ?? null;
    return out;
  }

  getInventory() { return this.invSlots.map(s => s.icon?.iconName ?? null); }

  setCurrency({ gold, silver, copper } = {}) {
    const kids = this.currency.children; // [icon, text] x3 in gold/silver/copper order
    const vals = [gold, silver, copper];
    for (let i = 0; i < 3; i++) {
      if (vals[i] !== undefined) kids[i * 2 + 1].setText(String(vals[i]));
    }
    this.invalidateLayout();
  }

  setStats(categories) {
    this.categories = categories ?? [];
    this.catIndex = 0;
    this._renderStats();
  }

  onLayout() {
    const S = CP_SLOT, G = CP_COL_GAP;
    EQUIP_LEFT.forEach((id, i) => this.slots.get(id).setPos(0, i * (S + G)));
    EQUIP_RIGHT.forEach((id, i) => this.slots.get(id).setPos(CP_RIGHT_COL_X, i * (S + G)));
    this.doll.setRect(CP_DOLL.x, CP_DOLL.y, CP_DOLL.w, CP_DOLL.h);
    this.statsBg.setRect(CP_STATS.x, CP_STATS.y, CP_STATS.w, CP_STATS.h);
    this.statsTitle.setPos(34, CP_STATS.y + 8);
    // the stats box hugs its LINES: the frozen 160x80 could silently
    // under- or over-state a category's real reach — the box derives from the
    // rendered rows now, so a page that stuffs six 16px lines OVERFLOWS the
    // declaration honestly (the declared==painted pin sees it) instead of
    // painting past a rect nothing measures
    const se = contentExtent(this.statsRows.children);
    this.statsRows.setRect(34, CP_STATS.y + 28, Math.max(1, se.w), Math.max(1, se.h));
    this.btnPrev.setPos(6, CP_STATS.y + 6);
    this.btnNext.setPos(192, CP_STATS.y + 6);
    this.invLabel.setPos(CP_INV_X, 0);
    this.invSlots.forEach((s, i) => s.setPos(CP_INV_X + (i % 4) * (S + CP_INV_GAP), CP_INV_Y + Math.floor(i / 4) * (S + CP_INV_GAP)));
    // currency row — the container hugs the ROW'S INK (caught it spanning the
 // whole panel; caught the residue: stretching to `this.w - CP_INV_X`
 // mirrored the DECLARED width back into contentExtent, which blinded the
 // declared==painted pin to width over-declaration — the exact class the pin
 // exists to catch. Children seat first, then the rect hugs their reach)
    const cy = CP_INV_Y + 4 * (S + CP_INV_GAP) + 8;
    let cx = 0;
    const kids = this.currency.children;
    for (let i = 0; i < kids.length; i += 2) {
      kids[i].setPos(cx, 0); // icon
      kids[i + 1].setPos(cx + 20, 1);
      cx += 20 + kids[i + 1].w + 18;
    }
    this.currency.setRect(CP_INV_X, cy, Math.max(0, cx - 18), 20);
  }
}

// ---------------- SettingsPanel ----------------

// Fixed sidebar on the left; only the tab CONTENT scrolls (its own ScrollArea).
// The selection machinery speaks the Tabs contract verbatim: options-object
// silent, boolean return, same-id no-op, `change {id}`, arrows (Up/Down — the sidebar
// is vertical), a `content` getter, setDisabled. The sidebar VISUALS are unchanged.
export class SettingsPanel extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true; // arrows walk the sidebar from the focused panel (Tabs parity)
    this.tabs = opts.tabs; // [{id, label, icon, build(contentNode)}]
    this.onChange = opts.onChange ?? null;
    this.sidebar = new UINode({});
    this.sidebarBg = new QuadNode({ color: 0x060a08, opacity: 0.5 });
    this.sidebarRule = new QuadNode({ color: 0x2a332c, opacity: 0.9 });
    this.contentScroll = new ScrollArea({ skin: componentScrollSkin() }); // rails overlay, no reserved lane
    this.contentPane = this.contentScroll.content; // tab builders add here
    this.add(this.sidebarBg, this.sidebarRule, this.sidebar, this.contentScroll);
    this.items = [];
    this.activeId = null;
    for (const tab of this.tabs) {
      const item = new UINode({ interactive: true });
      const bg = new QuadNode({ color: 0x6fd18b, opacity: 0 });
      const bar = new QuadNode({ color: 0x6fd18b });
      bar.visible = false;
      const ic = new QuadNode({ texture: tab.icon ? tex(`ui.${tab.icon}`) : null }); // icon is optional (the tabs.js guard)
      const label = new TextNode(tab.label, { size: 13, color: COLORS.textFaint });
      item.add(bg, bar, ic, label);
      item.tab = tab;
      item._bg = bg; item._bar = bar; item._label = label; item._ic = ic;
      item.on('pointerenter', () => { if (this.closest((n) => n.disabled === true)) return; if (this.activeId !== tab.id) { bg.setBaseOpacity(METRICS.washHover); label.setColor(COLORS.text); } }); // sealed sidebars stay dark
      item.on('pointerleave', () => { if (this.activeId !== tab.id) { bg.setBaseOpacity(0); label.setColor(COLORS.textFaint); } });
      item.on('click', () => this.selectTab(tab.id, { silent: false }));
      this.items.push(item);
      this.sidebar.add(item);
    }

    // Up/Down walk the sidebar from the focused panel (loud, like a click) — the
    // vertical analog of Tabs' Left/Right.
    this.on('keydown', (e) => {
      if (this.disabled) return; // disabled is inert on the keyboard path too
      // Sidebar-walking is the CONTAINER's gesture: a focused child in the pane owns
      // its own arrows — acting on its bubbled keydown would dispose the pane under it.
      if (e.target !== this) return;
      const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!d || !this.tabs.length) return;
      e.preventDefault();
      const i = this.tabs.findIndex(t => t.id === this.activeId);
      const next = this.tabs[((i + d) % this.tabs.length + this.tabs.length) % this.tabs.length];
      this.selectTab(next.id, { silent: false });
    });

    this.setSize(opts.width ?? 500, opts.height ?? 360);
    if (this.tabs.length) this.selectTab(this.tabs[0].id); // initial selection is silent
  }

  get content() { return this.contentPane; }

  selectTab(id, opts = {}) {
    // The pre-1.1 positional-boolean shim is GONE (nothing
 // reaches for backwards compatibility) — options-object only, Tabs parity.
    const { silent = true } = opts;
    const tab = this.tabs.find(t => t.id === id);
    if (!tab || this.activeId === id) return false;
    this.activeId = id;
    for (const item of this.items) {
      const active = item.tab.id === id;
      item._bg.setBaseOpacity(active ? 0.22 : 0);
      item._bar.visible = active;
      item._label.setColor(active ? COLORS.accent : COLORS.textFaint);
      if (item.tab.icon) item._ic.setTexture(tex(`ui.${item.tab.icon}${active ? '.active' : ''}`));
    }
    for (const c of [...this.contentPane.children]) c.dispose();
    this.contentScroll.setScroll(0);
    tab.build(this.contentPane, this);
    // a build() that re-enters selectTab(other) completes first and owns the pane —
    // skip the stale tail (log + change) or the panel ends desynced from its last event
    if (this.activeId !== id) return true;
    if (!silent) EldEvents.log(str('settingsTab', id), 'UI'); // the shipped gesture line
    this.invalidateLayout();
    commitChange(this, 'change', { value: id, id }, silent, this.onChange ? () => this.onChange(id) : null);
    return true;
  }

  setDisabled(v) { setNodeDisabled(this, v); } // releases focus so arrows can't reach a disabled sidebar

  onLayout() {
    const SB = 160;
    this.sidebarBg.setRect(0, 0, SB, this.h);
    this.sidebarRule.setRect(SB, 0, 1, this.h);
    this.sidebar.setRect(0, 0, SB, this.h);
    this.items.forEach((item, i) => {
      item.setRect(0, 10 + i * 42, SB, 40);
      item._bg.setRect(0, 0, SB, 40);
      item._bar.setRect(0, 0, 3, 40);
      item._ic.setRect(14, 10, 20, 20);
      item._label.setPos(44, Math.round((40 - item._label.h) / 2));
    });
    this.contentScroll.setRect(SB + 20, 12, this.w - SB - 32, this.h - 24);
  }
}

// ---------------- Globe (volumetric orb) ----------------

export class Globe extends UINode {
  constructor(opts = {}) {
    super({});
    // radius <= 0 (or NaN) degenerates the orb sphere and NaNs the shader rim math
    const r = Number.isFinite(opts.radius) && opts.radius > 0 ? opts.radius : 40;
    this.radius = r;
    this.kind = opts.kind ?? 'health';
    const colors = this.kind === 'health'
      ? ['#4a0f12', '#c85a4a']
      : ['#231540', '#9a7ce0'];
    this.orb = makeOrbMesh(r, colors[0], colors[1]);
    this.accent = new Accent3DNode({});
    this.accent.content.add(this.orb.mesh);
    this.orb.mesh.position.set(r, -r, 0);
    this.orb.mesh.scale.z = 0.5; // keep within the accent z-slab
    this.ring = new QuadNode({ texture: tex('avatar.ring') });
    this.label = new TextNode(opts.label ?? '', { font: FONTS.header, size: 13, color: COLORS.bone, smallCaps: true, align: 'center' });
    // fixed-width, center-aligned so the value never re-centers (and never re-allocates) as it ticks
    this.valueText = new TextNode('', {
      size: 12, weight: 'bold', color: COLORS.textWhite, align: 'center',
      fixedW: r * 2 - 12,
      shadow: { color: '#000', dx: 1, dy: 1, blur: 2 },
    });
    this.add(this.accent, this.ring, this.valueText, this.label);
    this.setSize(r * 2, r * 2 + 22);
    // finite-first (the NaN class): `?? 100` passes NaN through into clamp/division
    this.value = Number.isFinite(opts.value) ? opts.value : 100;
    this.max = Number.isFinite(opts.max) ? opts.max : 100;
    // a dead pool (max 0) reads empty, never NaN/Infinity
    this._fill = { v: this.max > 0 ? this.value / this.max : 0 };
    this.orb.setFill(this._fill.v);
    this._syncText();
    this.setFrameHook((dt, t) => this.orb.tick(t));
  }

  setValue(v, max = this.max) {
    if (!Number.isFinite(max)) max = this.max; // a NaN max would launder into the fill fraction
    this.value = clamp(v, 0, max);
    this.max = max;
    widgetsEngine()?.ticker.tween(this._fill, { v: this.max > 0 ? this.value / this.max : 0 }, {
      dur: 0.35,
      onUpdate: () => this.orb.setFill(this._fill.v),
    });
    this._syncText();
  }

  _syncText() {
    this.valueText.setText(`${Math.round(this.value)}/${this.max}`);
    this.invalidateLayout();
  }

  onLayout() {
    const r = this.radius;
    this.accent.setPos(0, 0);
    this.ring.setRect(-4, -4, r * 2 + 8, r * 2 + 8);
    this.valueText.setPos(6, Math.round(r - this.valueText.h / 2));
    this.label.setPos(Math.round(r - this.label.w / 2), r * 2 + 8);
  }

  disposeSelf() {
    // _fill is a plain tween target, not a node — the automatic per-node
    // tween cancellation in dispose() cannot see it.
    widgetsEngine()?.ticker.cancelTweensOf(this._fill);
    this.orb.dispose();
  }
}

// ---------------- CastBar ----------------

export class CastBar extends UINode {
  constructor(opts = {}) {
    super({});
    this.bg = new NineSliceNode(frame('progress.bg'));
    this.fill = new QuadNode({ texture: tex('progress.fill') });
    this.frameTop = new NineSliceNode(frame('progress.frame'));
    this.iconSlot = new QuadNode({ texture: tex('slot.frame') });
    // the procedural ability art died — the icon NAME is an opt now
    // (default 'fireball', which every consumer page aliases from the REAL
    // pack); an un-aliased name shows the loud fallback plate by design
    this.icon = new QuadNode({ texture: tex(`icon.${opts.icon ?? 'fireball'}`) });
    this.nameText = new TextNode('', { size: 12, color: COLORS.textBright, shadow: { color: '#000', dx: 1, dy: 1, blur: 2 } });
    this.timeText = new TextNode('', { size: 11, color: COLORS.bone });
    this.add(this.iconSlot, this.icon, this.bg, this.fill, this.frameTop, this.nameText, this.timeText);
    this.setSize(opts.width ?? 280, 36);
    this.progress = 0;   // 0..1
    this.duration = 0;
    this.elapsed = 0;
    this.casting = false;
    this.onComplete = opts.onComplete ?? null;
  }

  startCast(name, iconName, duration) {
    // A replaced cast resolves as interrupted first (convention 9: every caststart
    // gets exactly one resolution — complete, interrupt, or stop); no-op when idle.
    // A castinterrupt handler may itself call startCast (queue-next patterns): that
    // re-entrant call fully installs before we resume, so it WINS and this outer
    // call yields — otherwise the inner cast's caststart would never resolve.
    const epoch = (this._castEpoch = (this._castEpoch ?? 0) + 1);
    this.interrupt();
    if (this._castEpoch !== epoch) return;
    // NaN/negative durations would make `progress >= 1` unreachable — the frame hook
    // (and the render wake it forces) would then run forever with no resolution
    // event. Poisoned durations complete instantly instead (0 -> progress clamps to 1).
    if (!(Number.isFinite(duration) && duration > 0)) duration = 0;
    this._castName = name;
    this.nameText.setText(name);
    this.icon.setTexture(tex(`icon.${iconName}`));
    this.duration = duration;
    this.elapsed = 0;
    this.progress = 0;
    this.casting = true;
    this.visible = true;
    this.dispatch('caststart', { name, duration });
    uisound(this, 'cast', { phase: 'start', name });
    this.setFrameHook((dt) => {
      // leak guard: a bar disposed mid-cast must never keep ticking or fire callbacks
      if (this.disposed) { this.setFrameHook(null); return; }
      if (!this.casting) return;
      this.elapsed += dt;
      this.progress = clamp(this.elapsed / this.duration, 0, 1);
      this.timeText.setText(`${Math.max(0, this.duration - this.elapsed).toFixed(1)}s`);
      this.invalidateLayout();
      if (this.progress >= 1) {
        this.casting = false;
        this.setFrameHook(null);
        this.dispatch('castcomplete', { name: this._castName });
        uisound(this, 'cast', { phase: 'complete', name: this._castName });
        if (this.onComplete) this.onComplete();
      }
    });
  }

  // Quiet halt (no event): the game decided the cast simply ends (death, zone change).
  stopCast() {
    if (!this.casting) return;
    this.casting = false;
    this.setFrameHook(null);
    this.progress = 0;
    this.timeText.setText('');
    this.invalidateLayout();
  }

  // Loud halt: the cast was broken — dispatches `castinterrupt {name}`.
  interrupt() {
    if (!this.casting) return;
    const name = this._castName;
    this.stopCast();
    this.dispatch('castinterrupt', { name });
    uisound(this, 'cast', { phase: 'interrupt', name });
  }

  disposeSelf() { this.setFrameHook(null); }

  onLayout() {
    const barX = 42;
    this.iconSlot.setRect(0, 0, 36, 36);
    { const bi = socketInset(36); this.icon.setRect(bi, bi, 36 - bi * 2, 36 - bi * 2); } // the socket law (was 4/28 — a 0.5px rim overhang)
    this.bg.setRect(barX, 2, this.w - barX, 32);
    const inner = this.w - barX - 12;
    this.fill.setRect(barX + 6, 8, Math.max(0, Math.round(inner * this.progress)), 20);
    this.fill.visible = this.progress > 0.01;
    this.frameTop.setRect(barX, 2, this.w - barX, 32);
    this.nameText.setPos(barX + 12, Math.round((36 - this.nameText.h) / 2));
    this.timeText.setPos(this.w - this.timeText.w - 14, Math.round((36 - this.timeText.h) / 2));
  }
}

// ---------------- DialogPanel (conversation) ----------------

// The conversation component (the cut, absorbed in; 's TypewriterText
// rides it later): portrait + speaker + wrapped, markup-capable body over one stone
// frame, advanced by click or Enter/Space/gamepad-A. The widget shows ONE entry at a
// time — the page owns the script and swaps entries with setEntry() from the `advance`
// event.
export class DialogPanel extends UINode {
  // opts: { width = 460, minHeight = 108, portrait = 'portrait.player', speaker, text,
  //         onAdvance }
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.onAdvance = opts.onAdvance ?? null;
    this.onActivate = () => this._advance(); // Enter/gamepad-A mirror the click
    this._minH = opts.minHeight ?? 108;
    this._pressed = false;

    this.frame = new NineSliceNode(frame('window.frame'));
    this.hoverWash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    this.portraitQuad = new QuadNode({ texture: tex('portrait.player') });
    this.portraitRing = new QuadNode({ texture: tex('avatar.ring') });
    this.speakerText = new TextNode('', {
      font: FONTS.header, size: 14, smallCaps: true, letterSpacing: 1, color: COLORS.accent,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    this.bodyText = new TextNode('', {
      size: 13, color: COLORS.text, multiline: true, markup: true,
      maxWidth: (opts.width ?? 460) - 104,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    // a REAL advance affordance. The Continue
    // button is primary; clicking the panel body stays the quiet secondary. The
    // old "▼" caret — the too-subtle hint the requirement condemned — is gone.
    this.continueBtn = new Button(str('dialogContinue'), {
      minWidth: 96,
      onClick: (e) => { e.stopPropagation(); this._advance(); },
    });
    this.add(this.frame, this.hoverWash, this.portraitQuad, this.portraitRing,
      this.speakerText, this.bodyText, this.continueBtn);

    this.w = opts.width ?? 460;
    this.on('pointerenter', () => { if (!this.disabled) this.hoverWash.setBaseOpacity(METRICS.washHover); });
    this.on('pointerleave', () => { this.hoverWash.setBaseOpacity(0); this._pressed = false; });
    this.on('pointerdown', (e) => { if (this.disabled) { e.stopPropagation(); return; } this._pressed = true; });
    this.on('pointerup', (e) => { this._pressed = false; if (e.canceled) this.hoverWash.setBaseOpacity(0); }); // canceled ups end dark (B3)
    this.on('click', (e) => {
      if (this.disabled) { e.stopPropagation(); return; }
      this._advance();
    });

    // opt-in typewriter (chars/sec; 0 = instant, the pre- behavior —
 // existing pages and their frozen snapshots stay bit-identical)
    const cps = Number(opts.typewriter);
    this.typewriterCps = Number.isFinite(cps) && cps > 0 ? cps : 0;

    this.setEntry({ portrait: opts.portrait, speaker: opts.speaker ?? '', text: opts.text ?? '' });
  }

  _advance() {
    if (this.disabled) return;
    if (this.bodyText.isRevealing) { this.bodyText.skip(); return; } // first press lands the text
    this.dispatch('advance', {});
    if (this.onAdvance) this.onAdvance();
  }

  // Swap the visible entry (programmatic, silent — the page owns the script). Height
  // fits the wrapped body at MUTATION time (hosts read .h in their own onLayout).
  setEntry({ portrait, speaker, text } = {}) {
    if (portrait) this.portraitQuad.setTexture(tex(portrait));
    this.speakerText.setText(speaker ?? '');
    this.bodyText.setText(text ?? '');
    // the Continue lane is real height — body bottom + breathing + button + inset
    // (measured on the FULL text; a reveal below holds this box while the prefix grows)
    this.setSize(this.w, Math.max(this._minH, 40 + this.bodyText.h + 8 + this.continueBtn.h + 16));
    this.invalidateLayout();
    if (this.typewriterCps > 0) {
      this.bodyText.reveal(this.typewriterCps, { onChar: () => uisound(this, 'type') });
      if (isReducedMotion()) this.bodyText.skip(); // the no-motion law: instant text
    }
  }

  setDisabled(v) {
    setNodeDisabled(this, v);
    // a cursor parked on the panel gets no leave when the seal lands (B1 class
    // sweep) — douse through the SAME channel the handlers drive (baseOpacity;
    // a .visible=false here would stick forever, nothing re-raises it)
    if (v) { this.hoverWash.setBaseOpacity(0); this._pressed = false; }
  }

  onLayout() {
    this.frame.setRect(0, 0, this.w, this.h);
    this.hoverWash.setRect(5, 5, this.w - 10, this.h - 10);
    // portrait + ring sit INSIDE the frame's 16px content box (the ring used
    // to poke 3px into the border band — the census's dialogs-quests counts)
    this.portraitQuad.setRect(19, 19, 56, 56);
    this.portraitRing.setRect(16, 16, 62, 62);
    this.speakerText.setPos(88, 16);
    this.bodyText.setPos(88, 40);
    this.continueBtn.setPos(this.w - 16 - this.continueBtn.w, this.h - 16 - this.continueBtn.h);
  }
}

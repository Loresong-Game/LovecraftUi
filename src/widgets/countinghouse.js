// The Counting House: the simulation/tycoon kit — numbers over time,
// legible at a glance. LineChart/BarChart: one instance-owned canvas per chart
// (the TextNode pattern; re-render on setData), axes/ticks/gridlines painted as
// ink, a scale that survives negatives and a single point, multi-series with a
// clickable legend (toggling a series is loud), and a hover value readout
// through EldTooltip (crosshair fell per the cut line — tooltip-only ships).
// TreeTable: indent + expand/collapse over a FLATTENED visible list riding
// VirtualList (virtualization-aware by construction); the expanded set is keyed
// by id, so it survives sort and setRows — the test suite pins it. Sorting orders
// SIBLINGS recursively and stays stable. NotificationCenter: the persistent
// prioritized center (the routing terminus): priority orders the ledger,
// unread wears the dot, a click marks read and JUMPS (loud `jump {id}`).
// Sparkline and the heatmap legend fell per the cut line. ZERO atlas cost —
// every painter is an instance canvas or bare quads. Event payloads avoid
// `target` fields (the event plane owns it — the law).

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode, measureText } from '../text.js';
import { str } from '../strings.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { commitChange, requireEngine, widgetsEngine, uisound, setNodeDisabled, EldTooltip } from './widgets.js';
import { VirtualList } from './virtual.js';
import { scrollSkin } from './windows.js';

const SHADOW = METRICS.textShadow;
const frame = (n) => requireEngine().textures.frame(n); // the house accessor
const SERIES_COLORS = [COLORS.accent, COLORS.quest, COLORS.negative, COLORS.bone];

// The shared scale: min/max across visible series, padded so a flat line or a
// single point still owns a band, with zero pulled inside when negatives show.
function chartDomain(series) {
  let min = Infinity, max = -Infinity, count = 0;
  for (const s of series) {
    if (s.hidden) continue;
    for (const v of s.points) {
      if (!Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
      count++;
    }
  }
  if (!count) { min = 0; max = 1; }
  if (min > 0) min = 0; // bars and profit lines read from the floor
  if (max < 0) max = 0; // an all-loss ledger still shows its zero line
  if (min === max) { min -= 1; max += 1; } // a single point owns a band
  const pad = (max - min) * 0.08;
  return { min: min - (min < 0 ? pad : 0), max: max + pad };
}

function tickSteps(min, max, n = 4) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(min + ((max - min) * i) / n);
  return out;
}

// The shared chart shell: canvas + legend chips + the tooltip readout.
class ChartBase extends UINode {
  constructor(opts, kind) {
    super({ interactive: true });
    requireEngine();
    this._kind = kind;
    const w = Number(opts.width);
    const h = Number(opts.height);
    this._cw = Number.isFinite(w) ? Math.max(160, Math.round(w)) : 320;
    this._ch = Number.isFinite(h) ? Math.max(100, Math.round(h)) : 180;
    this.title = String(opts.title ?? '');
    this.legend = opts.legend !== false;
    this.onSeries = opts.onSeries ?? null;
    this._art = createCanvasTexture(this._cw, this._ch, texScale());
    this._quad = new QuadNode({ texture: this._art.texture });
    this.add(this._quad);
    this._chips = [];
    this.setSize(this._cw, this._ch + (this.legend ? 26 : 0));
    // an interactive readout surface still shows hover/press states
    this.on('pointerenter', () => {
      if (this.closest((n) => n.disabled === true)) return;
      this.fxOpacity = 0.94;
    });
    this.on('pointerleave', () => { this.fxOpacity = 1; this.fxScale = 1; });
    this.on('pointerdown', () => {
      if (this.closest((n) => n.disabled === true)) return;
      this.fxScale = 0.995;
    });
    this.on('pointerup', () => { this.fxScale = 1; });
    this.on('pointermove', (e) => {
      const ws = this.worldScale || 1;
      this._hoverX = (e.x - this.worldX) / ws;
    });
    // the hover readout (tooltip-only per the cut line): nearest column at entry
    EldTooltip.attach(this, () => this._readout());
    this.setData(opts.series ?? [], { silent: true });
  }

  // series: [{ name, color?, points: number[] }]. A set re-renders whole.
  setData(series, { silent = true } = {}) {
    this.series = (Array.isArray(series) ? series : []).map((s, i) => ({
      name: String(s?.name ?? `Series ${i + 1}`),
      color: s?.color ?? SERIES_COLORS[i % SERIES_COLORS.length],
      points: (Array.isArray(s?.points) ? s.points : []).map((v) => Number(v)),
      hidden: s?.hidden === true,
    }));
    this._buildLegend();
    this._paint();
    commitChange(this, 'datachange', { count: this.series.length }, silent, null);
    return this;
  }

  // The uniform contract: the SETTER is silent by default
  // like every other programmatic setter; the legend chips pass {silent: false},
  // so a real click stays loud with a voice while a boot-restore no longer
  // clicks at the user.
  setSeriesVisible(name, visible, { silent = true } = {}) {
    const s = this.series.find((x) => x.name === String(name));
    if (!s || s.hidden === !visible) return this;
    s.hidden = !visible;
    this._paint();
    this._syncChips();
    if (!silent) uisound(this, 'click');
    commitChange(this, 'serieschange', { name: s.name, visible: !s.hidden }, silent,
      this.onSeries ? (_v, e) => this.onSeries(e, e) : null);
    return this;
  }

  _buildLegend() {
    for (const c of this._chips) c.dispose();
    this._chips = [];
    if (!this.legend) return;
    let x = 0;
    for (const s of this.series) {
      const chip = new UINode({ interactive: true });
      chip.swatch = new QuadNode({ color: s.color });
      chip.label = new TextNode(s.name, {
        font: FONTS.header, size: 10, smallCaps: true, letterSpacing: 1,
        color: COLORS.text, shadow: SHADOW, maxWidth: 90, ellipsis: true,
      });
      chip.wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      chip.wash.auditAllow('containment');
      chip.add(chip.wash, chip.swatch, chip.label);
      // the interactive hit floor is 24px — the zone is tall, the art is small
      const w = Math.max(24, Math.ceil(chip.label.w) + 18);
      chip.setSize(w, 24);
      chip.wash.setRect(0, 0, w, 24);
      chip.swatch.setRect(0, 8, 8, 8);
      chip.label.setPos(12, 5);
      chip.setPos(x, this._ch + 2);
      chip._series = s;
      chip.on('pointerenter', () => {
        if (this.closest((n) => n.disabled === true)) return;
        chip.wash.setBaseOpacity(METRICS.washFocus ?? 0.12);
      });
      chip.on('pointerleave', () => { chip.wash.setBaseOpacity(0); chip.fxScale = 1; });
      chip.on('pointerdown', () => {
        if (this.closest((n) => n.disabled === true)) return;
        chip.fxScale = 0.94;
      });
      chip.on('pointerup', () => { chip.fxScale = 1; });
      chip.on('click', (e) => {
        e.stopPropagation?.();
        if (this.closest((n) => n.disabled === true)) return;
        this.setSeriesVisible(chip._series.name, chip._series.hidden, { silent: false });
      });
      this.add(chip);
      this._chips.push(chip);
      x += w + 10;
    }
    this._syncChips();
  }

  _syncChips() {
    for (const chip of this._chips) {
      chip.fxOpacity = chip._series.hidden ? 0.4 : 1;
      chip.label.setColor(chip._series.hidden ? COLORS.textDisabled : COLORS.text);
    }
    (this.engine ?? null)?.requestRender();
  }

  _readout() {
    const visible = this.series.filter((s) => !s.hidden);
    if (!visible.length) return { title: this.title || this._kind, desc: str('chartNoSeries') };
    const n = Math.max(...visible.map((s) => s.points.length));
    const plotX0 = 34, plotW = this._cw - plotX0 - 8;
    const step = n > 1 ? plotW / (n - 1) : plotW;
    const idx = Math.max(0, Math.min(n - 1,
      Math.round(((this._hoverX ?? plotX0) - plotX0) / Math.max(1, step))));
    return {
      title: this.title || this._kind,
      lines: visible.map((s) => ({
        text: `${s.name}: ${Number.isFinite(s.points[idx]) ? s.points[idx] : '—'}`,
        color: s.color,
      })),
    };
  }

  // The shared frame: plate, gridlines, ticks, the zero line. Returns the plot rect.
  _frame(ctx, dom) {
    const W = this._cw, H = this._ch;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS.voidBlack;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    const plot = { x: 34, y: this.title ? 18 : 8, w: W - 42, h: H - (this.title ? 18 : 8) - 16 };
    if (this.title) {
      ctx.fillStyle = COLORS.bone;
      ctx.font = `10px ${FONTS.header ?? 'Georgia, serif'}`;
      ctx.fillText(this.title.toUpperCase(), plot.x, 12);
    }
    ctx.font = `9px ${FONTS.mono ?? 'Consolas, monospace'}`;
    for (const t of tickSteps(dom.min, dom.max)) {
      const y = plot.y + plot.h - ((t - dom.min) / (dom.max - dom.min)) * plot.h;
      ctx.strokeStyle = COLORS.dividerDark;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.textMuted;
      const label = Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`;
      ctx.fillText(label, 2, y + 3);
    }
    // the zero line reads stronger when losses share the plot
    if (dom.min < 0 && dom.max > 0) {
      const zy = plot.y + plot.h - ((0 - dom.min) / (dom.max - dom.min)) * plot.h;
      ctx.strokeStyle = COLORS.border;
      ctx.beginPath();
      ctx.moveTo(plot.x, zy);
      ctx.lineTo(plot.x + plot.w, zy);
      ctx.stroke();
    }
    return plot;
  }

  onLayout() {
    this._quad.setRect(0, 0, this._cw, this._ch);
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  disposeSelf() {
    this._art.texture.dispose();
  }
}

// ---------------- LineChart ----------------

export class LineChart extends ChartBase {
  // opts: { series, width = 320, height = 180, title, legend = true, onSeries }
  constructor(opts = {}) { super(opts, 'LineChart'); }

  _paint() {
    const { ctx } = this._art;
    const dom = chartDomain(this.series);
    this._domain = dom; // the assert seam: scale math is checkable
    const plot = this._frame(ctx, dom);
    for (const s of this.series) {
      if (s.hidden) continue;
      const pts = s.points.filter((v) => Number.isFinite(v));
      if (!pts.length) continue;
      const step = pts.length > 1 ? plot.w / (pts.length - 1) : 0;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = 1.5;
      if (pts.length === 1) {
        // a single point is a POINT, not an invisible line
        const y = plot.y + plot.h - ((pts[0] - dom.min) / (dom.max - dom.min)) * plot.h;
        ctx.beginPath();
        ctx.arc(plot.x + plot.w / 2, y, 3, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      pts.forEach((v, i) => {
        const x = plot.x + i * step;
        const y = plot.y + plot.h - ((v - dom.min) / (dom.max - dom.min)) * plot.h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    this._art.texture.needsUpdate = true;
    (this.engine ?? null)?.requestRender();
  }
}

// ---------------- BarChart ----------------

export class BarChart extends ChartBase {
  // opts: { series, labels?, width = 320, height = 180, title, legend = true, onSeries }
  constructor(opts = {}) {
    const labels = Array.isArray(opts.labels) ? opts.labels.map(String) : null;
    super(opts, 'BarChart');
    this.labels = labels;
    if (labels) this._paint();
  }

  _paint() {
    const { ctx } = this._art;
    const dom = chartDomain(this.series);
    this._domain = dom;
    const plot = this._frame(ctx, dom);
    const visible = this.series.filter((s) => !s.hidden);
    const n = Math.max(0, ...visible.map((s) => s.points.length));
    if (n && visible.length) {
      const groupW = plot.w / n;
      const barW = Math.max(2, (groupW * 0.7) / visible.length);
      const zy = plot.y + plot.h - ((0 - dom.min) / (dom.max - dom.min)) * plot.h;
      visible.forEach((s, si) => {
        ctx.fillStyle = s.color;
        s.points.forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          const x = plot.x + i * groupW + groupW * 0.15 + si * barW;
          const y = plot.y + plot.h - ((v - dom.min) / (dom.max - dom.min)) * plot.h;
          ctx.globalAlpha = 0.9;
          // negatives hang BELOW the zero line — the scale owns the mapping
          ctx.fillRect(x, Math.min(y, zy), barW - 1, Math.max(1, Math.abs(zy - y)));
          ctx.globalAlpha = 1;
        });
      });
      if (this.labels) {
        ctx.fillStyle = COLORS.textMuted;
        ctx.font = `9px ${FONTS.mono ?? 'Consolas, monospace'}`;
        this.labels.slice(0, n).forEach((lb, i) => {
          const tw = ctx.measureText(lb).width;
          ctx.fillText(lb, plot.x + i * groupW + (groupW - tw) / 2, plot.y + plot.h + 11);
        });
      }
    }
    this._art.texture.needsUpdate = true;
    (this.engine ?? null)?.requestRender();
  }
}

// ---------------- TreeTable ----------------
// Indent + expand/collapse over a FLATTENED visible list riding VirtualList.
// The expanded set is keyed by id — it survives sort and setRows (the test suite
// pins it). Sorting orders SIBLINGS recursively and stays stable.

export class TreeTable extends UINode {
  // opts: { columns: [{key, label, width?}], rows: [{id, cells, children?}],
  //         width = 380, height = 220, rowH = 20, onActivate }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const w = Number(opts.width);
    const h = Number(opts.height);
    this._w = Number.isFinite(w) ? Math.max(200, Math.round(w)) : 380;
    this._h = Number.isFinite(h) ? Math.max(80, Math.round(h)) : 220;
    // rows host 24px expander zones — the default pitch clears the hit floor
    const rowH = Number(opts.rowH);
    this.rowH = Number.isFinite(rowH) ? Math.max(14, Math.round(rowH)) : 24;
    this.columns = (Array.isArray(opts.columns) && opts.columns.length
      ? opts.columns : [{ key: 'name', label: str('countColName') }])
      .map((c) => ({ key: String(c.key), label: String(c.label ?? c.key), width: Number.isFinite(c.width) ? c.width : 0 }));
    this.onActivate = opts.onActivate ?? null;
    this.expanded = new Set();
    this.sortKey = null;
    this.sortDir = 1;

    // the header row: click a column to sort (loud); the arrow marks the order
    this._header = new UINode();
    this._headerCells = this.columns.map((col) => {
      const cell = new UINode({ interactive: true });
      cell.label = new TextNode(col.label, {
        font: FONTS.header, size: 10, smallCaps: true, letterSpacing: 1,
        color: COLORS.bone, shadow: SHADOW, maxWidth: 200, ellipsis: true,
      });
      cell.wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      cell.wash.auditAllow('containment');
      // the order arrow: an overlay at the cell's right edge, NEVER a label
      // suffix (the old ' ^' append was a 10px speck that also changed the
 // label's measurement every toggle — both faces of)
      cell.sortInd = new TextNode('', { size: 13, color: COLORS.accent, shadow: SHADOW });
      cell.add(cell.wash, cell.label, cell.sortInd);
      cell._col = col; // sized ≥24 tall in onLayout (the interactive hit floor)
      cell.on('pointerenter', () => {
        if (this.closest((n) => n.disabled === true)) return;
        cell.wash.setBaseOpacity(METRICS.washFocus ?? 0.12);
      });
      cell.on('pointerleave', () => { cell.wash.setBaseOpacity(0); cell.fxScale = 1; });
      cell.on('pointerdown', () => {
        if (this.closest((n) => n.disabled === true)) return;
        cell.fxScale = 0.96;
      });
      cell.on('pointerup', () => { cell.fxScale = 1; });
      cell.on('click', () => {
        if (this.closest((n) => n.disabled === true)) return;
        this.sort(col.key, this.sortKey === col.key ? -this.sortDir : 1, { silent: false });
      });
      this._header.add(cell);
      return cell;
    });
    this.add(this._header);

    this.list = new VirtualList({
      skin: scrollSkin(), rowH: this.rowH,
      renderRow: (node, item) => this._bindRow(node, item),
    });
    // rowactivate: onActivate was stored, declared, and documented — and
    // never invoked; no row-body gesture existed at all. Geometry-resolved on
    // the list (the VirtualList click idiom): pooled rows stay non-interactive
    // (making them so would move the torture census), and the expander keeps
    // its own click via stopPropagation.
    this.list.on('click', (e) => {
      if (this.closest((n) => n.disabled === true)) return;
      const idx = Math.floor(((e.y - this.list.worldY) / (this.list.worldScale || 1) + this.list.content.scrollY) / this.rowH);
      const item = this.visibleRows[idx];
      if (!item) return;
      this.dispatch('rowactivate', { row: item.row });
      this.onActivate?.(item.row);
    });
    this.add(this.list);
    this.setSize(this._w, this._h);
    this.setRows(opts.rows ?? []);
  }

  setRows(rows) {
    this._roots = this._normalize(Array.isArray(rows) ? rows : []);
    this._refresh();
    return this;
  }

  _normalize(rows) {
    return rows
      .filter((r) => r && r.id != null)
      .map((r, i) => ({
        id: String(r.id),
        cells: r.cells && typeof r.cells === 'object' ? r.cells : {},
        children: this._normalize(Array.isArray(r.children) ? r.children : []),
        _ord: i,
      }));
  }

  // Sort SIBLINGS recursively; ties keep insertion order (the stable-sort law the old Scoreboard pinned first).
  // Silent by default (the uniform contract; a page
 // restoring saved sort state used to CLICK at the user): header clicks pass
  // {silent: false}, so the gesture keeps its voice. toggle() below always
  // spoke this contract — the two verbs agree now.
  sort(key, dir = 1, { silent = true } = {}) {
    this.sortKey = String(key);
    this.sortDir = dir >= 0 ? 1 : -1;
    const cmp = (a, b) => {
      const av = a.cells[this.sortKey], bv = b.cells[this.sortKey];
      const an = Number(av), bn = Number(bv);
      const c = Number.isFinite(an) && Number.isFinite(bn)
        ? an - bn : String(av ?? '').localeCompare(String(bv ?? ''));
      return c !== 0 ? c * this.sortDir : a._ord - b._ord;
    };
    const walk = (list) => { list.sort(cmp); for (const r of list) walk(r.children); };
    walk(this._roots);
    this._refresh();
    if (!silent) uisound(this, 'click');
    commitChange(this, 'sortchange', { key: this.sortKey, dir: this.sortDir }, silent, null);
    return this;
  }

  toggle(id, { silent = true } = {}) {
    const key = String(id);
    if (this.expanded.has(key)) this.expanded.delete(key);
    else this.expanded.add(key);
    this._refresh();
    commitChange(this, 'togglerow', { id: key, expanded: this.expanded.has(key) }, silent, null);
    return this;
  }

  expandAll() {
    const walk = (list) => { for (const r of list) { if (r.children.length) { this.expanded.add(r.id); walk(r.children); } } };
    walk(this._roots);
    this._refresh();
    return this;
  }

  collapseAll() {
    this.expanded.clear();
    this._refresh();
    return this;
  }

  // The flatten: visible rows only — collapsed subtrees contribute nothing.
  get visibleRows() { return this.list.items; }

  _refresh() {
    const flat = [];
    const walk = (list, depth) => {
      for (const r of list) {
        flat.push({ row: r, depth, hasKids: r.children.length > 0, open: this.expanded.has(r.id) });
        if (r.children.length && this.expanded.has(r.id)) walk(r.children, depth + 1);
      }
    };
    walk(this._roots ?? [], 0);
    this.list.setItems(flat);
    (this.engine ?? null)?.requestRender();
  }

  _colX(i) {
    let x = 8;
    for (let c = 0; c < i; c++) x += this.columns[c].width || Math.floor((this._w - 16) / this.columns.length);
    return x;
  }

  _bindRow(node, item) {
    if (!node._built) {
      node._built = true;
      // the expander ZONE is 24×24 (the ActionbarLock precedent — the zone
      // holds the floor, the glyph stays small); it may cross row bounds: declared
      node.expZone = new UINode({ interactive: true });
      node.expZone.auditAllow('overlap');
      // polish (unmistakable tree interactions, still a
 // table): the expander is a real CHEVRON now, not a typewriter +/-
      node.expZone.glyph = new TextNode('', { font: FONTS.body, size: 12, color: COLORS.accent, shadow: SHADOW });
      node.expZone.add(node.expZone.glyph);
      node.expZone.setSize(24, 24);
      node.expZone.on('pointerenter', () => {
        if (this.closest((n) => n.disabled === true)) return;
        if (node._item?.hasKids) node.expZone.glyph.setColor(COLORS.bone);
      });
      node.expZone.on('pointerleave', () => { node.expZone.glyph.setColor(COLORS.accent); node.expZone.fxScale = 1; });
      node.expZone.on('pointerdown', () => {
        if (this.closest((n) => n.disabled === true)) return;
        if (node._item?.hasKids) node.expZone.fxScale = 0.9;
      });
      node.expZone.on('pointerup', () => { node.expZone.fxScale = 1; });
      node.expZone.on('click', (e) => {
        e.stopPropagation?.();
        if (this.closest((n) => n.disabled === true)) return;
        if (node._item?.hasKids) this.toggle(node._item.row.id);
      });
      node.add(node.expZone);
      node.cells = this.columns.map((col, i) => {
        const t = new TextNode('', {
          font: i === 0 ? FONTS.header : FONTS.mono, size: 11,
          color: COLORS.text, shadow: SHADOW, maxWidth: 150, ellipsis: true,
        });
        node.add(t);
        return t;
      });
      // polish: a depth RAIL marks nesting at a glance, and a parent row
      // carries its child count beside the name — the hierarchy explains itself
      node.rail = new QuadNode({ color: COLORS.dividerDark });
      node.rail.visible = false;
      node.add(node.rail);
      node.kidCount = new TextNode('', { font: FONTS.mono, size: 10, color: COLORS.textFaint, shadow: SHADOW });
      node.kidCount.visible = false;
      node.add(node.kidCount);
    }
    node._item = item;
    node.expZone.glyph.setText(item.hasKids ? (item.open ? '▾' : '▸') : '');
    node.expZone.interactive = item.hasKids; // leaf rows carry no dead zone
    node.expZone.setPos(item.depth * 14, Math.round((this.rowH - 24) / 2));
    node.expZone.glyph.setPos(8, Math.round((24 - node.expZone.glyph.h) / 2));
    node.rail.visible = item.depth > 0;
    if (item.depth > 0) node.rail.setRect(item.depth * 14 - 8, 0, 1, this.rowH);
    node.kidCount.visible = item.hasKids;
    if (item.hasKids) node.kidCount.setText(String(item.row.children.length));
    this.columns.forEach((col, i) => {
      const t = node.cells[i];
      t.setText(String(item.row.cells[col.key] ?? ''));
      t.setColor(i === 0 ? COLORS.bone : COLORS.text);
      t.setPos(i === 0 ? 22 + item.depth * 14 : this._colX(i), Math.round((this.rowH - t.h) / 2));
    });
    if (item.hasKids) {
      node.kidCount.setPos(
        22 + item.depth * 14 + node.cells[0].w + 6,
        Math.round((this.rowH - node.kidCount.h) / 2));
    }
  }

  onLayout() {
    // Same law as NotificationCenter: paint from the LIVE box with the floors
    // enforced on the node, never from the constructed size. A ledger dropped
    // into a resizable window used to keep its authored width and hang its
    // header and list outside the frame.
    const W = Math.max(200, Math.round(this.w > 0 ? this.w : this._w));
    const H = Math.max(80, Math.round(this.h > 0 ? this.h : this._h));
    if (this.w !== W || this.h !== H) this.setSize(W, H);
    this._w = W;
    this._h = H;
    this._header.setRect(0, 0, W, 26);
    this._headerCells.forEach((cell, i) => {
      const w = Math.max(24, this.columns[i].width || Math.floor((W - 16) / this.columns.length));
      cell.setRect(this._colX(i) - 4, 0, w, 24);
      cell.wash.setRect(0, 0, w, 24);
      cell.label.setPos(4, 5);
      cell.label.setText(this.columns[i].label);
      const sorted = this.sortKey === this.columns[i].key;
      cell.sortInd.setText(sorted ? (this.sortDir > 0 ? '▲' : '▼') : '');
      if (sorted) cell.sortInd.setPos(w - cell.sortInd.w - 4, Math.round((24 - cell.sortInd.h) / 2));
    });
    this.list.setRect(0, 28, W, H - 28);
  }

  setDisabled(v) { setNodeDisabled(this, v); }
}

// ---------------- NotificationCenter ----------------
// The persistent prioritized ledger (the routing terminus): priority
// orders it (ties keep arrival order), unread wears the accent dot, a click
// marks read and JUMPS — loud `jump {id}`. Bounded by maxNotes.

export class NotificationCenter extends UINode {
  // opts: { width = 300, maxVisible = 6, maxNotes = 50, title, onJump }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const w = Number(opts.width);
    this._w = Number.isFinite(w) ? Math.max(200, Math.round(w)) : 300;
    const mv = Number(opts.maxVisible);
    this.maxVisible = Number.isFinite(mv) ? Math.max(1, Math.round(mv)) : 6;
    const mn = Number(opts.maxNotes);
    this.maxNotes = Number.isFinite(mn) ? Math.max(this.maxVisible, Math.round(mn)) : 50;
    this.title = String(opts.title ?? 'Advisors');
    this.onJump = opts.onJump ?? null;
    this.notes = [];
    this._seq = 0;
    this._rowH = 26; // pitch: 24px rows (the interactive hit floor) + 2 gap
    // STYLE section 2: every visible CONTAINER is a NineSlice with a registry
    // frame. A bare QuadNode fill is legal in exactly four roles (fills inside a frame,
    // 1-2px rules, full-screen scrims, hover washes) and "panel background" is not one
    // of them. This was a panel-sized voidBlack rect, which is invisible against a dark
    // page - the advisor column on tycoon.html read as bare floating text with dots
    // beside it rather than as a panel. It is stone now, like every other container.
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.titleText = new TextNode('', {
      font: FONTS.header, size: 12, smallCaps: true, letterSpacing: 2,
      color: COLORS.accent, shadow: SHADOW,
    });
    this.moreText = new TextNode('', { size: 10, color: COLORS.textMuted, shadow: SHADOW });
    this.add(this.bg, this.titleText, this.moreText);
    this._rows = [];
    for (let i = 0; i < this.maxVisible; i++) {
      const row = new UINode({ interactive: true });
      row.wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      row.wash.auditAllow('containment');
      row.dot = new QuadNode({ color: COLORS.accent });
      row.text = new TextNode('', {
        size: 11, color: COLORS.text, shadow: SHADOW, maxWidth: this._w - 40, ellipsis: true,
      });
      row.add(row.wash, row.dot, row.text);
      row.setSize(this._w - 12, 24);
      row.visible = false;
      row.on('pointerenter', () => {
        if (this.closest((n) => n.disabled === true)) return;
        row.wash.setBaseOpacity(METRICS.washFocus ?? 0.12);
      });
      row.on('pointerleave', () => { row.wash.setBaseOpacity(0); row.fxScale = 1; });
      row.on('pointerdown', () => {
        if (this.closest((n) => n.disabled === true)) return;
        row.fxScale = 0.98;
      });
      row.on('pointerup', () => { row.fxScale = 1; });
      row.on('click', () => {
        if (this.closest((n) => n.disabled === true)) return;
        if (row._note) this.jump(row._note.id);
      });
      // the wrap law's sibling: these rows are 24px CLICK
      // TARGETS on the hit floor, so a long counsel cannot wrap in place —
      // hover speaks the WHOLE sentence instead; a row that already fits its
      // lane stays tooltip-quiet (the fn spec declines with null)
      EldTooltip.attach(row, () => {
        const n = row._note;
        if (!n) return null;
        return measureText(row.text.fontCss, n.title) > row.text.style.maxWidth
          ? { title: this.title, desc: n.title } : null;
      });
      this.add(row);
      this._rows.push(row);
    }
    this.setSize(this._w, 30 + this.maxVisible * this._rowH + 16);
    this._refresh();
  }

  // note: { id?, title, priority = 0, onJump? } — higher priority rises; ties
  // keep arrival order. Returns the note's id. Silent by default; {silent:false}
  // commits `notechange {id, count, unread}` (the commit existed but a
 // literal `true` kept it permanently dead).
  push(note = {}, { silent = true } = {}) {
    // one seq bump per push (the auto-id path used to bump twice)
    const ord = ++this._seq;
    const id = note.id != null ? String(note.id) : `note-${ord}`;
    const priority = Number.isFinite(note.priority) ? note.priority : 0;
    const existing = this.notes.findIndex((n) => n.id === id);
    if (existing !== -1) this.notes.splice(existing, 1); // re-push refreshes
    this.notes.push({
      id, title: String(note.title ?? '…'), priority,
      read: false, onJump: typeof note.onJump === 'function' ? note.onJump : null,
      _ord: ord,
    });
    this.notes.sort((a, b) => b.priority - a.priority || a._ord - b._ord);
    if (this.notes.length > this.maxNotes) this.notes.length = this.maxNotes;
    this._refresh();
    // silent by default (a push is a model mutation); {silent:false} opts in —
    // the old literal `true` made this commit permanently dead
    commitChange(this, 'notechange', { id, count: this.notes.length, unread: this.unreadCount, action: 'push' }, silent, null);
    return id;
  }

  // The mutators speak the same contract: push learned {silent} at
  // while dismiss/markAllRead stayed voiceless — there was no way to
  // hear a dismissal at all. Payloads stay additive: `action` names the verb.
  dismiss(id, { silent = true } = {}) {
    const i = this.notes.findIndex((n) => n.id === String(id));
    if (i === -1) return false;
    this.notes.splice(i, 1);
    this._refresh();
    commitChange(this, 'notechange', { id: String(id), count: this.notes.length, unread: this.unreadCount, action: 'dismiss' }, silent, null);
    return true;
  }

  markRead(id, { silent = true } = {}) {
    const n = this.notes.find((x) => x.id === String(id));
    if (!n || n.read) return this;
    n.read = true;
    this._refresh();
    commitChange(this, 'readchange', { id: n.id, unread: this.unreadCount }, silent, null);
    return this;
  }

  markAllRead({ silent = true } = {}) {
    for (const n of this.notes) n.read = true;
    this._refresh();
    commitChange(this, 'readchange', { id: null, unread: 0 }, silent, null);
    return this;
  }

  // The click verb: mark read, then jump — loud.
  jump(id) {
    const n = this.notes.find((x) => x.id === String(id));
    if (!n) return this;
    this.markRead(n.id);
    uisound(this, 'click');
    commitChange(this, 'jump', { id: n.id }, false,
      this.onJump ? (_v, e) => this.onJump(e, e) : null);
    try { n.onJump?.(n.id); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); }
    return this;
  }

  get unreadCount() { return this.notes.reduce((s, n) => s + (n.read ? 0 : 1), 0); }

  _refresh() {
    this.titleText.setText(`${this.title} (${this.unreadCount})`);
    this._rows.forEach((row, i) => {
      const n = this.notes[i];
      row._note = n ?? null;
      row.visible = !!n;
      if (!n) return;
      row.dot.visible = !n.read;
      row.text.setText(n.title);
      row.text.setColor(n.read ? COLORS.textMuted : COLORS.text);
    });
    const hidden = Math.max(0, this.notes.length - this.maxVisible);
    this.moreText.setText(hidden > 0 ? str('countMoreCounsel', hidden) : '');
    this.invalidateLayout();
    (this.engine ?? null)?.requestRender();
  }

  onLayout() {
    // The width is LIVE — a grip drag (makeResizable) re-derives the lane and
    // re-clamps every row. The 200px floor is enforced on the NODE, not just on
    // the paint: painting a clamped width inside an unclamped rect put `bg` and
    // every row wash OUTSIDE the node box below the floor, and the latch never
    // settled because this.w and this._w could never agree there.
    const W = Math.max(200, Math.round(this.w > 0 ? this.w : this._w));
    if (this.w !== W) this.setSize(W, this.h);
    this._w = W;
    this.bg.setRect(0, 0, W, this.h);
    this.titleText.setPos(10, 8);
    this._rows.forEach((row, i) => {
      // the ROW box moves with the lane too: leaving it at its constructed width
      // left the hover wash overflowing it and the right half of a widened row
      // answering no hits at all
      row.setSize(W - 12, 24);
      row.setPos(6, 30 + i * this._rowH);
      row.wash.setRect(0, 0, W - 12, 24);
      row.dot.setRect(4, 9, 6, 6);
      row.text.setMaxWidth(W - 40);
      row.text.setPos(16, 5);
    });
    this.moreText.setPos(10, 30 + this.maxVisible * this._rowH);
  }

  setDisabled(v) { setNodeDisabled(this, v); }
}

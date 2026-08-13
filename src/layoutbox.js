// Structured layout containers — the foundational layout engine:
// VBox stacks children vertically, HBox rows them horizontally, with padding,
// gap, alignment, justification, per-child flex, and auto-sizing. The end of hand-rolled
// setPos arithmetic (the docs/STYLE.md law from).
//
// Engine contract (the single-pass law, engine.js:267–276): onLayout runs top-down once
// per dirty frame. A box therefore (1) PRE-MEASURES box children by running their
// onLayout first — pure-box trees converge in ONE frame; the engine's own later call
// no-ops because every setter early-returns on no-change — (2) reads every other
// child's CURRENT intrinsic size, (3) sizes flex/stretch children, (4) positions, and
// (5) sizes ITSELF when auto-sizing; a self-size change calls invalidateLayout() and
// the next pass settles (the documented ScrollArea convergence idiom, clip.js:216).
// Steady state performs zero mutations, so layout goes quiet.
//
// Options:
//   padding: n | {t, r, b, l}        inner inset (missing sides default 0)
//   gap: n                           between children along the main axis
//   align: 'start'|'center'|'end'|'stretch'    cross-axis placement (stretch SETS size)
//   justify: 'start'|'center'|'end'|'space-between'  main-axis distribution — only
//            meaningful when the main size is externally driven (autoMain off)
//   autoWidth / autoHeight: true     size self from content (turn OFF the driven axis)
//   minW/minH/maxW/maxH              clamps on the auto size
// Per-child flex: `box.flex(child, n)` or `child.layoutFlex = n` — flex children SPLIT
// the leftover main space (after intrinsic children and gaps) in proportion; flex is
// inert while the main axis is auto (there is no leftover to split). Children with
// visible=false or fitExclude are ignored entirely (not measured, not positioned).
// Cut per the spec: space-around/evenly (space-between ships); RTL stays documented.

import { UINode } from './node.js';
import { QuadNode, NineSliceNode } from './primitives.js';
import { COLORS } from './theme.js';
import { clamp, anchor, layoutMeasurable } from './layout.js';
import { requireEngine } from './widgets/widgets.js';

function parsePad(p) {
  if (typeof p === 'number' && Number.isFinite(p)) return { t: p, r: p, b: p, l: p };
  // B5: per-side finite-first — one NaN side poisons the axis cursor for every child
  const fin = (v) => (Number.isFinite(v) ? v : 0);
  if (p && typeof p === 'object') return { t: fin(p.t), r: fin(p.r), b: fin(p.b), l: fin(p.l) };
  return { t: 0, r: 0, b: 0, l: 0 };
}

// frame integration: `frame: 'panel.dark'` (a registry name, or a frame record) makes
// the box OWN its stone background — added first (paints beneath), fitExclude (layout
// ignores it), positioned full-bleed each pass; the frame's slice insets ADD to the
// user padding so content sits inside the stone natively (contentRect math for free).
// The audit's framed-composite detection then applies to the box automatically.
function attachFrame(box, frameOpt) {
  if (!frameOpt) return null;
  const rec = typeof frameOpt === 'string' ? requireEngine().textures.frame(frameOpt) : frameOpt;
  const bg = new NineSliceNode(rec);
  bg.fitExclude = true;
  box.add(bg);
  return bg;
}

const frameInsets = (box) => box.bg
  ? { t: box.bg.frame.t, r: box.bg.frame.r, b: box.bg.frame.b, l: box.bg.frame.l }
  : { t: 0, r: 0, b: 0, l: 0 };

class LayoutBox extends UINode {
  constructor(axis, opts = {}) {
    super(opts);
    this._isLayoutBox = true; // the pre-measure marker (VBox/HBox/GridBox/Stack all carry it)
    this._axis = axis; // 'y' = VBox, 'x' = HBox
    this.pad = parsePad(opts.padding);
    this.gap = Number.isFinite(opts.gap) ? opts.gap : 0;
    this.align = opts.align ?? 'start';
    this.justify = opts.justify ?? 'start';
    this.autoWidth = opts.autoWidth ?? true;
    this.autoHeight = opts.autoHeight ?? true;
    this.minW = opts.minW ?? 0; this.minH = opts.minH ?? 0;
    this.maxW = opts.maxW ?? Infinity; this.maxH = opts.maxH ?? Infinity;
    this.bg = attachFrame(this, opts.frame);
  }

  // Per-child flex share (also settable directly: child.layoutFlex = n).
  flex(child, n) {
    child.layoutFlex = n;
    this.invalidateLayout();
    return this;
  }

  onLayout() {
    const vert = this._axis === 'y';
    const fi = frameInsets(this); // a frame's slice insets add to the user padding
    const padMain0 = (vert ? this.pad.t : this.pad.l) + (vert ? fi.t : fi.l);
    const padMain1 = (vert ? this.pad.b : this.pad.r) + (vert ? fi.b : fi.r);
    const padCross0 = (vert ? this.pad.l : this.pad.t) + (vert ? fi.l : fi.t);
    const padCross1 = (vert ? this.pad.r : this.pad.b) + (vert ? fi.r : fi.b);
    const autoMain = vert ? this.autoHeight : this.autoWidth;
    const autoCross = vert ? this.autoWidth : this.autoHeight;

    const kids = this.children.filter(layoutMeasurable); // the shared measurability predicate
    // pre-measure nested boxes so pure-box trees settle in one pass (idempotent:
    // the engine's own visit re-runs this onLayout and every setter no-ops)
    for (const c of kids) if (c._isLayoutBox) c.onLayout();

    const mainOf = (n) => (vert ? n.h : n.w);
    const crossOf = (n) => (vert ? n.w : n.h);
    const gaps = kids.length > 1 ? this.gap * (kids.length - 1) : 0;

    // ---- flex: split the leftover main space (externally-driven main only) ----
    if (!autoMain) {
      const flexKids = kids.filter((c) => (c.layoutFlex ?? 0) > 0);
      if (flexKids.length) {
        const mainAvail = mainOf(this) - padMain0 - padMain1;
        let fixed = gaps;
        for (const c of kids) if ((c.layoutFlex ?? 0) <= 0) fixed += mainOf(c);
        const leftover = Math.max(0, mainAvail - fixed);
        const total = flexKids.reduce((s, c) => s + c.layoutFlex, 0);
        let spent = 0;
        for (let i = 0; i < flexKids.length; i++) {
          const c = flexKids[i];
          // the last flex child absorbs the rounding remainder — no pixel drift
          const share = i === flexKids.length - 1
            ? leftover - spent
            : Math.floor(leftover * (c.layoutFlex / total));
          spent += share;
          if (vert) c.setSize(c.w, share); else c.setSize(share, c.h);
        }
      }
    }

    // ---- cross sizing/placement inputs ----
    let contentCross = 0;
    for (const c of kids) contentCross = Math.max(contentCross, crossOf(c));
    const crossAvail = autoCross
      ? contentCross
      : Math.max(0, crossOf(this) - padCross0 - padCross1);
    if (this.align === 'stretch') {
      for (const c of kids) {
        if (c.layoutStretch === false) continue; // per-child opt-out (raster-sized nodes)
        // stretching an axis means THIS box drives it — a box child's own auto on
        // that axis turns off, or the two would resize each other forever
        if (c._isLayoutBox) { if (vert) c.autoWidth = false; else c.autoHeight = false; }
        if (vert) c.setSize(crossAvail, c.h); else c.setSize(c.w, crossAvail);
      }
    }

    // ---- main-axis distribution ----
    let contentMain = gaps;
    for (const c of kids) contentMain += mainOf(c);
    let cursor = padMain0;
    let extraGap = 0;
    if (!autoMain) {
      const mainAvail = mainOf(this) - padMain0 - padMain1;
      const slack = Math.max(0, mainAvail - contentMain);
      if (this.justify === 'center') cursor += slack / 2;
      else if (this.justify === 'end') cursor += slack;
      else if (this.justify === 'space-between' && kids.length > 1) extraGap = slack / (kids.length - 1);
    }

    // ---- position ----
    for (const c of kids) {
      const crossSlack = Math.max(0, crossAvail - crossOf(c));
      let crossPos = padCross0;
      if (this.align === 'center') crossPos += crossSlack / 2;
      else if (this.align === 'end') crossPos += crossSlack;
      if (vert) c.setPos(Math.round(crossPos), Math.round(cursor));
      else c.setPos(Math.round(cursor), Math.round(crossPos));
      cursor += mainOf(c) + this.gap + extraGap;
    }

    // ---- self-size (auto axes only; setSize early-returns when unchanged, and a
    // real change re-invalidates layout — the convergence idiom) ----
    let w = this.w, h = this.h;
    if (vert) {
      if (this.autoWidth) w = clamp(padCross0 + crossAvail + padCross1, this.minW, this.maxW);
      if (this.autoHeight) h = clamp(padMain0 + contentMain + padMain1, this.minH, this.maxH);
    } else {
      if (this.autoWidth) w = clamp(padMain0 + contentMain + padMain1, this.minW, this.maxW);
      if (this.autoHeight) h = clamp(padCross0 + crossAvail + padCross1, this.minH, this.maxH);
    }
    this.setSize(w, h);
    if (this.bg) this.bg.setRect(0, 0, this.w, this.h);
  }
}

// Children stack top-to-bottom; main axis = y.
export class VBox extends LayoutBox {
  constructor(opts = {}) { super('y', opts); }
}

// Children row left-to-right; main axis = x.
export class HBox extends LayoutBox {
  constructor(opts = {}) { super('x', opts); }
}

// Fixed-column grid. Cells size from options (cellW/cellH) or from CONTENT:
// cell width = the widest child, row height = that row's tallest child. `align`
// places children WITHIN their cell (start|center|end|stretch — stretch sets size).
// Wrap fell to the cut line: cols is fixed, rows = ceil(children/cols).
export class GridBox extends UINode {
  constructor(opts = {}) {
    super(opts);
    this._isLayoutBox = true;
    // B5: finite-first — Math.max(1, NaN) is NaN (the floor idiom is not a NaN guard)
    // and a NaN cols leaves every child unpositioned
    this.cols = Math.max(1, Math.floor(Number.isFinite(opts.cols) ? opts.cols : 4));
    this.cellW = Number.isFinite(opts.cellW) ? opts.cellW : null;
    this.cellH = Number.isFinite(opts.cellH) ? opts.cellH : null;
    this.gapX = opts.gapX ?? opts.gap ?? 0;
    this.gapY = opts.gapY ?? opts.gap ?? 0;
    this.pad = parsePad(opts.padding);
    this.align = opts.align ?? 'start';
    this.autoWidth = opts.autoWidth ?? true;
    this.autoHeight = opts.autoHeight ?? true;
    this.bg = attachFrame(this, opts.frame);
  }

  onLayout() {
    const fi = frameInsets(this);
    const padL = this.pad.l + fi.l, padT = this.pad.t + fi.t;
    const padR = this.pad.r + fi.r, padB = this.pad.b + fi.b;
    const kids = this.children.filter(layoutMeasurable); // the shared measurability predicate
    for (const c of kids) if (c._isLayoutBox) c.onLayout();
    const cw = this.cellW ?? kids.reduce((m, c) => Math.max(m, c.w), 0);
    const rows = Math.ceil(kids.length / this.cols);
    const rowH = [];
    for (let r = 0; r < rows; r++) {
      if (this.cellH !== null) { rowH.push(this.cellH); continue; }
      let m = 0;
      for (let i = r * this.cols; i < Math.min(kids.length, (r + 1) * this.cols); i++) {
        m = Math.max(m, kids[i].h);
      }
      rowH.push(m);
    }
    let y = padT;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < this.cols; col++) {
        const i = r * this.cols + col;
        if (i >= kids.length) break;
        const c = kids[i];
        if (this.align === 'stretch') {
          // the cell drives a stretched box child's size (see LayoutBox's stretch note)
          if (c._isLayoutBox) { c.autoWidth = false; c.autoHeight = false; }
          c.setSize(cw, rowH[r]);
        }
        const ox = this.align === 'center' ? (cw - c.w) / 2 : this.align === 'end' ? cw - c.w : 0;
        const oy = this.align === 'center' ? (rowH[r] - c.h) / 2 : this.align === 'end' ? rowH[r] - c.h : 0;
        c.setPos(Math.round(padL + col * (cw + this.gapX) + ox), Math.round(y + oy));
      }
      y += rowH[r] + this.gapY;
    }
    const usedCols = Math.min(this.cols, kids.length);
    const contentW = usedCols > 0 ? usedCols * cw + (usedCols - 1) * this.gapX : 0;
    const contentH = rows > 0 ? (y - this.gapY) - padT : 0;
    let w = this.w, h = this.h;
    if (this.autoWidth) w = padL + contentW + padR;
    if (this.autoHeight) h = padT + contentH + padB;
    this.setSize(w, h);
    if (this.bg) this.bg.setRect(0, 0, this.w, this.h);
  }
}

// Z-stacked children with 9-way anchor placement — label-over-frame, corner
// badges, centered emblems. Each child rides the box default `anchor` or its own
// `stack.place(child, where, insetX, insetY)`; keywords are layout.js anchor()'s:
// top-left top top-right left center right bottom-left bottom bottom-right.
export class Stack extends UINode {
  constructor(opts = {}) {
    super(opts);
    this._isLayoutBox = true;
    this.pad = parsePad(opts.padding);
    this.anchor = opts.anchor ?? 'top-left';
    this.autoWidth = opts.autoWidth ?? true;
    this.autoHeight = opts.autoHeight ?? true;
    this.minW = opts.minW ?? 0; this.minH = opts.minH ?? 0;
    this.maxW = opts.maxW ?? Infinity; this.maxH = opts.maxH ?? Infinity;
    this.bg = attachFrame(this, opts.frame);
  }

  place(child, where, insetX = 0, insetY = insetX) {
    child._stackPlace = { where, insetX, insetY };
    this.invalidateLayout();
    return this;
  }

  onLayout() {
    const fi = frameInsets(this);
    const padL = this.pad.l + fi.l, padT = this.pad.t + fi.t;
    const padR = this.pad.r + fi.r, padB = this.pad.b + fi.b;
    const kids = this.children.filter(layoutMeasurable); // the shared measurability predicate
    for (const c of kids) if (c._isLayoutBox) c.onLayout();
    let contentW = 0, contentH = 0;
    for (const c of kids) { contentW = Math.max(contentW, c.w); contentH = Math.max(contentH, c.h); }
    let w = this.w, h = this.h;
    if (this.autoWidth) w = clamp(padL + contentW + padR, this.minW, this.maxW);
    if (this.autoHeight) h = clamp(padT + contentH + padB, this.minH, this.maxH);
    this.setSize(w, h);
    const rect = { x: padL, y: padT, w: this.w - padL - padR, h: this.h - padT - padB };
    for (const c of kids) {
      const p = c._stackPlace ?? { where: this.anchor, insetX: 0, insetY: 0 };
      anchor(c, rect, p.where, p.insetX, p.insetY);
    }
    if (this.bg) this.bg.setRect(0, 0, this.w, this.h);
  }
}

// An invisible flex-share filler for driven-axis boxes: HBox(toolbar) = [title,
// Spacer(), buttons] pushes the buttons to the far edge.
export class Spacer extends UINode {
  constructor(flex = 1) {
    super({});
    this.layoutFlex = flex;
  }
}

// A themable rule line. Intrinsic thickness×thickness — an align:'stretch' box
// stretches it across the cross axis (horizontal rule in a VBox, vertical in an HBox).
export class Divider extends UINode {
  constructor(opts = {}) {
    super(opts);
    this.line = new QuadNode({ color: opts.color ?? COLORS.divider, opacity: opts.opacity ?? 1 });
    this.add(this.line);
    const t = opts.thickness ?? 1;
    this.setSize(t, t);
  }

  onLayout() { this.line.setRect(0, 0, this.w, this.h); }
}

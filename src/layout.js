// Layout helpers: pure functions that assign x/y (and optionally w/h) to child nodes.
// No constraint solving — game UI layouts here are fixed-size compositions.

export function row(children, { x = 0, y = 0, gap = 0, align = 'start', height = 0 } = {}) {
  let cx = x;
  for (const c of children) {
    if (!c.visible) continue;
    let cy = y;
    if (height > 0) {
      if (align === 'center') cy = y + Math.round((height - c.h) / 2);
      else if (align === 'end') cy = y + height - c.h;
    }
    c.setPos(Math.round(cx), Math.round(cy));
    cx += c.w + gap;
  }
  return Math.max(0, cx - gap - x); // content width (zero, not -gap, for no visible children)
}

export function column(children, { x = 0, y = 0, gap = 0, align = 'start', width = 0 } = {}) {
  let cy = y;
  for (const c of children) {
    if (!c.visible) continue;
    let cx = x;
    if (width > 0) {
      if (align === 'center') cx = x + Math.round((width - c.w) / 2);
      else if (align === 'end') cx = x + width - c.w;
    }
    c.setPos(Math.round(cx), Math.round(cy));
    cy += c.h + gap;
  }
  return Math.max(0, cy - gap - y); // content height (zero, not -gap, for no visible children)
}

export function grid(children, { x = 0, y = 0, cols = 4, cellW = 48, cellH = 48, gap = 0 } = {}) {
  let i = 0;
  for (const c of children) {
    if (!c.visible) continue;
    const col = i % cols, rowI = Math.floor(i / cols);
    c.setPos(Math.round(x + col * (cellW + gap)), Math.round(y + rowI * (cellH + gap)));
    i++;
  }
  return Math.max(0, Math.ceil(i / cols) * (cellH + gap) - gap); // content height (zero when empty)
}

// Anchor a child inside a rect: 'top-left'|'top'|'top-right'|'left'|'center'|'right'|'bottom-left'|'bottom'|'bottom-right'
export function anchor(child, rect, where = 'center', insetX = 0, insetY = insetX) {
  const { w, h } = rect;
  const cw = child.w, ch = child.h;
  let px = 0, py = 0;
  if (where.includes('left')) px = insetX;
  else if (where.includes('right')) px = w - cw - insetX;
  else px = Math.round((w - cw) / 2);
  if (where.includes('top')) py = insetY;
  else if (where.includes('bottom')) py = h - ch - insetY;
  else py = Math.round((h - ch) / 2);
  child.setPos((rect.x ?? 0) + px, (rect.y ?? 0) + py);
}

// The ONE content-extent law. Every measurer of "how far do the children
// reach" — window auto-size, ScrollArea auto-content, fitChildren — shares this
// predicate and this loop. Before it, four hand-rolled copies disagreed on the
// skip rules (the ScrollArea counted `fitExclude` chrome, so a box the window
// ignored could still mint scroll range) — the dead-band dialog class.
export const layoutMeasurable = (c) => c._visible && !c.fitExclude;

export function contentExtent(children, { preMeasure = true } = {}) {
  let w = 0, h = 0;
  for (const c of children) {
    if (!layoutMeasurable(c)) continue;
    // pre-measure box children so a box-composed body reads true before the
    // first pass (the layoutbox idiom; idempotent — every setter no-ops)
    if (preMeasure && c._isLayoutBox) c.onLayout();
    w = Math.max(w, c.x + c.w);
    h = Math.max(h, c.y + c.h);
  }
  return { w, h };
}

// Size a container to its children's extents. Call at the END of the container's onLayout,
// after positioning children. Children flagged `fitExclude` (chrome stretched to the parent,
// e.g. a background NineSlice) are skipped — re-stretch them after calling this.
// RULE: never fit an axis whose children size themselves FROM the parent on that axis,
// or you re-create a sizing cycle. One-pass stable for constructor-sized children.
export function fitChildren(node, { padBottom = 0, padRight = 0, fitW = false, minW = 0, minH = 0 } = {}) {
  const e = contentExtent(node.children);
  node.setSize(fitW ? Math.max(minW, e.w + padRight) : node.w, Math.max(minH, e.h + padBottom));
}

// The content box a 9-slice frame record leaves free of its stone border. `frame` is a
// texgen frame record ({ t, r, b, l } slice insets in CSS px — reg.frame(name) or a
// NineSliceNode's .frame); pad adds a uniform breathing inset inside the border.
// Containers must place children (and especially overlay scrollbars) inside this rect,
// never inside the border band — insets hand-tuned apart from the frame art drift.
export function contentRect(frame, w, h, pad = 0) {
  const x = frame.l + pad, y = frame.t + pad;
  return {
    x, y,
    w: Math.max(0, w - frame.l - frame.r - pad * 2),
    h: Math.max(0, h - frame.t - frame.b - pad * 2),
  };
}

// NaN-hardened: a poisoned `v` clamps to `min` instead of passing through — a NaN
// reaching geometry, shader uniforms, or `change` payloads corrupts silently (every
// value widget routes its setter through here). Valid inputs behave identically.
export function clamp(v, min, max) {
  const c = Math.min(max, v);
  return c >= min ? c : min;
}

export function rectsIntersect(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

export function intersectRects(a, b) {
  if (!a) return b; if (!b) return a;
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

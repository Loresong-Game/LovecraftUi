// Form rows — the form family on structured layout. A FormRow is an
// HBox of [label lane | control], vertically centered; a Form is a VBox of rows
// sharing ONE label column and ONE row-height lane, so every settings screen stops
// hand-rolling `label.setPos(4, y); widget.setPos(150, y - 6)` arithmetic.
//
// Column law: labelWidth 'auto' (default) resolves to the widest label across the
// form's rows, re-measured every pass (idempotent — setters early-return, so a
// settled form performs zero mutations). Height law: every row presents the SAME
// lane (max of rowHeight and that row's control), so mixed controls (34px fields,
// 24px toggles, 20px radios) keep one visual rhythm; the row DRIVES its height —
// one owner per axis, the stretch rule. The focus ring needs nothing here: it
// is fitExclude chrome (boxes ignore it) and re-fits its parent every layout pass.

import { UINode } from '../node.js';
import { TextNode } from '../text.js';
import { HBox, VBox } from '../layoutbox.js';
import { COLORS, METRICS } from '../theme.js';

export class FormRow extends HBox {
  constructor(label, control, opts = {}) {
    super({
      gap: opts.gap ?? METRICS.space12,
      align: 'center',
    });
    this._isFormRow = true;
    this.labelAlign = opts.labelAlign ?? 'left';
    this.labelNode = new TextNode(label ?? '', {
      size: 12, color: COLORS.textMuted, ...(opts.labelStyle ?? {}),
    });
    // the label LANE: a fixed-width cell the text sits inside (the column), so the
    // control's x never depends on this row's own label length
    this.labelCell = new UINode({});
    this.labelCell.add(this.labelNode);
    this.labelCell.onLayout = () => {
      const c = this.labelCell, t = this.labelNode;
      t.setPos(
        this.labelAlign === 'right' ? Math.max(0, c.w - Math.ceil(t.w)) : 0,
        Math.round((c.h - t.h) / 2),
      );
    };
    this.control = control;
    this.add(this.labelCell, control);
    this._labelW = null;
    // B5: finite-first — a NaN labelWidth poisons the label cell and the control x
    this.setLabelWidth(Number.isFinite(opts.labelWidth) ? opts.labelWidth : Math.ceil(this.labelNode.w));
  }

  setLabelWidth(w) {
    if (w === this._labelW) return;
    this._labelW = w;
    this.labelCell.setSize(w, Math.max(Math.ceil(this.labelNode.h), 1));
    this.invalidateLayout();
  }
}

export class Form extends VBox {
  constructor(opts = {}) {
    super({
      gap: opts.gap ?? METRICS.space8,
      padding: opts.padding,
      frame: opts.frame,
      align: opts.align ?? 'start',
      autoWidth: opts.autoWidth ?? true,
      autoHeight: opts.autoHeight ?? true,
      minW: opts.minW, minH: opts.minH, maxW: opts.maxW, maxH: opts.maxH,
    });
    // B5: finite-first — a NaN rowHeight/labelWidth poisons every row rect and the
    // VBox cursor below it; a non-finite numeric labelWidth falls back to 'auto'
    this.labelWidth = (typeof opts.labelWidth === 'number' && !Number.isFinite(opts.labelWidth)) ? 'auto' : (opts.labelWidth ?? 'auto');
    this.rowHeight = Number.isFinite(opts.rowHeight) ? Math.max(0, opts.rowHeight) : 34; // the field-class default height
  }

  // Build-and-add convenience; returns the row (control rides row.control).
  row(label, control, opts = {}) {
    const r = new FormRow(label, control, opts);
    this.add(r);
    return r;
  }

  onLayout() {
    const rows = this.children.filter((c) => c._isFormRow && c._visible && !c.fitExclude);
    let col = this.labelWidth;
    if (col === 'auto') {
      col = 0;
      for (const r of rows) col = Math.max(col, Math.ceil(r.labelNode.w));
    }
    for (const r of rows) {
      r.setLabelWidth(col);
      // the form owns every row's height lane (auto off — one owner per axis)
      r.autoHeight = false;
      r.setSize(r.w, Math.max(this.rowHeight, r.control.h));
    }
    super.onLayout();
  }
}

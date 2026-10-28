// CheckList: a column of labelled switches, each with an optional help line,
// that sizes itself at construction — the picker a settings screen used to build by
// hand from ToggleLabels in a VBox and then measure by guessing. `.value` is the checked
// ids in item order; one gesture is ONE `change {id, checked, value}` with one voice (the
// inner toggle's own event stops at the row; a loud programmatic set speaks through the
// list instead).
import { UINode } from '../node.js';
import { TextNode } from '../text.js';
import { VBox, HBox } from '../layoutbox.js';
import { COLORS, METRICS } from '../theme.js';
import { ToggleLabel, commitChange, setNodeDisabled, requireEngine } from './widgets.js';

export class CheckList extends UINode {
  // opts: { items: [{ id, label, help?, checked?, disabled? }], onChange, gap = METRICS.space8, width }
  constructor(opts = {}) {
    super({ interactive: false });
    requireEngine();
    this.onChange = opts.onChange ?? null;
    const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : METRICS.space8;
    const width = Number.isFinite(opts.width) ? Math.max(0, Math.round(opts.width)) : 0;
    this.box = new VBox({ gap });
    this.add(this.box);
    this.items = [];
    const seen = new Set();
    for (const spec of opts.items ?? []) {
      if (!spec || spec.id == null) { console.warn('LovecraftUI CheckList: an item without an id was dropped.'); continue; }
      const id = String(spec.id);
      if (seen.has(id)) { console.warn(`LovecraftUI CheckList: duplicate item id '${id}' dropped.`); continue; }
      seen.add(id);
      const row = new ToggleLabel(String(spec.label ?? id), { checked: spec.checked === true });
      const item = { id, row, help: null, disabled: false };
      // the row's own change IS the gesture (the inner toggle voiced it); it stops here so
      // the consumer hears ONE change from the list
      row.on('change', (e) => { e.stopPropagation(); this._emit(id, e.checked, { silent: false, voice: false }); });
      const cell = new VBox({ gap: 2 });
      cell.add(row);
      if (spec.help) {
        item.help = new TextNode(String(spec.help), {
          size: 12, color: COLORS.textMuted, multiline: true,
          maxWidth: Math.max(80, (width || 320) - 32),
        });
        const lane = new HBox({ padding: { t: 0, r: 0, b: 0, l: 32 } }); // the help line indents past the box
        lane.add(item.help);
        cell.add(lane);
      }
      if (spec.disabled === true) { row.setDisabled(true); item.disabled = true; }
      this.items.push(item);
      this.box.add(cell);
    }
    this.box.onLayout(); // the measure-before-the-first-frame recipe: the box settles now
    this.setSize(Math.max(this.box.w, width), this.box.h);
  }

  get value() { return this.items.filter((it) => it.row.checked).map((it) => it.id); }
  isChecked(id) { return this.items.find((it) => it.id === String(id))?.row.checked ?? false; }

  // Silent by default (convention 1); `silent: false` speaks once through the list.
  setChecked(id, v, { silent = true } = {}) {
    const it = this.items.find((x) => x.id === String(id));
    if (!it) return false;
    v = !!v;
    if (it.row.checked === v) return true;
    it.row.setChecked(v);
    this._emit(it.id, v, { silent, voice: true });
    return true;
  }

  // Every item at once; one `change { id: null, checked, value }` if anything moved.
  setAll(v, { silent = true } = {}) {
    v = !!v;
    let changed = false;
    for (const it of this.items) if (it.row.checked !== v) { it.row.setChecked(v); changed = true; }
    if (changed) this._emit(null, v, { silent, voice: true });
    return this;
  }

  setItemDisabled(id, v) {
    const it = this.items.find((x) => x.id === String(id));
    if (!it) return false;
    it.disabled = v === true;
    it.row.setDisabled(it.disabled);
    return true;
  }

  _emit(id, checked, { silent, voice }) {
    const payload = { id, checked, value: this.value };
    if (voice) { commitChange(this, 'change', payload, silent, this.onChange); return; }
    // the gesture path: the toggle already voiced the click — dispatch without a second one
    this.dispatch('change', payload);
    if (this.onChange) {
      try { this.onChange(payload.value, payload); } catch (err) { console.warn('LovecraftUI: a widget callback threw.', err); }
    }
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    this.box.onLayout();
    const w = Math.max(this.w, this.box.w), h = this.box.h;
    if (w !== this.w || h !== this.h) this.setSize(w, h);
  }
}

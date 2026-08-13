// Tabs: a horizontal tab strip over one scrolling content pane. Each tab is a build
// function that fills the pane when selected (the SettingsPanel pattern, generalized).
// tabs: [{ id, label, icon?, build(contentNode, tabs) }]. Selecting disposes the old
// pane content and runs the new tab's build — tab content is rebuilt, never cached.

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { ScrollArea } from '../clip.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { widgetsEngine, commitChange, setNodeDisabled } from './widgets.js';
import { scrollSkin } from './windows.js';

const STRIP_H = 36;

export class Tabs extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    this.focusable = true;
    this.tabs = opts.tabs ?? [];
    this.onChange = opts.onChange ?? null;
    this.activeId = null;

    this.stripBg = new QuadNode({ color: COLORS.voidBlack, opacity: 0.45 });
    this.stripRule = new QuadNode({ color: COLORS.divider ?? COLORS.stoneMid, opacity: 0.9 });
    this.pane = new ScrollArea({ skin: scrollSkin() }); // rails overlay, no reserved lane
    this.add(this.stripBg, this.stripRule, this.pane);

    this.items = [];
    const eng = widgetsEngine();
    for (const tab of this.tabs) {
      const item = new UINode({ interactive: true, name: 'tab-' + tab.id });
      const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      const bar = new QuadNode({ color: COLORS.accent });
      bar.visible = false;
      const label = new TextNode(tab.label, {
        font: FONTS.header, size: 13, color: COLORS.textFaint, smallCaps: true, letterSpacing: 1,
        shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
      });
      const icon = tab.icon ? new QuadNode({ texture: eng.textures.get(`ui.${tab.icon}`) }) : null;
      item.add(wash, bar, label);
      if (icon) item.add(icon);
      item.tab = tab;
      item._wash = wash; item._bar = bar; item._label = label; item._icon = icon;
      item._hovered = false; item._pressed = false;
      // the wash speaks on EVERY tab, COMPOSED over the active indicator's
      // resting 0.18 (stomping it erased the indicator under a parked cursor —
      // the first walker run caught exactly that): rest + hover/press on top.
      item._paintWash = () => {
        const rest = this.activeId === tab.id ? 0.18 : 0;
        wash.setBaseOpacity(rest + (item._pressed ? METRICS.washPress : item._hovered ? METRICS.washHover : 0));
      };
      item.on('pointerenter', () => {
        // hover delivers into sealed subtrees (the tooltip rule) — the strip's own
        // art seal lives here (numberfield does this right; the strip didn't)
        if (this.closest((n) => n.disabled === true)) return;
        item._hovered = true; item._paintWash();
        if (this.activeId !== tab.id) label.setColor(COLORS.text);
      });
      item.on('pointerleave', () => {
        item._hovered = false; item._pressed = false; item._paintWash();
        if (this.activeId !== tab.id) label.setColor(COLORS.textFaint);
      });
      item.on('pointerdown', () => { item._pressed = true; item._paintWash(); });
      item.on('pointerup', (e) => { item._pressed = false; if (e.canceled) item._hovered = false; item._paintWash(); }); // canceled ups end dark (B3)
      item.on('click', () => this.selectTab(tab.id, { silent: false }));
      this.items.push(item);
      this.add(item);
    }

    // Left/Right walk the strip from the focused container (loud, like a click).
    this.on('keydown', (e) => {
      if (this.disabled) return; // disabled is inert on the keyboard path too
      // Strip-walking is the CONTAINER's gesture: a focused child in the pane owns its
      // own arrows — acting on its bubbled keydown would dispose the pane under it.
      if (e.target !== this) return;
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d || !this.tabs.length) return;
      e.preventDefault();
      const i = this.tabs.findIndex(t => t.id === this.activeId);
      const next = this.tabs[((i + d) % this.tabs.length + this.tabs.length) % this.tabs.length];
      this.selectTab(next.id, { silent: false });
    });

    this.setSize(opts.width ?? 420, opts.height ?? 300);
    if (this.tabs.length) this.selectTab(this.tabs[0].id); // initial selection is silent
  }

  get content() { return this.pane.content; }

  selectTab(id, { silent = true } = {}) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab || this.activeId === id) return false;
    this.activeId = id;
    for (const item of this.items) {
      const active = item.tab.id === id;
      item._paintWash(); // rest 0.18 for the new active, 0 for the rest — hover/press compose
      item._bar.visible = active;
      item._label.setColor(active ? COLORS.accent : COLORS.textFaint);
    }
    for (const c of [...this.pane.content.children]) c.dispose();
    this.pane.setScroll(0);
    tab.build(this.pane.content, this);
    // a build() that re-enters selectTab(other) completes first and owns the pane —
    // the outer tail must not fire a second change carrying the now-stale id (the
    // CastBar epoch shape, applied by re-checking state after the consumer ran)
    if (this.activeId !== id) return true;
    this.invalidateLayout();
    commitChange(this, 'change', { value: id, id }, silent, this.onChange ? () => this.onChange(id) : null);
    return true;
  }

  setDisabled(v) {
    setNodeDisabled(this, v); // releases focus so arrows can't reach a disabled strip
    // a cursor parked on a tab gets no leave when the seal lands — reset the
    // hover/press memory and repaint each wash to its rest level (B1 class sweep)
    if (v) for (const item of this.items) { item._hovered = false; item._pressed = false; item._paintWash(); }
  }

  onLayout() {
    this.stripBg.setRect(0, 0, this.w, STRIP_H);
    this.stripRule.setRect(0, STRIP_H - 1, this.w, 1);
    let x = 4;
    for (const item of this.items) {
      const iconW = item._icon ? 24 : 0;
      const w = Math.ceil(item._label.w) + 28 + iconW;
      item.setRect(x, 0, w, STRIP_H);
      item._wash.setRect(0, 0, w, STRIP_H);
      item._bar.setRect(0, STRIP_H - 3, w, 3);
      if (item._icon) item._icon.setRect(12, Math.round((STRIP_H - 18) / 2), 18, 18);
      item._label.setPos(14 + iconW, Math.round((STRIP_H - item._label.h) / 2));
      x += w + 2;
    }
    this.pane.setRect(0, STRIP_H + 6, this.w, this.h - STRIP_H - 6);
  }
}

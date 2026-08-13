// EldToast: queued corner notifications. Toasts stack from the top-right, hold for
// their duration (the clock rides engine.ticker — never wall timers), pause while
// hovered, then fade out; overflow beyond the visible maximum queues FIFO. Variants
// color the title: info (accent), loot (rare-blue), achievement (bone).

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { HBox, VBox } from '../layoutbox.js';
import { uisound } from './widgets.js';

const TOAST_W = 280;

const VARIANT_COLOR = () => ({
  info: COLORS.accent,
  loot: COLORS.rarityRare ?? COLORS.accent,
  achievement: COLORS.bone,
});

export const EldToast = {
  engine: null,
  root: null,
  live: [],
  queue: [],
  maxVisible: 4,
  _offTick: null,

  init(engine) {
    this.engine = engine;
    this.root = new UINode({ name: 'toasts' });
    engine.layers.tooltip.add(this.root); // beneath the tooltip node (added later at init)
    const stack = () => this._stack();
    this.root.onLayout = stack;
    this._offTick = engine.ticker.add((dt) => this._tick(dt));
    return this;
  },

  // spec: { title, message, variant: 'info'|'loot'|'achievement', icon, duration,
  //         markup } — markup: true parses the BODY for {color}/{icon}/{b}/{i} runs
  // (opt-in; the title stays single-run). icon is any registered ability icon
  // id; duration is seconds on screen.
  show(spec = {}) {
    if (!this.engine) return this;
    spec = spec ?? {}; // the default catches only undefined; show(null) must not throw
    if (this.live.length >= this.maxVisible) this.queue.push(spec);
    else this._present(spec);
    return this;
  },

  _present({ title = '', message = '', variant = 'info', icon = null, duration = 4, markup = false }) {
    // B5: finite-first — t >= NaN is never true, so a NaN duration never
    // auto-dismisses and one such toast at maxVisible wedges the queue forever
    if (!Number.isFinite(duration)) duration = 4;
    const eng = this.engine;
    // the card is a framed HBox — [icon? | VBox(title, message?)], vertically
    // centered. The tooltip frame's 8px insets add to the padding, the height
    // measures itself, and containment holds by construction — the hand-summed
    // height arithmetic this card used to carry is gone.
    const node = new HBox({
      interactive: true, name: 'toast',
      frame: eng.textures.frame('tooltip.frame'),
      // icon cards pad to the classic 46px floor (10+26+10) so the icon centers
      // exactly; text-only cards keep the old 9px/10px text insets
      padding: { t: icon ? 2 : 1, r: 4, b: 2, l: icon ? 2 : 4 }, gap: 8, align: 'center',
      autoWidth: false, autoHeight: true,
    });
    node.setSize(TOAST_W, 10); // width is law; the height converges from content
    const textX = icon ? 44 : 12;
    const titleNode = new TextNode(title, {
      font: FONTS.header, size: 13, smallCaps: true, letterSpacing: 1,
      color: VARIANT_COLOR()[variant] ?? COLORS.accent,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
      maxWidth: TOAST_W - textX - 12, ellipsis: true,
    });
    const col = new VBox({ gap: 4 });
    col.add(titleNode);
    if (message) {
      const msg = new TextNode(message, {
        size: 12, color: COLORS.text, multiline: true, maxWidth: TOAST_W - textX - 12,
        markup: markup === true,
        shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
      });
      col.add(msg);
    }
    if (icon) {
      const iconQuad = new QuadNode({ texture: eng.textures.get(`icon.${icon}`) });
      iconQuad.setSize(26, 26);
      node.add(iconQuad);
    }
    node.add(col);

    // titleNode rides the record so EldNotify's collapse counter can retitle a live toast
    const rec = { node, t: 0, duration, paused: false, dying: false, titleNode };
    // a toast's hover feedback is TEMPORAL (the hold below) and its click
    // feedback is the dismiss itself — neither is subtree art; declared, counted
    node.auditAllow('hover', 'press');
    node.on('pointerenter', () => { rec.paused = true; });  // hover holds the toast
    node.on('pointerleave', () => { rec.paused = false; });
    node.on('click', () => this._dismiss(rec));             // click dismisses early
    this.live.push(rec);
    this.root.add(node);
    node.fxOpacity = 0;
    this.engine.ticker.tween(node, { fxOpacity: 1 }, { dur: 0.15 });
    this.root.invalidateLayout();
    uisound(node, 'notify');
  },

  _tick(dt) {
    for (const rec of [...this.live]) {
      if (rec.paused || rec.dying) continue;
      rec.t += dt;
      if (rec.t >= rec.duration) this._dismiss(rec);
    }
  },

  _dismiss(rec) {
    if (rec.dying) return;
    rec.dying = true;
    this.engine.ticker.tween(rec.node, { fxOpacity: 0 }, {
      dur: 0.15,
      onDone: () => {
        rec.node.dispose();
        const i = this.live.indexOf(rec);
        if (i !== -1) this.live.splice(i, 1);
        this.root?.invalidateLayout();
        if (this.queue.length && this.live.length < this.maxVisible) this._present(this.queue.shift());
        // EldNotify feeds its priority queue into whatever slot our own queue left free
        if (this._onFree) this._onFree();
      },
    });
  },

  _stack() {
    const eng = this.engine;
    if (!eng) return;
    this.root.setRect(0, 0, eng.width, eng.height);
    // stack spacing rides the METRICS.space ladder, read at layout time
    const margin = METRICS.space12, gap = METRICS.space8;
    let y = margin;
    for (const rec of this.live) {
      rec.node.setPos(eng.width - TOAST_W - margin, y);
      y += rec.node.h + gap;
    }
  },

  // Teardown hook: nodes die with the tooltip layer; timers and refs drop here.
  _reset() {
    if (this._offTick) { this._offTick(); this._offTick = null; }
    this.live = [];
    this.queue = [];
    this.root = null;
    this._onFree = null; // EldNotify re-wires it every boot
    this.engine = null;
  },
};

// EldToast: queued corner notifications. Toasts stack from the top-right, hold for
// their duration (the clock rides engine.ticker — never wall timers), pause while
// hovered, then fade out; overflow beyond the visible maximum queues FIFO. Variants
// color the title: info (accent), loot (rare-blue), achievement (bone), urgent (the
// negative token, with a tinted fill and a rim). A sticky toast holds until it
// is clicked; onClick runs before the dismiss.

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { HBox, VBox } from '../layoutbox.js';
import { uisound } from './widgets.js';

const TOAST_W = 280;
// sticky cards hold a slot until clicked — at most this many of the visible
// maximum, so two slots always cycle and the queue never starves behind them
const STICKY_MAX = 2;

const VARIANT_COLOR = () => ({
  info: COLORS.accent,
  loot: COLORS.rarityRare ?? COLORS.accent,
  achievement: COLORS.bone,
  urgent: COLORS.negative,
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
    if (!this._hasSlot(spec)) this.queue.push(spec);
    else this._present(spec);
    return this;
  },

  // sticky = the flag, or an infinite duration
  _isSticky(spec) { return spec?.sticky === true || spec?.duration === Infinity; },

  // a free slot for this spec — the visible maximum, and the sticky cap
  _hasSlot(spec) {
    if (this.live.length >= this.maxVisible) return false;
    if (this._isSticky(spec) && this.live.filter((r) => r.sticky).length >= STICKY_MAX) return false;
    return true;
  },

  _present({ title = '', message = '', variant = 'info', icon = null, duration = 4, markup = false, sticky = false, onClick = null }) {
    sticky = sticky === true || duration === Infinity; // read BEFORE the finite guard
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
    // the urgent variant wears an edge — a faint fill under the text and a 2px rim
    // over it, both quads (no texture: the atlas never moves), fit-excluded so the card's
    // measured height ignores them, declared like every interaction wash; positioned by
    // CHAINING the box's own layout pass. Static: STYLE forbids idle loops.
    const urgent = variant === 'urgent';
    const tint = urgent ? new QuadNode({ color: COLORS.negative, opacity: 0.08 }) : null;
    if (tint) { tint.fitExclude = true; tint.auditAllow('overlap', 'containment'); node.add(tint); }
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
    const rim = urgent ? [0, 1, 2, 3].map(() => new QuadNode({ color: COLORS.negative, opacity: 0.55 })) : null;
    if (rim) {
      for (const q of rim) { q.fitExclude = true; q.auditAllow('overlap', 'containment'); }
      node.add(...rim);
      const own = node.onLayout.bind(node);
      node.onLayout = function () {
        own();
        const f = this.bg?.frame ?? { l: 0, t: 0, r: 0, b: 0 };
        const x = f.l, y = f.t, w = Math.max(0, this.w - f.l - f.r), h = Math.max(0, this.h - f.t - f.b);
        tint.setRect(x, y, w, h);
        rim[0].setRect(x, y, w, 2); rim[1].setRect(x, y + h - 2, w, 2);
        rim[2].setRect(x, y, 2, h); rim[3].setRect(x + w - 2, y, 2, h);
      };
    }

    // titleNode rides the record so EldNotify's collapse counter can retitle a live toast
    const rec = { node, t: 0, duration, paused: false, dying: false, titleNode, variant, sticky, onClick, tint, rim };
    // a toast's hover feedback is TEMPORAL (the hold below) and its click
    // feedback is the dismiss itself — neither is subtree art; declared, counted
    node.auditAllow('hover', 'press');
    if (typeof onClick === 'function') node.cursor = 'pointer'; // a card that does something says so
    node.on('pointerenter', () => { rec.paused = true; });  // hover holds the toast
    node.on('pointerleave', () => { rec.paused = false; });
    node.on('click', (e) => {
      // the consumer's verb runs BEFORE the dismiss (a guest: a throw must not
      // strand the card — the X16 rule)
      if (typeof rec.onClick === 'function') {
        try { rec.onClick(rec, e); } catch (err) { console.warn('LovecraftUI: a toast onClick threw.', err); }
      }
      this._dismiss(rec);
    });
    this.live.push(rec);
    this.root.add(node);
    node.fxOpacity = 0;
    this.engine.ticker.tween(node, { fxOpacity: 1 }, { dur: 0.15 });
    this.root.invalidateLayout();
    uisound(node, 'notify');
  },

  _tick(dt) {
    for (const rec of [...this.live]) {
      if (rec.paused || rec.dying || rec.sticky) continue; // a sticky card has no clock
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
        // promote the first queued spec a slot ADMITS (a capped sticky must not block the line)
        const next = this.queue.findIndex((s) => this._hasSlot(s));
        if (next !== -1) this._present(this.queue.splice(next, 1)[0]);
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

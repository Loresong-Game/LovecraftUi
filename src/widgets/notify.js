// EldNotify: notification ROUTING over the existing rails. Three channels:
// 'toast' rides the EldToast corner stack, 'banner' is a one-at-a-time center-top
// stone banner, 'log' writes only the EldEvents trail. Priorities order the pending
// queue (higher first, FIFO within a tier); a `key` dedupes — a repeat while its
// notification is live collapses into a "×n" counter on the live title (and resets
// its clock); the do-not-disturb flag quiets every popup channel down to the log,
// so nothing is lost, only silenced. EldNotify feeds toasts ONLY into free slots —
// direct EldToast.show() users keep their own FIFO queue untouched.

import { TextNode } from '../text.js';
import { VBox } from '../layoutbox.js';
import { COLORS, FONTS } from '../theme.js';
import { uisound } from './widgets.js';
import { EldToast } from './toast.js';
import { EldEvents } from './events.js';
import { animateIn, animateOut } from '../animate.js';

const BANNER_W = 420;

export const EldNotify = {
  engine: null,
  doNotDisturb: false, // while true, toast/banner sends route to the log channel
  _pending: [],        // [{channel, title, message, icon, variant, duration, priority, key, count, seq}]
  _keyed: new Map(),   // key -> pending-or-live record (dedupe target)
  _banner: null,       // { rec, node, titleNode, off } while a banner is up
  _seq: 0,

  init(engine) {
    this.engine = engine;
    EldToast._onFree = () => this._drain();
    return this;
  },

  // spec: { channel: 'toast'|'banner'|'log' (default 'toast'), title, message, icon,
  //         variant, duration, priority = 0, key = null, data }
  send(spec = {}) {
    if (!this.engine) return this;
    const s = {
      channel: 'toast', title: '', message: '', icon: null, variant: 'info',
      duration: 4, priority: 0, key: null, data: null, ...spec,
    };
    if (!Number.isFinite(s.duration)) s.duration = 4; // B5: a NaN duration wedges the banner queue
    if (s.channel === 'log' || this.doNotDisturb) {
      EldEvents.log(s.message ? (s.title ? `${s.title} - ${s.message}` : s.message) : String(s.title), 'NOTIFY');
      return this;
    }
    if (s.key != null) {
      const known = this._keyed.get(s.key);
      if (known) {
        known.count += 1;
        this._recount(known);
        return this;
      }
    }
    const rec = { ...s, count: 1, seq: this._seq++, live: null };
    if (s.key != null) this._keyed.set(s.key, rec);
    this._pending.push(rec);
    this._pending.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
    this._drain();
    return this;
  },

  // a keyed repeat retitles the LIVE surface and resets its clock (a hammered
  // notification stays visible); a still-pending one just carries the count up
  _recount(rec) {
    const title = `${rec.title} ×${rec.count}`;
    if (rec.live?.titleNode && !rec.live.dying) {
      rec.live.titleNode.setText(title);
      rec.live.t = 0;
      rec.live.node.invalidateLayout();
    } else if (this._banner && !this._banner.closing && this._banner.rec === rec) {
      this._banner.titleNode.setText(title);
      this._banner.t = 0;
      this._banner.node.invalidateLayout();
    } else {
      // the surface is mid-fade (a dying toast, a closing banner) or already gone:
      // the repeat must NOT vanish — requeue the record so the next drain presents
      // it fresh, count intact (it used to be silently dropped in this window)
      if (!this._pending.includes(rec)) {
        rec.presented = false;
        rec.live = null;
        this._pending.push(rec);
        this._pending.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
      }
      this._drain();
    }
  },

  _drain() {
    if (!this.engine) return;
    // sweep keyed records whose toasts have died (their keys become reusable)
    for (const [key, rec] of [...this._keyed]) {
      const gone = rec.live && !EldToast.live.includes(rec.live);
      const bannerGone = rec.channel === 'banner' && rec.presented && this._banner?.rec !== rec;
      if (gone || bannerGone) this._keyed.delete(key);
    }
    for (let i = 0; i < this._pending.length;) {
      const rec = this._pending[i];
      if (rec.channel === 'banner') {
        if (this._banner) { i++; continue; } // one banner at a time; wait for it
        this._pending.splice(i, 1);
        this._presentBanner(rec);
      } else {
        if (EldToast.live.length >= EldToast.maxVisible) { i++; continue; } // no free slot
        this._pending.splice(i, 1);
        EldToast.show({
          title: rec.count > 1 ? `${rec.title} ×${rec.count}` : rec.title,
          message: rec.message, icon: rec.icon, variant: rec.variant, duration: rec.duration,
        });
        rec.live = EldToast.live[EldToast.live.length - 1] ?? null; // we verified a free slot
        rec.presented = true;
      }
    }
  },

  _presentBanner(rec) {
    // mark the presentation (the toast branch always did; this branch never did, so a
    // KEYED banner's reap conditions were permanently false — an immortal _keyed entry
    // retaining the full spec incl. consumer data, executed to 60 records)
    rec.presented = true;
    rec.live = null;
    const eng = this.engine;
    // the banner is a framed VBox — the tooltip frame's 8px insets add to the
    // 4px padding (the old 12px inset, now derived), the height measures itself,
    // and the hand-summed arithmetic is gone. Text stays raster-sized (align
    // 'center' places, never stretches).
    const node = new VBox({
      interactive: true, name: 'banner',
      frame: eng.textures.frame('tooltip.frame'),
      padding: 4, gap: 4, align: 'center',
      autoWidth: false, autoHeight: true,
    });
    node.setSize(BANNER_W, 10); // width is law; the height converges from content
    const titleNode = new TextNode(rec.count > 1 ? `${rec.title} ×${rec.count}` : rec.title, {
      font: FONTS.header, size: 15, smallCaps: true, letterSpacing: 2, color: COLORS.accent,
      align: 'center', fixedW: BANNER_W - 24, maxWidth: BANNER_W - 24, ellipsis: true,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    node.add(titleNode);
    if (rec.message) {
      const msg = new TextNode(rec.message, {
        size: 13, color: COLORS.text, align: 'center', fixedW: BANNER_W - 24,
        multiline: true, maxWidth: BANNER_W - 24,
        shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
      });
      node.add(msg);
    }
    // keep the box layout AND the center-top pinning: run the VBox pass, then place
    node.onLayout = function () {
      VBox.prototype.onLayout.call(this);
      this.setPos(Math.round((eng.width - BANNER_W) / 2), 24);
    };
    eng.layers.overlay.add(node);
    const banner = { rec, node, titleNode, t: 0, off: null };
    this._banner = banner;
    banner.off = eng.ticker.add((dt) => {
      banner.t += dt;
      if (banner.t >= rec.duration) this._dismissBanner(banner);
    });
    node.on('click', () => this._dismissBanner(banner));
    animateIn(node, 'fall');
    uisound(node, 'notify', { channel: 'banner' });
  },

  _dismissBanner(banner) {
    if (this._banner !== banner || banner.closing) return;
    // the windows.js _closing idiom: the lane stays OCCUPIED through the ~0.2s fade
    // (freeing it synchronously let any drain — a fresh send, ANY toast finishing —
    // present a second banner on the identical pinned spot, two banners overlapping)
    banner.closing = true;
    banner.off?.();
    animateOut(banner.node, 'fall').then(() => {
      if (this._banner === banner) this._banner = null;
      banner.node.dispose();
      this._drain(); // the banner lane is truly free now
    });
  },

  // Teardown hook: pending routing and the live banner die with the engine.
  _reset() {
    if (this._banner) { this._banner.off?.(); this._banner = null; }
    this._pending = [];
    this._keyed.clear();
    this.doNotDisturb = false;
    this.engine = null;
  },
};

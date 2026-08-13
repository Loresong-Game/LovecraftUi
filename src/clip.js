// ClipRegion: 4 shared world-space clipping planes with fixed normals; only constants change.
//
// ScrollArea: clipped viewport with overlay scrollbars (vertical + horizontal).
//
// THE INVARIANT that keeps scrollbars sane: the content box is a pure function of the
// ScrollArea's own rect — `cw = w` (`- SB_W` only under the opted `inset` while
// vertically overflowing), `ch = h` — never a function
// of content size or bar visibility. Bars OVERLAY the content edge; they never consume layout
// space. This makes each layout pass a one-way flow (box -> children -> measurement -> bars),
// so bar visibility cannot oscillate. Rails rest SHOWN whenever their axis overflows
// (overflow is information — a hidden rail hides that content exists; the
// engagement-only reveal is retired). Bars still OVERLAY (never consume layout space),
// and horizontal scrolling is the `scrollX` opt.

import * as THREE from 'three';
import { UINode } from './node.js';
import { QuadNode, NineSliceNode } from './primitives.js';
import { METRICS } from './theme.js';
import { clamp, contentExtent } from './layout.js';

export class ClipRegion {
  constructor() {
    // keep-inside semantics: dot(normal, p) + constant >= 0
    this.planes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),   // x >= x0  (constant -x0)
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),  // x <= x1  (constant  x1)
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),   // threeY >= -y1 (constant  y1)
      new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),  // threeY <= -y0 (constant -y0)
    ];
    this.rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  setRect(x0, y0, x1, y1) {
    this.rect.x0 = x0; this.rect.y0 = y0; this.rect.x1 = x1; this.rect.y1 = y1;
    this.planes[0].constant = -x0;
    this.planes[1].constant = x1;
    this.planes[2].constant = y1;
    this.planes[3].constant = -y0;
  }
}

const SB_W = METRICS.scrollbarW;

export class ScrollArea extends UINode {
  constructor(opts = {}) {
    super({ ...opts, interactive: true });
    this.autoContent = opts.autoContent ?? true;
    this.contentH = opts.contentH ?? 0;
    this.contentW = opts.contentW ?? 0;
    this.contentPadBottom = opts.contentPadBottom ?? 8; // applied ONLY when content overflows
    // horizontal scrolling is an OPT (the Taskbar lane) — only opted surfaces show
    // an H rail, and un-opted horizontal overflow is an audit defect, never a scrollbar.
    this.scrollX = opts.scrollX === true;
    // an opted scroll surface insets its content lane by the rail width WHILE
    // vertically overflowing, so the thumb never covers text (no consumer arithmetic;
    // acyclic: the inset depends on contentH, which never depends on boxW).
    this.inset = opts.inset === true;
    this._railHover = false;
    this._pendingBottom = false;

    this.content = new UINode({ interactive: false });
    this.content.clipChildren = true;
    this.content.clipRegion = new ClipRegion();
    this.add(this.content);

    // skin: {track, thumb, thumbHover, thumbPressed} + optional horizontal variants
    //       {trackH, thumbH, thumbHHover, thumbHPressed} (fall back to the vertical set)
    this.skin = opts.skin ?? null;
    const mkTrack = (tex) => this.skin
      ? new QuadNode({ texture: tex })
      : new QuadNode({ color: 0x10140f, opacity: 0.65 });
    const mkThumb = (frames) => {
      if (!this.skin) {
        const q = new QuadNode({ color: 0x39443a, interactive: true, opacity: 0.9 });
        q._frames = null;
        return q;
      }
      const n = new NineSliceNode(frames.normal, { interactive: true });
      n._frames = frames;
      return n;
    };
    this.track = mkTrack(this.skin?.track);
    this.thumb = mkThumb(this.skin && { normal: this.skin.thumb, hover: this.skin.thumbHover, pressed: this.skin.thumbPressed });
    this.hTrack = mkTrack(this.skin?.trackH ?? this.skin?.track);
    this.hThumb = mkThumb(this.skin && {
      normal: this.skin.thumbH ?? this.skin.thumb,
      hover: this.skin.thumbHHover ?? this.skin.thumbHover,
      pressed: this.skin.thumbHPressed ?? this.skin.thumbPressed,
    });
    for (const n of [this.track, this.thumb, this.hTrack, this.hThumb]) {
      n.interactive = true;
      // bars start HIDDEN: the first overflowing layout fades them in on a TRUE rect
      // (constructed-visible bars flashed at a stale rect before first layout);
      // from then on a rail rests shown for as long as its axis overflows
      n.visible = false;
      n.fxOpacity = 0;
      // A scroll gesture is not a click: the input layer synthesizes a
      // click on the chrome whenever a press releases over it — a thumb tap, a
      // thumb DRAG ending over the moved thumb (mouse clicks have no drag
      // threshold), a track page-jump — and it bubbled into content-level click
      // handlers above (the VirtualList row seat, TreeTable's rowactivate: a
      // scrollbar grab activated a ledger row). Pointerdown already stops at
      // the chrome; the synthesized click follows the same rule.
      n.on('click', (e) => e.stopPropagation());
    }
    this.thumb.touchDragOwner = true;   // touching a thumb drags it, never pans
    this.hThumb.touchDragOwner = true;
    this.add(this.track, this.thumb, this.hTrack, this.hThumb);
    // the area itself is deliberately silent on hover and press — it is a content
    // viewport, not a control; the thumbs carry the hover/press art
    this.auditAllow('hover', 'press');
    // engagement tracking (sealed like every hover channel — the law: the
 // input layer delivers hover into disabled subtrees for tooltips); visibility no
    // longer reads it, but a hover pass keeps rail geometry fresh mid-interaction
    this.on('pointerenter', () => {
      if (this.closest((n) => n.disabled === true)) return;
      this._railHover = true;
      this.invalidateLayout();
    });
    this.on('pointerleave', () => { this._railHover = false; this.invalidateLayout(); });
    // a thumb released outside the area still re-lays out (state art restores)
    this.thumb.on('pointerup', () => this.invalidateLayout());
    this.hThumb.on('pointerup', () => this.invalidateLayout());

    this._thumbDrag = null;
    this._hThumbDrag = null;
    // From here on, add() forwards to the scrolling content (convention 10) — the chrome
    // above (content node, tracks, thumbs) was added directly while this flag was unset.
    this._chromeReady = true;

    // Wheel: consume only when the REQUESTED motion actually moves this area — an
    // exhausted axis RELEASES the event so an outer scrollable (then the host page)
    // can take it (B9; the input.js only-claim-when-consumed law — the old gate
    // asked "can this axis scroll at all" and trapped the page at the extremes).
    // Native trackpad deltaX drives the X lane directly; shift+deltaY stays the
    // mouse-wheel horizontal path ('s Y-only ruling covers plain wheels).
    this.on('wheel', (e) => {
      const beforeY = this.content.scrollY, beforeX = this.content.scrollX;
      const dx = e.native?.shiftKey ? e.deltaY : (e.deltaX ?? 0);
      const dy = e.native?.shiftKey ? 0 : e.deltaY;
      if (dy && this.maxScroll > 0) this.scrollBy(dy);
      if (dx && this.maxScrollX > 0) this.setScrollX(this.content.scrollX + dx);
      if (this.content.scrollY !== beforeY || this.content.scrollX !== beforeX) e.stopPropagation();
    });

    // vertical thumb / track
    this.thumb.on('pointerdown', (e) => {
      if (this._thumbDrag) return; // one gesture, one pointer — a second finger is deaf (C3 law)
      this._thumbDrag = { id: e.pointerId ?? -1, startY: e.y, startScroll: this.content.scrollY };
      this._setThumbState(this.thumb, 'pressed');
      e.stopPropagation();
    });
    this.thumb.on('pointermove', (e) => {
      if (!this._thumbDrag || (e.pointerId ?? -1) !== this._thumbDrag.id || this.maxScroll <= 0) return;
      const span = this._trackH - this.thumbH;
      if (span <= 0) return;
      // screen delta ÷ worldScale = LOCAL px (the wartable idiom)
      this.setScroll(this._thumbDrag.startScroll + (e.y - this._thumbDrag.startY) / (this.worldScale || 1) * (this.maxScroll / span));
    });
    this.thumb.on('pointerup', (e) => {
      if (this._thumbDrag && (e.pointerId ?? -1) !== this._thumbDrag.id) return; // only the owner releases
      this._thumbDrag = null; this._setThumbState(this.thumb, 'normal');
    });
    // hover art seals under a disabled ancestor (hover still ARRIVES there)
    this.thumb.on('pointerenter', () => {
      if (this.closest((n) => n.disabled === true)) return;
      if (!this._thumbDrag) this._setThumbState(this.thumb, 'hover');
    });
    this.thumb.on('pointerleave', () => { if (!this._thumbDrag) this._setThumbState(this.thumb, 'normal'); });
    this.track.on('pointerdown', (e) => {
      if (this.maxScroll <= 0) return;
      const localY = (e.y - this.track.worldY) / (this.worldScale || 1); // screen → LOCAL
      const ratio = clamp((localY - this.thumbH / 2) / Math.max(1, this._trackH - this.thumbH), 0, 1);
      this.setScroll(ratio * this.maxScroll);
      e.stopPropagation();
    });

    // horizontal thumb / track
    this.hThumb.on('pointerdown', (e) => {
      if (this._hThumbDrag) return; // one gesture, one pointer (C3 law)
      this._hThumbDrag = { id: e.pointerId ?? -1, startX: e.x, startScroll: this.content.scrollX };
      this._setThumbState(this.hThumb, 'pressed');
      e.stopPropagation();
    });
    this.hThumb.on('pointermove', (e) => {
      if (!this._hThumbDrag || (e.pointerId ?? -1) !== this._hThumbDrag.id || this.maxScrollX <= 0) return;
      const span = this._trackW - this.thumbW;
      if (span <= 0) return;
      this.setScrollX(this._hThumbDrag.startScroll + (e.x - this._hThumbDrag.startX) / (this.worldScale || 1) * (this.maxScrollX / span));
    });
    this.hThumb.on('pointerup', (e) => {
      if (this._hThumbDrag && (e.pointerId ?? -1) !== this._hThumbDrag.id) return; // only the owner releases
      this._hThumbDrag = null; this._setThumbState(this.hThumb, 'normal');
    });
    this.hThumb.on('pointerenter', () => {
      if (this.closest((n) => n.disabled === true)) return;
      if (!this._hThumbDrag) this._setThumbState(this.hThumb, 'hover');
    });
    this.hThumb.on('pointerleave', () => { if (!this._hThumbDrag) this._setThumbState(this.hThumb, 'normal'); });
    this.hTrack.on('pointerdown', (e) => {
      if (this.maxScrollX <= 0) return;
      const localX = (e.x - this.hTrack.worldX) / (this.worldScale || 1); // screen → LOCAL
      const ratio = clamp((localX - this.thumbW / 2) / Math.max(1, this._trackW - this.thumbW), 0, 1);
      this.setScrollX(ratio * this.maxScrollX);
      e.stopPropagation();
    });
  }

  _setThumbState(thumb, s) {
    if (!thumb._frames) {
      thumb.setColor(s === 'normal' ? 0x39443a : s === 'hover' ? 0x4a5a4c : 0x2e3a30);
      return;
    }
    const f = thumb._frames[s] ?? thumb._frames.normal;
    if (f && thumb.setFrame) thumb.setFrame(f);
  }

  // The content box: independent of BAR VISIBILITY (rails are pure overlays —
 // retired the permanent reserved lane). The one sanctioned content-coupling is the
  // opted `inset`: the lane narrows by SB_W while vertically overflowing (acyclic —
  // the trigger reads contentH against the height, never against boxW).
  get boxW() { return Math.max(1, this.w - (this.inset && this.contentH > this.h + 1 ? SB_W : 0)); }
  get boxH() { return Math.max(1, this.h); }

  get vBarVisible() { return this.contentH > this.boxH + 1; }
  get hBarVisible() { return this.contentW > this.boxW + 1; }
  get maxScroll() { return Math.max(0, this.contentH - this.boxH); }
  get maxScrollX() { return Math.max(0, this.contentW - this.boxW); }
  get _trackH() { return this.h - (this.hBarVisible ? SB_W : 0); }
  get _trackW() { return this.w - (this.vBarVisible ? SB_W : 0); }
  get thumbH() { return Math.max(30, Math.round(this._trackH * this.boxH / Math.max(1, this.contentH))); }
  get thumbW() { return Math.max(30, Math.round(this._trackW * this.boxW / Math.max(1, this.contentW))); }

  scrollBy(dy) { this.setScroll(this.content.scrollY + dy); }

  setScroll(v) {
    const nv = clamp(Math.round(v), 0, this.maxScroll);
    if (nv === this.content.scrollY) return;
    this.content.scrollY = nv;
    this.invalidateLayout();
    // fires for every user/programmatic scroll; layout's own clamp writes silently
    this.dispatch('scroll', { x: this.content.scrollX, y: nv });
  }

  setScrollX(v) {
    const nv = clamp(Math.round(v), 0, this.maxScrollX);
    if (nv === this.content.scrollX) return;
    this.content.scrollX = nv;
    this.invalidateLayout();
    this.dispatch('scroll', { x: nv, y: this.content.scrollY });
  }

  // Pin to the bottom using the measurement of the NEXT layout pass (safe right after appends).
  scrollToBottom() {
    this._pendingBottom = true;
    this.invalidateLayout();
  }

  // Convention 10: adding to a ScrollArea means adding scrolling content. The constructor's
  // own chrome (content node, tracks, thumbs) lands directly via the pre-ready super path.
  add(...nodes) {
    if (!this._chromeReady) return super.add(...nodes);
    return this.content.add(...nodes);
  }

  // Fixed logical content size; disables auto-measure (virtual content).
  setContentSize(w, h) {
    this.autoContent = false;
    this.contentW = w;
    this.contentH = h;
    this.invalidateLayout();
  }

  onLayout() {
    // 1. the invariant box
    this.content.setRect(0, 0, this.boxW, this.boxH);

    // 2. measure child extents (constructor-sized children settle this pass;
    //    self-sizing children converge next pass — bars are cosmetic, the box never
    // reacts). The shared law: `fitExclude` chrome no longer mints scroll
    //    range here — the window's auto-size always skipped it, and the two measuring
    //    differently was the dead-band dialog class.
    if (this.autoContent) {
      const ext = contentExtent(this.content.children);
      this.contentW = ext.w;
      this.contentH = ext.h > this.boxH ? ext.h + this.contentPadBottom : ext.h; // pad only when overflowing
    }

    // 3. sticky bottom, then clamp (direct assignment — no re-invalidate)
    if (this._pendingBottom) {
      this.content.scrollY = this.maxScroll;
      this._pendingBottom = false;
    }
    this.content.scrollY = clamp(this.content.scrollY, 0, this.maxScroll);
    this.content.scrollX = clamp(this.content.scrollX, 0, this.maxScrollX);

    // 4. rail geometry (kept fresh whenever the axis overflows, so a fade-in lands
    //    on a true rect) + 5. visibility: a rail rests SHOWN for as long as its axis
    //    overflows — overflow is information, and hiding it hides the content
    if (this.vBarVisible) {
      this.track.setRect(this.w - SB_W, 0, SB_W, this._trackH);
      const span = this._trackH - this.thumbH;
      const ty = this.maxScroll > 0 ? Math.round(span * (this.content.scrollY / this.maxScroll)) : 0;
      this.thumb.setRect(this.w - SB_W + 2, ty, SB_W - 4, this.thumbH);
    }
    if (this.scrollX && this.hBarVisible) {
      this.hTrack.setRect(0, this.h - SB_W, this._trackW, SB_W);
      const span = this._trackW - this.thumbW;
      const tx = this.maxScrollX > 0 ? Math.round(span * (this.content.scrollX / this.maxScrollX)) : 0;
      this.hThumb.setRect(tx, this.h - SB_W + 2, this.thumbW, SB_W - 4);
    }
    const wantV = this.vBarVisible;
    const wantH = this.scrollX && this.hBarVisible;
    this._setRail(this.track, wantV);
    this._setRail(this.thumb, wantV);
    this._setRail(this.hTrack, wantH);
    this._setRail(this.hThumb, wantH);
  }

  // Show/hide with the wash fade idiom: `visible` gates hits and paint, fxOpacity
  // carries the finite tween; hiding lands visible=false in the fade's onDone.
  // The FIRST reveal is INSTANT: a rail that overflows at boot is furniture, and a
  // boot-time fade races wall-clock snapshot timing (frozen shots caught it mid-fade
  // at varying alpha). Fades serve the RUNTIME transitions only.
  _setRail(node, want) {
    if ((node._railShown === true) === want) return;
    const first = node._railShown === undefined;
    node._railShown = want;
    const eng = this.engine;
    if (want) {
      node.visible = true;
      if (first || !eng) node.fxOpacity = 1;
      else eng.ticker.tween(node, { fxOpacity: 1 }, { dur: 0.15 });
    } else if (eng) {
      eng.ticker.tween(node, { fxOpacity: 0 }, { dur: 0.2, onDone: () => { node.visible = false; } });
    } else {
      node.fxOpacity = 0;
      node.visible = false;
    }
  }
}

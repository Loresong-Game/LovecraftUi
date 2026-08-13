// Window system: static Window, draggable/resizable ModalWindow, EldWindow manager (mirrors
// create/minimize/restore/toggleMaximize/close/bringToFront + taskbar), and EldPopup.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { ScrollArea } from '../clip.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { clamp, contentRect, contentExtent } from '../layout.js';
import { nextFocusOrder } from '../layers.js';
import { Button, TextField, widgetsEngine, requireEngine, uisound } from './widgets.js';
import { EldEvents } from './events.js';
import { EldDragDrop } from './dragdrop.js';
import { EldContextMenu } from './menu.js';
import { str } from '../strings.js';
import { animateIn, animateOut, isReducedMotion } from '../animate.js';
import { VBox, HBox } from '../layoutbox.js';

const HEADER_H = METRICS.windowHeaderH; // 32

function reg() { return requireEngine().textures; } // friendly pre-init throw, never null.textures

// Non-finite dimensions (a NaN from consumer math) warn and fall back to defaults:
// NaN geometry renders nothing but still intercepts hits across a screen strip.
// B5: hoisted module-level — the warn-and-default contract now covers BOTH
// window classes (ModalWindow always had it; static Window's setSize was a bare ??).
function numOr(v, dflt) {
  if (v == null) return dflt;
  if (Number.isFinite(v)) return v;
  console.warn(`LovecraftUI: window created with a non-finite dimension (${v}); using ${dflt}.`);
  return dflt;
}

export function scrollSkin() {
  const t = reg();
  return {
    track: t.get('scrollbar.track'),
    thumb: t.frame('scrollbar.thumb.normal'),
    thumbHover: t.frame('scrollbar.thumb.hover'),
    thumbPressed: t.frame('scrollbar.thumb.pressed'),
    trackH: t.get('scrollbar.trackH'),
    thumbH: t.frame('scrollbar.thumbH.normal'),
    thumbHHover: t.frame('scrollbar.thumbH.hover'),
    thumbHPressed: t.frame('scrollbar.thumbH.pressed'),
  };
}

// Shared chrome: stone frame + header plaque + title.
// The header is plain chrome here; ModalWindow opts it into dragging (interactive + move cursor).
class WindowBase extends UINode {
  constructor(opts = {}) {
    super({ interactive: true });
    this._isEldWindow = true;
    // `header: false` is the first-class chrome-less panel window — proper stone
    // frame, no header band, no controls; content starts at the frame inset.
    this.headerless = opts.header === false;
    this.frame = new NineSliceNode(reg().frame('window.frame'));
    this.header = new NineSliceNode(reg().frame('window.header'));
    this.header.name = 'window-header';
    // the header plaque DELIBERATELY sits on the frame's top border band — the audit's
    // first sanctioned containment allowances (rationed like GEOMETRY's exemptions)
    this.header.auditAllow('containment');
    this.title = new TextNode(opts.title ?? 'Window', {
      font: FONTS.header, size: 15, color: COLORS.accent, smallCaps: true, letterSpacing: 1,
      shadow: { color: 'rgba(0,0,0,0.9)', dx: 1, dy: 1, blur: 2 },
      maxWidth: 100, ellipsis: true,
    });
    this.title.interactive = false;
    this.title.auditAllow('containment'); // rides the header band
    if (this.headerless) { this.header.visible = false; this.title.visible = false; }
    // the reserved scrollbar lane is RETIRED — rails are true overlays that render
    // only while an axis overflows (Migration note: window content boxes are 14px wider).
    // scrollX is the FLOOR-STATE FALLBACK — at boot nothing overflows (the
    // audit's scrollbar-truth holds: no overflow, no rail), but a user who shrinks
    // the window below its content's reflow minimum gets a real, reachable H-rail
    // instead of clipped-off content (the resize walker's spill class; 's ban is
 // on UN-OPTED overflow and on reserved lanes, not on an honest fallback rail)
    this.contentArea = new ScrollArea({ skin: scrollSkin(), scrollX: true });
    this.add(this.frame, this.contentArea, this.header, this.title);
    // the footer lane — the window template's third band. An HBox pinned inside
    // the frame's bottom inset (right-justified by the dialog-button convention);
    // the content box shrinks above it, so footer buttons never ride the scrollback.
    this.footerBar = null;
    if (opts.footer != null) {
      this.footerBar = new HBox({
        gap: METRICS.space8, justify: opts.footerJustify ?? 'end', align: 'center',
        autoWidth: false, autoHeight: true,
      });
      this.footerBar.name = 'window-footer';
      if (typeof opts.footer === 'function') opts.footer(this.footerBar, this);
      else if (Array.isArray(opts.footer)) this.footerBar.add(...opts.footer);
      else if (opts.footer instanceof UINode) this.footerBar.add(opts.footer);
      else console.warn(`LovecraftUI: window footer must be a builder function (bar, win) => {}, a UINode, or an array of UINodes (got ${typeof opts.footer}); ignored.`);
      this.add(this.footerBar);
    }
  }

  setTitleWidth(maxW) {
    this.title.style.maxWidth = maxW;
    const t = this.title._text ?? '';
    this.title._text = null;
    this.title.setText(t);
  }

  buildContent(content) {
    if (content == null || content === '') return;
    if (typeof content === 'function') content(this.contentArea.content, this);
    else if (typeof content === 'string') {
      const t = new TextNode(content, { size: 13, color: COLORS.text, multiline: true, maxWidth: Math.max(120, this.w - 60) });
      t.setPos(6, 6);
      // the prose tracks the LIVE content box: resize the window and the
      // string re-wraps — setMaxWidth no-ops when unchanged, so this is free at rest
      const own = t.onLayout?.bind(t);
      const win = this;
      t.onLayout = function () {
        this.setMaxWidth(Math.max(120, win.contentArea.boxW - 12));
        own?.();
      };
      this.contentArea.content.add(t);
    } else if (Array.isArray(content)) this.contentArea.content.add(...content);
    else if (content instanceof UINode) this.contentArea.content.add(content);
    else {
      // friendly error: the common misuse is passing an options object or DOM element here
      console.warn('LovecraftUI: Window content must be a builder function (content, win) => {}, '
        + `a string, a UINode, or an array of UINodes (got ${typeof content}); ignored.`);
    }
  }

  // Convention 10: every window type exposes its content node and can be refilled.
  get content() { return this.contentArea.content; }

  setContent(content) {
    for (const c of [...this.contentArea.content.children]) c.dispose();
    this.contentArea.setScroll(0);
    this.buildContent(content);
    if (this.autoSize) this.autoSizeToContent(); // measured windows re-fit new content
    this.invalidateLayout();
  }

  // the extent of what the content actually holds — the shared law (// one loop for window auto-size, ScrollArea auto-content, and fitChildren, so
 // the window and its own scroll range can never disagree about a child again).
  _contentExtent() {
    return contentExtent(this.contentArea.content.children);
  }

  // size the WINDOW to fit its content — the requirement-6 dialog law. One-shot
  // (construction / setContent / popup present): a user-resizable window is never
  // fought mid-drag. 8px breathing beyond the extent; clamped to the viewport with
  // a 20px margin when an engine is known. Boot-below-floor stays legal (the
  // library floor is a resize-time rule).
  autoSizeToContent() {
    const ext = this._contentExtent();
    const fr = this.frame.frame;
    const top = this.headerless ? fr.t : HEADER_H + 4;
    let w = fr.l + ext.w + 8 + fr.r;
    let h = top + ext.h + 8 + fr.b;
    if (this.footerBar) { this.footerBar.onLayout(); h += this.footerBar.h + 6; } // the footer lane is real height
    const eng = this.engine ?? widgetsEngine();
    if (eng) { w = Math.min(w, eng.width - 20); h = Math.min(h, eng.height - 20); }
    this.setSize(Math.round(w), Math.round(h));
    return this;
  }

  layoutChrome() {
    this.frame.setRect(0, 0, this.w, this.h);
    const c = contentRect(this.frame.frame, this.w, this.h);
    // the footer lane claims the bottom of the content rect first; the box
    // pre-measure idiom makes its auto height true THIS pass
    let bottom = c.y + c.h;
    if (this.footerBar) {
      this.footerBar.onLayout();
      const fh = this.footerBar.h;
      this.footerBar.setRect(c.x, bottom - fh, c.w, fh);
      bottom -= fh + 6;
    }
    if (this.headerless) {
      // no header band: the content box IS the frame's content rect (minus the footer)
      this.contentArea.setRect(c.x, c.y, c.w, Math.max(0, bottom - c.y));
      return;
    }
    this.header.setRect(2, 2, this.w - 4, HEADER_H - 4);
    this.setTitleWidthIfNeeded();
    this.title.setPos(Math.round((this.w - this.title.w) / 2), 2 + Math.round((HEADER_H - 4 - this.title.h) / 2));
    // content box = the area the stone border leaves free (the frame's own 9-slice record),
    // top pinned below the header plaque; overlay scrollbars land flush against the border
    // band's inner edge, never on it
    const top = HEADER_H + 4;
    this.contentArea.setRect(c.x, top, c.w, Math.max(0, bottom - top));
  }

  setTitleWidthIfNeeded() {
    // keep the centered title clear of the right-justified control block; each window
    // shape reserves for the strip it actually has (see _titleClearance overrides)
    const maxW = Math.max(60, Math.min(Math.round(this.w * 0.6), this.w - 2 * this._titleClearance()));
    if (this.title.style.maxWidth !== maxW) this.setTitleWidth(maxW);
  }

  _titleClearance() { return 12; } // no controls (popups): frame breathing room only
}

// Static panel window: close button emits 'close' (unwired by default).
export class Window extends WindowBase {
  constructor(opts = {}) {
    super(opts);
    const B = METRICS.windowBtn;
    this.closeBtn = null;
    if (!this.headerless) {
      this.closeBtn = new UINode({ interactive: true });
      this.closeBtn.auditAllow('containment'); // rides the header band, like the plaque
      this.closeQuad = new QuadNode({ texture: reg().get('window.btn.close') });
      // hover had a texture swap but a held press showed NOTHING — the wash
      // supplies the pressed state (law: pressed is mandatory, washPress floor)
      this.closeWash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      this.closeBtn.add(this.closeQuad, this.closeWash);
      this.add(this.closeBtn);
      this.closeBtn.on('pointerenter', () => this.closeQuad.setTexture(reg().get('window.btn.close.hover')));
      this.closeBtn.on('pointerleave', () => { this.closeQuad.setTexture(reg().get('window.btn.close')); this.closeWash.setBaseOpacity(0); });
      this.closeBtn.on('pointerdown', () => this.closeWash.setBaseOpacity(METRICS.washPress));
      this.closeBtn.on('pointerup', () => this.closeWash.setBaseOpacity(0));
      this.closeBtn.on('click', (e) => { e.stopPropagation(); this.emit('close', {}); if (opts.onClose) opts.onClose(); });
    }
    this._btnSize = B;
    // a GIVEN size stays law — including a garbage (NaN) one, which keeps the
    // warn-and-default contract; only truly OMITTED sizes MEASURE the content
    // (`autoSize: false` restores the legacy 350×260 default — Migration note)
    this.autoSize = opts.autoSize ?? (opts.width == null && opts.height == null);
    // B5: the comment above PROMISED the warn-and-default contract but the bare ??
    // let NaN through raw — numOr makes it real (NaN stays a GIVEN size, then defaults)
    this.setSize(numOr(opts.width, 350), numOr(opts.height, 260));
    this.buildContent(opts.content);
    if (this.autoSize) this.autoSizeToContent();
  }

  onLayout() {
    this.layoutChrome();
    if (!this.closeBtn) return;
    const B = this._btnSize;
    this.closeBtn.setRect(this.w - 2 - B, 2, B, B);
    this.closeQuad.setRect(0, 0, B, B);
    this.closeWash.setRect(0, 0, B, B);
  }

  _titleClearance() { return this.headerless ? 12 : this._btnSize + 2 + 8; } // close button + breathing
}

// ---------------- Taskbar ----------------

export class Taskbar extends UINode {
  constructor() {
    super({ interactive: true });
    this.bg = new QuadNode({ texture: reg().get('taskbar.bg') });
    // The item lane rides a ScrollArea: past ~13 minimized windows even the
    // 60px item floor overflows the bar — the lane pans (wheel over the bar, or the
    // slim thumb that appears) instead of shedding items off the edge. With no
    // overflow the bars stay hidden and the layout is pixel-identical to the flat bar.
    this.strip = new ScrollArea({ skin: scrollSkin(), scrollX: true }); // the one opted H lane
    this.add(this.bg, this.strip);
    this.items = [];
    // Wheel over the bar pans the lane: plain deltaY maps to X because the bar is
    // horizontal-only (the vertical wheel is otherwise dead here; ScrollArea's own
    // shift+wheel keeps working). B9: native deltaX pans it too, and the lane only
    // CONSUMES when it actually moved (an exhausted lane releases to the page).
    this.on('wheel', (e) => {
      const before = this.strip.content.scrollX;
      this.strip.setScrollX(before + ((e.deltaX ?? 0) || e.deltaY));
      if (this.strip.content.scrollX !== before) e.stopPropagation();
    });
  }

  addItem(title, windowId, onClick) {
    const item = new UINode({ interactive: true });
    item.windowId = windowId;
    const bg = new NineSliceNode(reg().frame('taskbar.item'));
    const label = new TextNode(title, {
      font: FONTS.header, size: 13, color: COLORS.accent, smallCaps: true,
      maxWidth: 118, ellipsis: true,
    });
    // pressed state (law) — hover keeps its frame swap, the wash answers the hold
    const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    item.add(bg, label, wash);
    const w = Math.min(150, label.w + 32);
    item.naturalW = w;
    item.setItemWidth = (iw) => {
      item.setSize(iw, 34);
      bg.setRect(0, 0, iw, 34);
      wash.setRect(0, 0, iw, 34);
      label.style.maxWidth = iw - 32;
      const t = label._text; label._text = null; label.setText(t ?? title); // re-ellipsize
      label.setPos(16, Math.round((34 - label.h) / 2));
    };
    item.setItemWidth(w);
    item.on('pointerenter', () => bg.setFrame(reg().frame('taskbar.item.hover')));
    item.on('pointerleave', () => { bg.setFrame(reg().frame('taskbar.item')); wash.setBaseOpacity(0); });
    item.on('pointerdown', () => wash.setBaseOpacity(METRICS.washPress));
    item.on('pointerup', () => wash.setBaseOpacity(0));
    item.on('click', onClick);
    item._wash = wash;
    this.items.push(item);
    this.strip.add(item); // lands in strip.content (the ScrollArea.add convention)
    this.invalidateLayout();
    return item;
  }

  removeItem(windowId) {
    const i = this.items.findIndex(it => it.windowId === windowId);
    if (i === -1) return;
    this.items[i].dispose();
    this.items.splice(i, 1);
    this.invalidateLayout();
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.strip.setRect(10, 0, this.w - 20, this.h);
    // Shrink-to-fit: when natural widths overflow the lane, share the row evenly
    // (clamped 60..150) so every minimized window stays reachable; when even the 60px
    // floor overflows (≥ ~13 windows) the lane scrolls horizontally instead — items
    // keep the floor width and the ScrollArea's h-bar/wheel take over.
    const n = this.items.length;
    const gaps = 5 * Math.max(0, n - 1);
    const natural = this.items.reduce((a, it) => a + it.naturalW, 0) + gaps;
    const avail = this.w - 20;
    const shared = n > 0 ? clamp(Math.floor((avail - gaps) / n), 60, 150) : 0;
    let x = 0; // strip-content coordinates (the lane itself is inset 10)
    for (const it of this.items) {
      const w = natural > avail ? Math.min(it.naturalW, shared) : it.naturalW;
      if (w !== it.w) it.setItemWidth(w);
      it.setPos(x, Math.round((this.h - it.h) / 2));
      x += it.w + 5;
    }
  }
}

// ---------------- ModalWindow (draggable/resizable) ----------------

const RESIZE_CURSORS = { n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize', ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize' };

export class ModalWindow extends WindowBase {
  constructor(opts = {}) {
    super(opts);
    // a consumer-stable id keys layout persistence across page loads; the
    // random fallback stays unique within a session for the taskbar's needs
    this.id = opts.id != null ? String(opts.id) : 'win_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    this.optTitle = opts.title ?? str('windowDefaultTitle');
    this._onClose = opts.onClose ?? null;
    this.resizable = opts.resizable !== false;
    this._transitions = opts.transitions === true; // Opt-in animation presets
    // per-window resize floor: content with hard minimums (a settings panel, a fixed grid)
    // raises it above the library floor so shrinking can never force doubled scrollbars
    // B5: finite-first — Math.max(240, NaN) is NaN, and a NaN floor reaches the
    // resize clamp on the first drag (the window collapses to a NaN rect)
    this.minW = Math.max(METRICS.windowMinW, Number.isFinite(opts.minWidth) ? opts.minWidth : 0);
    this.minH = Math.max(METRICS.windowMinH, Number.isFinite(opts.minHeight) ? opts.minHeight : 0);
    this.minimized = false;
    this.maximized = false;
    // userPlaced (claim tightened): true once a REAL pointer
    // CHANGED the box — a header drag that moved it, a resize that resized it.
    // A press alone raises and claims nothing (a raise-click used to opt the
    // window out of page auto-layout forever), and programmatic setPos/setRect
    // never claims. Initialized here on the COMMON path: headerless windows
    // carried undefined against the d.ts boolean.
    this.userPlaced = false;
    this.prevState = { x: 0, y: 0, width: 0, height: 0 };
    // a window never BOOTS below its own declared floor (the library floor stays a
    // resize-time rule — small fixed dialogs under it are legal and ship). Non-finite
    // dimensions warn-and-default via the shared numOr (B5: hoisted module-level).
    this.setRect(numOr(opts.x, 50), numOr(opts.y, 50),
      Math.max(numOr(opts.width, 300), numOr(opts.minWidth, 0)),
      Math.max(numOr(opts.height, 200), numOr(opts.minHeight, 0)));

    // control buttons: full-header-height squares, one unified art style, flush right.
    // They live in an interactive strip that also swallows the pixel gaps BETWEEN buttons,
    // so nothing there can grab or drag the header. Headerless windows carry none.
    this.controls = null;
    if (!this.headerless) {
      this.controls = new UINode({ interactive: true, name: 'window-controls' });
      this.controls.on('pointerdown', (e) => { e.stopPropagation(); this.bringToFront(); });
      this.btnMin = this._controlBtn('min', () => this.minimize());
      this.btnMax = this._controlBtn('max', () => this.toggleMaximize());
      this.btnClose = this._controlBtn('close', () => this.close());
      this.controls.add(this.btnMin, this.btnMax, this.btnClose);
      // added below, AFTER the resize handles: the corner handles overhang the header
      // corner, and paint order is hit order — the buttons must win their own centers

      // drag by header (the base header is plain chrome; the modal one drags)
      this.header.interactive = true;
      this.header.cursor = 'move';
      this.header.touchDragOwner = true; // touch drags the window, never pans
      this._drag = null;
      this.header.on('pointerdown', (e) => {
        if (this.maximized) return;
        if (this._drag) return; // one gesture, one pointer — a second finger cannot rebase the drag
        this._drag = { id: e.pointerId ?? -1, sx: e.x, sy: e.y, left: this.x, top: this.y };
        this.fxOpacity = 0.9;
        e.stopPropagation();
        this.bringToFront();
      });
      this.header.on('pointermove', (e) => {
        if (!this._drag || (e.pointerId ?? -1) !== this._drag.id) return;
        const cont = this.manager?.container ?? this.parent;
        let nl = this._drag.left + (e.x - this._drag.sx);
        let nt = this._drag.top + (e.y - this._drag.sy);
        nl = clamp(nl, 0, Math.max(0, cont.w - this.w));
        nt = clamp(nt, 0, Math.max(0, cont.h - this.h)); // fully inside: no escaping below the container
        const nx = Math.round(nl), ny = Math.round(nt);
        // the box actually MOVED: a press alone raises, it does not claim
        if (nx !== this.x || ny !== this.y) this.userPlaced = true;
        this.setPos(nx, ny);
      });
      this.header.on('pointerup', (e) => {
        if (this._drag && (e.pointerId ?? -1) !== this._drag.id) return; // only the owner releases
        this._drag = null; this.fxOpacity = 1;
      });
    }

    // resize handles
    if (this.resizable) {
      this.handles = {};
      for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
        const hnode = new UINode({ interactive: true, cursor: RESIZE_CURSORS[dir] });
        hnode.name = 'resize-' + dir;
        // an invisible edge handle's hover feedback IS the cursor swap (outside
        // paint) and its press is the resize arm (the drag-threshold class) — the
        // states walker must not demand subtree art of it. The SE corner is the
        // exception: it wears the drawn grip and proxies its states there (below).
        hnode.auditAllow('hover', 'press');
        hnode.on('pointerdown', (e) => {
          if (this.maximized) return;
          if (this._resize) return; // the resize slot is single-owner across all 8 handles
          this._resize = { id: e.pointerId ?? -1, dir, sx: e.x, sy: e.y, x: this.x, y: this.y, w: this.w, h: this.h };
          e.stopPropagation();
          this.bringToFront();
        });
        hnode.on('pointermove', (e) => this._doResize(e));
        hnode.on('pointerup', (e) => {
          if (this._resize && (e.pointerId ?? -1) !== this._resize.id) return; // only the owner releases
          this._resize = null;
        });
        this.handles[dir] = hnode;
        this.add(hnode);
      }
    }
    if (this.controls) this.add(this.controls);

    // the se corner wears DRAWN grip art — the resize affordance becomes
    // discoverable (the handles stay the invisible hit zones; the quad is paint only,
    // so hits fall through to the handle beneath). Hover/press ride the handle events.
    this.gripQuad = null;
    if (this.resizable) {
      this.gripQuad = new QuadNode({ texture: reg().get('grip.br'), opacity: 0.55 });
      this.gripQuad.auditAllow('containment'); // rides the frame corner band
      this.add(this.gripQuad);
      const se = this.handles.se;
      // the grip quad is a SIBLING, so the walker needs the declared proxy to
      // see these states — and with real art here, the blanket handle allowance
      // above is retracted for SE (its states are demanded again, via the proxy)
      se._auditAllow.delete('hover'); se._auditAllow.delete('press');
      se.stateProxy = this.gripQuad;
      se.on('pointerenter', () => { if (!this._resize) this.gripQuad.setBaseOpacity(0.85); });
      se.on('pointerleave', () => { if (!this._resize) this.gripQuad.setBaseOpacity(0.55); });
      se.on('pointerdown', () => this.gripQuad.setBaseOpacity(1));
      se.on('pointerup', (e) => this.gripQuad.setBaseOpacity(e.canceled ? 0.55 : 0.85)); // canceled ups end dark (B3)
    }

    this.on('pointerdown', () => this.bringToFront());
    // a GIVEN size stays law — including a garbage (NaN) one (the
 // warn-and-default contract); only truly OMITTED sizes MEASURE the content
    this.autoSize = opts.autoSize ?? (opts.width == null && opts.height == null);
    this.buildContent(opts.content);
    if (this.autoSize) this.autoSizeToContent();
  }

  _controlBtn(kind, onClick) {
    const B = METRICS.windowBtn;
    const btn = new UINode({ interactive: true });
    btn.name = 'winbtn-' + kind;
    btn.auditAllow('containment'); // the control strip rides the header band
    btn.setSize(B, B);
    const q = new QuadNode({ texture: reg().get(`window.btn.${kind}`) });
    q.setRect(0, 0, B, B);
    // pressed state (law) — hover keeps its texture swap, the wash answers the hold
    const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
    wash.setRect(0, 0, B, B);
    btn.add(q, wash);
    btn.on('pointerenter', () => q.setTexture(reg().get(`window.btn.${kind}.hover`)));
    btn.on('pointerleave', () => { q.setTexture(reg().get(`window.btn.${kind}`)); wash.setBaseOpacity(0); });
    btn.on('pointerdown', (e) => { e.stopPropagation(); this.bringToFront(); wash.setBaseOpacity(METRICS.washPress); });
    btn.on('pointerup', () => wash.setBaseOpacity(0));
    btn.on('click', (e) => { e.stopPropagation(); onClick(); });
    btn._wash = wash;
    return btn;
  }

  // three-button strip (3B wide + 2px gaps) at 2px from the right edge, + breathing room
  _titleClearance() { return this.headerless ? 12 : 3 * METRICS.windowBtn + 2 * 2 + 2 + 8; }

  _doResize(e) {
    // Edge-anchored: the grabbed edge follows the pointer, the opposite edge stays fixed,
    // and every result is clamped to [min size, container] — sizes can never invert or hit zero.
    const r = this._resize;
    if (!r || (e.pointerId ?? -1) !== r.id) return; // only the owning pointer drives
    const cont = this.manager?.container ?? this.parent;
    // a window BORN smaller than any floor (a given/measured size is law)
    // must be able to RETURN to its birth size, so the effective floor never
    // exceeds what the window first resized from — whatever source the floor has
    // (engine default, page opts, or the auto-size plaque minimum; the binding
    // Ledger's measured 160 vs its assigned 180 was the catch)
    if (this._bornW == null) { this._bornW = r.w; this._bornH = r.h; }
    const minW = Math.min(this.minW ?? METRICS.windowMinW, this._bornW);
    const minH = Math.min(this.minH ?? METRICS.windowMinH, this._bornH);
    const dx = e.x - r.sx, dy = e.y - r.sy;
    let { x, y, w, h } = r;
    const right = r.x + r.w, bottom = r.y + r.h;
    if (r.dir.includes('e')) {
      w = clamp(r.w + dx, minW, Math.max(minW, cont.w - r.x));
    }
    if (r.dir.includes('w')) {
      const nl = clamp(r.x + dx, 0, right - minW);
      x = nl;
      w = right - nl;
    }
    if (r.dir.includes('s')) {
      h = clamp(r.h + dy, minH, Math.max(minH, cont.h - r.y));
    }
    if (r.dir.includes('n')) {
      const nt = clamp(r.y + dy, 0, bottom - minH);
      y = nt;
      h = bottom - nt;
    }
    const nx = Math.round(x), ny = Math.round(y), nw = Math.round(w), nh = Math.round(h);
    // the box actually CHANGED: a handle press alone claims nothing
    if (nx !== this.x || ny !== this.y || nw !== this.w || nh !== this.h) this.userPlaced = true;
    this.setRect(nx, ny, nw, nh);
  }

  bringToFront() {
    this.focusOrder = nextFocusOrder();
    this.invalidatePaint();
    if (this.manager) this.manager._focused = this;
    this.emit('focuschange', {});
  }

  setTitle(t) {
    this.optTitle = t ?? '';
    this.title.setText(this.optTitle);
    this.invalidateLayout();
  }

  minimize() {
    if (this.minimized || this._minimizing) return;
    if (this._transitions) {
      // the sink toward the taskbar; state flips when the preset lands
      this._minimizing = true;
      animateOut(this, 'fall', { dur: 0.15 }).then(() => {
        this._minimizing = false;
        this._minimizeNow();
      });
      return;
    }
    this._minimizeNow();
  }

  _minimizeNow() {
    if (this.minimized) return;
    this.minimized = true;
    this.visible = false;
    // programmatic minimize must not leave a hidden subtree keyboard-live (the user
    // path is already safe: clicking the button blurred any field on pointerdown)
    const focused = this.engine?.focusedNode;
    if (focused && (focused === this || this.isAncestorOf(focused))) this.engine.setFocus(null);
    this.manager?.taskbar?.addItem(this.optTitle, this.id, () => this.restore());
    this.dispatch('minimize', {});
    EldEvents.log(str('windowMinimized', this.optTitle));
    uisound(this, 'close', { action: 'minimize' });
  }

  restore() {
    if (!this.minimized) return;
    this.minimized = false;
    this.visible = true;
    this.manager?.taskbar?.removeItem(this.id);
    this.bringToFront();
    this.dispatch('restore', {});
    EldEvents.log(str('windowRestored', this.optTitle));
    uisound(this, 'open', { action: 'restore' });
    if (this._transitions) animateIn(this, 'fall', { dur: 0.15 });
  }

  toggleMaximize() {
    const cont = this.manager?.container ?? this.parent;
    if (this.maximized) {
      this.setRect(this.prevState.x, this.prevState.y, this.prevState.width, this.prevState.height);
      this.maximized = false;
      this.dispatch('unmaximize', {});
      EldEvents.log(str('windowUnmaximized', this.optTitle));
    } else {
      this.prevState = { x: this.x, y: this.y, width: this.w, height: this.h };
      this.setRect(0, 0, cont.w, cont.h);
      this.maximized = true;
      this.dispatch('maximize', {});
      EldEvents.log(str('windowMaximized', this.optTitle));
    }
  }

  close() {
    // Preventable: a listener calling preventDefault() keeps the window alive
    // (unsaved-changes guards). onClose still runs only when the close proceeds.
    if (this._closing) return;
    const evt = this.dispatch('close', {});
    if (evt.defaultPrevented) return;
    if (this._transitions) {
      // teardown waits for the preset to land (reducedMotion collapses to instant,
      // so the promise settles immediately and the close is effectively synchronous)
      this._closing = true;
      animateOut(this, 'fadeScale').then(() => this._closeNow());
      return;
    }
    this._closeNow();
  }

  _closeNow() {
    this.manager?.taskbar?.removeItem(this.id);
    this.manager?._remove(this);
    EldEvents.log(str('windowClosed', this.optTitle));
    uisound(this, 'close');
    if (this._onClose) this._onClose();
    this.dispose();
  }

  // dispose() without close() (force-teardown) must not strand a taskbar item that
  // would restore() a dead window; both removals are idempotent with the close() path.
  disposeSelf() {
    this.manager?.taskbar?.removeItem(this.id);
    this.manager?._remove(this);
  }

  onLayout() {
    // A maximized window keeps filling its container even when the container or the
    // engine resizes (setRect no-ops while nothing changed).
    if (this.maximized) {
      const cont = this.manager?.container ?? this.parent;
      if (cont) this.setRect(0, 0, cont.w, cont.h);
    }
    this.layoutChrome();
    // square control buttons fill the header height, flush right; the strip covers the gaps
    if (this.controls) {
      const B = METRICS.windowBtn;
      const GAP = 2;
      const stripW = 3 * B + 2 * GAP;
      this.controls.setRect(this.w - 2 - stripW, 2, stripW, HEADER_H - 4);
      const by = Math.round((HEADER_H - 4 - B) / 2);
      this.btnMin.setPos(0, by);
      this.btnMax.setPos(B + GAP, by);
      this.btnClose.setPos(2 * B + 2 * GAP, by);
    }
    if (this.gripQuad) this.gripQuad.setRect(this.w - 26, this.h - 26, 24, 24);
    if (this.handles) {
      const E = 12, C = 24;
      this.handles.n.setRect(C, -4, this.w - 2 * C, E);
      this.handles.s.setRect(C, this.h - E + 4, this.w - 2 * C, E);
      this.handles.w.setRect(-4, C, E, this.h - 2 * C);
      this.handles.e.setRect(this.w - E + 4, C, E, this.h - 2 * C);
      this.handles.nw.setRect(-4, -4, C, C);
      this.handles.ne.setRect(this.w - C + 4, -4, C, C);
      this.handles.sw.setRect(-4, this.h - C + 4, C, C);
      this.handles.se.setRect(this.w - C + 4, this.h - C + 4, C, C);
    }
  }
}

// ---------------- EldWindow manager (the window statics) ----------------

export const EldWindow = {
  windows: [],
  container: null,
  taskbar: null,
  engine: null,
  _focused: null,
  _offRaise: null,
  _offGlue: null,

  // container: UINode the windows live in and are clamped to (the #windowContainer equivalent).
  init(engine, { container, taskbar } = {}) {
    this.engine = engine;
    this.taskbar = taskbar ?? null;
    this.setContainer(container ?? engine.layers.windows);

    // Mirror bringElementToFront: any pointerdown inside a window raises it, even if a control
    // stopped propagation (the bus fires before node dispatch).
    this._offRaise = engine.bus.on('pointerdown', ({ target }) => {
      const win = target?.closest?.(n => n._isEldWindow && n instanceof ModalWindow);
      if (win) win.bringToFront();
    });
    return this;
  },

  setContainer(node) {
    this.container = node;
    const layer = this.engine.layers.windows;
    layer.sortChildrenByFocus = true;
    // keep the root window layer glued to the container's on-screen position;
    // re-targeting replaces the previous subscription instead of stacking another
    if (this._offGlue) this._offGlue();
    this._offGlue = this.engine.bus.on('postlayout', () => {
      if (this.container?.disposed) {
        // a disposed container releases the glue back to the default full-engine layer
        this.container = null;
        layer.x = 0; layer.y = 0;
        layer.w = this.engine.width; layer.h = this.engine.height;
        this.engine.layoutDirty = true;
        return;
      }
      if (!this.container || this.container === layer) return;
      if (layer.x !== this.container.worldX || layer.y !== this.container.worldY) {
        layer.x = this.container.worldX;
        layer.y = this.container.worldY;
        this.engine.layoutDirty = true;
      }
      layer.w = this.container.w;
      layer.h = this.container.h;
    });
  },

  create(options = {}) {
    const win = new ModalWindow(options);
    win.manager = this;
    this.engine.layers.windows.add(win);
    win.bringToFront();
    this.windows.push(win);
    uisound(win, 'open');
    // Opt-in: `transitions: true` animates open/close/minimize/restore through
    // the house presets (reducedMotion collapses them to instant).
    if (win._transitions) animateIn(win, 'fadeScale');
    return win;
  },

  _remove(win) {
    const i = this.windows.indexOf(win);
    if (i !== -1) this.windows.splice(i, 1);
  },

  // ---- layout persistence ----
  // One entry per open window. x/y/w/h are always the NORMAL rect (a maximized
  // window records what it will unmaximize to), so a restore re-derives the fill
  // from the CURRENT container. JSON-friendly: stringify the return value.
  serializeLayout() {
    return this.windows.map((w) => ({
 id: w.id,
 x: w.maximized ? w.prevState.x: w.x,
 y: w.maximized ? w.prevState.y: w.y,
 w: w.maximized ? w.prevState.width: w.w,
 h: w.maximized ? w.prevState.height: w.h,
 minimized: w.minimized,
 maximized: w.maximized,
 userPlaced: w.userPlaced === true, //: the claim persists with the rect
 }));
  },

  // Accepts the serializeLayout() array or its JSON string. Windows are matched by
  // their stable `id` (unknown ids are skipped — the consumer builds windows first,
  // then restores). Rects clamp to the container exactly like a drag would; the
  // minimize/maximize transitions run their normal loud paths (events, log lines).
  restoreLayout(json) {
    const entries = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(entries)) return this;
    const cont = this.container ?? this.engine?.layers.windows;
    for (const e of entries) {
      const win = this.windows.find((w) => w.id === String(e.id));
      if (!win) continue;
      if (win.maximized) win.toggleMaximize(); // normalize before applying the rect
      if (win.minimized) win.restore();
      const w = clamp(Number(e.w) || win.w, win.minW, Math.max(win.minW, cont?.w ?? Infinity));
      const h = clamp(Number(e.h) || win.h, win.minH, Math.max(win.minH, cont?.h ?? Infinity));
      const x = clamp(Number(e.x) || 0, 0, Math.max(0, (cont?.w ?? Infinity) - w));
      const y = clamp(Number(e.y) || 0, 0, Math.max(0, (cont?.h ?? Infinity) - h));
      win.setRect(x, y, w, h);
      // a restored layout is the USER'S placement: without the claim,
      // page auto-layout (the !userPlaced re-park idiom) stomped the restored
      // rects on its next pass. Entries record the flag; older
      // saves lack it and restore CLAIMED — the conservative read of a layout
      // someone bothered to persist. A consumer wanting re-laning clears it.
      win.userPlaced = e.userPlaced !== false;
      if (e.maximized) win.toggleMaximize();
      if (e.minimized) win.minimize();
    }
    return this;
  },

  bringToFront(win) { win.bringToFront(); },
  bringElementToFront(node) {
    const win = node?.closest?.(n => n instanceof ModalWindow);
    if (win) win.bringToFront();
  },

  // Teardown hook: releases bus subscriptions and refs (window nodes die with their layer).
  _reset() {
    if (this._offRaise) { this._offRaise(); this._offRaise = null; }
    if (this._offGlue) { this._offGlue(); this._offGlue = null; }
    this.windows.length = 0;
    this.container = null;
    this.taskbar = null;
    this.engine = null;
    this._focused = null;
  },
};

// ---------------- EldPopup ----------------

export const EldPopup = {
  engine: null,
  overlay: null,
  panel: null,
  titleNode: null,
  messageNode: null,
  currentCallbacks: { onOkay: null, onCancel: null },
  isOpen: false,
  _queue: [],
  _current: null,
  _finishAction: null,
  _customBtns: [],
  _promptField: null,

  init(engine, { okLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
    this.engine = engine;
    this.overlay = new UINode({ interactive: true, name: 'popup-overlay' });
    const scrim = new QuadNode({ color: 0x000000, opacity: 0.75 });
    scrim.name = 'popup-scrim';
    this.overlay.add(scrim);
    this._scrim = scrim;
    const popup = this;
    this.overlay.onLayout = function () {
      this.w = popup.engine.width;
      this.h = popup.engine.height;
      scrim.setRect(0, 0, this.w, this.h);
      if (popup.panel) {
        popup.panel.setPos(Math.round((this.w - popup.panel.w) / 2), Math.round((this.h - popup.panel.h) / 2));
      }
    };
    // swallow all clicks; background click does NOT dismiss (source behavior)
    this.overlay.on('pointerdown', (e) => e.stopPropagation());
    this.overlay.on('wheel', (e) => e.stopPropagation());

    this.panel = new WindowBase({ title: str('popupDefaultTitle') });
    this.panel.interactive = true;
    this.titleNode = this.panel.title;
    // the popup body is a MEASURED box, not the old 380×(145+h) formula — VBox of
    // message → (prompt) → footer; the footer HBox right-justifies uniform buttons
    // (the design requirement's Gallery-of-Motion class dies at the popup root).
    this.messageNode = new TextNode(str('popupDefaultMessage'), { size: 13, color: COLORS.text, multiline: true, maxWidth: 300, align: 'center', fixedW: 300 });
    this.messageNode.layoutStretch = false; // raster-sized: the wrap width is its truth
    this.okBtn = new Button(okLabel, { onClick: () => this._finish('ok') });
    this.cancelBtn = new Button(cancelLabel, { onClick: () => this._finish('cancel') });
    this.body = new VBox({ padding: 12, gap: 14, align: 'stretch' });
    this.footer = new HBox({ gap: 15, justify: 'end', autoWidth: false });
    this.footer.add(this.okBtn, this.cancelBtn);
    this.body.add(this.messageNode, this.footer);
    this.panel.contentArea.content.add(this.body);
    this.panel.onLayout = () => this.panel.layoutChrome(); // the box does the rest
    this.overlay.add(this.panel);
    this.overlay.visible = false;
    // a modal surface offers no wheel — the radial chain stops at the scrim
    this.overlay.radialItems = () => false;
    engine.layers.overlay.add(this.overlay);
    return this;
  },

  // Stacked show() calls queue (FIFO): resolving the current popup presents the next.
  // Every call returns a Promise resolving { action, value } — action is 'ok'/'cancel'
  // or the clicked custom button's label; value is the prompt text (null without one).
  // opts: { title, message, onOkay, onCancel,
  // buttons: [{ label, onClick, variant }], // replaces the OK/Cancel pair
  // prompt: { placeholder, value } | true } // adds a text field
  show({ title = str('popupDefaultTitle'), message = str('popupDefaultMessage'), onOkay = null, onCancel = null, buttons = null, prompt = null } = {}) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const req = { title, message, onOkay, onCancel, buttons, prompt, resolve };
    if (this.isOpen) this._queue.push(req);
    else this._present(req);
    return promise;
  },

  _present(req) {
    // Modal supersedes transients: an in-flight icon drag cancels back (its drop
    // probe would otherwise resolve against the scrim — deleting a bar rite), and an
    // open context menu closes rather than lingering buried under the scrim as a
    // stale Escape-stack entry.
    EldDragDrop.cancelDrag();
    EldContextMenu.close();
    this.isOpen = true;
    uisound(this.panel, 'open', { modal: true });
    // The mirror flag menu.js reads (it cannot import windows.js — cycle): while a
    // modal owns input, a menu asked to open would sit buried under the scrim.
    this.engine.modalActive = true;
    this.overlay.interactive = true; // re-arm the modal scrim (hide() releases it)
    // Re-append to the overlay layer's END: anything added to the layer since boot
    // (a LoadingVeil) would otherwise paint over the modal forever — the popup root
    // was added at boot and add-order is paint order within a layer.
    this.engine.layers.overlay.add(this.overlay);
    this._current = req;
    // Modal focus: remember the outside focus, land on the primary control, and register
    // on the escape stack so Escape/gamepad-B run the cancel path.
    if (this._prevFocus == null) {
      this._prevFocus = this.engine.focusedNode ?? false;
      this._prevSource = this.engine.focus.source; // C1: hand back with the source we took over from
    }
    this._offEscape = this.engine.focus.pushEscape(() => this._finish('cancel'));
    this.currentCallbacks = { onOkay: req.onOkay, onCancel: req.onCancel };
    this.titleNode.setText(req.title);
    this.messageNode.setText(req.message);

    // Custom button row replaces the persistent OK/Cancel pair for this presentation.
    this._customBtns = [];
    if (req.buttons && req.buttons.length) {
      this.okBtn.visible = false;
      this.cancelBtn.visible = false;
      for (const spec of req.buttons) {
        const btn = new Button(spec.label, { onClick: () => this._finish(spec.label, spec.onClick) });
        if (spec.variant === 'accent') btn.label.setColor(COLORS.accent);
        this._customBtns.push(btn);
        this.footer.add(btn); // the footer HBox right-justifies whatever row it holds
      }
    } else {
      this.okBtn.visible = true;
      this.cancelBtn.visible = true;
    }

    // uniform footer buttons — every visible button takes the widest natural
    // width (Button's own label+52 formula, floored by its minWidth), so a long
    // custom label can never leave the row ragged. Recomputed each presentation;
    // setSize early-returns when nothing changed.
    {
      const row = this.footer.children.filter((b) => b._visible && !b.fitExclude);
      let uw = 0;
      for (const b of row) uw = Math.max(uw, Math.max(b._minW, Math.ceil(b.label.w) + 52));
      for (const b of row) b.setSize(uw, b.h);
    }

    if (req.prompt) {
      const p = req.prompt === true ? {} : req.prompt;
      this._promptField = new TextField({ placeholder: p.placeholder ?? '', value: p.value ?? '', width: 220 });
      // Enter commits the prompt through the OK path (without needing the buttons).
      // Escape: the field's OWN handler (registered first) has already consumed the
      // press and blurred — finishing as cancel here makes ONE Escape dismiss a prompt
      // popup, promptless parity (was: first blurs, second pops).
      this._promptField.on('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._finish('ok'); }
        else if (e.key === 'Escape') this._finish('cancel');
      });
      // ordered body: message → prompt → footer (re-adding the footer moves it last)
      this.body.add(this._promptField);
      this.body.add(this.footer);
    }

    // MEASURED, never the old 380×(145+h) formula — settle the body box, size the
    // panel to it, center; the overlay's own layout re-centers on every resize.
    const eng = this.engine;
    this.body.onLayout();
    this.panel.autoSizeToContent();
    this.panel.setPos(Math.round((eng.width - this.panel.w) / 2), Math.round((eng.height - this.panel.h) / 2));
    this.overlay.visible = true;
    this.overlay.fxOpacity = 0;
    this.panel.fxScale = 0.9;
    eng.ticker.tween(this.overlay, { fxOpacity: 1 }, { dur: 0.2 });
    if (isReducedMotion()) { eng.ticker.cancelPropTween(this.panel, 'fxScale'); this.panel.fxScale = 1; }
    else eng.ticker.tween(this.panel, { fxScale: 1 }, { dur: 0.2 });
    if (this._promptField) {
      // promote straight to text editing, caret at the end (the TextField activate path)
      const v = this._promptField.value;
      eng.setFocus(this._promptField, { text: true, value: v, selectionStart: v.length, selectionEnd: v.length });
    } else {
      eng.focus.set(this._customBtns[0] ?? this.okBtn, eng.focus.source);
    }
  },

  // Every resolution path funnels here: default buttons, custom buttons, Escape, Enter.
  _finish(action, customClick = null) {
    const value = this._promptField ? this._promptField.value : null;
    const cb = action === 'ok' ? this.currentCallbacks.onOkay
      : action === 'cancel' ? this.currentCallbacks.onCancel
      : customClick;
    this._finishAction = action;
    this.hide();
    if (cb) cb(value);
  },

  hide() {
    const eng = this.engine;
    // the fading scrim must not swallow the user's next click: release it the moment
    // the popup resolves, not when the fade lands (_present re-arms it)
    this.overlay.interactive = false;
    eng.ticker.tween(this.overlay, { fxOpacity: 0 }, { dur: 0.2, onDone: () => { this.overlay.visible = false; } });
    this.currentCallbacks = { onOkay: null, onCancel: null };
    this.isOpen = false;
    uisound(this.panel, 'close', { modal: true });
    eng.modalActive = false; // a queued _present re-raises it within the same call chain
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    // A direct hide() (no button) resolves as a cancel with the prompt's current value.
    if (this._current) {
      const value = this._promptField ? this._promptField.value : null;
      const action = this._finishAction ?? 'cancel';
      const resolve = this._current.resolve;
      this._current = null;
      resolve?.({ action, value });
    }
    this._finishAction = null;
    for (const b of this._customBtns ?? []) b.dispose();
    this._customBtns = [];
    if (this._promptField) { this._promptField.dispose(); this._promptField = null; }
    // A queued popup preempts the fade-out (per-property preemption drops its onDone).
    if (this._queue.length) {
      this._present(this._queue.shift());
    } else {
      const prev = this._prevFocus;
      const src = this._prevSource ?? 'api';
      this._prevFocus = null;
      this._prevSource = null;
      // C1: skip a holder DISABLED while the popup was open (a sealed field must not
      // re-light its focus art); keyboard-opened flows keep their ring via the source
      if (prev && !prev.disposed && !prev.closest((a) => a.disabled === true)) eng.focus.set(prev, src);
      else if (prev !== null) eng.focus.clear();
    }
  },

  onLayoutResize() {
    if (this.overlay) this.overlay.setRect(0, 0, this.engine.width, this.engine.height);
  },

  // Teardown hook: drop refs and callbacks (overlay/panel die with the overlay layer).
  // Pending promises resolve as cancels — destroy never leaves a caller hanging.
  _reset() {
    if (this._current) { this._current.resolve?.({ action: 'cancel', value: null }); this._current = null; }
    for (const req of this._queue) req.resolve?.({ action: 'cancel', value: null });
    this.currentCallbacks = { onOkay: null, onCancel: null };
    this._queue.length = 0;
    this.isOpen = false;
    if (this._offEscape) { this._offEscape(); this._offEscape = null; }
    this._prevFocus = null;
    this._finishAction = null;
    this._customBtns = [];
    this._promptField = null;
    this.engine = null;
    this.overlay = null;
    this.panel = null;
    this.titleNode = null;
    this.messageNode = null;
    this.okBtn = null;
    this.cancelBtn = null;
    this._scrim = null;
  },
};

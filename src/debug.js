// Debug overlay (?debug=1 on any page). v1: layout bounds of the hovered node, its
// clip rect, the hit chain, and a perf HUD — painted with library nodes into the
// vignette layer, no DOM. A read-only observer; it never captures input. NOTE: the
// per-frame HUD re-raster keeps the renderer awake, so the idle dirty-gate is
// effectively off while the overlay runs — acceptable for a debugging aid.
// v2: the NODE-TREE INSPECTOR — press `i` (with nothing focused) under
// ?debug=1, or construct DebugInspector directly. A live virtualized tree of every
// layer, click-to-select with a bounds highlight, a pick mode that selects whatever
// the next press hits (read-only: the press still acts — the v1 philosophy), a
// property readout, and the leak dashboard (live node/tween/hook/texture counts —
// numbers that refuse to fall after teardown ARE the dispose report).

import { QuadNode } from './primitives.js';
import { TextNode } from './text.js';
import { FONTS } from './theme.js';
import { EldWindow } from './widgets/windows.js';
import { VirtualList } from './widgets/virtual.js';
import { requireEngine, Button } from './widgets/widgets.js';
import { renumber } from './layers.js';

export function initDebug(engine) {
  const layer = engine.layers.vignette;
  const mkEdges = (color) => {
    const q = [];
    for (let i = 0; i < 4; i++) {
      const e = new QuadNode({ color, opacity: 0.9 });
      e.interactive = false;
      layer.add(e);
      q.push(e);
    }
    return q;
  };
  const boundEdges = mkEdges(0x66ff99);  // hovered node's world rect
  const clipEdges = mkEdges(0xff8866);   // its effective clip rect

  const hud = new TextNode('', {
    font: FONTS.mono, size: 11, color: '#9fe8b5', multiline: true, maxWidth: 620,
    shadow: { color: 'rgba(0,0,0,0.9)', dx: 1, dy: 1, blur: 2 },
  });
  hud.interactive = false;
  layer.add(hud);
  hud.setPos(8, 8);

  const outline = (edges, r) => {
    const on = !!r && r.x1 > r.x0 && r.y1 > r.y0;
    for (const e of edges) e.visible = on;
    if (!on) return;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    edges[0].setRect(r.x0, r.y0, w, 1);
    edges[1].setRect(r.x0, r.y1 - 1, w, 1);
    edges[2].setRect(r.x0, r.y0, 1, h);
    edges[3].setRect(r.x1 - 1, r.y0, 1, h);
  };
  const nameOf = (n) => n.name || n.constructor.name;

  let frames = 0, fps = 0, msAvg = 0, acc = 0, last = performance.now();
  engine.ticker.add(() => {
    const now = performance.now();
    acc += now - last;
    last = now;
    frames++;
    if (acc >= 500) { fps = Math.round(frames * 1000 / acc); msAvg = (acc / frames).toFixed(1); frames = 0; acc = 0; }

    const target = engine.hover?.target ?? null;
    outline(boundEdges, target ? target.worldRect : null);
    outline(clipEdges, target ? target.effectiveClipRect : null);

    let chain = '';
    if (target) {
      const parts = [];
      let n = target;
      while (n && parts.length < 6) { parts.push(nameOf(n)); n = n.parent; }
      const r = target.worldRect;
      chain = `\nhit: ${parts.join(' < ')}\nrect: ${Math.round(r.x0)},${Math.round(r.y0)} ${Math.round(r.x1 - r.x0)}x${Math.round(r.y1 - r.y0)}`
        + (target.effectiveClipRect ? '  (clipped)' : '');
    }
    const s = engine.stats();
    hud.setText(`debug  ${fps} fps  ${msAvg}ms  draws ${s.calls}  nodes ${engine.paintList.length}${chain}`);
  });
  // Everything above belongs to the engine (layer nodes, ticker callback) and dies
  // with it on Eldritch.destroy() — no separate teardown to leak.

  // v2: `i` toggles the inspector window. Bus keydown arrives with nothing
  // focused OR falls through a focused non-text widget that left it unconsumed
  // a TextField mid-edit consumes it, so typing an i stays typing.
  // The listener dies with the bus.
  let inspector = null;
  engine.bus.on('keydown', (e) => {
    if (e.key !== 'i' && e.key !== 'I') return;
    if (inspector && !inspector.disposed) { inspector.dispose(); inspector = null; }
    else inspector = new DebugInspector();
  });
}

// ---------------- DebugInspector (v2) ----------------

export class DebugInspector {
  constructor() {
    const eng = requireEngine();
    this.engine = eng;
    this.disposed = false;
    this._selected = null;
    this._items = [];
    this._picking = false;
    this._offPick = null;

    // the selection highlight lives on the vignette layer like v1's hover bounds
    this._edges = [];
    for (let i = 0; i < 4; i++) {
      const e = new QuadNode({ color: 0x66ccff, opacity: 0.95 });
      e.interactive = false;
      e.visible = false;
      eng.layers.vignette.add(e);
      this._edges.push(e);
    }

    this.win = EldWindow.create({
      title: 'Inspector',
      width: 400, height: 480,
      x: Math.max(10, eng.width - 420), y: 60,
      content: (c) => {
        this._refreshBtn = new Button('Refresh', { minWidth: 90, height: 28, onClick: () => this.refresh() });
        this._refreshBtn.setPos(6, 6);
        this._pickBtn = new Button('Pick', { minWidth: 78, height: 28, onClick: () => this.togglePick() });
        // position AFTER the real widths — Button floors at label+52, so the
        // old hardcoded x=102 sat Pick under a ~114px Refresh (the census overlap)
        this._pickBtn.setPos(6 + this._refreshBtn.w + 6, 6);
        this._counts = new TextNode('', { font: FONTS.mono, size: 10, color: '#9fe8b5', multiline: true, maxWidth: 140 });
        this._counts.setPos(6 + this._refreshBtn.w + 6 + this._pickBtn.w + 8, 4);
        this.tree = new VirtualList({
          rowH: 24, // tree rows are clickable — the interactive hit floor applies
          renderRow: (node, item) => {
            if (!node._t) {
              node._t = new TextNode('', { font: FONTS.mono, size: 10, color: '#b7c0b6' });
              node._t.setPos(4, 7);
              node.add(node._t);
              node.interactive = true;
              node.on('click', () => { if (node._item) this.select(node._item.node); });
            }
            node._item = item;
            node._t.setText(item.label);
            node._t.setColor(item.node === this._selected ? '#6fd18b' : '#b7c0b6');
          },
        });
        this.tree.setRect(4, 40, 364, 250);
        this._readout = new TextNode('', { font: FONTS.mono, size: 10, color: '#dde4da', multiline: true, maxWidth: 356 });
        this._readout.setPos(8, 300); // 8+356 fits the 368px content box (364 overflowed by 4)
        c.add(this._refreshBtn, this._pickBtn, this._counts, this.tree, this._readout);
        // resize glue: the tree and readout track the window's content box
        const insp = this;
        c.onLayout = function () {
          insp.tree.setRect(4, 40, Math.max(120, this.w - 12), Math.max(80, this.h - 210));
          insp._readout.setPos(8, Math.max(130, this.h - 162));
        };
      },
    });
    this.win.on('dispose', () => this._teardown());
    this.refresh();
  }

  // Rebuild the tree snapshot (on demand — a per-frame tree walk would be a leak
  // dashboard that causes the load it measures).
  refresh() {
    if (this.disposed) return this;
    const eng = this.engine;
    if (eng.paintDirty) renumber(eng); // a boot-time refresh would otherwise count "live 0"
    const items = [];
    const walk = (n, depth) => {
      items.push({
        node: n,
        label: `${'· '.repeat(depth)}${n.name || n.constructor.name}#${n.id}${n._visible ? '' : ' [hidden]'}`,
      });
      for (const c of n.children) walk(c, depth + 1);
    };
    for (const name of Object.keys(eng.layers)) walk(eng.layers[name], 0);
    this._items = items;
    this.tree.setItems(items);
    const s = eng.stats();
    this._counts.setText(
      `live ${eng.paintList.length} · tree ${items.length}\n`
      + `tweens ${eng.ticker.tweens.size} · hooks ${eng.frameHooks.size}\n`
      + `tex ${s.textures} · draws ${s.calls}`,
    );
    return this;
  }

  select(n) {
    this._selected = n && !n.disposed ? n : null;
    const r = this._selected ? this._selected.worldRect : null;
    const on = !!r && r.x1 > r.x0 && r.y1 > r.y0;
    for (const e of this._edges) e.visible = on;
    if (on) {
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      this._edges[0].setRect(r.x0, r.y0, w, 1);
      this._edges[1].setRect(r.x0, r.y1 - 1, w, 1);
      this._edges[2].setRect(r.x0, r.y0, 1, h);
      this._edges[3].setRect(r.x1 - 1, r.y0, 1, h);
    }
    if (this._selected) {
      const n2 = this._selected, rr = n2.worldRect;
      let root = n2;
      while (root.parent) root = root.parent;
      const layerName = root.name?.startsWith('layer:') ? root.name.slice(6) : (root.name || '?');
      this._readout.setText([
        `${n2.name || n2.constructor.name}#${n2.id}  (${layerName})`,
        `local ${n2.x},${n2.y} ${n2.w}x${n2.h} · world ${Math.round(rr.x0)},${Math.round(rr.y0)} ${Math.round(rr.x1 - rr.x0)}x${Math.round(rr.y1 - rr.y0)}`,
        `interactive ${!!n2.interactive} · focusable ${!!n2.focusable} · disabled ${!!n2.closest((a) => a.disabled === true)}`,
        `visible ${n2.visibleInTree()} · paint #${n2.paintIndex} · children ${n2.children.length}`,
        n2.effectiveClipRect ? 'clipped' : 'unclipped',
        this.engine.focusedNode === n2 ? 'HOLDS FOCUS' : '',
      ].filter(Boolean).join('\n'));
    } else {
      this._readout.setText('');
    }
    this.tree.setItems([...this._items]); // re-tint the visible rows
    return this;
  }

  // Pick mode: the NEXT press selects whatever it hits. Read-only by philosophy —
  // the press is observed, never swallowed, so the widget beneath still acts.
  togglePick() {
    if (this._picking) { this._endPick(); return this; }
    this._picking = true;
    this._pickBtn.setText('Picking…');
    this._offPick = this.engine.bus.on('pointerdown', (e) => {
      if (e.target && this.win.isAncestorOf(e.target)) return; // never pick the inspector itself
      this._endPick();
      this.refresh();
      this.select(e.target ?? null);
    });
    return this;
  }

  _endPick() {
    this._picking = false;
    if (this._pickBtn && !this._pickBtn.disposed) this._pickBtn.setText('Pick');
    if (this._offPick) { this._offPick(); this._offPick = null; }
  }

  dispose() {
    if (this.disposed) return;
    if (!this.win.disposed) this.win.close();
    // _teardown runs via the window's dispose event
  }

  _teardown() {
    if (this.disposed) return;
    this.disposed = true;
    this._endPick();
    for (const e of this._edges) e.dispose();
    this._edges.length = 0;
  }
}

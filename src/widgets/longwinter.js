// The Long Winter: the survival/crafting kit. RecipeBrowser (category
// strip + availability-tinted recipe list + a detail pane with have/need rows and
// craft ×N — the `craft` event is LOUD and the GAME decrements, then refresh()
// re-tints), ProcessPanel (input/fuel/output as three 1×1 ItemGrids — the
// drag protocol interops for free — under a progress arrow the game clocks), and
// CompassStrip (a 360° heading tape baked ONCE and panned by texture offset, so
// the 359→0 wrap is a modulo, not a re-raster; cardinal letters localize through
// the strings table; bearing markers ride relative bearing). The day/clock dial
// and grid sort fell per the cut line; deposit-all shipped free — ItemGrid's
// transferAll is the same sweep pointed both ways.

import { RepeatWrapping } from 'three';
import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { clamp } from '../layout.js';
import { requireEngine, widgetsEngine, uisound, commitChange, setNodeDisabled, Button, itemData } from './widgets.js';

// module-local once-per-key warn (the node.js/nodegraph.js idiom)
const _warned = new Set();
function warnOnce(key, message) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(message);
}
import { SegmentedControl } from './meters.js';
import { VirtualList } from './virtual.js';
import { NumberField } from './numberfield.js';
import { ItemGrid } from './itemgrid.js';
import { str } from '../strings.js';

const frame = (n) => requireEngine().textures.frame(n);
const tex = (n) => requireEngine().textures.get(n);
const iconTex = (n) => {
  const reg = requireEngine().textures;
  const bare = `icon.${n}`;
  return reg.textures.has(bare) ? reg.get(bare) : reg.get(n); // bare-first, the rule
};
const SHADOW = METRICS.textShadow; // X02: the shared token (was a per-file literal)

// ---------------- RecipeBrowser ----------------

export class RecipeBrowser extends UINode {
  // opts: { recipes: [{id, label, icon, out: {id, count = 1}, needs: [{id, count}], category}],
  //         categories = derived, have: (id) => count, width = 470, height = 330, onCraft }
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    this.recipes = (opts.recipes ?? []).map((r) => ({
      ...r,
      id: String(r.id),
      out: { id: String(r.out?.id ?? r.id), count: r.out?.count ?? 1 },
      needs: (r.needs ?? []).map((n) => ({ id: String(n.id), count: Math.max(1, n.count ?? 1) })),
      category: String(r.category ?? 'all'),
    }));
    this._have = typeof opts.have === 'function' ? opts.have : () => 0;
    this.onCraft = opts.onCraft ?? null;
    this._selected = null;

    this.bg = new NineSliceNode(frame('panel.dark'));
    this.add(this.bg);

    const cats = opts.categories
      ?? [...new Set(this.recipes.map((r) => r.category))].map((id) => ({ id, label: id }));
    this._category = cats[0]?.id ?? 'all';
    this.catPick = new SegmentedControl({
      options: cats.map((c) => ({ label: c.label ?? c.id, value: c.id })),
      value: this._category,
      width: Math.min(420, Math.max(180, cats.length * 110)),
      onChange: (v) => { this._category = v; this._rebuildList(); },
    });
    this.list = new VirtualList({
      rowH: 26,
      renderRow: (node, item) => {
        if (!node._icon) {
          node._icon = new QuadNode({});
          node._icon.setRect(4, 4, 18, 18);
          node._t = new TextNode('', { size: 12, shadow: SHADOW });
          node._t.setPos(28, 5);
          node.add(node._icon, node._t);
          node.interactive = true;
          node.on('click', () => { if (node._item) this.select(node._item.id); });
        }
        node._item = item;
        node._icon.setTexture(iconTex(item.icon ?? item.out.id));
        node._t.setText(item.label ?? item.id);
        node._t.setColor(this._craftable(item, 1) ? COLORS.text : COLORS.textDisabled);
      },
    });
    this._detail = new UINode({ name: 'recipe-detail' });
    this.qty = new NumberField({ min: 1, max: 99, value: 1, onChange: () => this._paintDetail() });
    this.craftBtn = new Button(str('craftLabel'), { minWidth: 90, height: 28, onClick: () => this.craft() });
    this.add(this.catPick, this.list, this._detail, this.qty, this.craftBtn);

    this.setSize(Number.isFinite(opts.width) ? opts.width : 470, Number.isFinite(opts.height) ? opts.height : 330);
    this._rebuildList();
  }

  _visibleRecipes() { return this.recipes.filter((r) => r.category === this._category); } // NOT _visible: UINode owns that backing field

  _craftable(recipe, n) {
    return recipe.needs.every((nd) => this._have(nd.id) >= nd.count * n);
  }

  _rebuildList() {
    const rows = this._visibleRecipes();
    this.list.setItems(rows);
    if (!this._selected || !rows.some((r) => r.id === this._selected.id)) this.select(rows[0]?.id ?? null);
    else this._paintDetail();
  }

  select(id) {
    this._selected = this.recipes.find((r) => r.id === String(id)) ?? null;
    this._paintDetail();
    return this;
  }

  _paintDetail() {
    for (const c of [...this._detail.children]) c.dispose();
    const r = this._selected;
    const n = this.qty.value;
    if (!r) { this.craftBtn.setDisabled(true); return; }
    const outIcon = new QuadNode({ texture: iconTex(r.icon ?? r.out.id) });
    outIcon.setRect(0, 0, 36, 36);
    const name = new TextNode(r.label ?? r.id, {
      font: FONTS.header, size: 14, smallCaps: true, letterSpacing: 1, color: COLORS.accent, shadow: SHADOW,
    });
    name.setPos(44, 2);
    const yields = new TextNode(`×${r.out.count * n}`, { font: FONTS.mono, size: 12, color: COLORS.textMuted, shadow: SHADOW });
    yields.setPos(44, 21);
    this._detail.add(outIcon, name, yields);
    let y = 46;
    for (const nd of r.needs) {
      const have = this._have(nd.id);
      const want = nd.count * n;
      const short = have < want;
      const ni = new QuadNode({ texture: iconTex(itemData(nd.id).icon ?? nd.id) });
      ni.setRect(2, y, 16, 16);
      const nt = new TextNode(`${itemData(nd.id).name}  ${have}/${want}`, {
        font: FONTS.mono, size: 11, color: short ? COLORS.negative : COLORS.textMuted, shadow: SHADOW,
      });
      nt.setPos(24, y + 2);
      this._detail.add(ni, nt);
      y += 20;
    }
    this._detail.setSize(200, y);
    this.craftBtn.setDisabled(!this._craftable(r, n));
    this.invalidateLayout();
  }

  // The LOUD affordance: `craft {id, count, out, needs}` with everything scaled by
  // ×N — the GAME decrements its inventory, then calls refresh() so the tints and
  // have/need rows read the new truth (the data-driven protocol).
  craft() {
    const r = this._selected;
    if (!r || this.disabled) return this;
    const n = this.qty.value;
    if (!this._craftable(r, n)) {
      uisound(this, 'error', { craft: r.id });
      return this;
    }
    commitChange(this, 'craft', {
      id: r.id,
      count: n,
      out: { id: r.out.id, count: r.out.count * n },
      needs: r.needs.map((nd) => ({ id: nd.id, count: nd.count * n })),
    }, false, this.onCraft ? (_v, e) => this.onCraft(e, e) : null);
    return this;
  }

  refresh() {
    this.list.setItems([...this._visibleRecipes()]);
    this._paintDetail();
    return this;
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.catPick.setPos(12, 10);
    const top = 48;
    const listW = Math.round(this.w * 0.42);
    this.list.setRect(12, top, listW, this.h - top - 12);
    this._detail.setPos(listW + 26, top);
    this.qty.setPos(listW + 26, this.h - 44);
    this.craftBtn.setPos(this.w - 12 - this.craftBtn.w, this.h - 46);
  }
}

// ---------------- ProcessPanel ----------------
// The campfire/forge: input and fuel slots feed an output slot under a progress
// arrow. Each slot is a 1×1 ItemGrid, so the drag protocol (stacking,
// splitting, tooltips, the lock seal) interops with zero new code — the panel is
// COMPOSITION plus an arrow. The game clocks the process and calls setProgress;
// itemchange events bubble up through the panel for it to read.

const ARROW_W = 56, ARROW_H = 22;

export class ProcessPanel extends UINode {
  // opts: { }
  constructor(opts = {}) {
    super({ interactive: true });
    requireEngine();
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.input = new ItemGrid({ cols: 1, rows: 1 });
    this.fuel = new ItemGrid({ cols: 1, rows: 1 });
    this.output = new ItemGrid({ cols: 1, rows: 1 });
    this._labels = ['processInput', 'processFuel', 'processOutput'].map((k) => new TextNode(str(k), {
      font: FONTS.header, size: 10, smallCaps: true, letterSpacing: 1, color: COLORS.textFaint, shadow: SHADOW,
    }));
    this._arrowArt = createCanvasTexture(ARROW_W, ARROW_H, texScale());
    this._arrow = new QuadNode({ texture: this._arrowArt.texture });
    this.add(this.bg, this.input, this.fuel, this.output, this._arrow, ...this._labels);
    this._progress = 0;
    this._paintArrow();
    // width DERIVES from the live grids (the old 64+64 literals were the
 // 44px-slot grid width and spilled when the slots grew): the onLayout chain
    // input(14)…arrow(+24)…output(+12) plus a 14px right pad, symmetric with the left
    this.setSize(this.input.w + 24 + ARROW_W + 12 + this.output.w + 14, 190);
  }

  // 0..1; the game clocks the burn (presentation only, the meters rule).
  setProgress(v) {
    this._progress = Number.isFinite(v) ? clamp(v, 0, 1) : 0;
    this._paintArrow();
    return this;
  }

  get progress() { return this._progress; }

  _paintArrow() {
    const { ctx, texture } = this._arrowArt;
    ctx.clearRect(0, 0, ARROW_W, ARROW_H);
    const shaft = (color, w) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(4, ARROW_H / 2);
      ctx.lineTo(4 + w, ARROW_H / 2);
      ctx.stroke();
    };
    shaft(COLORS.stoneMid, ARROW_W - 16);
    if (this._progress > 0.01) shaft(COLORS.accent, (ARROW_W - 16) * this._progress);
    ctx.fillStyle = this._progress >= 1 ? COLORS.accent : COLORS.stoneMid;
    ctx.beginPath();
    ctx.moveTo(ARROW_W - 12, ARROW_H / 2 - 8);
    ctx.lineTo(ARROW_W - 2, ARROW_H / 2);
    ctx.lineTo(ARROW_W - 12, ARROW_H / 2 + 8);
    ctx.closePath();
    ctx.fill();
    texture.needsUpdate = true;
    (this.engine ?? this._lastEngine)?.requestRender();
  }

  setDisabled(v) { setNodeDisabled(this, v); }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.input.setPos(14, 26);
    this.fuel.setPos(14, this.h - this.fuel.h - 14);
    this._arrow.setRect(this.input.w + 24, Math.round((this.h - ARROW_H) / 2), ARROW_W, ARROW_H);
    this.output.setPos(this.input.w + 24 + ARROW_W + 12, Math.round((this.h - this.output.h) / 2));
    this._labels[0].setPos(16, 10);
    this._labels[1].setPos(16, this.fuel.y - 15);
    this._labels[2].setPos(this.output.x + 2, this.output.y - 15);
  }

  disposeSelf() {
    if (this._arrowArt) { this._arrowArt.texture.dispose(); this._arrowArt = null; }
  }
}

// ---------------- CompassStrip ----------------
// The heading tape: 360° baked ONCE into a repeat-wrapped texture and panned by
// offset — setHeading is a modulo and a uniform write, so the 359→0 wrap costs
// nothing and never re-rasters. Bearing markers position by relative bearing;
// the shooter kit reuses this whole.

const PX_PER_DEG = 2;
const TAPE_H = 22;

export class CompassStrip extends UINode {
  // opts: { width = 320, heading = 0, markers = [{bearing, color?}] }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const w = Number.isFinite(opts.width) ? Math.max(120, opts.width) : 320;
    this._windowDeg = w / PX_PER_DEG;
    this.bg = new NineSliceNode(frame('panel.dark'));
    this._tapeArt = createCanvasTexture(360 * PX_PER_DEG, TAPE_H, texScale());
    this._paintTape();
    this._tapeArt.texture.wrapS = RepeatWrapping;
    this._tape = new QuadNode({ texture: this._tapeArt.texture });
    this._tape.material.map.repeat.x = this._windowDeg / 360;
    // the tape and needle are the instrument's FACE, riding under the frame lip
    // (the bar-art class, /) — declared, not fitted to the panel insets
    this._tape.auditAllow('containment');
    this._needle = new QuadNode({ color: COLORS.accent, opacity: 0.95 });
    this._needle.auditAllow('containment');
    this.readout = new TextNode('', { font: FONTS.mono, size: 11, color: COLORS.accent, shadow: SHADOW });
    this._markerNodes = [];
    this.add(this.bg, this._tape, this._needle, this.readout);
    this.setSize(w, TAPE_H + 20);
    this.markers = [];
    this.setMarkers(opts.markers ?? []);
    this.heading = NaN; // unset — the ctor's setHeading below always commits
    this._displayHeading = 0;
    this.setHeading(opts.heading ?? 0); // detached at ctor time → the snap path
  }

  _paintTape() {
    const { ctx } = this._tapeArt;
    const W = 360 * PX_PER_DEG;
    ctx.clearRect(0, 0, W, TAPE_H);
    const cardinals = str('compassCardinals').split(' ');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let deg = 0; deg < 360; deg += 15) {
      const x = deg * PX_PER_DEG;
      const major = deg % 90 === 0;
      ctx.fillStyle = major ? COLORS.text : COLORS.textFaint;
      ctx.fillRect(x, TAPE_H - (major ? 10 : 6), 1.5, major ? 10 : 6);
      if (major) {
        ctx.font = `bold 10px ${FONTS.mono}`;
        ctx.fillStyle = COLORS.text;
        ctx.fillText(cardinals[deg / 90] ?? String(deg), x, 1);
      } else if (deg % 45 === 0) {
        ctx.font = `9px ${FONTS.mono}`;
        ctx.fillStyle = COLORS.textFaint;
        ctx.fillText(String(deg), x, 2);
      }
    }
    this._tapeArt.texture.needsUpdate = true;
  }

  // Normalized 0..359.999. The COMMITTED number lands instantly (readout + event —
  // numbers are the contract); the DISPLAYED tape slides the SHORTEST arc 0.3s to
  // it (STYLE §9's value tempo). `animate: false` snaps — the per-frame aim path.
  // Speaks `change {value}` on silent: false (the uniform contract).
  setHeading(deg, { silent = true, animate = true } = {}) {
    if (!Number.isFinite(deg)) {
      // refuse LOUDLY like the marker path (re-check: the record said
 // "drops non-finite bearings loudly" but only setMarkers warned — a NaN
 // heading vanished silently, the exact class named)
      warnOnce('compass:heading',
        'LovecraftUI CompassStrip: a non-finite heading was ignored (the last heading holds).');
      return this;
    }
    const next = ((deg % 360) + 360) % 360;
    if (next === this.heading) return this;
    this.heading = next;
    this.readout.setText(`${Math.round(next) % 360}°`); // 359.5 reads 0°, not 360°
    const eng = widgetsEngine();
    if (animate && this.engine && eng) {
      // shortest-arc: tween an UNWRAPPED scalar so 350→10 slides 20° through north,
      // never 340° the long way back
      const cur = this._displayHeading;
      const curN = ((cur % 360) + 360) % 360;
      const delta = ((next - curN + 540) % 360) - 180;
      eng.ticker.tween(this, { _displayHeading: cur + delta }, { dur: 0.3, onUpdate: () => this._applyDisplay() });
    } else {
      // the ArcGauge pin: a direct write never preempts — cancel the in-flight slide
      if (eng) eng.ticker.cancelPropTween(this, '_displayHeading');
      this._displayHeading = next;
      this._applyDisplay();
    }
    commitChange(this, 'change', { value: next }, silent, null);
    this.invalidateLayout(); // the readout re-centers on width change
    return this;
  }

  // The displayed pan: tape offset + markers ride _displayHeading — a uniform write
  // and marker setPos on the render-hot path, no relayout (the design note above).
  _applyDisplay() {
    const shown = ((this._displayHeading % 360) + 360) % 360;
    const left = shown - this._windowDeg / 2;
    this._tape.material.map.offset.x = ((left / 360) % 1 + 1) % 1;
    this._layoutMarkers(shown);
    (this.engine ?? this._lastEngine)?.requestRender();
  }

  setMarkers(markers) {
    for (const m of this._markerNodes) m.dispose();
    this._markerNodes = [];
    // Non-finite bearings refuse LOUDLY: NaN % 360 is NaN, and the
    // marker quad positioned at NaN simply vanished with no warning — the
    // sibling setHeading has guarded the same class since it shipped.
    this.markers = (markers ?? [])
      .filter((m) => {
        if (Number.isFinite(m?.bearing)) return true;
        warnOnce('compass:marker',
          'LovecraftUI CompassStrip: a marker with a non-finite bearing was dropped.');
        return false;
      })
      .map((m) => ({ bearing: ((m.bearing % 360) + 360) % 360, color: m.color ?? COLORS.quest }));
    for (const m of this.markers) {
      const q = new QuadNode({ color: m.color, opacity: 0.95 });
      q.setSize(3, 8);
      q.auditAllow('containment'); // rides the tape face like the needle
      this._markerNodes.push(q);
      this.add(q);
    }
    this._layoutMarkers();
    return this;
  }

  // Relative bearing → window x; markers beyond the window edge hide. Positions
  // ride the DISPLAYED heading (the slide carries them with the tape).
  _layoutMarkers(heading = ((this._displayHeading % 360) + 360) % 360) {
    const half = this._windowDeg / 2;
    this.markers.forEach((m, i) => {
      const node = this._markerNodes[i];
      if (!node) return;
      const rel = ((m.bearing - heading + 540) % 360) - 180;
      const on = Math.abs(rel) <= half;
      node.visible = on;
      if (on) node.setPos(Math.round(this.w / 2 + rel * PX_PER_DEG - 1), 18 + TAPE_H - 8);
    });
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this._tape.setRect(0, 18, this.w, TAPE_H);
    this._needle.setRect(Math.round(this.w / 2), 16, 1, TAPE_H + 2);
    this.readout.setPos(Math.round((this.w - this.readout.w) / 2), 3);
    this._applyDisplay();
  }

  disposeSelf() {
    if (this._tapeArt) { this._tapeArt.texture.dispose(); this._tapeArt = null; }
  }
}

// ---------------- DayDial ----------------
// The day/clock dial (the cut line, graduated): a procedural sun/moon
// ring. Own-raster like ArcGauge (createCanvasTexture is registry-free, so the dial
// costs ZERO atlas entries), redrawn per setTime — a clock repaints rarely, so
// redraw-on-commit needs no ticker. Time is a 0..1 day fraction (0 = midnight,
// 0.5 = noon); the gilded arc marks the day span, and the marker riding the rim is
// NOW — a rayed sun through the day, a crescent moon through the night.

export class DayDial extends UINode {
  // opts: { size = 64, time = 0 }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const D = Number.isFinite(opts.size) ? Math.max(32, Math.round(opts.size)) : 64;
    this._d = D;
    this._art = createCanvasTexture(D, D, texScale());
    this._quad = new QuadNode({ texture: this._art.texture });
    this.add(this._quad);
    this.setSize(D, D);
    this.time = NaN; // NaN seed: {time: 0} must take the full first paint (the sentinel-collision lesson)
    this.setTime(Number.isFinite(opts.time) ? opts.time : 0);
  }

  // t is a 0..1 day fraction and WRAPS (1.35 lands at 0.35). Loud calls commit
  // `change {value}` — the committed-value convention; silent is the mutator default.
  setTime(t, { silent = true } = {}) {
    // normalize into [0, 1) WITHOUT the (+1 % 1) detour for positive t — that dance
    // costs floating-point exactness (0.35 would come back 0.35000000000000009)
    let next = Number.isFinite(t) ? t % 1 : 0;
    if (next < 0) next += 1;
    if (next === this.time) return this;
    this.time = next;
    this._repaint();
    commitChange(this, 'change', { value: next }, silent, null);
    return this;
  }

  _repaint() {
    const { ctx, texture } = this._art;
    const D = this._d, cx = D / 2, cy = D / 2, r = D / 2 - 4;
    ctx.clearRect(0, 0, D, D);
    // the ring, with the day span (t 0.25..0.75) gilded on the upper arc
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.stoneDark;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = COLORS.quest;
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI * 2); ctx.stroke();
    // NOW: midnight sits at the bottom (+90deg), noon at the top; clockwise with time
    const a = Math.PI / 2 + this.time * Math.PI * 2;
    const mx = cx + Math.cos(a) * r, my = cy + Math.sin(a) * r;
    const day = this.time > 0.25 && this.time < 0.75;
    if (day) {
      // the sun: a gilded disc with eight short rays
      ctx.strokeStyle = COLORS.quest;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const ra = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(mx + Math.cos(ra) * 5.5, my + Math.sin(ra) * 5.5);
        ctx.lineTo(mx + Math.cos(ra) * 8, my + Math.sin(ra) * 8);
        ctx.stroke();
      }
      ctx.fillStyle = COLORS.quest;
      ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, Math.PI * 2); ctx.fill();
    } else {
      // the moon: a pale disc bitten by an offset shadow disc (a crescent)
      ctx.fillStyle = COLORS.textBright;
      ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLORS.voidBlack;
      ctx.beginPath(); ctx.arc(mx + 2.5, my - 1, 4.2, 0, Math.PI * 2); ctx.fill();
    }
    texture.needsUpdate = true;
    this.engine?.requestRender();
  }

  onLayout() {
    this._quad.setRect(0, 0, this.w, this.h); // the raster quad fills the dial (the ArcGauge pattern)
  }

  disposeSelf() {
    if (this._art) { this._art.texture.dispose(); this._art = null; }
  }
}

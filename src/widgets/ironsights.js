// The Iron Sights: the shooter kit — twitch-readable combat feedback.
// Reticle: composable center styles (dot | cross | circle | chevron) with four
// spread arms whose offset IS the bloom (`setSpread(px)` moves quads — no
// repaint on the hot path) and a hit/kill flash tint. HitMarker: pooled X
// flashes on the FloatText protocol (fixed pool, steal-the-oldest, combat never
// allocates mid-fight). AmmoCounter: mag/reserve numerals, a reload sweep rail,
// and a low-ammo threshold that commits ONCE per crossing. DamageIndicator: a
// directional arc on an own-raster ring — `hit(bearing)` (0 = ahead, 180 =
// behind maps to the bottom), one active arc (stacking fell per the cut line).
// Killfeed: pooled rich-text rows (`A {icon:weapon} B` through compileMarkup),
// TTL fade, self-highlight, max-N eviction. Every painter is instance-owned
// raster or plain quads: ZERO atlas cost. Events avoid `target` payload fields
// (the event plane owns it — the law).

import { UINode } from '../node.js';
import { QuadNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { createCanvasTexture, texScale } from '../texgen.js';
import { isReducedMotion } from '../animate.js';
import { commitChange, requireEngine, widgetsEngine, uisound, setNodeDisabled } from './widgets.js';

const SHADOW = METRICS.textShadow;
const RETICLE_STYLES = ['cross', 'dot', 'circle', 'chevron'];

// ---------------- Reticle ----------------
// The center art is one instance-owned raster per style; the four arms are bare
// quads so bloom is pure position math. flash('hit'|'kill') tints the whole
// sight briefly (a FEEDBACK hold, deliberately not a motion preset).

export class Reticle extends UINode {
  // opts: { style = 'cross', size = 56, spread = 0, armLength = 11, color }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this.style = RETICLE_STYLES.includes(opts.style) ? opts.style : 'cross';
    const size = Number(opts.size);
    this._size = Number.isFinite(size) ? Math.max(24, Math.round(size)) : 56;
    const spread = Number(opts.spread);
    this.spread = Number.isFinite(spread) ? Math.max(0, spread) : 0;
    const arm = Number(opts.armLength);
    this._armLen = Number.isFinite(arm) ? Math.max(4, Math.round(arm)) : 11;
    this._color = opts.color ?? COLORS.accent;
    this._flashOff = null;

    // the style plate (dot / ring / chevron ink; cross keeps it clear)
    const D = this._size;
    this._art = createCanvasTexture(D, D, texScale());
    this._quad = new QuadNode({ texture: this._art.texture });
    this._quad.auditAllow('overlap'); // arms cross the plate's box by design
    this.add(this._quad);

    // the four arms: N, S, W, E — offset = base gap + spread
    this._arms = [];
    for (let i = 0; i < 4; i++) {
      const a = new QuadNode({ color: this._color });
      a.auditAllow('overlap');
      this._arms.push(a);
      this.add(a);
    }
    this.setSize(D, D);
    this._paint();
    this._placeArms();
  }

  // The bloom hot path: quads move, nothing repaints. NaN keeps the last spread.
  setSpread(px) {
    const v = Number(px);
    if (!Number.isFinite(v)) return this;
    const next = Math.max(0, v);
    if (next === this.spread) return this;
    this.spread = next;
    this._placeArms();
    (this.engine ?? null)?.requestRender();
    return this;
  }

  setStyle(style) {
    if (!RETICLE_STYLES.includes(style) || style === this.style) return this;
    this.style = style;
    this._paint();
    this._placeArms();
    return this;
  }

  // A brief tint hold: 'hit' reads quest-gold, 'kill' reads blood. Deliberately a
  // ticker COUNTDOWN, not a tween preset — feedback survives reducedMotion.
  flash(kind = 'hit') {
    const eng = widgetsEngine();
    if (!eng) return this;
    const tint = kind === 'kill' ? COLORS.negative : COLORS.quest;
    for (const a of this._arms) a.setColor(tint);
    this._quad.setColor(tint);
    this._flashOff?.();
    let t = 0.15;
    this._flashOff = eng.ticker.add((dt) => {
      t -= dt;
      if (t > 0) return;
      this._restoreTint();
    });
    eng.requestRender();
    return this;
  }

  _restoreTint() {
    this._flashOff?.();
    this._flashOff = null;
    for (const a of this._arms) a.setColor(this._color);
    this._quad.setColor(COLORS.textWhite); // untinted — the raster carries its own ink
    (this.engine ?? null)?.requestRender();
  }

  _placeArms() {
    const c = this._size / 2;
    const L = this._armLen, T = 2;
    const gap = 4 + this.spread;
    const horiz = this.style !== 'chevron'; // the chevron keeps side arms only
    // N, S (hidden for chevron — the wings are the vertical read)
    this._arms[0].visible = horiz;
    this._arms[1].visible = horiz;
    this._arms[0].setRect(Math.round(c - T / 2), Math.round(c - gap - L), T, L);
    this._arms[1].setRect(Math.round(c - T / 2), Math.round(c + gap), T, L);
    // W, E
    this._arms[2].setRect(Math.round(c - gap - L), Math.round(c - T / 2), L, T);
    this._arms[3].setRect(Math.round(c + gap), Math.round(c - T / 2), L, T);
  }

  _paint() {
    const { ctx } = this._art;
    const D = this._size, c = D / 2;
    ctx.clearRect(0, 0, D, D);
    ctx.strokeStyle = this._color;
    ctx.fillStyle = this._color;
    ctx.lineWidth = 2;
    if (this.style === 'dot') {
      ctx.beginPath();
      ctx.arc(c, c, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.style === 'circle') {
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(c, c, Math.min(c - 3, 14), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (this.style === 'chevron') {
      ctx.beginPath();
      ctx.moveTo(c - 8, c + 2);
      ctx.lineTo(c, c + 9);
      ctx.lineTo(c + 8, c + 2);
      ctx.stroke();
    }
    this._art.texture.needsUpdate = true;
    (this.engine ?? null)?.requestRender();
  }

  onLayout() {
    this._quad.setRect(0, 0, this._size, this._size);
  }

  disposeSelf() {
    this._flashOff?.();
    this._flashOff = null;
    this._art.texture.dispose();
  }
}

// ---------------- HitMarker ----------------
// The FloatText protocol verbatim: a fixed pool of X stamps sharing ONE raster,
// steal-the-oldest on exhaustion, tween lifetime, reducedMotion = appear at
// rest and fade in place.

export class HitMarker extends UINode {
  // opts: { pool = 8, size = 26 }
  constructor(opts = {}) {
    super({});
    requireEngine();
    this.poolSize = Number.isFinite(opts.pool) ? Math.max(1, Math.floor(opts.pool)) : 8;
    const size = Number(opts.size);
    this._size = Number.isFinite(size) ? Math.max(12, Math.round(size)) : 26;
    // world-juice, not UI copy — the FloatText audit ruling, same reasons
    this.auditAllow('containment', 'overlap');
    const D = this._size;
    this._art = createCanvasTexture(D, D, texScale());
    const { ctx } = this._art;
    ctx.strokeStyle = COLORS.textWhite; // tinted per spawn through the quad color
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const g = 5;
    ctx.beginPath();
    ctx.moveTo(g, g); ctx.lineTo(D / 2 - 3, D / 2 - 3);
    ctx.moveTo(D - g, g); ctx.lineTo(D / 2 + 3, D / 2 - 3);
    ctx.moveTo(g, D - g); ctx.lineTo(D / 2 - 3, D / 2 + 3);
    ctx.moveTo(D - g, D - g); ctx.lineTo(D / 2 + 3, D / 2 + 3);
    ctx.stroke();
    this._art.texture.needsUpdate = true;

    this._pool = [];
    this._live = [];
    for (let i = 0; i < this.poolSize; i++) {
      const q = new QuadNode({ texture: this._art.texture });
      q.setSize(D, D);
      q.visible = false;
      q.interactive = false;
      q.auditAllow('overlap');
      this.add(q);
      this._pool.push(q);
    }
  }

  // (x, y) in this node's local space. A kill marker reads blood and lingers.
  spawn(x, y, { kill = false } = {}) {
    const eng = widgetsEngine();
    if (!eng) return null; // spawn after destroy (the metascreens guard idiom)
    let q = this._pool.pop();
    if (!q) {
      q = this._live.shift(); // steal the oldest — combat never waits
      eng.ticker.cancelTweensOf(q);
    }
    this._live.push(q);
    q.setColor(kill ? COLORS.negative : COLORS.textWhite);
    q.setPos(Math.round((Number.isFinite(x) ? x : 0) - this._size / 2),
      Math.round((Number.isFinite(y) ? y : 0) - this._size / 2));
    q.visible = true;
    q.fxOpacity = 1;
    q.fxScale = isReducedMotion() ? 1 : 1.3;
    const dur = kill ? 0.55 : 0.4;
    if (!isReducedMotion()) eng.ticker.tween(q, { fxScale: 1 }, { dur: 0.12 });
    eng.ticker.tween(q, { fxOpacity: 0 }, {
      dur, delay: 0.08,
      onDone: () => {
        q.visible = false;
        const i = this._live.indexOf(q);
        if (i !== -1) this._live.splice(i, 1);
        this._pool.push(q);
      },
    });
    return q;
  }

  get liveCount() { return this._live.length; }

  disposeSelf() {
    this._art.texture.dispose();
  }
}

// ---------------- AmmoCounter ----------------
// Mag/reserve numerals with a reload sweep rail. `ammochange` narrates every
// model move (no click voice — thirty shots are not thirty buttons); `lowammo`
// commits ONCE per threshold crossing; `reloaded` lands when the sweep does.

export class AmmoCounter extends UINode {
  // opts: { mag = 12, magSize = 12, reserve = 36, warnAt = 0.25, onChange }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const magSize = Number(opts.magSize);
    this.magSize = Number.isFinite(magSize) ? Math.max(1, Math.round(magSize)) : 12;
    const mag = Number(opts.mag);
    this.mag = Number.isFinite(mag) ? Math.min(this.magSize, Math.max(0, Math.round(mag))) : this.magSize;
    const reserve = Number(opts.reserve);
    this.reserve = Number.isFinite(reserve) ? Math.max(0, Math.round(reserve)) : 36;
    const warnAt = Number(opts.warnAt);
    this.warnAt = Number.isFinite(warnAt) && warnAt > 0 && warnAt < 1 ? warnAt : 0.25;
    this.onChange = opts.onChange ?? null;
    this.isReloading = false;
    this._low = false;
    this._sweepOff = null;

    this.magText = new TextNode(String(this.mag), {
      font: FONTS.header, size: 26, weight: 'bold', color: COLORS.bone, shadow: SHADOW,
    });
    this.sepText = new TextNode('/', {
      font: FONTS.header, size: 16, color: COLORS.textMuted, shadow: SHADOW,
    });
    this.reserveText = new TextNode(String(this.reserve), {
      font: FONTS.header, size: 16, color: COLORS.text, shadow: SHADOW,
    });
    // the sweep rail: a thin underline that fills across the reload
    this._rail = new QuadNode({ color: COLORS.accent, opacity: 0 });
    this._rail.auditAllow('containment');
    this.add(this.magText, this.sepText, this.reserveText, this._rail);
    this.setSize(96, 34);
    this._refresh(true);
  }

  _threshold() { return Math.ceil(this.magSize * this.warnAt); }

  // The model verbs. fire() walks toward the threshold; crossing commits ONCE.
  fire(n = 1) {
    if (this.isReloading) return this;
    const shots = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
    if (this.mag <= 0) {
      uisound(this, 'error', { reason: 'dry' }); // the dead trigger clicks
      return this;
    }
    this.mag = Math.max(0, this.mag - shots);
    this._refresh();
    commitChange(this, 'ammochange', { mag: this.mag, reserve: this.reserve, action: 'fire' }, false,
      this.onChange ? (_v, e) => this.onChange(e, e) : null);
    if (!this._low && this.mag <= this._threshold()) {
      this._low = true;
      commitChange(this, 'lowammo', { mag: this.mag, threshold: this._threshold() }, false, null);
    }
    return this;
  }

  setAmmo(mag, reserve, { silent = true } = {}) {
    const m = Number(mag), r = Number(reserve);
    if (Number.isFinite(m)) this.mag = Math.min(this.magSize, Math.max(0, Math.round(m)));
    if (Number.isFinite(r)) this.reserve = Math.max(0, Math.round(r));
    this._low = this.mag <= this._threshold(); // a programmatic set re-arms the crossing
    this._refresh();
    commitChange(this, 'ammochange', { mag: this.mag, reserve: this.reserve, action: 'set' }, silent,
      this.onChange ? (_v, e) => this.onChange(e, e) : null);
    return this;
  }

  // The sweep: a rail fills across `dur`, then the mag tops up from the reserve.
  reload(dur = 1.2) {
    if (this.isReloading) return this;
    const need = this.magSize - this.mag;
    if (need <= 0 || this.reserve <= 0) return this;
    const eng = widgetsEngine();
    if (!eng) return this;
    this.isReloading = true;
    const d = Number.isFinite(dur) ? Math.max(0.05, dur) : 1.2;
    this._rail.setBaseOpacity(0.9);
    const finish = () => {
      this._sweepOff?.();
      this._sweepOff = null;
      // C4 capture-then-callback law: the need is recomputed at LANDING, never
      // carried from the sweep's start — a setAmmo mid-sweep must not overfill
      const take = Math.min(this.magSize - this.mag, this.reserve);
      this.mag += take;
      this.reserve -= take;
      this.isReloading = false;
      this._low = this.mag <= this._threshold();
      this._rail.setBaseOpacity(0);
      this._refresh();
      uisound(this, 'drop', { action: 'reload' }); // the mag seats
      // action: 'reload': the d.ts promises a non-optional action on
      // onChange payloads, and fire/set honored it while this path dropped it
      commitChange(this, 'reloaded', { mag: this.mag, reserve: this.reserve, action: 'reload' },
        false, this.onChange ? (_v, e) => this.onChange(e, e) : null);
    };
    if (isReducedMotion()) { finish(); return this; } // no-motion: the reload just lands
    let t = 0;
    this._sweepOff = eng.ticker.add((dt) => {
      t += dt;
      const p = Math.min(1, t / d);
      this._rail.setRect(0, this.h - 3, Math.round(this.w * p), 3);
      eng.requestRender();
      if (p >= 1) finish();
    });
    return this;
  }

  _refresh(initial = false) {
    this.magText.setText(String(this.mag));
    const low = this.mag <= this._threshold();
    this.magText.setColor(low ? COLORS.negative : COLORS.bone);
    this.reserveText.setText(String(this.reserve));
    if (!initial) this.invalidateLayout();
    (this.engine ?? null)?.requestRender();
  }

  onLayout() {
    this.magText.setPos(0, 0);
    this.sepText.setPos(this.magText.w + 4, 9);
    this.reserveText.setPos(this.magText.w + 4 + this.sepText.w + 4, 8);
    if (!this.isReloading) this._rail.setRect(0, this.h - 3, 0, 3);
  }

  disposeSelf() {
    this._sweepOff?.();
    this._sweepOff = null;
  }
}

// ---------------- DamageIndicator ----------------
// A directional arc on an own-raster ring: `hit(bearing)` lights a 70-degree
// wedge at that bearing (0 = ahead = the top; 180 = behind = the bottom) and
// fades it out. ONE active arc — stacking fell per the cut line.

export class DamageIndicator extends UINode {
  // opts: { radius = 90, thickness = 12, dur = 1.2 }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const radius = Number(opts.radius);
    this.radius = Number.isFinite(radius) ? Math.max(30, Math.round(radius)) : 90;
    const th = Number(opts.thickness);
    this.thickness = Number.isFinite(th) ? Math.max(4, Math.round(th)) : 12;
    const dur = Number(opts.dur);
    this.dur = Number.isFinite(dur) ? Math.max(0.2, dur) : 1.2;
    this.lastBearing = null;
    this._fade = 0;
    this._off = null;
    // a transparent overlay REGION at screen center (the FloatText ruling)
    this.auditAllow('containment', 'overlap');
    const D = (this.radius + 2) * 2;
    this._art = createCanvasTexture(D, D, texScale());
    this._quad = new QuadNode({ texture: this._art.texture });
    this._quad.auditAllow('overlap');
    this.add(this._quad);
    this.setSize(D, D);
  }

  // Bearing in degrees clockwise from AHEAD. NaN reads as 0 (a hit is a hit).
  hit(bearing) {
    const eng = widgetsEngine();
    if (!eng) return this;
    const b = Number(bearing);
    this.lastBearing = Number.isFinite(b) ? ((b % 360) + 360) % 360 : 0;
    this._fade = 1;
    this._paint();
    this._off?.();
    if (isReducedMotion()) {
      // no-motion: the wedge holds at full, then clears when its time is up
      let t = this.dur;
      this._off = eng.ticker.add((dt) => {
        t -= dt;
        if (t > 0) return;
        this._clear();
      });
    } else {
      this._off = eng.ticker.add((dt) => {
        this._fade -= dt / this.dur;
        if (this._fade <= 0) { this._clear(); return; }
        this._paint();
      });
    }
    return this;
  }

  _clear() {
    this._off?.();
    this._off = null;
    this._fade = 0;
    const { ctx } = this._art;
    const D = (this.radius + 2) * 2;
    ctx.clearRect(0, 0, D, D);
    this._art.texture.needsUpdate = true;
    (this.engine ?? null)?.requestRender();
  }

  _paint() {
    const { ctx } = this._art;
    const D = (this.radius + 2) * 2, c = D / 2;
    const span = (70 * Math.PI) / 180;
    // canvas 0 rad = east; bearing 0 = up — rotate back a quarter turn
    const mid = ((this.lastBearing - 90) * Math.PI) / 180;
    ctx.clearRect(0, 0, D, D);
    ctx.globalAlpha = Math.max(0, Math.min(1, this._fade)) * 0.85;
    ctx.strokeStyle = COLORS.negative;
    ctx.lineWidth = this.thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, this.radius - this.thickness / 2, mid - span / 2, mid + span / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this._art.texture.needsUpdate = true;
    (this.engine ?? null)?.requestRender();
  }

  onLayout() {
    this._quad.setRect(0, 0, this.w, this.h);
  }

  disposeSelf() {
    this._off?.();
    this._off = null;
    this._art.texture.dispose();
  }
}

// ---------------- Killfeed ----------------
// Pooled rich-text rows, newest on top: `push({killer, weapon, victim, self})`
// compiles `killer {icon:weapon} victim`, holds each row for its TTL, fades it
// back to the pool, and evicts the oldest past maxRows. Self rows wear the
// accent film.

export class Killfeed extends UINode {
  // opts: { maxRows = 6, ttl = 6, width = 280, rowHeight = 22 }
  constructor(opts = {}) {
    super({});
    requireEngine();
    const maxRows = Number(opts.maxRows);
    this.maxRows = Number.isFinite(maxRows) ? Math.max(1, Math.round(maxRows)) : 6;
    const ttl = Number(opts.ttl);
    this.ttl = Number.isFinite(ttl) ? Math.max(0.5, ttl) : 6;
    const width = Number(opts.width);
    this._rowW = Number.isFinite(width) ? Math.max(140, Math.round(width)) : 280;
    const rh = Number(opts.rowHeight);
    this._rowH = Number.isFinite(rh) ? Math.max(16, Math.round(rh)) : 22;
    this.auditAllow('containment', 'overlap'); // a transparent feed REGION
    this._pool = [];
    this._live = []; // newest first
    for (let i = 0; i < this.maxRows; i++) {
      const row = new UINode();
      row.bg = new QuadNode({ color: COLORS.voidBlack, opacity: 0.6 });
      row.text = new TextNode('', { size: 12, color: COLORS.text, shadow: SHADOW });
      row.text.auditAllow('overlap'); // the line rides its film
      row.add(row.bg, row.text);
      row.setSize(this._rowW, this._rowH);
      row.bg.setRect(0, 0, this._rowW, this._rowH);
      row.visible = false;
      row._ttlOff = null;
      this.add(row);
      this._pool.push(row);
    }
    this.setSize(this._rowW, this.maxRows * (this._rowH + 4) - 4);
  }

  push({ killer = '?', weapon = 'arrows', victim = '?', self = false } = {}) {
    const eng = widgetsEngine();
    if (!eng) return null;
    let row = this._pool.pop();
    if (!row) row = this._retire(this._live[this._live.length - 1], true); // evict the oldest
    this._live.unshift(row);
    row._ttlOff?.();
    eng.ticker.cancelTweensOf(row);
    const name = (s) => ({ text: String(s), color: self ? COLORS.accent : COLORS.bone });
    row.text.setSegments([
      name(killer),
      { text: ' ' },
      { icon: String(weapon) },
      { text: ' ' },
      name(victim),
    ]);
    row.bg.setColor(self ? COLORS.accent : COLORS.voidBlack);
    row.bg.setBaseOpacity(self ? 0.22 : 0.6);
    row.text.setPos(8, Math.round((this._rowH - row.text.h) / 2));
    row.visible = true;
    row.fxOpacity = 1;
    let t = this.ttl;
    row._ttlOff = eng.ticker.add((dt) => {
      t -= dt;
      if (t > 0) return;
      row._ttlOff?.();
      row._ttlOff = null;
      eng.ticker.tween(row, { fxOpacity: 0 }, {
        dur: 0.4,
        onDone: () => { this._retire(row); this._restack(); },
      });
    });
    this._restack();
    return row;
  }

  // Pulls a row out of the live list and back to the pool. With `keep` the row is
  // returned for immediate reuse instead of pooling (the eviction path).
  _retire(row, keep = false) {
    if (!row) return null;
    const i = this._live.indexOf(row);
    if (i !== -1) this._live.splice(i, 1);
    row._ttlOff?.();
    row._ttlOff = null;
    widgetsEngine()?.ticker.cancelTweensOf(row);
    row.visible = false;
    row.fxOpacity = 1;
    if (!keep) this._pool.push(row);
    return row;
  }

  _restack() {
    this._live.forEach((row, i) => {
      row.setPos(0, i * (this._rowH + 4));
    });
    (this.engine ?? null)?.requestRender();
  }

  get liveCount() { return this._live.length; }

  setDisabled(v) { setNodeDisabled(this, v); }
}

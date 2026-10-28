// Central ticker + tween system. One rAF owner drives tweens, per-frame hooks, and the render loop.

export const Easing = {
  linear: t => t,
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutQuad: t => 1 - (1 - t) * (1 - t),
  // Matches CSS `ease` closely enough for UI purposes.
  ease: t => 1 - Math.pow(1 - t, 2.2),
};

let _tweenId = 1;

export class Ticker {
  constructor() {
    this.callbacks = new Set();
    this.tweens = new Map();     // id -> tween record
    this.byTarget = new Map();   // target -> Map(prop -> id), for last-wins preemption
    this.running = false;
    this.time = 0;
    this._last = 0;
    this._raf = 0;
    this._interval = 0;
    this._frame = null;          // engine frame fn, runs after tweens/callbacks
    this.timerDriven = false;    // setInterval instead of rAF (headless test environments)
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      this.time += dt;
      this._stepTweens(dt);
      // Contained INDIVIDUALLY (3.2.x, the X16 seam missed): a throwing
      // ticker consumer used to take every LATER consumer and the frame hook down with
      // it, every frame — the finally re-arm kept the ticker alive but not its riders.
      for (const cb of [...this.callbacks]) {
        try { cb(dt, this.time); } catch (err) { this._warnConsumer(cb, err); }
      }
      if (this._frame) {
        try { this._frame(dt, this.time); } catch (err) { this._warnConsumer(this._frame, err); }
      }
    };
    if (this.timerDriven) {
      this._interval = setInterval(() => tick(performance.now()), 16);
    } else {
      const loop = (now) => {
        if (!this.running) return;
        // re-arm in FINALLY: a throw anywhere in the tick must cost one frame, never
        // the whole ticker — the setInterval driver is naturally immune, and the rAF
        // driver (production) must match it (X16: the permanent-freeze class)
        try { tick(now); } finally { this._raf = requestAnimationFrame(loop); }
      };
      this._raf = requestAnimationFrame(loop);
    }
  }

  // stop() deliberately does NOT clear the tween maps: the audit/torture/settle harnesses
  // call stop() and THEN settleTweens() to land in-flight boot tweens for a stable
  // snapshot — clearing here would strand them mid-flight.
  // The bare-start-after-bare-stop stale-tween risk (C13 nit) is already covered by
  // engine.dispose clearing tweens/byTarget/callbacks (C12); teardown is dispose-then-stop.
  stop() { this.running = false; cancelAnimationFrame(this._raf); clearInterval(this._interval); }
  add(cb) { this.callbacks.add(cb); return () => this.callbacks.delete(cb); }
  _warnConsumer(fn, err) {
    // once per consumer PER MESSAGE: the old WeakSet keyed on the
    // function alone, so a consumer's first throw permanently muted every
    // DIFFERENT later failure — including new bugs in the engine's own frame
    // hook, which routes through here too. Same containment, honest voice.
    if (!this._warnedConsumers) this._warnedConsumers = new WeakMap();
    let seen = this._warnedConsumers.get(fn);
    if (!seen) { seen = new Set(); this._warnedConsumers.set(fn, seen); }
    const key = String(err?.message ?? err).slice(0, 200);
    if (seen.has(key)) return;
    seen.add(key);
    console.warn('LovecraftUI: ticker consumer threw (contained, warned once per message):', err);
  }
  setFrame(fn) { this._frame = fn; }

  // Tween plain numeric properties on any object. Last tween on the same (target, prop) wins.
  tween(target, props, { dur = 0.3, ease = Easing.ease, onUpdate = null, onDone = null, delay = 0 } = {}) {
    const id = _tweenId++;
    let perTarget = this.byTarget.get(target);
    if (!perTarget) { perTarget = new Map(); this.byTarget.set(target, perTarget); }
    const from = {};
    for (const k of Object.keys(props)) {
      const prevId = perTarget.get(k);
      perTarget.set(k, id);
      from[k] = null; // captured on first step (after delay), so chained tweens read live values
      if (prevId === undefined) continue;
      // Preempt per property: the prior tween keeps animating any props it still owns
      // (the step loop skips non-owned props); drop it only once it owns nothing.
      const prev = this.tweens.get(prevId);
      if (prev && !Object.keys(prev.props).some(p => perTarget.get(p) === prevId)) {
        this.tweens.delete(prevId);
      }
    }
    this.tweens.set(id, { target, props, from, dur, ease, onUpdate, onDone, t: -delay, perTarget });
    return id;
  }

  cancelTween(id) {
    const tw = this.tweens.get(id);
    if (!tw) return;
    for (const k of Object.keys(tw.props)) if (tw.perTarget.get(k) === id) tw.perTarget.delete(k);
    if (tw.perTarget.size === 0) this.byTarget.delete(tw.target); // don't retain finished targets
    this.tweens.delete(id);
  }

  cancelTweensOf(target) {
    const perTarget = this.byTarget.get(target);
    if (!perTarget) return;
    for (const id of new Set(perTarget.values())) this.tweens.delete(id);
    this.byTarget.delete(target);
  }

  // Cancel the live tween on ONE (target, prop) pair, if any. A deliberate cancel is
  // not a completion — no onDone fires. This is the surgical form: cancelTweensOf
  // would also kill unrelated tweens riding the same node (an animate preset's, whose
 // promise must always settle — the law).
  cancelPropTween(target, prop) {
    const perTarget = this.byTarget.get(target);
    const id = perTarget?.get(prop);
    if (id == null) return false;
    this.cancelTween(id);
    return true;
  }

  _stepTweens(dt) {
    if (this.tweens.size === 0) return;
    const done = [];
    for (const [id, tw] of this.tweens) {
      tw.t += dt;
      if (tw.t < 0) continue; // still inside its delay window: no write, no render wake
      if (tw.from[Object.keys(tw.props)[0]] === null) {
        for (const k of Object.keys(tw.props)) tw.from[k] = tw.target[k] ?? 0;
      }
      const p = tw.dur <= 0 ? 1 : Math.min(1, tw.t / tw.dur);
      const e = tw.ease(p);
      for (const k of Object.keys(tw.props)) {
        if (tw.perTarget.get(k) !== id) continue; // preempted on this prop
        tw.target[k] = tw.from[k] + (tw.props[k] - tw.from[k]) * e;
        // Consumed by the engine's render gate: a tween's FINAL write happens in the
        // same tick its record is deleted, so gating on live `tweens.size` would drop
        // the last frame of every animation. Set on real WRITES (and onUpdate below),
        // never during delay windows — a delayed tween must not defeat the idle gate.
        this.tweensStepped = true;
      }
      if (tw.onUpdate) {
        // consumer callback: contain a throw (once per tween) so the other tweens
        // this frame still step; stepped is set regardless — the write happened
        try { tw.onUpdate(e); } catch (err) {
          if (!tw._updWarned) { tw._updWarned = true; console.warn('LovecraftUI: a tween onUpdate threw; continuing.', err); }
        }
        this.tweensStepped = true;
      }
      if (p >= 1) done.push([id, tw]);
    }
    for (const [id, tw] of done) {
      // the record is captured, not re-fetched: an onDone earlier in this loop may
      // have started a preempting tween that already deleted this id — the finished
      // tween's own onDone must still fire (it legitimately reached p >= 1)
      this.cancelTween(id);
      if (tw.onDone) {
        // a throwing consumer onDone must not rob the OTHER finished tweens this frame
        // of theirs (X16; reachable via e.g. a bad EldToast spec resolving a slot)
        try { tw.onDone(); } catch (err) { console.warn('LovecraftUI: a tween onDone threw; continuing.', err); }
      }
    }
  }
}

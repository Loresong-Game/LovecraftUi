// FloatText: pooled combat floaters. Add one system node where the numbers should
// live (a HUD layer, over a target frame), then `spawn(text, x, y, {crit, color})` —
// the floater rises and fades on the house tween and its node returns to the pool.
// Pool exhaustion steals the oldest live floater (combat never allocates mid-fight);
// the pool pattern is the one the HitMarkers reuse.

import { UINode } from '../node.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS } from '../theme.js';
import { widgetsEngine } from './widgets.js';
import { isReducedMotion } from '../animate.js';

const RISE = 44;

export class FloatText extends UINode {
  constructor(opts = {}) {
    super({});
    // finite-first (Math.max launders NaN): an empty pool would make spawn() throw
    this.poolSize = Number.isFinite(opts.pool) ? Math.max(1, Math.floor(opts.pool)) : 16;
    this._pool = [];
    this._live = [];
    // world-juice, not UI copy: floaters fly over arbitrary game art in
    // game-chosen colors and overlap each other freely mid-flight — the audit's
    // contrast/overlap rules were never their law, and a spawn alive at the audit's
    // settle instant made page counts nondeterministic (the declared-allowance route,
 // per the window-header precedent; declarations stay counted and rationed)
    this.auditAllow('containment', 'overlap'); // a transparent spawn REGION, not a panel
    for (let i = 0; i < this.poolSize; i++) {
      const t = new TextNode('', {
        font: FONTS.header, size: 14, weight: 'bold', color: COLORS.negative,
        shadow: { color: 'rgba(0,0,0,0.9)', dx: 1, dy: 1, blur: 2 },
      });
      t.visible = false;
      t.interactive = false;
      t.auditAllow('overlap', 'contrast');
      this.add(t);
      this._pool.push(t);
    }
  }

  // text at (x, y) in THIS node's local space. crit pops larger and lingers.
  spawn(text, x, y, { crit = false, color } = {}) {
    const eng = widgetsEngine();
    if (!eng) return; // spawn after destroy: no ticker to animate, no scene to render (the metascreens guard idiom)
    let t = this._pool.pop();
    if (!t) {
      t = this._live.shift(); // steal the oldest — combat never waits for a floater
      eng.ticker.cancelTweensOf(t);
    }
    this._live.push(t);
    t.style.size = crit ? 21 : 14;
    t.setColor(color ?? COLORS.negative);
    const s = t._text;
    t._text = null;         // force re-raster at the (possibly changed) size
    t.setText(String(text));
    void s;
    t.setPos(Math.round(x - t.w / 2), Math.round(y));
    t.visible = true;
    t.fxOpacity = 1;
    t.fxScale = crit ? 1.35 : 1;
    const dur = crit ? 1.2 : 0.9;
    if (isReducedMotion()) {
      // no-motion contract: the floater appears at rest and
      // fades in place — no crit pop, no rise; the fade below still recycles the pool
      t.fxScale = 1;
    } else {
      if (crit) eng.ticker.tween(t, { fxScale: 1 }, { dur: 0.18 });
      eng.ticker.tween(t, { y: y - RISE }, { dur, ease: (v) => 1 - Math.pow(1 - v, 2.2) });
    }
    eng.ticker.tween(t, { fxOpacity: 0 }, {
      dur, delay: dur * 0.35,
      onDone: () => {
        t.visible = false;
        const i = this._live.indexOf(t);
        if (i !== -1) this._live.splice(i, 1);
        this._pool.push(t);
      },
    });
    return t;
  }

  get liveCount() { return this._live.length; }
}

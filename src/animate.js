// Animation presets: the four house transitions, promise-returning, with a
// reduced-motion gate. animateIn shows a node with grace; animateOut hides it and
// leaves it CLEAN (visible=false, fx transform restored, fxOpacity back at 1 —
// a later plain `visible = true` just works). Every promise settles no matter what:
// a superseding animate* call snaps the previous one to its end state and resolves
// it, and a mid-flight dispose resolves through the node's own dispose event (the
// ticker's per-prop preemption and dispose-cancel both swallow onDone — never trust
// onDone alone; the LoadingVeil lesson).
//
// Presets are RENDER-ONLY: translation rides fxOffsetX/fxOffsetY (folded in
// at paint — the tremor primitive), never layout x/y. Layout position is the
// caller's alone, so `create → animateIn → setRect(center)` in any order can never
// be clobbered by a completing flight (the meta-screens 0,0-jump class), and nodes
// whose onLayout re-pins x/y every pass (menus, banners, title cards) now show
// their slides instead of silently fighting them. Hits land at the final rect
// while the art slides — the SanityFX tradeoff.
//
// Presets enter ALONG their vector and exit CONTINUING it: 'rise' comes up from
// below and leaves upward, 'fall' the inverse, 'stoneSlide' enters from the left
// and exits rightward, 'fadeScale' breathes through 0.92 (the popup-panel idiom).
// Consumer note: presets own fxOpacity and fxOffsetX/Y for their flight — reapply
// custom dim cues after the promise lands.

const PRESETS = {
  rise: { dx: 0, dy: 12, scale: 1 },
  fall: { dx: 0, dy: -12, scale: 1 },
  fadeScale: { dx: 0, dy: 0, scale: 0.92 },
  stoneSlide: { dx: -16, dy: 0, scale: 1 },
};
const DUR = 0.2; // the house state-transition tempo (STYLE §9)

let _reducedMotion = false;
export function setReducedMotion(v) { _reducedMotion = v === true; }
export function isReducedMotion() { return _reducedMotion; }

function presetOf(name) {
  const p = PRESETS[name];
  if (p) return p;
  console.warn(`LovecraftUI animate: unknown preset '${name}' (rise|fall|fadeScale|stoneSlide); using fadeScale.`);
  return PRESETS.fadeScale;
}

// One pending record per node. A new call settles (snaps + resolves) the old one.
function settlePending(node) {
  const a = node.__anim;
  if (!a) return;
  node.__anim = null;
  const eng = node.engine ?? node._lastEngine;
  if (eng) for (const id of a.ids) eng.ticker.cancelTween(id);
  if (!node.disposed) a.applyEnd();
  a.resolve();
}

function wireDispose(node) {
  if (node.__animDisposeWired) return;
  node.__animDisposeWired = true;
  node.on('dispose', () => {
    const a = node.__anim;
    if (!a) return;
    node.__anim = null; // no state writes on a dying node — just settle the promise
    a.resolve();
  });
}

// callers settle the previous animation BEFORE capturing their base — settling snaps
// the node to the prior end state, so a superseder never records mid-flight values
function run(node, endState, fromState, tweenProps, dur, delay) {
  wireDispose(node);
  const eng = node.engine;
  if (_reducedMotion || !eng) {
    // the test suite: presets collapse to instant (detached nodes do too, by contract)
    endState();
    return Promise.resolve();
  }
  fromState();
  return new Promise((resolve) => {
    const anim = { ids: [], applyEnd: endState, resolve };
    node.__anim = anim;
    const opts = { dur, delay, onDone: () => settlePending(node) };
    const keys = Object.keys(tweenProps);
    // one shared onDone rides the LAST prop's tween; every prop shares dur+delay,
    // so they land together and settlePending snaps the exact end state once
    keys.forEach((k, i) => {
      anim.ids.push(eng.ticker.tween(node, { [k]: tweenProps[k] },
        i === keys.length - 1 ? opts : { dur, delay }));
    });
    node.invalidatePaint();
  });
}

// Show `node` with grace. Returns a promise that always settles; end state:
// visible=true, fx offsets zeroed, fxScale at base, fxOpacity 1. Layout x/y are
// never read or written — position the node whenever you like, before or after.
export function animateIn(node, preset = 'fadeScale', { dur = DUR, delay = 0 } = {}) {
  const p = presetOf(preset);
  settlePending(node); // snap any in-flight preset FIRST: base must be the true rest state
  const base = { scale: node.fxScale ?? 1 };
  const endState = () => {
    node.visible = true;
    node.fxOffsetX = 0; node.fxOffsetY = 0;
    node.fxScale = base.scale;
    node.fxOpacity = 1;
    node.invalidateLayout();
  };
  const fromState = () => {
    node.visible = true;
    node.fxOffsetX = p.dx; node.fxOffsetY = p.dy;
    if (p.scale !== 1) node.fxScale = base.scale * p.scale;
    node.fxOpacity = 0;
    node.invalidateLayout();
  };
  const props = { fxOpacity: 1 };
  if (p.dx) props.fxOffsetX = 0;
  if (p.dy) props.fxOffsetY = 0;
  if (p.scale !== 1) props.fxScale = base.scale;
  return run(node, endState, fromState, props, dur, delay);
}

// Hide `node` with grace, continuing its preset vector. End state: visible=false,
// fx offsets zeroed, fxScale at base, fxOpacity restored to 1 (show-ready).
export function animateOut(node, preset = 'fadeScale', { dur = DUR, delay = 0 } = {}) {
  const p = presetOf(preset);
  settlePending(node); // snap any in-flight preset FIRST: base must be the true rest state
  const base = { scale: node.fxScale ?? 1 };
  const endState = () => {
    node.visible = false;
    node.fxOffsetX = 0; node.fxOffsetY = 0;
    node.fxScale = base.scale;
    node.fxOpacity = 1;
    node.invalidateLayout();
  };
  const fromState = () => {}; // it exits from wherever it rests
  const props = { fxOpacity: 0 };
  if (p.dx) props.fxOffsetX = -p.dx;
  if (p.dy) props.fxOffsetY = -p.dy;
  if (p.scale !== 1) props.fxScale = base.scale * p.scale;
  return run(node, endState, fromState, props, dur, delay);
}

// Enter a group one after another. Later nodes hold their from-state through their
// delay window (delayed tweens write nothing), so the row builds left to right.
export function stagger(nodes, preset = 'rise', { gap = 0.06, dur = DUR } = {}) {
  const list = [...nodes];
  return Promise.all(list.map((n, i) => animateIn(n, preset, { dur, delay: i * gap })));
}

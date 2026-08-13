// LoadingVeil: the boot/loading splash (the cut, absorbed in) — a
// full-screen abyss scrim with a liquid-orb centerpiece whose FILL rides the
// progress, a stone progress bar, and a flavor line. The veil glues itself to the
// engine size; add it to a top layer (engine.layers.overlay), drive setValue(pct)
// and setFlavor(text) while loading, then fadeOut() (which disposes when the fade
// lands) or dispose() directly.

import { UINode } from '../node.js';
import { QuadNode, Accent3DNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS } from '../theme.js';
import { ProgressBar, requireEngine } from './widgets.js';
import { makeOrbMesh } from '../fx.js';
import { str } from '../strings.js';

export class LoadingVeil extends UINode {
  // opts: { title = 'Loading', flavor = '', value = 0 }
  constructor(opts = {}) {
    super({ interactive: true }); // a scrim role: input beneath the veil is swallowed
    this.radialItems = () => false; // the splash offers no wheel — the radial chain stops at the veil
    requireEngine(); // friendly pre-init message before any child constructs
    this.scrim = new QuadNode({ color: COLORS.voidBlack, opacity: 0.92 });
    // The orb wears the sanity void-purple; its liquid level IS the progress.
    this.orb = makeOrbMesh(44, COLORS.manaBot, COLORS.manaTop);
    this.accent = new Accent3DNode({});
    this.accent.content.add(this.orb.mesh);
    this.orb.mesh.position.set(44, -44, 0);
    this.orb.mesh.scale.z = 0.5; // stay within the accent z-slab (the Globe idiom)
    this.accent.setSize(88, 88);
    this.titleText = new TextNode(opts.title ?? str('veilTitle'), {
      font: FONTS.header, size: 15, smallCaps: true, letterSpacing: 2, color: COLORS.bone,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    this.bar = new ProgressBar({ value: opts.value ?? 0, width: 320, height: 18 });
    this.flavorText = new TextNode(opts.flavor ?? '', {
      size: 13, color: COLORS.textMuted,
      shadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
    });
    this.add(this.scrim, this.accent, this.titleText, this.bar, this.flavorText);
    this.value = this.bar.value;
    this.orb.setFill(this.value / 100);
    // The liquid lives: drive the orb shader clock (the Globe idiom; the render wake
    // it costs is the point of a loading screen).
    this.setFrameHook((dt, t) => this.orb.tick(t));
    // A scrim consumes the wheel too — without this the HOST PAGE scrolls behind the
    // splash (the popup-scrim precedent).
    this.on('wheel', (e) => e.stopPropagation());
  }

  // The uniform value contract, delegated: the bar tweens, the orb level follows.
  setValue(pct, opts) {
    this.bar.setValue(pct, opts);
    this.value = this.bar.value;
    this.orb.setFill(this.value / 100);
  }

  setFlavor(text) {
    this.flavorText.setText(text ?? '');
    this.invalidateLayout();
  }

  // Fade the whole veil and dispose when the fade lands. Resolves after disposal.
  // Single-flight: a repeat call returns the SAME promise (a second tween on the same
  // property would preempt the first and swallow its onDone — the promise would hang),
  // and disposal settles a pending promise however it arrives (dispose() mid-fade,
  // Eldritch.destroy() clearing the ticker) — every caller's await always lands.
  fadeOut() {
    if (this._fadePromise) return this._fadePromise;
    const eng = this.engine;
    if (!eng) { this.dispose(); return Promise.resolve(); }
    this._fadePromise = new Promise((resolve) => {
      this._fadeResolve = resolve;
      eng.ticker.tween(this, { fxOpacity: 0 }, {
        dur: 0.4,
        onDone: () => this.dispose(), // disposeSelf settles the promise
      });
    });
    return this._fadePromise;
  }

  onLayout() {
    // Glue to the engine (the boot-taskbar idiom: assign, don't setSize, mid-layout).
    if (this.engine) { this.w = this.engine.width; this.h = this.engine.height; }
    this.scrim.setRect(0, 0, this.w, this.h);
    const cx = Math.round(this.w / 2);
    const cy = Math.round(this.h / 2);
    this.accent.setPos(cx - 44, cy - 150);
    this.titleText.setPos(Math.round(cx - this.titleText.w / 2), cy - 44);
    this.bar.setPos(cx - 160, cy - 14);
    this.flavorText.setPos(Math.round(cx - this.flavorText.w / 2), cy + 16);
  }

  disposeSelf() {
    this.orb.dispose(); // the shader material is ours, not a child's
    // settle a pending fadeOut() promise no matter how disposal arrived
    if (this._fadeResolve) { const r = this._fadeResolve; this._fadeResolve = null; r(); }
  }
}

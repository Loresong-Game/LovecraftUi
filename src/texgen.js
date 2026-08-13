// Texture factory/registry. All UI art is generated once at init on 2x-CSS-size canvases,
// with uniform settings (sRGB, LinearFilter, mipmaps OFF) so authored colors land on screen exactly.

import * as THREE from 'three';

// Deterministic RNG (mulberry32) so the stonework is identical every load.
// Every art painter routes through here, so one theme-level offset re-cuts all of it.
let _seedOffset = 0;
export function setSeedOffset(n) { _seedOffset = n | 0; }

export function seededRandom(seed) {
  let a = (seed + _seedOffset) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TEX_SCALE = 2; // the authored default: 2x CSS size (covers DPR 1-2 at uiScale 1)

// the LIVE bake density — DPR × uiScale (capped) so procedural art stays
// crisp at TV distance. Set by the entry BEFORE the bake, reset on destroy; every
// make() call reads it, so a re-init re-cuts the whole atlas at the new density.
let _bakeScale = TEX_SCALE;
export function setTexScale(v) {
  _bakeScale = Number.isFinite(v) && v > 0 ? Math.min(4, v) : TEX_SCALE;
}
export function texScale() { return _bakeScale; }

// Instance-owned dynamic canvas texture — the one sanctioned way a widget gets a 2D
// canvas it redraws at runtime (document.createElement stays confined to this file).
// Unlike make(), nothing is retained in the registry: the CALLER owns the triple —
// draw via ctx (pre-scaled, so draw in CSS units), set texture.needsUpdate = true and
// engine.requestRender() after each redraw, and texture.dispose() in disposeSelf (the
// TextNode ownership model). Settings copy make() so dynamic pixels match baked art.
// Consumers: the talent grid's arrow underlays, the run map, the wheel, charts.
export function createCanvasTexture(wCss, hCss, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(wCss * scale));
  canvas.height = Math.max(2, Math.round(hCss * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 1;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.userData = { cssW: wCss, cssH: hCss, dynamic: true };
  return { canvas, ctx, texture, scale };
}

export class TextureRegistry {
  constructor() {
    this.textures = new Map(); // name -> THREE.CanvasTexture
    this.frames = new Map();   // name -> {tex, t, r, b, l, cssW, cssH}
    this.canvases = new Map(); // name -> canvas (retained for context restore + debug atlas)
    this.cursors = new Map();  // name -> css cursor string
  }

  make(name, wCss, hCss, drawFn, opts = {}) {
    const wantSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    const pxW = Math.max(2, Math.round(wCss * _bakeScale));
    const pxH = Math.max(2, Math.round(hCss * _bakeScale));
    // Re-baking an existing name at the SAME size redraws IN PLACE and keeps the
    // texture OBJECT, so every quad already holding it shows the new art. The old
    // mint-and-dispose path handed live quads a disposed handle: three re-uploads
    // from the retained canvas, so the consumer silently froze on the previous
    // bake. That is the runtime registerIcon path (custom-icons.html, and the
 // pack re-skin), which is exactly when a live quad is most likely.
    const prev = this.textures.get(name);
    const prevCanvas = this.canvases.get(name);
    if (prev && prevCanvas && prevCanvas.width === pxW && prevCanvas.height === pxH
        && prev.colorSpace === wantSpace) {
      const rctx = prevCanvas.getContext('2d');
      rctx.setTransform(1, 0, 0, 1, 0, 0);
      rctx.clearRect(0, 0, pxW, pxH);
      rctx.scale(_bakeScale, _bakeScale);
      drawFn(rctx, wCss, hCss);
      prev.needsUpdate = true;
      prev.userData = { cssW: wCss, cssH: hCss, name };
      return prev;
    }
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    ctx.scale(_bakeScale, _bakeScale);
    drawFn(ctx, wCss, hCss);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 1;
    tex.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.userData = { cssW: wCss, cssH: hCss, name };
    // The fallback path (a size or colour-space change, so the canvas above could
    // not be reused): the texture it replaces must be freed — once dropped from
    // the map, dispose() can never reach it. Consumers holding the old handle are
    // re-created by the caller in this case (a density re-bake rebuilds the tree).
    this.textures.get(name)?.dispose();
    this.textures.set(name, tex);
    this.canvases.set(name, canvas);
    return tex;
  }

  // A 9-slice frame: slice insets given in CSS px.
  makeFrame(name, wCss, hCss, slice, drawFn) {
    const tex = this.make(name, wCss, hCss, drawFn);
    const t = typeof slice === 'number' ? { t: slice, r: slice, b: slice, l: slice } : slice;
    const frame = { tex, t: t.t, r: t.r, b: t.b, l: t.l, cssW: wCss, cssH: hCss };
    this.frames.set(name, frame);
    return frame;
  }

  // Register an alias frame that shares slice metrics with `name` but uses another texture.
  aliasFrame(name, baseName, tex) {
    const base = this.frames.get(baseName);
    const frame = { ...base, tex };
    this.frames.set(name, frame);
    return frame;
  }

  get(name) {
    const t = this.textures.get(name);
    if (t) return t;
    return this._unknown(name);
  }

  frame(name) {
    const f = this.frames.get(name);
    if (f) return f;
    this._unknown(name);
    if (!this._unknownFrame) {
      this._unknownFrame = { tex: this.textures.get('__unknown'), t: 8, r: 8, b: 8, l: 8, cssW: 48, cssH: 48 };
    }
    return this._unknownFrame;
  }

  // Unknown names render a loud fallback plate instead of throwing (one console.warn per
  // name, with the nearest registered names). A typo'd texture id stays visible and
  // debuggable rather than killing the page at construction.
  //
  // an unknown `icon.*` name bakes its OWN pending plate instead of
  // sharing the one __unknown texture. The procedural ability painters were
  // retired and the REAL art streams in from the icon pack — a per-name
  // canvas keeps the icon NAMESPACE followable: the pack's loadIcons re-bakes
  // that canvas IN PLACE, so every live quad already holding the name shows
  // the painted art the moment it lands (the mint path stranded them on the
  // shared plate forever — plates everywhere, even online).
  _unknown(name) {
    if (name.startsWith('icon.')) {
      // 64 = the registerIcon author size: the pack's re-bake must land IN
      // PLACE (a size change re-mints and strands every live quad on the plate)
      this.make(name, 64, 64, (ctx, w, h) => {
        ctx.fillStyle = '#141a17';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(106,124,110,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, w - 4, h - 4);
        ctx.strokeStyle = 'rgba(106,124,110,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.round(w * 0.23), 0, Math.PI * 2);
        ctx.stroke();
      });
      return this.textures.get(name);
    }
    return this._unknownPlate(name);
  }

  _unknownPlate(name) {
    if (!this.textures.has('__unknown')) {
      this.make('__unknown', 48, 48, (ctx, w, h) => {
        ctx.fillStyle = '#3a1f3a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#ff5ad1';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, w - 4, h - 4);
        ctx.fillStyle = '#ff5ad1';
        ctx.font = 'bold 26px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', w / 2, h / 2 + 1);
      });
    }
    if (!this._warned) this._warned = new Set();
    if (!this._warned.has(name)) {
      this._warned.add(name);
      const near = this._nearest(name, 3);
      console.warn(`LovecraftUI: unknown texture "${name}" - using the fallback plate.` +
        (near.length ? ` Nearest registered names: ${near.join(', ')}` : ''));
    }
    return this.textures.get('__unknown');
  }

  _nearest(name, k) {
    const stem = name.split('.')[0];
    const score = (cand) => {
      let i = 0;
      while (i < name.length && i < cand.length && name[i] === cand[i]) i++;
      return i * 2 + (cand.startsWith(stem) ? 2 : 0) - Math.abs(cand.length - name.length) * 0.25;
    };
    return [...new Set([...this.textures.keys(), ...this.frames.keys()])]
      .filter(n => n !== '__unknown')
      .map(c => [score(c), c])
      .sort((a, b) => b[0] - a[0])
      .slice(0, k)
      .map(x => x[1]);
  }

  has(name) { return this.textures.has(name) || this.frames.has(name); }

  // CSS cursor from a 1x canvas (browsers cap cursor sizes ~32px; keep w/h <= 32).
  makeCursor(name, w, h, hotX, hotY, drawFn) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    drawFn(canvas.getContext('2d'), w, h);
    const url = canvas.toDataURL('image/png');
    const cursor = `url(${url}) ${hotX} ${hotY}, auto`;
    this.cursors.set(name, cursor);
    return cursor;
  }

  cursor(name) { return this.cursors.get(name) ?? 'default'; }

  get count() { return this.textures.size; }

  // Re-upload every texture from its retained canvas (WebGL context restore).
  refreshAll() {
    for (const tex of this.textures.values()) tex.needsUpdate = true;
  }

  // Free all GPU textures and drop the backing canvases. Registry is empty afterwards.
  dispose() {
    for (const tex of this.textures.values()) tex.dispose();
    this.textures.clear();
    this.frames.clear();
    this.canvases.clear();
    this.cursors.clear();
    this._warned?.clear();
    this._unknownFrame = null;
  }
}

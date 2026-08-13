// Rendering primitives: QuadNode (textured/colored rect) and NineSliceNode (stretchable frame).
// Invariant: every UI material is transparent:true, depthTest:false, depthWrite:false —
// stacking is renderOrder-only (three renders its opaque list before the transparent list,
// so an opaque material would sink behind every UI quad regardless of renderOrder).

import * as THREE from 'three';
import { UINode } from './node.js';

// Shared unit quad: origin top-left, spans (0..1, 0..-1), CCW front face, UV top-left = (0,1).
let _unitQuad = null;
export function unitQuadGeometry() {
  if (_unitQuad) return _unitQuad;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, -1, 0, 1, -1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
  g.setIndex([0, 2, 1, 2, 3, 1]);
  _unitQuad = g;
  return g;
}

export function makeUIMaterial(opts = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  if (opts.opacity !== undefined) mat.opacity = opts.opacity;
  return mat;
}

export class QuadNode extends UINode {
  constructor(opts = {}) {
    super(opts);
    // An rgba() token in the CONSTRUCTOR keeps its alpha: three's Color
    // silently discards it, and the one page that fed one here rendered a fully
    // OPAQUE wash — the wound doll's "weird highlight rectangle". The string is
    // routed through setColor's rgba split; an explicit `opacity` option still
    // outranks the string's alpha (it is the stated intent).
    const rgbaCtor = typeof opts.color === 'string' && /^rgba?\(/.test(opts.color);
    this.material = makeUIMaterial({ color: rgbaCtor ? 0xffffff : (opts.color ?? 0xffffff), map: opts.texture ?? null, opacity: opts.opacity });
    this.mesh = new THREE.Mesh(unitQuadGeometry(), this.material);
    this.mesh.userData.node = this;
    this.group.add(this.mesh);
    this.baseOpacity = opts.opacity ?? 1;
    if (rgbaCtor) {
      this.setColor(opts.color);
      if (opts.opacity !== undefined) this.setBaseOpacity(opts.opacity);
    }
  }

  setTexture(tex) {
    if (this.material.map === tex) return;
    const variantChange = (this.material.map === null) !== (tex === null);
    this.material.map = tex;
    if (variantChange) this.material.needsUpdate = true; // null<->map toggles the USE_MAP program
    this.engine?.requestRender(); // pixel change with no layout/paint signal
  }

  setColor(c) {
    // rgba()/rgb() strings split into color + opacity (three's Color ignores alpha)
    const m = typeof c === 'string' && c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/);
    if (m) {
      this.material.color.setRGB(m[1] / 255, m[2] / 255, m[3] / 255);
      if (m[4] !== undefined) this.setBaseOpacity(parseFloat(m[4]));
    } else {
      this.material.color.set(c);
    }
    this.engine?.requestRender();
  }

  setBaseOpacity(v) {
    this.baseOpacity = v;
    this._appliedOpacity = -1; // force re-apply in the next sync pass
    this.engine?.requestRender();
  }

  applyOpacity(v) { this.material.opacity = this.baseOpacity * v; }

  syncSelf() {
    this.mesh.scale.set(Math.max(this.w, 0.0001), Math.max(this.h, 0.0001), 1);
  }

  // NEVER dispose this.geometry here: QuadNode/TextNode share the module-level
  // `_unitQuad` (see unitQuad() above) — disposing it blanks EVERY quad and text node
  // library-wide (this is the §2 text-blackout the audit found passes every gating
  // clause). NineSliceNode's geometry IS per-instance, so it disposes its own (below).
  disposeSelf() { this.material.dispose(); }
}

// 9-slice frame. `frame` comes from texgen: { tex, t, r, b, l, cssW, cssH } — slice insets in CSS px.
export class NineSliceNode extends UINode {
  constructor(frame, opts = {}) {
    super(opts);
    this.frame = frame;
    this.material = makeUIMaterial({ map: frame.tex, opacity: opts.opacity });
    this.baseOpacity = opts.opacity ?? 1;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(16 * 2), 2));
    const idx = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const a = r * 4 + c, b = a + 1, d = a + 4, e = d + 1;
      idx.push(a, d, b, d, e, b);
    }
    this.geometry.setIndex(idx);
    this._writeUVs();
    this._geoW = -1; this._geoH = -1;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.userData.node = this;
    this.mesh.frustumCulled = false; // geometry rewritten in place; skip stale-bounds culling
    this.group.add(this.mesh);
  }

  setFrame(frame) {
    if (this.frame === frame) return;
    const prev = this.frame;
    this.frame = frame;
    this.material.map = frame.tex;
    this.engine?.requestRender(); // same-metric state swaps change pixels silently
    // State swaps (hover/pressed) share metrics; a swap to a differently-cut frame
    // must rewrite UVs and re-run the position pass or the old slicing stretches.
    if (prev.t !== frame.t || prev.r !== frame.r || prev.b !== frame.b || prev.l !== frame.l ||
        prev.cssW !== frame.cssW || prev.cssH !== frame.cssH) {
      this._writeUVs();
      this._geoW = -1;
      this.invalidatePaint();
    }
  }

  _writeUVs() {
    const { t, r, b, l, cssW, cssH } = this.frame;
    const us = [0, l / cssW, 1 - r / cssW, 1];
    const vs = [1, 1 - t / cssH, b / cssH, 0];
    const uv = this.geometry.getAttribute('uv');
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      uv.setXY(row * 4 + col, us[col], vs[row]);
    }
    uv.needsUpdate = true;
  }

  _writePositions() {
    let { t, r, b, l } = this.frame;
    const w = Math.max(this.w, 1), h = Math.max(this.h, 1);
    if (l + r > w) { const s = w / (l + r); l *= s; r *= s; }
    if (t + b > h) { const s = h / (t + b); t *= s; b *= s; }
    const xs = [0, l, w - r, w];
    const ys = [0, t, h - b, h];
    const pos = this.geometry.getAttribute('position');
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      pos.setXYZ(row * 4 + col, xs[col], -ys[row], 0);
    }
    pos.needsUpdate = true;
  }

  applyOpacity(v) { this.material.opacity = this.baseOpacity * v; }

  syncSelf() {
    if (this._geoW !== this.w || this._geoH !== this.h) {
      this._geoW = this.w; this._geoH = this.h;
      this._writePositions();
    }
  }

  disposeSelf() { this.material.dispose(); this.geometry.dispose(); }
}

// A raw 3D container: its three content participates in accent z-slabs (depth on).
export class Accent3DNode extends UINode {
  constructor(opts = {}) {
    super(opts);
    this.accent3d = true;
    this.keepContent = opts.keepContent ?? false; // true: caller owns content resources
    this.content = new THREE.Group(); // callers add lit meshes here (transparent:true, depth on)
    this.group.add(this.content);
  }

  setZSlab(zBase) { this.content.position.z = zBase; }

  disposeSelf() {
    if (this.keepContent) return;
    // Frees geometries/materials added to `content`. Registry-owned texture maps are
    // shared and stay alive (the registry disposes them at engine teardown) — but a
    // consumer-attached NON-registry map leaked silently (the L12 RECORDED item).
    // Membership is exact: a registry texture's name resolves back to ITSELF in the
    // registry map; anything else on a material is instance baggage and dies here.
    const reg = (this.engine ?? this._lastEngine)?.textures;
    const registryOwned = (tex) => !!tex && !!reg
      && reg.textures?.get?.(tex.userData?.name) === tex;
    this.content.traverse((obj) => {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      for (const m of mats) {
        for (const key of ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
          const tex = m[key];
          if (tex && !registryOwned(tex)) tex.dispose();
        }
        m.dispose();
      }
    });
  }
}

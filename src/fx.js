// FX layer: abyssal background scene (fog, spores, monoliths), vignette overlay,
// and the volumetric orb shader.
// Accent meshes keep depth testing (self-occlusion) but must stay transparent:true
// so they interleave with UI quads by renderOrder (see layers.js z-slabs).

import * as THREE from 'three';
import { QuadNode } from './primitives.js';
import { seededRandom } from './texgen.js';
import { COLORS } from './theme.js';

// ---------------- background ambiance ----------------

function softCircleTexture(size, inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function monolithTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  const rng = seededRandom(313);
  ctx.clearRect(0, 0, 128, 256);
  ctx.fillStyle = 'rgba(6,10,9,0.9)';
  ctx.beginPath();
  ctx.moveTo(38, 256);
  ctx.lineTo(44, 40);
  ctx.lineTo(64, 12);
  ctx.lineTo(86, 44);
  ctx.lineTo(92, 256);
  ctx.closePath();
  ctx.fill();
  // faint rune lights up the face
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(111,209,139,${0.12 + rng() * 0.2})`;
    ctx.fillRect(58 + (rng() - 0.5) * 18, 60 + i * 28 + rng() * 10, 3 + rng() * 4, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function initBackground(engine) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 0, 30);
  scene.fog = new THREE.Fog(new THREE.Color(COLORS.abyss0), 20, 120);

  // gradient backdrop plane
  const bgTex = (() => {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0d1826');
    g.addColorStop(0.45, '#0b1016');
    g.addColorStop(1, '#04060a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(400, 220), new THREE.MeshBasicMaterial({ map: bgTex, fog: false }));
  backdrop.position.z = -90;
  scene.add(backdrop);

  // monolith silhouettes at depth
  const monoTex = monolithTexture();
  const monoliths = [];
  const rng = seededRandom(929);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(14 + rng() * 10, 34 + rng() * 26),
      new THREE.MeshBasicMaterial({ map: monoTex, transparent: true, opacity: 0.5 + rng() * 0.4 })
    );
    m.position.set((rng() - 0.5) * 130, -26 + rng() * 16, -70 + i * 8);
    monoliths.push(m);
    scene.add(m);
  }

  // drifting fog planes
  const fogTex = softCircleTexture(256, 'rgba(38,66,54,0.16)', 'rgba(38,66,54,0)');
  const fogPlanes = [];
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(
      new THREE.PlaneGeometry(70 + rng() * 60, 30 + rng() * 22),
      new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, opacity: 0.5, depthWrite: false })
    );
    f.position.set((rng() - 0.5) * 120, -18 + rng() * 30, -40 + i * 9);
    f.userData.speed = 0.4 + rng() * 0.8;
    f.userData.phase = rng() * Math.PI * 2;
    fogPlanes.push(f);
    scene.add(f);
  }

  // spore particles
  const N = 260;
  const pos = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rng() - 0.5) * 140;
    pos[i * 3 + 1] = (rng() - 0.5) * 70;
    pos[i * 3 + 2] = -60 + rng() * 70;
    seeds[i] = rng() * Math.PI * 2;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.35 + aSeed) * 2.2;
        p.x += cos(uTime * 0.22 + aSeed * 1.7) * 2.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime * 0.9 + aSeed * 3.1);
        vA = tw * clamp(1.0 + mv.z / 90.0, 0.12, 1.0);
        gl_PointSize = (1.6 + 1.3 * sin(aSeed * 9.0)) * (140.0 / -mv.z);
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float m = smoothstep(0.5, 0.08, length(d));
        gl_FragColor = vec4(0.55, 0.95, 0.7, m * vA * 0.5);
      }`,
  });
  const points = new THREE.Points(pGeo, pMat);
  scene.add(points);

  engine.bgScene = scene;
  engine.bgCamera = camera;
  camera.aspect = engine.width / Math.max(1, engine.height);
  camera.updateProjectionMatrix();
  engine.onBackgroundFrame = (dt, t) => {
    pMat.uniforms.uTime.value = t;
    for (const f of fogPlanes) {
      f.position.x += f.userData.speed * dt;
      if (f.position.x > 90) f.position.x = -90;
      f.material.opacity = 0.35 + 0.2 * Math.sin(t * 0.3 + f.userData.phase);
    }
    camera.position.x = Math.sin(t * 0.05) * 1.6;
    camera.position.y = Math.cos(t * 0.04) * 1.0;
    camera.lookAt(0, 0, -40);
  };

  // These resources live outside the texture registry; free them at engine teardown.
  engine.addDisposer(() => {
    engine.onBackgroundFrame = null;
    engine.bgScene = null;
    engine.bgCamera = null;
    scene.traverse((obj) => {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      for (const m of mats) { m.map?.dispose?.(); m.dispose(); }
    });
  });
}

// ---------------- vignette ----------------

export function initVignette(engine) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 130, 256, 256, 365);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.72, 'rgba(2,5,4,0.18)');
  g.addColorStop(1, 'rgba(1,3,2,0.62)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const quad = new QuadNode({ texture: tex });
  quad.name = 'vignette';
  quad.onLayout = function () { this.setRect(0, 0, engine.width, engine.height); };
  engine.layers.vignette.add(quad);
  engine.addDisposer(() => tex.dispose()); // private texture, not registry-owned
  engine._vignette = quad; // SanityFX's runtime handle — the boot discards the return
  return quad;
}

// ---------------- orb (health/sanity globe) ----------------

export function makeOrbMesh(radiusPx, colorDeep, colorBright) {
  // radius <= 0 (or NaN) degenerates the sphere and NaNs the rim falloff in the shader
  radiusPx = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 1;
  const geo = new THREE.SphereGeometry(radiusPx, 36, 28);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uFill: { value: 0.75 },
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(colorDeep) },
      uBright: { value: new THREE.Color(colorBright) },
      uRadius: { value: radiusPx },
    },
    vertexShader: `
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vPos = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;
      uniform float uFill, uTime, uRadius;
      uniform vec3 uDeep, uBright;
      void main() {
        float r = uRadius;
        float level = mix(-r * 1.05, r * 1.05, uFill);
        float wave = sin(uTime * 2.0 + vPos.x * 0.18) * 0.035 * r
                   + sin(uTime * 3.1 + vPos.x * 0.34) * 0.02 * r;
        float d = vPos.y - (level + wave);
        float fres = pow(1.0 - abs(dot(vNormal, vView)), 2.2);
        vec3 glass = vec3(0.32, 0.52, 0.42) * fres;
        if (d < 0.0) {
          float depth = clamp(-d / (2.0 * r), 0.0, 1.0);
          vec3 liquid = mix(uBright, uDeep, depth);
          float surf = exp(-abs(d) / (r * 0.09));
          liquid += uBright * surf * 0.9;
          float bub = smoothstep(0.985, 1.0, sin(vPos.x * 1.3 + uTime * 1.7) * sin(vPos.y * 1.1 - uTime * 1.3));
          liquid += vec3(0.6, 0.9, 0.8) * bub * 0.25;
          gl_FragColor = vec4(liquid + glass * 0.7, 0.94);
        } else {
          gl_FragColor = vec4(glass, 0.16 + fres * 0.55);
        }
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return {
    mesh,
    material: mat,
    setFill(v) { mat.uniforms.uFill.value = Math.max(0, Math.min(1, v)); },
    tick(t) { mat.uniforms.uTime.value = t; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

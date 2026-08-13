// Icon, portrait, and map painters. Ability icon ids mirror the source library
// (fireball, shield, ...) so ported code keeps working; the art is eldritch.

import { seededRandom } from './texgen.js';
import { COLORS } from './theme.js';
import { roundRect, shade } from './art.js';

const ICON = 64; // CSS px author size for ability icons

// Exported for custom icon painters (Eldritch.registerIcon/registerAbility).
export function iconBase(ctx, w, h, { rim = 'rgba(111,209,139,0.45)', bg0 = '#101713', bg1 = '#060a08' } = {}) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 1, 1, w - 2, h - 2, 8);
  const g = ctx.createRadialGradient(w / 2, h / 2 - 6, 4, w / 2, h / 2, w * 0.75);
  g.addColorStop(0, bg0); g.addColorStop(1, bg1);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, w - 2, h - 2, 8); ctx.stroke();
  // the accent rim hugs the edge (was inset 3, lw 1.4) — the icon plate
  // is a SECONDARY frame under the stone socket, and the two rims stacked were
  // half of why art read small everywhere
  ctx.strokeStyle = rim; ctx.lineWidth = 1.2;
  roundRect(ctx, 2, 2, w - 4, h - 4, 7); ctx.stroke();
}

export function glow(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
export function noGlow(ctx) { ctx.shadowBlur = 0; }

// The procedural ABILITY painters were removed in favor of the painted pack: "these are
// terrible... they need to be deleted. if they're used anywhere they need to
// be replaced with our actual icons" — every ability glyph now comes from the
// REAL icon pack (assets/icons, browsable in icon-browser) via loadIcons
// aliases on each page. Only INTERFACE art stays procedural (the exception
// list: ui.* chrome, currency coins, minimap marks, slot/socket stone, the
// figure model, the instrument glyphs). An un-aliased icon.<name> resolves to
// the loud fallback plate — visible, deliberate, never a silent blank. The
// FROZEN baselines show plates in ability sockets by the frozen-shelf law
// (--screenshot cannot await the pack's async decode); ?assert=1 suites keep
// proving the pack re-skin, which CAN await.
const abilityPainters = {};

// ---- UI icons (cogwheel/puzzle/rows/save/tune), 32 CSS ----
function uiIconPaint(kind, state) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const color = state === 'active' ? COLORS.accent : state === 'grayscale' ? '#5a615a' : '#aeb9ac';
    if (state === 'active') glow(ctx, COLORS.accentGlow, 6);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const cx = w / 2, cy = h / 2;
    if (kind === 'cogwheel') {
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9);
        ctx.lineTo(cx + Math.cos(a) * 13.5, cy + Math.sin(a) * 13.5);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 3.6, 0, Math.PI * 2); ctx.stroke();
    } else if (kind === 'puzzle') {
      ctx.beginPath();
      ctx.moveTo(9, 9); ctx.lineTo(14, 9);
      ctx.arc(cx, 8, 3.2, Math.PI, 0);  // top knob
      ctx.lineTo(23, 9); ctx.lineTo(23, 14);
      ctx.arc(24, cy, 3.2, -Math.PI / 2, Math.PI / 2); // right knob
      ctx.lineTo(23, 23); ctx.lineTo(9, 23);
      ctx.closePath(); ctx.stroke();
    } else if (kind === 'rows') {
      for (const y of [10, 16, 22]) {
        ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(24, y); ctx.stroke();
        ctx.beginPath(); ctx.arc(6, y, 1.4, 0, Math.PI * 2); ctx.fill();
      }
    } else if (kind === 'save') { // wax-sealed scroll
      ctx.beginPath();
      ctx.moveTo(10, 7); ctx.lineTo(22, 7); ctx.quadraticCurveTo(25, 7, 25, 10);
      ctx.lineTo(25, 25); ctx.lineTo(13, 25); ctx.quadraticCurveTo(10, 25, 10, 22);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, 7); ctx.quadraticCurveTo(7, 7, 7, 10); ctx.quadraticCurveTo(7, 13, 10, 13); ctx.stroke();
      ctx.beginPath(); ctx.arc(17.5, 19, 3.4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(17.5, 19, 1.2, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'tune') {
      for (const [y, tx] of [[10, 20], [16, 12], [22, 17]]) {
        ctx.beginPath(); ctx.moveTo(7, y); ctx.lineTo(25, y); ctx.stroke();
        ctx.beginPath(); ctx.arc(tx, y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = '#0a0d0b'; ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
      }
    }
    noGlow(ctx);
  };
}

// ---- currency, portraits, map, marks ----

function coin(tone0, tone1, stamp) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2 - 2, h / 2 - 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, tone0); g.addColorStop(1, tone1);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = stamp; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    // tiny tentacle sigil
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2 + 3.4);
    ctx.quadraticCurveTo(w / 2 - 3, h / 2, w / 2, h / 2 - 3.4);
    ctx.quadraticCurveTo(w / 2 + 3, h / 2 - 1, w / 2 + 1, h / 2 + 1.4);
    ctx.stroke();
  };
}

function portraitPlayer(ctx, w, h) { // hooded investigator
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1a2430'); g.addColorStop(1, '#0a0f14');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // hood
  ctx.fillStyle = '#242c26';
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.08);
  ctx.quadraticCurveTo(w * 0.88, h * 0.22, w * 0.82, h * 0.62);
  ctx.quadraticCurveTo(w * 0.86, h * 0.95, w * 0.78, h);
  ctx.lineTo(w * 0.22, h);
  ctx.quadraticCurveTo(w * 0.14, h * 0.95, w * 0.18, h * 0.62);
  ctx.quadraticCurveTo(w * 0.12, h * 0.22, w * 0.5, h * 0.08);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
  // hood interior + face shadow
  ctx.fillStyle = '#05080a';
  ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.5, w * 0.21, h * 0.27, 0, 0, Math.PI * 2); ctx.fill();
  // THE INVESTIGATOR WAS SMILING. The jaw hint was a SYMMETRIC half-ellipse
  // at 0..PI, and canvas sweeps that as the BOTTOM half, so under two glowing eye
  // points it rendered as a mouth curving up. At 56px in a unit frame the flagship's
  // portrait read as a smiley face. The jaw is now an ASYMMETRIC lit edge down one
  // cheek - light falls from one side, and nothing about it closes into a curve.
  ctx.fillStyle = 'rgba(196,188,158,0.55)';
  ctx.beginPath();
  ctx.moveTo(w * 0.44, h * 0.54);
  ctx.quadraticCurveTo(w * 0.40, h * 0.66, w * 0.49, h * 0.71);
  ctx.quadraticCurveTo(w * 0.45, h * 0.62, w * 0.47, h * 0.54);
  ctx.closePath(); ctx.fill();
  // the hollow under the cheekbone keeps the face from reading as a lit oval
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.ellipse(w * 0.56, h * 0.6, w * 0.1, h * 0.09, 0, 0, Math.PI * 2); ctx.fill();
  // eyes: faint green points, set unevenly so the face is not a mask
  glow(ctx, COLORS.accent, 5);
  ctx.fillStyle = 'rgba(111,209,139,0.9)';
  ctx.beginPath(); ctx.arc(w * 0.43, h * 0.46, 1.7, 0, Math.PI * 2); ctx.arc(w * 0.585, h * 0.475, 1.4, 0, Math.PI * 2); ctx.fill();
  noGlow(ctx);
  // hood seam
  ctx.strokeStyle = 'rgba(150,168,150,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.09); ctx.quadraticCurveTo(w * 0.53, h * 0.2, w * 0.5, h * 0.26); ctx.stroke();
}

function portraitDeepOne(ctx, w, h) { // star-spawn / deep one head
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0c1f1c'); g.addColorStop(1, '#04100e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // head
  const hg = ctx.createRadialGradient(w * 0.5, h * 0.42, 3, w * 0.5, h * 0.5, w * 0.5);
  hg.addColorStop(0, '#3c7a5e'); hg.addColorStop(1, '#12332a');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.1);
  ctx.quadraticCurveTo(w * 0.9, h * 0.25, w * 0.8, h * 0.66);
  ctx.quadraticCurveTo(w * 0.72, h * 0.92, w * 0.5, h * 0.95);
  ctx.quadraticCurveTo(w * 0.28, h * 0.92, w * 0.2, h * 0.66);
  ctx.quadraticCurveTo(w * 0.1, h * 0.25, w * 0.5, h * 0.1);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
  // gills
  ctx.strokeStyle = 'rgba(6,14,12,0.9)'; ctx.lineWidth = 1.6;
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    const x = w * 0.5 + side * (w * 0.26 + i * 2.4);
    ctx.moveTo(x, h * 0.42); ctx.quadraticCurveTo(x + side * 3, h * 0.52, x - side * 1, h * 0.62);
    ctx.stroke();
  }
  // huge lidless eyes
  glow(ctx, '#e8d86a', 7);
  ctx.fillStyle = '#e3d276';
  ctx.beginPath(); ctx.arc(w * 0.36, h * 0.44, 6.4, 0, Math.PI * 2); ctx.arc(w * 0.64, h * 0.44, 6.4, 0, Math.PI * 2); ctx.fill();
  noGlow(ctx);
  ctx.fillStyle = '#0a0d0b';
  ctx.beginPath(); ctx.ellipse(w * 0.36, h * 0.44, 2, 4.4, 0, 0, Math.PI * 2); ctx.ellipse(w * 0.64, h * 0.44, 2, 4.4, 0, 0, Math.PI * 2); ctx.fill();
  // tentacle mouth
  ctx.strokeStyle = '#1c4a3a'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + i * 4.4, h * 0.66);
    ctx.quadraticCurveTo(w * 0.5 + i * 6.4, h * 0.8, w * 0.5 + i * 4, h * 0.92);
    ctx.stroke();
  }
}

function portraitKeeper(ctx, w, h) { // the weathered keeper: scarfed, brazier-lit
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2a2118'); g.addColorStop(1, '#0f0b07');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // the head: bare, weather-cut
  const hg = ctx.createRadialGradient(w * 0.46, h * 0.4, 3, w * 0.5, h * 0.48, w * 0.46);
  hg.addColorStop(0, '#8a7458'); hg.addColorStop(1, '#2e2418');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.12);
  ctx.quadraticCurveTo(w * 0.76, h * 0.2, w * 0.74, h * 0.48);
  ctx.quadraticCurveTo(w * 0.72, h * 0.66, w * 0.5, h * 0.72);
  ctx.quadraticCurveTo(w * 0.28, h * 0.66, w * 0.26, h * 0.48);
  ctx.quadraticCurveTo(w * 0.24, h * 0.2, w * 0.5, h * 0.12);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
  // the brow scar: one pale seam cut at an angle (asymmetry — the lesson:
 // nothing symmetric may close into a curve under the eyes)
  ctx.strokeStyle = 'rgba(214,196,168,0.5)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(w * 0.38, h * 0.3); ctx.lineTo(w * 0.46, h * 0.4); ctx.stroke();
  // the eyes: uneven, one catching the brazier
  glow(ctx, '#d8a04a', 4);
  ctx.fillStyle = 'rgba(216,170,90,0.9)';
  ctx.beginPath(); ctx.arc(w * 0.41, h * 0.44, 1.6, 0, Math.PI * 2); ctx.arc(w * 0.6, h * 0.455, 1.3, 0, Math.PI * 2); ctx.fill();
  noGlow(ctx);
  // the shadow side: the hall is dark on one cheek
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(w * 0.62, h * 0.5, w * 0.11, h * 0.15, 0.3, 0, Math.PI * 2); ctx.fill();
  // the scarf: wound high, hiding the jaw
  ctx.fillStyle = '#3a3226';
  ctx.beginPath();
  ctx.moveTo(w * 0.18, h);
  ctx.quadraticCurveTo(w * 0.22, h * 0.66, w * 0.5, h * 0.62);
  ctx.quadraticCurveTo(w * 0.78, h * 0.66, w * 0.82, h);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = 'rgba(150,132,100,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w * 0.26, h * 0.82); ctx.quadraticCurveTo(w * 0.5, h * 0.76, w * 0.74, h * 0.84); ctx.stroke();
}

function portraitBrine(ctx, w, h) { // the brine-touched sailor under a sou'wester
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#16222a'); g.addColorStop(1, '#070d11');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // the face in the hat's shadow
  const fg = ctx.createRadialGradient(w * 0.5, h * 0.5, 2, w * 0.5, h * 0.55, w * 0.4);
  fg.addColorStop(0, '#5c6a62'); fg.addColorStop(1, '#141d1a');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.55, w * 0.24, h * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  // the stubbled jaw: a grain of dark points low on ONE side (never a curve)
  ctx.fillStyle = 'rgba(10,14,12,0.7)';
  for (let i = 0; i < 14; i++) {
    const px = w * (0.38 + (i % 5) * 0.045), py = h * (0.68 + Math.floor(i / 5) * 0.035);
    ctx.fillRect(px, py, 1.2, 1.2);
  }
  // the sou'wester: a long brim swept back
  ctx.fillStyle = '#243430';
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.42);
  ctx.quadraticCurveTo(w * 0.2, h * 0.1, w * 0.56, h * 0.1);
  ctx.quadraticCurveTo(w * 0.9, h * 0.12, w * 0.92, h * 0.4);
  ctx.quadraticCurveTo(w * 0.7, h * 0.3, w * 0.5, h * 0.32);
  ctx.quadraticCurveTo(w * 0.28, h * 0.34, w * 0.12, h * 0.42);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.strokeStyle = 'rgba(140,170,160,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w * 0.2, h * 0.36); ctx.quadraticCurveTo(w * 0.5, h * 0.26, w * 0.86, h * 0.34); ctx.stroke();
  // pale salt-bleached eyes, uneven
  glow(ctx, '#a8c4d6', 4);
  ctx.fillStyle = 'rgba(178,206,220,0.9)';
  ctx.beginPath(); ctx.arc(w * 0.42, h * 0.5, 1.6, 0, Math.PI * 2); ctx.arc(w * 0.6, h * 0.515, 1.35, 0, Math.PI * 2); ctx.fill();
  noGlow(ctx);
  // the oilskin collar
  ctx.fillStyle = '#1c2a26';
  ctx.beginPath();
  ctx.moveTo(w * 0.14, h);
  ctx.lineTo(w * 0.3, h * 0.78);
  ctx.lineTo(w * 0.5, h * 0.86);
  ctx.lineTo(w * 0.7, h * 0.78);
  ctx.lineTo(w * 0.86, h);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
}

function minimapImage(ctx, w, h) { // R'lyeh Depths: abyssal ruins
  const rng = seededRandom(211);
  const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
  g.addColorStop(0, '#0d2020'); g.addColorStop(1, '#050c0e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // landmass blotches
  for (let i = 0; i < 26; i++) {
    const x = rng() * w, y = rng() * h, r = 8 + rng() * 26;
    const lg = ctx.createRadialGradient(x, y, 0, x, y, r);
    lg.addColorStop(0, `rgba(28,44,36,${0.35 + rng() * 0.3})`);
    lg.addColorStop(1, 'rgba(28,44,36,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // sunken street grid fragments (non-euclidean: slightly skewed)
  ctx.strokeStyle = 'rgba(80,100,88,0.28)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    const x = rng() * w, y = rng() * h, len = 16 + rng() * 34, a = rng() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.lineTo(x + Math.cos(a + 1.9) * len * 0.5, y + Math.sin(a + 1.9) * len * 0.5);
    ctx.stroke();
  }
  // ruin rings
  for (let i = 0; i < 4; i++) {
    const x = rng() * w, y = rng() * h;
    ctx.strokeStyle = `rgba(111,209,139,${0.12 + rng() * 0.12})`;
    ctx.beginPath(); ctx.arc(x, y, 6 + rng() * 14, rng(), rng() + Math.PI * 1.3); ctx.stroke();
  }
  // glow spots (windows of the drowned city)
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(140,255,190,${0.10 + rng() * 0.2})`;
    ctx.beginPath(); ctx.arc(rng() * w, rng() * h, 0.8 + rng() * 1.6, 0, Math.PI * 2); ctx.fill();
  }
  // abyss trench
  ctx.strokeStyle = 'rgba(3,6,7,0.85)'; ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  ctx.bezierCurveTo(w * 0.3, h * 0.6, w * 0.55, h * 0.9, w, h * 0.78);
  ctx.stroke();
}

function questMark(char) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = `bold ${h - 3}px Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(char, w / 2, h / 2 + 1);
    glow(ctx, 'rgba(232,216,106,0.8)', 4);
    ctx.fillStyle = '#e8d86a';
    ctx.fillText(char, w / 2, h / 2 + 1);
    noGlow(ctx);
  };
}

function playerPin(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  glow(ctx, COLORS.accentGlow, 4);
  ctx.fillStyle = COLORS.accent;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(w / 2, 2);
  ctx.lineTo(w - 4, h - 4);
  ctx.lineTo(w / 2, h - 9);
  ctx.lineTo(4, h - 4);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  noGlow(ctx);
}

function lockIcon(locked) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const color = locked ? COLORS.accent : '#8a968a';
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 2;
    if (locked) glow(ctx, COLORS.accentGlow, 4);
    // Shackle. LOCKED: a closed hoop, both legs seated in the case.
    // UNLOCKED: the hoop is HINGED OPEN — lifted clear of the case and swung left, with
    // the free leg ending in mid-air. The old form swept PI..-0.35 (about 200 degrees,
    // barely open) nudged 2.2px sideways, which at 20px read as a slightly wrong LOCKED
    // padlock rather than an open one — the state was unreadable, which is the whole job.
    if (locked) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 - 2.5, 4.6, Math.PI, 0);
      ctx.stroke();
    } else {
      // Geometry is tight: this bakes at 20x20, the case top sits at h/2-2.5, and the
      // hoop has to clear it while staying inside the canvas. r 3.6 about (w/2-2,
      // h/2-5.6) puts the crown at y=0.8 with a 2.4px break above the case — measured,
      // because the first attempt used r 4.6 at h/2-7.5 and clipped the crown at y=-2.1.
      const hx = w / 2 - 2, hy = h / 2 - 5.6, hr = 3.6;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, Math.PI, 0.2);   // swung open, its mouth clear of the case
      ctx.stroke();
      ctx.beginPath();                     // the hinge leg, the only one still seated
      ctx.moveTo(hx - hr, hy); ctx.lineTo(hx - hr, h / 2 - 2.5);
      ctx.stroke();
    }
    // body
    roundRect(ctx, w / 2 - 6, h / 2 - 2.5, 12, 9.5, 2);
    ctx.fill();
    ctx.fillStyle = '#0a0d0b';
    ctx.beginPath(); ctx.arc(w / 2, h / 2 + 1.6, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(w / 2 - 0.7, h / 2 + 1.6, 1.4, 3);
    noGlow(ctx);
  };
}

// Circle-clip a painter (portraits render inside round avatar rings).
function circular(paint) {
  return (ctx, w, h) => {
    ctx.save();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); ctx.clip();
    paint(ctx, w, h);
    ctx.restore();
  };
}

function dotPainter(fill, border) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = border; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(w / 2 - 1.2, h / 2 - 1.2, 1.2, 0, Math.PI * 2); ctx.fill();
  };
}

function barFill(top, mid, bot) {
  return (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top); g.addColorStop(0.5, mid); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, h - 2, w, 2);
  };
}

// ---- the anatomical figure ("a more realistic humanoid
// silhouette") ----
// ONE source of truth for both dolls: doll.character (the investigator panel)
// renders the whole silhouette, and each BodyDoll plate renders one BAND of the
// same figure, so the assembled wound doll and the panel figure share anatomy
// and the plate seams meet by construction. Figure space: 100 wide x 220 tall
// (about 7.4 heads), symmetric about x = 50. speakingstones' FIGURE_W/FIGURE_H
// (150x330) MUST keep this 100:220 ratio, and its DOLL_PARTS fractions are
// FIG_BANDS over 100/220 — change either side only with the other.
const FIG_W = 100, FIG_H = 220, FCX = 50;

// Right-half landmarks (x = half-width from center at height y); the left side
// mirrors by sign. Tuned against rendered proportions, not guessed.
const FP = {
  crown: 1, skullW: 11.8, skullY: 13, cheekW: 10.0, cheekY: 21, jawW: 6.2, jawY: 26.5, chin: 29,
  neckW: 5.8, neckTop: 27, neckBot: 39, trapW: 8.8,
  shoY: 42, acromX: 20.5, acromY: 45.5, deltW: 25.5, deltY: 51.5,
  pitX: 17.8, pitY: 57,
  chestW: 18.2, chestTop: 52, latW: 16.6, latY: 66, waistW: 12.4, waistY: 87,
  iliacW: 15.8, iliacY: 103, hipW: 16.4, hipY: 112, crotchX: 3.2, crotchY: 119, gutBot: 121,
  armTop: 43, bicOutX: 25.2, bicOutY: 66, bicInX: 19.6, bicInY: 66,
  elbOutX: 24.6, elbOutY: 90, elbInX: 19.8, elbInY: 90,
  wriOutX: 23.2, wriOutY: 124, wriInX: 18.6, wriInY: 124,
  palmOutX: 23.8, palmInX: 18.0, palmY: 136, fingX: 21.0, fingTip: 152,
  legTop: 116, thighOutX: 15.2, thighOutY: 132, thighInX: 4.2, thighInY: 132,
  kneeOutX: 9.0, kneeOutY: 154, kneeInX: 3.8, kneeInY: 154,
  calfOutX: 10.2, calfOutY: 165, calfInX: 4.4, calfInY: 165,
  ankOutX: 5.4, ankOutY: 193, ankInX: 2.4, ankInY: 193,
  footTop: 193, heelX: 1.6, soleY: 208, toeX: 16.5, toeRise: 203.5,
};

function figTrace(ctx, sx, sy, ops) {
  ctx.moveTo(sx, sy);
  for (const o of ops) {
    if (o[0] === 'q') ctx.quadraticCurveTo(o[1], o[2], o[3], o[4]);
    else if (o[0] === 'c') ctx.bezierCurveTo(o[1], o[2], o[3], o[4], o[5], o[6]);
    else ctx.lineTo(o[1], o[2]);
  }
}

// Part paths in FIGURE SPACE. s = +1 is the figure's LEFT limbs (viewer right,
// matching the shipped l/r part ids); torso parts are symmetric.
const FIGURE_PARTS = {
  head(ctx) {
    figTrace(ctx, FCX, FP.crown, [
      ['c', FCX + 8.5, FP.crown, FCX + FP.skullW, 5.5, FCX + FP.skullW, FP.skullY],
      ['q', FCX + FP.skullW, FP.cheekY - 2.5, FCX + FP.cheekW, FP.cheekY],
      ['q', FCX + FP.jawW + 1.5, FP.jawY, FCX + FP.jawW, FP.jawY],
      ['q', FCX + 3.4, FP.chin, FCX, FP.chin],
      ['q', FCX - 3.4, FP.chin, FCX - FP.jawW, FP.jawY],
      ['q', FCX - FP.jawW - 1.5, FP.jawY, FCX - FP.cheekW, FP.cheekY],
      ['q', FCX - FP.skullW, FP.cheekY - 2.5, FCX - FP.skullW, FP.skullY],
      ['c', FCX - FP.skullW, 5.5, FCX - 8.5, FP.crown, FCX, FP.crown],
    ]);
  },
  neck(ctx) {
    figTrace(ctx, FCX - FP.neckW, FP.neckTop, [
      ['l', FCX + FP.neckW, FP.neckTop],
      ['q', FCX + FP.neckW + 0.4, FP.neckBot - 3.5, FCX + FP.trapW, FP.neckBot],
      ['l', FCX - FP.trapW, FP.neckBot],
      ['q', FCX - FP.neckW - 0.4, FP.neckBot - 3.5, FCX - FP.neckW, FP.neckTop],
    ]);
  },
  back(ctx) { // the trapezius yoke over both shoulder caps
    figTrace(ctx, FCX - FP.trapW, FP.shoY - 3.5, [
      ['q', FCX, FP.shoY - 5.5, FCX + FP.trapW, FP.shoY - 3.5],
      ['q', FCX + FP.acromX - 3, FP.shoY - 1.5, FCX + FP.acromX, FP.acromY],
      ['q', FCX + FP.acromX - 1, FP.chestTop + 2.2, FCX + FP.chestW + 0.8, FP.chestTop + 2.5],
      ['l', FCX - FP.chestW - 0.8, FP.chestTop + 2.5],
      ['q', FCX - FP.acromX + 1, FP.chestTop + 1.5, FCX - FP.acromX, FP.acromY],
      ['q', FCX - FP.acromX + 3, FP.shoY - 1.5, FCX - FP.trapW, FP.shoY - 3.5],
    ]);
  },
  chest(ctx) {
    figTrace(ctx, FCX - FP.chestW, FP.chestTop, [
      ['l', FCX + FP.chestW, FP.chestTop],
      ['q', FCX + FP.latW + 0.6, FP.latY, FCX + FP.latW, FP.latY],
      ['q', FCX + FP.waistW + 0.8, FP.waistY - 6, FCX + FP.waistW, FP.waistY],
      ['l', FCX - FP.waistW, FP.waistY],
      ['q', FCX - FP.waistW - 0.8, FP.waistY - 6, FCX - FP.latW, FP.latY],
      ['q', FCX - FP.latW - 0.6, FP.latY, FCX - FP.chestW, FP.chestTop],
    ]);
  },
  gut(ctx) { // waist -> iliac flare -> hips -> crotch notch
    figTrace(ctx, FCX - FP.waistW, FP.waistY - 0.5, [
      ['l', FCX + FP.waistW, FP.waistY - 0.5],
      ['q', FCX + FP.iliacW, FP.iliacY - 6, FCX + FP.iliacW, FP.iliacY],
      ['q', FCX + FP.hipW, FP.hipY - 3, FCX + FP.hipW - 0.6, FP.hipY],
      ['q', FCX + FP.hipW - 2.5, FP.gutBot - 1, FCX + FP.crotchX + 3.5, FP.gutBot - 1],
      ['q', FCX, FP.crotchY - 3.5, FCX - FP.crotchX - 3.5, FP.gutBot - 1],
      ['q', FCX - FP.hipW + 2.5, FP.gutBot - 1, FCX - FP.hipW + 0.6, FP.hipY],
      ['q', FCX - FP.hipW, FP.hipY - 3, FCX - FP.iliacW, FP.iliacY],
      ['q', FCX - FP.iliacW, FP.iliacY - 6, FCX - FP.waistW, FP.waistY - 0.5],
    ]);
  },
  arm(ctx, s) { // shoulder cap to wrist, a slight A-pose gap off the torso
    const X = (v) => FCX + s * v;
    figTrace(ctx, X(FP.acromX - 3.5), FP.armTop, [
      ['c', X(FP.deltW - 1), FP.armTop + 0.5, X(FP.deltW), FP.acromY + 1.5, X(FP.deltW), FP.deltY],
      ['q', X(FP.bicOutX + 0.4), FP.bicOutY - 4, X(FP.bicOutX), FP.bicOutY],
      ['q', X(FP.elbOutX + 0.6), FP.elbOutY - 4, X(FP.elbOutX), FP.elbOutY],
      ['q', X(FP.elbOutX - 0.2), FP.elbOutY + 7, X(FP.wriOutX), FP.wriOutY],
      ['l', X(FP.wriInX), FP.wriInY],
      ['q', X(FP.elbInX - 0.4), FP.elbOutY + 5, X(FP.elbInX), FP.elbInY],
      ['q', X(FP.bicInX - 0.6), FP.elbInY - 14, X(FP.bicInX), FP.bicInY],
      ['q', X(FP.pitX + 1.2), FP.pitY + 1.5, X(FP.pitX), FP.pitY],
      ['q', X(FP.acromX + 1.5), FP.acromY + 0.5, X(FP.acromX - 3.5), FP.armTop],
    ]);
  },
  hand(ctx, s) { // palm + closed fingers, a thumb notch inward
    const X = (v) => FCX + s * v;
    figTrace(ctx, X(FP.wriInX), FP.wriInY - 0.5, [
      ['l', X(FP.wriOutX), FP.wriOutY - 0.5],
      ['q', X(FP.palmOutX + 0.8), FP.palmY - 5, X(FP.palmOutX), FP.palmY],
      ['q', X(FP.palmOutX - 0.4), FP.fingTip - 5.5, X(FP.fingX), FP.fingTip],
      ['q', X(FP.palmInX + 0.6), FP.fingTip - 3.5, X(FP.palmInX + 0.8), FP.palmY + 5.5],
      ['q', X(FP.palmInX - 1.8), FP.palmY - 1.5, X(FP.palmInX - 1.2), FP.palmY - 3.2],
      ['q', X(FP.palmInX - 0.4), FP.palmY - 6.5, X(FP.wriInX), FP.wriInY - 0.5],
    ]);
  },
  leg(ctx, s) { // hip crease to ankle: thigh, knee, calf, taper
    const X = (v) => FCX + s * v;
    figTrace(ctx, X(FP.hipW - 0.8), FP.legTop, [
      ['q', X(FP.thighOutX + 0.8), FP.thighOutY - 8, X(FP.thighOutX), FP.thighOutY],
      ['q', X(FP.kneeOutX + 0.8), FP.kneeOutY - 8, X(FP.kneeOutX), FP.kneeOutY],
      ['q', X(FP.calfOutX + 0.6), FP.calfOutY - 2, X(FP.calfOutX), FP.calfOutY],
      ['q', X(FP.ankOutX + 0.6), FP.ankOutY - 14, X(FP.ankOutX), FP.ankOutY],
      ['l', X(FP.ankInX), FP.ankInY],
      ['q', X(FP.calfInX - 0.4), FP.calfInY + 4, X(FP.calfInX), FP.calfInY],
      ['q', X(FP.kneeInX - 0.4), FP.kneeInY + 3, X(FP.kneeInX), FP.kneeInY],
      ['q', X(FP.thighInX - 0.6), FP.thighInY + 2, X(FP.thighInX), FP.thighInY],
      ['q', X(FP.crotchX + 0.6), FP.crotchY + 2.5, X(FP.crotchX), FP.crotchY],
      ['q', X(FP.hipW - 2), FP.legTop + 2.5, X(FP.hipW - 0.8), FP.legTop],
    ]);
  },
  foot(ctx, s) { // heel block + toe wedge leading outward
    const X = (v) => FCX + s * v;
    figTrace(ctx, X(FP.ankInX - 0.6), FP.footTop, [
      ['l', X(FP.ankOutX + 0.6), FP.footTop],
      ['q', X(FP.ankOutX + 1.5), FP.toeRise - 2, X(FP.toeX * 0.62), FP.toeRise],
      ['q', X(FP.toeX + 1.5), FP.soleY - 4.5, X(FP.toeX), FP.soleY - 0.8],
      ['l', X(FP.heelX - 1.2), FP.soleY - 0.8],
      ['q', X(FP.heelX - 2.6), FP.soleY - 4, X(FP.ankInX - 0.6), FP.footTop],
    ]);
  },
};

function wholeFigure(ctx) {
  FIGURE_PARTS.head(ctx);
  FIGURE_PARTS.neck(ctx);
  FIGURE_PARTS.back(ctx);
  FIGURE_PARTS.chest(ctx);
  FIGURE_PARTS.gut(ctx);
  for (const s of [1, -1]) {
    FIGURE_PARTS.arm(ctx, s);
    FIGURE_PARTS.hand(ctx, s);
    FIGURE_PARTS.leg(ctx, s);
    FIGURE_PARTS.foot(ctx, s);
  }
}

// Texture band boxes in figure space [x0, y0, x1, y1]: each pads its part's
// path so the 2px plate stroke never clips, and the small parts pad FURTHER
// because the box is also the HIT ZONE (the 24px floor at the default doll
// width). Six boxes therefore overlap their neighbors by design — the plates
// interlock like anatomy does — and those six declare the overlap allowance in
// speakingstones.js. DOLL_PARTS mirrors these as fractions over 100/220.
const FIG_BANDS = {
  head: [36.2, 0, 63.8, 30],
  neck: [37.7, 25, 62.3, 44],
  back: [26.5, 35, 73.5, 55],
  chest: [29.8, 51, 70.2, 88],
  gut: [31.6, 85, 68.4, 122],
  arml: [62.5, 41, 79, 125],
  armr: [21, 41, 37.5, 125],
  handl: [64, 122, 80.2, 154],
  handr: [19.8, 122, 36, 154],
  legl: [51.2, 114, 68.4, 194],
  legr: [31.6, 114, 48.8, 194],
  footl: [50.1, 190, 68.5, 213],
  footr: [31.5, 190, 49.9, 213],
};

// The figure's INK box, DERIVED from the same landmark table the paths trace
// (never a frozen literal — move a landmark and the fit follows): the max runs
// over EVERY half-width landmark, so no single limb can outgrow the fit (// the first cut hand-picked eleven fields and omitted fingX/pitX — larger than
// four it listed — which broke the move-a-landmark promise). Curve control
// points overshoot their anchors by ≲0.4 units (the arm's bicOut+0.4); the 0.97
// margin in paperDoll absorbs that. FIG_W/FIG_H is a COORDINATE FRAME, not the
// silhouette — a standing human fills about half its width — so fitting art to
// the frame wasted the slot on air.
const FIG_HALF = Math.max(
  FP.skullW, FP.cheekW, FP.jawW, FP.neckW, FP.trapW, FP.acromX, FP.deltW, FP.pitX,
  FP.chestW, FP.latW, FP.waistW, FP.iliacW, FP.hipW, FP.crotchX,
  FP.bicOutX, FP.bicInX, FP.elbOutX, FP.elbInX, FP.wriOutX, FP.wriInX,
  FP.palmOutX, FP.palmInX, FP.fingX,
  FP.thighOutX, FP.thighInX, FP.kneeOutX, FP.kneeInX, FP.calfOutX, FP.calfInX,
  FP.ankOutX, FP.ankInX, FP.heelX, FP.toeX);
const FIG_INK_W = FIG_HALF * 2, FIG_INK_H = FP.soleY - FP.crown;

function paperDoll(ctx, w, h) { // the investigator: an anatomical standing silhouette
  ctx.clearRect(0, 0, w, h);
  // fit the INK, not the frame: uniform scale, so the mannequin stands
  // as tall as the slot allows without a pixel of distortion
  const sc = Math.min(w / FIG_INK_W, h / FIG_INK_H) * 0.97;
  ctx.save();
  ctx.translate((w - FIG_INK_W * sc) / 2 - (FCX - FIG_HALF) * sc,
    (h - FIG_INK_H * sc) / 2 - FP.crown * sc);
  ctx.scale(sc, sc);
  const g = ctx.createLinearGradient(0, FP.crown, 0, FP.soleY);
  g.addColorStop(0, 'rgba(40,52,44,0.55)');
  g.addColorStop(1, 'rgba(10,14,12,0.25)');
  ctx.fillStyle = g;
  ctx.beginPath();
  wholeFigure(ctx);
  ctx.fill();
  // stroking the part paths traces the seams too — the tailor's-mannequin read
  ctx.strokeStyle = 'rgba(111,209,139,0.35)';
  ctx.lineWidth = 1.5 / sc;
  ctx.beginPath();
  wholeFigure(ctx);
  ctx.stroke();
  ctx.restore();
}

// ---- the speaking stones: body-part plates + condition marks ----
// Parts paint LIGHT (bone-grey ~0.85 luminance) with a dark outline and an inset seam,
// because BodyDoll tints them multiplicatively (material.color — the ItemSlot dragOver
// mechanism): stoneHi reads carved, quest reads bruised-gold, negative reads bloodied.
const BODY_FILL = '#d8d3c2';
const BODY_EDGE = 'rgba(8,12,10,0.9)';

// path(ctx, w, h) traces the shape; the wrapper fills, outlines, and shades it.
function bodyPart(path) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    path(ctx, w, h);
    ctx.closePath();
    ctx.fillStyle = BODY_FILL;
    ctx.fill();
    ctx.strokeStyle = BODY_EDGE;
    ctx.lineWidth = 2; // half rides outside the path: the 1px inset seam between parts
    ctx.stroke();
    const g = ctx.createLinearGradient(0, 0, 0, h); // carved depth: light crown, sunk base
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fill();
  };
}

// A plate painter: one figure band scaled into its own texture box. The path
// records under the transform and bodyPart()'s fill/stroke run after it pops,
// so the 2px seam stroke stays crisp texture-space at every band scale.
function partPlate(bandKey, pathName, side = 1) {
  const [x0, y0, x1, y1] = FIG_BANDS[bandKey];
  return bodyPart((ctx, w, h) => {
    ctx.save();
    ctx.scale(w / (x1 - x0), h / (y1 - y0));
    ctx.translate(-x0, -y0);
    FIGURE_PARTS[pathName](ctx, side);
    ctx.restore();
  });
}

// The hover OUTLINE: the SAME band path, stroke-only in the accent with
// a soft glow and the faintest interior wash — the border highlight the wound
// doll wears under the cursor. (The old hover was a full-plate rectangle wash,
// and an rgba token fed to a QuadNode constructor rendered it OPAQUE — the
// reported "weird highlight rectangle", killed at both ends.)
function partOutline(bandKey, pathName, side = 1) {
  const [x0, y0, x1, y1] = FIG_BANDS[bandKey];
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.save();
    ctx.scale(w / (x1 - x0), h / (y1 - y0));
    ctx.translate(-x0, -y0);
    FIGURE_PARTS[pathName](ctx, side);
    ctx.restore();
    ctx.closePath();
    glow(ctx, COLORS.accentGlow, 6);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    noGlow(ctx);
    ctx.globalAlpha = 0.1; // the lit limb reads as ONE shape, not a wire
    ctx.fillStyle = COLORS.accent;
    ctx.fill();
    ctx.globalAlpha = 1;
  };
}

function bleedMark(ctx, w, h) { // arterial droplet (joins the mark.* family)
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(w * 0.5, 1);
  ctx.quadraticCurveTo(w * 0.88, h * 0.55, w * 0.78, h * 0.72);
  ctx.arc(w * 0.5, h * 0.68, w * 0.29, -0.25, Math.PI + 0.25);
  ctx.quadraticCurveTo(w * 0.12, h * 0.55, w * 0.5, 1);
  ctx.closePath();
  ctx.fillStyle = COLORS.healthTop;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,4,4,0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; // the wet shine
  ctx.beginPath(); ctx.arc(w * 0.4, h * 0.58, 1.4, 0, Math.PI * 2); ctx.fill();
}

function scarMark(ctx, w, h) { // one stitched slash
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = COLORS.stoneHi;
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(w * 0.15, h * 0.85); ctx.lineTo(w * 0.85, h * 0.15); ctx.stroke();
  ctx.strokeStyle = COLORS.textFaint;
  ctx.lineWidth = 1;
  for (const t of [0.3, 0.55, 0.8]) { // cross-stitches
    const cx = w * (0.15 + 0.7 * t), cy = h * (0.85 - 0.7 * t);
    ctx.beginPath(); ctx.moveTo(cx - 2, cy - 2); ctx.lineTo(cx + 2, cy + 2); ctx.stroke();
  }
}

export function generateIconArt(reg) {
  for (const [name, paint] of Object.entries(abilityPainters)) {
    reg.make(`icon.${name}`, ICON, ICON, paint);
  }
  for (const kind of ['cogwheel', 'puzzle', 'rows', 'save', 'tune']) {
    reg.make(`ui.${kind}`, 32, 32, uiIconPaint(kind, 'normal'));
    reg.make(`ui.${kind}.active`, 32, 32, uiIconPaint(kind, 'active'));
  }
  reg.make('ui.cogwheel.grayscale', 32, 32, uiIconPaint('cogwheel', 'grayscale'));

  reg.make('currency.gold', 16, 16, coin('#e8cf7a', '#8a6a1e', 'rgba(90,60,10,0.9)'));
  reg.make('currency.silver', 16, 16, coin('#d8dee0', '#6a7a80', 'rgba(40,55,60,0.9)'));
  reg.make('currency.copper', 16, 16, coin('#d89a6a', '#7a4a26', 'rgba(70,35,12,0.9)'));

  reg.make('portrait.player', 56, 56, circular(portraitPlayer));
  reg.make('portrait.target', 56, 56, circular(portraitDeepOne));
  reg.make('portrait.keeper', 56, 56, circular(portraitKeeper));
  reg.make('portrait.brine', 56, 56, circular(portraitBrine));
  reg.make('minimap.image', 256, 256, minimapImage);
  reg.make('minimap.maskCircle', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); ctx.fill();
  }, { data: true });
  reg.make('dot.enemy', 10, 10, dotPainter(COLORS.enemy, COLORS.enemyBorder));
  reg.make('dot.ally', 10, 10, dotPainter(COLORS.ally, COLORS.allyBorder));
  reg.make('fill.health', 8, 20, barFill(COLORS.healthTop, COLORS.healthMid, COLORS.healthBot));
  reg.make('fill.mana', 8, 20, barFill(COLORS.manaTop, COLORS.manaMid, COLORS.manaBot));
  reg.make('doll.character', 120, 200, paperDoll);
  // the speaking stones (re-sculpted): each plate is one FIG_BANDS
  // slice of THE anatomical figure, so the assembly shares the investigator's anatomy
  reg.make('doll.part.head', 42, 46, partPlate('head', 'head'));
  reg.make('doll.part.neck', 38, 30, partPlate('neck', 'neck'));
  reg.make('doll.part.back', 70, 30, partPlate('back', 'back'));
  reg.make('doll.part.chest', 60, 56, partPlate('chest', 'chest'));
  reg.make('doll.part.gut', 56, 56, partPlate('gut', 'gut'));
  reg.make('doll.part.arml', 25, 126, partPlate('arml', 'arm', 1));
  reg.make('doll.part.armr', 25, 126, partPlate('armr', 'arm', -1));
  reg.make('doll.part.handl', 24, 48, partPlate('handl', 'hand', 1));
  reg.make('doll.part.handr', 24, 48, partPlate('handr', 'hand', -1));
  reg.make('doll.part.legl', 26, 120, partPlate('legl', 'leg', 1));
  reg.make('doll.part.legr', 26, 120, partPlate('legr', 'leg', -1));
  reg.make('doll.part.footl', 30, 35, partPlate('footl', 'foot', 1));
  reg.make('doll.part.footr', 30, 35, partPlate('footr', 'foot', -1));
  // the hover outlines: one per plate, stroke-only accent along the SAME
  // band path — the doll's border highlight (+13 atlas, a recorded budget raise)
  reg.make('doll.hover.head', 42, 46, partOutline('head', 'head'));
  reg.make('doll.hover.neck', 38, 30, partOutline('neck', 'neck'));
  reg.make('doll.hover.back', 70, 30, partOutline('back', 'back'));
  reg.make('doll.hover.chest', 60, 56, partOutline('chest', 'chest'));
  reg.make('doll.hover.gut', 56, 56, partOutline('gut', 'gut'));
  reg.make('doll.hover.arml', 25, 126, partOutline('arml', 'arm', 1));
  reg.make('doll.hover.armr', 25, 126, partOutline('armr', 'arm', -1));
  reg.make('doll.hover.handl', 24, 48, partOutline('handl', 'hand', 1));
  reg.make('doll.hover.handr', 24, 48, partOutline('handr', 'hand', -1));
  reg.make('doll.hover.legl', 26, 120, partOutline('legl', 'leg', 1));
  reg.make('doll.hover.legr', 26, 120, partOutline('legr', 'leg', -1));
  reg.make('doll.hover.footl', 30, 35, partOutline('footl', 'foot', 1));
  reg.make('doll.hover.footr', 30, 35, partOutline('footr', 'foot', -1));
  reg.make('mark.bleed', 16, 16, bleedMark);
  reg.make('mark.scar', 12, 12, scarMark);
  reg.make('mark.exclaim', 16, 16, questMark('!'));
  reg.make('mark.question', 16, 16, questMark('?'));
  reg.make('minimap.pin', 24, 24, playerPin);
  reg.make('lock.locked', 20, 20, lockIcon(true));
  reg.make('lock.unlocked', 20, 20, lockIcon(false));
}

// The ability ID LIST survives the purge as DATA: palettes and pages
// iterate these names, ABILITY_DATA narrates them, and the art comes from the
// REAL pack via per-page loadIcons aliases (an un-aliased name shows the loud
// fallback plate). Only the painters died.
export const ABILITY_ICON_IDS = [
  'fireball', 'fireball2', 'shield', 'sword', 'arrows',
  'blindinglight', 'book', 'deathkiss', 'leafs',
];

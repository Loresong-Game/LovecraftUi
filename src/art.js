// Procedural stonework painters: every frame/control texture LovecraftUI uses.
// All drawing happens once at init into 2x canvases via the TextureRegistry.
// Deterministic (seeded RNG) so the masonry is identical every load.

import { seededRandom } from './texgen.js';
import { COLORS, socketInsetRaw } from './theme.js';

// ---------- low-level stone helpers ----------

function noiseOverlay(ctx, x, y, w, h, rng, { amount = 0.10, cell = 3, light = '#ffffff', dark = '#000000' } = {}) {
  for (let py = y; py < y + h; py += cell) {
    for (let px = x; px < x + w; px += cell) {
      const v = rng();
      if (v < 0.33) { ctx.fillStyle = dark; ctx.globalAlpha = amount * rng(); }
      else if (v > 0.67) { ctx.fillStyle = light; ctx.globalAlpha = amount * 0.7 * rng(); }
      else continue;
      ctx.fillRect(px, py, cell, cell);
    }
  }
  ctx.globalAlpha = 1;
}

function stoneBase(ctx, x, y, w, h, rng, { base = COLORS.stoneMid, grad = 0.18 } = {}) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(base, grad));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shade(base, -grad));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  noiseOverlay(ctx, x, y, w, h, rng, { amount: 0.12, cell: 2 });
}

export function shade(hex, amt) {
  // amt in [-1, 1]: negative darkens, positive lightens
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function crack(ctx, x0, y0, len, rng, { color = 'rgba(8,10,9,0.55)', width = 1 } = {}) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  let x = x0, y = y0;
  let ang = rng() * Math.PI * 2;
  const steps = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < steps; i++) {
    ang += (rng() - 0.5) * 1.4;
    const d = len * (0.2 + rng() * 0.3);
    x += Math.cos(ang) * d; y += Math.sin(ang) * d;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function mossPatch(ctx, x, y, r, rng, alpha = 0.28) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(46,82,56,${alpha})`);
  g.addColorStop(1, 'rgba(46,82,56,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

// Beveled edge: light on top/left, dark on bottom/right (flip for inset).
function bevel(ctx, x, y, w, h, d, { inset = false, strength = 0.35 } = {}) {
  const lite = `rgba(220,235,222,${strength * 0.5})`;
  const dark = `rgba(0,0,0,${strength})`;
  const top = inset ? dark : lite, bot = inset ? lite : dark;
  ctx.fillStyle = top;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - d, y + d); ctx.lineTo(x + d, y + d); ctx.lineTo(x + d, y + h - d); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = bot;
  ctx.beginPath(); ctx.moveTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x + d, y + h - d); ctx.lineTo(x + w - d, y + h - d); ctx.lineTo(x + w - d, y + d); ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
}

// ---------- registration entry ----------

export function generateCoreArt(reg) {
  const F = 16; // window frame CSS border (must match METRICS.windowFrame)

  // Window / popup stone frame (9-slice, slim). 9-slice edge bands stretch along one axis,
  // so edge pixels vary only PERPENDICULAR to it (pure gradients); detail lives in the corners.
  reg.makeFrame('window.frame', 128, 128, F, (ctx, w, h) => {
    const rng = seededRandom(11);
    // void center — fully opaque: window bodies must never ghost the content beneath them
    ctx.fillStyle = 'rgb(7,10,9)';
    ctx.fillRect(0, 0, w, h);
    const band = (x, y, bw, bh, horiz) => {
      const g = horiz
        ? ctx.createLinearGradient(0, y, 0, y + bh)
        : ctx.createLinearGradient(x, 0, x + bw, 0);
      const lo = shade(COLORS.stoneMid, -0.25), mid = shade(COLORS.stoneMid, 0.08), hi = shade(COLORS.stoneMid, 0.2);
      const flip = (horiz && y > h / 2) || (!horiz && x > w / 2);
      g.addColorStop(0, flip ? lo : hi);
      g.addColorStop(0.45, mid);
      g.addColorStop(1, flip ? hi : lo);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, bw, bh);
    };
    const B = F - 3; // stone band thickness inside a 1.5px dark rim
    band(0, 1.5, w, B, true);            // top
    band(0, h - 1.5 - B, w, B, true);    // bottom
    band(1.5, 0, B, h, false);           // left
    band(w - 1.5 - B, 0, B, h, false);   // right
    // corner keystones (fixed regions -> can hold detail)
    for (const [cx, cy] of [[0, 0], [w - F, 0], [0, h - F], [w - F, h - F]]) {
      ctx.fillStyle = shade(COLORS.stoneMid, 0.12);
      ctx.fillRect(cx + 1.5, cy + 1.5, F - 3, F - 3);
      noiseOverlay(ctx, cx + 1.5, cy + 1.5, F - 3, F - 3, rng, { amount: 0.08, cell: 2 });
      bevel(ctx, cx + 1.5, cy + 1.5, F - 3, F - 3, 2, { strength: 0.3 });
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 2, cy + 2, F - 4, F - 4);
    }
    // outer rim + inner accent hairline + inner shadow
    ctx.strokeStyle = 'rgba(3,5,4,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.strokeStyle = 'rgba(111,209,139,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(F - 1.5, F - 1.5, w - 2 * F + 3, h - 2 * F + 3);
    const g = ctx.createLinearGradient(0, F, 0, F + 14);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(F, F, w - 2 * F, 14);
  });

  // Header plaque: plain smooth lintel (9-slice; small plain caps only round the corners).
  reg.makeFrame('window.header', 128, 28, { t: 0, r: 8, b: 0, l: 8 }, (ctx, w, h) => {
    roundRect(ctx, 0.75, 0.75, w - 1.5, h - 1.5, 3);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, shade(COLORS.stoneMid, 0.2));
    g.addColorStop(0.45, shade(COLORS.stoneMid, 0.02));
    g.addColorStop(1, shade(COLORS.stoneMid, -0.28));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    roundRect(ctx, 0.75, 0.75, w - 1.5, h - 1.5, 3);
    ctx.clip();
    ctx.fillStyle = 'rgba(230,240,230,0.14)';
    ctx.fillRect(0, 1, w, 1.2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, h - 2, w, 2);
    ctx.restore();
    roundRect(ctx, 0.75, 0.75, w - 1.5, h - 1.5, 3);
    ctx.strokeStyle = 'rgba(3,5,4,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Window control buttons (min/max/close) — one unified stone style, glyphs in one line weight.
  const controlBtn = (glyph, hover) => (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 3);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, shade(COLORS.stoneDark, hover ? 0.16 : 0.08));
    g.addColorStop(1, shade(COLORS.stoneDark, hover ? -0.02 : -0.16));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(3,5,4,0.9)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, 1, 1, w - 2, h - 2, 3);
    ctx.stroke();
    bevel(ctx, 2, 2, w - 4, h - 4, 1.5, { strength: hover ? 0.3 : 0.2 });
    const glowColor = glyph === 'close' ? '#d96a5a' : COLORS.accent;
    ctx.strokeStyle = hover ? glowColor : '#a8b5a5';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (hover) { ctx.shadowColor = glowColor; ctx.shadowBlur = 5; }
    const c = w / 2, r = 5;
    ctx.beginPath();
    if (glyph === 'min') {
      ctx.moveTo(c - r, c + r - 1); ctx.lineTo(c + r, c + r - 1);
    } else if (glyph === 'max') {
      ctx.rect(c - r, c - r + 1, 2 * r, 2 * r - 2);
    } else { // close
      ctx.moveTo(c - r, c - r); ctx.lineTo(c + r, c + r);
      ctx.moveTo(c + r, c - r); ctx.lineTo(c - r, c + r);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
  for (const kind of ['min', 'max', 'close']) {
    reg.make(`window.btn.${kind}`, 28, 28, controlBtn(kind, false));
    reg.make(`window.btn.${kind}.hover`, 28, 28, controlBtn(kind, true));
  }

  // Large button (9-slice, asymmetric: heavier base like a carved pedestal).
  // STRETCH-SAFE since : the slice's stretch zones (center + edge bands) carry only
  // gradients that scale cleanly in every direction; per-pixel detail (noise, cracks)
  // lives ONLY in the four fixed corners. The meta-screens garbling was 2px noise
  // cells and random cracks smeared 3–4× across the center band — a 420px SaveSlot
  // card and a 64px plate now both read as cut stone from ONE bake.
  const BTN = { t: 10, r: 20, b: 16, l: 20 };
  const button = (state) => (ctx, w, h) => {
    const rng = seededRandom(43);
    ctx.clearRect(0, 0, w, h);
    const base = state === 'pressed' ? shade(COLORS.stoneDark, 0.04)
      : state === 'hover' ? shade(COLORS.stoneMid, 0.10)
      : state === 'disabled' ? '#20241f' : COLORS.stoneMid;
    // pedestal silhouette: slab + base lip — the slab wears a vertical sheen
    // (varies only along y, so horizontal AND vertical stretches both stay smooth)
    roundRect(ctx, 1, 1, w - 2, h - 5, 6);
    if (state === 'disabled') {
      // A dead slab is FLAT and SUNKEN (the pager report: "on page 1 the
 // left button should be obviously off"). The old disabled face kept the
      // normal state's sheen, raised bevel and lip at a marginally darker base -
      // side by side with a live button the two read identical. Flat fill, no
      // sheen; the bevel below goes weak and INSET so the slab sits in the stone
      // instead of standing proud of it.
      ctx.fillStyle = base; ctx.fill();
    } else {
      const sheen = ctx.createLinearGradient(0, 1, 0, h - 4);
      sheen.addColorStop(0, shade(base, 0.06));
      sheen.addColorStop(0.45, base);
      sheen.addColorStop(1, shade(base, -0.08));
      ctx.fillStyle = sheen; ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 2; ctx.stroke();
    // base lip (uniform along x — stretch-safe by nature)
    ctx.fillStyle = shade(base, state === 'disabled' ? -0.12 : -0.25);
    roundRect(ctx, 3, h - 9, w - 6, 7, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    // stone grain in the four FIXED corners only — never in a stretch zone
    if (state !== 'disabled') {
      noiseOverlay(ctx, 2, 2, BTN.l - 4, BTN.t - 2, rng, { amount: 0.14, cell: 2 });
      noiseOverlay(ctx, w - BTN.r + 2, 2, BTN.r - 4, BTN.t - 2, rng, { amount: 0.14, cell: 2 });
      noiseOverlay(ctx, 2, h - BTN.b + 1, BTN.l - 4, BTN.b - 8, rng, { amount: 0.14, cell: 2 });
      noiseOverlay(ctx, w - BTN.r + 2, h - BTN.b + 1, BTN.r - 4, BTN.b - 8, rng, { amount: 0.14, cell: 2 });
    }
    bevel(ctx, 2, 2, w - 4, h - 7, 3, {
      strength: state === 'pressed' ? 0.18 : state === 'disabled' ? 0.12 : 0.38,
      inset: state === 'pressed' || state === 'disabled',
    });
    // hairline cracks anchored inside the corner insets
    crack(ctx, 5 + rng() * 9, 4 + rng() * 4, 5, rng);
    crack(ctx, w - 16 + rng() * 8, h - 15 + rng() * 5, 5, rng);
    // carved end ornaments
    ctx.strokeStyle = state === 'hover' ? COLORS.accent : 'rgba(111,209,139,0.35)';
    if (state === 'disabled') ctx.strokeStyle = 'rgba(120,130,120,0.2)';
    ctx.lineWidth = 1.2;
    for (const ex of [10, w - 10]) {
      ctx.beginPath();
      ctx.moveTo(ex, h / 2 - 8); ctx.lineTo(ex + (ex < w / 2 ? 4 : -4), h / 2 - 2); ctx.lineTo(ex, h / 2 + 4);
      ctx.stroke();
    }
    if (state === 'hover') {
      ctx.strokeStyle = COLORS.accentGlow;
      ctx.lineWidth = 2.5;
      roundRect(ctx, 2.5, 2.5, w - 5, h - 8, 5); ctx.stroke();
    }
    if (state === 'pressed') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      roundRect(ctx, 2, 2, w - 4, h - 7, 5); ctx.fill();
    }
  };
  for (const s of ['normal', 'hover', 'pressed', 'disabled']) {
    reg.makeFrame(`button.${s}`, 128, 44, BTN, button(s));
  }

  // Text field (recessed channel; 9-slice 8). : the declared insets MATCH the
  // art's ~7.5px visual chrome now — the old 12 overstated the recess, so every
  // field's content box lied 4px per side to the audit (the census's
  // field-art-inset class). Stretch-safe per the rule: grain in the four
  // FIXED corners only; the lip fill, void, bevel, and state rings are all
  // uniform along their bands.
  const FLD = 8;
  const field = (state) => (ctx, w, h) => {
    const rng = seededRandom(59);
    ctx.clearRect(0, 0, w, h);
    // outer stone lip
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 5);
    ctx.fillStyle = shade(COLORS.stoneMid, state === 'hover' ? 0.08 : 0); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1; ctx.stroke();
    noiseOverlay(ctx, 1, 1, FLD - 2, FLD - 2, rng, { amount: 0.10, cell: 2 });
    noiseOverlay(ctx, w - FLD + 1, 1, FLD - 2, FLD - 2, rng, { amount: 0.10, cell: 2 });
    noiseOverlay(ctx, 1, h - FLD + 1, FLD - 2, FLD - 2, rng, { amount: 0.10, cell: 2 });
    noiseOverlay(ctx, w - FLD + 1, h - FLD + 1, FLD - 2, FLD - 2, rng, { amount: 0.10, cell: 2 });
    // recessed void
    roundRect(ctx, 5, 5, w - 10, h - 10, 3);
    ctx.fillStyle = 'rgba(5,8,7,0.95)'; ctx.fill();
    bevel(ctx, 5, 5, w - 10, h - 10, 2.5, { inset: true, strength: 0.5 });
    if (state === 'focus') {
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = COLORS.accent; ctx.shadowBlur = 5;
      roundRect(ctx, 5, 5, w - 10, h - 10, 3); ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (state === 'hover') {
      ctx.strokeStyle = 'rgba(111,209,139,0.35)';
      ctx.lineWidth = 1;
      roundRect(ctx, 5, 5, w - 10, h - 10, 3); ctx.stroke();
    }
  };
  for (const s of ['normal', 'hover', 'focus']) reg.makeFrame(`field.${s}`, 96, 36, FLD, field(s));

  // Resource chip (the design requirement): channel + icon plate baked AT CHIP SIZE
  // (96×26 / 26×26) — never the 36px field art squeezed to 26. The recessed
  // value channel spans the chip behind the text; the bordered plate is the
  // full-height, edge-justified icon cell. Grain follows the corner rule.
  reg.makeFrame('chip.frame', 96, 26, 6, (ctx, w, h) => {
    const rng = seededRandom(67);
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 4);
    ctx.fillStyle = COLORS.stoneMid; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1; ctx.stroke();
    noiseOverlay(ctx, 1, 1, 4, 4, rng, { amount: 0.10, cell: 2 });
    noiseOverlay(ctx, w - 5, 1, 4, 4, rng, { amount: 0.10, cell: 2 });
    noiseOverlay(ctx, 1, h - 5, 4, 4, rng, { amount: 0.10, cell: 2 });
    noiseOverlay(ctx, w - 5, h - 5, 4, 4, rng, { amount: 0.10, cell: 2 });
    roundRect(ctx, 3, 3, w - 6, h - 6, 3);
    ctx.fillStyle = 'rgba(5,8,7,0.95)'; ctx.fill();
    bevel(ctx, 3, 3, w - 6, h - 6, 2, { inset: true, strength: 0.45 });
  });
  reg.make('chip.plate', 26, 26, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 4);
    ctx.fillStyle = shade(COLORS.stoneMid, -0.05); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1; ctx.stroke();
    roundRect(ctx, 2.5, 2.5, w - 5, h - 5, 3);
    ctx.fillStyle = 'rgba(5,8,7,0.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(111,209,139,0.28)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Tooltip frame: void slab with thin bone border (9-slice 8)
  reg.makeFrame('tooltip.frame', 64, 64, 8, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 4);
    ctx.fillStyle = 'rgba(7,10,9,0.94)'; ctx.fill();
    ctx.strokeStyle = 'rgba(216,205,170,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    roundRect(ctx, 3.5, 3.5, w - 7, h - 7, 3);
    ctx.strokeStyle = 'rgba(111,209,139,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Dropdown list frame (9-slice 8): like tooltip but heavier
  reg.makeFrame('dropdown.frame', 64, 64, 8, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 3);
    ctx.fillStyle = 'rgba(9,13,11,0.97)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    roundRect(ctx, 2.5, 2.5, w - 5, h - 5, 2);
    ctx.strokeStyle = 'rgba(111,209,139,0.3)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Generic translucent panel (cards, palette, log, quest tracker) — 9-slice 6.
  // Body fill is the themable COLORS.panelFill: a visible step off the abyss.
  reg.makeFrame('panel.dark', 48, 48, 6, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 5);
    ctx.fillStyle = COLORS.panelFill; ctx.fill();
    ctx.strokeStyle = 'rgba(57,68,58,0.8)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Action slot: stone socket (48). Fixed-size texture.
  reg.make('slot.frame', 48, 48, (ctx, w, h) => {
    const rng = seededRandom(71);
    stoneBase(ctx, 0, 0, w, h, rng, { base: COLORS.stoneDark });
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    bevel(ctx, 1.5, 1.5, w - 3, h - 3, 2.5, { strength: 0.32 });
    // recessed socket
    // so a stretch to a neighboring box size keeps the ratio (theme.js)
    const si = socketInsetRaw(w);
    ctx.fillStyle = 'rgba(4,6,5,0.92)';
    roundRect(ctx, si, si, w - si * 2, h - si * 2, 3); ctx.fill();
    bevel(ctx, si, si, w - si * 2, h - si * 2, 2.5, { inset: true, strength: 0.5 });
    // corner chisel marks
    ctx.strokeStyle = 'rgba(111,209,139,0.22)'; ctx.lineWidth = 1;
    for (const [cx, cy, dx, dy] of [[3, 3, 1, 1], [w - 3, 3, -1, 1], [3, h - 3, 1, -1], [w - 3, h - 3, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + dx * 4, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * 4); ctx.stroke();
    }
  });

  // Slot hover overlay + cooldown veil (drawn as full-size overlays)
  reg.make('slot.hover', 48, 48, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(111,209,139,0.34)');
    g.addColorStop(0.8, 'rgba(111,209,139,0.12)');
    g.addColorStop(1, 'rgba(111,209,139,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(111,209,139,0.65)'; ctx.lineWidth = 1.6;
    roundRect(ctx, 3, 3, w - 6, h - 6, 3); ctx.stroke();
  });
  reg.make('slot.cooldown', 48, 48, (ctx, w, h) => {
    const rng = seededRandom(83);
    ctx.clearRect(0, 0, w, h);
    const si = socketInsetRaw(w);
    ctx.fillStyle = 'rgba(4,6,8,0.72)';
    roundRect(ctx, si, si, w - si * 2, h - si * 2, 3); ctx.fill();
    // swirling void
    ctx.strokeStyle = 'rgba(123,95,174,0.5)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const r0 = 5 + i * 5;
      for (let a = 0; a < Math.PI * 1.6; a += 0.3) {
        const r = r0 + a * 1.8;
        const x = w / 2 + Math.cos(a + i * 2.1) * r * 0.55;
        const y = h / 2 + Math.sin(a + i * 2.1) * r * 0.55;
        if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    noiseOverlay(ctx, si, si, w - si * 2, h - si * 2, rng, { amount: 0.15, cell: 2, light: '#7b5fae' });
  });

  // CP (equipment) slot 44 + highlight
  reg.make('cpslot.frame', 44, 44, (ctx, w, h) => {
    const rng = seededRandom(97);
    stoneBase(ctx, 0, 0, w, h, rng, { base: '#232823' });
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.6;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    const si = socketInsetRaw(w); // the socket law
    ctx.fillStyle = 'rgba(5,7,6,0.9)';
    roundRect(ctx, si, si, w - si * 2, h - si * 2, 2); ctx.fill();
    bevel(ctx, si, si, w - si * 2, h - si * 2, 2, { inset: true, strength: 0.45 });
  });
  reg.make('cpslot.hover', 44, 44, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(111,209,139,0.6)'; ctx.lineWidth = 1.6;
    roundRect(ctx, 2.5, 2.5, w - 5, h - 5, 2); ctx.stroke();
    ctx.fillStyle = 'rgba(111,209,139,0.10)';
    roundRect(ctx, 3, 3, w - 6, h - 6, 2); ctx.fill();
  });

  // Item slot (44): a leather-dark pouch socket, plus a tintable rarity ring overlay
  // (drawn white; the widget tints it with the COLORS.rarity* token). Family: itemslot.*
  reg.make('itemslot.frame', 44, 44, (ctx, w, h) => {
    const rng = seededRandom(181);
    stoneBase(ctx, 0, 0, w, h, rng, { base: COLORS.stoneDark, grad: 0.12 });
    ctx.strokeStyle = 'rgba(0,0,0,0.88)'; ctx.lineWidth = 1.6;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    bevel(ctx, 1.5, 1.5, w - 3, h - 3, 2, { strength: 0.28 });
    // a deeper pouch than the rite socket: items nest, rites blaze
    const si = socketInsetRaw(w); // the socket law
    ctx.fillStyle = 'rgba(3,5,4,0.94)';
    roundRect(ctx, si, si, w - si * 2, h - si * 2, 4); ctx.fill();
    bevel(ctx, si, si, w - si * 2, h - si * 2, 2.5, { inset: true, strength: 0.55 });
    mossPatch(ctx, w - 8, 8, 6, rng, 0.18);
  });
  reg.make('itemslot.rarity', 44, 44, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,255,255,0.55)'; ctx.shadowBlur = 4;
    roundRect(ctx, 2, 2, w - 4, h - 4, 4); ctx.stroke();
    ctx.shadowBlur = 0;
  });

  // Graph node plates (56): one stone cut, four fates — locked recedes, available
  // invites, owned glows verdigris, maxed wears gilt (the talent grid's
 // full-rank read). Family: graphnode.* (+ hover/highlight overlays).
  const GN = 56;
  const graphPlate = (state) => (ctx, w, h) => {
    const rng = seededRandom(179);
    ctx.clearRect(0, 0, w, h);
    stoneBase(ctx, 0, 0, w, h, rng, { base: state === 'owned' ? COLORS.mossDark : COLORS.stoneDark });
    if (state === 'locked') { ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(0, 0, w, h); }
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    bevel(ctx, 1.5, 1.5, w - 3, h - 3, 2.5, { strength: state === 'locked' ? 0.2 : 0.32 });
    // recessed socket for the rite's sigil (the slot.frame idiom; law)
    const si = socketInsetRaw(w);
    ctx.fillStyle = state === 'locked' ? 'rgba(3,4,4,0.94)' : 'rgba(4,6,5,0.92)';
    roundRect(ctx, si, si, w - si * 2, h - si * 2, 3); ctx.fill();
    bevel(ctx, si, si, w - si * 2, h - si * 2, 2.5, { inset: true, strength: 0.5 });
    if (state === 'locked') {
      crack(ctx, 12 + rng() * (w - 24), 10 + rng() * 12, 9, rng);
      crack(ctx, 10 + rng() * 14, h - 20 + rng() * 8, 8, rng);
    }
    if (state === 'available') {
      // accent corner chisels: a socket awaiting its rite
      ctx.strokeStyle = COLORS.accentBorder; ctx.lineWidth = 1;
      for (const [cx, cy, dx, dy] of [[3, 3, 1, 1], [w - 3, 3, -1, 1], [3, h - 3, 1, -1], [w - 3, h - 3, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(cx + dx * 5, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * 5); ctx.stroke();
      }
    }
    if (state === 'owned') {
      // verdigris radiance: the rite lives here
      const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2 - 6);
      g.addColorStop(0, COLORS.accentFaint);
      g.addColorStop(1, 'rgba(111,209,139,0)');
      ctx.fillStyle = g;
      roundRect(ctx, si, si, w - si * 2, h - si * 2, 3); ctx.fill();
      ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.6;
      ctx.shadowColor = COLORS.accentGlow; ctx.shadowBlur = 5;
      roundRect(ctx, 3.5, 3.5, w - 7, h - 7, 3); ctx.stroke();
      ctx.shadowBlur = 0;
      mossPatch(ctx, 9, h - 9, 9, rng);
    }
  };
  for (const s of ['locked', 'available', 'owned']) reg.make(`graphnode.${s}`, GN, GN, graphPlate(s));
  reg.make('graphnode.maxed', GN, GN, (ctx, w, h) => {
    // the fourth fate: a talent at full rank wears GILT — the owned cut
    // re-metaled gold so "maxed" reads across the room (the WoW-Classic law)
    const rng = seededRandom(179);
    ctx.clearRect(0, 0, w, h);
    stoneBase(ctx, 0, 0, w, h, rng, { base: COLORS.stoneMid });
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    bevel(ctx, 1.5, 1.5, w - 3, h - 3, 2.5, { strength: 0.32 });
    const si = socketInsetRaw(w); // the socket law
    ctx.fillStyle = 'rgba(4,6,5,0.92)';
    roundRect(ctx, si, si, w - si * 2, h - si * 2, 3); ctx.fill();
    bevel(ctx, si, si, w - si * 2, h - si * 2, 2.5, { inset: true, strength: 0.5 });
    const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2 - 6);
    g.addColorStop(0, COLORS.talentGoldGlow);
    g.addColorStop(1, 'rgba(232,200,106,0)');
    ctx.fillStyle = g;
    roundRect(ctx, si, si, w - si * 2, h - si * 2, 3); ctx.fill();
    ctx.strokeStyle = COLORS.talentGold; ctx.lineWidth = 1.8;
    ctx.shadowColor = COLORS.talentGoldGlow; ctx.shadowBlur = 6;
    roundRect(ctx, 3.5, 3.5, w - 7, h - 7, 3); ctx.stroke();
    ctx.shadowBlur = 0;
  });
  reg.make('graphnode.hover', GN, GN, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(111,209,139,0.34)');
    g.addColorStop(0.8, 'rgba(111,209,139,0.12)');
    g.addColorStop(1, 'rgba(111,209,139,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(111,209,139,0.65)'; ctx.lineWidth = 1.6;
    roundRect(ctx, 3, 3, w - 6, h - 6, 3); ctx.stroke();
  });
  reg.make('graphnode.highlight', GN, GN, (ctx, w, h) => {
    // persistent chain ring — no fill wash, so it reads beneath and beside the hover glow
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2;
    ctx.shadowColor = COLORS.accentGlow; ctx.shadowBlur = 5;
    roundRect(ctx, 2, 2, w - 4, h - 4, 3); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = COLORS.accentFaint; ctx.lineWidth = 1;
    roundRect(ctx, 4, 4, w - 8, h - 8, 3); ctx.stroke();
  });

  // Toggle (24) normal/hover/checked — carved stone box; check = glowing elder sign stroke
  const toggle = (state) => (ctx, w, h) => {
    const rng = seededRandom(101);
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 4);
    ctx.fillStyle = shade(COLORS.stoneMid, state === 'hover' ? 0.12 : 0); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
    noiseOverlay(ctx, 2, 2, w - 4, h - 4, rng, { amount: 0.12, cell: 2 });
    roundRect(ctx, 4.5, 4.5, w - 9, h - 9, 2);
    ctx.fillStyle = 'rgba(5,8,7,0.92)'; ctx.fill();
    bevel(ctx, 4.5, 4.5, w - 9, h - 9, 1.8, { inset: true, strength: 0.5 });
    if (state === 'checked') {
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.shadowColor = COLORS.accent; ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.moveTo(6, 12.5); ctx.lineTo(10.5, 17); ctx.lineTo(18, 7);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  };
  for (const s of ['normal', 'hover', 'checked']) reg.make(`toggle.${s}`, 24, 24, toggle(s));

  // Radio (20) normal/hover/checked — round socket with glowing eye pupil
  const radio = (state) => (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = shade(COLORS.stoneMid, state === 'hover' ? 0.12 : 0); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5,8,7,0.92)'; ctx.fill();
    if (state === 'checked') {
      ctx.shadowColor = COLORS.accent; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.accent; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(5,8,7,0.9)';
      ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 1.1, 2.6, 0, 0, Math.PI * 2); ctx.fill(); // slit pupil
    }
  };
  for (const s of ['normal', 'hover', 'checked']) reg.make(`radio.${s}`, 20, 20, radio(s));

  // Slider track (9-slice l/r 16) + thumb states
  reg.makeFrame('slider.track', 128, 20, { t: 0, r: 16, b: 0, l: 16 }, (ctx, w, h) => {
    const rng = seededRandom(113);
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, h / 2 - 5, w - 2, 10, 5);
    ctx.fillStyle = COLORS.stoneDark; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
    roundRect(ctx, 4, h / 2 - 2.4, w - 8, 4.8, 2.4);
    ctx.fillStyle = 'rgba(4,6,5,0.95)'; ctx.fill();
    bevel(ctx, 4, h / 2 - 2.4, w - 8, 4.8, 1.2, { inset: true, strength: 0.4 });
    noiseOverlay(ctx, 1, h / 2 - 5, w - 2, 10, rng, { amount: 0.10, cell: 2 });
  });
  const thumb = (state) => (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const r = w / 2 - 2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(w / 2 - 3, h / 2 - 3, 1, w / 2, h / 2, r);
    g.addColorStop(0, shade(COLORS.stoneHi, state === 'hover' ? 0.25 : state === 'pressed' ? -0.05 : 0.1));
    g.addColorStop(1, shade(COLORS.stoneDark, state === 'pressed' ? -0.2 : 0));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = state === 'hover' ? COLORS.accent : 'rgba(111,209,139,0.4)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r - 3, 0, Math.PI * 2); ctx.stroke();
  };
  for (const s of ['normal', 'hover', 'pressed']) reg.make(`slider.thumb.${s}`, 24, 24, thumb(s));

  // Scrollbar: track texture + thumb 9-slice states
  reg.make('scrollbar.track', 14, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#0c100e'); g.addColorStop(0.5, '#141a16'); g.addColorStop(1, '#0c100e');
    ctx.fillStyle = g; ctx.fillRect(1, 0, w - 2, h);
    ctx.strokeStyle = 'rgba(42,51,44,0.8)'; ctx.lineWidth = 1;
    ctx.strokeRect(1.5, 0.5, w - 3, h - 1);
  });
  const sbThumb = (state) => (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 3);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    const base = state === 'hover' ? 0.16 : state === 'pressed' ? -0.12 : 0;
    g.addColorStop(0, shade('#3c463e', base + 0.08));
    g.addColorStop(0.5, shade('#2e3830', base));
    g.addColorStop(1, shade('#232b25', base));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = state === 'hover' ? 'rgba(111,209,139,0.6)' : 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1; ctx.stroke();
    // grip notches
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(3, h / 2 + i * 4); ctx.lineTo(w - 3, h / 2 + i * 4); ctx.stroke();
    }
  };
  for (const s of ['normal', 'hover', 'pressed']) {
    reg.makeFrame(`scrollbar.thumb.${s}`, 12, 40, { t: 8, r: 3, b: 8, l: 3 }, sbThumb(s));
  }

  // Horizontal lane: same family rotated — gradient runs across the lane height,
  // caps on the left/right, grip notches vertical.
  reg.make('scrollbar.trackH', 64, 14, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0c100e'); g.addColorStop(0.5, '#141a16'); g.addColorStop(1, '#0c100e');
    ctx.fillStyle = g; ctx.fillRect(0, 1, w, h - 2);
    ctx.strokeStyle = 'rgba(42,51,44,0.8)'; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 1.5, w - 1, h - 3);
  });
  const sbThumbH = (state) => (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 3);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    const base = state === 'hover' ? 0.16 : state === 'pressed' ? -0.12 : 0;
    g.addColorStop(0, shade('#3c463e', base + 0.08));
    g.addColorStop(0.5, shade('#2e3830', base));
    g.addColorStop(1, shade('#232b25', base));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = state === 'hover' ? 'rgba(111,209,139,0.6)' : 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(w / 2 + i * 4, 3); ctx.lineTo(w / 2 + i * 4, h - 3); ctx.stroke();
    }
  };
  for (const s of ['normal', 'hover', 'pressed']) {
    reg.makeFrame(`scrollbar.thumbH.${s}`, 40, 12, { t: 3, r: 8, b: 3, l: 8 }, sbThumbH(s));
  }

  // Resize grips: a knurled stone corner wedge, 24px (STYLE §7 floor), baked
  // once per corner via mirrored transforms. Drawn for the bottom-right; ridges
  // gather into the corner like a worn thumb-rest.
  const gripPainter = (fx, fy) => (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(fx < 0 ? w : 0, fy < 0 ? h : 0);
    ctx.scale(fx, fy);
    for (let i = 0; i < 3; i++) {
      const o = 7 + i * 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w - 3, h - o - 1); ctx.lineTo(w - o - 1, h - 3); ctx.stroke();
      ctx.strokeStyle = COLORS.stoneHi;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(w - 3, h - o); ctx.lineTo(w - o, h - 3); ctx.stroke();
    }
    ctx.restore();
  };
  reg.make('grip.br', 24, 24, gripPainter(1, 1));
  reg.make('grip.bl', 24, 24, gripPainter(-1, 1));
  reg.make('grip.tr', 24, 24, gripPainter(1, -1));
  reg.make('grip.tl', 24, 24, gripPainter(-1, -1));

  // Progress bar: bg + frame (9-slice {4,6}) and fill texture
  reg.makeFrame('progress.bg', 96, 32, { t: 4, r: 6, b: 4, l: 6 }, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 4);
    ctx.fillStyle = 'rgba(5,8,7,0.95)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1; ctx.stroke();
    bevel(ctx, 1, 1, w - 2, h - 2, 2, { inset: true, strength: 0.45 });
  });
  reg.makeFrame('progress.frame', 96, 32, { t: 4, r: 6, b: 4, l: 6 }, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = COLORS.stoneMid; ctx.lineWidth = 3;
    roundRect(ctx, 1.5, 1.5, w - 3, h - 3, 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1;
    roundRect(ctx, 3, 3, w - 6, h - 6, 3); ctx.stroke();
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 5); ctx.stroke();
  });
  reg.make('progress.fill', 128, 24, (ctx, w, h) => {
    const rng = seededRandom(137);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#79dd97'); g.addColorStop(0.45, '#3f8f5f'); g.addColorStop(1, '#1c4a33');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // luminous motes in the ichor
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(200,255,215,${0.08 + rng() * 0.22})`;
      const r = 0.6 + rng() * 1.8;
      ctx.beginPath(); ctx.arc(rng() * w, rng() * h, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, 0, w, 3);
  });

  // Taskbar strip: pure vertical gradient (stretches horizontally without artifacts)
  reg.make('taskbar.bg', 8, 50, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a221c');
    g.addColorStop(0.12, '#151c17');
    g.addColorStop(1, '#090d0a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(111,209,139,0.3)'; ctx.fillRect(0, 0, w, 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 2, w, 1);
  });

  // Taskbar item plate (9-slice 8)
  reg.makeFrame('taskbar.item', 64, 34, 8, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 4);
    ctx.fillStyle = 'rgba(24,32,26,0.9)'; ctx.fill();
    ctx.strokeStyle = 'rgba(74,90,76,0.8)'; ctx.lineWidth = 1; ctx.stroke();
  });
  reg.makeFrame('taskbar.item.hover', 64, 34, 8, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 4);
    ctx.fillStyle = 'rgba(38,52,42,0.95)'; ctx.fill();
    ctx.strokeStyle = COLORS.accentBorder; ctx.lineWidth = 1; ctx.stroke();
  });

  // Table header strip: plain 9-slice — gradient + accent base line, no end ornaments
  reg.makeFrame('table.header', 96, 36, { t: 0, r: 8, b: 0, l: 8 }, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, shade(COLORS.stoneMid, 0.18));
    g.addColorStop(0.5, shade(COLORS.stoneMid, 0));
    g.addColorStop(1, shade(COLORS.stoneMid, -0.26));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(230,240,230,0.12)'; ctx.fillRect(0, 1, w, 1);
    ctx.fillStyle = 'rgba(111,209,139,0.22)'; ctx.fillRect(0, h - 2.5, w, 2.5);
    ctx.strokeStyle = 'rgba(3,5,4,0.9)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
  });
  reg.make('table.row', 128, 32, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(14,19,16,0.75)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, h - 1, w, 1);
  });
  reg.make('table.rowAlt', 128, 32, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(6,9,8,0.6)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, h - 1, w, 1);
  });
  reg.make('table.rowHover', 128, 32, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(111,209,139,0.06)');
    g.addColorStop(0.5, 'rgba(111,209,139,0.16)');
    g.addColorStop(1, 'rgba(111,209,139,0.06)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(111,209,139,0.35)';
    ctx.fillRect(0, 0, w, 1); ctx.fillRect(0, h - 1, w, 1);
  });

  // Select arrow
  reg.make('select.arrow', 16, 16, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.accent;
    ctx.shadowColor = COLORS.accentGlow; ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.moveTo(3, 5); ctx.lineTo(w - 3, 5); ctx.lineTo(w / 2, h - 4);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Coachmark arrows: select.arrow's family, one wedge per pointing
  // direction — the callout aims them at the spotlit rect.
  const tutArrows = {
    up: [[3, 12], [13, 12], [8, 3]],
    down: [[3, 4], [13, 4], [8, 13]],
    left: [[12, 3], [12, 13], [3, 8]],
    right: [[4, 3], [4, 13], [13, 8]],
  };
  for (const [dir, pts] of Object.entries(tutArrows)) {
    reg.make(`tut.arrow.${dir}`, 16, 16, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS.accent;
      ctx.shadowColor = COLORS.accentGlow; ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  // Unit frame tablet (250x90): weathered stone slab with carved recess
  reg.make('unitframe.bg', 250, 90, (ctx, w, h) => {
    const rng = seededRandom(151);
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 8);
    ctx.fillStyle = COLORS.stoneMid; ctx.fill();
    ctx.save(); ctx.clip();
    noiseOverlay(ctx, 0, 0, w, h, rng, { amount: 0.13, cell: 2 });
    for (let i = 0; i < 8; i++) crack(ctx, rng() * w, rng() * h, 12, rng);
    mossPatch(ctx, 8, h - 8, 12, rng); mossPatch(ctx, w - 14, 8, 9, rng);
    // carved recess for content
    roundRect(ctx, 7, 7, w - 14, h - 14, 5);
    ctx.fillStyle = 'rgba(6,9,8,0.88)'; ctx.fill();
    bevel(ctx, 7, 7, w - 14, h - 14, 2.5, { inset: true, strength: 0.5 });
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, w - 2, h - 2, 8); ctx.stroke();
    bevel(ctx, 2, 2, w - 4, h - 4, 3, { strength: 0.3 });
  });

  // Avatar ring (62x62) + level badge (26x26)
  reg.make('avatar.ring', 62, 62, (ctx, w, h) => {
    const rng = seededRandom(157);
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.stoneLight; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.4; ctx.stroke();
    // chisel ticks around the ring
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const jitter = (rng() - 0.5) * 0.1;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a + jitter) * (w / 2 - 6), h / 2 + Math.sin(a + jitter) * (h / 2 - 6));
      ctx.lineTo(w / 2 + Math.cos(a + jitter) * (w / 2 - 3), h / 2 + Math.sin(a + jitter) * (h / 2 - 3));
      ctx.stroke();
    }
    // top accent gem
    ctx.fillStyle = COLORS.accent;
    ctx.shadowColor = COLORS.accent; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(w / 2, 4.5, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  });
  reg.make('level.badge', 26, 26, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    // octagonal carved seal
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      const x = w / 2 + Math.cos(a) * (w / 2 - 1.5), y = h / 2 + Math.sin(a) * (h / 2 - 1.5);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = COLORS.stoneDark; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = COLORS.accentBorder; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      const x = w / 2 + Math.cos(a) * (w / 2 - 4), y = h / 2 + Math.sin(a) * (h / 2 - 4);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
  });

  // Cast bar frame reuses progress frames; globe glass texture for orbs is in fx.js.

  // Minimap frame (200): stone ring with rune ticks; mask (radial alpha, data texture)
  reg.make('minimap.frame', 200, 200, (ctx, w, h) => {
    const rng = seededRandom(163);
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2, true);
    ctx.fillStyle = COLORS.stoneMid; ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2, true);
    ctx.clip();
    noiseOverlay(ctx, 0, 0, w, h, rng, { amount: 0.14, cell: 2 });
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * (w / 2 - 13), h / 2 + Math.sin(a) * (h / 2 - 13));
      ctx.lineTo(w / 2 + Math.cos(a) * (w / 2 - 3), h / 2 + Math.sin(a) * (h / 2 - 3));
      ctx.stroke();
    }
    mossPatch(ctx, w * 0.2, h * 0.9, 14, rng); mossPatch(ctx, w * 0.85, h * 0.2, 10, rng);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(111,209,139,0.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2); ctx.stroke();
    // north stud
    ctx.fillStyle = 'rgba(111,209,139,0.7)';
    ctx.beginPath(); ctx.arc(w / 2, 8, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(w / 2, 8, 2.4, 0, Math.PI * 2); ctx.stroke();
  });
  reg.make('minimap.btn', 28, 28, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 4);
    ctx.fillStyle = COLORS.stoneDark; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.2; ctx.stroke();
    bevel(ctx, 2, 2, w - 4, h - 4, 1.6, { strength: 0.3 });
  });
  reg.make('minimap.zone', 160, 26, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 1, 1, w - 2, h - 2, 5);
    ctx.fillStyle = 'rgba(7,10,9,0.85)'; ctx.fill();
    ctx.strokeStyle = 'rgba(216,205,170,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Cursors
  reg.makeCursor('claw', 26, 28, 2, 2, (ctx) => {
    // bone-pale pointer with a claw hook
    ctx.fillStyle = '#0a0d0b';
    ctx.strokeStyle = '#0a0d0b';
    ctx.lineWidth = 3; ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(2, 2); ctx.lineTo(2, 20); ctx.lineTo(7.5, 15.5);
      ctx.quadraticCurveTo(9, 20, 12, 23);
      ctx.quadraticCurveTo(11, 17.5, 12.5, 15);
      ctx.lineTo(18, 15);
      ctx.closePath();
    };
    path(); ctx.stroke();
    ctx.fillStyle = '#d8cdaa';
    path(); ctx.fill();
    ctx.fillStyle = 'rgba(111,209,139,0.85)';
    ctx.beginPath(); ctx.arc(5.4, 6.6, 1.2, 0, Math.PI * 2); ctx.fill();
  });

  // keyboard/gamepad focus ring: verdigris double line, hollow center
  reg.makeFrame('focus.ring', 24, 24, 7, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.shadowColor = COLORS.accentGlow;
    ctx.shadowBlur = 4;
    roundRect(ctx, 2, 2, w - 4, h - 4, 6); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = COLORS.accentFaint;
    ctx.lineWidth = 1;
    roundRect(ctx, 4.5, 4.5, w - 9, h - 9, 4.5); ctx.stroke();
  });
}

// rounded-rect path helper (no fill/stroke)
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

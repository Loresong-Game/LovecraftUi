// LovecraftUI theme tokens. Single source of truth for palette, fonts, and shared metrics.

export const COLORS = {
  // Accent family (verdigris green)
  accent: '#6fd18b',            // eldritch verdigris-green: titles, selected, level, currency
  accentGlow: 'rgba(111,209,139,0.35)',
  accentFaint: 'rgba(111,209,139,0.15)', // the faint wash rides the hover floor
  accentBorder: 'rgba(111,209,139,0.3)',
  bone: '#d8cdaa',              // carved-bone titles where green overwhelms

  // Text — every token holds ≥ 4.5:1 on abyss1 (law; dark-on-dark
 // mandate). Hierarchy by brightness: text > muted > faint > disabled; widget-disabled
  // states ALSO dim via setNodeDisabled's fxOpacity, so textDisabled itself stays
  // legible for its other job — placeholders.
  text: '#b7c0b6',              // body (fog-gray)
  textBright: '#dde4da',        // inputs, tooltip body
  textMuted: '#9aa795',         // secondary / descriptions (was #93a08e)
  textFaint: '#87937f',         // tertiary labels, timestamps (was #74806f — 3.8:1, failed)
  textDisabled: '#79856f',      // placeholder / disabled (was #566053 — 2.9:1, failed)
  textWhite: '#ffffff',         // cooldown numbers, bar text

  // Semantic
  positive: '#8fe8a8',
  negative: '#d96a5a',
  healthTop: '#a83232', healthMid: '#701d1d', healthBot: '#4a0f12',   // arterial ichor
  manaTop: '#7b5fae', manaMid: '#523f7d', manaBot: '#2c1f4d',         // void-purple (Sanity)
  enemy: '#cc3a2a', enemyBorder: '#7a1a10',
  ally: '#58c88f', allyBorder: '#1f7a4f',
  quest: '#e8d86a',
  talentGold: '#e8c86a', // the maxed talent's gilt: rank text, plate rim, satisfied arrows
  talentGoldGlow: 'rgba(232,200,106,0.35)', // its glow partner (canvas shadowColor duty)
  eventType: '#cfe86a',
  link: '#7cc3a6',              // inline clickable runs ({link:} markup) — quiet sea-glass,
                                // deliberately softer than accent (STYLE §7 ruling)

  // Rarity (tooltips)
  rarityCommon: '#ffffff', rarityRare: '#4a90d9', rarityEpic: '#a335ee', rarityLegendary: '#ff8000',

  // Surfaces
  abyss0: '#04060a', abyss1: '#0b1016', abyss2: '#0d1826',
  panel: 'rgba(0,0,0,0.3)', panelDeep: 'rgba(0,0,0,0.5)', panelDeeper: 'rgba(0,0,0,0.7)',
  panelFill: 'rgba(15,21,18,0.78)', // panel.dark's body — a VISIBLE step off the abyss (
                                    //   was rgba(4,7,6,0.55), near-black on near-black)
  scrim: 'rgba(0,0,0,0.75)',
  stoneButton: 'rgba(24,32,26,0.85)', stoneButtonHover: 'rgba(38,52,42,0.9)',

  // Borders
  divider: '#2a332c', dividerDark: '#1c231e', border: '#39443a', borderLight: '#4a5a4c',

  // Stone palette (procedural art)
  stoneDark: '#1a1e1c', stoneMid: '#2e3430', stoneLight: '#454e47', stoneHi: '#5c675e',
  mossDark: '#1f3527', moss: '#2e5238', verdigris: '#3f7a5c',
  voidBlack: '#050708', inkParchment: '#0d1210',
};

export const FONTS = {
  header: `Georgia, 'Palatino Linotype', 'Times New Roman', serif`,
  body: `'Segoe UI', Tahoma, sans-serif`,
  mono: `Consolas, Monaco, 'Courier New', monospace`,
};

// Shared metrics mirrored from the source library's widget contract.
export const METRICS = {
  windowFrame: 16,        // CSS px border of the stone window frame (9-slice)
  windowHeaderH: 32,
  windowBtn: 28,          // square control buttons, full header height minus trim
  windowMinW: 250, windowMinH: 180,
  resizeEdge: 14, resizeCorner: 28,
  taskbarH: 50,
  // THE SOCKET LAW: every stone frame recesses its
  // socket ONE twelfth of the box per side — painters bake it, widgets seat
  // icon art by it, and the icon pairs below are DERIVED from it (a selftest
  // pin asserts the agreement; before this law three painter literals, three
  // METRICS pairs, and ~10 hand setRects each guessed their own inset).
  // Painters use the UNROUNDED value (a rounded inset stretched to another
  // box size puts art back onto the rim — the icon-browser lesson).
  slotSize: 56, slotIcon: 46, // 56 − 2·round(56/12))
  cpSlotSize: 48, cpSlotIcon: 40,  // 48 − 2·round(48/12) (was 44/36)
  itemSlotSize: 48, itemSlotIcon: 40, // (was 44/34)
  dragGhost: 44,
  dragThreshold: 5,
  tooltipOffset: 15, tooltipMargin: 10, tooltipHideDelay: 50,
  cooldownSeconds: 3,
  scrollbarW: 14,
  badgeInset: 6,          // count/cost badges anchor this far inside their slot/plate corner

  // Interaction-intensity FLOORS ("too subtle" ruling is law):
  // every clickable reacts to hover AND press with a frame/texture swap or a wash AT OR
  // ABOVE these alphas; multiply-tint-only hover is banned (STYLE §4). Widgets read
  // these at event time, never into module constants (the S43 painter rule).
  washHover: 0.15,
  washPress: 0.25,
  washFocus: 0.15,

  // the disabled-dim alpha setNodeDisabled applies when a widget has no dedicated
  // disabled art (X17: was a bare 0.45 literal at the one enforcement point)
  disabledDim: 0.45,

  // Spacing scale: gutters, gaps, and padding snap to this ladder.
  space4: 4, space8: 8, space12: 12, space16: 16,

  // the canvas text-shadow every widget draws under its glyphs (X02: eight files
  // hoisted this exact literal as a local `const SHADOW`). A shared frozen object —
  // read-only by contract, never mutated. NB: windows.js deliberately uses 0.9.
  textShadow: { color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 },
};

// The socket law's one function: the stone-socket inset for a box of
// CSS px `box`. Widgets ROUND (they seat whole-pixel rects); painters call
// the RAW form so a bake stretched to a neighboring size keeps its ratio.
export function socketInsetRaw(box) { return box / 12; }
export function socketInset(box) { return Math.round(box / 12); }

// Root paint-layer order lives in layers.js (LAYER_ORDER) — the one source of truth.

// ---- Theme application ----
// Themes apply at init time only: painters and widgets read these objects lazily, so
// mutating them before the texture bake re-skins everything. Re-theme at runtime =
// Eldritch.destroy() + Eldritch.init({ theme }). applyTheme is reset-first so each
// init describes an absolute delta from stock (destroy/init cycles never bleed).
const COLOR_DEFAULTS = { ...COLORS };
const FONT_DEFAULTS = { ...FONTS };
const METRIC_DEFAULTS = { ...METRICS };
// Read once at module load elsewhere (clip.js, windows.js, dragdrop.js) — not themable.
// windowFrame is frozen for a different reason: the baked window.frame art and the layout
// both carry their own 16px truth (the frame record), so theming the metric would lie.
const FROZEN_METRICS = new Set(['scrollbarW', 'windowHeaderH', 'dragThreshold', 'windowFrame']);

export function resetTheme() {
  Object.assign(COLORS, COLOR_DEFAULTS);
  Object.assign(FONTS, FONT_DEFAULTS);
  Object.assign(METRICS, METRIC_DEFAULTS);
}

export function applyTheme(theme = {}) {
  resetTheme();
  const groups = [
    ['colors', COLORS, COLOR_DEFAULTS],
    ['fonts', FONTS, FONT_DEFAULTS],
    ['metrics', METRICS, METRIC_DEFAULTS],
  ];
  for (const [key, target, defaults] of groups) {
    const src = theme[key];
    if (!src) continue;
    for (const [token, value] of Object.entries(src)) {
      if (!(token in defaults)) {
        console.warn(`LovecraftUI theme: unknown ${key} token "${token}"`);
        continue;
      }
      if (key === 'metrics' && FROZEN_METRICS.has(token)) {
        console.warn(`LovecraftUI theme: metrics.${token} is read at module load and cannot be themed`);
        continue;
      }
      if (key === 'metrics' && !(Number.isFinite(value) && value >= 0)) {
        // a NaN or negative metric flows straight into layout geometry (an invisible,
        // corrupted taskbar or scrollbar) — keep the default and say so
        console.warn(`LovecraftUI theme: metrics.${token} must be a finite non-negative number (got ${value}); keeping the default`);
        continue;
      }
      target[token] = value;
    }
  }
}

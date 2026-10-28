// Brass — warm tycoon metalwork (preset). Token set + seed offset + one
// painter override (the select stud), all through the public theme API:
//
//   import { brass } from './src/themes/brass.js';
//   Eldritch.init({ theme: brass });
//
// Painters run at bake time AFTER the tokens apply, so reading COLORS inside one
// picks up the preset's own palette. Re-theme = destroy() + init({ theme }).

import { COLORS } from '../theme.js';

export const brass = {
  colors: {
    // accent family: verdigris → lamplit brass
    accent: '#d9a960',
    accentGlow: 'rgba(217,169,96,0.35)',
    accentFaint: 'rgba(217,169,96,0.12)',
    accentBorder: 'rgba(217,169,96,0.3)',
    bone: '#e8dcc0',

    // text: fog-gray → warm ledger-paper grays
    text: '#c2bba8',
    textBright: '#e6e0d0',
    textMuted: '#9a927e',
    textFaint: '#7a7260',
    textDisabled: '#5a543f',

    // semantic: keep meaning, warm the quest gold slightly
    quest: '#e8c86a',
    eventType: '#d8c86a',

    // surfaces: abyss → boardroom mahogany dark
    abyss0: '#0a0806', abyss1: '#16110b', abyss2: '#261d0d',
    stoneButton: 'rgba(38,30,20,0.85)', stoneButtonHover: 'rgba(56,44,28,0.9)',

    // borders
    divider: '#33291c', dividerDark: '#231c12', border: '#44382a', borderLight: '#5a4c38',

    // stone → bronze
    stoneDark: '#241d14', stoneMid: '#383022', stoneLight: '#524636', stoneHi: '#6a5c48',
    mossDark: '#352a18', moss: '#523f22', verdigris: '#7a5f2e', // patina → tarnish
    voidBlack: '#080604', inkParchment: '#121006',
  },
  seeds: { offset: 5 }, // re-deals the cracks and moss so brass stone cuts differently
  painters: {
    // the painter-override demo: the select's chevron becomes a brass stud
    'select.arrow': (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS.accent;
      ctx.shadowColor = COLORS.accentGlow; ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(w / 2, 3); ctx.lineTo(w - 3, h / 2); ctx.lineTo(w / 2, h - 3); ctx.lineTo(3, h / 2);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
      ctx.stroke();
    },
  },
};

export default brass;

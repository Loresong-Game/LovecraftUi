// Aether — clean sci-fi glass (preset). A pure token set + seed offset:
// painters are OPTIONAL, and this preset ships without any — every pixel re-skins
// through the palette alone, because the procedural painters read COLORS lazily
// at bake time.
//
//   import { aether } from './src/themes/aether.js';
//   Eldritch.init({ theme: aether });

export const aether = {
  colors: {
    // accent family: verdigris → coolant cyan
    accent: '#6ac8e8',
    accentGlow: 'rgba(106,200,232,0.35)',
    accentFaint: 'rgba(106,200,232,0.12)',
    accentBorder: 'rgba(106,200,232,0.3)',
    bone: '#cfe0e8',

    // text: fog-gray → cold glass grays
    text: '#b6c4cc',
    textBright: '#e0ecf2',
    textMuted: '#8fa4b0',
    textFaint: '#70828e',
    textDisabled: '#4e5c66',

    quest: '#e8e06a',
    eventType: '#9ae8d8',

    // surfaces: abyss → hull dark
    abyss0: '#04070c', abyss1: '#0a1220', abyss2: '#0d1c30',
    stoneButton: 'rgba(20,30,40,0.85)', stoneButtonHover: 'rgba(30,46,60,0.9)',

    divider: '#243342', dividerDark: '#18222e', border: '#324458', borderLight: '#44586e',

    // stone → brushed alloy
    stoneDark: '#141c24', stoneMid: '#26323e', stoneLight: '#3c4c5c', stoneHi: '#526678',
    mossDark: '#16283a', moss: '#204058', verdigris: '#3a6a8a', // growth → coolant stain
    voidBlack: '#040608', inkParchment: '#0a1016',
  },
  seeds: { offset: 9 },
};

export default aether;

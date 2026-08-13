// The library-authored string table: every user-facing string the library
// itself draws or logs routes through str(), so `Eldritch.init({ strings })` can
// re-voice or localize the whole interface. Templates carry {0}/{1}/{2} positional
// slots. Widgets import str() from HERE — the entry imports the widgets, so widget
// modules can never read Eldritch.strings directly (the same composition-root seam
// as EldDragDrop.confirmDiscard). `Eldritch.strings` IS the live STRINGS object.

export const STRING_DEFAULTS = Object.freeze({
  // dialog chrome
  ok: 'OK',
  cancel: 'Cancel',
  popupDefaultTitle: 'Confirm',
  popupDefaultMessage: 'Are you sure?',

  // widget defaults (constructor fallbacks)
  keybindPrompt: 'Press a key…',
  keybindUnbound: 'Unbound',
  chatPlaceholder: 'Speak…',
  veilTitle: 'Loading',
  questHeader: 'Obligations',
  minimapZone: 'Unknown Depths',
  windowDefaultTitle: 'Window',
  devButtonDefault: 'Do It',
  speedPause: '❚❚',

  // the meta-screens kit
  saveNewTitle: 'An Empty Vessel',
  saveNewDesc: 'Begin anew.',
  saveErase: 'Erase',
  saveEraseTitle: 'Erase the Record',
  saveErasePrompt: 'Erase "{0}"? The deep does not return what it takes.',

  // the onboarding kit
  tutorialNext: 'Next',
  tutorialSkip: 'Skip',
  tutorialDone: 'Finish',

  // the dev console
  consolePrompt: 'Speak a rite…',
  consoleGreeting: 'The console listens. Type help.',
  consoleUnknown: 'No such rite: "{0}" — try help.',
  consoleKnown: 'Known rites: {0}',
  consoleErr: 'The rite "{0}" failed: {1}',
  consoleHelpDesc: 'list the known rites',
  consoleClearDesc: 'empty the scrollback',
  consoleStatsDesc: 'renderer and node counts',
  consoleEchoDesc: 'print the argument back',

  scoreTeamA: 'Team A',
  scoreTeamB: 'Team B',
  chartNoSeries: 'No series shown.',
  pileMoreCards: '+{0} more in the mound',
  countMoreCounsel: '+{0} older counsel',
  countColName: 'Name',
  // the talent grid (the tree* keys died with the graph skins)
  talentUnspent: 'Unspent points: {0}',
  talentSpent: 'Spent: {0}',
  talentTreeSpent: 'Points in {0}: {1}',
  talentTierNeeds: 'Needs {0} pts',
  talentReset: 'Reset Talents',
  talentResetTitle: 'Reset Talents',
  talentResetPrompt: 'Unlearn every talent and refund all points? The paths close behind you.',
  talentRank: 'Rank {0}/{1}',
  talentNextRank: 'Next rank:',
  talentReqTier: 'Requires {0} points in {1} Talents',
  talentReqTalent: 'Requires {0} points in {1}',
  runFloor: 'Floor {0}',

  // the survival kit
  craftLabel: 'Craft',
  processInput: 'In',
  processFuel: 'Fuel',
  processOutput: 'Out',
  compassCardinals: 'N E S W', // space-separated, clockwise from 0°

  // the whispering stage
  journalTitle: 'Journal',
  journalEmpty: 'The pages are empty.',
  journalNew: 'New',
  docTitle: 'Document',

  // the speaking stones
  zoneRefused: 'That fitting refuses it.',
  dollHead: 'Head',
  dollNeck: 'Neck',
  dollBack: 'Back',
  dollChest: 'Chest',
  dollGut: 'Abdomen',
  dollArmL: 'Left Arm',
  dollArmR: 'Right Arm',
  dollHandL: 'Left Hand',
  dollHandR: 'Right Hand',
  dollLegL: 'Left Leg',
  dollLegR: 'Right Leg',
  dollFootL: 'Left Foot',
  dollFootR: 'Right Foot',
  dollHealthy: 'Unharmed.',
  dollDamage1: 'Bruised',
  dollDamage2: 'Wounded',
  dollDamage3: 'Mangled',
  dollBleeding: 'Bleeding',
  dollMissing: 'Missing',
  dollScar1: 'Nicked',
  dollScar2: 'Scarred',
  dollScar3: 'Disfigured',

  // HUD family B
  dialogContinue: 'Continue',

  // the guildhall
  partyLeader: 'Leader',
  partyDead: 'Dead',
  partyOffline: 'Offline',
  partyRoleTank: 'Tank',
  partyRoleHealer: 'Healer',
  partyRoleDamage: 'Damage',

  // window event-log lines
  windowMinimized: 'Window "{0}" minimized',
  windowRestored: 'Window "{0}" restored',
  windowUnmaximized: 'Window "{0}" restored to normal size',
  windowMaximized: 'Window "{0}" maximized',
  windowClosed: 'Window "{0}" closed',

  // tooltip lore chrome (markers, slots, drag icons, the bar lock)
  markerEnemyTitle: 'Enemy',
  markerEnemyDesc: 'A hostile horror.',
  markerAllyTitle: 'Ally',
  markerAllyDesc: 'A fellow investigator.',
  markerQuestTitle: 'Quest',
  markerQuestBangDesc: 'An unfinished obligation.',
  markerQuestAskDesc: 'Someone awaits your report.',
  slotEmptyDesc: 'An empty fitting.',
  stackOf: 'Stack of {0}',
  paletteHint: 'Drag to the action bar to bind this rite.',
  lockSealedTitle: 'Bar sealed',
  lockUnsealedTitle: 'Bar unsealed',
  lockSealedDesc: 'Rites may be invoked but not rearranged.',
  lockUnsealedDesc: 'Drag rites to rearrange them.',
  barLockedLog: 'Action bar locked',
  barUnlockedLog: 'Action bar unlocked',

  // drag-and-drop event-log lines
  dragReturned: 'Drag cancelled - "{0}" returned to slot {1}',
  riteRemoved: '"{0}" removed from slot {1}',
  riteMoved: 'Moved "{0}" from slot {1} to slot {2}',
  riteDropped: '"{0}" dropped into slot {1}',
  swapped: 'Swapped "{0}" and "{1}"',
  actionTriggered: 'Action triggered: "{0}" from slot {1}',
  barLocked: 'The bar is locked.',
  dropRejected: 'That does not belong there.',
  gridSealed: 'That satchel is sealed.',
  stackFull: 'That stack is full.',
  stackMerged: 'Merged {0} into the "{1}" stack',
  itemMoved: 'Moved "{0}" to slot {1}',
  discardedOne: 'Discarded "{0}"',
  discardedMany: 'Discarded {0} × "{1}"',
  discardTitle: 'Discard',
  discardPromptOne: 'Discard {0}?',
  discardPromptMany: 'Discard {0} × {1}?',

  // component event-log lines
  tableSorted: 'Table sorted by column {0} ({1})',
  sortAscending: 'ascending',
  sortDescending: 'descending',
  minimapZoom: 'Minimap zoom: {0}x',
  statsCategory: 'Stats: {0}',
  settingsTab: 'Settings tab: {0}',

  // the deeper circle: nested radial rings
  radialBack: 'Back',

  // item-grid split flow
  splitMenuEntry: 'Split Stack…',
  splitTitle: 'Split Stack',
  splitPrompt: 'Take how many of {0}? (1-{1})',
  splitRefused: 'The stack refuses that cut.',
  splitNoRoom: 'No empty slot to receive the split.',
  splitDone: 'Split {0} of "{1}" into slot {2}',

  // compendium fallbacks (the lore TABLE itself is consumer-replaceable sample data)
  abilityFallbackDesc: 'An ability.',
  abilityFallbackStats: 'No data available',
  itemFallbackDesc: 'A curio of unknown provenance.',
});

// The LIVE table — `Eldritch.strings` is this exact object, so consumer reads keep
// working across applyStrings/resetStrings (the reference never changes).
export const STRINGS = { ...STRING_DEFAULTS };

// Read a string and fill its {n} slots. Unknown keys return the key itself (loud in
// the interface, never a crash).
export function str(key, ...args) {
  let s = STRINGS[key] ?? STRING_DEFAULTS[key] ?? String(key);
  for (let i = 0; i < args.length; i++) s = s.split(`{${i}}`).join(String(args[i]));
  return s;
}

// init({strings}) overrides: unknown keys warn and are skipped (typo protection).
export function applyStrings(overrides) {
  if (!overrides) return;
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in STRING_DEFAULTS)) {
      console.warn(`LovecraftUI strings: unknown key "${k}" (see STRING_DEFAULTS)`);
      continue;
    }
    STRINGS[k] = String(v);
  }
}

// Eldritch.destroy() restores the defaults (the lifecycle contract).
export function resetStrings() {
  for (const k of Object.keys(STRINGS)) delete STRINGS[k];
  Object.assign(STRINGS, STRING_DEFAULTS);
}

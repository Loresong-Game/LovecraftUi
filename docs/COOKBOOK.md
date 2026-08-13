# COOKBOOK — small complete recipes

Each recipe names the working example that proves it. Recipes grow chapter by chapter
as iterations land; keep every snippet aligned with a verified example page.

## A settings screen (tabs, apply/revert, persistence)

Proven by `examples/settings.html` (title token SETTINGS).

The shape: one **draft** object the controls edit, one **applied** object the game runs
with. Every control writes the draft through its `onChange` and arms the Apply/Revert
buttons; Apply copies draft→applied and persists (`localStorage`); Revert confirms
through `EldPopup`, copies applied→draft, and repaints every control with its SILENT
setter (`setValue(v)` / `setChecked(v)` — no events, so nothing re-marks the screen
dirty).

<!-- verify: runs standalone under the checker-v4 harness -->
```js
const applyBtn = new Button('Apply', { onClick: () => {
  applied = { ...draft };
  localStorage.setItem(KEY, JSON.stringify(applied));
  markClean();
}});
const revertBtn = new Button('Revert', { onClick: () => {
  EldPopup.show({ title: 'Revert Changes', message: 'Abandon unapplied changes?',
    onOkay: () => { draft = { ...applied }; repaintControlsSilently(); markClean(); } });
}});
```

Build the categories with `Tabs` — each tab is a build function that fills the pane
when selected, so controls always render from the current draft.

## Bind keys, with conflicts

Proven by `examples/settings.html` (the Controls tab).

`KeybindField` captures the next key combo or mouse button once armed. Give every
field a `checkConflict` that scans your OTHER bindings; returning a label rejects the
combo and fires `conflict {combo, with}` — surface it as a toast:

```js
const kb = new KeybindField({
  value: draft.bindWard,
  checkConflict: (combo) => combo === draft.bindAttack ? 'Attack' : null,
  onChange: (v) => { draft.bindWard = v; },
  onConflict: (combo, withWhat) =>
    EldToast.show({ title: 'Binding in use', message: `${combo} already invokes ${withWhat}.` }),
});
```

Escape cancels a capture (and is consumed — it never also closes the window above);
clicking anywhere else cancels too.

## Bind an inventory model

The catalog, grids, purse, and item menu are `examples/inventory.html` (the flagship);
the `itemchange` payload this recipe rides is pinned by the self-test.

Register the item catalog once (`Eldritch.registerItem` persists across boots), fill
grids with `setItem(index, id, count)`, and mirror EVERY change — user drags included —
from the one `itemchange` event:

```js
grid.on('itemchange', (e) => {
  // e.slot (the slot's id string, "item:N"), e.item, e.count (the slot's value
  // AFTER the change), e.action: set|clear|move|swap|merge|split|sort
  const i = grid.slots.findIndex((s) => s.slotId === e.slot);
  model.slots[i] = e.item ? { id: e.item, count: e.count } : null;
});
```

Programmatic mutations go the other way with the same public calls the page uses:
`setItem`/`clearSlot`/`getItem`/`firstEmpty`. Never reach into slots' internals.

## A vendor and a loot chest

Proven by `examples/inventory.html` (the Drowned Market + the Tide Chest).

- A vendor's wares are a **locked** grid: the seal refuses drag-out and drop-in, so
  buying is a deliberate act — a right-click menu entry that checks the purse, tops up
  an existing stack (or takes `firstEmpty()`), and debits the coins.
- Extend the item context menu at the PAGE level: listen for `rightclick` on the grid
  (it bubbles from the slot), build your entries (Use / Split / Sell / Discard…), and
  call `EldContextMenu.show` — show-while-open replaces, so your fuller menu wins over
  the built-in split-only one.
- A count dialog is a small `EldWindow` holding a `NumberField` and two buttons — see
  `askCount` in the flagship.
- Loot's "Take All" is a loop of `getItem` → satchel `firstEmpty()` → `setItem` +
  `clearSlot`, with a toast when the bags fill first.

## A chat box

Proven by `examples/game-hud.html` (bottom-left).

the composite below ships as the `ChatBox` widget — one node, same
behavior (`submit {value}` on real submissions, `log()`/`clear()` pass-throughs,
`register: false` to keep it off the `EldEvents` sink):

<!-- verify: runs standalone under the checker-v4 harness -->
```js
const chat = new ChatBox({ width: 360, height: 170, placeholder: 'Speak…' });
```

The composition it wraps is still the lesson — an `EventLog` for the scrollback, a
`TextField` whose `onSubmit` writes into it (Enter submits WITHOUT blurring — you keep
typing), and a history array recalled with ArrowUp/Down — build it by hand when you
need a different shape:

<!-- verify -->
```js
const history = []; let at = 0; // `at` rides the recall cursor; never shadow window.history
const log = new EventLog({ width: 360, height: 130 });
const field = new TextField({ placeholder: 'Speak…', width: 360,
  onSubmit: (v) => { if (v.trim()) { log.log(v, 'SAY'); history.push(v); at = history.length; field.setValue(''); } } });
field.on('keydown', (e) => {
  if (e.key === 'ArrowUp' && at > 0) { e.preventDefault(); field.setValue(history[--at]); }
  else if (e.key === 'ArrowDown' && at < history.length) { e.preventDefault(); field.setValue(history[++at] ?? ''); }
});
```

Channel tabs, when a game needs them, are a `Tabs` strip whose builds swap which log
(or which `ChatBox`) is visible.

## Compose a framed panel (the layout engine)

–`VBox`/`HBox` stack and row, `GridBox` lattices,
`Stack` anchors, `Spacer` pushes, `Divider` rules — and `frame:` makes a box OWN its
stone background, with the frame's slice insets adding to the padding so content sits
inside the stone with zero arithmetic. Sizes settle in the next layout pass (give the
engine a beat before reading them — the in-page settle rule):

<!-- verify -->
```js
const panelBox = new VBox({ frame: 'panel.dark', padding: METRICS.space8,
                            gap: METRICS.space8, align: 'stretch' });
const headBar = new HBox({ gap: METRICS.space8, align: 'center', autoWidth: false });
headBar.setSize(240, 0); // drive the width; height stays auto
headBar.add(new TextNode('Provisions', { size: 14, color: COLORS.accent }),
            new Spacer(), // pushes the button to the far edge
            new Button('Sort', { minWidth: 104 }));
const tray = new GridBox({ cols: 3, cellW: 44, cellH: 44, gap: METRICS.space4, align: 'stretch' });
for (let i = 0; i < 6; i++) tray.add(new QuadNode({ color: COLORS.panel }));
panelBox.add(headBar, new Divider(), tray);
Eldritch.engine.layers.background.add(panelBox);
await new Promise((r) => setTimeout(r, 60)); // boxes settle in the layout pass
// content 240 wide + padding 8×2 + panel.dark insets 6×2 = 268; the grid is 2 rows
if (panelBox.w !== 268) throw new Error('framed VBox width: expected 268, got ' + panelBox.w);
if (tray.h !== 92) throw new Error('grid height: 2 rows of 44 + one 4px gap = 92, got ' + tray.h);
if (tray.w !== 240) throw new Error('align stretch drives the grid to the content width, got ' + tray.w);
panelBox.dispose();
```

The `align: 'stretch'` on the panel drives every child to the content width — the
`Divider` becomes a full-width rule, and a stretched box child's own auto-sizing on
that axis turns off (the parent drives it; they would otherwise fight forever).

## A combat HUD in one file

Proven by `examples/game-hud.html` — the composition reference for a full game screen:
unit frames + globes fed from one state object, an `ActionBar` whose `setKeybind`
labels are WIRED (a page-level keydown routes digits 1–6 through
`EldDragDrop.triggerAction`, guarded against key-repeat, modifier chords, and chat
typing), `FloatText` floaters spawned at frame coordinates, a looping `CastBar` with
interrupts, quest updates by id handle, loot/level `EldToast`s, a `ChatBox`, and the
XP readout as a segmented `ProgressBar` (`segments: 10`) + mono caption. Everything
hangs off one `hud.onLayout` glued to the engine size, and one `engine.ticker.add`
drives the fake world.

## Localize your game

Sampled by `examples/rich-text.html`; the machinery shipped.

**The library's own words.** Every string the library draws or logs — dialog chrome,
widget defaults, every event-log line, tooltip lore chrome, the split/discard flows —
lives in one table (`src/strings.js` holds the key catalog; `Eldritch.strings` is the
live object). Override any subset at boot; templates carry `{0}`/`{1}` slots, unknown
keys warn, and `destroy()` restores the defaults:

<!-- verify: runs standalone under the checker-v4 harness -->
```js
Eldritch.init({ strings: {
  ok: 'Oui', cancel: 'Annuler',
  windowMinimized: 'Fenêtre « {0} » réduite',
  barLocked: 'La barre est verrouillée.',
} });
```

**Your game's words** stay yours — pass already-localized text into widgets as usual.
For colored fragments and inline icons inside that text, opt the carrying widget into
markup (`{color:#hex}…{/}`, `{icon:name}`, `{b}/{i}`, `{{` escapes; unknown tags render
literally):

<!-- verify -->
```js
const log = new EventLog({ width: 380, height: 160, markup: true, register: false });
log.log('You seize {color:#a335ee}the Drowned Crown{/} {icon:book}', 'LOOT');
EldToast.show({ title: 'Spoils', message: '{b}+3{/} Sanity', markup: true });
assert('the logged line parsed its runs', log.entries[0]._segments.some((s) => s.icon === 'book'));
log.dispose();
```

**Numbers, dates, plurals.** The library formats nothing for you — route your values
through `Intl` before they reach a widget, keyed by the locale your game runs in:

<!-- verify -->
```js
const locale = 'ja-JP';
const nf = new Intl.NumberFormat(locale);                       // 12,345 per locale
const df = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const pr = new Intl.PluralRules('en-US');                       // pick your template by pr.select(n)
const goldText = new TextNode(nf.format(12345), { font: FONTS.mono, size: 13 });
assert('Intl formats without the library caring', goldText._text.length >= 5 && pr.select(3) === 'other' && df.format(new Date(0)).length > 0);
goldText.dispose();
```

**CJK and other scripts.** Text rasterizes through the browser's font fallback, so CJK
renders out of the box; for a deliberate stack, theme the fonts at boot
(`init({ theme: { fonts: { body: '"Noto Serif JP", Georgia, serif' } } })` — re-theme
is destroy + init). No-space scripts wrap by characters automatically; measuring and
ellipsis are script-agnostic.

**The RTL limitation, explicitly.** Arabic, Hebrew, and other right-to-left scripts
render their glyphs but the library performs NO bidi reordering and no layout
mirroring: lines lay out left-to-right, and mixed-direction text will read wrong.
Shipping an RTL locale needs engine-level bidi work that is out of scope for the
current text pipeline — treat RTL as unsupported and plan interfaces accordingly.

## Bind a game model

Sampled by `examples/binding.html`; the machinery shipped. A `Store` is a
dot-path observable ledger — `get/set(path)` plus `subscribe(path, fn)` with
MICROTASK-BATCHED notify (any number of sets in one tick flush once per subscriber).
Wiring a widget is one line each way — `bind` is two-way (inbound store changes land
silently; the widget's loud `change` writes back; no event loops by construction),
`bindText` and `bindEnabled` are one-way. Disposing a bound widget unbinds it.

<!-- verify -->
```js
const store = new Store({ player: { hp: 62, potions: 3 } });
const hpBar = new ProgressBar({ value: 0, width: 220 });
Eldritch.engine.layers.background.add(hpBar);
bind(hpBar, store, 'player.hp');                 // two-way: the bar reads 62 at once
assert('the store seeds the widget', hpBar.value === 62);
store.set('player.hp', 25);
await wait(20);                                   // notify is microtask-batched
assert('a set lands in the widget', hpBar.value === 25);
hpBar.setValue(90, { silent: false });            // a LOUD commit writes back
await wait(20);
assert('a loud commit writes the store', store.get('player.hp') === 90);
const label = new TextNode('', { size: 12 });
bindText(label, store, 'player.potions', (v) => `Potions: ${v}`);
assert('bindText paints immediately', label._text === 'Potions: 3');
hpBar.dispose(); label.dispose();
```

Subscribing a PARENT path hears every child set (`subscribe('player', fn)` fires on
`player.hp` writes) and vice versa when a whole object is replaced. There are no
computed/derived values by design — this is a ledger, not a spreadsheet; derive in
your own subscriber.

## Persist window layout + settings

Give windows a stable `id` and the layout round-trips as plain JSON —
`EldWindow.serializeLayout()` records every open window's normal rect plus its
minimized/maximized flags; `restoreLayout(jsonOrArray)` matches by id (unknown ids
are skipped — build your windows first, then restore), clamps to the container like
a drag would, and runs the normal loud minimize/maximize paths.

<!-- verify -->
```js
const win = EldWindow.create({ id: 'codex', title: 'Codex', x: 80, y: 60, width: 300, height: 220 });
win.setRect(140, 90, 320, 240);
const saved = JSON.stringify(EldWindow.serializeLayout());   // -> localStorage in a real game
win.setRect(40, 40, 300, 220);                                // the user moves it...
EldWindow.restoreLayout(saved);                                // ...and the save comes back
assert('the rect round-trips', win.x === 140 && win.y === 90 && win.w === 320 && win.h === 240);
win.close();
```

Settings themselves are just a `Store` — persist `JSON.stringify(store._root)` (or
your own model object) wherever your game saves, and re-seed `new Store(saved)` at
boot; the bindings repopulate every widget. `examples/settings.html` shows the
apply/revert pattern; `examples/binding.html` shows save/restore buttons end to end.

The **DevPanel** dogfoods all of it — the studio cheat panel is one call:

```js
const dev = DevPanel.fromSpec({
  title: 'CHEATS', hotkey: 'F2', x: 16, y: 16,
  fields: [
    { type: 'readout', label: 'HP', path: 'player.hp' },
    { type: 'slider', label: 'Set HP', path: 'player.hp', min: 0, max: 100, step: 1 },
    { type: 'toggle', label: 'God mode', path: 'cheats.god' },
    { type: 'button', label: 'Grant 100 gold', onClick: () => store.set('gold', store.get('gold') + 100) },
  ],
}, store);
```

Every row binds through the same `bind`/`bindText` you use yourself; the header click
collapses it and the hotkey toggles it from anywhere (it rides the engine bus, so it
works no matter what holds focus).

## A resource top-bar in 20 lines

The strategy-screen staple: a `ResourceBar` of chips that flash their deltas, a
`SegmentedBar` of build phases, and the `SpeedControl` tempo preset — every
instrument on the uniform contract, so the game just calls `setValue`. One `VBox`
stacks the three; nobody hand-computes a y stride.

<!-- verify -->
```js
const strip = new VBox({ gap: METRICS.space8, align: 'start' });
strip.setPos(16, 12);
strip.add(
  new ResourceBar({ chips: [
    { icon: 'book', value: 120, cap: 999 },                 // lore
    { icon: 'leafs', value: 34, cap: 100, warnAt: 15 },     // herbs — warns low
    { icon: 'deathkiss', value: 7, cap: 50 },               // essence
  ], gap: 10 }),
  new SegmentedBar({ segments: 3, max: 3, value: 1, width: 180 }),
  SpeedControl({ value: 1, onChange: (v) => { /* game.tempo = v */ } }),
);
Eldritch.engine.layers.background.add(strip);
const [bar, phases, speed] = strip.children;

bar.chips[1].setValue(19);            // the herb chip flashes its loss, silently
phases.setValue(2, { silent: false }); // loud: the phase change is a game event
assert('the chips flashed and the phase advanced',
  bar.chips[1].value === 19 && phases.value === 2 && speed.value === 1);
await wait(60);                        // boxes settle in the layout pass
assert('the box stacked the strip (no hand-set y anywhere)',
  phases.y === bar.y + bar.h + METRICS.space8 && speed.y > phases.y);
strip.dispose();                       // disposing the box takes the children with it
```

## A pause overlay

One `MenuScreen` on the overlay layer IS the pause screen: it scrims the game,
swallows the wheel, takes focus, and Escape/gamepad-B pop any submenu you push.

<!-- verify -->
```js
const pause = new MenuScreen({ title: 'A HELD BREATH', items: [
  { label: 'Resume', onSelect: () => pause.dispose() },
  { label: 'Settings' },
  { label: 'Quit to Title' },
] });
Eldritch.engine.layers.overlay.add(pause);
assert('the pause menu mounts focused on Resume',
  pause.depth === 0 && pause.list.index === 0 && Eldritch.engine.focusedNode === pause.list);
pause.dispose();
```

## A nested right-click wheel (the ground circle)

Every demo wires one . The three parts: `init({ contextMenu: false })`
turns the native browser menu off ON THE CANVAS (an embedding host keeps its own
menu outside the stage); an item with `children` is a PARENT sector that swaps
the ring in place (the engine appends the Back sector; Escape/gamepad-B pops one
ring per press); and the bus-null press is how empty scene reaches you — a
right-click that lands on a widget belongs to that widget (the ruling), so
item menus, keybind capture, and order gestures keep their right-clicks. `select`
fires on LEAVES only with the breadcrumb `path` — route verbs by `path.join('/')`.

<!-- verify -->
```js
const picks = [];
const ground = new RadialMenu({ items: [
  { id: 'speak', label: 'Speak' },
  { id: 'wares', label: 'Wares', children: [
    { id: 'buy', label: 'Buy' }, { id: 'sell', label: 'Sell' },
  ] },
] });
const VERBS = { speak: () => picks.push('speak'), 'wares/buy': () => picks.push('buy') };
ground.on('select', ({ id, path }) => (VERBS[path.join('/')] ?? VERBS[id])?.());
Eldritch.engine.bus.on('pointerdown', (e) => {
  if (e.button !== 2 || e.target) return;   // chrome keeps its own right-click
  ground.toggle(e.x, e.y);
});
Eldritch.engine.bus.emit('pointerdown', { x: 300, y: 300, button: 2, pointerId: 9, target: null, native: null });
assert('empty scene opens the wheel', ground.isOpen === true);
ground._setIndex(1, false); ground.onActivate();   // the Wares parent
assert('a parent descends — nothing selected', ground.depth === 1 && picks.length === 0);
ground._setIndex(0, false); ground.onActivate();   // the Buy leaf
assert('the leaf routes by its path and closes', picks.join() === 'buy' && ground.isOpen === false);
ground.dispose();
```

## The errand wheel (the radial chain)

Proven by `examples/selftest.html` block 152 and the demo / action-hud / arcade
drives under REAL input (title tokens SELFTEST, DEMO, ACTIONHUD, ARCADE).

An UNCONSUMED right-click walks `radialItems` providers from the hit up
the parent chain: an ARRAY opens the engine's shared wheel with those items
(each leaf may carry its own `onSelect(payload)`), a FUNCTION is asked per
gesture (`null` declines onward, `false` SEALS the chain — the scrim rule), and
when nobody answers, the wheel registered with `{ ground: true }` (or the
per-gesture `RadialMenu.setGround(fn)`) opens instead. Consuming stays the old
idiom — `preventDefault()` on the `rightclick` keeps a widget's own menu, and a
sealed widget's gesture falls back from its first ENABLED ancestor.

<!-- verify -->
```js
const ckHost = new UINode({ interactive: true });
ckHost.setPos(200, 200); ckHost.setSize(120, 80);
Eldritch.engine.layers.background.add(ckHost);
let ckPicked = null;
ckHost.radialItems = [{ id: 'ck_err', label: 'Errand', onSelect: (pl) => { ckPicked = pl.id; } }];
assert('a provider opens the shared wheel',
  Eldritch.engine.radialFallback(ckHost, 240, 230, null) === true
  && Eldritch.engine.radialShared.isOpen === true);
Eldritch.engine.radialShared._setIndex(0, false);
Eldritch.engine.radialShared.onActivate();
assert('the leaf onSelect carries the errand', ckPicked === 'ck_err'
  && Eldritch.engine.radialShared.isOpen === false);
ckHost.radialItems = () => false;
assert('false SEALS the chain', Eldritch.engine.radialFallback(ckHost, 240, 230, null) === false);
const ckWheel = new RadialMenu({ items: [{ id: 'ck_g', label: 'Ground' }], ground: true });
ckHost.radialItems = undefined;
assert('the ground terminus answers when nobody else does',
  Eldritch.engine.radialFallback(ckHost, 240, 230, null) === true && ckWheel.isOpen === true);
ckWheel.close({ silent: true });
RadialMenu.setGround(null);
ckWheel.dispose();
ckHost.dispose();
```

## A difficulty select (submenus ride the Escape stack)

`push()` slides the current list out and the new one in (presets;
`Eldritch.reducedMotion` collapses them); every pushed level registers on the Escape
stack, so Escape pops exactly one level.

<!-- verify -->
```js
const menu = new MenuScreen({ title: 'THRESHOLDS', items: [
  { label: 'Difficulty', onSelect: () => menu.push({ title: 'Difficulty', items: [
    { label: 'Merciful' }, { label: 'Fair' }, { label: 'Merciless' },
  ] }) },
] });
Eldritch.engine.layers.overlay.add(menu);
menu.list.items[0].onSelect();            // as if the player chose Difficulty
assert('a submenu pushes a level', menu.depth === 1);
menu.pop();                               // what Escape does
assert('pop returns to the root', menu.depth === 0);
menu.dispose();
```

## A confirm-quit flow

The quit item shows a popup; only OK quits — Escape, Cancel, or a programmatic
`hide()` all resolve as cancel and the game keeps running.

<!-- verify -->
```js
let quit = false;
const answer = EldPopup.show({
  title: 'Abandon the Depths',
  message: 'Quit to the title? The abyss remembers.',
  onOkay: () => { quit = true; },
});
EldPopup.hide();                          // the player thought better of it
const r = await answer;
assert('a dismissed confirm quits nothing', r.action === 'cancel' && quit === false);
```

## Teach the first minute (a two-lesson tutorial)

A `TutorialSequencer` runs declarative lessons over one `Spotlight` (the scrim whose
cutout tracks the target and seals everything outside it — pointer AND keyboard/
gamepad, one predicate) and one `Coachmark` (the stone callout with the aimed arrow).
`advance: 'click'` listens on the target, `'change'` on its loud commits, `'manual'`
shows Next, a function is polled per frame; a target dying mid-lesson recovers
forward; Skip or Escape aborts with `completed: false`.

<!-- verify -->
```js
const learn = new Button('Touch Me', {});
learn.setPos(200, 200);
Eldritch.engine.layers.background.add(learn);
let finished = null;
const tour = new TutorialSequencer({
  steps: [
    { target: learn, advance: 'click', title: 'First', text: 'Click the lit button.' },
    { target: null, advance: 'manual', title: 'Last', text: 'A parting word.' },
  ],
  onDone: (completed) => { finished = completed; },
});
tour.start();
assert('the tour starts on lesson one', tour.index === 0 && tour.running === true);
learn.dispatch('click', {});              // as if the player clicked the lit button
assert('a click on the lit target advances', tour.index === 1);
tour.next();                              // the Finish button's path
assert('the tour completes and reports it', finished === true);
learn.dispose();
```

## Photo mode (hide the HUD, keep a framing grid)

`Eldritch.setHUDVisible(false, { except })` sleeps every UI band — windows,
taskbar, toasts, tooltips, popups — remembering each node's exact visibility; the
except list keeps your framing chrome up (the vignette stays on its own, being
scene ambiance). `setHUDVisible(true)` restores precisely what was.

<!-- verify -->
```js
// (named `thirds`, not `grid` — the layout helper `grid` is an entry export, and
// the snippet runner injects every export as a parameter)
const thirds = new UINode({ name: 'thirds' });
const gw = Eldritch.engine.width, gh = Eldritch.engine.height;
for (const f of [1 / 3, 2 / 3]) {
  const line = new QuadNode({ color: COLORS.accent, opacity: 0.4 });
  line.setRect(Math.round(gw * f), 0, 1, gh);
  thirds.add(line);
}
thirds.setSize(gw, gh);
Eldritch.engine.layers.overlay.add(thirds);
const subject = new Button('The Subject', {});
subject.setPos(120, 120);
Eldritch.engine.layers.background.add(subject);
Eldritch.setHUDVisible(false, { except: [thirds] });
assert('the HUD sleeps, the grid stands', subject.visible === false && thirds.visible === true);
Eldritch.setHUDVisible(true);
assert('restore wakes the HUD exactly', subject.visible === true);
thirds.dispose(); subject.dispose();
```

## Move a hoard between containers (quick-transfer)

Proven by `examples/survival-hud.html` (title token SURVIVALHUD).

Register the items FIRST, then link two grids and the whole quick-transfer protocol is
wired: `linkTransfer(other)` arms shift-click quick-moves toward `other`, and
`transferAll(other)` is take-all and deposit-all — the same sweep pointed both ways
(`chest.transferAll(satchel)` empties the chest; the reverse call deposits). Moves MERGE
into same-id stacks first (honoring `stackMax`), then take the first empty slot; merges
COMPOUND during a sweep — a stack spilled into an empty slot becomes the next stack's
merge target. A stack with nowhere to go stays put and the sweep says so with one error
voice. Success dispatches `transfer {index, id, count, to}` on the SOURCE grid —
deliberately not `change`, so batch sweeps stay quiet.

<!-- verify -->
```js
Eldritch.registerItem('ck_tuber', { name: 'Cellar Tuber', icon: 'leafs', stackMax: 10 });
Eldritch.registerItem('ck_lantern', { name: 'Storm Lantern', icon: 'book', stackMax: 1 });
const satchel = new ItemGrid({ cols: 2, rows: 1 });
const chest = new ItemGrid({ cols: 2, rows: 2 });
Eldritch.engine.layers.background.add(satchel, chest);
satchel.setItem(0, 'ck_tuber', 5);                 // programmatic sets are silent
chest.setItem(0, 'ck_tuber', 7);
chest.setItem(1, 'ck_lantern', 1);
let sweep = null;
chest.on('transfer', (e) => { sweep = e; });
const moved = chest.transferAll(satchel);          // Take All: chest → satchel
assert('one stack found room', moved === 1);
assert('merge-first fills to stackMax', satchel.getItem(0).count === 10);
assert('the remainder spills to the first empty slot', satchel.getItem(1).count === 2);
assert('the moved stack left the chest', chest.getItem(0) === null);
assert('a full satchel refuses the lantern', chest.getItem(1).count === 1);
assert('the sweep narrated the move', sweep.id === 'ck_tuber' && sweep.count === 7 && sweep.to === satchel);
satchel.dispose(); chest.dispose();
```

Durability rides the same rails: `setItem(i, id, n, { durability: 0.55 })` paints the
tier-tinted underbar on the ICON (the thing that physically travels), and quick-moves
carry it verbatim — keep `stackMax: 1` on items where per-instance durability matters.

## The talent grid

Proven by `examples/trees.html` (title token TREES) and the Forbidden Sciences window
in `examples/strategy-hud.html` (title token STRATEGYHUD).

One discipline is a `TalentTree`; a screen of them around one unspent pool is a
`TalentPanes`. The WoW-Classic law: one point per rank, LEFT click learns,
RIGHT click unlearns under the legality oracle — and the grid CONSUMES its
right-clicks, so the radial chain stays out; each tier opens at five points spent
IN THAT TREE; a prerequisite must be MAXED before its dependent opens (the golden
arrow). `setRanks`/`restore` are the silent load paths; `serialize` round-trips.

<!-- verify -->
```js
const ckGrid = new TalentPanes({ points: 6, panes: [{ id: 'ck', data: { name: 'Recipe', talents: [
  { id: 'ck_ward', icon: 'shield', tier: 1, col: 1, maxRank: 5 },
  { id: 'ck_gaze', icon: 'blindinglight', tier: 2, col: 1, maxRank: 1, requires: 'ck_ward' },
] } }] });
Eldritch.engine.layers.background.add(ckGrid);
const ckPane = ckGrid.pane('ck');
assert('the frontier derives available', ckPane.getState('ck_ward') === 'available');
assert('the deep derives sealed by its tier', ckPane.getState('ck_gaze') === 'locked-tier');
ckPane._plates.get('ck_ward').dispatch('click', {});
assert('a click learns a rank and drains the pool', ckPane.getRank('ck_ward') === 1 && ckGrid.points === 5);
ckPane.setRanks({ ck_ward: 5 });
assert('five points open the tier through the MAXED prerequisite', ckPane.getState('ck_gaze') === 'available');
const ckEv = ckPane._plates.get('ck_gaze').dispatch('rightclick', { x: 0, y: 0 });
assert('the grid consumes its right-clicks', ckEv.defaultPrevented === true);
ckGrid.restore(ckGrid.serialize());
assert('restore round-trips the build', ckPane.getRank('ck_ward') === 5);
ckGrid.dispose();
```

## The war-table loop

Proven by `examples/strategy-hud.html` (title token STRATEGYHUD) — its in-page `?assert=1`
suite drives the gestures this recipe narrates.

The strategy kit is the data-driven protocol at full stretch. One loop, five beats,
and the game owns the model at every step:

```js
const marquee = new SelectionMarquee({ onSelect: (r) => pickUnits(r) });   // 1. narrate
engine.layers.ghost.add(marquee);            // arms only on empty-space presses;
                                             // YOU intersect r {x,y,w,h,shift} with your entities
const card = new CommandCard({
  commands: [{ id: 'raise', icon: 'shield', hotkey: 'Q', cost: 50 }],
  units: [], cols: 4,
  onCommand: (v, e) => {                     // 2. command — clicks AND bus hotkeys funnel here
    pending.push({ id: 'ghoul', icon: 'deathkiss' });
    forge.setQueue(pending);                 // 3. mutate YOUR queue, set it back
  },
});
const forge = new BuildQueue({ slots: 5,
  onCancel: (v, e) => { pending.splice(e.index, 1); forge.setQueue(pending); } });  // 5. cancel
// 4. your ticker clocks production and calls forge.setProgress(0..1); when the head
//    completes: pending.shift(); forge.setQueue(pending); — the queue displays, never owns
```

After a marquee lands, feed the selection to the tray (`card.setUnits([{id, icon,
count}])` — display-only) and gate affordability with `setCommandDisabled(id, v)`.
`TacticalMap` closes the loop the same way: it dispatches `moveto {x, y}` in world
coordinates and paints whatever camera footprint you `setViewport({x, y, w, h})` back.
Command hotkeys are single-atom binds matched while nothing holds focus, so they stay
live after any mouse click. The full assembly — resources over the map over the card —
is `examples/strategy-hud.html`.

## Typed equipment zones (rings that refuse swords)

Proven by `examples/mud-hud.html` (title token MUDHUD).

Register items with your own typing `data`, give each zone an `accepts` predicate, and
the doorway polices itself: drags, shift-click quick-moves, and sweeps all ask —
including BOTH doorways of a cross-grid swap — while a refusal stays polite (one log
line, the error voice, nothing mutates). Programmatic `setItem` bypasses the doorway
by design: loading a save never argues with a fitting.

<!-- verify -->
```js
Eldritch.registerItem('ck_band', { name: 'Bone Band', icon: 'leafs', stackMax: 1, data: { kind: 'ring' } });
Eldritch.registerItem('ck_blade', { name: 'Grave Blade', icon: 'sword', stackMax: 1, data: { kind: 'weapon' } });
const wearsRings = (id) => itemData(id).data?.kind === 'ring';
const worn = new EquipmentRack({ zones: [{ id: 'rings', label: 'Rings', slots: 3, accepts: wearsRings }] });
const pouch = new ItemGrid({ cols: 3, rows: 1 });
Eldritch.engine.layers.background.add(worn, pouch);
pouch.setItem(0, 'ck_band', 1);
pouch.setItem(1, 'ck_blade', 1);
pouch.setItem(2, 'ck_band', 1);
let lastEquip = null;
worn.on('equipchange', (e) => { lastEquip = e; });
const moved = pouch.transferAll(worn.getZone('rings'));
assert('the fittings take rings and refuse the blade', moved === 2 && pouch.getItem(1).item === 'ck_blade');
assert('the sweep filled the first fittings', worn.getItem('rings', 0) !== null && worn.getItem('rings', 1) !== null);
assert('equipchange carried the zone', lastEquip.zone === 'rings' && lastEquip.action === 'transfer');
worn.setItem('rings', 2, 'ck_blade', 1);
assert('programmatic setItem bypasses the doorway', worn.getItem('rings', 2).item === 'ck_blade');
worn.dispose(); pouch.dispose();
```

The zone grids are REAL ItemGrids — `getZone(id)` hands one back whole, so locks,
splits, tooltips, and durability all behave exactly as they do in a bag.

## Wound the doll

Proven by `examples/mud-hud.html` (title token MUDHUD).

The `BodyDoll` never owns your body model — it renders whatever you `setPart` back
(the data-driven protocol). Patches MERGE: touch only the fields you name; ranks
floor and clamp to 0..3; programmatic patches stay silent unless you ask for the
gesture path.

<!-- verify -->
```js
const wounds = [];
const doll = new BodyDoll({ onPartChange: (v, e) => wounds.push(e) });
Eldritch.engine.layers.background.add(doll);
doll.setPart('l-arm', { damage: 2.9, bleed: true });
assert('a patch merges, floors, and clamps',
  doll.getPart('l-arm').damage === 2 && doll.getPart('l-arm').bleed === true);
doll.setPart('l-arm', { bleed: false });
assert('a merge-patch keeps the other fields',
  doll.getPart('l-arm').damage === 2 && doll.getPart('l-arm').bleed === false);
assert('programmatic patches stay silent', wounds.length === 0);
doll.setPart('head', { scars: 3 }, { silent: false });
assert('a loud commit narrates the whole part state',
  wounds.length === 1 && wounds[0].part === 'head' && wounds[0].scars === 3);
const wholeBody = doll.getParts();
assert('the body snapshot reads back', wholeBody['l-arm'].damage === 2 && wholeBody.head.scars === 3);
doll.dispose();
```

Missing limbs stay clickable (players inspect what is gone), a bleeding stump is a
legal state, and every part carries an auto tooltip built from the strings table —
override titles per part with the `labels` option.

## Re-skin the icons with the painted pack

The pack under `assets/icons` is OPTIONAL — the library requires zero image
files, and every page must still boot art-complete with the folder deleted. The
way to adopt it, therefore, is not to invent new icon names and re-create your
widgets around them; it is to point `as:` at an icon id your interface **already
uses**. The registry re-bakes that one name in place, so every quad already
holding it shows the painted art on its own — no slot rebuild, no re-mount, no
`registerItem` round trip — and because nothing new is registered, the texture
budget does not move. `fallback: 'none'` is the whole degrade story: with the
assets absent nothing registers and the quiet pending plate stands (the procedural ability painters are gone - the pack IS the art).

<!-- verify -->
```js
const engine = Eldritch.engine;
// Reading a name the pack has not landed on yet mints its quiet PENDING plate
// (the procedural ability painters died; icon.* names stay followable),
// so sample the count AFTER the first read - the RE-SKIN itself adds nothing.
const ward = engine.textures.get('icon.shield');
const before = engine.textures.count;

// Iron Bulwark over the drawn Elder Ward. Await it only when you register NEW
// names; a re-skin can land at any time, because live quads follow it.
const res = await Eldritch.loadIcons({
  base: '../assets/icons',
  fallback: 'none',
  icons: [{ id: 'ico-0210', as: 'shield' }],
});

// Every id either landed or was reported missing — never silently dropped.
assert('the call accounts for every id',
  res.registered.length + res.missing.length === 1);
// The budget is the point: re-baking an existing name adds no texture.
assert('a re-skin never grows the atlas', engine.textures.count === before);
// And the identity is stable, which is what lets live quads follow the re-bake.
assert('the icon keeps its texture identity', engine.textures.get('icon.shield') === ward);
// With assets/ deleted this recipe still passes: nothing registered, the
// quiet pending plate stands, and the interface is unchanged.
assert('the ward resolves either way', ward != null);
```

For a grid of hundreds of icons, do NOT bake them all into the registry — that is
what `Eldritch.loadIconPack` is for. It uploads one texture per sheet and hands
back per-icon views windowed onto their cell, so the registry is never touched at
all; `pack.trim(keep)` releases sheets you have scrolled past, and
`Eldritch.destroy()` drains any live pack. `examples/icon-browser.html` is that
path working over all 3,840 icons, and it hands back the exact `loadIcons` call
for whichever one you click.

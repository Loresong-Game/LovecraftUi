# LovecraftUI — Build Guide

This guide covers building a Lovecraftian game interface rendered entirely with
three.js. The library has specific construction conventions, and following them
is easier than working around them. When in doubt,
`examples/demo.html` is a complete, working reference that uses these same modules, and
every claim in this guide is demonstrated by a page under `examples/` (the hub is
`examples/index.html`; `docs/GALLERY.md` maps every page to what it proves).

The library is build-free: ES modules, zero image assets (every texture is generated
procedurally at boot from a seeded generator), no npm, no bundler. Distribution is the
folder itself — copy `src/`, `vendor/`, and `types/` into your project and serve over
HTTP. It requires WebGL2.

**Where everything is documented** — this guide teaches the construction patterns; the
references go deeper:

| Question | Read |
|---|---|
| What exists, option by option? | README.md's JavaScript API table (the index of the whole surface) |
| The widget contract (values, events, disabled, focus) and per-widget option reference | docs/API.md |
| Runnable, verified recipes (settings screens, binding, localization, photo mode…) | docs/COOKBOOK.md |
| Which example page proves what | docs/GALLERY.md |
| Tokens, seeds, presets, uiScale, string overrides | docs/THEMING.md |
| Writing your own widgets / painters / typings | docs/EXTENDING.md |

**Find the pattern fast** — the flagship pages are complete, assembled interfaces; copy
the one nearest your game:

| You are building | Reach for | Copy from |
|---|---|---|
| A combat HUD | UnitFrame, Globe, CastBar, ActionBar, Minimap, FloatText, ChatBox, QuestTracker | `examples/game-hud.html` |
| An RTS / strategy HUD | SelectionMarquee, CommandCard, BuildQueue, TacticalMap, ResourceBar, TechTree | `examples/strategy-hud.html` |
| Survival / crafting | RecipeBrowser, ProcessPanel, CompassStrip, ItemGrid quick-transfer | `examples/survival-hud.html` |
| A MUD / text-game HUD | ChatBox (markup `{link:}` runs + the pinned scrollback), BodyDoll, EquipmentRack, ItemGrid `accepts` | `examples/mud-hud.html` |
| Inventory, vendors, loot | registerItem + ItemGrid, EldContextMenu, EldPopup | `examples/inventory.html` |
| Skill trees / tech webs | SkillTree, TechTree (raw PanZoomSurface + NodeGraph for custom lattices) | `examples/trees.html` |
| Title flow, saves, levels, credits | MenuScreen, TitleCard, SaveSlotList, LevelSelectGrid, CreditsScroller, LoadingVeil | `examples/meta-screens.html` |
| A tutorial / onboarding | TutorialSequencer (Spotlight + Coachmark) | `examples/tutorial.html` |
| UI pinned to 3D world points | WorldAnchorLayer, OffscreenIndicator, InteractPrompt, KeyGlyph | `examples/action-hud.html` |
| A settings screen | Tabs, KeybindField, NumberField, SettingsPanel | `examples/settings.html` |
| Model-driven UI + cheat panel | Store, bind/bindText/bindEnabled, DevPanel | `examples/binding.html` |
| Logs/tables/lists at scale | VirtualList (rowFocus), virtual EventLog, virtual Table | `examples/big-data.html` |
| Conversations driving quests | DialogPanel, QuestTracker, LoadingVeil | `examples/narrative.html` |
| Styled text and localization | TextNode markup, `init({strings})` | `examples/rich-text.html` |
| Transitions and sound hooks | animateIn/Out, stagger, the `uisound` bus | `examples/juice.html` |
| Meters, timers, resource rows | SegmentedBar, ArcGauge, ResourceChip/Bar, BigTimer, StarRating | `examples/meters.html` |
| A re-skin or couch-distance scale | theme presets, `init({uiScale})`, photo mode | `examples/theme-gallery.html` |
| Debugging your interface | DebugConsole, DebugInspector, `?debug=1`, `?console=1` | `examples/binding.html` |
| The smallest possible page | one window, one button, one tooltip | the README's "Minimal page" (the canonical skeleton) |
| UI embedded in an existing page | container/destroy/reboot discipline | `examples/embed.html` |

The whole library follows one law, in three beats: **`Eldritch.init()` once → construct
widgets → add them to a layer (or a window). Wire events. Your game owns every model** —
widgets afford actions and narrate them; they are never the source of truth (section 4).

---

## 1. Setup: one import, one init (do this first)

Serve over HTTP (`python -m http.server`). Every page needs the importmap for three and a single
module import:

```html
<style>html,body{margin:0;height:100%;overflow:hidden;background:#04060a}</style>
<script type="importmap">{ "imports": { "three": "./vendor/three.module.js" } }</script>
<script type="module">
  import { Eldritch, EldWindow, EldPopup, EldTooltip, EldDragDrop, EldEvents,
           Button, TextField, Slider, Select, UINode, TextNode, ScrollArea,
           COLORS, FONTS, column, row, grid } from './src/lovecraft-ui.js';

  Eldritch.init();                 // renderer + procedural art + every system
  const engine = Eldritch.engine;  // keep a reference; you will use engine.layers
</script>
```

Rules that prevent the most common breakage:

- **Import ONLY from `src/lovecraft-ui.js`.** It re-exports the entire public surface
  (README's API table is the index; `types/lovecraft-ui.d.ts` types all of it). Reaching
  into internal modules couples you to internals that may move.
- **`Eldritch.init()` exactly once, before constructing any widget.** Widgets resolve their
  textures at construction; before init there are no textures and constructors throw.
- **Everything lives in the engine's node tree.** Static UI goes into
  `engine.layers.background`; windows manage themselves; never touch `engine.uiScene` directly.
- **`Eldritch.init()` / `Eldritch.destroy()` are a pair.** `destroy()` tears down every node,
  timer, listener, GPU resource, and the canvas; `init()` afterwards boots clean (this is the
  supported re-mount and re-boot path). Calling `init()` while running destroys the previous
  instance first.
- **`remove()` detaches and keeps; `dispose()` detaches and frees.** A removed node keeps its
  GPU resources and can be re-added. If a node is not coming back, call `node.dispose()` —
  it cascades to children, cancels tweens, releases materials/textures, and emits a `dispose`
  event first (tooltips detach themselves on it). You never need `remove()` before `dispose()`.
- `init(options)` covers the whole boot surface: `container`/`width`/`height`
  (embedding), `background: false` / `vignette: false` (strip the ambiance for HUD-only
  use), `theme` (token overrides or a shipped preset — section 6), `uiScale`
  (1.0/1.25/1.5/2.0 couch-distance scaling — section 6), `strings` (localization —
  section 5's rich-text recipe), `input: { gamepad: false }`, and `timerDriven: true`
  (headless testing only — section 7). Re-theming or re-scaling is always
  `destroy()` + `init({...})`.

## 2. Coordinates, sizing, layout

- Coordinates are **CSS pixels, top-left origin, y-down**, local to the parent. `setPos(x,y)`,
  `setSize(w,h)`, `setRect(x,y,w,h)`.
- Widgets size themselves at construction (buttons measure their label; fields take `width`).
  **Prefer the layout BOXES**: `VBox`/`HBox` stack and row with
  `{padding, gap, align, justify, frame}`, `GridBox` lattices (`cols`/`cellW`/`cellH`),
  `Stack` anchors children 9 ways (`place(child, 'top-right', inset)`), `Spacer` pushes,
  `Divider` rules, `FormRow`/`Form` build settings rows — boxes auto-size, converge over a
  settle beat, and a `frame:` makes the box OWN its stone with slice-inset padding (zero
  arithmetic; docs/API.md "Layout boxes" is the option reference). The positional helpers
  remain for one-shot placement: `row(children, {x,y,gap,align,height})`, `column(...)`,
  `grid(children, {x,y,cols,cellW,cellH,gap})`, `anchor(child, rect, where, insetX, insetY)`;
  `clamp(v, lo, hi)` and `fitChildren(node, opts)` are exported too.
- For dynamic layout, override `node.onLayout()` and position children there — it runs every
  layout pass (any `setRect` anywhere schedules one). Do not move nodes per-frame outside it.
- Keep positions integers (helpers round for you) — fractional positions soften text.
- Building a custom framed container? `contentRect(frame, w, h, pad)` returns the box a
  9-slice frame's border leaves free (pass a `NineSliceNode`'s `.frame` or
  `engine.textures.frame(name)`). The library's windows, popups, and panels derive their
  content boxes from it — do the same and overlay scrollbars land inside the stone, never
  on the border band. Count/cost badges anchor `METRICS.badgeInset` inside their corner.

## 3. Layering and hits (the library owns these — don't fight them)

- Paint order = hit order. Later-added siblings paint on top; the fixed root layers paint in the
  order `background < windows < dropdown < taskbar < overlay < ghost < tooltip < vignette`.
- Only nodes with `interactive = true` are hittable. Widgets set it on themselves; plain
  containers default to false. A hit-transparent decoration should stay non-interactive.
- Never assign `renderOrder`/z yourself. If something must "float", parent it to the right layer
  (that is exactly what tooltips, dropdowns, and drag ghosts do).
- 3D content goes inside an `Accent3DNode` (its `content` group takes lit, `transparent: true`
  meshes). Never mark UI-scene materials opaque — three renders its opaque list before every
  transparent quad, so an opaque mesh sinks behind the whole interface. Never set `renderOrder`
  on a `THREE.Group` — a group's renderOrder becomes `groupOrder`, which outranks every mesh.

## 4. Events, focus, and who owns the model

```js
node.on('click', (e) => { ... });      // e.x/e.y in UI px; e.stopPropagation() stops bubbling
node.on('change', (e) => { ... });     // toggles/radios/selects/sliders/fields
slotGrid.on('slotchange', (e) => { }); // {slot, icon, action:'add'|'remove'} — bubbles
EldDragDrop.on('action-triggered', (e) => { }); // {slot, icon} — global mirror
log.on('linkclick', (e) => { });       // {id, text, x, y} — inline {link:} runs bubble
                                       // through EventLog/ChatBox (linkhover too)
```

Pointer events bubble parent-ward like the DOM (`pointerdown/up/move`, `pointerenter/leave` are
per-node, non-bubbling). During any drag gesture the pointer is captured by the source node and
hover updates are suppressed — the "interaction guard" of the source library, built in.
Every node emits a non-bubbling `dispose` event at the start of `dispose()` — subscribe to it
for cleanup that must run when a node dies (the tooltip system uses it to auto-detach).
A node with `disabled = true` (or inside a disabled ancestor) is inert: it occludes, it hovers
(tooltips work), but it never receives press or `click` — not even from your own listeners.
Focus: widgets with `focusable = true` join Tab/gamepad traversal (`engine.focus`); define
`node.onActivate()` when Enter/Space/gamepad-A should do something a synthetic click cannot
express (slots trigger their rite, text fields start editing). Transient surfaces register on
the escape stack: `const off = engine.focus.pushEscape(() => close()); // call off() in close`.
Custom widgets that own their touch gesture (drag interactions) set `touchDragOwner = true`
or touches inside scroll areas convert to pans.

Three conventions span every widget in the library — internalize them once:

- **The data-driven protocol.** Kit widgets AFFORD; your game owns the state. A
  RecipeBrowser dispatches `craft` and decrements nothing; a BuildQueue dispatches
  `cancel` and expects `setQueue` back; a TechTree dispatches `research` and waits for
  your `setNodeState`; a SaveSlotList confirms an erase, dispatches `slotdelete`, and
  expects `setSlots`. Mutate your model in the handler, then call the widget's `set*`
  back. Never treat what a widget displays as the authoritative copy.
- **Silent setters.** Every programmatic setter (`setValue`, `setChecked`,
  `setItem`, …) fires NO events by default — only user gestures are loud. Pass
  `{silent: false}` when you want the same commit path a gesture takes (onChange
  callbacks, bindings, and dependent UI reacting). Forgetting this is the classic
  "my UI is stale and nothing errored" bug. `input` = continuous gesture;
  `change` = committed value.
- **The sound bus.** The library ships zero audio but narrates every gesture as
  `uisound {kind, node, data}` on `engine.bus` — subscribe once and map kinds
  (`click`, `hover`, `open`, `close`, `pickup`, `drop`, `swap`, `error`, `notify`,
  `type`, `cooldown`, `cast`) to your own mixer (section 5, "Choreography").

## 5. Component cookbook (the one correct way each)

Composing a full screen? `examples/game-hud.html` is the reference: one state object
feeding frames/globes/xp, one `hud.onLayout` glued to the engine size, one ticker
callback driving the world, floaters via `FloatText`, and chat via the `ChatBox`
widget (docs/COOKBOOK.md has the recipe versions of everything below).

### Draggable window

```js
const win = EldWindow.create({
  title: 'Inventory', width: 350, height: 300, x: 80, y: 60, resizable: true,
  content: (c, win) => {          // c is the scrollable content node
    const label = new TextNode('The shelves watch back.', { size: 13, color: COLORS.text });
    label.setPos(8, 8);
    c.add(label);
  },
});
// win.minimize(); win.restore(); win.toggleMaximize(); win.close(); win.bringToFront();
```

Content overflowing the window scrolls automatically with the stone scrollbar — do not build your
own scroll container inside. **Omit `width`/`height` and the window AUTO-SIZES to its
content** (viewport-clamped — pass `autoSize: false` for the legacy default, or any
explicit size, which stays law). `minW`/`minH` set resize floors; a window never resizes below
the size it was BORN at, and its content lane carries a fallback H-rail that only appears
if a user forces the window below its content's reflow minimum. `makeResizable(anyPanel,
{corner, minW, minH})` arms the same drawn-grip resizing on non-window panels (ChatBox and
EventLog take `resizable: {...}` directly). To bound windows to a page region,
`EldWindow.setContainer(node)`.
Give windows a stable `id` and layout persists as plain JSON:
`EldWindow.serializeLayout()` / `EldWindow.restoreLayout(savedJson)` round-trip every open
window's rect and minimized/maximized flags (build the windows first; restore matches by id).
`transitions: true` opts a window into the house open/close/minimize presets. Minimized
windows go to the taskbar automatically. `ModalWindow` is the scrimmed variant; `close()`
dispatches a PREVENTABLE `close` event.

### Static panel window

```js
const panel = new Window({ title: 'Stats', width: 350, height: 260, content: (c) => {...} });
panel.setPos(0, 40);
engine.layers.background.add(panel);
```

### Modal dialogs (confirm, custom buttons, prompt)

```js
EldPopup.show({
  title: 'Confirm Rite',
  message: 'This cannot be undone.',
  onOkay: () => {}, onCancel: () => {},
});

EldPopup.show({                       // custom buttons replace the OK/Cancel pair
  title: 'Grimoire', message: 'Its pages whisper.',
  buttons: [{ label: 'Burn It', onClick: () => burnIt(), variant: 'accent' },
            { label: 'Shelve' }],
}).then((r) => { /* r.action = 'ok' | 'cancel' | the clicked label; r.value = prompt text */ });

EldPopup.show({                       // a prompt adds a focused text field
  title: 'Split', message: 'How many?',
  prompt: { value: '21' },            // or { placeholder: 'name' }
  onOkay: (v) => split(Number(v)),
});
```

`show()` returns a Promise resolving `{action, value}`. The scrim never dismisses on click;
Escape cancels in ONE press, prompt or not. A `show()` while a popup is open queues it
(FIFO) — the next presents when the current resolves; check `EldPopup.isOpen`. The scrim
releases the moment the popup resolves: the user's next click lands immediately, even while
the fade is still playing — never build a "wait for the fade" delay into a flow.

### Context menu, toasts, and routed notifications

```js
bag.on('rightclick', (e) => {                    // wire menus from the rightclick event
  e.preventDefault();                            // suppresses the native menu (once)
  EldContextMenu.show([
    { label: 'Use', onClick: () => useIt() },
    { label: 'Sell', disabled: !vendorOpen, onClick: () => sellIt() },
    { separator: true },
    { label: 'Discard…', onClick: () => discardIt() },
  ], e.x, e.y);
});

EldToast.show({ title: 'Loot', message: 'Void Shard ×1',
                variant: 'loot', icon: 'deathkiss', duration: 3.5 });

EldNotify.send({ title: 'Whispers', key: 'whispers', message: 'Repeats collapse into ×n.' });
EldNotify.send({ channel: 'banner', title: 'The Stars Align', priority: 9 });
EldNotify.send({ channel: 'log', title: 'Quiet ink, written to the trail.' });
EldNotify.doNotDisturb = true;                   // every popup channel routes to the log
```

One menu at a time; it flips at viewport edges, closes on click/Escape/outside-press, and
ArrowUp/Down + Enter walk it. Toasts stack top-right (max 4 visible, overflow queues);
hovering pauses a toast's clock. Use `EldToast.show` directly for simple corner messages;
step up to `EldNotify.send` when you want ROUTING — `channel: 'toast' | 'banner' | 'log'`,
`priority` ordering, and a `key` that collapses repeats into a live "×n" counter.

### Tooltips

```js
EldTooltip.attach(node, { title: 'Blade of the Vigil', titleColor: COLORS.rarityRare,
                          desc: 'A blade quenched in ancient fires.', stats: ['+25 Attack Power'] });
// or dynamic: EldTooltip.attach(node, () => ({ title: currentName() }));
```

Slots, palette icons, unit-frame effects, minimap markers, and table rows attach themselves.
Tooltip specs (and EventLog/ChatBox/QuestTracker/toast text) accept `markup: true` for
styled runs and inline icons — see "Rich text" below.

### Forms

```js
const name = new TextField({ placeholder: 'Inscribe a name...', width: 220 });
name.on('input', (e) => EldEvents.log(`Text: ${e.value}`, 'INPUT'));
const vol = new Slider({ value: 50, width: 220, onInput: (v) => {} });
const hear = new ToggleLabel('Hear the whispers', { checked: true, onChange: (v) => {} });
const move1 = new RadioLabel('movement', 'WASD', { checked: true });
const move2 = new RadioLabel('movement', 'Arrow Keys');
const calling = new Select({ options: ['Cultist', 'Scholar', '---', 'Deep Hybrid'],
                             onChange: (value, label, index) => {} });
const supplies = new NumberField({ value: 1, min: 1, max: 99, onChange: (v) => {} });
const grabKey = new KeybindField({ value: 'Ctrl+K',
  checkConflict: (combo) => takenCombos.get(combo),   // return the holder's label to reject
  onConflict: (combo, holder) => {} });
```

`'---'` in select options renders a separator. An open dropdown flips above the field near
the viewport bottom, clamps to the screen edges, tracks its field while the host window
drags, and scrolls internally when the list is taller than the viewport. `NumberField`
steps with carved −/+ and arrow keys; `KeybindField` captures the next key combo or
mouse button (Escape cancels the capture). `SegmentedControl({options, value, onChange})`
is the exactly-one-selected button strip; `SpeedControl({value})` is its pause/1×/2×/3×
preset. A whole settings screen is `Tabs` or `SettingsPanel` — copy
`examples/settings.html`; every option-by-option contract is in docs/API.md.

### Action bar + drag-and-drop

```js
const bar = new ActionBar({ rows: 1, cols: 6, lock: true });   // slots + registered bar lock
['fireball', 'shield', 'sword'].forEach((rite, i) => {
  EldDragDrop.createIconInSlot(bar.slots[i], rite);            // programmatic fill
  bar.slots[i].setKeybind(String(i + 1));                      // keycap corner art
});
bar.on('slotchange', (e) => { /* e.slot, e.icon, e.action: 'add'|'remove' */ });

const palette = new IconPalette(['fireball', 'shield', 'sword'], { perRow: 3 });

Eldritch.onKey(['1', '2', '3', '4', '5', '6'], {               // digit hotkeys, the honest way:
  down: (e) => {                                               // focus-aware by construction —
    const n = Number(e.key);                                   // typing "3" into chat stays typing
    if (bar.slots[n - 1]) EldDragDrop.triggerAction(bar.slots[n - 1]);
  },
});                                                            // (prefer this to raw window listeners)
```

`ActionBar` is the composite — do not hand-roll slot grids. The palette is an infinite
source; slots move/swap the real icon nodes. Clicking a filled slot (or `triggerAction`,
or Enter/gamepad-A on a focused slot) fires `action-triggered` and a 3s cosmetic cooldown
that follows the icon between slots. Equipment slots are `CpSlot('head')` etc. — their
drags always cancel back, and the bar lock never seals them.
`EldDragDrop.serialize()` / `.restore(state)` snapshot the action-slot layout by slot id.

### HUD panels: unit frame / minimap / table / log / quests

```js
const uf = new UnitFrame({ name: 'Randolph Carter', portrait: 'portrait.player',
                           level: 55, health: [255, 255], mana: [100, 100] });
uf.addEffect({ icon: 'shield', name: 'Elder Ward', desc: 'Absorbs 500 damage',
               duration: '8s remaining', buff: true });
uf.setHealth(180);                      // tweens the ichor over 0.3s

const map = new Minimap({ zone: "R'lyeh Depths", zoneLevel: 'Level ??' });
map.addMarker('enemy', 25, 35);         // percent coordinates
map.zoomBy(1);                          // 1..3 in 0.5 steps

const t = new Table({ columns: [{label:'Name',width:200},{label:'Level',width:100}],
                      rows: [['Carter', 60], ['West', 59]] });  // headers auto-sort

const log = new EventLog({ width: 400, height: 200 });          // registers as EldEvents sink
EldEvents.log('The bell tolls', 'EVENT');

const quests = new QuestTracker({ header: 'Obligations', width: 250,
  quests: [{ title: "Dagon's Bane",
             objectives: [{ progress: '0/5', text: 'Slay the deep brood', done: false }] }] });
const hunt = quests.questNodes[0].id;   // addQuest({title, objectives}) also returns the id
quests.updateObjective(hunt, 0, { progress: '3/5' });
quests.completeQuest(hunt);             // dispatches questchange {id, action}
```

An `EffectBar` (the buff strip) also stands alone — place one anywhere. `CharacterPanel`
(equipment + stats + currency) and `SettingsPanel` (sidebar settings) are one-call
composites — README's API table has their full surface. For conversations,
`DialogPanel({portrait, speaker, text, onAdvance})` wraps a markup-capable body on a
stone frame: a click or Enter/Space/gamepad-A dispatches `advance {}`; your script calls
`setEntry({portrait, speaker, text})` to swap beats (`examples/narrative.html`).

### Meters, readouts, and floaters

```js
const resources = new ResourceBar({ chips: [        // chip SPECS — never pre-built chips
  { icon: 'book', value: 120, cap: 999, width: 104 },
  { icon: 'leafs', value: 34, cap: 100, warnAt: 15, width: 104 },
], gap: 10 });
resources.chips[0].setValue(140);                   // the live nodes; every change flashes its delta

const armor = new SegmentedBar({ segments: 6, max: 6, value: 6, width: 240, height: 20 });
const gauge = new ArcGauge({ value: 80, max: 100, radius: 40, label: 'STAMINA' });
const timer = new BigTimer({ seconds: 45, warnAt: 20, urgentAt: 8, running: true });
timer.on('timeout', () => {});                      // exactly once at zero
const stars = new StarRating({ value: 3 });
const omens = attachBadge(satchelBtn, { count: 2 }); // corner count chip; hides at 0
const xp = new ProgressBar({ value: 30, width: 220, segments: 10 });

const floats = new FloatText({ pool: 24 });          // pooled: combat never allocates
floats.spawn('42!', x, y, { crit: true, color: COLORS.negative });
```

All instruments speak the uniform contract (`setValue(v, {silent})`, `change` on loud
commits). ArcGauge re-tints by `thresholds: [{pct, color}]`; BigTimer's urgency tiers are
STATIC colors (nothing in this library pulses). ResourceChips flash on every value change
— that is presentation, so silent setters flash too. `CompassStrip` lives with the
survival kit below.

### The 3D pieces

```js
const orb = new Globe({ kind: 'sanity', label: 'Sanity', value: 54, max: 100, radius: 44 });
orb.setValue(30);                        // liquid drains with a slosh

const cast = new CastBar({ width: 300 });
cast.startCast('Summoning Shoggoth', 'fireball2', 3.5);
cast.on('castcomplete', () => landTheSpell());
cast.on('castinterrupt', () => fizzle());   // a startCast mid-flight interrupts the old cast first
```

The cast events (`caststart`/`castcomplete`/`castinterrupt`) are the contract — every cast
gets exactly one resolution (`onComplete` exists as a construction-time convenience).
Custom 3D content goes inside an `Accent3DNode` (`node.content` takes lit, transparent
meshes) — `makeOrbMesh(radiusPx, colorDeep, colorBright)` is the reusable liquid-orb
material behind Globe.

### Scrolling, and ten thousand rows

```js
const area = new ScrollArea({});
area.setRect(0, 0, 300, 200);
area.content.add(...children);          // children scroll + clip; hits respect the clip

const list = new VirtualList({
  rowH: 24, rowFocus: true,             // rowFocus: the LIST is one Tab stop; arrows walk items
  renderRow: (rowNode, item, i) => {    // fills IMPERATIVELY; reuse the row's children
    if (!rowNode._t) { rowNode._t = new TextNode('', { size: 12 }); rowNode.add(rowNode._t); rowNode._t.setPos(4, 3); }
    rowNode._t.setText(item.label);
  },
});
list.setRect(0, 0, 300, 220);
list.setItems(tenThousandThings);       // re-call after replacing; refresh() after mutating
list.on('rowactivate', (e) => open(e.item));   // Enter on the focused row; rowfocus fires per move

const chat = new ChatBox({ width: 300, height: 170, placeholder: 'Speak into the dark…' });
chat.on('submit', (e) => broadcast(e.value));  // Enter submits WITHOUT blurring; ↑/↓ recall history
```

Pooled rows cost one screenful of GPU no matter the item count. `EventLog({virtual: true})`
windows an UNBOUNDED scrollback the same way; `Table({virtual: true})` pools its rows while
the full model keeps sorting. `ChatBox` is the chat composite (EventLog + TextField) — do
not hand-roll it.

### Rich text, and your game's words

```js
const line = new TextNode('{color:#d96a5a}Ker{/} strikes {icon:sword} for {b}42{/}', {
  markup: true, size: 13, multiline: true, maxWidth: 260,
});

const prose = new TextNode('A {link:door}heavy oaken door{/} stands {hl:#223311}ajar{/}.', {
  markup: true, multiline: true, maxWidth: 320,
});
prose.interactive = true;                        // the raw-TextNode link opt-in
prose.on('linkclick', (e) => inspect(e.id));     // {id, text, x, y}
prose.on('linkhover', (e) => {});                // {id, text, over, x, y} — examine tooltips

Eldritch.init({ strings: { ok: 'Aye', splitRefused: 'Denied by the deep.' } });
```

Markup is opt-in per surface (`{color:#hex}…{/}`, `{b}`, `{i}`, `{icon:name}`, `{{` literal
brace; unknown tags render literally; styled runs survive wrapping and ellipsis). The same
`markup: true` opt-in works on tooltip specs, EventLog messages, ChatBox scrollbacks,
QuestTracker objectives, and toast bodies. Two more tags : `{link:id}…{/}`
CLICKABLE runs (tinted `COLORS.link`; hover wash + pointer cursor come built in; the
payload's `id` is your stable key, `text` is the visible words) and `{hl:#hex}…{/}`
HIGHLIGHT fills (the color argument is required). EventLog/ChatBox lines wire themselves
when a logged message carries links — `log.on('linkclick', …)` is the whole integration;
a raw TextNode needs only `interactive = true`. The scrollback also PINS honestly since
appends follow the tail only when the reader is already there (`atBottom`,
`scrollToBottom()`). Caveat: inside a DialogPanel, a link click also bubbles the panel's
plain `click`, which advances the conversation — guard your `advance` handler if links
must not advance. Links are pointer-only (keyboard traversal is catalogued). Every string
the LIBRARY itself draws or logs lives in `Eldritch.strings` — override any subset via
`init({strings})` (the key catalog is `STRING_DEFAULTS` in `src/strings.js`; templates
carry `{0}`/`{1}` slots; unknown keys warn). Text renders left-to-right only — bidi
reordering is not performed. The COOKBOOK's "Localize your game" chapter is the full
recipe.

### Bind a model (Store)

```js
const model = new Store({ player: { hp: 62, potions: 3 } });
bind(hpBar, model, 'player.hp');            // two-way: store→widget lands silent, widget's
                                            // loud change writes back — no loops by construction
bindText(potionLabel, model, 'player.potions', (v) => `Potions: ${v}`);
bindEnabled(drinkBtn, model, 'player.potions');
model.set('player.hp', 25);                 // notify is MICROTASK-BATCHED (flushes once per tick)

const cheats = DevPanel.fromSpec({ title: 'CHEATS', hotkey: 'F2', x: 16, y: 16, fields: [
  { type: 'readout', label: 'HP', path: 'player.hp' },
  { type: 'slider', label: 'Set HP', path: 'player.hp', min: 0, max: 100, step: 1 },
  { type: 'toggle', label: 'God mode', path: 'cheats.god' },
] }, model);
```

`Store` is a dot-path observable ledger — deliberately NOT a spreadsheet (no computed
values; derive in your own subscriber). Disposing a bound widget unbinds it. `DevPanel`
is the studio cheat panel: every row is a `bind` under the hood, the header collapses it,
and the hotkey rides the engine bus so it works no matter what holds focus.
`examples/binding.html` runs the whole ledger, including layout + settings persistence.

### Screens and flow (title, saves, levels, credits, loading)

```js
const menu = new MenuScreen({
  title: 'THRESHOLDS',
  items: [
    { label: 'New Game', onSelect: () => savePicker() },
    { label: 'Difficulty', onSelect: () => menu.push({   // a SUBMENU slides in;
        title: 'Difficulty',                             // Escape/gamepad-B pops one level
        items: ['Merciful', 'Fair', 'Merciless'].map((d) => ({ label: d, onSelect: () => pick(d) })),
      }) },
    { label: 'Continue', disabled: true },
  ],
});
engine.layers.overlay.add(menu);

await TitleCard.show({ title: 'THE DESCENT BEGINS', subtitle: 'merciless waters', hold: 1.1 });

let saves = [{ name: 'Ilse of the Quay', timestamp: 'the 3rd bell', playtime: '4h 12m' }, null];
const picker = new SaveSlotList({ slots: saves, width: 420,   // null renders the New Vessel card
  onSelect: (i, slot) => descend(slot),
  onNew: () => descend(),
  onDelete: (i) => { saves = saves.filter((_, k) => k !== i); picker.setSlots(saves); },
});

const stairs = new LevelSelectGrid({
  levels: [{ id: 1, label: 'I', state: 'done', stars: 2 },
           { id: 2, label: 'II', state: 'open', stars: 0 },
           { id: 3, label: 'III', state: 'locked', stars: 0 }],
  cols: 4, pageSize: 8,
  onSelect: (e) => { if (e.state !== 'locked') enter(e.id); },  // locked still clicks — locked is DATA
});
stairs.setLevelState(2, 'done');

const roll = new CreditsScroller({ width: 420, height: 250, speed: 30, entries: [
  { header: 'THE KEEPERS' },
  { role: 'Harbor-Master', name: 'Ilse of the Quay' },
  { text: 'No assets were shipped in the making of this interface.' },
] });
roll.on('done', () => leaveCredits());     // fires once, however the end arrives (skip() included)

const veil = new LoadingVeil({ title: 'DESCENDING', flavor: 'The stair remembers your weight.' });
engine.layers.overlay.add(veil);
veil.setValue(64);                          // the orb's liquid level rides the progress
await veil.fadeOut();                       // resolves when the fade lands; disposes itself
```

MenuScreen is a full-screen shell (abyss scrim glued to the engine size) whose MenuList
is ONE focus stop — Up/Down wrap the enabled rows, Enter/gamepad-A selects. SaveSlotList's
Erase button confirms through EldPopup BEFORE `onDelete`/`slotdelete` — then it is yours:
mutate and `setSlots` back (the data-driven protocol). Save thumbnails are procedural —
pass `thumbnail(ctx, w, h)` per slot or keep the seeded house sigil.
`examples/meta-screens.html` walks the entire flow end to end.

### Teach the first minute (onboarding)

```js
const tour = new TutorialSequencer({
  steps: [
    { target: null, advance: 'manual',            // null = narration: full scrim, centered card
      title: 'The Guiding Hand', text: 'Only the lit ground answers your touch.' },
    { target: invokeBtn, advance: 'click',        // advance on a click in the target subtree
      title: 'Invoke', text: 'Click the highlighted button.' },
    { target: dreadSlider, advance: 'change',     // advance on a committed value
      title: 'Set the Dread', text: 'Drag the slider to any new value.' },
    { target: () => win, advance: 'manual', shape: 'circle', pad: 14,   // lazy targets resolve late
      title: 'The Circle', text: 'Cutouts morph between lessons.' },
  ],
  onStep: (i, step) => {},
  onDone: (completed) => {},                      // false when skipped/Escape-aborted
});
tour.start();
```

The sequencer runs one `Spotlight` (a scrim with a live hole that TRACKS its target) and
one `Coachmark` (the stone callout with progress dots and Next/Skip). Input outside the
cutout is sealed — pointer, Tab, spatial nav, and gamepad alike — while dropdowns and
popups opened in the light still rise above the scrim. Act-steps focus their target so
Enter/gamepad-A works through the hole; a target dying mid-step recovers forward; the
finished tour fades and disposes itself. Spotlight and Coachmark also work standalone
for a single "look here" beacon — `examples/tutorial.html` shows both modes.

### UI pinned to the world

```js
const anchors = new WorldAnchorLayer({ project });   // YOUR camera: project(x, y, z) must
engine.layers.background.add(anchors);               // return {sx, sy, visible}

anchors.anchor(nameplate, mob, { dy: -22,            // target: {x,y,z}, a live object, or a fn
  fadeWith: (target, p) => 1.15 - p.depth / 1400 }); // drives fxOpacity per frame

anchors.anchor(new OffscreenIndicator({ icon: 'icon.deathkiss' }), mob,
  { clampToEdge: true, edgeMargin: 26 });            // FULL registry name here ('icon.*')

const relic = new InteractPrompt({
  action: { key: 'E', pad: 'A' }, label: 'Claim the Relic', hold: 0.9,
  onConfirm: () => claim(),                          // fires exactly once at full ring
});
anchors.anchor(relic, relicAt, { dy: -14 });
// your game's key state drives the ring:
relic.beginHold();  relic.cancelHold();
```

One pooled frame hook drives every anchor (never per-anchor hooks). `clampToEdge` pins
the node inside the viewport and reports the clamped direction to the node's
`onEdge(dir|null)` — behind-camera points mirror across the screen center first, which is
what keeps edge arrows honest. `InputPrompt(action, label)` shows the bind for the
LAST-USED device and re-glyphs on the engine's `devicechange` event; `KeyGlyph` bakes
procedural keycap/pad/mouse art on demand. `examples/action-hud.html` swings a night
quay with all of it live — five landmarks the anchor layer carries in and out of frame,
edge markers for the ones behind you, a hold-to-raise lantern prompt, and a control
legend whose glyphs re-draw when a real gamepad arrives.

### Skill trees and tech webs

```js
const SAGA = { nodes: [                              // ONE dataset shape for both skins;
  { id: 'trunk', icon: 'book', cost: 0, rank: 0, owned: true },      // edges DERIVE from requires
  { id: 'ward', icon: 'shield', cost: 2, rank: 1, requires: ['trunk'] },
  { id: 'blade', icon: 'sword', cost: 2, rank: 1, requires: ['trunk'] },
] };                                                 // tier/era alias rank

const skills = new SkillTree({ data: SAGA, points: 8 });
skills.on('spend', (e) => save(e));                  // {id, cost, points} — the tree owned the spend
skills.setPoints(21, { silent: true });              // respec() confirms, then refunds to the floor

const tech = new TechTree({ data: SAGA, eraLabels: ['Tithes', 'Tolls', 'Graves'],
  onResearch: (v, e) => beginResearch(e) });         // {id, cost} — an AFFORDANCE only:
tech.graph.setNodeState('ward', 'owned');            // ...the GAME lands research when done
```

SkillTree owns the spend transition (pay, own, re-derive dependents); TechTree owns
nothing — the research model is yours. Both expose `.graph` and `.surface`, and
`setData(data)` rebuilds wholesale. For custom lattices, compose the core directly:

```js
const surface = new PanZoomSurface({ planeW: 1400, planeH: 700, minZoom: 0.4, maxZoom: 2.5 });
surface.setRect(40, 80, 900, 520);
engine.layers.background.add(surface);

const lattice = new NodeGraph({
  nodes: [                                   // x/y are plate CENTERS in plane px
    { id: 'ward',     x: 70,  y: 260, icon: 'shield',   state: 'owned' },
    { id: 'blade',    x: 200, y: 200, icon: 'sword',    state: 'available', cost: 1 },
    { id: 'balefire', x: 330, y: 140, icon: 'fireball', state: 'locked',    cost: 3 },
  ],
  edges: [['ward', 'blade'], ['blade', 'balefire']],
});
surface.add(lattice);                        // forwards to surface.content
surface.centerOn(200, 200);

lattice.on('nodeclick', (e) => {             // locked plates still click — the game decides
  if (e.state === 'available') lattice.setNodeState(e.id, 'owned');
  else if (e.state === 'locked') lattice.setHighlight(['ward', 'blade', e.id]); // chain ring
});
```

Wheel zooms at the cursor; dragging pans (clicks under the 5px threshold still land on
plates); plates carry ability tooltips and join Tab/gamepad traversal. Keep Sliders,
TextFields, and Selects OUT of the plane — screen-delta gestures and detached dropdowns
are not zoom-aware; plane content is for click/hover/tooltip/focus targets.

### The war table (RTS)

```js
const marquee = new SelectionMarquee({ onSelect: (r) => pick(r) }); // {x,y,w,h,shift}
engine.layers.ghost.add(marquee);            // arms ONLY on empty-space presses;
                                             // THE GAME intersects the rect with its entities
const card = new CommandCard({
  commands: [
    { id: 'raise', icon: 'shield', hotkey: 'Q', cost: 50 },
    { id: 'raze',  icon: 'fireball', hotkey: 'W', cost: 120 },
    { id: 'still', icon: 'book', disabled: true },
  ],
  units: [], cols: 4,
  onCommand: (v, e) => execute(e),           // {id, cost} — clicks AND hotkeys funnel here
});
card.setUnits([{ id: 'thrall', icon: 'deathkiss', count: 6 }]);   // display-only tray

const forge = new BuildQueue({ slots: 5,
  onCancel: (v, e) => { pending.splice(e.index, 1); forge.setQueue(pending); } });
forge.setQueue(pending);                     // [{id, icon, count}] — repeats stack a badge
forge.setProgress(0.4);                      // the head slot's underbar; YOU clock it

const warMap = new TacticalMap({
  width: 220, height: 150, world: { w: 2000, h: 1200 },
  terrain: (ctx, w, h) => paintGround(ctx, w, h),      // baked once at the live density
  onMove: (v, e) => moveCamera(e.x, e.y),              // WORLD coordinates
});
warMap.setViewport({ x: 750, y: 400, w: 500, h: 300 }); // the camera footprint, world-space
warMap.ping(300, 900);                                  // finite pulse; {waypoint: true} variant
```

Command hotkeys are single-atom keyboard binds that match only while nothing holds focus —
so they stay live after any mouse click by architecture. Sub-threshold marquee presses
stay clicks; canceled rects skip `onSelect`. The resource row above the card is the
instruments assembly: `ResourceBar` chips + `EldTooltip.attach` on `.chips`.
`examples/strategy-hud.html` is the assembled HUD.

### The long winter (survival / crafting)

```js
Eldritch.registerItem('pelt', { name: 'Winter Pelt', desc: 'Still warm, somehow.',
                                icon: 'leafs', rarity: 'common', stackMax: 10 });  // FIRST

const satchel = new ItemGrid({ cols: 4, rows: 2 });
const chest = new ItemGrid({ cols: 4, rows: 2 });
satchel.setItem(0, 'pelt', 7);
satchel.setItem(3, 'cloak', 1, { durability: 0.55 });  // tier-tinted underbar; rides the icon
satchel.setDurability(3, 0.2);                          // re-tiers live; null clears

chest.linkTransfer(satchel); satchel.linkTransfer(chest);  // shift-click quick-moves a stack
chest.transferAll(satchel);                                // Take All; the reverse call deposits
satchel.on('transfer', (e) => recount());                  // {index, id, count, to} — not 'change'

const browser = new RecipeBrowser({
  recipes: [{ id: 'cloak', label: 'Pelt Cloak', icon: 'shield',
              out: { id: 'cloak' }, needs: [{ id: 'pelt', count: 5 }], category: 'garb' }],
  have: (id) => counts[id] ?? 0,                       // YOUR inventory truth
  onCraft: (v, e) => {                                 // {id, count, out, needs} — ×N-scaled
    spendFromGrids(e.needs); grantOutput(e.out);       // the game decrements...
    recount(); browser.refresh();                      // ...then refresh() re-reads have()
  },
});

const fire = new ProcessPanel();             // .input / .fuel / .output are REAL 1×1 ItemGrids —
fire.input.setItem(0, 'fish', 2);            // the whole drag protocol interops unchanged
fire.fuel.setItem(0, 'wood', 4);
fire.setProgress(burnFraction);              // the arrow; YOUR ticker clocks the burn

const compass = new CompassStrip({ width: 340, heading: 340,
  markers: [{ bearing: 15 }, { bearing: 250, color: COLORS.negative }] });
compass.setHeading(0);                       // the 359→0 wrap is a texture-offset modulo
```

Quick-transfer merges into same-id stacks first (honoring `stackMax`), then takes the
first empty slot; a destination with no room refuses loudly and dispatches nothing.
`transferAll` merges COMPOUND — a stack spilled into an empty slot becomes the next
stack's merge target — and returns the number of stacks moved. Durability is
presentation on the traveling icon (`getItem` still returns `{item, count}`); keep
`stackMax: 1` on items where per-instance durability matters.
`examples/survival-hud.html` is the camp: the quick-transfer triangle, a page-clocked
campfire, and the browser spending real grid stacks.

### The speaking stones (a MUD in a window)

```js
const feed = new ChatBox({ width: 520, height: 340, markup: true });  // THE MUD WINDOW:
engine.layers.background.add(feed);                                   // pinned scrollback +
feed.on('linkclick', (e) => feed.field.setValue('look ' + e.id));     // command history built in
feed.log('A {link:rat}grey rat{/} gnaws at a {link:door}heavy door{/}.', 'ROOM');

Eldritch.registerItem('ring_bone', { name: 'Bone Ring', icon: 'leafs',   // register FIRST,
  rarity: 'common', stackMax: 1, data: { kind: 'ring' } });             // with your typing data
const isKind = (k) => (id) => itemData(id).data?.kind === k;

const worn = new EquipmentRack({
  zones: [
    { id: 'rings',   label: 'Rings',   slots: 6, accepts: isKind('ring') },   // 5+ rings? six fittings
    { id: 'amulets', label: 'Amulets', slots: 2, accepts: isKind('amulet') },
  ],
  onEquipChange: (v, e) => save(e),        // {zone, index, item, count, action}
});
worn.linkTransfer(satchel);                // shift-click unequips into the bag; drag equips

const body = new BodyDoll({ onPartClick: (e) => feed.log(`You examine your ${e.part}.`) });
body.setPart('l-arm', { damage: 2, bleed: true });   // ranks clamp 0..3; flags coerce
body.setPart('l-arm', { bleed: false });             // merge-patch: other fields keep
body.setPart('head', { scars: 1 });                  // scars 1..3 paint stitch marks
```

The doll's thirteen parts (head, neck, back, chest, abdomen, arms/hands/legs/feet per
side) are each hoverable, clickable, focusable, and tooltipped from your state — the
GAME owns the body model and calls `setPart` back (the data-driven protocol; `partchange`
narrates loud commits). Missing limbs ghost to void but stay clickable — a bleeding
stump is a real state. The rack's zones are REAL ItemGrids: drags, splits, tooltips,
durability, and locks all interop, and the `accepts` predicate refuses foreign items
politely on every doorway — including both sides of a cross-grid swap. `setItem` stays
game-authoritative (it bypasses `accepts` by design — loading a save never argues with
a doorway). `examples/mud-hud.html` assembles the whole room.

### Choreography (motion + sound)

```js
await animateOut(plate, 'fall');             // 'rise' | 'fall' | 'fadeScale' | 'stoneSlide'
await animateIn(plate, 'rise', { dur: 0.3 }); // promises ALWAYS settle (supersede/dispose included)
await stagger(plates, 'rise', { gap: 0.06 }); // a group enters one after another

engine.ticker.tween(node, { x: 100 }, { dur: 0.3, ease: Easing.easeOutCubic });

engine.bus.on('uisound', ({ kind }) => mixer.play(kind));  // the whole sound integration
Eldritch.reducedMotion = true;               // collapses every preset to its instant end state
```

Presets enter along their vector and exit continuing it; end states are exact (`visible`,
transform, and `fxOpacity` all restored), so a plain `visible = true` later just works.
`Eldritch.reducedMotion` is a player/OS preference — it deliberately survives `destroy()`.
Windows (`transitions: true`) and menus opt into the same presets. `examples/juice.html`
is the gallery and the sound map.

## 6. Theming, scale, and photo mode

Use `COLORS` from the entry — never hard-code hexes: `COLORS.accent` (verdigris green),
`COLORS.bone` (carved-bone titles), `COLORS.text/textMuted/textFaint/textDisabled`,
`COLORS.positive/negative`, rarity colors `rarityCommon/rarityRare/rarityEpic/rarityLegendary`.
Header text is `FONTS.header` with `smallCaps: true, letterSpacing: 1-2`; body is `FONTS.body`;
the log is `FONTS.mono`. New textures belong in `art.js`/`art-icons.js` through the registry
(`engine.textures.make/makeFrame`) so settings (sRGB, filtering, no mipmaps) stay uniform.

```js
Eldritch.registerAbility('void_lantern', {           // lore + icon painter in one call
  name: 'Void Lantern', desc: 'Light that darkens.', stats: '13 Gloom',
  painter: (ctx, w, h) => { iconBase(ctx, w, h); /* draw with glow()/noGlow() */ },
});
Eldritch.registerItem('moss_poultice', { name: 'Moss Poultice', icon: 'leafs',
                                         rarity: 'common', stackMax: 10 });

import { brass } from './src/lovecraft-ui.js';        // shipped presets: brass, aether
Eldritch.init({ theme: brass });                     // re-theme = destroy() + init({theme})

Eldritch.init({ theme: {
  colors: { accent: '#d18b6f' },                     // token overrides ride the same option
  seeds: { offset: 3 },                              // one integer re-cuts every stone
  painters: { 'select.arrow': (ctx, w, h) => {...} } // replace one registry art by name
} });

Eldritch.init({ uiScale: 1.5 });                     // couch-distance: 1.0 / 1.25 / 1.5 / 2.0

Eldritch.setHUDVisible(false, { except: [frameGrid] }); // photo mode: every UI band sleeps
Eldritch.setHUDVisible(true);                           // exact-prior restore
```

**Register before constructing users.** Icons, abilities, and items resolve at
construction/placement time; registrations persist across destroy/init and re-bake every
boot. Painters read the THEMED `COLORS` lazily at bake time, so a palette alone re-skins
everything; a throwing painter warns while stock art stands. `uiScale` keeps layout and
hit math in logical px and re-bakes the atlas at the higher density, so the stone stays
crisp. docs/THEMING.md has the preset-authoring walkthrough and colorblind guidance;
`examples/theme-gallery.html` switches all of it live.

## 7. Dev tools, and proving your page boots

- **`?debug=1`** arms the debug overlay (bounds, hit chain, perf HUD); the `i` key then
  toggles the **DebugInspector** — a live layer tree with click-to-select, a property
  readout, a read-only Pick mode, and the leak dashboard (live node/tween/hook/texture
  counts; numbers that refuse to fall after a teardown are your dispose report).
- **`?console=1`** (or the backtick key while nothing holds focus) summons the
  **DebugConsole**. Register your own cheats:

```js
const con = new DebugConsole();
engine.layers.overlay.add(con);
con.register('summon', (rest, c) => { spawnVisitors(parseInt(rest, 10) || 1); return 'done.'; },
             'summon <n> visitors into the log');
```

- `EldEvents.tap(fn)` observes every log line WITHOUT stealing the sink from your
  EventLog (returns an `off()` function) — the console uses it; so can your tooling.
- **A magenta plate with a warning means an unregistered texture/icon name.** That is a
  defect to fix immediately (register the icon, or fix the id), never something to ship.
- **Give every page boot-health hooks** (copy the README's "Minimal page" — it is
  the canonical skeleton). Errors surface in the title, so a headless dump can gate on it:

```js
window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push(e.message));
window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason)));
// ...boot the page, then after a settle beat:
setTimeout(() => {
  document.title = window.__errs.length ? 'FAIL ' + String(window.__errs[0]).slice(0, 80)
                                        : 'MYPAGE READY';
}, 1000);
```

- Drive it headless with
  `chrome --headless=new --dump-dom --virtual-time-budget=240000 --window-size=1280,760 http://localhost:8000/mypage.html`
  and read the `<title>`. Pass `timerDriven: true` to `init()` on test pages — headless
  DOM dumps never fire `requestAnimationFrame`. Keep the window size: smaller viewports
  let the taskbar swallow fixture clicks. Keep the budget too: it is the test suite's own
  240s ceiling, and a smaller one silently truncates a long suite mid-run.
- **The instruments prove more than boot** (every shipped page holds all
 three at 0 — docs/STYLE.md is the protocol):
  - `?audit=1` runs the page auditor (`runAudit(engine)`) — overlap, containment,
    contrast, scrollbar truth, hit floors, and reach (every visible interactive
    node must answer a real `hitTest` from somewhere on its own box) — and titles
    `AUDIT <n>`.
  - `?torture=1` runs the states walker (`runStateTorture`) — every hover-reactive
    node must show visible hover/press and restore on leave; titles `TORTURE <n>`.
  - `?resize=1` runs the resize walker (`runResizeTorture`) — every resizable
    surface survives grow → floors → restore with a clean audit; titles `RESIZE <n>`.
  Deliberate exceptions are declared per node (`auditAllow(rule)` with a comment)
  and rationed. Drive all three on your own pages; a title above 0 names each
  violation in the on-page census panel.
  - the input replay covers what every flagged run parks: real CDP
    mouse/keys against the UNFLAGGED page (`the input replay` + a steps script per
    page). If you script your own page, export a small `window.__<name>` handle
    bag and click handles, never coordinates — a vanished handle then fails loudly
    instead of clicking through to whatever moved underneath.

## 8. DON'T (these cause the broken-interface problem)

- Do not construct widgets before `Eldritch.init()` — texture lookups throw.
- Do not add UI meshes to `engine.uiScene` directly — they will miss layout, hits, and layering.
- Do not set `cursor`/`renderOrder`/materials `opaque` — the engine owns them (section 3).
- Do not use the HTML5 drag API or DOM elements over the canvas — pointer flow is custom.
- Do not build a second scrollbar inside a window; the content area already scrolls.
- Do not move nodes every frame outside `onLayout`/tweens — use
  `engine.ticker.tween(node, {x: 100}, {dur: 0.3})`.
- Do not block the boot on fonts or assets — there are none; the library is self-contained.
- Do not expect programmatic setters to fire events — they are silent by default; pass
  `{silent: false}` when dependent UI must react (section 4).
- Do not hand `ResourceBar` pre-built chips — it takes SPECS and constructs the chips
  itself (`.chips` holds the live nodes afterwards).
- Do not place an item/icon/ability id before registering it — register first, construct
  second, or you ship the magenta fallback plate.
- Do not put Sliders, TextFields, or Selects inside a `PanZoomSurface` plane — screen-delta
  gestures and detached dropdowns are not zoom-aware (plane content is for
  click/hover/tooltip/focus targets).
- Do not treat a kit widget as your model — it AFFORDS (`craft`, `command`, `cancel`,
  `research`, `slotdelete`, `partclick`…); mutate your own state and call its `set*`
  back (section 4).
- Do not use `accepts` to model capacity or weight — it types the DOORWAY (entry from
  another container); programmatic `setItem` bypasses it by design, and same-grid
  rearranges never ask.
- Do not expect `accepts` to hide drop targets — a refusing zone still lights on
  drag-over and refuses politely on release (hiding it would route the release to the
  discard-confirm flow and offer to destroy a stack the zone merely declined).
- Do not rely on appends yanking a log to the bottom — the scrollback pins
  honestly (a scrolled-up reader keeps their place); call `scrollToBottom()` where a
  hard jump is the intent.

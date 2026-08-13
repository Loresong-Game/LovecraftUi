# LovecraftUI — Lovecraftian WebGL Game Interface Library

A build-free, three.js-rendered game UI library. Eldritch horror theme: carved stonework, dark
abyssal fog, verdigris-green accents. Every texture is generated procedurally at load with a
seeded generator — the library REQUIRES **zero image files** (an optional 3,840-icon painted
pack ships under `assets/icons`; see "The icon pack" below). It provides a complete interface toolkit: windows, dialogs, drag-and-drop action bars, tooltips,
selects, sortable tables, sliders, text input, unit frames, minimap, taskbar — plus things only a
WebGL renderer can offer, like orbs of true liquid.

### ▶ See it running: **[lovecraftui.com](https://lovecraftui.com)**

Every example page below runs live in the browser there — no install, no build.

---

> ### Building an interface? Read **[docs/GUIDE.md](docs/GUIDE.md)** first.
> docs/GUIDE.md is the authoritative construction guide — the include recipe, the one correct way to
> create each component, and the conventions (coordinates, layering, events, scrolling). This
> README is orientation and reference. **`examples/index.html` is the hub of every working
> page**; `examples/game-hud.html` is the 1.0 flagship (a complete combat HUD in one file) and
> `examples/demo.html` is the widget-by-widget showcase. The uniform widget contract lives in
> **[docs/API.md](docs/API.md)**; recipes in **[docs/COOKBOOK.md](docs/COOKBOOK.md)**.

> ### Extending the library? **[docs/EXTENDING.md](docs/EXTENDING.md)** is the contract.
> It covers the UINode subclass rules, painter rules, and the typing recipe;
> **[docs/STYLE.md](docs/STYLE.md)** governs anything visible.

---

## What's Included

| Type | Count | Description |
|------|-------|-------------|
| Generated textures | 128 | Stone frames, controls, icons, portraits, map, cursor, body plates — all procedural |
| Behavior systems | 8 | `EldWindow` (windows/taskbar), `EldPopup`, `EldDragDrop`, `EldTooltip`, `EldContextMenu`, `EldToast`, `EldNotify`, `EldEvents` — plus the focus/gamepad model, the `Store` ledger, and the animation/sound rails |
| Widgets | 70+ | Buttons through full genre kits (strategy, survival, crafting, talent grids); see the API table below |
| 3D accents | 2 | Liquid orbs, ambient abyss scene |
| Example pages | 26 | Every component, interactive — `examples/index.html` is the hub |
| Icon pack | 3,840 | An optional painted set under `assets/icons`; the library needs no image files at all |

Requires WebGL2 (every current browser). No npm, no bundler — ES modules served over HTTP.

---

## File Structure

```
LovecraftUi/
├── README.md                  # This file (orientation + reference)
├── LICENSE                    # MIT (three.js separately MIT)
├── VERSION                    # Current version (matches Eldritch.version)
├── assets/
│   └── icons/                 # OPTIONAL painted icon pack: 60 atlas sheets +
│                              #   the generated manifest.mjs. Nothing loads it
│                              #   unless a page calls loadIcons/loadIconPack;
│                              #   delete the folder and every page still boots
│                              #   art-complete on the procedural painters.
├── docs/
│   ├── GUIDE.md               # How to build an interface with the library
│   ├── API.md                 # The uniform widget contract + per-widget reference
│   ├── COOKBOOK.md            # Composition recipes backed by the example pages
│   ├── THEMING.md             # Token → surface table, seeds, strings
│   ├── GALLERY.md             # The index of proof: one row per example page
│   ├── EXTENDING.md           # UINode subclass contract, painter rules, typing recipe
│   └── STYLE.md               # The game-feel law (visual/interaction rules)
├── types/
│   └── lovecraft-ui.d.ts      # Hand-written typings for the whole public surface
├── vendor/
│   ├── three.module.js        # three.js r178 (pinned, vendored)
│   └── three.core.js          # its companion chunk
├── src/
│   ├── lovecraft-ui.js        # ★ PUBLIC ENTRY — import everything from here
│   ├── strings.js             # the user-facing string table (init({strings}) overrides)
│   ├── animate.js             # animateIn/Out/stagger presets + the reducedMotion gate
│   ├── store.js               # Store + bind/bindText/bindEnabled (the bound ledger)
│   ├── theme.js               # palette, fonts, metrics
│   ├── anim.js                # Ticker + tween system
│   ├── node.js                # UINode base (tree, events, dirty flags)
│   ├── layout.js              # free-placement helpers
│   ├── layoutbox.js           # the layout engine: VBox/HBox/GridBox/Stack/Spacer/Divider
│   ├── primitives.js          # QuadNode, NineSliceNode, Accent3DNode
│   ├── text.js                # TextNode (canvas-rasterized text)
│   ├── clip.js                # ClipRegion + ScrollArea
│   ├── layers.js              # paint-order renumbering, focus counter, z-slabs
│   ├── hit.js                 # hit testing + hover synthesis
│   ├── input.js               # pointer/keyboard plumbing, hidden IME input
│   ├── input-gamepad.js       # GamepadNav (d-pad/stick focus, repeat clocks)
│   ├── focus.js               # FocusManager (traversal, activation, Escape stack)
│   ├── engine.js              # renderer, cameras, frame pipeline
│   ├── texgen.js              # texture factory/registry, cursors, seeded RNG
│   ├── art.js                 # stonework painters (frames, controls)
│   ├── art-icons.js           # icon/portrait/map painters
│   ├── icons.js               # the OPTIONAL icon pack loader (loadIcons/loadIconPack)
│   ├── fx.js                  # background scene, vignette, orb shader
│   ├── debug.js               # ?debug=1 overlay (bounds, hit chain, perf HUD) + DebugInspector
│   ├── audit.js               # runAudit(engine): the six-rule page auditor (?audit=1)
│   ├── torture.js             # the interaction-states walker + the resize walker
│   ├── themes/                # shipped presets: brass (warm tycoon), aether (sci-fi glass)
│   └── widgets/               # every widget, by kit — see docs/API.md
└── examples/                  # 26 runnable pages; index.html is the hub
```

---

## Quick Start

Serve the folder over HTTP (ES modules do not load from `file://`):

```
python -m http.server 8000
# open http://localhost:8000/examples/demo.html
```

Supported viewport floor: **1280×720 logical px** (css size ÷ `uiScale`). At `uiScale: 2` that means a ≥2560×1440 window. Below the floor the library
keeps running but layouts degrade best-effort — panel overlap at smaller logical sizes is
out of scope, not a bug.

Minimal page — **the canonical skeleton**: copy this to start an interface (it carries the role `examples/starter.html` used to; every shipped example
carries these boot-health hooks — the self-test pages in an equivalent variant —
so an error anywhere surfaces in the tab title and even a headless screenshot run
can see a broken boot):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Game UI</title>
  <style>html,body{margin:0;height:100%;overflow:hidden;background:#04060a}</style>
  <script type="importmap">{ "imports": { "three": "./vendor/three.module.js" } }</script>
</head>
<body>
<script>
// boot-health hooks FIRST, before the module loads: a throw during boot must
// still reach the title
window.__errs = [];
window.addEventListener('error', (e) => { window.__errs.push(e.message); document.title = 'ERROR@' + String(e.message).slice(0, 80); });
window.addEventListener('unhandledrejection', (e) => { window.__errs.push(String(e.reason)); document.title = 'ERROR@' + String(e.reason).slice(0, 80); });
const __consoleError = console.error.bind(console);
console.error = (...a) => { window.__errs.push(a.join(' ')); __consoleError(...a); };
</script>
<script type="module">
  import { Eldritch, EldWindow, Button, EldTooltip, EldToast } from './src/lovecraft-ui.js';

  Eldritch.init(); // boots renderer, art, and every system

  EldWindow.create({
    title: 'Reliquary', width: 350, height: 300, x: 80, y: 60,
    content: (c) => {
      const door = new Button('Open the Door', {
        onClick: () => EldToast.show({ title: 'The hinges remember you.', duration: 2.5 }),
      });
      door.setPos(10, 10);
      c.add(door);
      EldTooltip.attach(door, { title: 'The Door', text: 'It opens inward. They always do.' });
    },
  });
</script>
</body>
</html>
```

`Eldritch.init(options)` accepts: `container` (host element, default `document.body`),
`width`/`height` (fixed size; default tracks the container), `windowContainer` (a UINode that
bounds windows), `taskbar: false`, `background: false`, `vignette: false`,
`timerDriven: true` (headless testing), `theme` (`{colors, fonts, metrics, seeds:{offset}}`
token overrides applied before the texture bake — re-theme = `destroy()` + `init({theme})`;
`scrollbarW`/`windowHeaderH`/`dragThreshold` are frozen at module load and warn),
`strings` (overrides for any subset of the library-authored string table — see the
`Eldritch.strings` row below and `src/strings.js` for the key catalog), and
`input: { gamepad: false }` to disable gamepad navigation (`input.getGamepads` /
`input.gamepadMap` exist for tests and exotic pads), `bootFocus: false` to keep the
canvas from taking DOM focus at boot (default true — keyboard routing is
scoped to the canvas, so without boot focus every hotkey is deaf until the first click;
a page embedded in someone else's document passes false and lets the host decide), and
`contextMenu: false` to suppress the native browser context menu on the
ENGINE CANVAS wholesale — the option for pages that wire right-click surfaces (the
radial ground wheel); it is canvas-scoped, so a host document around an embedded stage
keeps its own menu outside the canvas, and the one-shot suppression from
`preventDefault()` on a `rightclick` event keeps working regardless.

---

## JavaScript API

| System | Use |
|--------|-----|
| `Eldritch.init(options)` | Boot everything. Returns the namespace; `Eldritch.engine` is the running engine. Calling it while running destroys the previous instance first. |
| `Eldritch.destroy()` | Full teardown: every timer, listener, node, and GPU resource, plus the canvas. `init()` boots cleanly afterwards (SPA remounts, hot reload). |
| `Eldritch.version` | Current library version string (matches the `VERSION` file). |
| `Eldritch.config({...})` | Chainable pre-init configuration (accepts and ignores `assetBase` for source-API compatibility). |
| `Eldritch.registerIcon(name, painter)` | Register a custom ability-icon painter (`painter(ctx, w, h)` draws the full 64px icon; `iconBase`/`glow`/`noGlow` helpers are exported). Persists across destroy/init; register before constructing users of it. |
| `Eldritch.registerAbility(id, {name, desc, stats, flavor, painter})` | Tooltip lore plus (optionally) the icon painter in one call; the id joins `ABILITY_ICON_IDS`. |
| `Eldritch.registerItem(id, {name, desc, icon, rarity, stackMax, data})` | Item metadata for the inventory suite: `icon` is any registered icon id, `rarity` is `common\|rare\|epic\|legendary` (the `COLORS.rarity*` tokens), `stackMax` caps merges. Persists across destroy/init; register before placing the item in a grid. `itemData(id)` reads it back with graceful fallbacks; `rarityColor(rarity)` maps to the token; `ITEM_DATA` is the raw table — **raw writes to it (and `ABILITY_DATA`) are UNSUPPORTED** (they bypass validation; a NaN `stackMax` written raw reaches live inventory and breaks every merge/split). Mutate through `registerItem` or the bare export `registerItemData` (both clamp and default). |
| `Eldritch.strings` | The LIVE library-authored string table — every user-facing string the library draws or logs lives here (dialog chrome, widget defaults, every event-log line, tooltip lore chrome, the split/discard flows; the full key catalog is `STRING_DEFAULTS` in `src/strings.js`). Templates carry `{0}`/`{1}` slots. Override any subset via `init({strings})` — unknown keys warn and are skipped; `destroy()` restores the defaults. Widgets read the table at dispatch time, so
| `engine.focus` | Keyboard/gamepad focus manager: `set(node, source)`, `next()/prev()` (paint order), `move(dx, dy)` (spatial), `activate()`, `cancel()`, `pushEscape(fn) -> off()`, `interceptTab(fn) -> off()` (an open surface consumes the next Tab — a context menu dismisses instead of letting focus walk behind it). Tab/Shift+Tab traverse; Enter/Space activate (widgets may define `onActivate`); Escape pops open surfaces then blurs; a verdigris ring marks key/gamepad focus. Focus never reaches what a pointer could not hit. |
| `engine.gamepad` | The gamepad adapter (`GamepadNav`): d-pad/left stick route through the focused widget first as arrow keys (keyboard parity), then move focus spatially (350ms/120ms repeat); A activates, B cancels, bumpers cycle, right stick scrolls the focused-or-hovered scroll area on both axes (stick Y scrolls, stick X pans horizontal lanes like the overflowed taskbar). |
| `Eldritch.reducedMotion` | The reduced-motion gate: while `true`, the `animateIn/Out/stagger` presets — and everything opted into them (window/menu transitions) — collapse to their instant end states. it means NO MOTION: the direct scale/position tweens too (button/plate press pops, drag-icon scales, minimap marker pops, floating combat numbers) go instant; opacity fades and display-value eases (vestibular-safe) deliberately stay, and a tween already in flight when the flag flips completes (only new motion collapses). A player/OS preference, so it deliberately survives `destroy()`. |
| `engine.requestRender()` / `engine.alwaysRender` | The renderer skips idle frames (nothing tweening/animated/dirty). `requestRender()` wakes one frame for exotic direct mutations; `alwaysRender = true` reverts to constant presentation. |
| `EldWindow.create(opts)` | Draggable/resizable window. an OMITTED width/height MEASURES the content (`autoSize: false` restores the legacy fixed default; a given size stays law), `header: false` makes a first-class chrome-less panel window, and the reserved 14px scrollbar lane is retired — rails are true overlays that appear only while an axis overflows. opts: `title, id, width, height, x=50, y=50, resizable=true, minWidth, minHeight, content, onClose, transitions, header, autoSize` (`transitions: true` opts the window into: fadeScale on open/close — close defers its teardown until the preset lands — and a quick fall on minimize/restore; `Eldritch.reducedMotion` collapses them) (`minWidth`/`minHeight` raise the resize floor above the library minimum — content with hard minimums can never be shrunk into doubled scrollbars). Returns instance with `minimize/restore/toggleMaximize/close/bringToFront/setTitle/setContent`, a `content` getter, and `userPlaced` (claim tightened — true once a REAL pointer CHANGED the box: a header drag that moved it or a resize that resized it; a press alone raises and claims nothing; programmatic placement never sets it; page layout that repositions windows should skip a claimed one; a grip's first real resize sets the same flag on any `makeResizable` host). `close()` dispatches a PREVENTABLE `close` event (`preventDefault()` keeps the window alive) and calls `onClose` only when the close proceeds; `minimize/restore/maximize/unmaximize` events fire from their transitions. The static `Window`'s close sigil emits `close`. |
| `EldWindow.setContainer(node)` | Bound windows to a UINode region (the `#windowContainer` equivalent). |
| `EldWindow.serializeLayout()` / `.restoreLayout(jsonOrArray)` | Layout persistence. Serialize returns one JSON-friendly entry per open window — its stable `id` (the `create({id})` option; the random fallback is session-only), its NORMAL rect (a maximized window records what it will unmaximize to), the minimized/maximized flags, and `userPlaced`. Restore matches by id (unknown ids are skipped — build windows first, then restore), clamps rects to the container like a drag would, runs the normal loud minimize/maximize paths, and CLAIMS the restored windows (a persisted layout is the user's placement, so page auto-layout skips them; entries saved before restore claimed; clear the flag to re-lane). |
| `new ModalWindow(opts)` | The draggable/resizable window class `EldWindow.create` instantiates — constructible directly with the same opts bag and instance surface (see the `EldWindow.create` row). Note `create()` ADDITIONALLY registers the window with the manager (taskbar minimize items, `serializeLayout`, the open/close sound); a raw construction gets none of that — prefer `create()` unless you are building your own manager. |
| `Eldritch.taskbar` (`Taskbar`) | The minimized-window bar `EldWindow` boots along the container bottom; minimize/restore/close manage its items (`addItem(title, windowId, onClick)` / `removeItem(windowId)` exist for direct composition). The item lane rides a horizontal ScrollArea once items overflow: plain wheel maps deltaY → X, and touch drags / middle-button pan / gamepad right-stick X pan it. |
| `EldPopup.show({title,message,onOkay,onCancel,buttons,prompt})` / `.hide()` | Modal dialog. `show()` returns a Promise resolving `{action, value}` (`action` = `ok`/`cancel` or the clicked custom button's label; `value` = the prompt text, else null). `buttons: [{label, onClick, variant}]` replaces the OK/Cancel pair (`variant: 'accent'` tints the label); `prompt: {placeholder, value}` adds a text field (focused editing-ready; Enter commits via ok). Escape cancels in ONE press, prompt or not, the prompt's current text riding `value` (it used to take two with a prompt); no backdrop dismiss. Calling `show()` while one is open queues it (FIFO); `EldPopup.isOpen` reports state; a direct `hide()` resolves as cancel without firing `onCancel`. |
| `EldToast.show({title, message, variant, icon, duration, markup})` | Queued corner notifications (top-right stack, max 4 visible, overflow queues FIFO). `variant: 'info'\|'loot'\|'achievement'` colors the title; `icon` is any ability icon id; `duration` seconds (default 4); `markup: true` parses the BODY for `{color}`/`{icon}`/`{b}`/`{i}` runs (the title stays single-run). Hovering a toast pauses its clock; clicking dismisses it. |
| `EldContextMenu.show(entries, x, y)` / `.close()` | The right-click menu (one at a time, on the dropdown layer — except above a LIVE modal popup, where it rises onto the overlay layer over the scrim so it stays visible and usable; Escape still pops menu-then-popup, one surface per press). `entries: [{label, onClick, disabled}]` or `{separator: true}`; 26px stone rows with hover wash; flips at viewport edges (10px margin); closes on entry click, Escape/gamepad-B, or any press outside; `isOpen`/`node` report state. Wire from the `rightclick` event: `node.on('rightclick', (e) => { e.preventDefault(); EldContextMenu.show([...], e.x, e.y); })`. While open, ArrowUp/Down walk the enabled rows and Enter activates the highlighted one. `EldContextMenu.transitions = true` (opt-in) fades the menu out through the presets on close. |
| `EldNotify.send({channel, title, message, icon, variant, duration, priority, key, data})` | Notification ROUTING over the existing rails. `channel: 'toast'` rides the corner stack, `'banner'` a one-at-a-time center-top stone banner, `'log'` writes only the `EldEvents` trail. Higher `priority` presents first from the pending queue (FIFO within a tier; EldNotify feeds only FREE toast slots — direct `EldToast.show` users keep their own queue). A `key` dedupes: repeats while that notification is live collapse into a live "×n" title counter and reset its clock. `EldNotify.doNotDisturb = true` routes every popup channel to the log — nothing is lost, only quieted. |
| `EldTooltip.show(spec,x,y)` / `.updatePosition(x,y)` / `.hide()` / `.hideNow()` | Cursor-following tooltip. spec: `{title, titleColor, lines:[{text,color}], desc, stats[], flavor, markup}` — `markup: true` parses the body text (lines/desc/stats/flavor) for styled runs and inline icons; the title stays single-run. `.attach(node, specOrFn)` wires hover and returns a detach function; `.detach(node)` unwires; disposing an attached node detaches and hides automatically. |
| `EldDragDrop` | Slots + palette drag-drop. `.on('slotchange'\|'action-triggered'\|'dragstart'\|'dragend', fn)`, `.toggleLock()` / `.setLocked(v)` (silent), `.registerLock(lockNode)`, `.createIconInSlot(slot, name)`, `.clearSlot(slot)` (dispatches `slotchange`), `.getSlotIcon(slot)`, `.triggerAction(slot)` (fires a filled slot's rite exactly like a click — cooldown included; empty slots no-op; game-hud wires digit keys through it), `.cancelDrag()` (cancels any in-flight drag; the icon stays home), `.serialize()` / `.restore(state)` (action-slot snapshot by slot id). `.canAccept(targetSlot, {itemId, count, sourceSlot})` — the validity oracle; on drag start every accepting target glows a steady accent film and the hovered slot's dragover art rides on top (the design requirement). |
| `EldEvents.log(message, type)` | Timestamped line into the registered `EventLog` (no-op without one). Sinks STACK: the newest registered log receives the lines, and disposing or unregistering it hands the sink back to the previously registered one — a temporary log no longer orphans the log beneath. `EldEvents.register(log)` / `.unregister(log)` manage it; an `EventLog` registers itself unless constructed with `register: false` and unregisters when disposed. |

`content` for windows: a builder function `(contentNode, win) => {}`, a UINode, an array of
UINodes, or a plain string (wrapped text). `footer` (window
furniture): the same shapes, laid into an HBox lane pinned inside the frame's bottom
inset — right-justified by default (`footerJustify` overrides), the content box shrinks
above it, and auto-sized windows grow to include it. settings.html's Apply/Revert ride
it; `win.footerBar` exposes the lane. Titles ellipsize honestly against the control
strip and re-derive their clearance on every resize; resizable windows wear the drawn
corner grip by default.

### Widgets (constructors)

Every form widget speaks the uniform contract — `.value`/`.checked` read fields,
`setValue/setChecked(v, {silent})`, `setDisabled(v)`, `input`/`change` events —
documented in **docs/API.md**.

`Button(text, {onClick, disabled, minWidth})` with `setText(t)` (re-sizes to fit, never smaller
than `minWidth`) and `setDisabled(v)` · `IconButton(kind, {onClick, disabled})` — `kind` is any
generated icon id: chrome icons `cogwheel|puzzle|rows|save|tune` resolve first (`ui.*`), then
ability icons (`icon.*`, ids in the `ABILITY_ICON_IDS` export; no active variant, so hover uses
the base art + scale) — with `setIcon(kind)` and `setDisabled(v)` ·
`TextField({placeholder, value, width, maxLength, onSubmit})` — `maxLength` caps native typing
at the source; Enter fires `submit {value}` without blurring ·
`Toggle({checked, onChange})` / `ToggleLabel(text, opts)` with `setChecked(v, {silent})` ·
`Radio(group, {checked, value, onChange})` / `RadioLabel(group, text, opts)` — deselect emits
`change {checked:false}` on the losing radio; statics `Radio.groupValue(group)` and
`Radio.selectValue(group, value, {silent})` ·
`Slider({min,max,step,value,width,labels,onInput,onChange})` ·
`Select({options, value, width, onChange})` with `setValue(value, {silent}) -> boolean`,
`setOptions(options, {value, silent})`, `getOptions()`, and `open`/`close` events (a
dropdown opened above a LIVE modal rises over the scrim, the context-menu rule) ·
`ProgressBar({value,width})` with `setValue(pct, {animate, silent})` ·
`NumberField({value, min, max, step, width, onChange})` — a stepped numeric field with
carved −/+ steppers; `setValue(v, {silent})` snaps and clamps; arrows step, Home/End
jump to the bounds ·
`KeybindField({value, width, onChange, checkConflict, onConflict})` — click or
Enter/Space arms it; the next key combo (`Ctrl+Shift+K`) or mouse button binds —
left `Mouse1` or right `Mouse3`, modifiers included (the middle button is pan-reserved
and back/forward stay with the browser); Escape cancels the capture (consumed);
`checkConflict(combo)` returning a label rejects the combo and fires
`conflict {combo, with}`; `setValue(v, {silent})`, `change {value}` ·
`Window({title,width,height,content,onClose})` (static panel) ·
`EventLog({width, height, maxEntries, register, markup, virtual})` with `log(msg, type)`
and `clear()` — `markup: true` parses logged MESSAGES for styled runs and inline icons
(the timestamp/type prefix stays library-styled); `virtual: true` windows
the scrollback over pooled rows: entries become data records, GPU cost stays one
screenful, and the history is UNBOUNDED by default (`maxEntries` still trims when set);
 the scrollback PINS honestly — append follows the tail only when the
reader is already there (a scrolled-up position is never yanked; `atBottom` reads the
predicate, `scrollToBottom()` re-pins), and lines whose messages carry `{link:}` runs
auto-wire so their `linkclick`/`linkhover` bubble to the log; long
messages WRAP at the log's lane instead of ellipsizing (both modes — the windowed
scrollback flattens an entry to pooled visual lines; a resize rewraps the whole
history; trims and the pin compensate by real wrapped extents) ·
`Table({columns, rows, sort})` — `sort: {column, ascending}` boots the model
ordered SILENTLY (no `sort` event, no ledger line; header clicks toggle from it) —
with `getRows/setRows/addRow/removeRow/updateCell` (the active sort
re-applies after every change) and `rowclick {row, index}` / `sort {column, ascending}` events;
the order arrow is a 15px OVERLAY right-anchored in the header cell — never a flow
item, so labels and column widths hold their measurements whether it shows or not ·
`UnitFrame({name,portrait,level,health,mana})` with `setHealth/setMana/setName/setLevel/
setPortrait/addEffect/removeEffect/clearEffects` and an `effectclick {name}` event — its buff
strip is an `EffectBar` (public: `addEffect(spec)/removeEffect(fx)/clearEffects()`, a
self-sizing row — place one anywhere) ·
`Minimap({zone,zoneLevel})` with `addMarker/removeMarker/clearMarkers/moveMarker/setZone/
setHeading/zoomBy/setZoom` and `markerclick {kind, xPct, yPct}` / `zoomchange {zoom}` events —
`setZoom(z, {silent})`/`zoomBy(dir, {silent})` stay LOUD by default (the 1.0 contract routes
the +/- buttons through them); pass `{silent: true}` when restoring saved state ·
`QuestTracker({header, quests, markup})` — `markup: true` parses objective TEXT for
styled runs and inline icons (the progress counter stays library-styled);
`addQuest` returns an id handle for
`updateObjective(id, index, patch)/completeQuest(id)/removeQuest(id)/getQuest(id)` +
`questchange {id, action}` events ·
`CharacterPanel({categories,currency})` with `equip/unequip/getEquipped/getInventory/
setCurrency/setStats/cycleStats` ·
`SettingsPanel({tabs, width, height, onChange})` — the sidebar settings component; since
its selection speaks the Tabs contract verbatim: `selectTab(id, {silent}) -> boolean`
(same-id no-op; the old positional-boolean form works behind a deprecation warning),
`change {value, id}` events (`value` mirrors `id`), Up/Down walk the sidebar from the
focused panel — arrows originating from a focused control inside the pane stay the
control's — a `content` getter, `setDisabled(v)` ·
`Tabs({tabs: [{id, label, icon, build(contentNode)}], width, height, onChange})` — a
horizontal tab strip over one scrolling pane; `selectTab(id, {silent})`, a `content`
getter, `change {value, id}` events (`value` mirrors `id`), Left/Right arrows walk the
strip from the focused container (a focused pane child keeps its own arrows) ·
`ActionSlot(id)` — with `setKeybind('3')` hotkey corner labels — / `CpSlot(id)` /
`IconPalette(iconIds)` / `ActionbarLock()` ·
`FloatText({pool})` — pooled combat floaters: `spawn(text, x, y, {crit, color})` rises
and fades on the house tween; exhaustion steals the oldest (combat never allocates) ·
`ChatBox({width, height, placeholder, maxEntries, register, markup, virtual, maxHistory, onSubmit})` — the chat
composite as one node: an `EventLog` scrollback over a `TextField` whose Enter submits
WITHOUT blurring, with ArrowUp/Down history recall (the recall buffer caps at
`maxHistory`, default 200, dropping the oldest); `log(msg, type)`/`clear()` pass
through to the scrollback, `submit {value}` fires on real submissions (empty lines are
swallowed), `.field`/`.scrollback` expose the parts, `atBottom`/`scrollToBottom()`
mirror the scrollback's pin surface, and `register: false` keeps the
scrollback off the `EldEvents` sink ·
`LoadingVeil({title, flavor, value})` — the loading splash: a full-screen abyss scrim
glued to the engine size (it swallows presses AND the wheel), a void-purple liquid orb
whose fill level rides the progress (its surface animates), a stone progress bar, and a
flavor line; `setValue(pct, {animate, silent})`, `setFlavor(text)`, `fadeOut()` returns
a Promise and disposes when the fade lands — repeat calls return the same promise, and
disposal by any route (including `Eldritch.destroy()`) settles it; add it to
`engine.layers.overlay` (toasts and tooltips ride on higher layers by design, and a
modal popup presents above the veil) ·
`DialogPanel({width, minHeight, portrait, speaker, text, onAdvance})` — the conversation
panel: portrait + speaker + wrapped markup-capable body on one stone frame; a click or
Enter/Space/gamepad-A dispatches `advance {}` — the page owns the script and swaps
entries with `setEntry({portrait, speaker, text})`, which resizes to fit the wrapped
body at mutation time; `setDisabled(v)`; see `examples/narrative.html` ·
`ActionBar({rows, cols, lock, gap})` — the slot-grid composite (globally unique slot ids,
optional bar lock registered for you); `.slots` is the flat slot array · `Globe({kind:'health'|'sanity', label, value, max, radius})` ·
`CastBar({width})` with `startCast(name, icon, seconds)`, `stopCast()` (quiet), `interrupt()`
and `caststart/castcomplete/castinterrupt` events — a `startCast` while one is in flight
resolves the old cast as `castinterrupt` first (every cast gets exactly one resolution) ·
`VirtualList({rowH, renderRow(node, item, index), overscan, rowFocus})` with
`setItems(items)` / `refresh()` / `itemAt(node)` / `scrollToIndex(i)` — pooled
fixed-height rows over a ScrollArea; ten thousand rows cost one screenful (renderRow
fills imperatively and must reuse the row's child nodes). `rowFocus: true` is the row-focus contract: the LIST is one Tab stop; ArrowUp/Down (and
Home/End) walk ITEM indices across the window boundary, auto-scrolling as they go; a
selection wash rides the focused row, every move dispatches `rowfocus {index, item}`,
and Enter dispatches `rowactivate {index, item}`. `Table` accepts `virtual: heightPx`
(or `true` for the 300px default) to pool its rows the same way while the full model
keeps sorting. ·
`PanZoomSurface({planeW, planeH, zoom, minZoom, maxZoom, zoomStep, wheelZoom, inertia})` —
a pannable/zoomable plane: add plane-coordinate content via `surface.add(...)` (lands on
`.content`); drag (mouse or touch, from anywhere — under-threshold clicks still reach
children), wheel zooms at the cursor, two-finger pinch, release coasts with inertia,
right-stick/middle-button pan via the scroll duck-type; `screenToPlane(x, y)` /
`planeToScreen(x, y)`, `setZoom(z, {silent, anchor})`, `zoomBy(f, opts)`,
`panTo(x, y, {silent})`, `centerOn(x, y, {silent})`, `setPlaneSize(w, h)`, `setDisabled(v)`, `panX`/`panY`/
`zoom` read fields; events `zoomchange {zoom, x, y}` and `panchange {x, y, zoom}` on
non-silent commits. Layout, hit testing, clipping, and text rendering are zoom-aware for
plane content; widgets whose gestures interpret raw screen deltas or that position detached
surfaces (Slider, TextField, Select dropdowns, scrollbar thumbs, window chrome) are not —
keep form controls in unzoomed chrome; plane content is for click/hover/tooltip/focus
targets. ·
`ItemGrid({cols, rows, locked, spacing})` — the inventory lattice of `ItemSlot`s (registered
via `Eldritch.registerItem`): each filled slot shows the item icon, a rarity-tinted ring,
and a count badge; `setItem(index, itemId, count, {silent})` / `getItem(index)` /
`clearSlot(index, {silent})` / `setLocked(v)` / `firstEmpty()`; slots dispatch
`itemchange {slot, item, count, action}` (`set|clear|move|swap|merge|split|sort`; count is the
slot's value AFTER the change). Dragging rides `EldDragDrop`: drop on the same item merges
up to `stackMax` (the remainder stays in the source slot), a different item swaps, an empty
item slot moves, a release anywhere that is not a drop target asks to discard the stack
(confirmation popup — OK clears the slot with `action:'clear'`, cancel keeps it; transient
chrome that appeared mid-drag cancels back without asking), and
rites and items never mix (cross-family drops reject politely). Right-click on a stack
opens the context menu; "Split Stack…" prompts for a count and fills the first empty slot.
A locked grid is sealed both ways (no drag-out, no drop-in, no split) while tooltips keep
working. `accepts: (itemId, count) => boolean` types the grid's doorway —
see the speaking-stones block below. ·
the free-graph core and its skins died with the talent rebuild — see the
talent grid below (`TalentTree`/`TalentPanes`; `examples/trees.html`).

The long winter (`examples/survival-hud.html` is the camp):
`RecipeBrowser({recipes, have, onCraft})` — a category strip over an
availability-tinted recipe list and a detail pane (output preview, have/need rows
that go negative-red when short, craft ×N via NumberField); `craft {id, count,
out, needs}` dispatches LOUD with everything ×N-scaled and THE GAME decrements its
inventory, then `refresh()` re-reads the `have(id)` truth (the data-driven
protocol) · `ProcessPanel` — the campfire/forge: input/fuel/output are three 1×1
ItemGrids, so the drag protocol (stacking, splitting, tooltips, the lock
seal) interops whole; a progress arrow fills via `setProgress` (the game clocks
the burn) and `itemchange` bubbles through the panel · `CompassStrip({width,
heading, markers})` — a 360° heading tape baked ONCE and panned by texture
offset, so `setHeading`'s 359→0 wrap is a modulo, not a re-raster; cardinal
letters localize through `compassCardinals`; bearing markers ride relative
bearing (non-finite bearings are dropped with a warn, — they used to
vanish silently; the shooter kit reuses this whole) · `DayDial({size, time})` — the
procedural sun/moon day-clock ring (graduated off 's cut line):
`setTime(t, {silent})` takes a 0..1 day fraction (0 = midnight, 0.5 = noon) and
WRAPS, repainting the own-raster face (a rayed sun through the day span, a
crescent moon through the night); loud calls commit `change {value}`; own-raster
like ArcGauge, so it adds nothing to the atlas · ItemGrid EXTENSIONS: `setItem`
gains `{durability: 0..1}` (it rides the ICON through drags and paints a static
tier-tinted underbar — accent > quest > negative, §9 tiers) + `setDurability`;
`linkTransfer(other)` arms shift-click quick-move (merge same-id first with
stackMax honored, then first empty, no room refuses loudly; `transfer {index, id,
count, to}` on success); `transferAll(other)` is take-all AND deposit-all — the
same sweep pointed both ways; `sort({comparator, silent})` (graduated)
consolidates same-id stacks (stackMax honored; durability stacks never merge)
then packs from slot 0 by the comparator (default rarity → id → count desc), a
locked grid refusing loudly and a loud call dispatching one `itemchange
{action:'sort'}` summary.

The whispering stage (`examples/narrative.html` is the scene):
`LetterboxBars({coverage, dur, dnd})` — cinematic bars on the dedicated cinematic
layer (above tooltips, below the vignette; photo mode spares both); they mount
themselves, `show()` engages `EldNotify.doNotDisturb`, and `hide()` restores the
PRIOR flag only when the bars have fully left (an interrupted hide keeps the
scene quiet; dispose and destroy both release the mute) · `TypewriterText` + the
TextNode reveal seam — `reveal(cps)` pre-renders the full text once (the
grow-only backing lands final, the box never breathes) then re-rasters a growing
prefix, narrating `uisound 'type'` per batch; `skip()` lands everything, and the
promise resolves on completion, skip, supersession, or dispose;
`DialogPanel({typewriter: cps})` adopts it — the first advance press lands the
text, the second advances (reducedMotion makes every reveal instant; 0 stays the
pre- instant default) · `ChoiceList({choices, timer, onChoice})` — a
MenuList that COMMITS: hidden choices never build rows, disabled rows are
skipped by the walk, picks commit `choice {index, id, choice, timeout:false}`,
and the optional countdown (an ArcGauge `timerRing`, created unmounted — place
it beside the list) expires into `{index:-1, timeout:true}`; a sealed list holds
its clock · `Journal({entries, title})` / `DocumentViewer({title, text})` — the
parchment family, own-raster like ArcGauge/DayDial (zero atlas cost;
deterministic seeded grain keeps frozen snapshots bit-stable): one entry per
page with rich-text bodies, `addEntry` opens unread (`change {action:'add'}`),
`markRead` clears the chip, `setPage` walks the pages; the viewer swaps
wholesale via `setDocument` · `SubtitleBar({width, safeBottom})` — one
speaker-colored line near the bottom safe area; `say({speaker, text, color,
duration})` returns a promise that settles when the line clears (timeout,
supersession, `clear()`, or dispose); the queue fell per the cut line ·
`SanityFX({targets, maxOffset})` — the "UI itself goes mad" controller:
`set(level 0..1)` drives the engine vignette's breathing and a render-only
tremor through the `fxOffsetX/Y` node seam (layout worlds and hit rects never
move); level 0 restores every offset and the vignette EXACTLY; reducedMotion
zeroes the tremor and holds a static depth; glyph corruption fell per the cut
line.

The lantern bearer (`examples/action-hud.html` is the scene):
`RadialMenu({items, rOut, rIn, onSelect, getGamepads})` — the summoning circle: an
own-raster annular wheel whose HIT AREA IS THE RING — a `containsPoint`
override (the Spotlight precedent), so bounding-box corners and the center hole
fall through to the scene below, and because the focus fence reuses the same
predicate, gamepad-A can only ever land on real sectors; it mounts itself hidden
on the overlay, `open(x, y)` clamps NaN/offscreen centers to reachable ones,
click-toggle is the protocol (hold-open fell per the cut line). NESTED RINGS
 (the graduation): an item with `children: [...]` is a
PARENT — activating it swaps the SAME ring in place for the child items plus
one Back sector (`strings.radialBack`; a parent sector wears an outward
chevron, Back an inward one), `select` fires on LEAVES only with the breadcrumb
`path` (`select {index, id, item, path}` — e.g. `['kit','oil']`), `descend
{id, item, path}` / `ascend {path, depth}` narrate ring swaps, `depth` reads
how deep the wheel stands, Escape/gamepad-B pops ONE level per press (the child
ring is the top surface), outside-press and Tab close the whole wheel, a
closed wheel always rests on its ROOT ring (`items` stays the root array
forever), and `setItemEnabled(id, v)` reaches nested leaves by id (a hidden
branch's flip renders on the next descend; disabling a parent seals its
subtree). Mouse hover / arrow-walk (disabled sectors skipped) / the
self-polled left stick (inject `getGamepads` for deterministic tests; the
GamepadNav dead zone holds) all pick sectors, Enter/gamepad-A activates, and
dismissal rides the Escape-stack tokens with the C1 focus restore. the
wheel mounts on its OWN `radial` layer band — above every page surface and
overlay mount, below tooltips/toasts; a PRESENTING modal popup makes an open
wheel CLOSE (the yield law) — and narrates loud `open {x, y}` (the clamped
center) / `close {}`; items may carry a per-leaf `onSelect(payload)`.
`{ ground: true }` registers the wheel as the RADIAL CHAIN's terminus
(`RadialMenu.setGround(menuOrFn)` is the per-gesture form — a fn may return
null to keep a gesture silent). THE NO-RADIAL RULING: a demo whose
right button carries a REAL gameplay verb ships NO ground radial at all —
strategy-hud's right-click IS the order, so it registers nothing (two
meanings on one button confuse the verb; a wheel's errands there were only
duplicates of controls the page owns). Pages whose right button means
nothing keep their wheels. ANY node may
offer `radialItems` (an item array, or a fn returning items / null-to-decline /
`false`-to-seal): an UNCONSUMED right-click (nothing called `preventDefault`)
walks providers from the hit up the parent chain and lands on the ground
wheel; a right-click on a DISABLED widget falls back from its first enabled
ancestor (the widget itself stays deaf). Widgets that keep their own menus
simply consume — the ItemSlot dropdown does ·
`BossBar({name, phases, width})` — a name plate over SegmentedBar phases with an
enrage BigTimer slot: `setPhase(p, {silent})` fills p segments and commits
`change {value, action:'phase'}` (same-phase sets stay silent; out-of-range
clamps), `enrage(seconds)` raises the clock and its timeout re-dispatches as
`enrage`, `clearEnrage()` stands it down; damage-flash fell per the cut line ·
the stamina-ring recipe — an `ArcGauge` with low-red thresholds
(`{pct:0,negative} / {pct:0.3,quest} / {pct:0.6,accent}`), drained with
`setValue(v, {animate:false})` per tick and regenerated smoothly; the wheel page
wires the `WorldAnchorLayer`/`OffscreenIndicator`/`InteractPrompt`, the
`TitleCard`, and the `CompassStrip` whole.

The drawn hand (`examples/deckbuilder.html` is the table):
`Card({id, name, cost, type, body, art, rarity, size})` — a procedural own-raster
card frame (the instance owns its canvas, the TextNode model, so cards cost ZERO
atlas textures): rarity trim via the `COLORS.rarity*` tokens, a painted cost gem
under a live cost number, an art well fed by the icon registry (`icon.<art>`), a
small-caps name in the rarity color, a type line, and a `compileMarkup` rich-text
body; `hand` (126×176) and `full` (180×252) variants ride `CARD_SIZES`, and
`setPlayable(v)` lights the affordance film (hover-inspect zoom fell per the cut
line) · `HandFan({cards, maxWidth, lift, arc, onPlay})` — the arc that holds
them: overlap-resolving layout at 1..12 cards (spacing compresses into the width
budget), hover-lift with parting neighbors, and drag-to-play under the drag laws
— one gesture one pointer at the entry (C3), Escape cancels a live drag (B7), a
card disposed mid-flight cancels (B4), and the flying card IS the ghost (the
target arrow fell per the cut line; a straight flight ships). A release over a
`setTargets(nodes)` member or above the fan line commits loud `play {card,
onto}` — `onto` is the landing node or null, because the event plane owns
`target` — and an unclaimed play (the handler left the card in the fan) flies
home; `removeCard(card, {to, dispose})` flings a claimed card to its mound ·
`Pile({kind, label, cards, browse, onChange})` — draw/discard mounds over card
DEFS (plain objects, never nodes) with a painted count chip; click/Enter opens a
browse `Window` of inert Cards (Escape, the header X, or a second activation
closes it), and `push/pop/setCards` speak `pilechange {count, action}` (the
exhaust pile fell per the cut line) · `RunMap({data, position, floorLabels,
onAdvance})` — the roguelike floor map, cut in the talent language (the
traveled path wears the gilt, a ring marks where you stand, arrows carry heads;
`getState(id)` reads owned|available|locked): floors climb
bottom-up from `{id, icon, floor, requires}` nodes, reachability derives from
the CURRENT position (its forward-connected doors are `available`, the traveled
set is `owned`, the path stays lit), clicking an open door commits loud `advance
{id, floor}`, and `setPosition` is the silent load/restore path — the run MODEL
(fights, shops, rewards) belongs to the game · the reward-pick and
energy-counter recipes live on the page (three staggered `full` Cards, one
claim; a `ResourceChip` gating plays by cost).

The iron sights (`examples/shooter-hud.html` is the firefight):
`Reticle({style, size, spread, armLength, color})` — composable center styles
(`dot | cross | circle | chevron`) over four spread arms whose offset IS the
bloom: `setSpread(px)` moves bare quads so the hot path never repaints (NaN
keeps the last spread, negatives clamp), `setStyle` re-inks the center plate
(the chevron drops its vertical arms), and `flash('hit'|'kill')` tints the whole
sight briefly on a ticker hold that deliberately survives reducedMotion ·
`HitMarker({pool, size})` — pooled X flashes on the FloatText protocol verbatim
(one shared raster tinted per spawn, steal-the-oldest on exhaustion, tween
lifetime back to the pool; kill markers read blood and linger) ·
`AmmoCounter({mag, magSize, reserve, warnAt, onChange})` — mag/reserve numerals
over a reload sweep rail: `fire()` walks the mag down (`ammochange` narrates
without a click voice; a dry trigger voices an error and fires nothing),
`lowammo` commits ONCE per threshold crossing (ceil of `warnAt` × magSize, the
numeral turns blood), and `reload(dur)` fills the rail then seats the mag from
the reserve (`reloaded` carries `action: 'reload'`; reducedMotion lands it instantly) ·
`DamageIndicator({radius, thickness, dur})` — a directional arc on an
own-raster ring: `hit(bearing)` lights a 70° wedge at that bearing (0 = ahead =
top, 180 = behind = bottom, clockwise; wraps and NaN land on the rose) and
fades it; ONE active arc — stacking fell per the cut line ·
`Killfeed({maxRows, ttl, width, rowHeight})` — pooled rich-text rows, newest on
top: `push({killer, weapon, victim, self})` renders `killer {icon:weapon}
victim`, holds the row for its TTL, fades it back to the pool, evicts the
oldest past max-N, and self rows wear the accent film · the armor/ward bars and
capture-point meter ship as `SegmentedBar` recipes on the page, with the
`CompassStrip` reused whole (objective markers included).

The guildhall (`examples/social-hud.html` is the hall — the
gathering kit it replaces was DESTROYED whole: PartyFrame,
Scoreboard, NameplateManager, and NetMeter no longer exist):
`PartyPanel({members, gap, onTarget})` — party UNIT frames: each member row
wraps a REAL `UnitFrame` (portrait, level, tweened health/mana rails, the
buff strip) and the panel owns the group chrome — the leader crown (exactly
one), role glyphs (tank | healer | damage; instance-raster chips with
tooltips), Dead across an emptied rail, Offline dimmed and refusing with the
error voice, a selection ring on the committed target, and ready-check chips.
Member DATA is the model (`{id, name, level, role, leader, portrait, hp,
hpMax, mp, mpMax, state}`): `setMembers/setMember/removeMember` are the
model verbs (silent — the data-driven protocol), clicking a living or fallen
row commits loud `target {id, index, member}`, `setTarget(id, {silent})` is
the programmatic form (it refuses offline members), and the ready check is
DISPLAY over game truth — `beginReadyCheck()` pends every reachable member,
`setReady(id, v)` lands each answer as a chip, `clearReadyCheck()` stands
them down, `readyState(id)` reads one, and the GAME clocks the answers.
`addEffect(id, spec)` seats a buff on a member's strip and `effectclick`
bubbles through the panel untouched · guild management and guild chat are
deliberately COMPOSITIONS on the page: the roster is a sortable `Table`
whose right-click menu enforces rank legality (whisper / invite to group /
promote / demote / remove-with-confirm through `EldContextMenu` +
`EldPopup`), the MOTD edits through a prompt, and the chat carries guild /
officer / party voices plus `/w` whispers over `ChatBox` markup with
`echo: false` (the page renders each send in its channel voice, so the
widget's raw SAY echo stays off — the MUD/command form keeps the default).

Coda & coin-op (`examples/arcade.html` is the shrine):
`ScoreTally({lines, rank, width, countDur, onDone})` — the counting-number
rollup every arcade ending deserves: lines reveal in order, each number COUNTS
through its values on the ticker, and the rank stamps last with a pop on an
instance-raster seal; under reducedMotion (or `skip()`) the whole tally LANDS
instantly at its final numbers — the numbers are the contract, the motion is
juice — and `tallydone {total, rank}` commits loud exactly once ·
the rest of the pack is deliberately COMPOSITIONS: the win banner (TitleCard →
tally reveal), the hint economy (`attachBadge` on a Button that runs dry and
seals), the match-board input pattern (two ADJACENT stones swap, distant ones
refuse, a picked stone rises), and the level-flow glue (LevelSelectGrid +
SaveSlotList + StarRating riding the `select` event) — all on the flagship
(SplitTimer and the platformer tab fell per the cut line).

The counting house (`examples/tycoon.html` is the ledger):
`LineChart({series, width, height, title, legend, onSeries})` /
`BarChart({series, labels, …})` — canvas-painted charts (ONE instance-owned
canvas each, the TextNode pattern, re-rendered on `setData`): axes, ~4 ticks,
and gridlines as ink; a scale that survives negatives (zero pulled inside and
drawn stronger when losses share the plot), a single point (a dot on a padded
band), and an empty set (the unit band); multi-series with a clickable legend
(a chip CLICK commits loud `serieschange {name, visible}` with a voice; `setSeriesVisible` is silent by default like every programmatic setter — ruling);
the hover value readout rides `EldTooltip` — the crosshair fell per the cut
line; bars group per index and hang losses below the zero line ·
`TreeTable({columns, rows, width, height, rowH})` — indent + expand/collapse
over a FLATTENED visible list riding `VirtualList` (five thousand rows pool one
screenful); the `expanded` set is keyed by id so it SURVIVES `sort` and
`setRows`; `sort(key, dir)` orders SIBLINGS recursively and stays stable (ties
keep insertion order), header clicks sort loud while `sort(key, dir)` itself is
silent by default (ruling), the sorted column wears a right-anchored arrow
OVERLAY (the label never carries the order, so its measurement never drifts), and
`expandAll/collapseAll/toggle` are the tree verbs · `NotificationCenter({width, maxVisible, maxNotes,
title, onJump})` — the persistent prioritized center (the routing
terminus): `push({id, title, priority, onJump})` orders by priority with
arrival-stable ties and refreshes on a repeated id, unread wears the accent
dot, a click marks read and commits loud `jump {id}`, `markRead/markAllRead/
dismiss` are the ledger verbs (all `{silent = true}`; loud pushes and dismissals
commit `notechange {id, count, unread, action}` and the read verbs commit
`readchange` — restored the dead commit, voiced the rest), and
`maxNotes` bounds it · the date strip +
`SpeedControl` header, treasury `ResourceChip`, and the ward-inspector `Window`
raised by counsel ship as recipes (Sparkline and the heatmap legend joined the
crosshair on the cut line).

The speaking stones (`examples/mud-hud.html` is the MUD in a window):
`BodyDoll({parts, labels, state, width, onPartChange, onPartClick})` — the
thirteen-part humanoid condition figure (head, neck, back, chest, abdomen,
arms/hands/legs/feet per side; `back` reads as the shoulder yoke on the
front-facing figure, and sides are the CHARACTER's — l-* renders viewer-right).
Each part is a focusable region with an auto tooltip; per-part state is
`{damage: 0..3, bleed, missing, scars: 0..3}` — `setPart(id, patch, {silent})`
merge-patches (ranks clamp, non-finite rank fields are ignored, no-op patches
emit nothing) and dispatches `partchange {part, damage, bleed, missing, scars}`
on loud commits; clicks (and Enter/gamepad-A from focus) dispatch `partclick`
with the same payload. Damage tints are STATIC severity tiers (stone → quest
gold → the legendary orange → negative; §9, nothing pulses), missing limbs ghost
to void while staying clickable (a bleeding stump is a real state), scars paint
rank-count stitch marks, and a fresh wound flashes once (finite, event-driven).
`setParts(map)` / `getPart(id)` / `getParts()` / `.parts` ·
`EquipmentRack({zones, gap, locked, onEquipChange})` — worn-equipment
COLLECTIONS by zone (`zones: [{id, label, slots, cols, accepts, items}]`, e.g.
six ring fittings and two amulet fittings): every zone is a REAL `ItemGrid`, so
the whole drag protocol — stacks, splits, tooltips, durability, locks —
interops with zero new code. Zone changes re-dispatch as `equipchange {zone,
index, item, count, action}` (bubbled `itemchange` slot ids are grid-local, so
the zone context is real information; the raw protocol events still bubble).
`getZone(id)` hands back the zone's grid whole; `setItem/getItem/clearSlot(zoneId,
…)` pass through (setItem stays game-authoritative); `linkTransfer(bag)` arms
shift-click quick-UNEQUIP on every zone; `transferAll(bag)` strips to the bag and
returns stacks moved; `setLocked(v)` + `setZoneLocked(zoneId, v)` ride the
existing seal · ItemGrid EXTENSION: `accepts: (itemId, count) => boolean` types a
grid's DOORWAY — consulted once per cross-container entry (drag merge/swap/move
and shift-click quick-moves all ask, including BOTH doorways of a cross-grid
swap); same-grid rearranges and programmatic `setItem` never ask; a refusal is
polite (one `zoneRefused` log line + the error voice, zero mutation, the icon
stays home) and a refusing zone still lights on drag-over — hiding it from
target resolution would route the release to the discard-confirm flow.

The war table (`examples/strategy-hud.html` is the assembled HUD):
`SelectionMarquee({onSelect})` — mount it on `engine.layers.ghost`; a primary press
over EMPTY SPACE (no interactive hit) arms it, crossing the drag threshold makes it
live, and it narrates `marquee {x, y, w, h, phase: 'start'|'drag', shift}` per move
plus `marqueeend {…, shift, canceled}` on release — THE GAME intersects the rect
with its entities (shift rides every payload for add-to-selection); sub-threshold
presses stay clicks · `CommandCard({commands, units, cols, onCommand})` — the
command grid (icon + keycap corner + quest-gold cost + per-command disabled
states) over a display-only unit tray with count badges; plate clicks AND bus
hotkeys (single-atom keyboard binds, matched while nothing holds focus) funnel into
one loud `command {id, cost}`; `setCommands`/`setUnits`/`setCommandDisabled` ·
`BuildQueue({slots, onCancel})` — horizontal production slots: the head wears a
progress underbar (`setProgress(0..1)` — presentation; the game clocks it), any
filled slot cancels on click (`cancel {index, id}` — mutate and `setQueue` back,
the data-driven protocol), repeat entries stack a count badge ·
`TacticalMap({width, height, world, terrain, onMove})` — minimap v2, rectangular:
an optional `terrain(ctx, w, h)` painter over the own-raster recipe, a world-space
`setViewport(rect)` camera footprint, a loud `moveto {x, y}` in world coordinates
on click (drag-to-move fell to the cut line), and finite `ping(x, y, {waypoint})`
pulses (event-driven juice — nothing idles) · the resource row is the
assembly: `ResourceBar` over chips with caps/warn thresholds plus `EldTooltip`
income lore, as the flagship demonstrates.

The graph skins (SkillTree/TechTree) were DESTROYED by
the rule — "the tree logic is totally bugged" — and replaced whole by the
talent grid below.

The talent grid (the WoW-Classic law — `examples/trees.html` is the
screen): `TalentTree({data, points, plateSize, onSpend, onRefund})` — ONE
discipline pane, a fixed grid of tiers by up to four columns over
`{name, talents: [{id, icon, tier, col, maxRank, requires, name, desc, rankDesc}]}`.
Talents hold RANKS (`n/m` badge); LEFT-click learns one rank (one point per rank —
no per-node prices; refusals speak the error voice), RIGHT-click unlearns one
under the legality oracle (`canRefund`: no ranked dependent may lose its maxed
prerequisite, no higher tier may fall below its gate) — Minus or Delete on the
FOCUSED plate unlearns the same way — and the grid CONSUMES its right-clicks
and refund keys so the radial chain and the hotkey bus stay out (RunMap's
unwired plates let both fall through); each tier unlocks at five points
spent per tier above it IN THIS TREE (the left rail states a sealed tier's
price); a prerequisite must be MAXED before its dependent opens, and the golden
arrow on the own-raster underlay turns gilt when it is. States derive — locked
grey, available green, ranked verdigris, maxed gold (`graphnode.maxed`) — and
tooltips carry rank, next-rank text, and red unmet-requirement lines. Loud
`spend`/`refund` `{id, rank, tier, spent, points}`, `reset {refunded, points}`,
silent-default `setPoints`/`setRanks(map)`/`reset()`, reads
`getRank/getRanks/getState/getSpent/canSpend/canRefund`, `setData` rebuilds
wholesale · `TalentPanes({panes: [{id, data}], points, onSpend, onRefund,
onReset})` — N panes sharing ONE unspent pool: the header (unspent + total
spent), the confirm-guarded Reset Talents button (the respec epoch guard —
a queued confirm can never double-refund), pool re-feeds on every child
spend/refund (child events bubble through gaining a `tree` field),
`pane(id)`/`getSpent()`/`serialize()`/`restore({points, ranks})`.

The inspector's lens (`examples/binding.html` arms both over its store):
`DebugConsole({height, hotkey})` — the drop-down dev console on pooled VirtualList
rows: backtick toggles it whenever nothing holds focus, `?console=1` summons one at
boot, ONE Escape dismisses it (the prompt rule); `register(name, fn, help)` adds a
command (`fn(rest, con)`; a returned value prints), built-ins `help`/`clear`/
`stats`/`echo`; Up/Down recall history, Tab completes a unique prefix; every
`EldEvents.log` line echoes through the NON-STEALING `EldEvents.tap(fn)` (the
game's own EventLog keeps the sink) · `DebugInspector` — the node-tree inspector
window (`i` toggles it under `?debug=1`, or construct it directly): a virtualized
live tree of every layer, click-to-select with a cyan bounds highlight, a property
readout (local/world rect, layer, interactive/focusable/disabled, visibility,
paint index, clipping, focus), a Pick mode that selects whatever the next press
hits WITHOUT swallowing it (a read-only observer, the debug-overlay philosophy),
and the leak dashboard — live node/tween/hook/texture counts; numbers that refuse
to fall after a teardown are the dispose report · friendly-errors v2: malformed
markup warns once naming the offending string (unclosed runs, stray `{/}`), a
Store binding loop is detected at 64 unsettled flushes, named, and broken instead
of hanging the tab, and WorldAnchorLayer already throws friendly without a
projection.

The layout engine: `VBox` and `HBox` are structured layout
CONTAINERS — children stack (or row) with `padding` (number or `{t,r,b,l}`), `gap`,
`align: 'start'|'center'|'end'|'stretch'` (stretch sets the child's cross size),
`justify: 'start'|'center'|'end'|'space-between'` (meaningful when the main axis is
externally driven), and per-child flex (`box.flex(child, n)` or `child.layoutFlex = n`
— flex children split the leftover main space). Boxes auto-size from content by
default (`autoWidth`/`autoHeight` off the axis a parent drives, clamped by
`minW/minH/maxW/maxH`); `visible: false` and `fitExclude` children are ignored;
nested boxes settle in a single layout pass. Spacing values come from the
`METRICS.space4/8/12/16` ladder. `GridBox` (fixed columns; cells from
`cellW/cellH` or from content — widest child / per-row tallest; `align` places
within the cell), `Stack` (z-stacked children on 9-way anchors —
`stack.place(child, 'bottom-right', 8)`; label-over-frame and corner badges),
`Spacer(flex)` (the toolbar push: `[title, Spacer(), buttons]`), `Divider`
(themable rule line that stretches under `align: 'stretch'`), and the **`frame:`**
option on every box (`frame: 'panel.dark'`): the box OWNS its stone background —
slice insets add to the padding, so content sits inside the stone natively and the
page auditor's containment rule applies automatically. Hand-rolled `setPos`
arithmetic in new UI is the exception that carries a comment (the STYLE
law; the widget/example migration lands across stages 2–3).

Form rows: `Form` / `FormRow` put the form family on the
layout engine. A `FormRow(label, control, {labelWidth, labelAlign, labelStyle, gap})`
is an HBox of `[fixed-width label lane | control]`, vertically centered; a
`Form({labelWidth: 'auto' | n, rowHeight, ...box options})` is a VBox of rows sharing
ONE label column (`'auto'` resolves to the widest label and re-resolves as rows come
and go) and ONE row-height lane (default 34, the field-class control height; taller
controls still get room). `form.row('Master', new Slider({...}))` builds, adds, and
returns the row (`row.control` holds the widget). settings.html runs all three of its
tabs on Forms — the hand-laid label-column arithmetic it used to demonstrate is gone.

The resize grip: `ResizeGrip` /
`makeResizable(panel, {corner: 'tl'|'tr'|'bl'|'br', minW, minH, maxW, maxH, onResize})`
— a drawn 24px knurled corner wedge with visible hover/press steps, driving
edge-anchored drag-resize with clamps; the host hears a bubbling `resize {w, h}`.
THE FREEDOM LAW: no element budgets a grip — a
drag-resized panel may grow over its neighbors; the one built-in ceiling keeps
the drag grip within the visible screen (floors stay sovereign at the rim).
`ChatBox` and `EventLog` take the same bag via `resizable: true | {…}` (default
corner `'tl'`), re-lay their scrollback and field at every size, and a reader
pinned at the bottom STAYS pinned through the resize (the `atBottom`/
`scrollToBottom` duck-type). ModalWindows now wear drawn grip art on their
south-east corner — the invisible resize zones became discoverable.

The icon pack (optional): `assets/icons` holds 60 atlas sheets
(1024×1024, an 8×8 grid of 128px cells — 3,840 Dark-Fantasy-Horror icons) plus
`manifest.json` (ids, slugs, names, types, categories, tags, cell coords) and the
generated `manifest.mjs` the loader imports (`the icon manifest generator` regenerates it
from the json and `--check` fails when they drift). `await Eldritch.loadIcons({
base, icons: [{ id: 'ico-0001', as: 'my_icon' }] })` bakes a curated set through
`registerIcon` — every `icon.<id>` consumer (slots, palettes, item grids, skill
trees) works unchanged, persistence and density re-bakes are inherited, and a
missing asset degrades to a legible letter-glyph plate, never the magenta
unknown. The sheets ship on opaque black, so the decode **keys black to alpha**
once per sheet and draws the art inside the house plate — a painted icon has the
same carved silhouette as a procedural one, not a black square over it.

**The re-skin idiom is how a page should adopt the pack:** point `as:` at an icon
id the page already uses and the registry re-bakes that one name in place, so
every live quad follows with no page code and the atlas count never moves;
`fallback: 'none'` leaves the procedural art standing when `assets/` is absent.

```js
await Eldritch.loadIcons({ base: 'assets/icons', fallback: 'none', icons: [
  { id: 'ico-0210', as: 'shield' }, // the painted ward replaces the drawn one
]});
```

`await Eldritch.loadIconPack({ base })` is the count-free bulk path (one
pack-owned texture per sheet; per-icon views by offset/repeat, inset half a
source texel against neighbour bleed; `trim(keep)` releases shelves you have
scrolled past, and `Eldritch.destroy()` drains any live pack) —
`examples/icon-browser.html` is the searchable vault over the full set. The
procedural painters remain the default: **pages boot art-complete with the
`assets/` folder deleted**, and `?freeze=1` snapshot boots deliberately run on
the procedural baseline because a screenshot is taken at the load event and
cannot wait for an async decode.

Runtime item/choice unlocks: `MenuList`/`ChoiceList` items take a
`reason` string — a disabled row explains itself on hover via tooltip — and
`setItemEnabled(idOrIndex, v)` / `setChoiceEnabled(id, v)` flip rows live (the
narrative page's "Burn the Ledger" unlocks through the sanity slider this way).
`RadialMenu` sectors and `CommandCard` commands take the same `reason` and
enable verbs. `ScoreTally` is a REAL victory panel: a bordered
window frame, a title lintel, the rank medallion, a Continue button, and
`modal: true` for a full-screen veil that dims and swallows the scene beneath.

The hit probe: `hitTest(engine, x, y, pad?)` is the engine's
reverse-paint-order walk — the same one pointer input rides — returning the
topmost interactive node containing the point (or `null`). Assert suites use it
to prove REAL reachability: a `dispatch('click')` bypasses hit testing entirely
and proves nothing about occlusion, which is exactly how a buried win panel or a
covered button escapes a suite that only dispatches.

The page auditor: `runAudit(engine)` walks the live paint
list and reports layout/readability violations — sibling OVERLAP among solid
elements, CONTAINMENT inside framed panels, text CONTRAST (4.5:1 body, 3:1 at
≥18px/bold; text sealed under a `disabled` subtree is exempt per WCAG 's
inactive-component rule), SCROLLBAR truth (rails only when an axis
really overflows), the
24px interactive HIT floor, and REACH (every visible, drawn
interactive node must answer the real `hitTest` from at least one point of a 5×5
grid over its own box — a control nothing can click is not a control; the
violation records the `blocker` that covered it) — returning
`{violations, counts, allowances, deadAllowances}`. The exported `AUDIT_RULES`
array names the six rules in report order, so a consumer summing counts keys on
it instead of freezing a hand-written list.
`?audit=1` on any page runs it after settle, titles the tab `AUDIT <total>`, and
retains the full report on `window.__audit`; deliberate exceptions (a badge over
its host, the window header on the frame band) are declared per node with
`node.auditAllow('overlap' | …)` — `'reach'` alone resolves UP THE CHAIN, so a
surface declares it once for everything that spawns inside it — and the
declarations themselves are counted and ratcheted. The verification suite ratchets
each page's counts (they only fall) from onward.

The states walker: `runStateTorture(engine)` drives every
hover-reactive node the input layer would deliver to (pointerenter listeners, not
under a disabled seal) through hover → press → release/leave via the node's own
dispatch, and demands VISIBLE feedback — an art/frame swap, a wash at the METRICS
floors, a position nudge, or a tooltip; press is demanded only of actionable nodes
(pointerdown/click listeners), a press that acquires focus is blurred before the
restore check, and feedback rendered outside the node's subtree names its home
with `node.stateProxy`. Returns `{violations, counts, allowances, walked, sealed}`.
`?torture=1` runs it after settle and titles `TORTURE <total>`; by-design
silences are declared with the same rationed vocabulary
(`auditAllow('hover' | 'press' | 'restore')`) — a Slider declares `restore`
because a press legitimately SETS its value. The suite ratchets each page via the
manifest `TORTURE <max>` clause.

The resize walker: `runResizeTorture(engine)` drives every
resizable surface — window handle kits and `ResizeGrip` hosts — through
grow → floors → restore using the surface's own handle events, re-running the
page auditor after every step (a spill or phantom bar IS an audit violation) and
demanding that `atBottom` scrollbacks hold their pin and the boot rect come back
within a pixel. Returns `{violations, counts, walked, sealed, allowed}`;
`?resize=1` titles `RESIZE <total>`; the manifest `RESIZE <max>` clause ratchets
it per page; `auditAllow('resize')` mutes a surface wholesale (rationed).

Many skins (`examples/theme-gallery.html` switches live): two shipped
theme PRESETS — `brass` (warm tycoon metalwork; includes a painter override) and
`aether` (clean sci-fi glass; tokens alone), both entry exports living in
`src/themes/` — pass one to `Eldritch.init({theme: brass})`; re-theme = destroy +
init ·
`theme.painters` (new in the API): `{ 'select.arrow': (ctx, w, h) => {...} }`
re-bakes named registry art at boot — frames keep their slice metrics, painters read
the THEMED `COLORS` lazily, and a throwing painter warns while stock art stands ·
`init({uiScale})` — couch-distance scaling at the camera level: layout and hit math
run in logical px (`css / uiScale`), the pixel ratio carries the difference, and the
atlas + text bake at DPR × uiScale so the stone stays crisp; shipped steps
1.0/1.25/1.5/2.0 (odd values snap with a warning); live change = destroy + init ·
`Eldritch.setHUDVisible(false, {except})` — capture-safe hiding: every UI band
sleeps (windows, taskbar, toasts, tooltips, popups) except the listed nodes, with
exact-prior restore on `(true)`; see the COOKBOOK photo-mode recipe and
`docs/THEMING.md` for the preset authoring walkthrough + colorblind guidance.

The world kit (`examples/action-hud.html` swings a night quay):
`WorldAnchorLayer({project})` — the consumer's camera fn `project(x, y, z) → {sx, sy,
visible}` parks UI nodes on world points: `anchor(node, target, {clampToEdge,
edgeMargin, fadeWith, dx, dy})` centers the node on the projection each frame (one
pooled frame hook, not per-anchor hooks; `target` may be a live object or a fn);
`clampToEdge` pins it inside the viewport margins and reports the clamped direction
to the node's `onEdge(dir|null)` (behind-camera points mirror across the screen
center first); `fadeWith(target, p)` drives fxOpacity; `release(node)` detaches;
disposing the layer drains every anchor and its tenants ·
`OffscreenIndicator({icon, size, showWhenOnscreen})` — the packaged edge marker:
hidden while its target is on screen, an accent arrow on the target-facing side
while clamped (anchor it with `clampToEdge: true`) · `KeyGlyph(bind, {size})` —
procedural keycap/mouse/gamepad-button art, baked on demand into the registry
(`'E'`, `'Ctrl+E'` rows keycaps, `{pad: 'A'}` the face button — A/B/X/Y ring in
accent/negative/mana/quest, bumpers and the long tail take a labeled pill,
`{mouse: 1|2|3}` lights the pressed region) · `InputPrompt(action, label)` — shows
the bind for the LAST-USED device (`action = {key: 'E', pad: 'A'}`) and re-glyphs
live on the engine's `devicechange` event (`engine.lastInputDevice`, fed by real
presses — pointer motion never flips it) · `InteractPrompt({action, label, hold})`
— the world-anchorable "press E" plate; with `hold`, `beginHold()`/`cancelHold()`
drive a full-circle progress ring (game code owns the actual key state) and
`confirm {}` fires exactly once at full · ActionSlot keybind corners render as the
same keycap art (single atoms; combos keep the compact text form).

The onboarding kit (`examples/tutorial.html` runs the tour):
`Spotlight({opacity, pad})` — a scrim with a LIVE hole: `setTarget(node, {shape:
'rect'|'circle', pad})` cuts around the node and TRACKS it across layout (`setCutout(
rect)` for raw regions; `null` = full scrim; retargets morph, `reducedMotion` jump-
cuts). Input outside the cutout is sealed and inside passes through — pointer, Tab,
spatial nav, and gamepad-A all refuse through the same `containsPoint` predicate, so
the keyboard fence costs nothing; dropdowns/menus opened in the light rise above the
scrim (the modal rule's twin), popups and toasts ride above by layer design ·
`Coachmark({title, text, markup, width, step, total, showNext, showSkip})` — the
stone callout: wrapped body (markup opt-in), progress dots, Next/Skip
(`next`/`skip` events); `placeNear(rect)` prefers below, flips above, then the sides
(the tooltip discipline), aiming its procedural arrow at the rect; `placeCentered()`
for narration · `TutorialSequencer({steps, escapeAborts, onStep, onDone})` —
declarative lessons `{target, title, text, advance: 'click'|'change'|'manual'|fn,
shape, pad}` over one Spotlight + one Coachmark: `start()` mounts on the overlay and
teaches; `target` may be a node, a lazy `() => node` (dead resolutions are skipped),
or `null` (narration); act-steps focus the target so Enter/gamepad-A works through
the hole; a target dying MID-step recovers forward; Escape or Skip aborts; events
`stepchange {index, step, target}` and `done {completed, step}`; the finished tour
fades and disposes itself (`dispose()` mid-sequence is silent teardown — no scrim
left behind).

The meta-screens kit (`examples/meta-screens.html` walks the whole flow
end to end): `MenuList({items, width})` — big stone menu rows, ONE focus stop whose
Up/Down WRAP around the enabled rows, Enter/gamepad-A selects (`select {index,
item}`) · `MenuScreen({title, items, width})` — the full-screen menu shell (an abyss
scrim glued to the engine, spaced-caps title, a centered MenuList); `push({title,
items})` slides in a SUBMENU through the presets and registers on the Escape
stack — Escape/gamepad-B pop exactly one level; `pop()`, `depth` ·
`TitleCard.show({title, subtitle, hold})` — queued area/turn/round banners (entrance,
hold, exit; one at a time; the promise resolves when ITS card has left) ·
`SaveSlotList({slots, width, onSelect, onDelete, onNew})` — save cards with name,
timestamp, playtime, and a procedural THUMBNAIL painter hook (`thumbnail(ctx, w, h)`;
the default paints a seeded house sigil — zero assets); Erase confirms through
`EldPopup` before `slotdelete {index}` fires (data-driven: mutate your slots and call
`setSlots`); a `null` slot renders the New Vessel card (`slotnew {index}`) ·
`LevelSelectGrid({levels, cols, pageSize})` — locked/open/done stone plates (locked
still clicks and focuses — locked is DATA, the standing plate rule; `levelclick {id,
state, stars}`), star rows on done plates, ‹ › paging when `pageSize` is set,
`setLevelState(id, state)` · `CreditsScroller({entries, width, height, speed})` —
the auto-scrolling roll (headers, role/name pairs, centered text); `setSpeed`,
`skip()`, and one `done {}` however the end arrives. Wheel-scrubbable;
under `Eldritch.reducedMotion` the roll rests READABLE instead of crawling —
the wheel is the player's own motion and scrubbing to the end takes the same
done path.

The instruments (all on the uniform contract; `docs/API.md` has the
"Instruments" reference): `SegmentedBar({segments, value, max, width, height, tint,
tints})` — discrete fills, the boundary segment fills fractionally, per-segment tints
for boss phases · `ArcGauge({value, max, radius, thickness, label, thresholds})` — a
270° ring whose sweep tweens to the value and re-tints by threshold fraction (its arc
is the widget's own canvas raster, disposed with it) · `Badge({count, color})` /
`attachBadge(node, {count})` — a corner count chip hung off the host's top-right (a
child: it moves and dies with the host), auto-hides at 0, reads "99+" past 99 ·
`ResourceChip({icon, value, cap, warnAt, width})` — icon + mono value/cap; every value
CHANGE flashes its delta (gain pops positive, loss negative — presentation, so silent
setters flash too; `silent` governs only events) and at/below `warnAt` the readout
holds the warn tint · `ResourceBar({chips, gap})` — the row composite; `.chips` is the
array · `BigTimer({seconds, warnAt, urgentAt, size, running})` — a mono M:SS countdown
with STATIC urgency color tiers (nothing pulses), `start()/stop()`, and a `timeout {}`
event exactly once at zero (re-arming via setValue resets the latch) ·
`StarRating({value, max})` — whole stars; click the k-th to set k, click the value to
clear, Left/Right adjust from focus · `SegmentedControl({options, value, width})` —
adjacent stone buttons, exactly one selected; Left/Right walk from focus (clamped, no
wrap); `setValue` by option value returns false on unknowns · `SpeedControl({value})`
— the pause/1×/2×/3× tempo preset.

Rich text: any `TextNode` constructed with `markup: true` parses its text for
`{color:#hex}…{/}`, `{b}…{/}`, `{i}…{/}` (nesting stacks), `{icon:name}` inline icon draws,
and `{{` literal braces; unknown tags render literally. Styled runs survive wrapping and
ellipsis; text without spaces (CJK, long tokens) wraps by characters. `compileMarkup(str,
style)` exposes the parser for prebuilt segment arrays (`setSegments`). two
more tags join: `{link:id}…{/}` CLICKABLE runs — tinted `COLORS.link` (an inner
`{color:}` overrides), hover raises an accent wash + the pointer cursor, press deepens
it, and a press-and-release on the same link instance dispatches a bubbling
`linkclick {id, text, x, y}` (plus `linkhover {id, text, over, x, y}` on crossings);
and `{hl:#hex}…{/}` HIGHLIGHT runs, a fill behind the glyphs (the argument is
required — a bare `{hl}` renders literally). Fragments survive wrapping (a wrapped
link's hit bands tile gap-free) and ellipsis (the visible `…` stays clickable);
`linkAt(localX, localY)` is the raw hit test. EventLog/ChatBox lines wire themselves
when their messages carry links; a raw TextNode opts in with `interactive = true`.
Inline links are pointer-only (keyboard traversal is catalogued), and as inline prose
they stand outside the 24px hit floor — the STYLE §7 ruling. the
widgets that carry consumer text accept the same opt-in: tooltip specs, `EventLog`
messages, `ChatBox` scrollbacks, `QuestTracker` objectives, and toast bodies all take
`markup: true` (no behavior change unopted) — `examples/rich-text.html` samples all of
it, and `docs/COOKBOOK.md`'s "Localize your game" chapter covers the strings table,
`Intl` formatting, CJK font stacks, and the RTL limitation (scripts render
left-to-right; bidi reordering is not performed).

Widget events use `node.on(type, fn)`: `click`, `rightclick`, `change`, `input`, `slotchange`,
`action-triggered`, `linkclick`/`linkhover` (inline `{link:}` runs),
`pointerenter/leave/down/up/move`, `wheel`, `keydown` (focused node;
modifier flags ride `e.native`), `focus`, `blur`, `dispose`.
Right-clicks synthesize `rightclick`; calling `preventDefault()` on it suppresses the next
native context menu (once).

Utility exports: `measureText(fontCss, text)` (text width in px), `compileMarkup(str, style)`
(markup → segment arrays), `abilityData(id)` and `formatIconName(id)` (tooltip lore for
ability icons, with graceful fallbacks; `ABILITY_DATA` is the raw lore table),
`EldritchEngine` (the engine class `Eldritch.init` constructs — exported for typing,
tests, and advanced embedding), the icon-painter helpers `iconBase(ctx, w, h)`,
`glow(ctx, color, blur)`, `noGlow(ctx)` (for `registerIcon` painters), `DraggableIcon` (the
icon node class the drag system moves between slots), `GamepadNav` (the gamepad adapter
class, injectable for tests), the layout helpers `clamp(v, lo, hi)`,
`fitChildren(node, opts)`, `contentExtent(children, opts)` ( — THE
content-extent law: the greatest `x + w` / `y + h` among children that layout
measures, skipping invisible and `fitExclude` chrome and pre-measuring box
children. Window auto-size, `ScrollArea` scroll range, and `fitChildren` are all
this one loop, so a widget's declared size and the scroll range built from it can
never disagree; assert `contentExtent(w.children)` against a widget's own `w`/`h`
to pin that it declares what it paints), and `contentRect(frame, w, h, pad)` (the
content box a 9-slice frame record leaves free of its stone border — pass a
`NineSliceNode`'s `.frame` or `engine.textures.frame(name)`; the library's own
window/popup/panel content boxes derive from it), and the tween easing table
`Easing` (`linear`, `ease`, `easeOutCubic`, `easeInOutCubic`, `easeOutQuad`).

Animation presets: `animateIn(node, preset, {dur, delay})` and
`animateOut(node, preset, {dur, delay})` run the four house transitions
(`'rise' | 'fall' | 'fadeScale' | 'stoneSlide'` — presets enter along their vector and
exit continuing it) and return promises that ALWAYS settle: a superseding call snaps
the previous one to its end state and resolves it, and a mid-flight dispose settles
through the node's own dispose event. End states are exact — in: visible at its base
transform, `fxOpacity` 1; out: `visible = false` with the transform restored and
`fxOpacity` back at 1, so a plain `visible = true` later just works (presets own
`fxOpacity` for the flight; reapply custom dim cues after the promise lands).
`stagger(nodes, preset, {gap, dur})` enters a group one after another and resolves
when the last lands. `Eldritch.reducedMotion = true` collapses all of it to instant.
`examples/juice.html` is the gallery.

The bound ledger: `new Store(initial)` is a dot-path observable model —
`get/set(path)` plus `subscribe(path, fn)` with MICROTASK-BATCHED notify (any number
of sets in one tick flush once per affected subscriber; a subscriber fires when its
path overlaps a written path in either direction). Wiring a widget is one line:
`bind(widget, store, path)` is two-way (inbound store changes land silently, the
widget's loud `change` writes back — no event loops by construction; a defined store
value seeds the widget, otherwise the widget seeds the store), `bindText(node, store,
path, fmt)` and `bindEnabled(widget, store, path)` are one-way, and disposing a bound
widget unbinds it. Explicit non-goal: computed/derived graphs. `DevPanel.fromSpec(
{title, fields, hotkey, x, y}, store)` builds the studio cheat panel from
toggle/slider/select/button/readout field rows — every row dogfoods `bind`, the
header click collapses it, and the hotkey (bus-level, focus-independent) toggles it.
`examples/binding.html` shows the whole ledger; the COOKBOOK's "Bind a game model"
and "Persist window layout + settings" chapters are RUNNABLE — the snippet runner
(`examples/selftest-cookbook.html`, checker v4) executes every fenced snippet tagged
`verify` headless, so the recipes stay verified.

Sound: the library ships ZERO audio but narrates every gesture onto the
bus as `uisound {kind, node, data}` — subscribe once and map kinds to your own mixer:
`engine.bus.on('uisound', ({kind}) => mixer.play(kind))`. The curated kinds:
`click` (buttons, slot triggers, every widget's loud value commit — the losing radio's
mirrored deselect stays silent), `hover` (buttons, icon buttons, menu rows), `open` /
`close` (selects, windows — minimize/restore tag `data.action` — popups, menus),
`pickup` / `drop` / `swap` (the drag protocol; discards and removals tag
`data.action`), `error` (rejected drops, sealed grids, full stacks, locked bars,
keybind conflicts, refused splits), `notify` (toasts and banners), `type` (text-field
keystrokes), `cooldown` (a rite's ready ping), `cast` (cast start/complete/interrupt
via `data.phase`).

### Behavior contract highlights

- Drag threshold 5px; click on a filled action slot always triggers (`action-triggered`) and starts
  a 3s visual cooldown that follows the icon between slots and never blocks re-use.
- Slot drops: occupied = swap, empty = move, palette = infinite source. Dropping an action-slot
  rite anywhere that is not a slot REMOVES it — empty space and solid non-slot UI alike
  (`slotchange` with `action:'remove'`); transient chrome that APPEARED MID-DRAG (a toast, an
  open menu, a popup scrim) cancels back instead; equipment (`CpSlot`) drags always cancel
  back to their slot.
- Item stacks (`ItemSlot`): same item merges up to `stackMax` with the remainder staying in
  the source slot; different items swap; empty item slots take a move; a release on anything
  that is not a drop target asks to discard the stack (confirmation popup — OK clears the
  slot loud, cancel keeps it; mid-drag transient chrome cancels back without asking); rites
  and items never mix — a cross-family drop rejects politely and the dragged icon stays home.
- Locked action bars are click-only; equipment (`CpSlot`) slots are unaffected by the lock.
- Disabled is inert: a disabled control (or anything inside a disabled container) still occludes
  what is beneath it and still receives `pointerenter/leave` (tooltips keep working), but takes
  no press, no capture, and never synthesizes `click` — including listeners you attached
  yourself. Clicking a disabled control inside a window still raises the window. In-flight
  gestures seal too: `setDisabled(true)` cancels any capture already held inside the subtree
  (a mid-drag slider commits its moved value and stops; pans, coasts, and scrollbar-thumb
  drags halt), and slots inside a disabled subtree accept no drops.
- Windows: min 250x180, drag/resize clamped to the container, header stays reachable, maximize
  fills the container and keeps filling it when the container or engine resizes, focus is an
  ever-increasing counter, minimize goes to the taskbar (items shrink evenly to 60..150px with
  re-ellipsized labels when the bar overflows, regaining natural width as it empties; past the
  60px floor — around thirteen minimized windows — the item lane scrolls instead of shedding
  items off the edge: wheel over the bar pans it, as do a touch drag, a middle-button pan,
  and the gamepad right stick's X axis, and a slim stone thumb appears).
- Wheel: the canvas only claims a wheel event when a scroll area (or the popup scrim) consumes
  it — otherwise the host page scrolls normally. Firefox line-mode deltas are normalized.
  Disabled follows the press rules with scroll-chaining semantics: a sealed (disabled) scroll
  area never consumes — the page scrolls past it — while a disabled control inside a live
  area does not block that area's scrolling. The gamepad right stick and the middle-button
  pan honor the same seal.
- Keyboard: the interface is fully operable without a mouse — Tab/Shift+Tab traverse in paint
  order, arrows move spatially (and adjust sliders / walk radio groups / navigate selects),
  Enter/Space activate, Escape closes the topmost open surface (dropdown, popup) then blurs.
  Keys route to the interface only while its canvas (or text input) holds DOM focus.
- Gamepad (standard mapping, on by default): d-pad/left stick route through the focused
  widget FIRST as arrow keys — a menu walks its rows, a slider nudges, a select steps its
  options, a virtual list steps its focus row (keyboard parity) — and fall back to spatial
  focus moves, with 350/120ms repeat; A activates, B cancels, bumpers cycle, right stick
  scrolls (Y and X — horizontal lanes pan on stick X). A verdigris ring marks key/gamepad
  focus; pointer focus draws no ring.
- Touch: long-press (450ms) shows tooltips (next tap hides); a touch drag on plain content
  inside a scroll area pans it with inertia on whichever axes the area can scroll —
  horizontal-only lanes pan on X (drag-owning widgets — sliders, thumbs, window
  headers, icons, text fields — always win); near-miss taps land within a 4px slop.
- Inline links (`{link:}` runs): press and release must land on the SAME link
  instance to fire `linkclick`; hover wears an accent wash + the pointer cursor; hit
  bands fill the full line advance so wrapped links never flicker between lines; a
  disabled ancestor seals hover feedback and clicks alike. Scrollback pinning:
  EventLog/ChatBox appends follow the tail only when the reader is already at the
  bottom — a scrolled-up reading position holds until an explicit `scrollToBottom()`.
- Tooltip: cursor +15/+15, flips at viewport edges (10px margin), 50ms hide delay.
- Select: Enter/Space toggles, Escape closes, ArrowUp/Down moves the selection immediately.
- Table sort: numeric when both cells parse as numbers, else locale string compare; a new column
  always starts ascending.

---

## Theme

Palette and fonts live in `src/theme.js` (`COLORS`, `FONTS`, `METRICS`). Accent is verdigris-green
`#6fd18b`; titles are spaced small-caps serif; health is arterial ichor, mana is void-purple
sanity. All stone art derives from the seeded generator in `src/art.js` — change the seeds or
painters there to re-cut every stone in the interface. The ability icon ids
(`fireball, fireball2, shield, sword, arrows, blindinglight, book, deathkiss, leafs`) are kept from
consistent conventions throughout; the drawn art and tooltip lore are Lovecraftian.

---

## Self-tests

Every example page carries its own instruments, so a page can prove itself in a
browser or in headless CI without any tooling from this repository:

- `?assert=1` runs the page's scripted behavior suite against the real engine
  (synthetic pointer and keyboard events through the live input path) and titles
  the document `<PAGE> ASSERT PASS n/n`.
- `?audit=1` runs the page auditor — sibling overlap, framed-container
  containment, text contrast, scrollbar truth, hit floors, and reach (every
  visible control must answer a real hit test) — and titles `AUDIT <n>`; a
  clean page reports 0 and the on-page census names any violation.
- `?torture=1` drives every hover-reactive node through hover → press →
  release and demands visible, restoring feedback; titles `TORTURE <n>`.
- `?resize=1` drives every resizable surface grow → floors → restore, re-running
  the auditor at each step; titles `RESIZE <n>`.
- `?freeze=1` parks every page clock for a bit-stable screenshot.

Read a title, and you know whether the page is healthy:

```
chrome --headless=new --dump-dom --virtual-time-budget=240000 \
       --window-size=1280,760 http://localhost:8000/examples/demo.html?assert=1
```

Pass `timerDriven: true` to `Eldritch.init()` on test pages — headless DOM
dumps never fire `requestAnimationFrame`. Keep the window size: smaller
viewports let the taskbar swallow fixture clicks.

---

## Troubleshooting

**Blank page / import errors.** Serve over HTTP; check the importmap path to
`vendor/three.module.js` (`three.core.js` must sit beside it).

**Nothing is interactive.** Call `Eldritch.init()` once; construct widgets after it returns and
add them to `Eldritch.engine.layers.background` (or a window's content).

**A widget swallows clicks meant for something below.** Paint order is hit order — later siblings
and higher layers win. See docs/GUIDE.md section 3.

**Text looks soft.** Keep positions integral (the layout helpers round for you) and avoid ancestor
`fxScale` on text-heavy panels.

**Windows do not follow my scrolled page.** Pass the section node to `EldWindow.setContainer` —
the window layer glues itself to that node's on-screen position.

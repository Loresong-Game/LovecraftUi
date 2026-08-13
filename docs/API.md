# API — the uniform widget contract

This document is the contract reference for consumers. The conventions below are the law
every widget follows (the 1.0 contract); the
sections after them describe each form widget's surface, the layout boxes,
then the kit chapters (instruments, onboarding, the world kit, the inspector's lens +
the walkers, the graph skins, the war table, the long winter). Composite components —
windows, tables, unit frames, panels,
menus, meta-screens — are documented option-by-option in README's JavaScript API table;
construction patterns live in docs/GUIDE.md; runnable recipes in docs/COOKBOOK.md.

## The conventions

1. Silent setters: programmatic setters fire no events by default; value setters take a
   trailing `{silent = true}` option — `silent: false` runs the same commit path as a user
   gesture. `input` = continuous gesture; `change` = committed value.
2. `remove()` detaches and preserves; `dispose()` destroys and frees. Nothing auto-disposes on
   detach. `UINode` emits `dispose` at the start of `dispose()`.
3. Disabled is inert, enforced at the input layer (hit path checks
   `closest(n => n.disabled)`): no capture, no click synthesis, no consumer `.on('click')`.
   Enter/leave still deliver (tooltips on disabled controls stay useful). Subtree-scoped.
   Every interactive widget gets `setDisabled(v)`.
   **Two deliberate exemptions** (audited and recorded, pinned by the
 `disableverb` selftest block). Because the seal is SUBTREE-scoped, a class needs
   its own verb only if a consumer would disable *it*: (a) **chrome and
   presentation** — `Window`, `ModalWindow`, `Taskbar`, `LoadingVeil`, `MenuScreen`,
   `ResizeGrip`, `Spotlight`, `Coachmark`, `SelectionMarquee`, `DocumentViewer`,
   `DevPanel` — you seal the region that owns them, not the furniture; and
   (b) **members sealed by their container's own verb** — `ItemSlot`,
   `ActionSlot`, `CpSlot`, `DraggableIcon` (via `ItemGrid.setLocked` /
   `EldDragDrop.setLocked`) and `Card` (via `HandFan` / `setPlayable`). Everything
   else has the verb.
4. Uniform value contract: `.value` (and `.checked` where natural) as read fields;
   `setValue/setChecked(v, {silent})` everywhere; Select gains `setValue/setOptions`;
   Slider setValue step-snaps and gains `onChange`; Radio deselect emits
   `change {checked:false}`; TextField gains `maxLength` and Enter -> `submit`.
5. Lifecycle: `Eldritch.destroy()` <-> idempotent `init()`.
6. Theme API: `Eldritch.init({theme: {colors, fonts, metrics, seeds}})`, applied before the
   texture bake. Re-theme = destroy + init. No live re-theme. **The socket law**:
   every stone frame recesses its icon socket ONE TWELFTH of the box per side —
   `socketInset(box)` (rounded: widgets seat art by it) and `socketInsetRaw(box)` (the raw
   ratio: painters bake by it, so a frame stretched to another size keeps the proportion)
   are exported, and the METRICS icon pairs (`slotIcon`, `cpSlotIcon`, `itemSlotIcon`)
   derive from it — a selftest pin asserts the agreement.
7. Icon/ability registry: `Eldritch.registerIcon(name, painter)` and
   `Eldritch.registerAbility(id, {name, desc, stats, flavor, painter})`; unknown icon ids
   resolve to a generated fallback plate with a one-time console warning instead of throwing.
8. Focus/input model shared by keyboard and gamepad: `engine.focus` manager, `focusable` flag,
   Tab/Shift+Tab tree-order traversal, spatial `move(dx,dy)`, Enter/Space activation,
   one Escape stack (dropdown > context menu > popup > blur), verdigris focus ring. Gamepad:
   d-pad/stick routes arrows through the focused widget then moves focus, A activates,
   B walks the Escape stack, bumpers cycle tabs. One press pops ONE surface — a nested
   `RadialMenu` counts each ring as a surface (Escape/B ascends one ring per press,
 then closes).
9. Event completion: every stateful component becomes observable; names are lowercase,
   payload fields flat; `action-triggered` keeps its legacy spelling.
10. Decided policies: EldPopup queues stacked `show()` calls (never discards callbacks),
    Escape = cancel, custom `buttons: [{label, onClick, variant}]`, `show()` returns a
    Promise. Taskbar shrinks items to fit (clamp 60..150 px, re-ellipsize). `ScrollArea.add()`
    forwards to `.content.add()`. `WindowBase.setContent(content)` + a `content` getter on
    all window types.

## Button

`new Button(text, { onClick, disabled, minWidth, height })`

- `setText(t)` — re-measures and re-sizes; never below `minWidth`.
- `setDisabled(v)` — dedicated disabled stone + `textDisabled` label; inert per convention 3.
- Events: `click`.

## IconButton

`new IconButton(kind, { onClick, disabled })` — `kind` resolves `ui.*` chrome icons first,
then `icon.*` ability icons.

- `setIcon(kind)` — swaps the glyph in place, re-running the resolution; the current
  hover/disabled state art follows.
- `setDisabled(v)` — grayscale art where it exists, else a dim; inert.
- Events: `click`.

## TextField

`new TextField({ placeholder, value, width, height, maxLength, onSubmit })`

- `.value` — the current text.
- `setValue(v, {silent})` — replaces the text (no event by default; `silent: false`
  dispatches `change`).
- `maxLength` — caps NATIVE typing and paste at the source (mirrored onto the hidden
  input on focus) and clamps programmatic text-input syncs.
- Enter dispatches `submit {value}` and calls `onSubmit(value)` — without blurring.
- Escape blurs the field and is consumed (it never also pops an open surface). The one
  exception is `EldPopup`'s prompt field: there the SAME press also cancels the popup
  (promptless parity).
- `setDisabled(v)` — blurs first, then goes inert.
- Events: `input {value}` (continuous), `change {value}` (on blur when the text changed,
  or a loud setValue), `submit {value}`, `focus`, `blur`.

## Toggle / ToggleLabel

`new Toggle({ checked, onChange })` · `new ToggleLabel(text, { checked, onChange })`

- `.checked` — read field (ToggleLabel proxies its inner toggle).
- `setChecked(v, {silent})` — no event by default; `silent: false` dispatches
  `change {checked}` and calls `onChange(checked)`.
- `setDisabled(v)` — inert; on ToggleLabel the whole row (subtree) goes inert.
- Events: `change {checked}`.

## Radio / RadioLabel

`new Radio(group, { checked, value, onChange })` ·
`new RadioLabel(group, text, { checked, value, onChange })`

- Selecting a radio deselects the group: each losing radio dispatches its OWN
  `change {checked: false}` (and its own `onChange(false)`); the winner fires exactly once
  with `{checked: true}`.
- The `change` payload also carries `value` — a MIRROR of `checked` (it feeds
  `onChange(checked)` through the shared commit path), NOT the radio's option id. Read the
  option id from `radio.value` or `Radio.groupValue(group)`; only `Select`/`Slider` put
  their real value in `change.value`.
- `radio.select()` — programmatic user-equivalent selection (loud).
- `Radio.groupValue(group)` — the checked member's `value` (constructor opt), else null.
- `Radio.selectValue(group, value, {silent})` — selects the member whose `value` matches;
  returns false when none does; silent by default.
- `setDisabled(v)` — inert; on RadioLabel the whole row goes inert.
- Arrow keys walk the group from whichever member holds focus.

## Slider

`new Slider({ min, max, step, value, width, labels, onInput, onChange })`

- `.value` — always step-snapped, counting from `min`.
- `setValue(v, {silent})` — snaps, then commits; `silent: false` dispatches `change` and
  calls `onChange(value)`.
- During a drag: `input {value}` + `onInput(value)` continuously; `change` once on release.
- Arrows step, Home/End jump — loud, like a gesture.
- `setDisabled(v)` — inert.

## Select

`new Select({ options, value, width, height, onChange })` — options are strings
(`'---'` renders a separator) or `{value, label}` records.

- `.value` — the selected option's value.
- `setValue(value, {silent}) -> boolean` — false when no option carries the value; no
  event by default.
- `setOptions(options, {value, silent})` — replaces the list (closing an open dropdown
  first); `value` picks the new selection, else the current value is kept when it still
  exists, else the first option.
- `getOptions()` — a copy of the normalized option records.
- The open dropdown flips above the field near the viewport bottom, clamps to the screen
  edges, tracks its field while the host window drags, and scrolls internally when taller
  than the viewport.
- `setDisabled(v)` — closes the dropdown, then goes inert.
- Events: `change {value, label, index}`, `open`, `close`.
- Keyboard: Enter/Space toggles, Escape closes (consumed), ArrowUp/Down moves the
  selection immediately.

## NumberField

`new NumberField({ value, min = 0, max = 99, step = 1, width, height, onChange })`

- A stepped numeric field: carved −/+ steppers flanking a mono value.
- `.value` is always step-snapped (counting from `min`, the Slider rule) and clamped.
- `setValue(v, {silent})` — no event by default; stepper clicks and arrow keys commit
  loud (`change {value}` + `onChange(value)`); Home/End jump to the bounds.
- `setDisabled(v)` — inert.

## KeybindField

`new KeybindField({ value, width, height, onChange, checkConflict, onConflict })`

- Click or Enter/Space arms the field; the next key combo (`Ctrl+Shift+K`) or mouse
  button pressed ON the field becomes `.value` — left (`Mouse1`) or right (`Mouse3`),
  modifiers included. Modifier-only presses keep waiting. Only those two buttons ever
  reach widgets: the input layer reserves the middle button (`Mouse2`) for pan-scroll
  and never dispatches back/forward (`Mouse4`/`Mouse5`), which stay browser navigation.
- Escape cancels the capture and is consumed; blur (clicking anywhere else) cancels.
- `checkConflict(combo) -> falsy | label`: truthy rejects the combo, reverts the
  display, dispatches `conflict {combo, with}`, and calls `onConflict(combo, label)`.
- `setValue(v, {silent})`, `setDisabled(v)`; user captures dispatch `change {value}`.

## ProgressBar

`new ProgressBar({ value, width, height, segments })` — display-only (never interactive).

- `setValue(pct, {animate = true, silent = true})` — clamps to 0..100; the fill tweens
  (0.3s) unless `animate: false`; `silent: false` dispatches `change {value}`.
- `segments: n` draws n−1 thin dividers across the fill band (the XP-bar pips);
  absent/0/1 draws none and the art is unchanged.

## Layout boxes (/ — the consumer-facing structure)

Containers replace `setPos` arithmetic in page and widget-body code. All of them:
read children's intrinsic sizes in their layout pass and CONVERGE ACROSS FRAMES
(give a settle beat before reading a box's size — the in-page settle rule); skip
`visible: false` and `fitExclude` children; auto-size on an axis unless you drive
it (`autoWidth: false` + `setSize` makes the width law and the height stays
derived); accept `frame: '<nineslice name>'` to OWN a stone background, the
frame's slice insets adding to your padding so content sits inside the stone with
zero arithmetic.

- **`VBox` / `HBox`** — `{ padding: n | {t,r,b,l}, gap, align: 'start' | 'center'
  | 'end' | 'stretch' (cross axis; stretch SETS the child's size and turns off
  its own auto-sizing on that axis), justify: 'start' | 'center' | 'end' |
  'space-between', frame, autoWidth, autoHeight }`. Per-child growth:
  `box.flex(child, n)` or `child.layoutFlex = n` — flex children split the
  leftover main-axis space in proportion.
- **`GridBox`** — `{ cols, cellW, cellH, gap, padding, align (within the cell),
  frame }`; rows = `ceil(children / cols)`; cell width defaults to the widest
  child, row height to the row's tallest.
- **`Stack`** — z-stacked children with 9-way anchors:
  `stack.place(child, 'center' | 'top-left' | 'top-right' | … , inset?)`.
- **`Spacer`** — flexible emptiness on the main axis (pushes what follows to the
  far edge); **`Divider`** — a themable rule line (an `align: 'stretch'` box
  makes it full-width).
- **`FormRow` / `Form`** — the settings-row idiom: a label column and a
  control on one row, uniform heights, focus-ring geometry; `Form` stacks rows
  with the house gap.

`ResizeGrip` / `makeResizable(host, { corner: 'tl' | 'tr' | 'bl' | 'br', minW,
minH, maxW, maxH, onResize })` arm any panel-class node with a drawn
corner grip driving edge-anchored resize math; a host exposing
`atBottom`/`scrollToBottom` (EventLog, ChatBox) keeps a pinned reader pinned
through the resize, and the host hears a bubbling `resize {w, h}`.
**THE FREEDOM LAW:** a drag-resized host's maximum is
never inhibited by other elements — pages must not budget `grip.maxW/maxH` off
their neighbors (every such "lane budget" was repealed). The grip's one
built-in ceiling keeps the DRAG GRIP within the visible screen: the moving
edge may not leave the engine viewport (bounds snapshot at pointerdown; floors
stay sovereign — a host born at the rim still honors `minW`/`minH`).
`maxW`/`maxH` remain honored when a consumer passes them at construction. A
host nested in a PanZoom plane sees the ENGINE viewport, not the plane's clip.

Windows (README's JavaScript API table has the full option list) auto-size to
their content when constructed without `width`/`height` (`autoSize: false`
opts out), take `minW`/`minH` floors, never resize below the size they were BORN
at, and their content lane carries a floor-state fallback H-rail — no rail
at boot, a real one only when a user forces the window below its content's
reflow minimum.

## Instruments

The small universal meters, all on the same contract (`setValue(v, {silent})`,
`change {value}` on loud commits, `setDisabled(v)`).

- **`SegmentedBar({segments, value, max, width, height, tint, tints})`** — `value` is
  in `[0, max]` and maps onto the segment lattice; the boundary segment fills
  fractionally; `tints[i]` overrides the per-segment color. Display-only.
- **`ArcGauge({value, max, radius, thickness, label, thresholds})`** — a 270° ring;
  the displayed sweep tweens (0.3s; `animate: false` snaps). `thresholds: [{pct,
  color}]` re-tint the sweep — the highest threshold at or below the current fraction
  wins. The arc raster is the widget's own canvas, disposed with it. Display-only.
- **`Badge({count, color})` / `attachBadge(node, {count}) -> Badge`** — the corner
  count chip; `setCount(n, {silent})` auto-hides at 0 and reads "99+" past 99. As an
  attached child it moves, hides, and dies with its host; its overhang is
  fit-excluded.
- **`ResourceChip({icon, value, cap, warnAt, width})`** — icon + mono `value/cap`.
  Every value CHANGE flashes its delta (gain pops positive, loss negative). The flash
  is PRESENTATION: silent setters flash too — `silent` governs only the `change`
  event. At or below `warnAt` the readout holds the warn tint after the flash
  settles. **`ResourceBar({chips, gap})`** rows chips; `.chips` is the live array.
- **`BigTimer({seconds, warnAt, urgentAt, size, running})`** — mono `M:SS`;
  `value` is the remaining seconds; `start()/stop()`; urgency is STATIC color tiers
  (quest-gold at `warnAt`, negative at `urgentAt` — nothing pulses). Zero stops the
  clock and dispatches `timeout {}` exactly once; a later `setValue(>0)` re-arms it.
- **`StarRating({value, max})`** — whole stars. Click the k-th star to set k; click
  the current value to clear to 0; Left/Right adjust from keyboard focus; hover
  previews in quest-gold.
- **`SegmentedControl({options, value, width, onChange})`** — adjacent stone buttons,
  exactly one selected; `options` are strings or `{label, value}`. Left/Right walk
  the options from focus, clamped at the ends (no wrap). `setValue` selects by OPTION
  VALUE and returns `false` on unknowns (the Select idiom).
  **`SpeedControl({value, width, onChange})`** returns the pause/1×/2×/3× preset.

## Onboarding

The teaching kit rides the systems above rather than duplicating them: the seal is
one `containsPoint` predicate (so the keyboard fence is the same occlusion rule the
input model already enforces), placement is the tooltip flip discipline, and lesson
transitions are the presets.

- **`Spotlight({opacity, pad})`** — a full-viewport scrim with a LIVE hole.
  `setTarget(node, {shape: 'rect'|'circle', pad, morph})` cuts around the node and
  TRACKS it across layout; `setCutout(rect)` for raw regions; `null` clears to a full
  scrim. Retargets MORPH (0.25s; `reducedMotion` jump-cuts). Input outside the cutout
  is sealed and inside passes through — pointer, Tab, spatial nav, and gamepad-A all
  refuse through the same predicate, so focus can never reach the dark. Dropdowns and
  context menus opened in the light rise above the scrim (the modal rule's twin);
  popups re-append themselves above it; toasts/tooltips ride above by layer design.
  `cutoutRect` reads the END-state rect (a mid-morph reads the destination).
- **`Coachmark({title, text, markup, width, step, total, showNext, showSkip, onNext,
  onSkip})`** — the stone callout: wrapped body (markup opt-in), progress dots,
  Next/Skip (`next`/`skip` events; `setContent({nextLabel})` re-captions).
  `placeNear(rect)` prefers below, flips above, then the sides, clamped to the
  viewport (the tooltip discipline), aiming its procedural arrow at the rect;
  `placeCentered()` is the narration pose (arrow hidden).
- **`TutorialSequencer({steps, opacity, pad, markup, escapeAborts, onStep,
  onDone})`** — declarative lessons over one Spotlight + one Coachmark. A step is
  `{target, title, text, advance, shape, pad}`: `target` is a node, a lazy
  `() => node` (dead resolutions are SKIPPED), or `null` (narration — full scrim,
  centered card); `advance` is `'click'` (a click anywhere in the target subtree),
  `'change'` (a loud commit), `'manual'` (the Next button), or a function polled once
  per frame with `(step, target)`. `start()` mounts on the overlay layer, pushes ONE
  Escape entry (Escape aborts; `escapeAborts: false` opts out), and focuses each
  lesson: act-steps focus the TARGET (Enter/gamepad-A works through the hole),
  read-steps focus Next. A target dying MID-step recovers forward. Events:
  `stepchange {index, step, stepTarget}` (the RESOLVED node — `target` is
  reserved by the event plane), `done {completed, step}` (Skip/Escape abort
  with `completed: false`); after `done` the tour fades and disposes itself.
  `dispose()` mid-sequence is silent teardown — wiring released, no scrim, no event.

## The world kit

- **`WorldAnchorLayer({project})`** — `project(x, y, z) → {sx, sy, visible}` is the
  consumer's camera (required; the layer throws a friendly error without it). One
  frame hook drives every anchor record. `anchor(node, target, opts)` parents the
  node and centers it on the projection (+`dx`/`dy`); an invisible projection hides
  an unclamped node; `clampToEdge` keeps it inside `edgeMargin` and calls the
  node's `onEdge(dir|null)` with the clamped direction (behind-camera points are
  MIRRORED across the screen center first — the classic flip that keeps arrows
  honest); `fadeWith(target, p) → 0..1` drives fxOpacity per frame. `release(node)`
  stops tracking (the node stays parented); disposing the layer drains the pool
  and its tenants.
- **`OffscreenIndicator({icon, size, showWhenOnscreen})`** — the edge-marker
  implementation of the `onEdge` contract: hidden on screen (unless
  `showWhenOnscreen`), a `tut.arrow.*` accent arrow on the target-facing side while
  clamped. `icon` is a REGISTRY texture name — grep it first.
- **`KeyGlyph(bind, {size})`** — a bind rendered as procedural glyph art, baked
  once per atom into the registry (`glyph.key.E`, `glyph.pad.A`, `glyph.mouse.1`).
  Binds: `'E'` / `'Ctrl+E'` (keycap rows), `{pad: 'A'}` (face buttons ring in
  accent/negative/mana/quest; LB/RB and the long tail take a labeled pill; LS/RS
  the stick disc), `{mouse: 1|2|3}` (the pressed region lights). `setBind`
  re-renders in place; `keyGlyphTexture(bind)` exposes the baked texture (the
  ActionSlot corner uses it).
- **`InputPrompt(action, label)`** — `action = {key, pad, mouse}` is the bind per
  device family; the prompt shows the one for `engine.lastInputDevice` and
  re-glyphs on the bus `devicechange` event. The device flag is fed by REAL
  presses (keys, pointer downs, pad edges/sticks) — pointer motion never flips it;
  `engine.noteDevice('kbm'|'pad')` is the manual override (demos, tests).
- **`InteractPrompt({action, label, hold, onConfirm})`** — the "press E" stone
  plate (an InputPrompt on a callout), world-anchorable like any node. With
  `hold` seconds, `beginHold()` fills a full-circle ring around the glyph and
  dispatches `confirm {}` EXACTLY once at full (then resets); `cancelHold()`
  drains at 3× speed; `setProgress(v)` drives it manually. Game code owns the
  actual key state — the prompt never listens to the keyboard itself.

## The inspector's lens

The dev tooling ships with the library and costs nothing until armed.

- **`DebugConsole({height, hotkey})`** — the drop-down dev console on pooled
  VirtualList rows (1000-line cap). The backtick hotkey toggles it whenever NOTHING
  holds focus (the bus-hotkey shape DevPanel uses); `?console=1` summons one open at
  boot; ONE Escape dismisses it (the prompt rule — close rides the field's own
  keydown). `register(name, fn, help)` adds a command: `fn(rest, con)` receives the
  argument tail and the console, a returned value prints, a throw prints in the
  error voice. Built-ins: `help`, `clear`, `stats`, `echo`. Up/Down recall history
  (blank past newest); Tab completes a unique command prefix. Typed input echoes
  with braces escaped; command OUTPUT stays raw, so `echo` doubles as a markup
  previewer. Every `EldEvents.log` line echoes into the scrollback through a tap.
- **`EldEvents.tap(fn)` → `off()`** — NON-STEALING observers: `fn(message, type)`
  hears every log line regardless of the sink stack, so tooling can listen without
  robbing the game's own EventLog of the sink. The returned function unsubscribes;
  `Eldritch.destroy()` clears all taps.
- **`DebugInspector`** — the node-tree inspector window: under `?debug=1` the `i`
  key toggles one, or construct it directly. A VIRTUALIZED snapshot tree of every
  layer (Refresh and pick re-walk; deliberately not a live mutation observer — a
  per-frame walk would cause the load it measures), click-to-select with a cyan
  bounds highlight, a property readout (name#id, layer, local/world rect,
  interactive/focusable/disabled, visibility, paint index, clipping, focus), and
  PICK MODE — the next press selects whatever it hits WITHOUT swallowing it (a
  read-only observer on the bus; presses on the inspector itself are ignored). The
  LEAK DASHBOARD shows live node/tween/hook/texture counts — numbers that refuse to
  fall after a teardown are the dispose report.
- Friendly errors v2 (ambient behavior, not a class): malformed markup warns once
  per distinct string, naming it (unclosed runs and stray `{/}` are both tolerated);
  a Store binding loop is detected at 64 consecutive unsettled flushes, named with
  its dirty paths, and BROKEN instead of hanging the tab; WorldAnchorLayer throws a
  friendly error when constructed without a projection.

### The walkers (instruments — the lens's siblings)

- **`runAudit(engine)`** — walks the live paint list and returns
  `{violations, counts, allowances, deadAllowances}` across OVERLAP /
  CONTAINMENT / CONTRAST / SCROLLBAR / HIT / REACH (the sixth rule,:
 every visible drawn interactive node must answer the real `hitTest` from at
 least one point of a 5×5 grid over its own box; the violation carries the
 `blocker` that covered it). `?audit=1` runs it after settle and titles
  `AUDIT <n>`. The exported `AUDIT_RULES` array names the rules in report order
  — sum counts by keying on it, never on a hand-frozen list. `auditAllow('reach')`
  alone resolves UP THE CHAIN (declare once on a container for everything inside);
  it reads `dead` in the census unless it forgave a real failure.
- **`Eldritch.loadIcons(opts)`** — registers a curated set of the optional
  icon pack (assets/icons) through `registerIcon`: `{ base, icons: [id|slug|
  {id, as}], sheets, fallback: 'glyph'|'none', keyBlack, size }` →
  `{registered, missing}`. Missing assets bake a legible letter-glyph plate;
  density re-bakes and destroy/init persistence are inherited from the
  custom-icon machinery. The sheets ship with opaque black backgrounds, so the
  decode keys black to alpha once per sheet — pack art seats INSIDE the carved
  house plate instead of covering it (`keyBlack: false` opts out for a pack that
  carries its own alpha).
  **The re-skin idiom — how a page should adopt the pack.** Point `as:` at an
  icon id the page ALREADY uses and the registry re-bakes that one name in place:
  every live quad follows with no page code, the atlas count never moves, and
  `fallback: 'none'` leaves the procedural art standing when `assets/` is absent.
  Awaiting before construction is only necessary when registering NEW names.
  ```js
  await Eldritch.loadIcons({ base: '../assets/icons', fallback: 'none', icons: [
    { id: 'ico-0210', as: 'shield' },   // the painted ward replaces the drawn one
  ]});
  ```
- **`Eldritch.loadIconPack(opts)`** — the count-free bulk path: one
  PACK-OWNED texture per 1024×1024 sheet, `pack.view(idOrSlug)` returns a
  cloned THREE.Texture windowed onto the 128px cell by offset/repeat, inset half
  a source texel so a bilinear sample can never reach the neighbouring cell
  (clones share `.source` — one GPU upload per sheet, zero registry entries).
  Surface: `list/sheets/categories/get/find/ensure(sheetIds)/texture/view/
  trim(keep)/stats/dispose`. Every GPU handle belongs to the pack: `dispose()`
  frees them, `trim(keep)` releases the sheets outside `keep` (dispose their
  views first — a pooled grid does that on rebind), and `Eldritch.destroy()`
  drains any live pack so nothing outlives its engine. The vault
  (`examples/icon-browser.html`) is the working reference.
- **`new MenuScreen({ scrimOpacity })`** — the veil behind the menu,
  default `0.88`. That default is right for a **pause** menu, whose whole job is
  to seal live gameplay away; it is wrong for a **title** screen, which has
  nothing behind it to seal and whose backdrop is the game's first impression —
  at 0.88 a painted backdrop comes through at twelve percent, which measures as
  black. Thin it there (`examples/meta-screens.html` uses `0.34` for the title
  and keeps the default for the pause menu). The scrim's press-swallowing role is
  unaffected at any value; only the veil changes. Non-numeric falls back to the
  default and out-of-range clamps into `0..1` (`titleveil`).
- **`MenuList.setItemEnabled(idOrIndex, v)` / item `reason`** — runtime
  lock/unlock with a hover tooltip explaining WHY a row is sealed;
  `ChoiceList.setChoiceEnabled(id, v)` is the narrative alias, and `RadialMenu`
  (`setItemEnabled` + sector `reason`; the id form searches the whole
 NESTED tree — a hidden branch's flip renders on the next descend, and disabling
 a parent seals descent into its subtree) and `CommandCard` (command `reason`,
  `setCommandDisabled`) speak the same contract. a sealed
  `MenuList`/`ChoiceList` row also wears a padlock glyph seated in its frame —
  a dimmed label plus a tooltip is information, a padlock is an AFFORDANCE; the
  glyph unseals with the row (STYLE 1a.1: a deliberately inert control must say
  why from the screen alone).
- **`hitTest(engine, x, y, pad = 0)`** — the reverse-paint-order hit
  probe, the same walk pointer input rides; returns the topmost interactive node
  containing the point or `null`. The assert-suite reachability idiom: probe a
  control's center and demand the control (or a descendant) answers — dispatch
  bypasses hit testing and cannot see occlusion.
- **`VirtualList.poolSize`** — the pooled row-node count, made public
  because a flagship page was reading `_pool` to prove virtualization; the
  honest assert form is `poolSize` staying bounded while the model grows.
- **`HandFan.setHover(card)`** — the public hover verb (`null` clears);
  promoted because a flagship modelled the private `_setHover` in copyable code.
- **Layer bands** — `LAYER_ORDER` is `[background, windows, dropdown, taskbar,
  overlay, radial, ghost, tooltip, cinematic, vignette]` (the `radial` band
  joined : the summoning circle's own home, above every overlay mount so
  later `add()` calls can never bury an open wheel; modal popups stay on
  `overlay` below it and an open wheel CLOSES when one presents — the yield
  law). `overlay` paints ABOVE `windows`: a HUD parked on overlay buries every
  window it opens (the "windows stuck under other elements" class). A
  resting HUD belongs on `background`; bottom-anchored chrome stays OFF
  background because the `taskbar` band sits above it.
- **`runStateTorture(engine)`** — drives every hover-reactive node the
  input layer would deliver to through hover → press → release/leave via the
  node's own dispatch and demands VISIBLE feedback (tooltips count for hover;
  press is demanded only of actionable nodes; press-acquired focus is blurred
  before the restore check). Returns `{violations, counts, allowances, walked,
  sealed}`; `?torture=1` titles `TORTURE <n>`. Deliberate silences declare
  `auditAllow('hover' | 'press' | 'restore')`; sibling-rendered feedback names
  its home with `node.stateProxy`.
- **`runResizeTorture(engine)`** — drives every resizable surface (window
  handle kits, `ResizeGrip` hosts) grow → floors → restore through its own
  handle events, re-running the page auditor at each step; `atBottom`
  scrollbacks must hold their pin and the boot rect must return within 1px.
  (the freedom law) the walked surface COVERING a same-layer
  neighbor mid-grow is not a spill — the carve is IDENTITY-only, so the
  surface's own children colliding under the resize still files.
  Returns `{violations, counts, walked, sealed, allowed}`; `?resize=1` titles
  `RESIZE <n>`; `auditAllow('resize')` mutes a surface wholesale.
- The suite ratchets all four per page via the manifest clauses
  (`AUDIT`/`ALLOW`/`TORTURE`/`RESIZE` in the page manifest); docs/STYLE.md
  is the protocol reference.

## The talent grid (the WoW-Classic law)

The graph skins (SkillTree/TechTree) and the NodeGraph core were
DESTROYED and replaced whole. One discipline's dataset:
`{name, talents: [{id, icon, tier (1-based), col (0..3), maxRank (1..5 = 1),
requires: prereqId | null, name?, desc? | rankDesc?: [per-rank strings]}]}`.
Normalization is friendly-error (duplicate ids/cells drop with a warn-once;
unknown `requires` locks forever and warns; tiers/cols/ranks clamp finite-first).

- **`TalentTree({data, points, plateSize, onSpend, onRefund})`** — ONE pane: a
  fixed grid of tiers by four columns, no pan, no zoom, no selection state.
  `points` is the FED unspent pool (a page or TalentPanes grants it); every rank
  costs ONE point. States derive — `locked-tier` (the test suite:
  5×(tier−1) points spent IN THIS TREE), `locked-prereq` (the prerequisite must
  be MAXED), `available`, `ranked`, `maxed` (`getState(id)` reads them; art:
  grey / green / verdigris / gilt `graphnode.maxed`). LEFT click (or Enter /
  gamepad-A on a focused plate) learns one rank — loud `spend {id, rank, tier,
  spent, points}`; refusals speak the error voice and the tooltip's RED lines
  answer why (tier gate, unmet prerequisite). RIGHT click unlearns one under
  the legality oracle (`canRefund(id)`: no ranked dependent may lose its maxed
  prerequisite, no higher tier may fall below its gate) — loud `refund {…}` —
  as do Minus and Delete on the FOCUSED plate (the keyboard refund; landed
 post- from the cut line), and the grid ALWAYS CONSUMES its plate
  right-clicks and refund keys, so the radial chain and the hotkey bus stay
  out (an UNWIRED plate — RunMap's — lets both fall through, so page hotkeys
  keep their minus). Golden arrows ride ONE own-raster underlay (gilt when the
  prerequisite is maxed); a sealed tier states its price on the measured left
  rail; rank badges read n/N on a dark chip (legible over any icon art).
  `setPoints(v, {silent})`, `setRanks(map, {silent})` (the silent load path —
  tier-ascending, lawless entries dropped with a warn), `getRanks/getRank/
  getSpent/canSpend`, `reset({silent})` (zeroes and credits the pool — no
  confirm at this level), `setData` rebuilds wholesale, `setDisabled` seals
  (including `talenthover {id, over, rank, state}`).
- **`TalentPanes({panes: [{id, data}], points, plateSize, onSpend, onRefund,
  onReset})`** — N disciplines around ONE unspent pool: the header (unspent +
  total spent through the string table), the confirm-guarded **Reset Talents**
  button (EldPopup; the respec epoch guard — a confirm left standing across a
  `restore` refunds nothing, and re-entry cannot double-refund), and the pool
  law: child `spend`/`refund` events bubble through the panes gaining a `tree`
  field while the pool re-feeds every pane's mirror silently.
  `pane(id)`, `getSpent()`, `setPoints(v, {silent})`, `serialize()` /
  `restore({points, ranks})` (the silent load path). See `examples/trees.html`
  (three disciplines) and the Forbidden Sciences window in
  `examples/strategy-hud.html` (one pane fed by play).

## The war table

The strategy kit. Every widget AFFORDS and the game owns the model: the marquee
narrates rects, the card narrates commands, the queue narrates cancels — your code
mutates its own state and calls the `set*` methods back.

- **`SelectionMarquee({onSelect})`** — mount it on `engine.layers.ghost`. It arms
  ONLY on a primary press over empty space (no interactive hit); past the drag
  threshold it goes live and dispatches `marquee {x, y, w, h, phase: 'start'|'drag',
  shift}` per move, then `marqueeend {x, y, w, h, shift, canceled}` on release.
  `onSelect(rect)` receives the final payload and is SKIPPED for canceled rects
  (`shift` rides every payload for add-to-selection). THE GAME intersects the rect
  with its entities. Sub-threshold presses stay clicks; disabling it mid-drag ends
  the live rect as canceled. It draws on the ghost layer — above panels — while
  dragging across them (documented behavior).
- **`CommandCard({commands, units, cols, gap, onCommand})`** — the command grid over
  a display-only unit tray. `commands: [{id, icon, hotkey, cost, disabled}]` — icons
  take bare ability ids first (`'shield'`), full registry names as fallback; `hotkey`
  is a single-atom keyboard bind rendered as a keycap corner; `cost` shows
  quest-gold. `units: [{id, icon, count}]` draws tray plates with count badges.
  Plate clicks AND bus hotkeys (matched while nothing holds focus) funnel into ONE
  loud `command {id, cost}`; a disabled command refuses with the error voice.
  `setCommands(list)` / `setUnits(list)` / `setCommandDisabled(id, v)`.
- **`BuildQueue({slots, gap, onCancel})`** — horizontal production slots.
  `setQueue([{id, icon, count}])` fills head-first (repeat entries stack a count
  badge; empty slots draw dim placeholders); `setProgress(0..1)` fills the head
  slot's underbar (presentation — the game clocks it). Clicking any filled slot
  dispatches `cancel {index, id}`: mutate your queue and `setQueue` it back.
- **`TacticalMap({width, height, world, terrain, onMove})`** — the rectangular
  minimap. `world: {w, h}` fixes the coordinate space; `terrain(ctx, w, h)` paints
  the ground once over the own-raster base (baked at the live density);
  `setViewport({x, y, w, h})` draws the camera footprint in world coordinates; a
  click dispatches a loud `moveto {x, y}` in WORLD coordinates; `ping(x, y,
  {waypoint})` spawns a finite pulse (bake-once ring art, self-disposing). There is
  no entity-blip API — statics paint via `terrain`; live blips are catalogued work.

## The long winter

The survival/crafting kit. Register items FIRST (`Eldritch.registerItem`) — the
grids and browser resolve icons and `stackMax` at placement time.

- **`RecipeBrowser({recipes, categories, have, width, height, onCraft})`** — a
  category strip over an availability-tinted recipe list and a detail pane
  (output preview, have/need rows that go negative-red when short, craft ×N via a
  NumberField). `recipes: [{id, label, icon, out: {id, count}, needs: [{id,
  count}], category}]` (`categories` derives from the records when omitted);
  `have(id)` is YOUR inventory truth, consulted on every refresh. Crafting
  dispatches ONE loud `craft {id, count, out, needs}` with `count`, `out.count`,
  and every `needs[].count` ×N-scaled — the browser owns no inventory: the game
  decrements its own stores, then calls `refresh()` to re-read `have` and re-tint.
- **`ProcessPanel()`** — the campfire/forge: `.input`, `.fuel`, and `.output` are
  three REAL 1×1 `ItemGrid`s, so the whole drag protocol (stacking, splitting,
  tooltips, the lock seal) interops unchanged; seed and read them with
  `setItem`/`getItem`. `setProgress(0..1)` fills the arrow (the game clocks the
  burn); `itemchange` bubbles through the panel for reactive wiring, or poll the
  grids from your ticker.
- **`CompassStrip({width, heading, markers})`** — a 360° heading tape baked once
  and panned by texture offset: `setHeading(deg)` wraps by modulo (359.6° reads
  0°, never 360°), so spinning it costs no re-raster. `markers: [{bearing,
  color}]` ride RELATIVE bearing and slide along the tape; cardinal letters
  localize through the `compassCardinals` string.
- **`DayDial({size, time})`** ('s cut line, graduated) — the
  procedural sun/moon day-clock ring: `setTime(t, {silent})` takes a 0..1 day
  fraction (0 = midnight, 0.5 = noon) and WRAPS, repainting the own-raster face
  (a rayed sun rides the rim through the day span, a crescent moon through the
  night; the gilded upper arc marks daylight). Loud calls commit `change {value}`.
  Own-raster like ArcGauge — the dial adds nothing to the texture atlas.

## The speaking stones

The MUD/text-game kit. The clickable-text half lives in the rich-text chapter below;
this is the furniture. Register items FIRST — the rack's grids resolve icons,
`stackMax`, and your typing `data` at placement time.

- **`BodyDoll({parts, labels, state, width, onPartChange, onPartClick, disabled})`** —
  the thirteen-part humanoid condition figure: `head, neck, back, chest, abdomen,
  l-arm, r-arm, l-hand, r-hand, l-leg, r-leg, l-foot, r-foot`. Sides are the
  CHARACTER's (l-* renders on the viewer's right); `back` reads as the shoulder yoke
  on the front-facing figure. `parts` subsets the list (unknown ids warn once and
  skip; non-listed parts still draw the silhouette, inert); `labels` overrides
  tooltip titles per id (consumer data); `state` seeds silent; `width >= 170` scales
  the figure (height derives) and every part keeps a >= 24px hit box at the default.
  Per-part state is `{damage: 0..3, bleed, missing, scars: 0..3}`:
  `setPart(id, patch, {silent})` MERGE-patches — ranks floor and clamp, non-finite
  rank values are ignored (the field keeps its value), flags coerce, no-op patches
  emit nothing — then dispatches `partchange {part, damage, bleed, missing, scars}`
  through the loud/silent contract. Parts are focusable child regions: click or
  Enter/gamepad-A dispatches `partclick` (same payload) on the doll; every part
  carries an auto tooltip built from the strings table (`dollHead`…`dollScar3`).
  Rendering is STATIC severity tiers (stone → quest → the legendary orange →
  negative; §9, never a pulse); `missing` ghosts the limb to void while the region
  stays alive (a bleeding stump is a real state; damage tint suppresses while
  missing); `scars` paints rank-count stitch marks; a fresh wound (bleed off→on or a
  damage increase) flashes once, finitely. `setParts(map)` / `getPart(id)` (a fresh
  copy) / `getParts()` / `.parts` (frozen, in Tab order) / `setDisabled(v)` (tooltips
  still hover — inspecting a corpse is correct).
- **`EquipmentRack({zones, gap, locked, onEquipChange})`** — worn-equipment
  collections by zone. `zones: [{id, label, slots = 1, cols, accepts, items}]` is
  CONSTRUCTOR-FIXED (the NodeGraph data rule; the rack sizes itself once): `label`
  is consumer data rendered verbatim (fallback: the id), `cols` wraps a zone's slots
  (must divide `slots`, else a warning and a single row), `accepts` types the zone's
  grid, `items` seed silent as `[{index?, id, count?, durability?}]`. Every zone is
  a REAL `ItemGrid` — `getZone(id)` hands it back whole, and the full drag
  protocol (stacks, splits, tooltips, durability, locks, the discard confirm)
  interops with zero new code. Zone changes RE-DISPATCH as `equipchange {zone,
  index, item, count, action}` (bubbled `itemchange` slot ids are grid-local —
  `item:0` exists in every zone — so the zone context is new information; the raw
  `itemchange`/`transfer` still bubble beneath). `setItem/getItem/clearSlot(zoneId,
  index, …)` pass through — setItem stays GAME-AUTHORITATIVE and bypasses `accepts`
  by design. `linkTransfer(bag)` arms shift-click quick-UNEQUIP on every zone
  (dragging is the way in — a grid's linkTransfer names one destination);
  `transferAll(bag)` strips every zone into the bag and returns total stacks moved
  (partial-sweep semantics per zone); the strip is ONE gesture and voices once —
  one `swap` if anything moved, one `error` if anything stayed worn.
  `setLocked(v)` seals every zone through the
  existing gridSealed path; `setZoneLocked(zoneId, v)` seals one (returns false on
  unknown ids).

### ItemGrid extensions: the `accepts` doorway

- **`accepts: (itemId, count) => boolean`** (constructor opt; `null` = accept
  everything, the 1.14 behavior verbatim) — consulted once per CROSS-CONTAINER entry
  attempt: any drag drop or shift-click quick-move whose source grid is not the
  destination grid, branch-independent (merge, swap, and move all ask). A cross-grid
  SWAP must satisfy BOTH doorways — the dragged stack enters the target grid AND the
  displaced stack enters the source grid. Same-grid rearranges never ask;
  programmatic `setItem`/`clearSlot` and same-grid splits are game-authoritative and
  exempt by design. Refusal is polite: one `zoneRefused` log line + the error voice +
  return BEFORE any mutation — no icon moves, nothing dispatches, the drag cancels
  home. A refusing zone still LIGHTS on drag-over: hiding it from target resolution
  would route the release to the item discard-confirm flow. `transferAll` counts a
  refused stack as stuck (one error voices the sweep; `moved` counts what entered).

### ItemGrid extensions

- **Durability** — `setItem(index, id, count, {durability: 0..1})` or
  `setDurability(index, v)` (`null` clears). The fraction lives on the ICON — the
  thing that physically rides drags — and paints a static tier-tinted underbar
  (accent above two-thirds, quest above one-third, negative below; nothing
  pulses). `getItem(index)` still returns `{item, count}` — durability is
  presentation on the traveling icon, not part of the read shape. Quick-moves
  carry it verbatim; per-instance durability semantics suit `stackMax: 1` items.
- **`sort({comparator, silent})`** ('s cut line, graduated) —
  consolidate then order: same-id stacks MERGE first (`stackMax` honored;
  durability-bearing stacks never merge — a worn fraction is not averageable),
  then everything packs from slot 0 ordered by the comparator (default: rarity
  tier descending, then item id, then count descending). Locked grids refuse
  with the error voice. Silent by default like every mutator; a loud call
  dispatches ONE `itemchange {action: 'sort'}` summary, never per-slot spam.
  Sorting while a drag flies FROM the grid is safe — the source icon's dispose
  watch cancels the gesture.
- **`linkTransfer(other)`** — arms shift-click quick-move toward `other`: merge
  into same-id stacks first (honoring `stackMax`), then the first empty slot. A
  destination with no room refuses with the error voice and dispatches NOTHING.
  Success dispatches `transfer {index, id, count, to}` on the source grid —
  `transfer` is deliberately not `change`, so batch sweeps stay quiet.
- **`transferAll(other)`** — take-all and deposit-all are the same sweep pointed
  both ways: `chest.transferAll(satchel)` empties the chest into the satchel;
  `satchel.transferAll(chest)` deposits. Every stack is tried, and merges
  COMPOUND — a stack spilled into an empty slot becomes the next stack's merge
  target, so a "full" destination can still absorb. One `swap` voices any
  success, one `error` voices anything left behind; returns the number of stacks
  fully or partially moved. Locked grids (either side) refuse whole.
  `transferAll(other, {quiet: true})` silences both voices — events still
  dispatch — for composites that sweep several grids as one gesture and voice
  once themselves, the way `EquipmentRack.transferAll` does.

## The counting house (Table, TreeTable, NotificationCenter)

The tycoon kit's ledgers, plus core `Table` (older than the kit, but the same
sheet family — `examples/big-data.html` and demo's muster both ride it). The
the long-form sections.

- **`Table({columns: [{label, width}], rows, sort?: {column, ascending},
  virtual?})`** — fixed-width columns (a non-finite width falls to 120,
  finite-first); rows are plain arrays. `sort` boots the model ordered
  SILENTLY — construction is not an interaction; header clicks toggle FROM the
  boot state, dispatch loud `sort {column, ascending}`, and speak the ledger
  line; a non-integer boot `column` is refused whole. The order arrow
  is an OVERLAY: a 15px accent glyph right-anchored in the
  header cell, re-seated per toggle, never a flow participant — labels and
  column widths hold their measurements sorted or not. `virtual: true` (or a
  viewport height) pools rows over a `VirtualList` — the FULL model stays
  resident and sortable, only visible rows render, and a pooled rebind under a
  stationary cursor keeps its hover wash. `getRows/setRows/addRow/removeRow/
  updateCell` (the active sort re-applies after every change), `sortByColumn(ci)`,
  `rowclick {row, index}`. See `examples/big-data.html` (5,000 rows, live
  full-model sort — its drive flips a header both directions).
- **`TreeTable({columns: [{key, label, width?}], rows: [{id, cells,
  children?}], width, height, rowH, onActivate})`** — the expandable ledger
  over a FLATTENED visible list riding `VirtualList` (five thousand rows pool
  one screenful). The `expanded` set is keyed by id, so it SURVIVES `sort` and
  `setRows` (the test suite pins it). `sort(key, dir, {silent = true})` orders
  SIBLINGS recursively and stays stable (ties keep insertion order); header
  clicks pass `{silent: false}` so the gesture keeps its voice (contract ruling). The sorted column wears a 13px arrow OVERLAY at
  the cell's right edge — the LABEL never carries the order (the old ` ^`
  suffix was a 10px speck that changed the label's measurement per toggle).
  Rows: a real chevron expander (closed points, open drops), a child-count
  chip beside a parent's name, a depth rail under children (polish); the expander keeps its own click; `rowactivate {row}` +
  `onActivate(row)` ride a real row-body click, geometry-resolved on the list
 — the scrollbar's own gestures never activate a row.
  `toggle(id)/expandAll()/collapseAll()`, `setRows`, `setDisabled`. See the
  five-thousand-holding ledger in `examples/tycoon.html` (driven).
- **`NotificationCenter({width = 300, maxVisible = 6, maxNotes = 50, title,
  onJump})`** — the persistent prioritized ledger (the routing
 terminus): priority orders it, ties keep arrival order, unread wears the
  accent dot, bounded by `maxNotes`. `push({id, title, priority, ...})`
  refreshes an existing id to the top — never duplicates; `dismiss(id)`,
  `markRead(id)`, `markAllRead()`, `jump(id)` (marks read and dispatches loud
  `jump {id}`). All verbs speak `{silent = true}`: loud pushes/dismissals
  commit `notechange {id, count, unread, action: 'push' | 'dismiss'}` (a
  missing id commits nothing), `markRead` commits `readchange {id, unread}`,
  `markAllRead` commits `readchange {id: null, unread: 0}` (restored
 the dead commit; gave the other verbs their voice). See the advisor
  counsel in `examples/tycoon.html`.

## The ironsights (the ammo counter)

The shooter kit's other pieces (Reticle, HitMarker, DamageIndicator, Killfeed)
keep their README rows; `AmmoCounter` carries the recorded long-form.

- **`AmmoCounter({mag = 12, magSize = 12, reserve = 36, warnAt = 0.25,
  onChange})`** — mag/reserve numerals with a reload sweep rail. `fire(n)`
  spends and commits loud `ammochange {mag, reserve, action: 'fire'}`; the
  LOW state commits ONCE per threshold crossing (`warnAt` × magSize, clamped
  (0,1)); `setAmmo(mag, reserve, {silent = true})` is the programmatic path
  (`action: 'set'`); `reload(dur)` runs the sweep and lands loud
  `reloaded {mag, reserve, action: 'reload'}` (pinned — the
 payload names its verb so a page can tell a landing from a fire). See
  `examples/shooter-hud.html` (driven — the mag counts pin the wheel-gate
  microtask: the closing press is no trigger pull).

## Additional widget contracts

- **`RadialMenu` nested rings** (the graduation) —
  `items` gain `children: RadialItem[]`; activating a parent swaps the SAME ring
  in place for the children plus one Back sector (`strings.radialBack`);
  `select` fires on LEAVES only and its payload gains the breadcrumb
  `path` (additive — `{index, id, item, path}`); `descend {id, item, path}` /
  `ascend {path, depth}` narrate ring swaps; `depth` reads the level;
  Escape/gamepad-B pops one ring per press while outside-press/Tab close the
  whole wheel; a closed wheel always rests on its ROOT ring and `items` stays
  the root array forever (drives read it while closed).
- **`Eldritch.init({ contextMenu: false })`** — the ENGINE CANVAS
  suppresses the native browser context menu wholesale; canvas-scoped, so a
  host document around an embedded stage keeps its own menu outside. The
  one-shot suppression from `preventDefault()` on a `rightclick` event works
  regardless. Default true (behavior unchanged).
- **The ground circle** (the page pattern) — every demo wires a radial
  context wheel to right-click on EMPTY scene: `engine.bus.on('pointerdown',
  (e) => { if (e.button !== 2 || e.target) return; ground.toggle(e.x, e.y); })`.
  a widget keeps its right-click by CONSUMING it
  (`preventDefault()`/`stopPropagation()` on the `rightclick`) — item menus,
  keybind capture, and the talent grid's refund all do; everything ELSE falls to
  the radial chain below. See COOKBOOK "A nested right-click wheel".

## The talent grid and the radial chain

- **The radial chain** — an UNCONSUMED `rightclick` walks `node.radialItems`
  providers from the hit up the parent chain: an ARRAY opens the engine-owned
  shared wheel with those items (each leaf may carry `onSelect(payload)`); a
  FUNCTION is asked per gesture with `{target, x, y, native}` and may return
  items, `null` (decline onward), or `false` (SEAL the chain — every modal
  scrim does); when nobody answers, the registered GROUND wheel opens.
  `new RadialMenu({ ground: true })` registers (last wins; dispose
  unregisters); `RadialMenu.setGround(menuOrFn | null)` is the per-gesture
  form (a fn returning null keeps a gesture silent — the strategy-hud
  partition). A right-click on a DISABLED widget falls back from its first
  ENABLED ancestor while the widget itself stays deaf (convention 3 holds). A
  fallback open arms the same one-shot native-menu suppression a
  `preventDefault()` would.
- **`RadialMenu` ** — mounts on the `radial` band (its own layer, above
  every overlay mount; an open wheel CLOSES when a modal presents); loud
  `open {x, y}` (the CLAMPED center) and `close {}` narrate every commit
  (`{silent}` gates only the voice); `RadialItem` gains per-leaf
  `onSelect(payload)` (the EldContextMenu per-entry precedent).
- **`SettingsPanel.selectTab`** — the pre-1.1 positional-boolean shim is GONE
  (nothing reaches for backwards compatibility); options-object
  only.

## Further widget contracts

- **`contentExtent(children, { preMeasure = true })`** — THE
  content-extent law, exported: the greatest `x + w` / `y + h` among children
  that layout measures (invisible and `fitExclude` chrome skipped; box children
  pre-measured). Window auto-size, `ScrollArea` auto-content, and `fitChildren`
  are ALL this one loop, so a declared size and the scroll range built from it
  can never disagree. Assert it against a widget's own `w`/`h` to pin that the
  widget declares what it paints — the pin that would have caught
  `CharacterPanel` declaring 470×500 around 440×334 for 132 releases.
- **A widget's declared size is a PROMISE about its paint**. Derive the
  declaration from the same constants `onLayout` uses; never freeze a parallel
  literal. Consumers inherit the lie otherwise: a window fitted to an
  over-declared widget opens on dead stone, and any shrink arms a scrollbar over
  nothing. The same rule points the other way for pages — content roots claim
  INK (a `VBox` root's `padding.b` is scroll range when a shrink cuts into it);
  the window frame supplies the breathing.
- **AUDIT `scrollbar` — the phantom-range face**. An armed range on a
  MEASURED `ScrollArea` must scroll TO something: if the overflow band paints no
  ink, the rule fires ("…scrolls to nothing"). `setContentSize` (`autoContent =
  false`) is the synthetic-range opt — `VirtualList`'s pooled rows own their
  fiction and are exempt by construction. Runs at rest on every audited page and
  on every resize-walker step.
- **`ModalWindow.userPlaced`** (tightened) — `true` once a REAL
  pointer CHANGED the box: a header drag that moved it, a resize that resized
  it. A press alone raises and claims nothing; programmatic `setPos`/`setRect`
  never claims; `EldWindow.restoreLayout` CLAIMS matched windows (a persisted
 layout is the user's placement — `serializeLayout` records the flag, older saves restore claimed). Page auto-layout skips a claimed box —
  the `!chat.userPlaced` re-park idiom on game-hud/strategy/survival/mud.
  `makeResizable` hosts carry the same flag from the grip's first real resize.
- **`Table({ sort: { column, ascending } })`** — boots the model
  ordered SILENTLY: no `sort` event, no ledger line (a loud boot sort would
  stamp wall-clock timestamps into frozen shots); header clicks toggle FROM
  the boot state. A non-integer `column` is refused whole. The order
  arrow is an OVERLAY (post): a 15px accent glyph
  right-anchored in the header cell — never a flow participant, so the label's
  position/width and the column's width are IDENTICAL sorted or not (the old
  12px inline speck both vanished at a glance and reserved column space).
- **`TreeTable`** — `rowactivate {row}` + `onActivate(row)` ride a real
  row-body click, geometry-resolved on the list; the scrollbar's own
  gestures never activate a row. `sort(key, dir, {silent = true})`
  follows the uniform contract by the rule — header clicks pass
  `{silent: false}`, so the gesture keeps its voice. The sorted column wears a
  13px arrow OVERLAY at the cell's right edge (post) — the
  LABEL never carries the order (the old ` ^`/` v` suffix was a 10px speck
  that also changed the label's measurement on every toggle). polish
: the expander is a real chevron (closed points, open drops),
  parent rows carry a child-count chip beside the name, and child rows wear a depth
  rail — the hierarchy explains itself; the 24×24 expander zone and the
  pooled-row census design are unchanged.
- **`NotificationCenter`** — `push`/`dismiss`/`markRead`/`markAllRead` all
  speak `{silent = true}`: loud pushes and dismissals commit
  `notechange {id, count, unread, action: 'push' | 'dismiss'}`, `markRead`
  commits `readchange {id, unread}`, `markAllRead` commits
  `readchange {id: null, unread: 0}` (restored the dead commit;
 gave the other verbs their voice).
- **`AmmoCounter`** — `ammochange` carries `action: 'fire' | 'set'`, and the
  reload landing's `reloaded` carries `action: 'reload'` (pinned).
- **The silent-setter ruling** — `LineChart/BarChart.setSeriesVisible`,
  `TreeTable.sort`, `DocumentViewer.setDocument`, and `SanityFX.set` default
  silent like every programmatic setter (their gesture paths stay loud with a
  voice); `NetMeter.setPing` stayed LOUD by design — once-per-band `quality`
  routing was the widget's purpose (`NetMeter` died with the gathering;
 `Minimap.setZoom` carries the loud-by-purpose precedent on).
- **`CreditsScroller`** — wheel-scrubbable; under `reducedMotion` the
  roll rests readable (`start()` no-ops) and scrubbing to the end takes the
  same `done` path. **`CompassStrip.setMarkers`** drops non-finite bearings
  with a once-per-key warn instead of vanishing them.

## The guildhall, the aim law, and the field clip

- **`PartyPanel`** (src/widgets/guildhall.js) — party UNIT frames over member
  data. Each row wraps a real `UnitFrame`; the panel owns the group chrome
  (one leader crown, role glyphs with tooltips, Dead across an emptied rail,
  Offline dimmed and refusing with the error voice, a selection ring,
  ready-check chips). Contract: `setMembers(list)` / `setMember(id, patch)` /
  `removeMember(id)` are silent model verbs over
  `{id, name, level, role: 'tank'|'healer'|'damage', leader, portrait, hp,
  hpMax, mp, mpMax, state: 'alive'|'dead'|'offline'}`; a click on a living or
  fallen row commits loud `target {id, index, member}` while offline rows
  refuse with the error voice; `setTarget(id, {silent})` is the programmatic
  form and returns false for unknown or offline members; the ready check is
  display over game truth (`beginReadyCheck()` pends every reachable member,
  `setReady(id, v)`, `clearReadyCheck()`, `readyState(id)` — the GAME clocks
  the answers); `addEffect(id, spec)`/`removeEffect`/`clearEffects` pass
  through to the row's buff strip and `effectclick` bubbles; duplicate and
  id-less members drop with a once-per-key warn; the panel and its chips are
  instance raster (zero atlas cost).
- **`HandFan` — THE AIM LAW** (attack cards "rarely work"): while
  a drag stands over the board (above the fan line, no occluding chrome), the
  fan aims at the NEAREST registered target by center distance from the
  pointer; `targetchange {card, onto, prev}` narrates every re-seat (onto null
  over the fan zone or over chrome), and the release commits `play {card,
  onto}` with the AIMED node — a release no longer needs to land inside the
  target's box. Pages that want per-card targeting set targets on `dragstart`
  (deckbuilder registers plates only for targeted Harm) and restore the
  standing set on `dragend`.
- **`ChatBox({echo})`** — `echo: false` keeps the widget's raw SAY echo out of
  the scrollback for voiced chats (the page renders each send in its channel
  voice off the `submit` event); the default `true` keeps the MUD/command
  form. **`Table` row tooltips** (rows with ≥4 cells) derive from column
  LABELS now instead of the 1.0 flagship's hardcoded column order.

## Rich text: markup, links, highlights

Any `TextNode` built with `markup: true` (and every widget surface that forwards the
opt-in: tooltip specs, EventLog messages, ChatBox scrollbacks, QuestTracker
objectives, toast bodies) parses these tags — nesting stacks, unknown tags render
literally, `{{` is a literal brace:

- `{color:#hex}…{/}`, `{b}…{/}`, `{i}…{/}`, `{icon:name}` — the set.
- **`{link:id}…{/}`** — a CLICKABLE run. Compile-tinted `COLORS.link` (an inner
  `{color:}` overrides; an outer one loses); icons inside a link click with it. Two
  same-id instances in one string stay distinct instances. On an INTERACTIVE
  TextNode the wiring is built in: hover raises an accent wash over the run's
  fragments (all lines of a wrapped link light together) plus the pointer cursor;
  press deepens the wash; press-and-release on the SAME instance dispatches a
  bubbling **`linkclick {id, text, x, y}`**, and crossings dispatch
  **`linkhover {id, text, over, x, y}`**. `text` is the instance's visible words
  (the `…` of an ellipsized link included) — key on `id`. Hit bands fill the full
  line advance, so wrapped links never flicker between lines; a disabled ancestor
  seals feedback and clicks alike. `linkAt(localX, localY)` is the raw hit test
  (node-local logical px). EventLog/ChatBox lines auto-wire when their messages
  carry links; a raw TextNode opts in with `interactive = true`. Links are
  POINTER-ONLY (keyboard traversal is catalogued), and as inline prose they stand
  outside the 24px floor by the STYLE §7 rule.
- **`{hl:#hex}…{/}`** — a HIGHLIGHT fill behind the run's glyphs. The color
  argument is REQUIRED — a bare `{hl}` renders literally (the forgiving-parser
  rule); the fill survives wrapping and sits beneath the text shadow.

The pinned scrollback: `EventLog.append` follows the tail ONLY when the view is
already at the bottom — a scrolled-up reading position is never yanked. `atBottom`
reads the predicate live; `scrollToBottom()` re-pins explicitly; ChatBox mirrors
both. This corrected a 1.14 defect (see the CHANGELOG migration note).

The wrapped scrollback: a logged message WRAPS at the log's
lane instead of ellipsizing — these boxes exist to show long text, so `EventLog`
(both modes), every `ChatBox`, and the `DebugConsole` show whole messages, hard
`\n` breaks included. Non-virtual entries are multiline nodes stacked by their
measured heights; the windowed mode flattens each entry to its wrapped visual
lines over the same fixed-height pooled rows, so ten thousand wrapped lines still
cost one screenful. A resize REWRAPS the whole history to the live lane (both
directions — a lane, not a ratchet), a `maxEntries` trim drops the oldest entry
with ALL its lines and compensates a scrolled-up reader by the real removed
extent, and the pin-to-bottom contract above is unchanged. Styled runs, inline
icons, and `{link:}` clickability all survive the wrap (a link broken across
lines stays clickable on every line).

## The input model (keyboard half)

Keys route to the interface only while its canvas (or the hidden text input) holds DOM
focus. `engine.focus` owns keyboard/gamepad focus; a verdigris ring marks key/gamepad
focus (pointer focus draws none). Focus never reaches what a pointer could not hit
(the occlusion predicate — nothing behind a popup scrim is keyboard-activatable).

- **Tab / Shift+Tab** — traverse focusable widgets in paint order.
- **Arrows** — move focus spatially between widgets; INSIDE a focused widget they act
  first: Slider steps (Home/End jump), Radio groups walk their members (selection
  follows focus), Select moves its selection, Tabs switches tabs, an open context menu
  walks its rows, PanZoomSurface pans. Container walks (Tabs Left/Right, SettingsPanel
  Up/Down) fire only when the CONTAINER itself is focused — arrows originating from a
  focused child inside the pane stay the child's.
- **Enter / Space** — activate: buttons click, toggles flip, selects open, text fields
  promote to editing (caret at the end), keybind fields arm, slots trigger.
- **Escape** — one surface per press, in order: open dropdown → context menu → popup
  (as cancel) → blur. Widgets that consume Escape for their own cancel (TextField,
  KeybindField capture) call `preventDefault()` so the stack does not also pop. A
  popup's PROMPT field is the exception: its Escape cancels the popup in the same
  press (one Escape dismisses a prompt popup).
- **Enter in a TextField** — dispatches `submit {value}` without blurring.

**Hotkeys ride `Eldritch.onKey(key, { down, up, repeat })`** — the one
sanctioned door;` in
`examples/`. It is focus-aware by construction: `down` fires while nothing holds
focus, and — since the 3.2.x review — also when a focused NON-text widget leaves
the key unconsumed, so one Tab press cannot deafen a page's whole keyboard;
typing into an editing field never leaks. `up` fires only for a key THIS
registration saw go down, so a release landing mid-typing still clears a hold
instead of stranding it (the underlying bus `keyup` is deliberately unscoped — a
release is a state reset). Key match is case-insensitive; auto-repeat is
suppressed unless `repeat: true`; the return value unsubscribes. **Never bind
`'Tab'`** — focus traversal consumes every Tab keydown before the bus emit, so a
Tab binding can never fire from a real keyboard (the engine warns,
flags it).

**Enter-to-chat** — the MMO convention, one line per page:
`Eldritch.onKey('Enter', { down: () => chat.focusInput() })`. A free Enter hands
the keyboard to the input bar (`ChatBox.focusInput()` / `TextField.focusEdit()`
put the field in its editing state, caret at the end); because the bus door only
opens while nothing holds focus, a focused control's Enter still activates that
control and a field mid-edit is never stolen from. Whether a SUBMIT hands the
keyboard back is the page's call: a chat does (`engine.setFocus(null)` in
`onSubmit` — send, and you are playing again), a MUD command line does not (the
next command follows the last).

The gamepad half mirrors this fully: d-pad/left stick dispatch the
matching arrow key through the FOCUSED WIDGET first — a menu walks its rows, a
slider nudges, a select steps, a rowFocus list steps its row — and only an
unconsumed direction moves focus spatially (the same widget-first shape B/Escape
has always used). A = activate, B = the Escape stack, bumpers cycle, right stick
scrolls — see README's behavior contract.

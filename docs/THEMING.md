# THEMING — tokens, seeds, strings

Everything visible derives from three token tables (`COLORS`, `FONTS`, `METRICS` in
`src/theme.js`) plus the seeded stone painters. Themes apply AT BOOT:
`Eldritch.init({ theme: { colors, fonts, metrics, seeds } })` — painters and widgets
read the tables during the texture bake, so a re-theme is always `destroy()` +
`init({theme})`. There is no live re-theme (catalog item).
`examples/theme-gallery.html`'s Cutting Room is the workshop: edit tokens, re-cut, copy the snippet.

## Does my token re-bake textures?

Every boot bakes everything, so the real question is which surface a token feeds:

| Token group | Examples | Feeds | Visible after |
|---|---|---|---|
| Stone palette | `stoneDark/Mid/Light/Hi`, `mossDark/moss/verdigris`, `voidBlack`, `inkParchment` | the art.js painters — frames, buttons, sockets, taskbar | the bake (init) |
| Accent + semantic | `accent`, `positive/negative`, `quest`, `rarity*`, `link` (inline `{link:}` runs) | painters AND live text/fills | the bake; live nodes read them at construction |
| Text colors | `text`, `textBright/Muted/Faint/Disabled`, `bone`, `textWhite` | TextNodes at construction | next construction (init rebuilds everything) |
| Fonts | `FONTS.header/body/mono` | every TextNode raster | the bake |
| Metrics | `slotSize`, `itemSlotSize`, `badgeInset`, `tooltipOffset`, `disabledDim` (the no-dedicated-art dim opacity), `textShadow` (the `{color,dx,dy,blur}` glyph shadow), … | layout at runtime | immediately after init |
| Interaction floors | `washHover` 0.15, `washPress` 0.25, `washFocus` 0.15 | hover/press/focus washes, read at EVENT time | immediately (never frozen into constants) |
| Spacing ladder | `space4/8/12/16` | gutters, gaps, padding | layout at runtime |
| Panel body | `panelFill` | the `panel.dark` painter | the bake (init) |
| Frozen metrics | `scrollbarW`, `windowHeaderH`, `dragThreshold`, `windowFrame` | read at module load / baked into art | NOT themable — `init({theme})` warns and ignores them |

The text tokens are LAW-bound since : every one clears 4.5:1 on `abyss1`
(`textFaint`/`textDisabled`/`textMuted` were retuned for it), and the brightness
hierarchy text > muted > faint > disabled is selftest-asserted — a preset that
re-tunes them must keep both properties or the test suite reddens. Raising a wash floor
is safe; lowering one below the shipped values breaks STYLE §4's floors.

## Seeds

All masonry is cut by a seeded generator (identical every load). `theme.seeds.offset`
(an integer) shifts every painter's seed — one number re-cuts all stone, including the
fx ambiance. The atlas viewer (`examples/debug-atlas.html`) has a scrubber to preview
offsets; the Cutting Room's slider on `theme-gallery.html` applies one live.

## Strings

Every user-facing string the library draws or logs routes through `Eldritch.strings`
: dialog chrome, widget defaults, event-log lines, tooltip lore chrome,
the split/discard flows. The full key catalog is `STRING_DEFAULTS` in `src/strings.js`;
templates carry `{0}`/`{1}` slots. Override any subset via `init({ strings })` — unknown
keys warn and are skipped, and `destroy()` restores the defaults. The COOKBOOK's
"Localize your game" chapter covers the workflow (plus `Intl` formatting, CJK font
stacks, and the RTL limitation).

## Custom icons and abilities

`Eldritch.registerIcon(name, painter)` and `Eldritch.registerAbility(id, {name, desc,
stats, flavor, painter})` persist across destroy/init and re-bake every boot — register
before constructing users of the id. `examples/icon-browser.html` is the reference;
painter conventions live in docs/EXTENDING.md.

The optional icon pack is the same door with art already drawn: `await
Eldritch.loadIcons({ base: '../assets/icons', icons: [{ id: 'ico-0001', as: 'rite_ember' }] })`
registers pack cells under names you choose, so every `icon.<id>` consumer — slots,
palettes, item grids, skill trees — takes them without knowing the difference. Pack
icons and hand-written painters coexist in one registry; a theme's painter overrides
still win for the ids they name. `examples/icon-browser.html` browses all 3,840 and
hands back the exact call. For bulk display (a grid of hundreds), `loadIconPack` is
the count-free path — it never touches the registry at all.

## Shipped presets

Presets are plain theme objects in importable modules — token sets, a seed offset,
and (optionally) painter overrides. Passing one to `init({ theme })` is the whole
integration; re-theming at runtime is `destroy()` + `init({ theme })`, the standing
policy.

| Preset | Module | Reads as | Painters |
|---|---|---|---|
| Verdigris (stock) | — (no theme option) | drowned-church stone and witchlight | — |
| Brass | `src/themes/brass.js` | warm tycoon metalwork, ledger-paper text | `select.arrow` (the stud) |
| Aether | `src/themes/aether.js` | clean sci-fi glass, coolant cyan | none — tokens alone re-skin |

`examples/theme-gallery.html` switches presets and uiScale live and prints the
token diff each preset applies.

## Authoring a preset (the walkthrough)

1. **Start from the diff, not the whole table.** Copy `src/themes/aether.js` and
   change only the tokens your material needs: the accent family, the text grays,
   the `abyss*` surfaces, the borders, and the stone palette. Anything you omit
   keeps the stock value (`applyTheme` is reset-first, so presets never bleed into
   each other across re-inits).
2. **Re-deal the stone.** `seeds: { offset: N }` re-rolls every crack and moss
   patch so your material does not carry the stock theme's exact weathering.
3. **Only then reach for painters.** Every procedural painter reads `COLORS` lazily
   at bake time, so the palette alone re-skins all of it. A `painters` entry
   replaces the ART of one registry name (`'select.arrow': (ctx, w, h) => {...}`);
   frames keep their slice metrics and dims — both are layout truth. A throwing
   painter warns and the stock bake stands (the registerIcon rule).
4. **Scale check.** Boot your preset at `uiScale: 1.5` and 2 in the gallery; the
   atlas re-bakes at DPR × uiScale, so anything you paint stays crisp — but
   hairline strokes (< 1px) can vanish at 1×; prefer 1.5px minimums.
5. **Colorblind sanity.** Do not let a hue pair carry meaning alone. The stock
   palette separates `positive`/`negative` by LUMA as well as hue (light mint vs
   mid red), rarity tiers step in brightness, and warn states also change SHAPE
   (BigTimer's tiers re-tint AND the readout stays numeric). Keep those properties:
   check your `positive`/`negative`/`quest` triple in a deuteranopia simulator, and
   keep text contrast ≥ 4.5:1 against `abyss1` (the common ground).

## uiScale (couch distance)

`init({ uiScale })` scales the whole interface at the CAMERA level: layout, hit
math, and every widget keep working in logical px (`css / uiScale`), the renderer's
pixel ratio carries the difference, and the atlas + text bake at DPR × uiScale so
nothing softens. Shipped steps: **1.0 / 1.25 / 1.5 / 2.0** (odd values snap with a
warning). Live change = `destroy()` + `init({ uiScale })`, same policy as theme.

The supported floor is **1280×720 logical px** (css ÷ uiScale):
`uiScale: 2` needs a ≥2560×1440 css window before the full HUD pages fit. Below the
floor the library keeps running but layouts degrade best-effort — panel overlap at
small logical sizes is out of scope, not a bug.

## Capture-safe hiding (photo mode)

`Eldritch.setHUDVisible(false, { except: [gridNode] })` hides every UI band —
windows, taskbar, toasts, tooltips, popups — while keeping the excepted nodes (a
framing grid, a watermark) visible; the vignette stays, being scene ambiance.
`setHUDVisible(true)` restores exact prior visibility. The COOKBOOK "photo mode"
recipe wires a rule-of-thirds grid.

# EXTENDING — subclasses, painters, 3D accents, types

## The UINode subclass contract

New widgets start from docs/EXTENDING.md. The load-bearing rules:

- Construct AFTER `Eldritch.init()` (textures resolve at construction). Size yourself
  in the constructor; take a `{ width, height }` style opts object.
- Position children in `onLayout()` (runs every layout pass) — never per-frame outside
  it or a tween. Keep positions integral. Derive content boxes from frame records with
  `contentRect(frame, w, h, pad)` — never hand-tuned border insets. Never `add()`,
  `remove()`, or `dispose()` tree nodes from inside `onLayout` — the layout walkers
  iterate live child arrays, so a mid-pass mutation silently skips a sibling for that
  frame; mutate from events or frame hooks instead.
- `interactive: true` to take hits; `focusable = true` to join Tab/spatial traversal;
  define `onActivate()` for Enter/Space/gamepad-A.
- Value widgets follow the uniform contract (docs/API.md): `.value`/`.checked` read
  fields, `setValue/setChecked(v, {silent})`, `setDisabled(v)`, `input` (continuous) vs
  `change` (committed) events. Programmatic setters are silent by default.
- Free everything in `disposeSelf()` (textures you created, frame hooks, registrations).
  `remove()` detaches and preserves; `dispose()` destroys. The engine calls
  `setFrameHook(null)` paths for you only if you wired them to the node.
- If your widget consumes Escape for its own cancel, `preventDefault()` — one Escape
  pops exactly one surface.
- Rastering your own canvas (a gauge arc, a thumbnail, a progress ring)? Bake it at
  the live density — `max(2, window.devicePixelRatio * engine.uiScale)` — drawing at
  that scale while laying out in logical px, or the art goes soft the moment a game
  boots at `uiScale` 1.5 or 2. The atlas and text rasters already follow this rule;
  the floor of 2 is what keeps stock 1× boots pixel-identical.
- Never name a subclass member after a `UINode` backing field. `visible` is a
  getter/setter over `_visible`, so an instance field or method named `_visible`
  shadows the base class and dies at first layout ("this._visible is not a
  function" — instance members beat prototype accessors). Grep node.js for its
  `this._…` names before adding underscore-prefixed members of your own.
- **The states walker will grade your widget** (`?torture=1` on every gated
 page): any node holding a `pointerenter` listener must show a VISIBLE hover
  delta, any node listening for `pointerdown`/`click` must show press, and
  release/leave must restore rest. Feedback below the `METRICS.washHover` /
  `washPress` floors doesn't count. A deliberately silent node DECLARES itself —
  `node.auditAllow('hover' | 'press' | 'restore')` with a design-reason comment
  (declarations are counted and capped); feedback rendered by a SIBLING names
  its home with `node.stateProxy = thatNode`. Resizable surfaces face the resize
  walker (`?resize=1`) the same way — `auditAllow('resize')` is its escape hatch.
- **Fully transparent meshes are CULLED from render**: a material at
  alpha ≤ 0.001 costs no draw call and paints nothing until a tween wakes it.
  If your subclass overrides `applyOpacity`, keep writing `material.opacity`
  (the base form is `material.opacity = baseOpacity * v`) — the cull reads it,
  and an "invisible" node that never drives material.opacity to 0 silently
  burns a draw call against the budget.

## Painter conventions (icons, plates)

`Eldritch.registerIcon(name, painter)` — `painter(ctx, w, h)` draws the full 64px icon:

- Start with `iconBase(ctx, w, h)` (the stone plate), bracket luminous strokes with
  `glow(ctx, color, blur)` / `noGlow(ctx)`.
- Painters must be DETERMINISTIC — no `Math.random()`, no time, and no images the
  page has not already loaded (the library itself requires zero assets). Seeded
  variation comes from the theme's `seeds.offset`, not from painters.
- The optional icon pack rides this same door: `Eldritch.loadIcons` fetches
  and decodes a sheet ONCE — keying its opaque black ground to alpha as it does —
  then hands `registerIcon` a painter that lays down `iconBase` and `drawImage`s the
  icon's 128px cell inside the plate's rim, out of that retained canvas. It is
  deterministic by the time it is registered and re-baked on every density change
  like any other painter. If you load images yourself, resolve them before
  registering; a painter that draws from a still-loading image bakes an empty plate.
  `fallback: 'glyph'` covers the missing-asset case with a legible letter plate,
  never the magenta unknown, and `fallback: 'none'` leaves whatever is already baked
  under that name standing — which is what makes the re-skin idiom degrade cleanly.
- `registerAbility(id, {...lore, painter})` adds tooltip lore and puts the id in
  `ABILITY_ICON_IDS`, so slots and palettes treat it as a built-in rite.
- A LORE-ONLY registration (no `painter`, no existing `icon.<id>` texture) still joins
  `ABILITY_ICON_IDS` by contract — anything iterating the list (an `IconPalette`, your
  own pickers) will draw the loud fallback plate for it. That is convention 7 working
  as designed, not a bug: give palette-visible ids a painter, or keep lore-only ids
  off the lists you iterate.
- Registrations persist across destroy/init and re-bake every boot. Register before
  constructing anything that uses the id — unknown ids render the loud magenta
  fallback plate (a defect to fix, never to ship).

`examples/icon-browser.html`'s "Your own sigils" rail is the working reference.

## Custom 3D accents

3D content lives inside an `Accent3DNode` — put lit, `transparent: true` meshes in its
`content` group. Never mark UI-scene materials opaque (three renders the opaque list
before every transparent quad — an opaque mesh sinks behind the whole interface), and
never set `renderOrder` on a `THREE.Group`. Accents are centerpieces: at most one per
screen region (STYLE §8). Note: raw accent meshes take no clipping planes — keep
accents out of scrolled content, or accept that they overdraw the clip edge (the
geometry audit exempts them knowingly).

## Types (`types/lovecraft-ui.d.ts`)

Hand-written declarations for the whole public entry ship with the library, kept
in lockstep with the export block. To get checked JS in a consumer
project, drop a `jsconfig.json` beside your pages:

```json
{
  "compilerOptions": {
    "checkJs": true,
    "moduleResolution": "bundler",
    "paths": { "*/src/lovecraft-ui.js": ["./types/lovecraft-ui.d.ts"] }
  },
  "include": ["**/*.js", "types/lovecraft-ui.d.ts"]
}
```

…and start files with `// @ts-check`. Editors that honor jsconfig will type imports
from `src/lovecraft-ui.js` against the declarations.

## Bundling (optional — the library is build-free)

The vendored folder needs no build. If a consumer project wants one file anyway, the
documented one-liner (no npm install in THIS repo; run it from the consumer side):

```
esbuild src/lovecraft-ui.js --bundle --format=esm --external:three --outfile=lovecraft-ui.bundle.js
```

# STYLE — the game-feel law

Everything visible in this library must read as part of a game, not as business software.
Business UI informs; game UI performs. These rules are binding for any visual work; the
checklist in section 10 is the release check for anything that touches visuals.

## 1. The distinction, mechanically

If you built the thing in the left column, replace it with the right column before finishing:

| If you built this | Replace with this |
|---|---|
| A flat colored rectangle as a panel | A `NineSliceNode` stone frame from the registry |
| A label:input grid of form rows | A framed window with grouped, breathing rows |
| A value that snaps to its new number | A 0.3s tween (`ProgressBar.setValue` idiom) |
| A column of text-only buttons | `IconButton`s or slots with tooltips |
| Default-blue links / plain underlined text | Verdigris accent on carved stone |
| A dense 16px-row data list | Chunky rows ≥ 26px with hover washes |
| A native-looking scrollbar or dropdown | The stone `ScrollArea` / `Select` (already built) |

## 1a. The scene law — binding on every page in `examples/`

> **A showcase page is a screen from a real game, mid-play.** It has a world behind it, a
> loop in front of it that runs without being poked, and no control a player would not
> have. Every region of the frame is either carrying information or is deliberately
> composed negative space.

This exists because the showcase was audited and failed as a set, in one uniform
way: the pages had been written by enumerating the API instead of designing a screen. The
four tests below are what that audit actually caught. Apply them before a page is done:

1. **Is there a world behind the interface?** A game HUD is judged against what it sits
   over. Black is not a world. Paint one into a page-owned `THREE.CanvasTexture` on a
   `QuadNode` (`examples/strategy-hud.html`, `deckbuilder.html`, `shooter-hud.html`) —
   registry-free by construction, so the atlas budget never moves however much you paint.
   A scatter of dots is a placeholder, not a world.
2. **Would a player have this control?** A button that exists to make the library do
   something is a test fixture wearing a costume. "Pretend Gamepad", *Fire / Reload /
   Sight* buttons in a first-person HUD, a "Wheel" button for a radial menu, *Simulate
   Combat*, *Omen Arrives* — all shipped, all removed. Drive the feature the way the
   genre drives it, and let effects fire from the events that would really cause them.
3. **Does it run on its own, and does it mean anything?** A loop that only advances when
   clicked is a demo of a click. A loop that advances randomly with no consequence is
   noise. Prefer a state the player can move toward and reach.
4. **Is the frame composed?** Measure the empty area. Section 8 blesses dark space as part
   of the look, and it is — but a page whose middle 60% is nothing while every widget
   hugs a corner has not been composed, it has been dumped. Negative space is a decision
   you can defend, not what is left over.

And do not narrate the API to the player: a label reading `Stamina — ArcGauge (thresholds
re-tint the sweep)` is documentation in a costume. The widget a thing happens to be
belongs in `docs/GALLERY.md` and the page's `@shows` header.

### 1a.1 A label names the FUNCTION. Fiction seasons it; fiction never replaces it.

**This rule is here because the sentence it replaces caused real damage.** It used to read
"name the thing in the fiction", full stop — and that produced *The Ways Known* for a
travel list, *Coin-Op Shrine* for a level select, *The Fallen* for credits, *Friends of
the L…* truncated to nothing, and a skill tree whose three views were *The Binder's Wall*,
*The Ages* and *The Unbound Chart*. The review's verdict on the result was exact:

> "most of these dialogs (titles, content, etc) are incomprehensible gibberish, with
> buttons that often don't work, without labels that make sense, and without any seeming
> function. Make sure they all have an actual useful function which is self-evident in
> their labels and purpose (you know, like literally every interface that exists?)"

Atmosphere had taken the slot the function name belongs in. So:

**The test.** Could someone who has never seen this game tell, from the screen alone,
what this control does and what state it is in? If answering needs the source, the page
is not done.

- `Stamina` is right. `The Long Vigil` on a settings toggle is not.
- A window titled *The Ways Known* holding a list you cannot click is two defects: the
  title hides what the panel is, and the list has no function. It is a **Travel** list,
  and clicking a row travels.
- Flavour lives in subtitles, item names, prose, and theming — beside the functional
  label, never instead of it. `Credits` may carry the subtitle *The Fallen*.
- **Never truncate a label to the point of meaninglessness.** `Friends of the L…` is not
  a name; size the container to the word, or shorten the word.

**And every control must DO something observable.** A button whose click produces nothing
a player can see is worse than no button: it teaches that the interface is broken. Give it
a real function or remove it. A control that is deliberately inert must say why — the
`disabled` + `reason` contract exists for exactly this.

**Instrument protocol for any page with a clock.** Park the sim under every instrument that
reads the page — `?freeze=1`, `?assert=1`, `?audit=1`, `?torture=1`, `?resize=1`. A frozen
shot cannot settle while something moves, the states walker samples instantly and a drifting
node races its own hover/press pair, and the audit census reads a different overlap set
every run. The suite then drives the page's verbs itself with fixed numbers, which is
stronger evidence than watching a random tick anyway.

## 2. Containers are stone. Always.

Every visible container is a `NineSliceNode` with a registry frame: `window.frame`,
`button.*`, `field.*`, `dropdown.frame`, `tooltip.frame`, `panel.dark`, `taskbar.item`.
Bare `QuadNode` color fills are legal in exactly four roles: fills INSIDE a frame (bar
fills, selection highlights), 1-2px rules/dividers, full-screen scrims, and hover washes.
A new panel style means a new painter registered in art.js — never an unframed rect.

## 3. Typography recipes

- Headers, titles, buttons: `FONTS.header`, `smallCaps: true`, `letterSpacing: 1` (2 for
  window titles), color `COLORS.accent` — or `COLORS.bone` where green would overwhelm.
  Sizes 13-15.
- Body: `FONTS.body` 13-14 in `COLORS.text`; secondary text `textMuted`; timestamps and
  tertiary labels `textFaint`; disabled `textDisabled`.
- Numbers that update every frame or tick (logs, counters, cooldowns, values): `FONTS.mono`.
- Any text drawn over art carries the house shadow: `METRICS.textShadow`
  (`{ color: 'rgba(0,0,0,0.85)', dx: 1, dy: 1, blur: 2 }` — the shared token ).
- Never: browser-default sizing, unspaced ALL-CAPS sans headers, pure `#fff` body text.

## 4. Mandatory interaction juice — with FLOORS

Every clickable has all four states, no exceptions, and each state must be VISIBLY
distinct in a 1280×760 screenshot (docs/STYLE.md is the review mechanism):

1. **Hover** — a `.hover` art variant (frame/texture SWAP) where one exists, else a
   wash at `METRICS.washHover` (0.15) or stronger, else `fxScale` to 1.1 over 0.1s
   (the IconButton idiom). **A multiply-tint on dark art is BANNED as the sole hover**
   (the minimap-± defect: tinting a dark texture darker reads as nothing).
2. **Press** — the `.pressed` art plus a 2px label press-offset (Button's `onLayout`
   idiom), or a wash at `METRICS.washPress` (0.25) or stronger, or `fxScale` 0.95.
   Hover-only clickables are a defect: press must read differently than hover.
3. **Disabled** — dedicated `.disabled`/grayscale art where it exists plus `textDisabled`
   text, and true inertness via `setDisabled` (input-layer enforced). Opacity alone is not
   a disabled state.
4. **Release** — a return tween, never a snap.

Focus washes ride `METRICS.washFocus`. Wash levels are read from METRICS at event time
(themable; never frozen into module constants — the S43 painter rule generalized).

Displayed values always tween (0.3s, the `setHealth`/`ProgressBar` idiom). Assigning a
displayed value directly is a defect, not a shortcut.

## 5. Color-token discipline

`COLORS.*` only in widget code. Accent is scarce by
design: titles, the selected state, focus, currency. If more than roughly a tenth of a
screen glows verdigris, the screen is wrong. Semantic tokens mean their semantics —
`positive/negative`, `quest`, `rarity*` — never decoration. Surfaces come from
`panel/panelDeep/panelDeeper` and the stone tokens.

## 6. Iconography first

If an icon id exists for a concept, show the icon: ability ids live in `ABILITY_ICON_IDS`,
chrome icons in the `ui.*` family (grep art-icons.js). Icon-only controls always get
`EldTooltip.attach` with a real title and description. A row of text-only action buttons is
a design smell. Never type an icon id you did not grep — unknown ids render the magenta
fallback plate, which is a defect on screen.

## 7. Chunky hit targets — and readable text (floors)

Games are played with thumbs, controllers, and haste. Minimums: interactive nodes 24x24;
buttons 38 tall (the Button default); list/menu rows 26 (the Select idiom); slots per
`METRICS` (48 action / 44 equipment). Spacing snaps to the ladder —
`METRICS.space4/8/12/16`: at least `space8` inside a frame, at least `space16` between
groups. **Text contrast floors (audit-enforced):** every text run ≥ 4.5:1 against what
actually paints beneath it (3:1 at ≥ 18px or bold) — except text sealed inside a
`disabled` subtree, which is exempt per WCAG 1.4.3's inactive-component rule:
a dead face's dimness IS its information, and demanding legibility of it is how dead
controls came to look alive. The text tokens all clear 4.5:1 on
abyss1 by construction (retune); putting a token on a LIGHTER surface (gauge
faces, stone lips) is where the floor still bites — pick a brighter token or darken the
surface. Web-style text links (blue, underlined) are banned; inline clickable
runs (the `{link:}` markup) are the one sanctioned text interaction: they rest in `COLORS.link`, hover raises an accent wash plus the pointer
cursor, press deepens the wash, their hit bands fill the full line advance, and as
inline prose they stand outside the 24px floor (the text genre's nature, documented).
When spacing is in doubt, measure demo.html and copy it.

## 8. Atmosphere

Demo and example pages keep `background` and `vignette` on (HUD-embed pages excepted).
Emphasis comes from `accentGlow`/`accentFaint` washes, not hard bright borders. An
`Accent3DNode` piece (orb-class) is a centerpiece — at most one per screen region. Dark
empty space is part of the look; do not fill it with chrome.

## 9. Motion restraint

Juice is fast and small: 0.1s for state changes, 0.3s for value changes — the two house
durations. Nothing idles or loops except the shipped ambiance (fog, spores, orbs). Never
move nodes per-frame outside `onLayout` or tweens.

## 10. The game-feel checklist

SUPERSEDED for review mechanics by **docs/STYLE.md**: visual work is
now MEASURED first (`?audit=1` ratchets in the page manifest) and reviewed against shot
pairs at two window sizes — self-attested eyeballing is no longer a valid gate step.
Point 3 below is additionally MACHINE-ENFORCED since /: the states walker
(`?torture=1`) drives every hover-reactive node and demands visible hover AND press,
and the resize walker (`?resize=1`) drives every resizable surface — a deliberately
silent interactive node must declare `auditAllow('hover' | 'press' | 'restore' |
'resize')` with a design-reason comment. The ten points below remain the design law
the protocol checks against (rewrites them with measurable floors); walk
the shot-review checklist instead.

```
1. Every visible container sits in a stone NineSlice frame (no naked rects)?
2. Headers are spaced small-caps serif in accent/bone?
3. Every clickable visibly reacts to hover AND press?
4. Every changing value tweens (no snaps)?
5. Zero raw hex in new widget code (COLORS tokens only)?
6. Icons used wherever an id exists; tooltips on every icon-only control?
7. Smallest hit target >= 24px; rows >= 26px?
8. Text over art carries the house shadow?
9. Does a screenshot of it read as a screen from a game (section 1a), not a
   settings form or a widget catalog?
10. Side-by-side: the test suite -Shot <your page> vs -Shot strategy-hud.html —
    same stone, same accent economy, same density, a real world behind both?
```

**The exemplar moved, and the reason matters.** Points 9-10 used to read "part of
demo.html" and "vs -Shot demo.html". demo.html is the complete widget reference — a
legitimate artifact, but a CATALOGUE, laid out by class name down a scrolling column. Every
page measured against it inherited that shape, which is precisely the fault the audit
found across the whole showcase. The bar is now a composed genre screen. If you are building
a widget catalogue on purpose, demo.html is still the right sibling to copy; for anything
else, copy a flagship.

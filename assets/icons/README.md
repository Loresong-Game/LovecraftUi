# The icon pack — 3,840 icons on 60 atlas sheets

Original Dark-Fantasy-Horror RPG icon art for use with LovecraftUI (and anything
else): every sheet is a 1024×1024 PNG holding an exact **8×8 grid of 128×128
cells**, row-major from the top-left. Backgrounds are opaque black by contract —
the tiles read as framed dark plates on the LovecraftUI theme. `manifest.json` is
the source of truth: 3,840 records of `{icon_id, slug, name, type, category,
tags, sheet, cell{row, column}}`.

Two ways in (both documented in `docs/API.md`):

```js
// 1. Register a curated set into the normal icon pipeline — every consumer
//    (slots, palettes, item grids, skill trees) works unchanged:
await Eldritch.loadIcons({ base: '../assets/icons', icons: ['ember-lance', 'drowned-idol'] });

// 2. Bulk-browse the whole pack count-free (one GPU upload per sheet):
const pack = await Eldritch.loadIconPack({ base: '../assets/icons' });
const view = pack.view('ico-0001'); // a THREE.Texture windowed onto one cell
```

`examples/icon-browser.html` is the searchable vault over the full set.
Distributed under the same MIT terms as the library (© 2026 LovecraftUI Authors).

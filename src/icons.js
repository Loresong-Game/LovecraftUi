// The icon pack loader: an OPTIONAL asset layer over the procedural
// pipeline. The pack is 60 pre-built atlas sheets (1024x1024, an 8x8 grid of
// 128px cells) plus a manifest of 3,840 records ({icon_id, slug, name, type,
// category, tags, cell{row, column}}).
//
// Two paths:
//  - loadIcons: registers a CURATED set through the existing registerIcon
//    machinery, so every consumer that resolves `icon.<id>` works unchanged and
//    persistence/density re-bakes are inherited. Pass `as:` an ALREADY-BAKED
//    icon id to RE-SKIN it in place: the registry re-bakes that one name, every
//    live quad picks the new art up on its own, and the atlas count never moves.
//    That is how the demo pages adopt the pack - no swap code, no re-mounting.
//  - loadIconPack: bulk access for browsers and tools - one texture per sheet
//    and per-icon views via texture.clone() + offset/repeat (clones share
//    .source in three r163+, so each sheet uploads once and disposing a clone
//    only decrements the shared source's refcount).
//
// THE BLACK KEY. The sheets ship with opaque black backgrounds (the manifest's
// raster contract reads `allow_alpha: false`). Drawn as they ship, every icon is
// a black square covering the carved stone beneath it. So the decode keys black
// to alpha ONCE per sheet: alpha = max(r,g,b), then the colour is
// un-premultiplied (r * 255 / a) so compositing over black reproduces the source
// EXACTLY while compositing over the house plate lets the stone read through.
// Both paths read the same keyed canvas, so both are fixed at one point.
//
// LIFETIMES, and who owns what. Decoded CANVASES are cached at module level
// (LRU-bounded by MAX_CACHED_SHEETS) and hold no GPU resource, so they survive
// destroy/init and a re-boot re-bakes registry icons SYNCHRONOUSLY. Sheet
// TEXTURES belong to the pack that minted them - never to the module - so
// ownership is never ambiguous: `pack.dispose()` and `pack.trim()` free exactly
// what that pack made, and `disposeIconCache()` (called by Eldritch.destroy)
// drains every live pack so no GL handle outlives the engine that made it.

import * as THREE from 'three';
import { createCanvasTexture } from './texgen.js';
import { iconBase } from './art-icons.js';

const CELLS = 8;               // cells per axis
const CELL_PX = 128;           // source cell size
const MAX_CACHED_SHEETS = 12;  // ~48MB of decoded canvas; sheets re-decode on demand

// The house plate reads around the art (every procedural icon paints inside
// iconBase's rim). 6/64 of the icon box per side seats pack art in that plate.
const ART_INSET = 3 / 64; // pack art fills 90.6%% of the icon plate (was 81.25%% — the stacked-rim shrink)

const _manifests = new Map();  // url -> Promise<Index>
const _sheets = new Map();     // url -> Promise<{canvas, ctx}>; insertion order IS the LRU
const _livePacks = new Set();  // packs holding GPU handles (Eldritch.destroy drains it)

// Delivery rides the two loaders every page already proves out: the MODULE
// pipeline for the index (assets/icons/manifest.mjs, generated from
// manifest.json by the icon manifest generator) and the IMAGE pipeline for sheet pixels.
// Both retry and prioritize like the rest of the page; fetch() streams of large
// bodies proved flaky against simple static servers and are not used here.
function manifestUrl(base) { return new URL(`${String(base).replace(/\/+$/, '')}/manifest.mjs`, document.baseURI).href; }
function sheetUrl(base, sheetId) { return new URL(`${String(base).replace(/\/+$/, '')}/${sheetId}.png`, document.baseURI).href; }

// ---- the manifest index: byKey resolves icon_id AND slug ----
function loadIndex(base) {
  const url = manifestUrl(base);
  if (_manifests.has(url)) return _manifests.get(url);
  const p = import(url)
    .then((mod) => mod.default)
    .then((m) => {
      const byKey = new Map();
      const list = [];
      const sheets = [];
      const categories = new Set();
      for (const sheet of m.sheets ?? []) {
        sheets.push({ id: sheet.sheet_id, slug: sheet.slug, title: sheet.title, category: sheet.category });
        for (const ic of sheet.icons ?? []) {
          const rec = {
            id: ic.icon_id, slug: ic.slug, name: ic.name, type: ic.type,
            category: ic.category, tags: ic.tags ?? [],
            sheet: sheet.sheet_id, sheetSlug: sheet.slug, sheetTitle: sheet.title,
            row: ic.cell?.row ?? 0, col: ic.cell?.column ?? 0,
          };
          byKey.set(rec.id, rec);
          byKey.set(rec.slug, rec);
          list.push(rec);
          categories.add(rec.category);
        }
      }
      return { byKey, list, sheets, categories: [...categories].sort() };
    });
  _manifests.set(url, p);
  p.catch(() => _manifests.delete(url)); // a failed fetch may be retried
  return p;
}

// ---- the black key: opaque-black backgrounds become real cutouts ----
// A cross-origin sheet taints the canvas and getImageData throws; that degrades
// to the unkeyed art with a warning rather than failing the whole load.
function keyBlackToAlpha(ctx, w, h, url) {
  let img;
  try { img = ctx.getImageData(0, 0, w, h); } catch (err) {
    console.warn(`LovecraftUI icons: ${url} could not be keyed (${err.message}); the art keeps its opaque background.`);
    return false;
  }
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const a = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (a === 0) { px[i + 3] = 0; continue; }
    const k = 255 / a;
    px[i] = r * k;
    px[i + 1] = g * k;
    px[i + 2] = b * k;
    px[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

// ---- sheet pixels: decoded once per url, cached as a canvas (LRU-bounded) ----
function loadSheet(url, keyBlack = true) {
  const hit = _sheets.get(url);
  if (hit) { _sheets.delete(url); _sheets.set(url, hit); return hit; } // LRU touch
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  }).then((img) => {
    // texgen owns canvas creation (the no-DOM-in-src rule), so the decode borrows
    // its factory for the canvas and drops the texture it also mints - sheet
    // textures belong to packs, never to this cache.
    const art = createCanvasTexture(img.naturalWidth, img.naturalHeight, 1);
    art.texture.dispose();
    art.ctx.drawImage(img, 0, 0);
    if (keyBlack) keyBlackToAlpha(art.ctx, img.naturalWidth, img.naturalHeight, url);
    return { canvas: art.canvas, ctx: art.ctx };
  });
  _sheets.set(url, p);
  p.catch(() => _sheets.delete(url));
  trimSheetCache();
  return p;
}

// Evict the least recently used canvases past the cap; they re-decode on demand.
// Nothing GPU-side is involved - a pack that already minted a texture from an
// evicted canvas keeps rendering, because the texture holds the canvas alive.
function trimSheetCache() {
  while (_sheets.size > MAX_CACHED_SHEETS) {
    _sheets.delete(_sheets.keys().next().value);
  }
}

// One texture per sheet PER PACK, minted from the cached canvas.
function sheetTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.anisotropy = 1;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Teardown hook (Eldritch.destroy): no GL handle may outlive its engine. The
// decoded canvases stay, so the next init re-bakes registry icons synchronously.
export function disposeIconCache() {
  for (const pack of [..._livePacks]) pack.dispose();
}

// the graceful degrade: a legible initial on the house plate, never magenta
function glyphPainter(label) {
  const ch = String(label ?? '?').replace(/[^a-z0-9]/gi, '').charAt(0).toUpperCase() || '?';
  return (ctx, w, h) => {
    iconBase(ctx, w, h);
    ctx.fillStyle = '#8fe8a8';
    ctx.font = `bold ${Math.round(h * 0.44)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, w / 2, h / 2 + 1);
  };
}

// The pack painter: the house plate, then the keyed art seated inside its rim -
// the silhouette every procedural icon has, with painted art in the well.
function cellPainter(canvas, rec) {
  const sx = rec.col * CELL_PX;
  const sy = rec.row * CELL_PX;
  return (ctx, w, h) => {
    iconBase(ctx, w, h);
    const ix = Math.round(w * ART_INSET);
    const iy = Math.round(h * ART_INSET);
    ctx.drawImage(canvas, sx, sy, CELL_PX, CELL_PX, ix, iy, w - ix * 2, h - iy * 2);
  };
}

// ---- the curated path: bake requested icons into the registry ----
// opts: { base = 'assets/icons', icons = [id|slug|{id, as}], sheets = [sheetIds],
//         fallback = 'glyph'|'none', keyBlack = true, _register (wired by Eldritch) }
export async function loadIcons(opts = {}) {
  const base = opts.base ?? 'assets/icons';
  const keyBlack = opts.keyBlack !== false;
  const register = opts._register;
  const registered = [];
  const missing = [];
  let index = null;
  try {
    index = await loadIndex(base);
  } catch (err) {
    console.warn(`LovecraftUI icons: the manifest at ${manifestUrl(base)} did not load (${err.message}).`);
  }

  const wants = [];
  for (const spec of opts.icons ?? []) {
    const key = typeof spec === 'string' ? spec : spec?.id;
    const as = typeof spec === 'object' && spec?.as ? String(spec.as) : null;
    const rec = index?.byKey.get(String(key)) ?? null;
    wants.push({ key: String(key), as, rec });
  }
  for (const sheetId of opts.sheets ?? []) {
    for (const rec of index?.list.filter((r) => r.sheet === sheetId) ?? []) {
      wants.push({ key: rec.slug, as: null, rec });
    }
  }

  // fetch only the sheets the wants actually touch
  const needed = [...new Set(wants.filter((w) => w.rec).map((w) => w.rec.sheet))];
  const canvases = new Map();
  await Promise.all(needed.map(async (sheetId) => {
    try { canvases.set(sheetId, (await loadSheet(sheetUrl(base, sheetId), keyBlack)).canvas); }
    catch (err) { console.warn(`LovecraftUI icons: sheet ${sheetId} did not load (${err.message}).`); }
  }));

  for (const w of wants) {
    const name = w.as ?? w.rec?.slug ?? w.key;
    const canvas = w.rec ? canvases.get(w.rec.sheet) : null;
    if (w.rec && canvas) {
      register(name, cellPainter(canvas, w.rec));
      registered.push(name);
    } else {
      missing.push(w.key);
      // 'none' leaves whatever is already baked under that name standing - the
      // re-skin path's correct degrade, because the procedural art is the floor
      if ((opts.fallback ?? 'glyph') === 'glyph') {
        register(name, glyphPainter(w.rec?.name ?? name));
        registered.push(name);
      }
    }
  }
  return { registered, missing };
}

// ---- the bulk path: count-free sheet textures + per-icon views ----
export async function loadIconPack(opts = {}) {
  const base = opts.base ?? 'assets/icons';
  const keyBlack = opts.keyBlack !== false;
  const index = await loadIndex(base); // throws on a missing manifest: a browser NEEDS it
  const textures = new Map(); // sheetId -> THREE.Texture
  const views = [];

  const pack = {
    list: index.list,
    sheets: index.sheets,
    categories: index.categories,
    get(idOrSlug) { return index.byKey.get(String(idOrSlug)) ?? null; },
    find({ category = null, sheet = null, text = null } = {}) {
      const q = text ? String(text).toLowerCase() : null;
      return index.list.filter((r) =>
        (!category || r.category === category)
        && (!sheet || r.sheet === sheet)
        && (!q || r.slug.includes(q) || r.name.toLowerCase().includes(q)
          || r.type.includes(q) || r.tags.some((t) => t.includes(q))));
    },
    // decode sheets (deduped); resolves when their textures are usable
    async ensure(sheetIds) {
      await Promise.all([...new Set(sheetIds)].map(async (id) => {
        if (textures.has(id)) return;
        const sheet = await loadSheet(sheetUrl(base, id), keyBlack);
        if (!textures.has(id)) textures.set(id, sheetTexture(sheet.canvas));
      }));
    },
    texture(sheetId) { return textures.get(sheetId) ?? null; },
    // A THREE.Texture windowed onto one cell - clone shares .source (one upload
    // per sheet). The window is inset HALF A SOURCE TEXEL so a bilinear sample at
    // the window edge can never reach into the neighbouring cell.
    view(idOrSlug) {
      const rec = index.byKey.get(String(idOrSlug));
      const sheetTex = rec ? textures.get(rec.sheet) : null;
      if (!rec || !sheetTex) return null;
      const px = sheetTex.image?.width || CELLS * CELL_PX;
      const e = 0.5 / px;
      const v = sheetTex.clone();
      v.repeat.set(1 / CELLS - e * 2, 1 / CELLS - e * 2);
      v.offset.set(rec.col / CELLS + e, (CELLS - 1 - rec.row) / CELLS + e);
      v.needsUpdate = true;
      views.push(v);
      return v;
    },
    // Release every sheet outside `keep` - the browser's memory verb, so walking
    // all sixty shelves never accumulates sixty uploads. Views into a released
    // sheet keep its shared source alive until the consumer disposes them (a
    // pooled grid does that on every rebind), so this is safe by construction.
    trim(keep) {
      const hold = new Set(keep ?? []);
      for (const [id, tex] of [...textures]) {
        if (hold.has(id)) continue;
        tex.dispose();
        textures.delete(id);
      }
      return this;
    },
    stats() { return { sheetsLoaded: textures.size, views: views.length }; },
    dispose() {
      for (const v of views) v.dispose();
      views.length = 0;
      for (const tex of textures.values()) tex.dispose();
      textures.clear();
      _livePacks.delete(pack);
    },
  };
  _livePacks.add(pack);
  return pack;
}

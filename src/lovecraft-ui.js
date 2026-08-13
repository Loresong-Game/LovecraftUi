// LovecraftUI — public entry point. Import this one module.
//
//   import { Eldritch, EldWindow, EldPopup, ... } from './src/lovecraft-ui.js';
//   Eldritch.init();               // boots renderer, art, and every system
//   EldWindow.create({ title: 'Reliquary', width: 350, height: 300 });
//
// One namespace per system: Eldritch (boot), EldWindow, EldPopup, EldDragDrop,
// EldTooltip, EldEvents - each documented in docs/API.md.

import { EldritchEngine } from './engine.js';
import { generateCoreArt } from './art.js';
import { generateIconArt, ABILITY_ICON_IDS } from './art-icons.js';
import {
  bindWidgets, resetWidgets, Button, IconButton, TextField, Toggle, ToggleLabel, Radio, RadioLabel,
  Slider, Select, ProgressBar, EldTooltip, ABILITY_DATA, abilityData, formatIconName,
  ITEM_DATA, registerItemData, itemData, rarityColor,
} from './widgets/widgets.js';
import { resetFocusCounter, LAYER_ORDER } from './layers.js';
import { Window, ModalWindow, EldWindow, EldPopup, Taskbar } from './widgets/windows.js';
import { EldDragDrop, DraggableIcon, ActionSlot, CpSlot, IconPalette, ActionbarLock, ActionBar } from './widgets/dragdrop.js';
import {
  EventLog, Table, UnitFrame, EffectBar, Minimap, QuestTracker, CharacterPanel, SettingsPanel, Globe, CastBar,
  DialogPanel,
} from './widgets/components.js';
import { VirtualList } from './widgets/virtual.js';
import { PanZoomSurface } from './widgets/panzoom.js';
import { EldContextMenu } from './widgets/menu.js';
import { Tabs } from './widgets/tabs.js';
import { KeybindField } from './widgets/keybind.js';
import { NumberField } from './widgets/numberfield.js';
import { FloatText } from './widgets/floattext.js';
import { EldToast } from './widgets/toast.js';
import { EldNotify } from './widgets/notify.js';
import { ChatBox } from './widgets/chatbox.js';
import { ResizeGrip, makeResizable } from './widgets/grip.js';
import { FormRow, Form } from './widgets/form.js';
import { LoadingVeil } from './widgets/loadingveil.js';
import { ItemGrid, ItemSlot } from './widgets/itemgrid.js';
import { EldEvents } from './widgets/events.js';
import { initBackground, initVignette, makeOrbMesh } from './fx.js';
import { initDebug, DebugInspector } from './debug.js';
import { runAudit, initAudit, AUDIT_RULES } from './audit.js';
import { runStateTorture, initTorture, runResizeTorture, initResizeTorture } from './torture.js';
import { hitTest } from './hit.js';
import { loadIcons, loadIconPack, disposeIconCache } from './icons.js';
import { DebugConsole } from './widgets/debugconsole.js';
import { TalentTree, TalentPanes, resetTalentWarnings } from './widgets/talents.js';
import { SelectionMarquee, CommandCard, BuildQueue, TacticalMap } from './widgets/wartable.js';
import { RecipeBrowser, ProcessPanel, CompassStrip, DayDial } from './widgets/longwinter.js';
import { BodyDoll, EquipmentRack, resetStonesWarnings } from './widgets/speakingstones.js';
import { LetterboxBars, TypewriterText, ChoiceList, Journal, DocumentViewer, SubtitleBar, SanityFX } from './widgets/narrative.js';
import { RadialMenu, BossBar, initRadialFallback } from './widgets/lanternbearer.js';
import { Card, HandFan, Pile, RunMap, CARD_SIZES } from './widgets/drawnhand.js';
import { Reticle, HitMarker, AmmoCounter, DamageIndicator, Killfeed } from './widgets/ironsights.js';
import { PartyPanel } from './widgets/guildhall.js';
import { LineChart, BarChart, TreeTable, NotificationCenter } from './widgets/countinghouse.js';
import { ScoreTally } from './widgets/coda.js';
import { GamepadNav } from './input-gamepad.js';
import { UINode } from './node.js';
import { QuadNode, NineSliceNode, Accent3DNode } from './primitives.js';
import { TextNode, measureText, compileMarkup, setIconSource, resetTextCaches, setTextScale } from './text.js';
import { ScrollArea } from './clip.js';
import { COLORS, FONTS, METRICS, socketInset, socketInsetRaw, applyTheme, resetTheme } from './theme.js';
import { setSeedOffset, setTexScale } from './texgen.js';
import { iconBase, glow, noGlow } from './art-icons.js';
import { row, column, grid, anchor, clamp, fitChildren, contentRect, contentExtent } from './layout.js';
import { VBox, HBox, GridBox, Stack, Spacer, Divider } from './layoutbox.js';
import { Easing } from './anim.js';
import { STRINGS, str, applyStrings, resetStrings } from './strings.js';
import { animateIn, animateOut, stagger, setReducedMotion, isReducedMotion } from './animate.js';
import { Store, bind, bindText, bindEnabled } from './store.js';
import { DevPanel } from './widgets/devpanel.js';
import {
  SegmentedBar, ArcGauge, Badge, attachBadge, ResourceChip, ResourceBar,
  BigTimer, StarRating, SegmentedControl, SpeedControl,
} from './widgets/meters.js';
import {
  MenuList, MenuScreen, TitleCard, SaveSlotList, LevelSelectGrid, CreditsScroller,
} from './widgets/metascreens.js';
import { Spotlight, Coachmark, TutorialSequencer } from './widgets/onboarding.js';
import {
  WorldAnchorLayer, OffscreenIndicator, KeyGlyph, InputPrompt, InteractPrompt, keyGlyphTexture,
} from './widgets/worldui.js';
import { brass } from './themes/brass.js';
import { aether } from './themes/aether.js';

// Custom icon painters persist across destroy/init cycles (the re-theme path is
// destroy + init, and consumer icons must survive it). Re-baked on every init.
const _customIcons = new Map(); // name -> painter(ctx, w, h)
const ICON_SIZE = 64;
function bakeCustomIcon(engine, name) {
  try {
    engine.textures.make(`icon.${name}`, ICON_SIZE, ICON_SIZE, _customIcons.get(name));
  } catch (err) {
    // A throwing consumer painter must not brick the boot: the registry persists
    // across destroy/init, so the throw would otherwise recur EVERY boot with no
    // unregister escape hatch. make() throws before registering, so lookups of this
    // name keep resolving to the loud fallback plate.
    console.warn(`LovecraftUI: registerIcon painter for "${name}" threw - its texture stays the fallback plate.`, err);
  }
}

// STRING_DEFAULTS/STRINGS live in src/strings.js — widgets read str()
// from there directly (the entry imports the widgets, so they cannot read this
// namespace). Eldritch.strings IS the live STRINGS object.

// theme painter overrides — a preset re-bakes specific registry entries
// with its own art. Frames keep their slice metrics and dims (both are layout
// truth); plain textures keep their dims. A throwing painter must not brick the
// boot (the registerIcon rule): it warns and the stock bake stands.
function applyThemePainters(reg, painters) {
  if (!painters) return;
  for (const [name, painter] of Object.entries(painters)) {
    if (typeof painter !== 'function') {
      console.warn(`LovecraftUI theme: painters["${name}"] is not a function - skipped.`);
      continue;
    }
    try {
      const fr = reg.frames.get(name);
      if (fr) {
        reg.makeFrame(name, fr.cssW, fr.cssH, { t: fr.t, r: fr.r, b: fr.b, l: fr.l }, painter);
      } else if (reg.textures.get(name)?.userData?.cssW) {
        const u = reg.textures.get(name).userData;
        reg.make(name, u.cssW, u.cssH, painter);
      } else {
        console.warn(`LovecraftUI theme: painters["${name}"] names no baked texture or frame - skipped.`);
      }
    } catch (err) {
      console.warn(`LovecraftUI theme: painters["${name}"] threw - the stock art stands.`, err);
    }
  }
}

export const Eldritch = {
  engine: null,
  taskbar: null, // the boot taskbar (set by init; null with init({taskbar:false}))
  _hudHidden: null, // photo-mode snapshot: node -> prior visibility (setHUDVisible)
  version: '1.0.0',
  assetBase: '', // accepted for source-API compatibility; all art is procedural
  // Library-authored user-facing strings; override per game via init({ strings }).
  // The full key list is STRING_DEFAULTS in src/strings.js (the whole table).
  strings: STRINGS,

  // The reduced-motion gate: while true, the animate presets collapse to
  // instant end states. A player/OS preference — it deliberately SURVIVES destroy()
  // (like the icon registry); flip it any time.
  get reducedMotion() { return isReducedMotion(); },
  set reducedMotion(v) { setReducedMotion(v); },

  config(options = {}) {
    if (options.assetBase != null) this.assetBase = options.assetBase;
    return this;
  },

  // Register a custom ability-icon painter: painter(ctx, w, h) draws the full 64x64
  // icon (the iconBase/glow/noGlow helpers are exported from this module). Callable
  // before or after init; persists across destroy/init (re-baked each boot). Register
  // before constructing users of the icon — nodes that already drew it keep old pixels.
  registerIcon(name, painter) {
    _customIcons.set(name, painter);
    if (this.engine) bakeCustomIcon(this.engine, name);
    return this;
  },

  // Register an item's metadata for the inventory suite: tooltip lore, icon id (any
  // registered icon — ability or custom), rarity token, and stack size. Persists across
  // destroy/init like the icon registry; register before placing the item in a grid.
  registerItem(id, { name, desc, icon, rarity, stackMax, data } = {}) {
    registerItemData(id, { name, desc, icon, rarity, stackMax, data });
    return this;
  },

  // The OPTIONAL icon pack (assets/icons — 60 sheets, 3,840 icons). Register a
  // curated set through the normal registerIcon machinery: every consumer that resolves
  // `icon.<id>` works unchanged; persistence and density re-bakes are inherited; missing
  // assets degrade to a legible letter-glyph plate (never the magenta unknown).
  // THE RE-SKIN IDIOM: point `as:` at an ALREADY-BAKED icon id (`{id:'ico-0210',
  // as:'shield'}`) and the registry re-bakes that one name — every live quad picks the
  // painted art up on its own, the atlas count never moves, and `fallback:'none'` leaves
  // the procedural art standing when the assets are absent. A page adopting the pack that
  // way needs no swap code and can call this AFTER building. Await it before construction
  // only when registering NEW names. opts: { base, icons: [id|slug|{id, as}], sheets,
  // fallback: 'glyph'|'none', keyBlack } → { registered, missing }.
  loadIcons(opts = {}) {
    return loadIcons({ ...opts, _register: (name, painter) => this.registerIcon(name, painter) });
  },

  // Bulk access for browsers/tools: one instance-owned texture per sheet (ZERO registry
  // entries — the atlas budget never moves) and per-icon THREE.Texture views windowed by
  // offset/repeat. Returns the pack handle: { list, sheets, categories, get, find,
  // ensure(sheetIds), texture, view(idOrSlug), stats, dispose }.
  loadIconPack(opts = {}) {
    return loadIconPack(opts);
  },

  // Capture-safe hiding: hide every UI band for screenshots/photo mode,
  // keeping the nodes in `except` (and their ancestors' slots) visible. Restores
  // exact prior visibility on setHUDVisible(true). The vignette layer is scene
  // ambiance and stays; everything else — windows, taskbar, toasts, tooltips,
  // popups — goes dark. Transient systems keep running invisibly.
  setHUDVisible(visible, { except = [] } = {}) {
    const engine = this.engine;
    if (!engine) return this;
    if (!visible) {
      if (this._hudHidden) return this; // already hidden: idempotent, keeps the original snapshot
      const keep = new Set(except);
      const spared = (node) => {
        if (keep.has(node)) return true;
        for (const k of keep) if (node.isAncestorOf(k)) return true;
        return false;
      };
      this._hudHidden = new Map();
      // 'cinematic' and 'vignette' are deliberately absent: letterbox bars and
      // the vignette are scene mood, not HUD — they survive photo mode. Every
      // OTHER band derives from LAYER_ORDER (one source of truth — review:
 // a hardcoded copy here missed the new 'radial' band, and an open wheel
 // survived photo mode).
      for (const name of LAYER_ORDER) {
        if (name === 'cinematic' || name === 'vignette') continue;
        const layer = engine.layers[name];
        if (!layer) continue;
        for (const child of layer.children) {
          if (spared(child)) continue;
          this._hudHidden.set(child, child.visible);
          child.visible = false;
        }
      }
    } else if (this._hudHidden) {
      for (const [node, was] of this._hudHidden) {
        // restore only what is still OURS to restore: a system that woke its node
        // mid-photo (EldPopup._present sets its overlay visible) has taken the
        // node back — strangling an open modal on restore would soft-lock input
        if (!node.disposed && node.visible === false) node.visible = was;
      }
      this._hudHidden = null;
    }
    engine.requestRender();
    return this;
  },

  get hudVisible() { return !this._hudHidden; },

  // THE hotkey path. Use this instead of window.addEventListener('keydown') — a lint
  // rule enforces it in examples/, because the hand-rolled form is how "pressing T while
  // typing in chat opened the scoreboard" shipped on four pages at once.
  //
  //   const off = Eldritch.onKey('e', { down: () => lantern.beginHold(),
  //                                     up:   () => lantern.cancelHold() });
  //
  // `down` fires while nothing holds focus — and, since the fall-through,
  // also when a focused non-text widget leaves the key unconsumed. Typing the
  // letter into a TextField stays typing either way (text editing never falls
  // through) — that guarantee comes from the engine bus, not from each page
  // remembering to check `document.activeElement`. Escape, Enter, and Space
  // NEVER fall through: while anything holds focus they belong to the focus
  // system, so bindings on them fire only from the idle table (Enter-to-chat
  // rides exactly that). `up` fires only for a key this registration actually
  // saw go down, so a release that lands while a field has focus still clears
  // the hold instead of stranding it. Key match is case-insensitive;
  // auto-repeat is suppressed unless `repeat: true`. Returns an unsubscribe function.
  onKey(key, { down = null, up = null, repeat = false } = {}) {
    const engine = this.engine;
    if (!engine) throw new Error('LovecraftUI: Eldritch.onKey needs Eldritch.init() first.');
    const wanted = new Set((Array.isArray(key) ? key : [key]).map((k) => String(k).toLowerCase()));
    if (wanted.has('tab')) {
      // Loud, because it shipped silently once: the focus manager consumes every Tab
      // keydown for traversal BEFORE the bus emit, so this binding can never fire from
      // a real keyboard. social-hud carried a dead hold-Tab scoreboard for a release.
      console.warn('LovecraftUI: onKey("Tab") can never fire — focus traversal owns Tab. Bind another key.');
    }
    const held = new Set();
    const offDown = engine.bus.on('keydown', (e) => {
      const k = String(e.key ?? '').toLowerCase();
      if (!wanted.has(k)) return;
      if (e.native?.repeat && !repeat) return;
      held.add(k);
      down?.(e);
    });
    const offUp = engine.bus.on('keyup', (e) => {
      const k = String(e.key ?? '').toLowerCase();
      if (!held.delete(k)) return; // never saw it go down: not ours to release
      up?.(e);
    });
    return () => { offDown(); offUp(); held.clear(); };
  },

  // Register a rite: tooltip lore plus (optionally) its icon painter in one call.
  registerAbility(id, { painter, name, desc, stats, flavor } = {}) {
    ABILITY_DATA[id] = {
      name: name ?? formatIconName(id),
      desc: desc ?? str('abilityFallbackDesc'),
      stats: stats ?? '',
      ...(flavor ? { flavor } : {}),
    };
    if (!ABILITY_ICON_IDS.includes(id)) ABILITY_ICON_IDS.push(id);
    if (painter) this.registerIcon(id, painter);
    return this;
  },

  // Boot everything. options: { container, width, height, windowContainer, taskbar,
  //                             background, vignette, timerDriven, transparent,
  //                             bootFocus (default true: the canvas takes DOM focus
  //                             so the keyboard is live before the first click;
  //                             false for guests on a host page - embed.html),
  //                             contextMenu (default true; false = the CANVAS
  //                             suppresses the native context menu - for pages
  //                             wiring right-click surfaces; canvas-scoped, so
  //                             an embedding host keeps its menu outside) }
  // transparent: true keeps an alpha channel on the canvas and clears to alpha 0 —
  // the embed story: the host page's own layers show through wherever the UI is not.
  // init/destroy are a pair: calling init while running tears the previous instance
  // down first, so hot reloads and SPA remounts cannot double-boot.
  init(options = {}) {
    if (this.engine) {
      console.warn('LovecraftUI: init() called while already running - destroying the previous instance first.');
      this.destroy();
    }
    // Theme + strings apply BEFORE any construction: the engine snapshots its clear
    // color, and painters/widgets read the token objects lazily during the bake.
    applyTheme(options.theme ?? {});
    setSeedOffset(options.theme?.seeds?.offset ?? 0);
    applyStrings(options.strings); // unknown keys warn; the STRINGS reference never changes
    try {
      return this._boot(options);
    } catch (err) {
      // A boot that dies halfway must not leave a zombie singleton (`this.engine` is
      // assigned early so the bake can reach the registry): tear down whatever was
      // constructed so the next init() starts clean, then rethrow.
      try { this.destroy(); } catch { /* best effort — the partial engine may lack pieces */ }
      this.engine = null;
      resetTheme();
      resetStrings(); // a failed boot's init({strings}) overrides must not leak into the next
      setSeedOffset(0);
      setTexScale(null);
      setTextScale(1);
      throw err;
    }
  },

  _boot(options) {
    // ?audit=1 implies the timer-driven ticker: the test suite drives pages headless, where
    // rAF never fires under --dump-dom (the debug-core SKIP lesson) — the auditor's
    // settle must ride a clock virtual time advances. Same opt the ?assert pages take.
    const auditMode = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('audit');
    // ?torture=1 / ?resize=1: the walkers, same headless clock needs
    const tortureMode = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('torture');
    const resizeMode = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('resize');
    if (auditMode || tortureMode || resizeMode) options = { ...options, timerDriven: true };
    // 3.2.x: honor the OS accessibility signal by default. The reducedMotion=no-motion
    // ruling was implemented as a manual flag only — a visitor whose system asks for
    // reduced motion got the full choreography unless the host game wired it. Seeded
    // at boot; `Eldritch.reducedMotion = v` after init still overrides either way.
    if (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setReducedMotion(true);
    }
    const engine = new EldritchEngine(options);
    this.engine = engine;

    // Bake density rides DPR × uiScale so stone and type stay crisp at
    // couch distance. The floor stays at the authored 2× — uiScale 1 changes
    // nothing; set BEFORE the bake, reset at destroy.
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    setTexScale(Math.max(2, dprCap * engine.uiScale));
    setTextScale(engine.uiScale);

    generateCoreArt(engine.textures);
    generateIconArt(engine.textures);
    for (const name of _customIcons.keys()) bakeCustomIcon(engine, name);
    applyThemePainters(engine.textures, options.theme?.painters); // preset art overrides ride the same bake
    bindWidgets(engine);
    // inline {icon:name} markup draws from the registry's retained canvases
    setIconSource((name) => engine.textures.canvases.get(`icon.${name}`) ?? null);
    engine.defaultCursor = engine.textures.cursor('claw');

    // Systems boot in the source library's order.
    EldPopup.init(engine, { okLabel: this.strings.ok, cancelLabel: this.strings.cancel });

    let taskbar = null;
    if (options.taskbar !== false) {
      taskbar = new Taskbar();
      const base = Taskbar.prototype.onLayout;
      taskbar.onLayout = function () {
        this.w = engine.width;
        this.h = METRICS.taskbarH;
        this.y = engine.height - METRICS.taskbarH;
        base.call(this);
      };
      engine.layers.taskbar.add(taskbar);
    }
    this.taskbar = taskbar;

    EldWindow.init(engine, { container: options.windowContainer, taskbar });

    EldDragDrop.init(engine);
    // Drop-to-discard confirmation: the entry wires the hook because dragdrop
    // cannot import windows.js (windows already imports dragdrop; the graph stays acyclic).
    EldDragDrop.confirmDiscard = ({ count, name }, onOk) => {
      EldPopup.show({
        title: str('discardTitle'),
        message: count > 1 ? str('discardPromptMany', count, name) : str('discardPromptOne', name),
        onOkay: onOk,
      });
    };
    EldToast.init(engine);    // toast root first: the tooltip node must paint above it
    EldNotify.init(engine);   // after EldToast: it hooks the toast slot-free signal
    EldTooltip.init(engine);
    EldContextMenu.init(engine);
    // The radial chain: unconsumed right-clicks walk radialItems
    // providers up the parent chain, then land on the registered ground wheel.
    initRadialFallback(engine);

    // Gamepad navigation is on by default; opt out with init({ input: { gamepad: false } }).
    // options.input.getGamepads / gamepadMap exist for tests and exotic layouts.
    engine.gamepad = options.input?.gamepad === false ? null : new GamepadNav(engine, {
      getGamepads: options.input?.getGamepads ?? null,
      map: options.input?.gamepadMap ?? null,
    });

    if (options.background !== false) initBackground(engine);
    if (options.vignette !== false) initVignette(engine);

    // ?debug=1 on the host page arms the overlay: bounds, hit chain, clip rects,
    // perf HUD — and the `i`-key node-tree inspector.
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
      initDebug(engine);
    }
    // ?console=1 summons the dev console open (backtick re-toggles it after).
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('console')) {
      const con = new DebugConsole();
      engine.layers.overlay.add(con);
      con.open();
    }
    // ?audit=1: after the page settles, run the layout/contrast auditor and
    // title `AUDIT <violations>` — the suite ratchets those counts per page.
    if (auditMode) initAudit(engine);
    // ?torture=1: after the same settle, drive every hover-reactive node
    // through its states and title the visibility violations
    if (tortureMode) initTorture(engine);
    // ?resize=1: drive every resizable surface grow -> floors -> restore
    if (resizeMode) initResizeTorture(engine);

    engine.start();
    // the keyboard is live at boot. Keyboard routing is scoped to the canvas
    // (input.js DOM gate), and nothing used to focus it until the first pointer
    // press - so every Eldritch.onKey binding was deaf on a fresh load, and "press
    // Enter to chat" took a click first (the mud-hud report). preventScroll keeps a
    // host page from jumping to the stage. A page embedded in someone ELSE's
    // document must not steal their keyboard at boot: bootFocus: false opts out
    // (examples/embed.html), and its suite asserts the host keeps focus.
    if (options.bootFocus !== false) {
      try { engine.canvas.focus({ preventScroll: true }); } catch { /* detached canvas */ }
    }
    return this;
  },

  // Full teardown: every system timer/subscription, every node, every GPU resource,
  // all listeners, and the canvas. init() boots cleanly again afterwards.
  destroy() {
    const engine = this.engine;
    if (!engine) return this;
    EldContextMenu._reset();
    EldNotify._reset(); // before the toast reset: it holds toast recs and the banner
    TitleCard._reset(); // pending cards settle; the live node dies with the overlay
    EldToast._reset();
    EldTooltip._reset();
    EldDragDrop._reset();
    EldWindow._reset();
    EldPopup._reset();
    EldEvents._reset();
    disposeIconCache();     // pack sheet textures die with the GL context that holds them
    engine.dispose();       // needs the widget engine binding: widgets resolve art in disposeSelf
    resetWidgets();
    resetFocusCounter();
    setIconSource(null);
    resetTextCaches();      // measured widths key on font strings a re-theme may redefine
    // B8: widget diagnostics re-surface per boot (warn parity —
 // a re-booted game must re-report its bad ids, not inherit last boot's silence)
    resetTalentWarnings(); resetStonesWarnings();
    resetTheme();
    setSeedOffset(0);
    setTexScale(null);      // back to the authored 2x (the next init sets its own density)
    setTextScale(1);
    this._hudHidden = null; // hidden-node snapshot dies with its engine
    resetStrings(); // this.strings stays the same live object, back at the defaults
    this.engine = null;
    this.taskbar = null;
    return this;
  },
};

export {
  // the behavior systems
  EldWindow, EldPopup, EldDragDrop, EldTooltip, EldEvents, EldContextMenu, EldToast, EldNotify,
  // widgets
  Button, IconButton, TextField, Toggle, ToggleLabel, Radio, RadioLabel,
  Slider, Select, ProgressBar, KeybindField, NumberField,
  Window, ModalWindow, Taskbar,
  DraggableIcon, ActionSlot, CpSlot, IconPalette, ActionbarLock, ActionBar, Tabs,
  EventLog, Table, UnitFrame, EffectBar, Minimap, QuestTracker, CharacterPanel, SettingsPanel, Globe, CastBar,
  VirtualList, PanZoomSurface, ItemGrid, ItemSlot, FloatText, ChatBox, LoadingVeil, DialogPanel,
  // engine-level building blocks
  EldritchEngine, UINode, QuadNode, NineSliceNode, Accent3DNode, TextNode, ScrollArea,
  GamepadNav,
  // fx
  makeOrbMesh,
  // data + helpers
  ABILITY_DATA, ABILITY_ICON_IDS, abilityData, formatIconName, measureText, compileMarkup,
  ITEM_DATA, itemData, rarityColor, registerItemData,
  iconBase, glow, noGlow,
  COLORS, FONTS, METRICS, socketInset, socketInsetRaw, row, column, grid, anchor, clamp, fitChildren, contentRect, contentExtent, Easing,
  // the layout engine + the resize grip + form rows
  VBox, HBox, GridBox, Stack, Spacer, Divider, ResizeGrip, makeResizable, FormRow, Form,
  // motion
  animateIn, animateOut, stagger,
  // the bound ledger
  Store, bind, bindText, bindEnabled, DevPanel,
  // meters & measures
  SegmentedBar, ArcGauge, Badge, attachBadge, ResourceChip, ResourceBar,
  BigTimer, StarRating, SegmentedControl, SpeedControl,
  // the meta-screens kit
  MenuList, MenuScreen, TitleCard, SaveSlotList, LevelSelectGrid, CreditsScroller,
  // the onboarding kit
  Spotlight, Coachmark, TutorialSequencer,
  // the world kit
  WorldAnchorLayer, OffscreenIndicator, KeyGlyph, InputPrompt, InteractPrompt, keyGlyphTexture,
  // the shipped theme presets
  brass, aether,
  // the inspector's lens + the page auditor + the walkers
  DebugConsole, DebugInspector, runAudit, AUDIT_RULES, runStateTorture, runResizeTorture, hitTest,
  // the talent grid: the WoW-Classic tier law (the graph skins
 // and core died with destroy ruling)
  TalentTree, TalentPanes,
  // the war table
  SelectionMarquee, CommandCard, BuildQueue, TacticalMap,
  // the long winter (DayDial graduated off the cut line)
  RecipeBrowser, ProcessPanel, CompassStrip, DayDial,
  // the speaking stones
  BodyDoll, EquipmentRack,
  // the whispering stage
  LetterboxBars, TypewriterText, ChoiceList, Journal, DocumentViewer, SubtitleBar, SanityFX,
  // the lantern bearer
  RadialMenu, BossBar,
  // the drawn hand
  Card, HandFan, Pile, RunMap, CARD_SIZES,
  // the iron sights
  Reticle, HitMarker, AmmoCounter, DamageIndicator, Killfeed,
  // the guildhall (the gathering died with its page)
  PartyPanel,
  // the counting house
  LineChart, BarChart, TreeTable, NotificationCenter,
  // coda & coin-op
  ScoreTally,
};

// Hand-written declarations for the public entry (src/lovecraft-ui.js).
// Kept in lockstep with the export block by lint rule (doc-sync checker v2):
// every JS export must be declared here, and nothing may be declared that the JS
// does not export. Types are pragmatic — options objects are typed where the shape
// is part of the contract and left open where the docs/API.md still evolves them.

declare module 'lovecraft-ui' {
  // ---- core node types ----
  export interface Rect { x0: number; y0: number; x1: number; y1: number; }

  export class UINode {
    id: number;
    name: string;
    parent: UINode | null;
    children: UINode[];
    x: number; y: number; w: number; h: number;
    visible: boolean;
    /** The radial chain's provider marker: an item array, or a per-gesture function returning items, null (decline onward), or false (SEAL the chain — the scrim rule). An UNCONSUMED right-click walks these from the hit up the parent chain, then falls to the registered ground wheel. */
    radialItems?: RadialItem[] | ((e: { target: UINode; x: number; y: number; native: any }) => RadialItem[] | null | false);
    interactive: boolean;
    focusable: boolean;
    disabled: boolean;
    fxOpacity: number;
    fxScale: number;
    readonly worldX: number;
    readonly worldY: number;
    readonly worldScale: number;
    readonly worldRect: Rect;
    readonly effectiveClipRect: Rect | null;
    readonly disposed: boolean;
    constructor(opts?: { name?: string; interactive?: boolean; visible?: boolean; x?: number; y?: number; w?: number; h?: number; cursor?: string | null });
    add(...nodes: UINode[]): UINode;
    remove(child: UINode): void;
    dispose(): void;
    setPos(x: number, y: number): void;
    setSize(w: number, h: number): void;
    setRect(x: number, y: number, w: number, h: number): void;
    on(type: string, fn: (e: any) => void): () => void;
    emit(type: string, data?: any): void;
    dispatch(type: string, data?: any): any;
    closest(pred: (n: UINode) => boolean): UINode | null;
    /** Declare a DELIBERATE exception to a page-audit rule or a walker rule ('hover' | 'press' | 'restore'; 'resize'). Declarations are counted and ratcheted. 'reach' (3.2.x, the sixth audit rule) alone resolves UP THE CHAIN: declare it once on a container and it forgives everything inside. */
    auditAllow(...rules: Array<'overlap' | 'containment' | 'contrast' | 'scrollbar' | 'hit' | 'reach' | 'hover' | 'press' | 'restore' | 'resize'>): this;
    /** names the node whose subtree renders THIS node's interaction feedback when it lives outside its own (the window SE resize handle proxies to the drawn grip quad) — the states walker diffs both. */
    stateProxy?: UINode;
    isAncestorOf(n: UINode): boolean;
    containsPoint(x: number, y: number, pad?: number): boolean;
    invalidateLayout(): void;
    invalidatePaint(): void;
    onLayout?: () => void;
    onActivate?: () => void;
    setFrameHook(fn: ((dt: number) => void) | null): void;
  }

  export class QuadNode extends UINode {
    constructor(opts?: { texture?: any; color?: number | string; opacity?: number; interactive?: boolean });
    setTexture(tex: any): void;
    setColor(c: number | string): void; // accepts rgb()/rgba() strings
    setBaseOpacity(v: number): void;
  }

  export class NineSliceNode extends UINode {
    frame: { tex: any; t: number; r: number; b: number; l: number; cssW: number; cssH: number };
    constructor(frame: any, opts?: any);
    setFrame(frame: any): void;
  }

  export class Accent3DNode extends UINode {
    content: any; // THREE.Group — put lit, transparent meshes here
    constructor(opts?: any);
  }

  export class TextNode extends UINode {
    constructor(text: string, style?: any);
    setText(t: string): void;
    setColor(c: string): void;
    /** re-clamp a single-line node (ellipsis lane) to a new width and re-raster. */
    setMaxWidth(w: number): void;
    setSegments(segments: Array<{ text: string; color?: string }>): void;
    /** reveal mode: throttled prefix re-raster at `cps` chars/sec (an inline icon counts as one). Resolves on completion, skip(), supersession by new content, or dispose — never rejects. Mechanism only: reducedMotion policy is the caller's (TypewriterText/DialogPanel apply it). */
    reveal(cps?: number, opts?: { onChar?: (added: number, shown: number, total: number) => void }): Promise<TextNode>;
    /** Lands the full text instantly and settles the reveal promise; a no-op when idle. */
    skip(): this;
    readonly isRevealing: boolean;
    /**
     * the {link:} hit test, in NODE-LOCAL logical px. A fragment's vertical band
     * fills the whole line advance (wrapped links tile gap-free). `text` is the
     * instance's visible text ('…' included when truncated) — key on `id`.
     * Interactive TextNodes with link runs dispatch bubbling `linkclick {id, text, x, y}`
     * and `linkhover {id, text, over, x, y}`.
     */
    linkAt(localX: number, localY: number): { id: string; key: number; text: string } | null;
  }

  export class ScrollArea extends UINode {
    content: UINode;
    readonly maxScroll: number;
    readonly maxScrollX: number;
    constructor(opts?: { skin?: any; contentW?: number; contentH?: number; scrollX?: boolean; inset?: boolean; autoContent?: boolean; contentPadBottom?: number });
    setScroll(y: number): void;
    setScrollX(x: number): void;
    scrollBy(dy: number): void;
    scrollToBottom(): void;
    setContentSize(w: number, h: number): void;
  }

  export class EldritchEngine {
    canvas: HTMLCanvasElement;
    /** LOGICAL px (css / uiScale) — layout, hit math, and worlds all speak this space. */
    width: number;
    height: number;
    /** The couch-distance scale this engine booted with; 1 by default. */
    readonly uiScale: number;
    layers: Record<string, UINode>;
    ticker: any;
    focus: any;
    /** The engine event bus (pointer/key/wheel/windowblur…). `keydown` fires while no node holds focus, or falls through from a focused non-text widget that left the key unconsumed (3.2.x) — EXCEPT Escape, Enter, and Space, which never fall through (while anything holds focus they belong to the focus system: dismissal and activation). Text editing never falls through either. `keyup` is unscoped by design — Eldritch.onKey is the safe consumer. */
    bus: { on(type: string, fn: (e: any) => void): () => void; emit(type: string, data?: any): void };
    gamepad: any;
    input: any;
    textures: any;
    paintList: UINode[];
    alwaysRender: boolean;
    constructor(opts?: any);
    start(): void;
    requestRender(): void;
    setFocus(node: UINode | null, opts?: any): void;
    stats(): { calls: number; triangles: number; textures: number; geometries: number };
  }

  export class GamepadNav { constructor(engine: any, opts?: any); }

  // ---- form widgets (the uniform contract: docs/API.md) ----
  export class Button extends UINode {
    constructor(text: string, opts?: { onClick?: (e: any) => void; disabled?: boolean; minWidth?: number; height?: number });
    setText(t: string): void;
    setDisabled(v: boolean): void;
  }
  export class IconButton extends UINode {
    constructor(kind: string, opts?: { onClick?: (e: any) => void; disabled?: boolean });
    setIcon(kind: string): void;
    setDisabled(v: boolean): void;
  }
  export class TextField extends UINode {
    /** Focus this field in its EDITING state (the promotion a click performs), caret at the end; a sealed field refuses. The Enter-to-chat idiom rides it. */
    focusEdit(): void;
    value: string;
    maxLength: number | null;
    constructor(opts?: { placeholder?: string; value?: string; width?: number; height?: number; maxLength?: number; onSubmit?: (v: string) => void;
      /** brighten the placeholder on lighter surfaces (default COLORS.textMuted). */
      placeholderColor?: number | string });
    setValue(v: string, opts?: { silent?: boolean }): void;
    setDisabled(v: boolean): void;
  }
  export class Toggle extends UINode {
    checked: boolean;
    constructor(opts?: { checked?: boolean; onChange?: (v: boolean) => void });
    setChecked(v: boolean, opts?: { silent?: boolean }): void;
    setDisabled(v: boolean): void;
  }
  export class ToggleLabel extends UINode {
    readonly checked: boolean;
    toggle: Toggle;
    constructor(text: string, opts?: { checked?: boolean; onChange?: (v: boolean) => void });
    setChecked(v: boolean, opts?: { silent?: boolean }): void;
    setDisabled(v: boolean): void;
  }
  export class Radio extends UINode {
    checked: boolean;
    value: any;
    constructor(group: string, opts?: { checked?: boolean; value?: any; onChange?: (v: boolean) => void });
    static groupValue(group: string): any;
    static selectValue(group: string, value: any, opts?: { silent?: boolean }): boolean;
    select(): void;
    setDisabled(v: boolean): void;
  }
  export class RadioLabel extends UINode {
    readonly checked: boolean;
    radio: Radio;
    constructor(group: string, text: string, opts?: { checked?: boolean; value?: any; onChange?: (v: boolean) => void });
    setDisabled(v: boolean): void;
  }
  export class Slider extends UINode {
    value: number;
    constructor(opts?: { min?: number; max?: number; step?: number; value?: number; width?: number; labels?: string[]; onInput?: (v: number) => void; onChange?: (v: number) => void });
    setValue(v: number, opts?: { silent?: boolean }): void;
    setDisabled(v: boolean): void;
  }
  export class Select extends UINode {
    readonly value: any;
    readonly isOpen: boolean;
    constructor(opts?: { options?: Array<string | { value: any; label: string }>; value?: any; width?: number; height?: number; onChange?: (value: any, label: string, index: number) => void });
    setValue(value: any, opts?: { silent?: boolean }): boolean;
    setOptions(options: Array<string | { value: any; label: string }>, opts?: { value?: any; silent?: boolean }): void;
    getOptions(): Array<{ value?: any; label?: string; separator?: boolean }>;
    open(): void;
    close(): void;
    setDisabled(v: boolean): void;
  }
  export class ProgressBar extends UINode {
    value: number;
    constructor(opts?: { value?: number; width?: number; height?: number; segments?: number });
    setValue(pct: number, opts?: { animate?: boolean; silent?: boolean }): void;
  }
  export class ChatBox extends UINode {
    /** Enter-to-chat: hand the keyboard to the input bar in its editing state. Bind page-side with Eldritch.onKey('Enter', { down: () => chat.focusInput() }); whether a submit hands the keyboard back is the page's call (a chat blurs in onSubmit, a MUD command line keeps typing). */
    focusInput(): void;
    readonly field: TextField;
    readonly scrollback: EventLog;
    history: string[];
    constructor(opts?: { width?: number; height?: number; placeholder?: string; maxEntries?: number; register?: boolean; markup?: boolean; virtual?: boolean; maxHistory?: number; resizable?: boolean | { corner?: string; minW?: number; minH?: number }; onSubmit?: (value: string) => void });
    log(message: string, type?: string): void;
    clear(): void;
    setDisabled(v: boolean): void;
    /** the scrollback's pin predicate, re-exposed. */
    readonly atBottom: boolean;
    /** the scrollback's explicit re-pin, re-exposed. */
    scrollToBottom(): void;
  }
  export class LoadingVeil extends UINode {
    readonly value: number;
    constructor(opts?: { title?: string; flavor?: string; value?: number });
    setValue(pct: number, opts?: { animate?: boolean; silent?: boolean }): void;
    setFlavor(text: string): void;
    fadeOut(): Promise<void>;
  }
  export class DialogPanel extends UINode {
    /** `typewriter`: reveal cps for setEntry bodies; 0 (the default) is instant — the earlier behavior. While revealing, the first advance press SKIPS and the second advances. */
    constructor(opts?: { width?: number; minHeight?: number; portrait?: string; speaker?: string; text?: string; typewriter?: number; onAdvance?: () => void });
    typewriterCps: number;
    setEntry(entry?: { portrait?: string; speaker?: string; text?: string }): void;
    setDisabled(v: boolean): void;
  }
  export class NumberField extends UINode {
    value: number;
    constructor(opts?: { value?: number; min?: number; max?: number; step?: number; width?: number; height?: number; onChange?: (v: number) => void });
    setValue(v: number, opts?: { silent?: boolean }): void;
    setDisabled(v: boolean): void;
  }
  export class KeybindField extends UINode {
    value: string | null;
    readonly capturing: boolean;
    constructor(opts?: { value?: string; width?: number; height?: number; onChange?: (v: string) => void; checkConflict?: (combo: string) => string | null | undefined; onConflict?: (combo: string, withWhat: string) => void });
    setValue(v: string | null, opts?: { silent?: boolean }): void;
    setDisabled(v: boolean): void;
  }

  // ---- windows / overlays ----
  // The shared window chassis (module-internal in src, so not exported here): Window and
  // ModalWindow are SIBLINGS on it — ModalWindow does not extend Window.
  class WindowBase extends UINode {
    readonly content: UINode;
    /** setContent re-measures when autoSize is on. */
    setContent(content: any): void;
    /** the footer lane (an HBox), or null when the window has none. */
    readonly footerBar: HBox | null;
    /** `header: false` at construction — a chrome-less panel window (no band, no controls). */
    readonly headerless: boolean;
    /** omitted sizes measure the content; a given size (even a warned NaN) stays law; `autoSize: false` restores the legacy default. */
    autoSize: boolean;
    /** One-shot: size the window to fit its content (8px breathing, viewport-clamped). Runs automatically at construction/setContent when autoSize is on. */
    autoSizeToContent(): this;
  }
  export class Window extends WindowBase {
    constructor(opts?: {
      title?: string; width?: number; height?: number; content?: any;
      onClose?: () => void;
      /** false = chrome-less panel (no header band, no close button). */
      header?: boolean;
      /** omitted sizes measure content by default; false restores the legacy 350×260. */
      autoSize?: boolean;
      /** the footer lane — nodes (or a (bar, win) builder) pinned inside the frame's bottom inset; the content box shrinks above it. */
      footer?: UINode | UINode[] | ((bar: HBox, win: Window) => void);
      /** Footer distribution (default 'end' — the dialog-button convention). */
      footerJustify?: 'start' | 'center' | 'end' | 'space-between';
    });
  }
  export class ModalWindow extends WindowBase {
    minimize(): void;
    restore(): void;
    toggleMaximize(): void;
    close(): void;
    bringToFront(): void;
    setTitle(t: string): void;
    /** True once a REAL pointer CHANGED the box — a header drag that moved it, a resize that resized it (claim tightened: a press alone raises and claims nothing). Page layout that repositions the window should skip it once true. Programmatic setPos/setRect never sets it; restoreLayout SETS it (a restored layout is the user's placement — entries record the flag, older saves restore claimed). */
    userPlaced: boolean;
  }
  export class Taskbar extends UINode { constructor(); }
  export class Tabs extends UINode {
    readonly content: UINode;
    activeId: string | null;
    constructor(opts?: { tabs?: Array<{ id: string; label: string; icon?: string; build: (pane: UINode, tabs: Tabs) => void }>; width?: number; height?: number; onChange?: (id: string) => void });
    selectTab(id: string, opts?: { silent?: boolean }): boolean;
    setDisabled(v: boolean): void;
  }

  export const EldWindow: {
    create(opts?: any): ModalWindow;
    setContainer(node: UINode): void;
    windows: ModalWindow[];
    [k: string]: any;
  };
  export const EldPopup: {
    show(opts?: { title?: string; message?: string; onOkay?: (v?: string) => void; onCancel?: () => void; buttons?: Array<{ label: string; onClick?: () => void; variant?: string }>; prompt?: { placeholder?: string; value?: string } | true }): Promise<{ action: string; value: string | null }>;
    hide(): void;
    isOpen: boolean;
    [k: string]: any;
  };
  export const EldTooltip: { show(spec: any, x: number, y: number): void; hide(): void; hideNow(): void; attach(node: UINode, specOrFn: any): () => void; detach(node: UINode): void; [k: string]: any };
  export const EldContextMenu: { show(entries: Array<{ label?: string; onClick?: () => void; disabled?: boolean; separator?: boolean }>, x: number, y: number): any; close(): void; isOpen: boolean; node: UINode | null; [k: string]: any };
  export const EldToast: { show(spec?: { title?: string; message?: string; variant?: 'info' | 'loot' | 'achievement'; icon?: string; duration?: number; markup?: boolean }): any; maxVisible: number; [k: string]: any };
  export const EldNotify: {
    /** While true, toast/banner sends route to the EldEvents log instead (nothing pops). */
    doNotDisturb: boolean;
    /** Route a notification: 'toast' rides the corner stack, 'banner' the center-top stone banner (one at a time), 'log' writes only the trail. Higher priority presents first from the pending queue; a `key` collapses repeats into a live "×n" counter. */
    send(spec?: { channel?: 'toast' | 'banner' | 'log'; title?: string; message?: string; icon?: string; variant?: 'info' | 'loot' | 'achievement'; duration?: number; priority?: number; key?: string | null; data?: any }): any;
    [k: string]: any;
  };
  export const EldEvents: {
    log(message: string, type?: string): void;
    register(sink: any): void;
    unregister(sink: any): void;
    /** Non-stealing observer: every log line reaches every tap regardless of the sink stack. Returns off(). */
    tap(fn: (message: string, type: string) => void): () => void;
  };

  // ---- drag & drop ----
  export class DraggableIcon extends UINode { iconName: string; constructor(...args: any[]); }
  export class ActionSlot extends UINode { slotId: string; icon: DraggableIcon | null; constructor(id: string | number); setKeybind(label: string | null): void; }
  export class CpSlot extends UINode { slotId: string; icon: DraggableIcon | null; constructor(id: string | number, opts?: any); }
  export class IconPalette extends UINode { constructor(iconIds: string[], opts?: { perRow?: number }); /** Convention 3. */ setDisabled(v: boolean): void; }
  export class ActionbarLock extends UINode { constructor(); /** Convention 3. */ setDisabled(v: boolean): void; }
  export class ActionBar extends UINode {
    slots: ActionSlot[];
    lock: ActionbarLock | null;
    constructor(opts?: { rows?: number; cols?: number; lock?: boolean; gap?: number });
  }
  export const EldDragDrop: {
    on(type: string, fn: (e: any) => void): () => void;
    /** would this target accept the payload right now? The same
     * truth the drop and the valid-target glow use. */
    canAccept(targetSlot: UINode, payload?: { itemId?: string | null; count?: number; sourceSlot?: UINode | null }): boolean;
    toggleLock(): void;
    setLocked(v: boolean): void;
    registerLock(lock: ActionbarLock): void;
    createIconInSlot(slot: UINode, name: string): DraggableIcon;
    clearSlot(slot: UINode): boolean;
    getSlotIcon(slot: UINode): string | null;
    triggerAction(slot: UINode): void;
    cancelDrag(): void;
    serialize(): Record<string, string | null>;
    restore(state: Record<string, string | null>): void;
    isLocked: boolean;
    isDragging: boolean;
    [k: string]: any;
  };

  // ---- components ----
  // ---- meters & measures ----
  export class SegmentedBar extends UINode {
    constructor(opts?: { segments?: number; value?: number; max?: number; width?: number; height?: number; tint?: string; tints?: string[] });
    /** The number commits instantly; the displayed fill sweeps 0.3s (`animate: false` snaps). */
    setValue(v: number, opts?: { silent?: boolean; animate?: boolean }): void;
    setDisabled(v: boolean): void;
    value: number;
  }
  export class ArcGauge extends UINode {
    constructor(opts?: { value?: number; max?: number; radius?: number; thickness?: number; label?: string; thresholds?: Array<{ pct: number; color: string }> });
    setValue(v: number, opts?: { silent?: boolean; animate?: boolean }): void;
    setDisabled(v: boolean): void;
    value: number;
  }
  export class Badge extends UINode {
    constructor(opts?: { count?: number; color?: string });
    /** 0 auto-hides; counts above 99 read "99+". */
    setCount(n: number, opts?: { silent?: boolean }): void;
    count: number;
  }
  /** Hang a Badge off the host's top-right corner (a child — it moves and dies with the host). */
  export function attachBadge(node: UINode, opts?: { count?: number; color?: string }): Badge;
  export class ResourceChip extends UINode {
    constructor(opts?: { icon?: string; value?: number; cap?: number; warnAt?: number; width?: number });
    setValue(v: number, opts?: { silent?: boolean }): void;
    setDisabled(v: boolean): void;
    value: number;
  }
  export class ResourceBar extends UINode {
    constructor(opts?: { chips?: Array<{ icon?: string; value?: number; cap?: number; warnAt?: number; width?: number }>; gap?: number });
    readonly chips: ResourceChip[];
  }
  export class BigTimer extends UINode {
    constructor(opts?: { seconds?: number; warnAt?: number; urgentAt?: number; size?: number; running?: boolean });
    /** value = remaining seconds; reaching zero stops the clock and dispatches `timeout {}` once. */
    setValue(v: number, opts?: { silent?: boolean }): void;
    start(): void;
    stop(): void;
    setDisabled(v: boolean): void;
    running: boolean;
    value: number;
  }
  export class StarRating extends UINode {
    constructor(opts?: { value?: number; max?: number; disabled?: boolean; onChange?: (v: number) => void });
    setValue(v: number, opts?: { silent?: boolean }): void;
    setDisabled(v: boolean): void;
    value: number;
  }
  export class SegmentedControl extends UINode {
    constructor(opts?: { options?: Array<string | { label: string; value: any }>; value?: any; width?: number; disabled?: boolean; onChange?: (v: any) => void });
    /** Select by OPTION VALUE; unknown values no-op and return false. */
    setValue(v: any, opts?: { silent?: boolean }): boolean;
    setDisabled(v: boolean): void;
    value: any;
  }
  /** The tempo preset: pause / 1x / 2x / 3x as a SegmentedControl. */
  export function SpeedControl(opts?: { value?: number; width?: number; onChange?: (v: number) => void }): SegmentedControl;

  // ---- the meta-screens kit ----
  export class MenuList extends UINode {
    constructor(opts?: { items?: Array<{ label: string; onSelect?: () => void; disabled?: boolean }>; width?: number });
    /** The highlighted row. Up/Down WRAP around enabled rows; Enter/gamepad-A selects (`select {index, item}`). */
    index: number;
    setDisabled(v: boolean): void;
  }
  export class MenuScreen extends UINode {
    /**
     * `scrimOpacity` defaults to 0.88 — correct for a pause menu, which exists to seal
     * live gameplay away. Thin it for a TITLE screen, which has nothing behind it to
     * seal and whose backdrop is the game's first impression. Presses are swallowed at
     * any value; only the veil changes.
     */
    constructor(opts?: { title?: string; items?: Array<{ label: string; onSelect?: () => void; disabled?: boolean }>; width?: number; scrimOpacity?: number });
    /** 0 = the root menu; each push() adds a level and an Escape-stack entry. */
    readonly depth: number;
    push(spec: { title?: string; items: any[] }): this;
    pop(): this;
    list: MenuList | null;
  }
  /** Queued area/turn/round banners: entrance, hold, exit; show() resolves when ITS card has left. */
  export const TitleCard: { show(spec?: { title?: string; subtitle?: string; hold?: number }): Promise<void>; [k: string]: any };
  export class SaveSlotList extends UINode {
    constructor(opts?: {
      slots?: Array<{ name?: string; timestamp?: string; playtime?: string; thumbnail?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void } | null>;
      width?: number; onSelect?: (index: number, slot: any) => void; onDelete?: (index: number, slot: any) => void; onNew?: (index: number) => void;
    });
    /** Data-driven: `slotdelete {index}` fires AFTER the confirm; mutate your data and call setSlots. */
    setSlots(slots: any[]): void;
    slots: any[];
    setDisabled(v: boolean): void;
  }
  export class LevelSelectGrid extends UINode {
    constructor(opts?: { levels?: Array<{ id: any; label?: string; state?: 'locked' | 'open' | 'done'; stars?: number }>; cols?: number; pageSize?: number; onSelect?: (e: { id: any; state: string; stars: number }) => void });
    readonly pages: number;
    page: number;
    /** Silent by default (the library setter convention); pass `{silent:false}` to voice `pagechange {page}` — the built-in page buttons do. */
    setPage(p: number, opts?: { silent?: boolean }): void;
    /** Locked plates still click and focus — locked is DATA, not disabled (the standing plate rule); `levelclick` carries the state. */
    setLevelState(id: any, state: 'locked' | 'open' | 'done', opts?: { silent?: boolean }): boolean;
    setDisabled(v: boolean): void;
  }
  /** The end-credits roll. Wheel-scrubbable at any time; under Eldritch.reducedMotion start() does NOT crawl — the roll rests readable, the wheel is the player's own motion, and scrubbing to the end takes the same `done {}` path (the credits→menu flow still closes). */
  export class CreditsScroller extends UINode {
    constructor(opts?: { entries?: Array<{ header?: string } | { role?: string; name?: string } | { text?: string }>; width?: number; height?: number; speed?: number; autoStart?: boolean });
    /** Installs the crawl hook — a no-op under reducedMotion (NO MOTION, the standing ruling). */
    start(): void;
    stop(): void;
    /** Jump to the end — the same single `done {}` path a natural finish takes. */
    skip(): void;
    setSpeed(v: number): void;
    setDisabled(v: boolean): void;
  }

  // ---- the onboarding kit ----
  export class Spotlight extends UINode {
    constructor(opts?: { opacity?: number; pad?: number });
    /**
     * Cut the hole around a live node and track it across layout; null clears it
     * (full scrim). Input outside the cutout is sealed — pointer, Tab-walk, spatial
     * nav, and gamepad-A all refuse through the same containsPoint predicate.
     */
    setTarget(node: UINode | null, opts?: { shape?: 'rect' | 'circle'; pad?: number; morph?: boolean }): this;
    setCutout(rect: { x: number; y: number; w: number; h: number } | null, opts?: { shape?: 'rect' | 'circle'; morph?: boolean }): this;
    /** The END-state cutout rect (a mid-morph reads the destination); null with no cutout. */
    readonly cutoutRect: { x: number; y: number; w: number; h: number } | null;
  }
  export class Coachmark extends UINode {
    constructor(opts?: {
      title?: string; text?: string; markup?: boolean; width?: number;
      step?: number; total?: number; showNext?: boolean; showSkip?: boolean;
      onNext?: () => void; onSkip?: () => void;
    });
    setContent(spec?: { title?: string; text?: string; step?: number; total?: number; showNext?: boolean; showSkip?: boolean; nextLabel?: string }): void;
    /** Place beside a rect (engine coords): below, flipped above, then the sides — arrow aimed at it. */
    placeNear(rect: { x: number; y: number; w: number; h: number }): this;
    placeCentered(): this;
    nextBtn: Button;
    skipBtn: Button;
  }
  export class TutorialSequencer extends UINode {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    constructor(opts?: {
      steps?: Array<{
        target?: UINode | (() => UINode | null) | null;
        title?: string; text?: string;
        advance?: 'click' | 'change' | 'manual' | ((step: any, target: UINode | null) => boolean);
        shape?: 'rect' | 'circle'; pad?: number;
      }>;
      opacity?: number; pad?: number; markup?: boolean; escapeAborts?: boolean;
      onStep?: (index: number, step: any) => void; onDone?: (completed: boolean) => void;
    });
    /** Mounts on the overlay layer and begins lesson 0. Dispatches `stepchange {index, step, stepTarget}` (the RESOLVED lesson node; `target` is reserved by the event plane) and `done {completed, step}`; disposes itself after the exit fade. */
    start(): this;
    next(): void;
    abort(): void;
    readonly index: number;
    readonly running: boolean;
    spotlight: Spotlight;
    coach: Coachmark;
  }

  // ---- the world kit ----
  export class WorldAnchorLayer extends UINode {
    /** project(x, y, z) -> { sx, sy, visible } is the consumer's camera; required. */
    constructor(opts: { project: (x: number, y: number, z: number) => { sx: number; sy: number; visible?: boolean; [k: string]: any } });
    /**
     * Adds `node` as a child and parks it (centered + dx/dy) on the projected target
     * each frame. clampToEdge keeps it inside the viewport margins and reports the
     * clamped direction to node.onEdge('left'|'right'|'up'|'down'|null) — behind-camera
     * points mirror across the screen center first. fadeWith(target, p) -> 0..1 drives fxOpacity.
     */
    anchor(node: UINode, target: { x: number; y: number; z?: number } | (() => { x: number; y: number; z?: number } | null) | null,
      opts?: { clampToEdge?: boolean; edgeMargin?: number; fadeWith?: (target: any, p: any) => number; dx?: number; dy?: number }): UINode;
    /** Stops tracking; the node stays parented (dispose it yourself, or let the layer's dispose take it). */
    release(node: UINode): boolean;
    readonly anchorCount: number;
  }
  export class OffscreenIndicator extends UINode {
    /** icon is a REGISTRY texture name (grep it first). Anchor with clampToEdge: true. */
    constructor(opts?: { icon?: string; size?: number; showWhenOnscreen?: boolean });
    /** The WorldAnchorLayer contract: dir while clamped, null when free. */
    onEdge(dir: 'left' | 'right' | 'up' | 'down' | null): void;
  }
  /** A bind: a keyboard string ('E', 'Ctrl+E', 'Space'), { pad: 'A'|'B'|'X'|'Y'|'LB'|'RB'|'LS'|'RS'|string }, or { mouse: 1|2|3 }. */
  export type GlyphBind = string | { key?: string; pad?: string; mouse?: number };
  export class KeyGlyph extends UINode {
    constructor(bind: GlyphBind | null, opts?: { size?: number });
    setBind(bind: GlyphBind | null): this;
    bind: GlyphBind | null;
  }
  /** Bake (once) and return the registry texture for a bind's first atom; bakeH > 22 bakes a crisp larger size under an `@h` name. */
  export function keyGlyphTexture(atomOrBind: GlyphBind, bakeH?: number): any;
  export class InputPrompt extends UINode {
    /** action = the bind per device family; shows the one for engine.lastInputDevice and re-glyphs on the bus `devicechange` event. */
    constructor(action?: { key?: string; pad?: string; mouse?: number }, label?: string, opts?: { size?: number });
    setAction(action: { key?: string; pad?: string; mouse?: number }): this;
    setLabel(t: string): this;
    glyph: KeyGlyph;
  }
  export class InteractPrompt extends UINode {
    /** The "press E" plate; with opts.hold, beginHold()/cancelHold() drive the ring and `confirm {}` fires once at full. */
    constructor(opts?: { action?: { key?: string; pad?: string; mouse?: number }; label?: string; hold?: number; size?: number; onConfirm?: () => void });
    beginHold(): this;
    cancelHold(): this;
    setProgress(v: number): this;
    /** A seal mid-hold cancels the climb (own or ancestor disabled — nothing sealed confirms). */
    setDisabled(v: boolean): void;
    readonly progress: number;
    prompt: InputPrompt;
  }

  export class EventLog extends UINode {
    constructor(opts?: { width?: number; height?: number; maxEntries?: number; register?: boolean; markup?: boolean; virtual?: boolean; resizable?: boolean | { corner?: string; minW?: number; minH?: number } });
    log(message: string, type?: string): void;
    clear(): void;
    /** pin-to-bottom: append follows the tail only while this is true — a scrolled-up reading position is never yanked. */
    readonly atBottom: boolean;
    /** the explicit re-pin. */
    scrollToBottom(): void;
  }
  export class Table extends UINode {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    /** `sort` boots the model ordered, SILENTLY — no `sort` event, no ledger line; header clicks toggle from it. */
    constructor(opts?: { columns: Array<{ label: string; width: number }>; rows?: any[][]; virtual?: boolean | number; sort?: { column: number; ascending?: boolean } });
    getRows(): any[][];
    setRows(rows: any[][]): void;
    addRow(row: any[]): void;
    removeRow(index: number): boolean;
    updateCell(rowIndex: number, colIndex: number, value: any): boolean;
    sortByColumn(ci: number): void;
  }
  export class EffectBar extends UINode {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    addEffect(spec: { icon: string; name: string; desc?: string; duration?: string; buff?: boolean }): UINode;
    removeEffect(fx: UINode): boolean;
    clearEffects(): void;
  }
  export class UnitFrame extends UINode {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    effectsRow: EffectBar;
    health: { cur: number; max: number };
    mana: { cur: number; max: number };
    constructor(opts?: any);
    setHealth(cur: number, max?: number): void;
    setMana(cur: number, max?: number): void;
    setName(name: string): void;
    setLevel(level: number | string): void;
    setPortrait(texName: string): void;
    addEffect(spec: any): UINode;
    removeEffect(fx: UINode): boolean;
    clearEffects(): void;
  }
  export class Minimap extends UINode {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    constructor(opts?: { zone?: string; zoneLevel?: string });
    addMarker(kind: string, xPct: number, yPct: number, spec?: any): UINode;
    removeMarker(m: UINode): boolean;
    clearMarkers(): void;
    moveMarker(m: UINode, xPct: number, yPct: number): boolean;
    setZone(zone: string, zoneLevel?: string): void;
    setHeading(deg: number): void;
    zoomBy(dir: number, opts?: { silent?: boolean }): void;
    setZoom(z: number, opts?: { silent?: boolean }): void; // LOUD by default (the 1.0 contract)
  }
  export class QuestTracker extends UINode {
    questNodes: any[]; // per-quest entries {id, ...}; the id source for constructor-passed quests
    constructor(opts?: { header?: string; width?: number; quests?: any[]; markup?: boolean });
    addQuest(q: { id?: string; title: string; objectives?: Array<{ progress: string; text: string; done?: boolean }> }): string;
    updateObjective(id: string, index: number, patch: any): boolean;
    completeQuest(id: string): boolean;
    removeQuest(id: string): boolean;
    getQuest(id: string): any;
  }
  export class CharacterPanel extends UINode {
    constructor(opts?: any);
    equip(slotId: string, iconName: string): void;
    unequip(slotId: string): string | null;
    getEquipped(): Record<string, string | null>;
    getInventory(): Array<string | null>;
    setCurrency(c: { gold?: number; silver?: number; copper?: number }): void;
    setStats(categories: any[]): void;
    cycleStats(dir: number): void;
  }
  export class SettingsPanel extends UINode {
    readonly content: UINode;
    activeId: string | null;
    constructor(opts?: { tabs?: Array<{ id: string; label: string; icon?: string; build: (pane: UINode, panel: SettingsPanel) => void }>; width?: number; height?: number; onChange?: (id: string) => void });
    selectTab(id: string, opts?: { silent?: boolean } | boolean): boolean;
    setDisabled(v: boolean): void;
  }
  export class Globe extends UINode { constructor(opts?: { kind?: 'health' | 'sanity'; label?: string; value?: number; max?: number; radius?: number }); setValue(v: number, max?: number): void; }
  export class CastBar extends UINode {
    readonly casting: boolean;
    constructor(opts?: { width?: number; onComplete?: () => void });
    startCast(name: string, icon: string, seconds: number): void;
    stopCast(): void;
    interrupt(): void;
  }
  export class VirtualList extends ScrollArea {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    constructor(opts?: { rowH?: number; renderRow?: (node: UINode, item: any, index: number) => void; overscan?: number; rowFocus?: boolean });
    setItems(items: any[]): void;
    refresh(): void;
    itemAt(node: UINode): any;
    /** The row-focus contract's current index (-1 = none). Arrows/Home/End move it; `rowfocus {index, item}` and `rowactivate {index, item}` dispatch. */
    focusIndex: number;
    /** Scroll the given item index into view. */
    scrollToIndex(index: number): this;
    /** How many row NODES exist — one screenful plus overscan, whatever `items.length` is. */
    readonly poolSize: number;
  }
  export class PanZoomSurface extends UINode {
    content: UINode;
    readonly zoom: number;   // read field — setZoom/zoomBy are the write paths
    readonly panX: number;   // getter-only in src: panTo/centerOn are the write paths
    readonly panY: number;
    constructor(opts?: { planeW?: number; planeH?: number; zoom?: number; minZoom?: number; maxZoom?: number; zoomStep?: number; wheelZoom?: boolean; inertia?: boolean });
    add(...nodes: UINode[]): UINode;
    screenToPlane(x: number, y: number): { x: number; y: number };
    planeToScreen(x: number, y: number): { x: number; y: number };
    setZoom(z: number, opts?: { silent?: boolean; anchor?: any }): void;
    zoomBy(f: number, opts?: any): void;
    panTo(x: number, y: number, opts?: { silent?: boolean }): void;
    centerOn(x: number, y: number, opts?: { silent?: boolean }): void;
    setPlaneSize(w: number, h: number): void;
    setDisabled(v: boolean): void;
  }
  export class ItemGrid extends UINode {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    slots: ItemSlot[];
    locked: boolean;
    /** zone typing: gates ENTRY from another container (drag drop + quick-move; merge/swap/move all ask; both swap doorways). Same-grid rearranges and programmatic setItem never ask. null accepts everything. */
    accepts: ((itemId: string, count: number) => boolean) | null;
    constructor(opts?: { cols?: number; rows?: number; locked?: boolean; spacing?: number; accepts?: (itemId: string, count: number) => boolean });
    /** opts.durability (0..1) rides the item's icon — it travels with drags and paints the slot underbar. */
    setItem(index: number, itemId: string, count?: number, opts?: { silent?: boolean; durability?: number }): DraggableIcon | null;
    getItem(index: number): { item: string; count: number } | null;
    clearSlot(index: number, opts?: { silent?: boolean }): void;
    setLocked(v: boolean): void;
    firstEmpty(): ItemSlot | null;
    /** Durability is presentation on the icon; null clears the bar. */
    setDurability(index: number, v: number | null): this;
    /** Names the shift-click quick-move destination: merge same-id first (stackMax honored), then first empty; no room refuses with the error voice. Success dispatches `transfer {index, id, count, to}`. */
    linkTransfer(other: ItemGrid | null): this;
    /** take-all/deposit-all: the same sweep pointed both ways — chest.transferAll(bag) empties the chest. Returns stacks moved (fully or partially). {quiet: true} silences the sweep's voices — events still dispatch — so a composite sweeping several grids as one gesture can voice once itself. */
    transferAll(other?: ItemGrid, opts?: { quiet?: boolean }): number;
    /** the cut line, graduated merge same-id stacks first (stackMax honored; durability stacks never merge), then pack from slot 0 by the comparator (default: rarity desc, id, count desc). Locked grids refuse loudly. Loud calls dispatch ONE itemchange {action:'sort'}. */
    sort(opts?: { comparator?: (a: { id: string; count: number; durability?: number }, b: { id: string; count: number; durability?: number }) => number; silent?: boolean }): this;
  }
  export class ItemSlot extends UINode { slotId: string; constructor(...args: any[]); }
  export class FloatText extends UINode {
    readonly liveCount: number;
    constructor(opts?: { pool?: number });
    spawn(text: string | number, x: number, y: number, opts?: { crit?: boolean; color?: string }): UINode;
  }

  // ---- data + helpers ----
  export const ABILITY_DATA: Record<string, any>;
  export const ABILITY_ICON_IDS: string[];
  export function abilityData(id: string): any;
  export function formatIconName(id: string): string;
  export function measureText(fontCss: string, text: string): number;
  export function compileMarkup(str: string, style?: any): any[];
  export const ITEM_DATA: Record<string, any>;
  export function itemData(id: string): any;
  /** The validated ITEM_DATA writer (clamps stackMax finite ≥ 1, defaults name/desc). Raw ITEM_DATA writes are unsupported. */
  export function registerItemData(id: string, spec?: { name?: string; desc?: string; icon?: string | null; rarity?: string; stackMax?: number; data?: any }): any;
  export function rarityColor(rarity: string): string;
  export function iconBase(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  export function glow(ctx: CanvasRenderingContext2D, color: string, blur?: number): void;
  export function noGlow(ctx: CanvasRenderingContext2D): void;
  export function makeOrbMesh(radiusPx: number, colorDeep: string | number, colorBright: string | number): any;

  export const COLORS: Record<string, string>;
  export const FONTS: Record<string, string>;
  /** Layout/feel metrics. Mostly numbers; `textShadow` is a `{color,dx,dy,blur}` shadow spec. */
  export const METRICS: Record<string, number> & { textShadow: { color: string; dx: number; dy: number; blur: number } };
  /** The socket law: the stone-socket inset for a box of CSS px. Widgets use the rounded form; painters the raw ratio. */
  export function socketInset(box: number): number;
  export function socketInsetRaw(box: number): number;
  export function row(children: UINode[], opts?: any): number;
  export function column(children: UINode[], opts?: any): number;
  export function grid(children: UINode[], opts?: any): number;
  export function anchor(child: UINode, rect: any, where?: string, insetX?: number, insetY?: number): void;
  export function clamp(v: number, min: number, max: number): number;
  export function fitChildren(node: UINode, opts?: any): void;
  /** The shared content-extent law: max child x+w / y+h, skipping invisible and
   *  fitExclude children — the same measurement window auto-size and ScrollArea use. */
  export function contentExtent(children: UINode[], opts?: { preMeasure?: boolean }): { w: number; h: number };
  export function contentRect(frame: { t: number; r: number; b: number; l: number }, w: number, h: number, pad?: number): { x: number; y: number; w: number; h: number };
  export const Easing: Record<string, (t: number) => number>;

  // ---- animation presets ----
  export type AnimPreset = 'rise' | 'fall' | 'fadeScale' | 'stoneSlide';
  /** Show a node with grace. Always settles; end state: visible, base transform, fxOpacity 1. */
  export function animateIn(node: UINode, preset?: AnimPreset, opts?: { dur?: number; delay?: number }): Promise<void>;
  /** Hide a node with grace. Always settles; end state: visible=false, base transform, fxOpacity 1 (show-ready). */
  export function animateOut(node: UINode, preset?: AnimPreset, opts?: { dur?: number; delay?: number }): Promise<void>;
  /** Enter a group one after another (animateIn per node, delay i*gap). */
  export function stagger(nodes: UINode[], preset?: AnimPreset, opts?: { gap?: number; dur?: number }): Promise<void[]>;

  // ---- the bound ledger ----
  /** Dot-path observable store with microtask-batched notify. Subscribers fire when their path overlaps a written path in either direction. Not a computed graph. */
  export class Store {
    constructor(initial?: any);
    get(path: string): any;
    set(path: string, value: any): this;
    subscribe(path: string, fn: (value: any, path: string) => void): () => void;
  }
  /** Two-way widget binding: inbound store changes land silently; loud `change` commits write back. Returns off(); dispose auto-unbinds. */
  export function bind(widget: UINode, store: Store, path: string): () => void;
  /** One-way text binding: the node's text follows the path (through fmt when given). */
  export function bindText(textNode: TextNode, store: Store, path: string, fmt?: ((v: any) => string) | null): () => void;
  /** One-way enabled binding: a truthy value enables the widget. */
  export function bindEnabled(widget: UINode, store: Store, path: string): () => void;
  /** The studio cheat panel: collapsible stone panel of store-bound rows, hotkey-toggleable. */
  export class DevPanel extends UINode {
    constructor(opts?: { title?: string; hotkey?: string; x?: number; y?: number });
    static fromSpec(spec: {
      title?: string; hotkey?: string; x?: number; y?: number;
      fields?: Array<{ type: 'toggle' | 'slider' | 'select' | 'button' | 'readout'; label?: string; path?: string; min?: number; max?: number; step?: number; options?: any[]; onClick?: () => void; fmt?: (v: any) => string }>;
    }, store: Store): DevPanel;
    setCollapsed(v: boolean): void;
    collapsed: boolean;
  }

  // ---- the inspector's lens ----
  export class DebugConsole extends UINode {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    /** The drop-down dev console. Backtick toggles it (with nothing focused); ?console=1 summons one at boot. */
    constructor(opts?: { height?: number; hotkey?: string });
    /** register('spawn', (rest, con) => 'output', 'help text') — the return value (if any) prints. */
    register(name: string, fn: (rest: string, con: DebugConsole) => any, help?: string): this;
    unregister(name: string): boolean;
    exec(line: string): this;
    print(line: string): this;
    clear(): this;
    open(): this;
    close(): this;
    toggle(): this;
    readonly isOpen: boolean;
  }
  export class DebugInspector {
    /** The node-tree inspector window (also on the `i` key under ?debug=1). Read-only: pick observes a press, never swallows it. */
    constructor();
    refresh(): this;
    select(node: UINode | null): this;
    togglePick(): this;
    dispose(): void;
    readonly disposed: boolean;
    win: any;
  }

  // ---- the layout engine ----
  interface LayoutBoxOpts {
    padding?: number | { t?: number; r?: number; b?: number; l?: number };
    /** a registry frame NAME (e.g. 'panel.dark') or frame record — the box OWNS its stone bg; slice insets add to padding. */
    frame?: string | any;
    gap?: number;
    /** Cross-axis placement; 'stretch' SETS the child's cross size. */
    align?: 'start' | 'center' | 'end' | 'stretch';
    /** Main-axis distribution — meaningful only when that axis is externally driven (auto off). */
    justify?: 'start' | 'center' | 'end' | 'space-between';
    /** Size self from content (default true). Turn OFF the axis a parent drives. */
    autoWidth?: boolean; autoHeight?: boolean;
    minW?: number; minH?: number; maxW?: number; maxH?: number;
    x?: number; y?: number; w?: number; h?: number; name?: string; visible?: boolean; interactive?: boolean;
  }
  /** Vertical stack: children top-to-bottom with padding/gap/align/justify/flex and auto-size. visible=false and fitExclude children are ignored. */
  export class VBox extends UINode {
    constructor(opts?: LayoutBoxOpts);
    /** Give a child a share of the leftover main space (also: child.layoutFlex = n). Inert while the main axis is auto. */
    flex(child: UINode, n: number): this;
    pad: { t: number; r: number; b: number; l: number };
    gap: number; align: string; justify: string;
    autoWidth: boolean; autoHeight: boolean;
  }
  /** Horizontal row: children left-to-right. Same contract as VBox with axes swapped. */
  export class HBox extends UINode {
    constructor(opts?: LayoutBoxOpts);
    flex(child: UINode, n: number): this;
    pad: { t: number; r: number; b: number; l: number };
    gap: number; align: string; justify: string;
    autoWidth: boolean; autoHeight: boolean;
  }
  /** Fixed-column grid: cells size from cellW/cellH or from CONTENT (widest child / per-row tallest). align places within the cell; stretch sets size. Wrap is cut (fixed cols). */
  export class GridBox extends UINode {
    constructor(opts?: {
      cols?: number; cellW?: number; cellH?: number;
      gap?: number; gapX?: number; gapY?: number;
      padding?: number | { t?: number; r?: number; b?: number; l?: number };
      frame?: string | any;
      align?: 'start' | 'center' | 'end' | 'stretch';
      autoWidth?: boolean; autoHeight?: boolean;
      x?: number; y?: number; w?: number; h?: number; name?: string; visible?: boolean; interactive?: boolean;
    });
    cols: number; align: string;
  }
  /** Z-stacked children with 9-way anchor placement: label-over-frame, corner badges. Keywords are anchor()'s: top-left top top-right left center right bottom-left bottom bottom-right. */
  export class Stack extends UINode {
    constructor(opts?: {
      padding?: number | { t?: number; r?: number; b?: number; l?: number };
      frame?: string | any;
      /** Default placement for children without their own place(). */
      anchor?: string;
      autoWidth?: boolean; autoHeight?: boolean;
      minW?: number; minH?: number; maxW?: number; maxH?: number;
      x?: number; y?: number; w?: number; h?: number; name?: string; visible?: boolean; interactive?: boolean;
    });
    /** Anchor one child: place(child, 'bottom-right', 8) — insetY defaults to insetX. */
    place(child: UINode, where: string, insetX?: number, insetY?: number): this;
    anchor: string;
  }
  /** An invisible flex-share filler for driven-axis boxes: [title, Spacer(), buttons]. */
  export class Spacer extends UINode {
    constructor(flex?: number);
    layoutFlex: number;
  }
  /** A themable rule line (COLORS.divider): intrinsic thickness² — an align:'stretch' box stretches it across the cross axis. */
  export class Divider extends UINode {
    constructor(opts?: { thickness?: number; color?: number | string; opacity?: number });
  }

  // ---- form rows ----
  /** One labeled form line: an HBox of [fixed-width label lane | control], vertically centered. Standalone rows size themselves; inside a Form the column and height lane are driven. */
  export class FormRow extends HBox {
    constructor(label: string, control: UINode, opts?: {
      /** Fixed label-lane width; omit to size to this row's own label (a Form overrides it with the shared column). */
      labelWidth?: number;
      /** Text placement inside the lane (default 'left'). */
      labelAlign?: 'left' | 'right';
      /** Merged into the label TextNode style (default size 12, COLORS.textMuted). */
      labelStyle?: Record<string, any>;
      gap?: number;
    });
    control: UINode;
    labelNode: TextNode;
    setLabelWidth(w: number): void;
  }
  /** A VBox of FormRows sharing ONE label column ('auto' = widest label, re-resolved every pass) and ONE row-height lane (max of rowHeight and each control). */
  export class Form extends VBox {
    constructor(opts?: LayoutBoxOpts & {
      /** The shared label column: a number, or 'auto' (default) for the widest label. */
      labelWidth?: number | 'auto';
      /** The uniform row lane (default 34 — the field-class control height); taller controls still get room. */
      rowHeight?: number;
    });
    /** Build a FormRow, add it, return it (the control rides row.control). */
    row(label: string, control: UINode, opts?: ConstructorParameters<typeof FormRow>[2]): FormRow;
    labelWidth: number | 'auto';
    rowHeight: number;
  }

  // ---- the resize grip ----
  /** A drawn 24px corner resize affordance. The host hears a bubbling `resize {w, h}`; hosts exposing `atBottom`/`scrollToBottom` (EventLog, ChatBox) keep a pinned reader pinned through the resize. */
  export class ResizeGrip extends UINode {
    constructor(host: UINode, opts?: {
      corner?: 'tl' | 'tr' | 'bl' | 'br';
      minW?: number; minH?: number; maxW?: number; maxH?: number;
      onResize?: (w: number, h: number) => void;
    });
    corner: string;
  }
  /** Attach a ResizeGrip to any panel-class node: makeResizable(panel, { corner: 'tl' }). ChatBox/EventLog take the same bag via their `resizable` option. A real grip resize — the first geometry CHANGE, not the press — sets `host.userPlaced = true`; layout that re-sizes the host should skip it once true. Grip deltas divide by worldScale, so a host inside a zoomed plane resizes at pointer speed. */
  export function makeResizable(host: UINode, opts?: ConstructorParameters<typeof ResizeGrip>[1]): ResizeGrip;

  // ---- the page auditor ----
  /**
   * Walk the live paintList and report layout/readability violations: sibling overlap,
   * framed-container containment, text contrast (4.5:1, 3:1 at ≥18px/bold; text under
 * a disabled seal is exempt per WCAG 's inactive-component rule), scrollbar
   * truth, interactive hit floors (≥24px), and reach (3.2.x: every visible drawn
   * interactive node must answer the real hitTest from at least one point of a 5×5
   * grid over its own box — a reach violation records the `blocker` that covered it).
   * Pure read; texture luminance is sampled lazily and cached on texture.userData.
   * `?audit=1` runs it after settle and titles `AUDIT <total>` — the page manifest
   * ratchets those counts per page.
   */
  export function runAudit(engine: any): {
    violations: Array<{ rule: 'overlap' | 'containment' | 'contrast' | 'scrollbar' | 'hit' | 'reach'; node: UINode; path: string; detail: string; blocker?: UINode | null }>;
    counts: Record<'overlap' | 'containment' | 'contrast' | 'scrollbar' | 'hit' | 'reach', number>;
    allowances: Record<'overlap' | 'containment' | 'contrast' | 'scrollbar' | 'hit' | 'reach', number>;
    deadAllowances: number;
  };

  /** The auditor's rule set in report order — six since 3.2.x ('reach' joined). */
  export const AUDIT_RULES: ReadonlyArray<'overlap' | 'containment' | 'contrast' | 'scrollbar' | 'hit' | 'reach'>;

  /**
   * The engine's reverse-paint-order hit probe — the same walk pointer input rides.
   * Returns the topmost interactive node containing the point, or null. Assert
   * suites use it to prove REAL reachability (a `dispatch('click')` bypasses hit
   * testing entirely and proves nothing about occlusion).
   */
  export function hitTest(engine: any, x: number, y: number, pad?: number): UINode | null;

  /**
   * The interaction-states walker. Drives every hover-reactive node the input
   * layer would deliver to (pointerenter listeners, not under a disabled seal)
   * through hover -> press -> release/leave via the node's own dispatch, and demands
   * VISIBLE feedback: 'hover' (tooltips count), 'press' (only of actionable nodes —
   * ones listening for pointerdown/click), 'restore' (leave returns the resting
   * state; focus acquired by the press is blurred first). `?torture=1` runs it after
   * boot and titles `TORTURE <total>` — the page manifest ratchets per page.
   */
  export function runStateTorture(engine: any): {
    violations: Array<{ rule: 'hover' | 'press' | 'restore'; node: UINode; path: string; detail: string }>;
    counts: Record<'hover' | 'press' | 'restore', number>;
    allowances: Record<'hover' | 'press' | 'restore', number>;
    walked: number;
    sealed: number;
  };

  /**
   * The resize walker. Every resizable surface (window handle kits and
   * ResizeGrip hosts) is driven grow -> floors -> restore through its own handle
   * events; after each step the page auditor re-runs (spills/phantom bars are the
   * audit's law) and atBottom scrollbacks must hold their pin. Rules: 'dead',
   * 'spill', 'pin', 'restore'. `?resize=1` titles `RESIZE <total>`;
   * `auditAllow('resize')` mutes a surface wholesale (rationed).
   */
  export function runResizeTorture(engine: any): {
    violations: Array<{ rule: 'dead' | 'spill' | 'pin' | 'restore'; node: UINode; path: string; detail: string }>;
    counts: Record<'dead' | 'spill' | 'pin' | 'restore', number>;
    walked: number;
    sealed: number;
    allowed: number;
  };

  // ---- the long winter ----
  export class RecipeBrowser extends UINode {
    constructor(opts?: {
      recipes?: Array<{ id: string | number; label?: string; icon?: string; out?: { id: string | number; count?: number }; needs?: Array<{ id: string | number; count?: number }>; category?: string }>;
      categories?: Array<{ id: string; label?: string }>;
      /** The game's inventory truth: (id) => count. Call refresh() after any decrement. */
      have?: (id: string) => number;
      width?: number; height?: number; onCraft?: (e: { id: string; count: number; out: { id: string; count: number }; needs: Array<{ id: string; count: number }> }, ev?: any) => void;
    });
    /** LOUD `craft {id, count, out, needs}` with everything ×N-scaled; the GAME decrements, then refresh() re-tints. */
    craft(): this;
    select(id: string | number | null): this;
    refresh(): this;
    setDisabled(v: boolean): void;
    qty: NumberField;
    craftBtn: Button;
  }
  export class ProcessPanel extends UINode {
    /** input/fuel/output are 1×1 ItemGrids — the drag protocol interops whole; itemchange bubbles through the panel. */
    constructor(opts?: {});
    /** 0..1 head fill (presentation; the game clocks the burn). */
    setProgress(v: number): this;
    setDisabled(v: boolean): void;
    input: ItemGrid;
    fuel: ItemGrid;
    output: ItemGrid;
    readonly progress: number;
  }
  export class CompassStrip extends UINode {
    constructor(opts?: { width?: number; heading?: number; markers?: Array<{ bearing: number; color?: string }> });
    /**
     * Normalizes to 0..360. The committed number lands instantly (readout, `change {value}`
     * on silent: false); the displayed tape slides the SHORTEST arc 0.3s — `animate: false`
     * snaps (the per-frame aim path). The 359→0 wrap is free either way.
     */
    setHeading(deg: number, opts?: { silent?: boolean; animate?: boolean }): this;
    /** Markers with non-finite bearings are DROPPED with a once-per-key warn (they used to vanish silently at a NaN position; setHeading has guarded the same class since it shipped). */
    setMarkers(markers: Array<{ bearing: number; color?: string }>): this;
    heading: number;
    readout: TextNode;
  }

  /** The day/clock dial ('s cut line, graduated): a procedural sun/moon ring. Own-raster — zero atlas cost. */
  export class DayDial extends UINode {
    /** The committed 0..1 day fraction (0 = midnight, 0.5 = noon). */
    time: number;
    constructor(opts?: { size?: number; time?: number });
    /** Wraps (1.35 lands at 0.35). Loud calls commit `change {value}`. */
    setTime(t: number, opts?: { silent?: boolean }): this;
  }

  // ---- the speaking stones ----
  /** One body part's condition; ranks clamp 0..3, flags coerce. */
  export interface BodyPartState { damage: number; bleed: boolean; missing: boolean; scars: number; }
  export class BodyDoll extends UINode {
    constructor(opts?: {
      /** Subset of the thirteen part ids (head, neck, back, chest, abdomen, l-arm, r-arm, l-hand, r-hand, l-leg, r-leg, l-foot, r-foot); unknown ids warn once and skip. Non-listed parts still draw, inert. */
      parts?: string[];
      /** Tooltip-title overrides per part id (consumer data, rendered verbatim). */
      labels?: Record<string, string>;
      /** Initial state map, applied silent. */
      state?: Record<string, Partial<BodyPartState>>;
      /** Total width (>= 170); height derives from the figure's aspect. */
      width?: number;
      onPartChange?: (e: { part: string; [k: string]: any }, ev?: any) => void;
      onPartClick?: (e: any) => void;
      disabled?: boolean;
    });
    /** Merge-patch one part; no-op patches emit nothing; silent by default. Dispatches `partchange {part, damage, bleed, missing, scars}` on loud commits. Parts dispatch `partclick` (same payload) on click/Enter/gamepad-A. */
    setPart(id: string, patch: Partial<BodyPartState>, opts?: { silent?: boolean }): this;
    setParts(map: Record<string, Partial<BodyPartState>>, opts?: { silent?: boolean }): this;
    getPart(id: string): BodyPartState | null;
    getParts(): Record<string, BodyPartState>;
    /** The active part ids, frozen, in Tab order. */
    readonly parts: readonly string[];
    setDisabled(v: boolean): void;
  }
  export class EquipmentRack extends UINode {
    constructor(opts?: {
      /** Constructor-fixed zone list; `label` is consumer data (fallback: the id); `accepts` types the zone's doorway; `items` seed silent. */
      zones?: Array<{ id: string; label?: string; slots?: number; cols?: number; accepts?: (itemId: string, count: number) => boolean; items?: Array<{ index?: number; id: string; count?: number; durability?: number }> }>;
      gap?: number; locked?: boolean;
      onEquipChange?: (e: { zone: string; index: number; item: string | null; count: number; action: string }, ev?: any) => void;
    });
    /** The live zone records; `grid` is the REAL ItemGrid (full surface). */
    zones: Array<{ id: string; label: string; grid: ItemGrid }>;
    getZone(id: string): ItemGrid | null;
    /** Game-authoritative passthrough — bypasses the zone's accepts like the grid's own setItem. Zone changes re-dispatch as `equipchange {zone, index, item, count, action}` (the raw itemchange/transfer still bubble). */
    setItem(zoneId: string, index: number, itemId: string, count?: number, opts?: { silent?: boolean; durability?: number }): this;
    getItem(zoneId: string, index: number): { item: string; count: number } | null;
    clearSlot(zoneId: string, index: number, opts?: { silent?: boolean }): this;
    /** Arms shift-click quick-UNEQUIP on every zone toward the bag (dragging is the way in). */
    linkTransfer(bag: ItemGrid): this;
    /** The strip: sweeps every zone into the bag and voices ONCE — one 'swap' if anything moved, one 'error' if anything stayed worn. Returns total stacks moved. */
    transferAll(bag: ItemGrid): number;
    setLocked(v: boolean): this;
    setZoneLocked(zoneId: string, v: boolean): boolean;
    setDisabled(v: boolean): void;
  }

  // ---- the whispering stage ----
  /** Cinematic top/bottom bars on the dedicated cinematic layer (above tooltips, below the vignette; photo mode spares both). Mounts itself. show() engages EldNotify.doNotDisturb; hide() restores the PRIOR flag value once the bars have fully left; dispose and destroy both release the mute. */
  export class LetterboxBars extends UINode {
    shown: boolean;
    constructor(opts?: { coverage?: number; dur?: number; dnd?: boolean });
    show(opts?: { silent?: boolean }): this;
    hide(opts?: { silent?: boolean }): this;
  }
  /** The TextNode reveal seam wearing the 'type' voice; reducedMotion lands every reveal instantly (the promise still resolves). */
  export class TypewriterText extends TextNode {}
  /** A MenuList that COMMITS: picks fire `choice {index, id, choice, timeout:false}`; the optional countdown expires into `{index:-1, timeout:true}`. `timerRing` (an ArcGauge) is created but NOT mounted — place it beside the list. Hidden choices never build rows; a sealed list holds its clock. */
  export class ChoiceList extends MenuList {
    choices: Array<{ id?: any; text?: string; disabled?: boolean; hidden?: boolean }>;
    timerRing: ArcGauge | null;
    constructor(opts?: { choices?: Array<{ id?: any; text?: string; disabled?: boolean; hidden?: boolean }>; width?: number; timer?: number; onChoice?: (index: number, payload: any) => void });
  }
  /** The parchment book (own-raster — zero atlas cost; deterministic grain, so frozen snapshots stay bit-stable): one entry per page, rich-text bodies, prev/next, an unread chip. */
  export class Journal extends UINode {
    entries: Array<{ id?: any; title?: string; body?: string; read: boolean }>;
    constructor(opts?: { width?: number; height?: number; title?: string; entries?: Array<{ id?: any; title?: string; body?: string; read?: boolean }>; onChange?: (v: any, payload: any) => void });
    /** Opens on the new entry, unread. Loud commits `change {action:'add', id}`. */
    addEntry(entry: { id?: any; title?: string; body?: string; read?: boolean }, opts?: { silent?: boolean }): this;
    /** Clears the unread chip. Loud commits `change {action:'read', id}`. */
    markRead(id: any, opts?: { silent?: boolean }): this;
    /** Clamped page walk; dispatches `change {action:'page', value}` (the nav Buttons already voice the click). */
    setPage(i: number): this;
  }
  /** A single found document on the same parchment. */
  export class DocumentViewer extends UINode {
    constructor(opts?: { width?: number; height?: number; title?: string; text?: string; onChange?: (v: any, payload: any) => void });
    /** Silent by default (the uniform contract; the bare `{silent}` destructure used to default LOUD, undeclared). */
    setDocument(doc?: { title?: string; text?: string }, opts?: { silent?: boolean }): this;
  }
  /** One speaker-colored line near the bottom safe area; a new say() supersedes the last (its promise settles). Mounts itself on the overlay. The queue fell per the cut line. */
  export class SubtitleBar extends UINode {
    constructor(opts?: { width?: number; safeBottom?: number });
    say(spec?: { speaker?: string; text?: string; color?: string; duration?: number }): Promise<SubtitleBar>;
    clear(): this;
  }
  /** The "UI itself goes mad" controller: set(level 0..1) drives the engine vignette's breathing and a render-only tremor through the fxOffset seam — layout worlds and hit rects never move. Level 0 restores everything EXACTLY; reducedMotion zeroes the tremor and holds a static depth. No voice: sanity is game state, not a gesture. */
  export class SanityFX extends UINode {
    level: number;
    constructor(opts?: { targets?: UINode[]; maxOffset?: number; onChange?: (v: number, payload: any) => void });
    /** Silent by default (the uniform contract; narrative.html already passed {silent:true} at every call site). */
    set(level: number, opts?: { silent?: boolean }): this;
    setTargets(nodes: UINode[]): this;
  }

  // ---- the lantern bearer (nested rings) ----
  /** One sector of a RadialMenu ring. `reason` explains a sealed sector at the cursor (the disabled+reason contract); a non-empty `children` makes the sector a PARENT — activating it swaps the SAME ring in place for the child items plus a Back sector. */
  export interface RadialItem {
    id?: any;
    icon?: string;
    label?: string;
    disabled?: boolean;
    reason?: string;
    children?: RadialItem[];
    /** Per-leaf verb (the EldContextMenu per-entry precedent): fires on select with the breadcrumb payload — how radial-chain provider items carry their actions. */
    onSelect?: (payload: { index: number; id: any; item: RadialItem; path: any[] }) => void;
  }
  /** The summoning circle: an own-raster annular wheel whose HIT AREA IS THE RING (containsPoint override — corners and the center hole fall through; the same predicate fences focus). Mounts itself hidden on the overlay. Click-toggle protocol (hold-open fell per the cut line). NESTED RINGS : `select` fires on LEAVES only with the breadcrumb `path` (`select {index, id, item, path}`); `descend {id, item, path}` / `ascend {path, depth}` narrate ring swaps; Escape/gamepad-B pops ONE level per press (the child ring is the top surface), outside-press and Tab close the whole wheel, and a closed wheel always rests on its ROOT ring. Mouse hover, arrow-walk, and the self-polled left stick all pick sectors; Enter/gamepad-A activates through the focus fence; C1 focus restore hands back with the captured source. */
  export class RadialMenu extends UINode {
    /** Convention 3: the disable verb — landed in src and API.md, missed here until the 3.2.x review. */
    setDisabled(v: boolean): void;
    isOpen: boolean;
    index: number;
    rOut: number;
    rIn: number;
    /** The ROOT items array, forever — nested descent swaps only the displayed ring (drives read this while the wheel is closed). */
    items: RadialItem[];
    /** How deep the wheel stands: 0 = the root ring, 1 = inside one submenu, … */
    readonly depth: number;
    /** `getGamepads` is the deterministic-test seam (mirrors GamepadNav's). `ground: true` registers THIS wheel as the radial chain's terminus — the wheel an unconsumed right-click lands on when no radialItems provider answers (last registration wins; dispose unregisters). */
    constructor(opts?: { items?: RadialItem[]; rOut?: number; rIn?: number; onSelect?: (index: number, item: RadialItem) => void; getGamepads?: () => any[]; ground?: boolean });
    /** NaN or offscreen centers clamp to a reachable spot (clamp law). mounts on the `radial` band (above every overlay mount; a presenting modal makes an open wheel CLOSE), and open/close narrate loud `open {x, y — the clamped center}` / `close {}` ({silent} gates only the voice). */
    open(x?: number, y?: number, opts?: { silent?: boolean }): this;
    close(opts?: { silent?: boolean }): this;
    toggle(x?: number, y?: number, opts?: { silent?: boolean }): this;
    /** Sealed wedges can UNLOCK by play (missed here until -check). The id form searches the WHOLE nested tree — a hidden branch's flip renders on the next descend; the index form addresses the CURRENTLY displayed ring. Disabling a parent seals descent into its subtree. */
    setItemEnabled(idOrIndex: any, enabled?: boolean): this;
    /** The per-gesture ground form: a function may return null to keep a gesture silent (the strategy-hud partition); pass null to clear. */
    static setGround(menuOrFn: RadialMenu | ((e: { target: UINode; x: number; y: number; native: any }) => RadialMenu | null) | null): typeof RadialMenu;
  }
  /** A name plate over SegmentedBar phases with an enrage BigTimer slot. Phases are the health story: setPhase fills that many segments (loud commits `change {value, action:'phase'}`); enrage() raises the clock and its timeout re-dispatches as `enrage`. Damage-flash fell per the cut line. */
  export class BossBar extends UINode {
    phase: number;
    phases: number;
    bar: SegmentedBar;
    timer: BigTimer;
    constructor(opts?: { name?: string; phases?: number; width?: number; onChange?: (v: number, payload: any) => void });
    setPhase(p: number, opts?: { silent?: boolean }): this;
    enrage(seconds?: number): this;
    clearEnrage(): this;
  }

  // ---- the drawn hand ----
  /** Card def shape shared by Card, Pile, and the deckbuilder recipes. */
  export interface CardDef { id?: any; name?: string; cost?: number; type?: string; body?: string; art?: string | null; rarity?: 'common' | 'rare' | 'epic' | 'legendary'; size?: 'hand' | 'full' }
  export const CARD_SIZES: { hand: { w: number; h: number }; full: { w: number; h: number } };
  /** A procedural own-raster card frame (rarity trim via the COLORS.rarity* tokens, painted cost gem, art well fed by the icon registry, compileMarkup rich-text body). The instance owns its canvas — ZERO atlas cost. Furniture (cost, name, type, body, art) rides the paint as declared children. */
  export class Card extends UINode {
    id: string;
    cost: number;
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
    cardSize: 'hand' | 'full';
    playable: boolean;
    constructor(opts?: CardDef);
    /** The affordance film: light what the current energy can pay for. */
    setPlayable(v: boolean): this;
  }
  /** The arc that holds the hand: overlap-resolving layout at 1..12 cards, hover-lift with parting neighbors, drag-to-play under the drag laws (one gesture one pointer, Escape cancels, a disposed card cancels). A release over a registered target or above the fan line commits loud `play {card, onto}` — `onto` is the landing node or null, because the event plane owns `target`; if the handler leaves the card in the fan it flies home (an unclaimed play bounces). The flying card IS the ghost — the target arrow fell per the cut line. */
  export class HandFan extends UINode {
    cards: Card[];
    maxWidth: number;
    constructor(opts?: { cards?: Card[]; maxWidth?: number; lift?: number; arc?: number; onPlay?: (e: { card: Card; onto: UINode | null }, ev?: any) => void });
    /** Nodes a release may land on; the page lights its own targets off `dragstart`/`dragend`. */
    setTargets(nodes: UINode[]): this;
    /** `from` (engine coords) seats the card there first — the deal flight; reflow tweens unless `animate: false`. */
    addCard(card: Card, opts?: { from?: { x: number; y: number } | null; animate?: boolean }): this;
    /** Removes WITHOUT disposing (the consumer owns the card's fate); `to` flings it there first. */
    removeCard(card: Card, opts?: { to?: { x: number; y: number } | null; dispose?: boolean; animate?: boolean }): this;
    /** Lift a card as though the pointer were on it (a tutorial pointing at the play, an AI preview). `null` drops the lift; a card outside this fan is ignored. */
    setHover(card: Card | null): this;
    setDisabled(v: boolean): void;
  }
  /** A mound of card DEFS (plain objects — nodes are built only to browse) with a painted count badge. Click/Enter opens a browse Window of inert Cards; Escape or a second activation closes it. push/pop are the model verbs and speak `pilechange {count, action}`. */
  export class Pile extends UINode {
    readonly count: number;
    readonly cards: CardDef[];
    kind: 'draw' | 'discard';
    constructor(opts?: { kind?: 'draw' | 'discard'; label?: string; cards?: CardDef[]; browse?: boolean; onChange?: (e: { count: number; action: string }, ev?: any) => void });
    setCards(defs: CardDef[], opts?: { silent?: boolean }): this;
    push(def: CardDef, opts?: { silent?: boolean }): this;
    pop(opts?: { silent?: boolean }): CardDef | null;
    closeBrowse(): this;
    setDisabled(v: boolean): void;
  }
  /** The third graph skin (SkillTree/TechTree kin): floors climb bottom-up, `requires` carries the path edges, reachability derives from the CURRENT position, and the traveled path stays lit. Clicking an available node commits loud `advance {id, floor}` — the run MODEL belongs to the consumer. */
  export class RunMap extends UINode {
    position: string | null;
    visited: Set<string>;
    /** owned (traveled or standing) | available (a forward door) | locked. The `.graph` window into the old core died with the core — read states here. */
    getState(id: string): 'owned' | 'available' | 'locked' | null;
    surface: PanZoomSurface;
    constructor(opts?: { data?: { nodes: Array<{ id: string | number; icon?: string; floor?: number; rank?: number; requires?: Array<string | number> }> }; position?: string | number | null; width?: number; height?: number; plateSize?: number; floorGap?: number; colGap?: number; floorLabels?: string[] | ((floor: number) => string); onAdvance?: (e: { id: string; floor: number }, ev?: any) => void });
    setData(data: { nodes: any[] }, opts?: { position?: string | number | null }): this;
    /** Programmatic position (load/restore); the click path is the loud one. */
    setPosition(id: string | number | null, opts?: { silent?: boolean }): this;
    setDisabled(v: boolean): void;
  }

  // ---- the iron sights ----
  /** Composable center styles (dot | cross | circle | chevron) over four spread arms whose offset IS the bloom — `setSpread(px)` moves quads, nothing repaints on the hot path. `flash('hit'|'kill')` tints the sight briefly (a feedback hold that survives reducedMotion). Own-raster + quads: zero atlas cost. */
  export class Reticle extends UINode {
    style: 'cross' | 'dot' | 'circle' | 'chevron';
    spread: number;
    constructor(opts?: { style?: 'cross' | 'dot' | 'circle' | 'chevron'; size?: number; spread?: number; armLength?: number; color?: string });
    /** NaN keeps the last spread; negatives clamp to 0. */
    setSpread(px: number): this;
    setStyle(style: 'cross' | 'dot' | 'circle' | 'chevron'): this;
    flash(kind?: 'hit' | 'kill'): this;
  }
  /** Pooled X flashes on the FloatText protocol: fixed pool, steal-the-oldest on exhaustion (combat never allocates mid-fight), tween lifetime back to the pool; reducedMotion appears at rest and fades in place. One shared raster tinted per spawn — kill markers read blood. */
  export class HitMarker extends UINode {
    readonly liveCount: number;
    poolSize: number;
    constructor(opts?: { pool?: number; size?: number });
    /** (x, y) in this node's local space. */
    spawn(x: number, y: number, opts?: { kill?: boolean }): UINode | null;
  }
  /** Mag/reserve numerals with a reload sweep rail. `ammochange {mag, reserve, action}` narrates every model move without a click voice; `lowammo` commits ONCE per threshold crossing; `reloaded` lands when the sweep does (reducedMotion: instantly). A dry trigger voices an error and fires nothing. */
  export class AmmoCounter extends UINode {
    mag: number;
    magSize: number;
    reserve: number;
    isReloading: boolean;
    constructor(opts?: { mag?: number; magSize?: number; reserve?: number; warnAt?: number; onChange?: (e: { mag: number; reserve: number; action: string }, ev?: any) => void });
    fire(n?: number): this;
    setAmmo(mag: number, reserve?: number, opts?: { silent?: boolean }): this;
    reload(dur?: number): this;
  }
  /** A directional arc on an own-raster ring: `hit(bearing)` lights a 70-degree wedge at that bearing (0 = ahead = top, 180 = behind = bottom, clockwise) and fades it out; ONE active arc — stacking fell per the cut line. NaN bearings read as 0. */
  export class DamageIndicator extends UINode {
    radius: number;
    lastBearing: number | null;
    constructor(opts?: { radius?: number; thickness?: number; dur?: number });
    hit(bearing: number): this;
  }
  /** Pooled rich-text rows, newest on top: `push({killer, weapon, victim, self})` renders `killer {icon:weapon} victim`, holds each row for its TTL, fades it back to the pool, and evicts the oldest past maxRows. Self rows wear the accent film. */
  export class Killfeed extends UINode {
    readonly liveCount: number;
    maxRows: number;
    ttl: number;
    constructor(opts?: { maxRows?: number; ttl?: number; width?: number; rowHeight?: number });
    push(row?: { killer?: string; weapon?: string; victim?: string; self?: boolean }): UINode | null;
    setDisabled(v: boolean): void;
  }

  // ---- the guildhall (the gathering died with its page) ----
  /** One member of the group: the panel displays it; the game owns it. */
  export interface PartyMemberSpec {
    id: string | number;
    name?: string;
    level?: number;
    role?: 'tank' | 'healer' | 'damage';
    leader?: boolean;
    portrait?: string;
    hp?: number; hpMax?: number;
    mp?: number; mpMax?: number;
    state?: 'alive' | 'dead' | 'offline';
  }
  /** Party UNIT frames over member data: each row wraps a real UnitFrame
   *  (portrait, level, tweened health/mana, the buff strip) plus the group
   *  chrome — one leader crown, role glyphs, Dead across an emptied rail,
   *  Offline dimmed and refusing with the error voice, a selection ring, and
   *  ready-check chips (display over game truth — the GAME clocks the answers).
   *  A click on a living or fallen row commits loud `target {id, index,
   *  member}`; `effectclick` bubbles up from each row's buff strip. */
  export class PartyPanel extends UINode {
    constructor(opts?: { members?: PartyMemberSpec[]; gap?: number;
      onTarget?: (value: unknown, e?: any) => void });
    members: Array<Required<PartyMemberSpec>>;
    rows: UINode[];
    target: string | null;
    setMembers(list: PartyMemberSpec[]): this;
    setMember(id: string | number, patch: Partial<PartyMemberSpec>): this;
    removeMember(id: string | number): this;
    memberOf(id: string | number): Required<PartyMemberSpec> | null;
    rowOf(id: string | number): UINode | null;
    setTarget(id: string | number | null, opts?: { silent?: boolean }): boolean;
    beginReadyCheck(): this;
    setReady(id: string | number, ready: boolean): this;
    clearReadyCheck(): this;
    readyState(id: string | number): 'pending' | 'yes' | 'no' | null;
    addEffect(id: string | number, spec: { icon: string; name: string; desc?: string; duration?: string; buff?: boolean }): UINode | null;
    removeEffect(id: string | number, fx: UINode): this;
    clearEffects(id: string | number): this;
    setDisabled(v: boolean): void;
  }

  // ---- the counting house ----
  /** One series of a chart: name, optional color, numeric points (index-based x). */
  export interface ChartSeries { name?: string; color?: string; points?: number[]; hidden?: boolean }
  /** Canvas-painted multi-series line chart (one instance-owned canvas, re-rendered on setData — the TextNode pattern): axes/ticks/gridlines, a scale that survives negatives (zero line drawn) and a single point (a dot on a padded band), a clickable legend (a chip CLICK commits loud `serieschange {name, visible}` with a voice), and a hover value readout via EldTooltip (crosshair fell per the cut line). */
  export class LineChart extends UINode {
    series: Array<{ name: string; color: string; points: number[]; hidden: boolean }>;
    constructor(opts?: { series?: ChartSeries[]; width?: number; height?: number; title?: string; legend?: boolean; onSeries?: (e: { name: string; visible: boolean }, ev?: any) => void });
    setData(series: ChartSeries[], opts?: { silent?: boolean }): this;
    /** Silent by default (the uniform contract; it was loud AND clicked at the user on programmatic calls). The legend chips pass {silent:false}. */
    setSeriesVisible(name: string, visible: boolean, opts?: { silent?: boolean }): this;
    setDisabled(v: boolean): void;
  }
  /** The grouped-bar sibling of LineChart: same scale/legend/tooltip contract, negatives hang below the zero line, optional x labels. */
  export class BarChart extends UINode {
    series: Array<{ name: string; color: string; points: number[]; hidden: boolean }>;
    constructor(opts?: { series?: ChartSeries[]; labels?: string[]; width?: number; height?: number; title?: string; legend?: boolean; onSeries?: (e: { name: string; visible: boolean }, ev?: any) => void });
    setData(series: ChartSeries[], opts?: { silent?: boolean }): this;
    /** Silent by default (see LineChart.setSeriesVisible). */
    setSeriesVisible(name: string, visible: boolean, opts?: { silent?: boolean }): this;
    setDisabled(v: boolean): void;
  }
  /** A row of a TreeTable: id, cells keyed by column, optional children. */
  export interface TreeRow { id: string | number; cells: Record<string, string | number>; children?: TreeRow[] }
  /** Indent + expand/collapse over a FLATTENED visible list riding VirtualList (virtualization-aware by construction; 5k rows stay one screenful of nodes). The expanded set is keyed by id and survives sort and setRows; sorting orders SIBLINGS recursively and stays stable (ties keep insertion order). Header clicks sort loud. */
  export class TreeTable extends UINode {
    expanded: Set<string>;
    sortKey: string | null;
    sortDir: 1 | -1;
    columns: Array<{ key: string; label: string; width: number }>;
    /** A row-body click dispatches `rowactivate {row}` and calls onActivate(row) (the option was declared and stored but never invoked; the expander zone keeps its own click). */
    constructor(opts?: { columns?: Array<{ key: string; label?: string; width?: number }>; rows?: TreeRow[]; width?: number; height?: number; rowH?: number; onActivate?: (row: TreeRow) => void });
    setRows(rows: TreeRow[]): this;
    /** Silent by default (the rule — it was loud AND clicked at the user on programmatic calls, while toggle() below always spoke the contract). Header clicks pass {silent:false}, so the gesture stays loud. */
    sort(key: string, dir?: number, opts?: { silent?: boolean }): this;
    toggle(id: string | number, opts?: { silent?: boolean }): this;
    expandAll(): this;
    collapseAll(): this;
    setDisabled(v: boolean): void;
  }
  /** The persistent prioritized center (the routing terminus): priority orders the ledger (ties keep arrival order), unread wears the accent dot, a click marks read and commits loud `jump {id}` (plus the note's own onJump). Bounded by maxNotes; re-pushing an id refreshes it. */
  export class NotificationCenter extends UINode {
    notes: Array<{ id: string; title: string; priority: number; read: boolean }>;
    readonly unreadCount: number;
    constructor(opts?: { width?: number; maxVisible?: number; maxNotes?: number; title?: string; onJump?: (e: { id: string }, ev?: any) => void });
    /** Silent by default; {silent:false} commits `notechange {id, count, unread, action:'push'}` (the commit was permanently dead behind a literal `true`; `action` names the verb). */
    push(note?: { id?: string | number; title?: string; priority?: number; onJump?: (id: string) => void }, opts?: { silent?: boolean }): string;
    /** Silent by default; {silent:false} commits `notechange {id, count, unread, action:'dismiss'}` (dismissals were voiceless before). */
    dismiss(id: string | number, opts?: { silent?: boolean }): boolean;
    markRead(id: string | number, opts?: { silent?: boolean }): this;
    /** Silent by default; {silent:false} commits `readchange {id: null, unread: 0}`. */
    markAllRead(opts?: { silent?: boolean }): this;
    jump(id: string | number): this;
    setDisabled(v: boolean): void;
  }

  // ---- coda & coin-op ----
  /** The counting-number rollup every arcade ending deserves: lines reveal in order, each number COUNTS through its values on the ticker, and the rank stamps last with a pop. Under reducedMotion (or `skip()`) the whole tally LANDS instantly at its final numbers — the numbers are the contract, the motion is juice. `tallydone {total, rank}` commits loud once when the last digit lands. SplitTimer fell per the cut line. */
  export class ScoreTally extends UINode {
    lines: Array<{ label: string; value: number }>;
    rank: string | null;
    revealed: boolean;
    modal: boolean;
    /** The veil, built on the first modal reveal; null until then. */
    scrim: UINode | null;
    continueBtn: Button;
    readonly total: number;
    constructor(opts?: { lines?: Array<{ label?: string; value?: number }>; rank?: string | null; width?: number; countDur?: number; title?: string; modal?: boolean; continueLabel?: string; onContinue?: () => void; onDone?: (e: { total: number; rank: string | null }, ev?: any) => void });
    setLines(lines: Array<{ label?: string; value?: number }>): this;
    /**
     * Run the ending. `modal: true` RAISES the panel and its veil onto the overlay
     * band together, from whatever parent the consumer used, so the victory can
     * never render under its own scrim; `dismiss()` lowers it back home.
     */
    reveal(opts?: { instant?: boolean }): this;
    skip(): this;
    /** Hide the panel (and the veil), returning it to the parent it was raised from. */
    dismiss(): this;
    setDisabled(v: boolean): void;
  }

  // ---- the war table ----
  export class SelectionMarquee extends UINode {
    /** Mount on engine.layers.ghost. Arms only on a press over EMPTY SPACE; narrates `marquee {x,y,w,h,phase,shift}` and `marqueeend {x,y,w,h,shift,canceled}` — the GAME intersects the rect with its entities. */
    constructor(opts?: { onSelect?: (r: { x: number; y: number; w: number; h: number; shift: boolean; canceled: boolean }) => void });
  }
  export class CommandCard extends UINode {
    constructor(opts?: {
      commands?: Array<{ id: string | number; icon?: string; hotkey?: string | { pad?: string; mouse?: number }; cost?: number; disabled?: boolean }>;
      units?: Array<{ id: string | number; icon?: string; count?: number }>;
      cols?: number; gap?: number; onCommand?: (e: { id: string; cost: number | null }, ev?: any) => void;
    });
    /** Clicks and bus hotkeys (single-atom keyboard binds, matched while nothing holds focus) both dispatch `command {id, cost}`. */
    setCommands(commands: any[]): this;
    setUnits(units: any[]): this;
    setCommandDisabled(id: string | number, v: boolean): boolean;
    setDisabled(v: boolean): void;
  }
  export class BuildQueue extends UINode {
    constructor(opts?: { slots?: number; gap?: number; queue?: any[]; onCancel?: (e: { index: number; id: string }, ev?: any) => void });
    /** Data-driven: a slot click dispatches `cancel {index, id}`; the game mutates and calls setQueue back. */
    setQueue(items: Array<{ id: string | number; icon?: string; count?: number }>): this;
    /** The head-of-queue fill, 0..1 (presentation; the game clocks production). */
    setProgress(v: number): this;
    setDisabled(v: boolean): void;
    queue: any[];
  }
  export class TacticalMap extends UINode {
    constructor(opts?: { width?: number; height?: number; world?: { w: number; h: number }; terrain?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; onMove?: (e: { x: number; y: number }, ev?: any) => void });
    /** The camera footprint in WORLD coordinates; null hides the rect. */
    setViewport(rect: { x: number; y: number; w: number; h: number } | null): this;
    /** A finite pulse at world coords (waypoints ring in quest-gold); returns the auto-disposing node. Clicks dispatch `moveto {x, y}` in world coordinates. */
    ping(x: number, y: number, opts?: { waypoint?: boolean }): UINode;
    setDisabled(v: boolean): void;
    world: { w: number; h: number };
  }

  // ---- the talent grid: the WoW-Classic tier law ----
  // (the graph skins — SkillTree/TechTree — and core
 // died with destroy ruling; the grid below replaced them whole)
  /** One discipline's dataset: a fixed grid of tiers by up to four columns; ranks are the WoW n/m. */
  export interface TalentDef {
    id: string;
    icon?: string;
    /** 1-based row; the tier unlocks at 5*(tier-1) points spent IN THIS TREE. */
    tier?: number;
    /** 0..3 — the classic four-column pane. */
    col?: number;
    /** 1..5, default 1: one point per rank, no per-node prices. */
    maxRank?: number;
    /** A prerequisite talent id — it must be MAXED before this one opens (the golden arrow). */
    requires?: string | null;
    name?: string;
    desc?: string;
    /** One string per rank; the tooltip shows the current AND next rank. */
    rankDesc?: string[];
  }
  export interface TalentData { name?: string; talents: TalentDef[] }
  export type TalentState = 'locked-tier' | 'locked-prereq' | 'available' | 'ranked' | 'maxed';
  export class TalentTree extends UINode {
    /** LEFT-click learns a rank (loud `spend {id, rank, tier, spent, points}`); RIGHT-click — and Minus/Delete on the FOCUSED plate — unlearns one under the legality oracle and is ALWAYS consumed by the grid (the radial chain and the hotkey bus stay out); refusals speak the error voice. */
    constructor(opts?: { data?: TalentData; points?: number; plateSize?: number; onSpend?: (e: { id: string; rank: number; tier: number; spent: number; points: number }, ev?: any) => void; onRefund?: (e: { id: string; rank: number; tier: number; spent: number; points: number }, ev?: any) => void });
    /** The FED unspent pool — a page or TalentPanes grants it; spending drains it one point per rank. */
    points: number;
    name: string;
    setData(data: TalentData): this;
    setPoints(v: number, opts?: { silent?: boolean }): this;
    /** The silent load path: applies tier-ascending, drops whatever breaks the tier/prerequisite law (warn-once). Commits `rankschange {ranks}`. */
    setRanks(map: Record<string, number>, opts?: { silent?: boolean }): this;
    getRanks(): Record<string, number>;
    getRank(id: string): number;
    getState(id: string): TalentState | null;
    getSpent(): number;
    canSpend(id: string): boolean;
    /** The refund legality oracle: no ranked dependent may lose its maxed prerequisite; no higher tier may fall below its gate. */
    canRefund(id: string): boolean;
    /** Zeroes every rank and credits the refund to the pool — no confirm here (TalentPanes carries the guarded Reset). Commits `reset {refunded, points}`. */
    reset(opts?: { silent?: boolean }): this;
    setDisabled(v: boolean): void;
  }
  export class TalentPanes extends UINode {
    /** N panes around ONE shared unspent pool; child spend/refund events bubble through gaining a `tree` field, and the pool re-feeds every pane. */
    constructor(opts?: { panes?: Array<{ id: string; data: TalentData }>; points?: number; plateSize?: number; onSpend?: (e: any, ev?: any) => void; onRefund?: (e: any, ev?: any) => void; onReset?: (e: { refunded: number; points: number }, ev?: any) => void });
    points: number;
    pane(id: string): TalentTree | null;
    getSpent(): number;
    setPoints(v: number, opts?: { silent?: boolean }): this;
    /** Confirm-guarded through EldPopup (the respec epoch guard: a queued confirm can never double-refund). Dispatches `reset {refunded, points}`. */
    reset(): this;
    /** The silent load path (no events): pool + per-pane ranks, invariants enforced. */
    restore(state?: { points?: number; ranks?: Record<string, Record<string, number>> }): this;
    serialize(): { points: number; ranks: Record<string, Record<string, number>> };
    setDisabled(v: boolean): void;
  }

  // ---- the shipped theme presets ----
  /** A theme payload for init({ theme }). */
  export interface ThemePreset {
    colors?: Record<string, string>;
    fonts?: Record<string, string>;
    metrics?: Record<string, number>;
    seeds?: { offset?: number };
    painters?: Record<string, (ctx: CanvasRenderingContext2D, w: number, h: number) => void>;
  }
  /** Warm tycoon metalwork: tokens + seed + one painter override (the select stud). */
  export const brass: ThemePreset;
  /** Clean sci-fi glass: tokens + seed alone — palettes re-skin without painters. */
  export const aether: ThemePreset;

  // ---- the namespace ----
  export const Eldritch: {
    engine: EldritchEngine | null;
    version: string;
    /** The boot taskbar instance (null before init or with init({taskbar:false})). */
    taskbar: Taskbar | null;
    /** The reduced-motion gate: while true the animate presets collapse to instant. Survives destroy(). */
    reducedMotion: boolean;
    strings: Record<string, string>;
    init(options?: {
      container?: HTMLElement; width?: number; height?: number; windowContainer?: UINode;
      taskbar?: boolean; background?: boolean; vignette?: boolean; timerDriven?: boolean;
      transparent?: boolean;
      /** Default true: the canvas takes DOM focus at boot (preventScroll), so the keyboard — every Eldritch.onKey binding — is live before the first click. Pass false when embedding in a host page you do not own (embed.html). */
      bootFocus?: boolean;
      /** Default true. Pass false and the ENGINE CANVAS suppresses the native browser context menu wholesale — the option for pages that wire right-click surfaces (the radial ground wheel). Canvas-scoped: a host document around an embedded stage keeps its own menu outside the canvas. The one-shot suppression from preventDefault() on a `rightclick` event works regardless. */
      contextMenu?: boolean;
      theme?: {
        colors?: Record<string, string>; fonts?: Record<string, string>; metrics?: Record<string, number>;
        seeds?: { offset?: number };
        /** Re-bake named registry art at boot: frames keep their slice metrics; painters read the THEMED COLORS. */
        painters?: Record<string, (ctx: CanvasRenderingContext2D, w: number, h: number) => void>;
      };
      /** Couch-distance scaling: logical px = css / uiScale; shipped steps 1/1.25/1.5/2 (others snap with a warning). */
      uiScale?: number;
      strings?: Record<string, string>;
      input?: { gamepad?: boolean };
    }): typeof Eldritch;
    /** Capture-safe hiding: every UI band sleeps except the listed nodes; (true) restores exact prior visibility. */
    setHUDVisible(visible: boolean, opts?: { except?: UINode[] }): typeof Eldritch;
    readonly hudVisible: boolean;
    /**
     * THE hotkey path — focus-aware by construction; use this instead of
     * window.addEventListener('keydown').
     * `down` fires while nothing holds focus, or when a focused non-text widget
     * left the key unconsumed (3.2.x) — EXCEPT Escape, Enter, and Space, which
     * never fall through (focused, they belong to dismissal/activation; a binding
     * on them fires only from the idle table — Enter-to-chat rides exactly that).
     * Typing the letter into a TextField always stays
     * typing; `up` fires only for a key THIS registration saw go down, so a release
     * landing while a field has focus still clears the hold instead of stranding it.
     * Key match is case-insensitive; auto-repeat is suppressed unless `repeat: true`.
     * Returns an unsubscribe function. Throws before init(). Never bind 'Tab' —
     * focus traversal consumes it before the bus emit (the engine warns).
     */
    onKey(
      key: string | string[],
      handlers?: {
        down?: (e: { key: string; code: string; native: KeyboardEvent }) => void;
        up?: (e: { key: string; code: string; native: KeyboardEvent }) => void;
        repeat?: boolean;
      },
    ): () => void;
    destroy(): void;
    config(opts: any): typeof Eldritch;
    /** Base path prefixed to relative asset URLs; config({ assetBase }) writes it. */
    assetBase: string;
    registerIcon(name: string, painter: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void;
    registerAbility(id: string, spec: { name?: string; desc?: string; stats?: string; flavor?: string; painter?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }): void;
    registerItem(id: string, spec: { name?: string; desc?: string; icon?: string; rarity?: string; stackMax?: number; data?: any }): void;
    /**
     * The optional icon pack (assets/icons — 60 sheets, 3,840 icons). Registers a
     * curated set through registerIcon: every `icon.<id>` consumer works unchanged;
     * missing assets degrade to a legible letter-glyph plate.
     *
     * THE RE-SKIN IDIOM: point `as` at an ALREADY-BAKED icon id and the registry
     * re-bakes that one name IN PLACE — live quads follow with no page code, the
     * atlas count never moves, and `fallback: 'none'` leaves the procedural art
     * standing when the assets are absent. Await before construction only when
     * registering NEW names.
     *
     * The sheets ship with opaque black backgrounds; the decode keys black to
     * alpha so pack art seats in the carved plate instead of covering it. Pass
     * `keyBlack: false` for a pack that already carries its own alpha.
     */
    loadIcons(opts?: {
      base?: string;
      icons?: Array<string | { id: string; as?: string }>;
      sheets?: string[];
      fallback?: 'glyph' | 'none';
      keyBlack?: boolean;
      size?: number;
    }): Promise<{ registered: string[]; missing: string[] }>;
    /**
     * Bulk pack access for browsers/tools: one PACK-OWNED texture per sheet (zero
     * registry entries) and per-icon THREE.Texture views via offset/repeat, each
     * window inset half a source texel against neighbour bleed. The pack owns
     * every GPU handle it mints: `dispose()` frees them, `trim(keep)` releases the
     * sheets outside `keep`, and `Eldritch.destroy()` drains any live pack so no
     * handle outlives its engine.
     */
    loadIconPack(opts?: { base?: string; keyBlack?: boolean }): Promise<{
      list: Array<{ id: string; slug: string; name: string; type: string; category: string; tags: string[]; sheet: string; row: number; col: number }>;
      sheets: Array<{ id: string; slug: string; title: string; category: string }>;
      categories: string[];
      get(idOrSlug: string): any;
      find(q?: { category?: string | null; sheet?: string | null; text?: string | null }): any[];
      ensure(sheetIds: string[]): Promise<void>;
      texture(sheetId: string): any;
      view(idOrSlug: string): any;
      /** Release every sheet outside `keep` (dispose their views first). */
      trim(keep: string[]): any;
      stats(): { sheetsLoaded: number; views: number };
      dispose(): void;
    }>;
  };
}

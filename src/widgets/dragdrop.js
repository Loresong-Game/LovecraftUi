// EldDragDrop: the slot/palette drag protocol. Palette icons are an infinite source; slots move/swap the
// real icon nodes (never duplicates). Click on a filled action slot always triggers the action
// (cooldown is visual only). Locked action bars are click-only; equipment slots are unaffected.

import { UINode } from '../node.js';
import { QuadNode, NineSliceNode } from '../primitives.js';
import { TextNode } from '../text.js';
import { COLORS, FONTS, METRICS } from '../theme.js';
import { hitTest } from '../hit.js';
import { renumber } from '../layers.js';
import { EldTooltip, abilityData, formatIconName, itemData, rarityColor, widgetsEngine, requireEngine, uisound, setNodeDisabled } from './widgets.js';
import { isReducedMotion } from '../animate.js';
import { EldEvents } from './events.js';
import { str } from '../strings.js';
import { keyGlyphTexture } from './worldui.js'; // single-atom keybinds render as keycap art

const tex = (name) => requireEngine().textures.get(name); // friendly pre-init throw
const frame = (name) => requireEngine().textures.frame(name);

// ---------------- nodes ----------------

// note: icons own their touch gestures (drag-to-slot), so lists of slots never pan from an icon
export class DraggableIcon extends UINode {
  // opts.item = { id, count }: this icon is an ITEM STACK (inventory suite) rather than
  // a rite — it carries itemId/count, shows item lore (rarity-tinted title, live count),
  // and the drop protocol routes it through the stacking branches.
  constructor(iconName, opts = {}) {
    super({ interactive: true });
    this.touchDragOwner = true;
    this.iconName = iconName;
    this.fromPalette = opts.fromPalette ?? false;
    this.itemId = opts.item ? String(opts.item.id) : null;
    this.count = opts.item ? Math.max(1, Math.floor(opts.item.count ?? 1)) : 1;
    this.quad = new QuadNode({ texture: tex(`icon.${iconName}`) });
    this.add(this.quad);
    this.setSize(opts.size ?? 44, opts.size ?? 44) // the palette-icon default (was 40);
    // press is the DRAG ARM — pickup feedback (ghost, dim, target lights)
    // rides the drag threshold by protocol design; a still finger is
    // deliberately quiet, so the states walker must not demand press art here
    this.auditAllow('press');
    this.on('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // window raise still happens via the engine bus
      EldDragDrop._beginPending(e, this);
    });
    if (this.itemId != null) {
      EldTooltip.attach(this, () => {
        const d = itemData(this.itemId);
        return {
          title: d.name, titleColor: rarityColor(d.rarity), desc: d.desc,
          lines: [{
            text: this.count > 1 ? str('stackOf', this.count) : formatIconName(d.rarity),
            color: COLORS.textMuted,
          }],
        };
      });
    } else if (this.fromPalette) {
      EldTooltip.attach(this, { title: formatIconName(iconName), desc: str('paletteHint') });
      this.on('pointerenter', () => { const g = widgetsEngine(); if (!g) return; if (isReducedMotion()) { g.ticker.cancelPropTween(this, 'fxScale'); this.fxScale = 1.1; } else g.ticker.tween(this, { fxScale: 1.1 }, { dur: 0.1 }); });
      this.on('pointerleave', () => { const g = widgetsEngine(); if (!g) return; if (isReducedMotion()) { g.ticker.cancelPropTween(this, 'fxScale'); this.fxScale = 1; } else g.ticker.tween(this, { fxScale: 1 }, { dur: 0.1 }); });
    } else {
      const d = abilityData(iconName);
      EldTooltip.attach(this, { title: d.name, desc: d.desc, stats: [d.stats] });
    }
  }
  onLayout() { this.quad.setRect(0, 0, this.w, this.h); }
}

export class ActionSlot extends UINode {
  constructor(slotId, opts = {}) {
    super({ interactive: true });
    this.isDropTarget = true;
    this.slotId = String(slotId);
    this.slotKind = 'action';
    this.bg = new QuadNode({ texture: tex('slot.frame') });
    this.hoverOverlay = new QuadNode({ texture: tex('slot.hover') });
    this.hoverOverlay.visible = false;
    this.cooldownOverlay = new QuadNode({ texture: tex('slot.cooldown') });
    this.cooldownOverlay.visible = false;
    this.cooldownText = new TextNode('', { size: 18, weight: 'bold', color: COLORS.textWhite, shadow: { color: '#000', dx: 1, dy: 1, blur: 2 } });
    this.cooldownText.visible = false;
    // the countdown deliberately rides the icon (a shaded veil + a centered
    // number IS the cooldown state) — declared like every wash/badge overlay; the
    // census never saw one because cooldowns exist only mid-interaction
    this.cooldownOverlay.auditAllow('overlap');
    this.cooldownText.auditAllow('overlap');
    this.icon = null;
    this.add(this.bg, this.hoverOverlay, this.cooldownOverlay, this.cooldownText);
    this.setSize(METRICS.slotSize, METRICS.slotSize);
    this._dragOver = false;
    // hover reaches disabled subtrees (the tooltip rule) — the overlay seals itself
    this.on('pointerenter', () => {
      if (!EldDragDrop.isDragging && !this.closest((n) => n.disabled === true)) this.hoverOverlay.visible = true;
    });
    this.on('pointerleave', () => { if (!this._dragOver) this.hoverOverlay.visible = false; });
    this.focusable = true;
    this.onActivate = () => EldDragDrop.triggerAction(this); // Enter/gamepad-A fires the rite
    if (opts.register !== false) EldDragDrop.actionSlots.add(this);
  }

  setIcon(iconNode) {
    this.icon = iconNode;
    if (iconNode) {
      iconNode.setSize(METRICS.slotIcon, METRICS.slotIcon);
      this.add(iconNode);
      // keep overlays and the hotkey label above the icon in paint order
      this.add(this.hoverOverlay, this.cooldownOverlay, this.cooldownText);
      if (this.keybindText) this.add(this.keybindText);
      if (this.keybindGlyph) this.add(this.keybindGlyph);
    }
    this.invalidateLayout();
  }

  takeIcon() { const ic = this.icon; this.icon = null; return ic; }

  setDragOver(v) {
    if (this._dragOver === v) return;
    this._dragOver = v;
    this.hoverOverlay.visible = v;
    this.bg.material.color.set(v ? 0x9adfb2 : 0xffffff); // brightness(1.3) equivalent tint
  }

  setCooldown(remaining) {
    const on = remaining > 0;
    this.cooldownOverlay.visible = on;
    this.cooldownText.visible = on;
    if (on) this.cooldownText.setText(String(remaining));
  }

  // The hotkey label in the slot's corner: setKeybind('3'); null clears.
  // a single-atom bind renders as KeyGlyph ART (the keycap
 // family everywhere binds appear); combos ('Ctrl+3') keep the compact text form,
  // The keycap was unreadable at the old size, so it draws
  // at 20 now — the free-standing KeyGlyph size the legends already use — so a
  // digit reads at ~10px instead of ~6.5. The 22px bake is untouched (the
  // glyph identity pins hold); a 20px corner still has no room for a combo
  // row, which keeps the TextNode arm.
  setKeybind(label) {
    if (this.keybindText) { this.keybindText.dispose(); this.keybindText = null; }
    if (this.keybindGlyph) { this.keybindGlyph.dispose(); this.keybindGlyph = null; }
    if (label == null || label === '') return;
    const s = String(label);
    if (!s.includes('+')) {
      const t = keyGlyphTexture(s);
      this.keybindGlyph = new QuadNode({ texture: t });
      const h = 20;
      this.keybindGlyph.setRect(3, 3, Math.round(t.userData.cssW * (h / t.userData.cssH)), h);
      this.add(this.keybindGlyph);
    } else {
      this.keybindText = new TextNode(s, {
        font: FONTS.mono, size: 12, color: COLORS.bone,
        shadow: { color: 'rgba(0,0,0,0.9)', dx: 1, dy: 1, blur: 2 },
      });
      this.add(this.keybindText);
    }
    this.invalidateLayout();
  }

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.hoverOverlay.setRect(0, 0, this.w, this.h);
    this.cooldownOverlay.setRect(0, 0, this.w, this.h);
    this.cooldownText.setPos(Math.round((this.w - this.cooldownText.w) / 2), Math.round((this.h - this.cooldownText.h) / 2));
    if (this.icon) this.icon.setPos(Math.round((this.w - this.icon.w) / 2), Math.round((this.h - this.icon.h) / 2));
    if (this.keybindText) this.keybindText.setPos(4, 3);
    if (this.keybindGlyph) this.keybindGlyph.setPos(3, 3);
  }

  disposeSelf() { EldDragDrop.actionSlots.delete(this); }
}

export class CpSlot extends UINode {
  constructor(slotId, opts = {}) {
    super({ interactive: true });
    this.opts = opts; // reserved for equipment typing (residual) — accepted today
    this.focusable = true;
    this.isDropTarget = true;
    this.slotId = String(slotId);
    this.slotKind = 'cp';
    this.bg = new QuadNode({ texture: tex('cpslot.frame') });
    this.hoverOverlay = new QuadNode({ texture: tex('cpslot.hover') });
    this.hoverOverlay.visible = false;
    this.icon = null;
    this.add(this.bg, this.hoverOverlay);
    this.setSize(METRICS.cpSlotSize, METRICS.cpSlotSize);
    this._dragOver = false;
    // hover reaches disabled subtrees (the tooltip rule) — the overlay seals itself
    this.on('pointerenter', () => {
      if (!EldDragDrop.isDragging && !this.closest((n) => n.disabled === true)) this.hoverOverlay.visible = true;
    });
    this.on('pointerleave', () => { if (!this._dragOver) this.hoverOverlay.visible = false; });
  }

  setIcon(iconNode) {
    this.icon = iconNode;
    if (iconNode) {
      iconNode.setSize(METRICS.cpSlotIcon, METRICS.cpSlotIcon);
      this.add(iconNode);
      this.add(this.hoverOverlay);
    }
    this.invalidateLayout();
  }

  takeIcon() { const ic = this.icon; this.icon = null; return ic; }

  setDragOver(v) {
    if (this._dragOver === v) return;
    this._dragOver = v;
    this.hoverOverlay.visible = v;
    this.bg.material.color.set(v ? 0x9adfb2 : 0xffffff);
  }

  setCooldown() {} // equipment slots show no cooldown

  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.hoverOverlay.setRect(0, 0, this.w, this.h);
    if (this.icon) this.icon.setPos(Math.round((this.w - this.icon.w) / 2), Math.round((this.h - this.icon.h) / 2));
  }
}

export class IconPalette extends UINode {
  constructor(iconNames, opts = {}) {
    super({ interactive: true });
    this.bg = new NineSliceNode(frame('panel.dark'));
    this.add(this.bg);
    this.icons = iconNames.map(n => new DraggableIcon(n, { fromPalette: true }));
    this.add(...this.icons);
    const perRow = opts.perRow ?? iconNames.length;
    const rows = Math.ceil(this.icons.length / perRow);
    // the pitch DERIVES from the icon size (was a literal 50 against a
    // 40 default — the drifted-formula class the polish retires)
    this._pitch = (this.icons[0]?.w ?? 44) + 10;
    this.setSize(12 + perRow * this._pitch + 2, 12 + rows * this._pitch + 2);
    this._perRow = perRow;
  }
  onLayout() {
    this.bg.setRect(0, 0, this.w, this.h);
    this.icons.forEach((ic, i) => {
      ic.setPos(12 + (i % this._perRow) * this._pitch, 12 + Math.floor(i / this._perRow) * this._pitch);
    });
  }

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

// ActionBar: the composite the cookbook used to hand-roll — a rows x cols grid of
// ActionSlots with an optional bar lock hanging off its right edge. Slot ids are
// globally unique so EldDragDrop.serialize() snapshots stay unambiguous across bars.
let _barSeq = 0;

export class ActionBar extends UINode {
  constructor({ rows = 1, cols = 6, lock = false, gap = 6 } = {}) {
    super({});
    // B5: finite-first + capped — destructuring defaults only catch undefined;
    // rows/cols: Infinity hung the tab building ActionSlots forever
    rows = Math.max(1, Math.min(64, Math.floor(Number.isFinite(rows) ? rows : 1)));
    cols = Math.max(1, Math.min(64, Math.floor(Number.isFinite(cols) ? cols : 6)));
    gap = Number.isFinite(gap) ? Math.max(0, gap) : 6; // gap rides every slot position and the bar rect
    const S = METRICS.slotSize;
    const barId = 'bar' + (++_barSeq);
    this.slots = [];
    for (let i = 0; i < rows * cols; i++) {
      const s = new ActionSlot(`${barId}-${i}`);
      this.slots.push(s);
      this.add(s);
    }
    this.cols = cols;
    this.rows = rows;
    this.gap = gap;
    this.lock = lock ? new ActionbarLock() : null;
    if (this.lock) {
      this.add(this.lock);
      EldDragDrop.registerLock(this.lock);
    }
    const gridW = cols * (S + gap) - gap;
    this.setSize(gridW + (this.lock ? this.lock.w + 10 : 0), rows * (S + gap) - gap);
  }

  onLayout() {
    const S = METRICS.slotSize;
    this.slots.forEach((s, i) => {
      s.setPos((i % this.cols) * (S + this.gap), Math.floor(i / this.cols) * (S + this.gap));
    });
    if (this.lock) {
      this.lock.setPos(this.cols * (S + this.gap) - this.gap + 10, Math.round((this.h - this.lock.h) / 2));
    }
  }
}

export class ActionbarLock extends UINode {
  constructor() {
    super({ interactive: true });
    this.quad = new QuadNode({ texture: tex('lock.unlocked'), opacity: 0.6 });
    this.add(this.quad);
    this.setSize(28, 28); // was 24, sitting exactly on the hit floor; the art stays at its bake size
    // hover AND press read in BOTH lock states (the states-walker law) — the
    // unlocked icon rests dim and brightens toward the finger; the locked icon
    // rests full and dips, so feedback never vanishes at either rest level
    this.on('pointerenter', () => this.quad.setBaseOpacity(EldDragDrop.isLocked ? 0.85 : 0.9));
    this.on('pointerleave', () => this.refresh());
    this.on('pointerdown', () => this.quad.setBaseOpacity(EldDragDrop.isLocked ? 0.7 : 1));
    this.on('pointerup', (e) => { if (e.canceled) this.refresh(); else this.quad.setBaseOpacity(EldDragDrop.isLocked ? 0.85 : 0.9); }); // canceled ups end dark (B3)
    this.on('click', () => EldDragDrop.toggleLock());
    EldTooltip.attach(this, () => ({
      title: str(EldDragDrop.isLocked ? 'lockSealedTitle' : 'lockUnsealedTitle'),
      desc: str(EldDragDrop.isLocked ? 'lockSealedDesc' : 'lockUnsealedDesc'),
    }));
  }
  refresh() {
    this.quad.setTexture(tex(EldDragDrop.isLocked ? 'lock.locked' : 'lock.unlocked'));
    this.quad.setBaseOpacity(EldDragDrop.isLocked ? 1 : 0.6);
  }
  onLayout() { this.quad.setRect(Math.round((this.w - 20) / 2), Math.round((this.h - 20) / 2), 20, 20); } // 20px bake centered in the zone
  disposeSelf() { EldDragDrop.locks.delete(this); } // symmetric with ActionSlot's

  // Convention 3: the uniform disable verb. Inert at the input layer and
  // subtree-scoped, so disabling this also seals everything inside it.
  setDisabled(v) { setNodeDisabled(this, v); }
}

// ---------------- the system ----------------

export const EldDragDrop = {
  engine: null,
  isLocked: false,
  isDragging: false,
  isPending: false,
  dragThreshold: METRICS.dragThreshold,
  iconCooldowns: new Map(), // iconName -> {remaining, intervalId}
  actionSlots: new Set(),
  locks: new Set(),
  _pending: null,
  _ghost: null,
  _lastOver: null,
  listeners: null, // global emitter node for slotchange/action-triggered
  confirmDiscard: null, // entry-wired discard prompt (see _confirmItemDiscard)

  init(engine) {
    this.engine = engine;
    this.listeners = new UINode({ name: 'dragdrop-bus' });
    this._offs = [
      engine.bus.on('pointermove', (e) => this._onMove(e)),
      engine.bus.on('pointerup', (e) => this._onUp(e)),
      engine.bus.on('pointercancel', (e) => this._onUp(e, true)),
      // B7: Escape cancels a live gesture — a drag is the topmost interaction and no
      // escape-stack surface owns it. Presses BLUR focus (input.js), so during any
      // pointer drag the key arrives on the BUS plane; same canceled-finish funnel
      // as the modal shield (EldPopup._present) and the B4 dispose watch.
      engine.bus.on('keydown', (e) => {
        if (e.key === 'Escape' && (this.isPending || this.isDragging)) {
          this.cancelDrag();
          e.native?.preventDefault?.();
        }
      }),
      // B10: a wheel scroll can slide slots under a STATIONARY ghost — re-derive the
      // drop highlight at the cursor after the scroll (the release already re-derives;
      // this closes the cosmetic gap the B9 keep-wheel-live ruling left open)
      engine.bus.on('wheel', (e) => {
        if (!this.isDragging) return;
        const over = this._dropTargetAt(e.x, e.y);
        if (over !== this._lastOver) {
          if (this._lastOver) this._lastOver.setDragOver(false);
          if (over) over.setDragOver(true);
          this._lastOver = over;
        }
      }),
    ];
    return this;
  },

  // Teardown hook: kills cooldown timers (they would keep firing on disposed slots),
  // bus subscriptions, and all registered collections.
  _reset() {
    this._offSourceDispose?.(); this._offSourceDispose = null; // B4: destroy-mid-drag
    for (const { stop } of this.iconCooldowns.values()) stop?.();
    this.iconCooldowns.clear();
    if (this._offs) { for (const off of this._offs) off(); this._offs = null; }
    this.actionSlots.clear();
    this.locks.clear();
    this.isLocked = false;
    this.isDragging = false;
    this.isPending = false;
    this._pending = null;
    this._ghost = null;
    this._lastOver = null;
    this.listeners = null;
    this.confirmDiscard = null; // re-wired by the entry on every boot
    this.engine = null;
    // slot ids restart per boot: a serialize() snapshot taken before a destroy can
    // restore() onto identically-built bars after re-init (SPA remount)
    _barSeq = 0;
  },

  on(type, fn) { return this.listeners.on(type, fn); },

  registerLock(lockNode) { this.locks.add(lockNode); lockNode.refresh(); },

  toggleLock() {
    this.isLocked = !this.isLocked;
    for (const l of this.locks) l.refresh();
    EldEvents.log(str(this.isLocked ? 'barLockedLog' : 'barUnlockedLog'));
  },

  _slotOf(icon) {
    // Any registered slot family (action/cp/item) — duck-typed so slot classes defined
    // in other modules (ItemSlot) participate without an import cycle.
    return icon.closest(n => n.isDropTarget === true && n.slotKind != null);
  },

  _beginPending(e, icon) {
    // C3: one gesture, one pointer — a second finger's press while a drag is pending
    // or flying is DEAF (it used to overwrite _pending: the first ghost leaked in the
    // ghost layer, its source stayed dimmed, and its own up became a foreign pointer)
    if (this.isPending || this.isDragging) return;
    this._pending = {
      x: e.x, y: e.y,
      pointerId: e.pointerId ?? null,
      icon,
      iconName: icon.iconName,
      sourceSlot: this._slotOf(icon),
    };
    this.isPending = true;
    this.isDragging = false;
    // B4: the SOURCE disposing mid-gesture (its window closed, its grid rebuilt)
    // must cancel the drag — a release after that would mutate a corpse slot whose
    // listeners are already null, so the game never hears the take-out and the
    // container's model resurrects the item (a duplication-shaped bug).
    // C2: the watch sits on the ICON, not the slot — setItem/clearSlot dispose the
    // icon while the slot LIVES (mutation is not container death), and a slot-watch
    // never fired: the ghost kept flying a disposed payload and the drop placed it
    // (resurrection/duplication). A slot or grid dispose still cancels transitively
    // dispose recurses to the icon riding inside it (the pin holds).
    const src = icon ?? this._pending.sourceSlot;
    this._offSourceDispose?.();
    this._offSourceDispose = src.on('dispose', () => this.cancelDrag());
  },

  // A drag gesture belongs to one pointer; moves/ups from other simultaneous pointers
  // must not steer or finish it.
  _ownsGesture(e) {
    const pid = this._pending?.pointerId;
    return pid == null || e.pointerId == null || e.pointerId === pid;
  },

  _onMove(e) {
    if (!this._ownsGesture(e)) return;
    if (this.isPending && !this.isDragging) {
      const dx = e.x - this._pending.x, dy = e.y - this._pending.y;
      if (Math.sqrt(dx * dx + dy * dy) > this.dragThreshold) {
        // locked action slots are click-only: cancel the whole gesture.
        // A sealed (locked) item grid seals its slots the same way.
        const src = this._pending.sourceSlot;
        if ((this.isLocked && src instanceof ActionSlot) ||
            (src?.slotKind === 'item' && src.grid?.locked)) {
          this.isPending = false;
          this._pending = null;
          return;
        }
        this._startDrag(e);
      }
    }
    if (this.isDragging) {
      this._ghost.setPos(Math.round(e.x - METRICS.dragGhost / 2), Math.round(e.y - METRICS.dragGhost / 2));
      const over = this._dropTargetAt(e.x, e.y);
      if (over !== this._lastOver) {
        if (this._lastOver) this._lastOver.setDragOver(false);
        if (over) over.setDragOver(true);
        this._lastOver = over;
      }
    }
  },

  _startDrag(e) {
    this.isDragging = true;
    this.isPending = false;
    uisound(this._pending?.icon ?? null, 'pickup');
    // hover re-evaluation is capture-suppressed for the whole drag, so no pointerleave
    // will ever hide a tooltip that was showing — kill it here or it rides the ghost
    EldTooltip.hideNow();
    const p = this._pending;
    this.listeners.emit('dragstart', { icon: p.iconName, source: p.sourceSlot ?? null });
    p.icon.fxOpacity = 0.5;
    const ghost = new UINode({ name: 'drag-ghost' });
    ghost.interactive = false;
    // ghost polish: a soft void backing seats the flying icon (reads as "held",
    // not pasted); the icon rides on top at the classic alpha
    const back = new QuadNode({ color: COLORS.voidBlack, opacity: 0.35 });
    back.setRect(-3, -3, METRICS.dragGhost + 6, METRICS.dragGhost + 6);
    const q = new QuadNode({ texture: tex(`icon.${p.iconName}`), opacity: 0.8 });
    q.setRect(0, 0, METRICS.dragGhost, METRICS.dragGhost);
    ghost.add(back, q);
    ghost.setRect(Math.round(e.x - METRICS.dragGhost / 2), Math.round(e.y - METRICS.dragGhost / 2), METRICS.dragGhost, METRICS.dragGhost);
    this.engine.layers.ghost.add(ghost);
    this._ghost = ghost;
    this._lightValidTargets(); // every legal destination glows
  },

  // ---- (the design requirement): valid-destination lighting ----
  // On drag start every drop target that would ACCEPT the payload wears a steady
  // accent film (METRICS.washFocus) — distinct from the stronger dragover art the
  // hovered slot adds on top. Cleared on drop, cancel, or blur (every path funnels
  // through _onUp). The film is a full-slot overlay by design (declared).
  _lightValidTargets() {
    const eng = this.engine;
    if (eng.paintDirty) renumber(eng); // any paintList reader renumbers first
    const p = this._pending;
    const payload = {
      itemId: p.icon?.itemId ?? null,
      count: p.icon?.count ?? 1,
      sourceSlot: p.sourceSlot ?? null,
    };
    this._litTargets = [];
    for (const n of eng.paintList) {
      if (!n.isDropTarget || n === p.sourceSlot || !n._visible) continue;
      if (n.closest((x) => x.disabled === true)) continue; // sealed subtrees stay dark
      if (this._acceptVeto(n, payload)) continue;
      this._setSlotValid(n, true);
      this._litTargets.push(n);
    }
  },

  _clearValidTargets() {
    for (const n of this._litTargets ?? []) if (!n.disposed) this._setSlotValid(n, false);
    this._litTargets = [];
  },

  _setSlotValid(slot, v) {
    if ((slot._dragValid === true) === v) return;
    slot._dragValid = v;
    if (v && !slot._validWash) {
      const wash = new QuadNode({ color: COLORS.accent, opacity: 0 });
      wash.auditAllow('containment'); // a full-slot film, deliberately edge-to-edge
      slot._validWash = wash;
      slot.add(wash);
    }
    if (slot._validWash) {
      slot._validWash.setRect(0, 0, slot.w, slot.h);
      slot._validWash.setBaseOpacity(v ? METRICS.washFocus : 0);
    }
  },

  // The single validity oracle (extracted from performDrop's refusal ladder).
  // Returns the refusal reason, or null when the payload may land. performDrop maps
  // reasons onto its voiced refusals; _lightValidTargets treats any reason as dark.
  _acceptVeto(targetSlot, { itemId = null, count = 1, sourceSlot = null } = {}) {
    const isItemDrag = itemId != null;
    const isItemTarget = targetSlot.slotKind === 'item';
    if (isItemDrag !== isItemTarget) return 'family'; // rites and items never mix
    if (isItemDrag) {
      if (targetSlot.grid?.locked) return 'sealed';
      // zone typing: entry from ANOTHER container needs the target doorway, and
      // a displacing swap needs the source doorway too (both directions, no mutation)
      const tGrid = targetSlot.grid ?? null;
      const sGrid = sourceSlot?.grid ?? null;
      if (tGrid !== sGrid) {
        if (tGrid?.accepts && !tGrid.accepts(itemId, count)) return 'zone';
        const disp = targetSlot.icon;
        if (disp && disp.itemId !== itemId && sGrid?.accepts && !sGrid.accepts(disp.itemId, disp.count)) return 'zone';
      }
      const tIcon = targetSlot.icon;
      if (tIcon && tIcon.itemId === itemId && itemData(itemId).stackMax - tIcon.count <= 0) return 'stackFull';
      return null;
    }
    if (this.isLocked && targetSlot instanceof ActionSlot) return 'barLocked';
    return null;
  },

  // Public: would this target accept the payload right now? (the design requirement's oracle —
  // games can pre-light their own chrome with the same truth the drop uses)
  canAccept(targetSlot, payload) { return this._acceptVeto(targetSlot, payload) === null; },

  _dropTargetAt(x, y) {
    // Occlusion-aware: only the TOPMOST thing under the cursor counts. If it is (or sits
    // inside) a drop target, that target receives the drop; anything else — a window body,
    // a panel, a label — blocks the drop. Never "see through" occluders to buried slots.
    const top = hitTest(this.engine, x, y);
    const target = top ? top.closest(n => n.isDropTarget) : null;
    // Convention 3: a slot inside a disabled subtree still occludes, but it is sealed —
    // it never receives a drop (and never lights dragover through _onMove).
    if (target && target.closest(n => n.disabled === true)) return null;
    return target;
  },

  _onUp(e, canceled = false) {
    if (!this._ownsGesture(e)) return;
    if (this.isPending || this.isDragging) { this._offSourceDispose?.(); this._offSourceDispose = null; }
    if (this.isPending && !this.isDragging) {
      // click path
      const p = this._pending;
      this.isPending = false;
      this._pending = null;
      if (!canceled && p.sourceSlot instanceof ActionSlot) this.triggerAction(p.sourceSlot);
      return;
    }
    if (!this.isDragging) return;
    const p = this._pending;
    this.isDragging = false;
    this._pending = null;
    this._ghost.dispose();
    this._ghost = null;
    p.icon.fxOpacity = 1;
    if (this._lastOver) { this._lastOver.setDragOver(false); this._lastOver = null; }
    this._clearValidTargets(); // every path — drop, miss, cancel — ends dark
    if (canceled) {
      this.listeners.emit('dragend', { icon: p.iconName, canceled: true, target: null });
      return;
    }
    const target = this._dropTargetAt(e.x, e.y);
    if (target) {
      this.performDrop(target, p.iconName, p.sourceSlot, p.icon);
    } else if (p.sourceSlot instanceof ActionSlot) {
      // Dragging a rite off the bar is the intent to REMOVE it (policy): any
      // release that is not a valid slot removes — bare ground, window bodies, and
      // panels alike. The one shield: transient chrome that APPEARED MID-DRAG (a
      // toast, an open menu, a popup scrim) cancels back — the surface shifted under
      // a release aimed at something else, so nothing is destroyed.
      const hit = hitTest(this.engine, e.x, e.y);
      const root = hit ? hit.closest(n => !n.parent) : null;
      const L = this.engine.layers;
      if (root && (root === L.overlay || root === L.tooltip || root === L.dropdown)) {
        EldEvents.log(str('dragReturned', p.iconName, p.sourceSlot.slotId));
        this.updateCooldownVisuals();
      } else {
        const icon = p.sourceSlot.takeIcon();
        if (icon) icon.dispose();
        EldEvents.log(str('riteRemoved', p.iconName, p.sourceSlot.slotId));
        uisound(p.sourceSlot, 'drop', { action: 'remove' });
        this._dispatchSlotChange(p.sourceSlot, p.iconName, 'remove');
        this.updateCooldownVisuals();
      }
    } else if (p.sourceSlot?.slotKind === 'item') {
      // Inventory: releasing an item anywhere that is not a drop target is the intent
      // to DROP it (policy) — confirmed before anything is destroyed. The icon
      // is already home (it never left its slot); OK clears it through the grid's
      // loud path. Rites' mid-drag transient-chrome shield applies here too.
      const hit = hitTest(this.engine, e.x, e.y);
      const root = hit ? hit.closest(n => !n.parent) : null;
      const L = this.engine.layers;
      if (root && (root === L.overlay || root === L.tooltip || root === L.dropdown)) {
        EldEvents.log(str('dragReturned', p.iconName, p.sourceSlot.slotId));
      } else {
        this._confirmItemDiscard(p.sourceSlot);
      }
    } else if (p.sourceSlot) {
      // equipment (CpSlot) drags keep the cancel behavior
      EldEvents.log(str('dragReturned', p.iconName, p.sourceSlot.slotId));
    }
    this.listeners.emit('dragend', { icon: p.iconName, canceled: false, target: target ?? null });
  },

  // Safety valve: cancel any in-flight drag or pending press as if the pointer were
  // lost (window blur uses the same canceled-up path) — the icon stays home, the
  // ghost dies, no drop or click resolves. No-op when nothing is pending. The modal
  // popup calls this when its scrim arms.
  cancelDrag() {
    if (!this.isPending && !this.isDragging) return;
    this._onUp({ pointerId: this._pending?.pointerId ?? null, x: -1, y: -1 }, true);
  },

  // The drop-to-discard flow: the item stayed home when the drag resolved to no
  // target; the entry-wired confirm hook (lovecraft-ui.js — dragdrop cannot import
  // windows.js without closing an import cycle) asks, and OK clears the stack through
  // the grid's loud path. Slot state re-checks at confirm time: a merge/move that
  // landed while the dialog sat open keeps the newer stack untouched.
  _confirmItemDiscard(slot) {
    const icon = slot.icon;
    if (!icon || typeof this.confirmDiscard !== 'function') {
      EldEvents.log(str('dragReturned', icon?.iconName ?? '?', slot.slotId));
      return;
    }
    const d = itemData(icon.itemId);
    this.confirmDiscard({ slot: slot.slotId, item: icon.itemId, count: icon.count, name: d.name }, () => {
      if (slot.disposed || slot.icon !== icon) return;
      const n = icon.count;
      slot.grid?.clearSlot(slot.index, { silent: false });
      EldEvents.log(n > 1 ? str('discardedMany', n, d.name) : str('discardedOne', d.name));
      uisound(slot, 'drop', { action: 'discard' });
    });
  },

  // ---- living-data slot surface ----

  // Empties a slot programmatically; dispatches the same `slotchange` a user drop would.
  clearSlot(slot) {
    const icon = slot?.icon;
    if (!icon) return false;
    slot.takeIcon();
    const name = icon.iconName;
    icon.dispose();
    this._dispatchSlotChange(slot, name, 'remove');
    this.updateCooldownVisuals();
    return true;
  },

  getSlotIcon(slot) { return slot?.icon?.iconName ?? null; },

  // Silent lock setter (the uniform-contract shape); toggleLock stays the user path.
  setLocked(v) {
    this.isLocked = !!v;
    for (const l of this.locks) l.refresh();
  },

  // Snapshot every registered action slot's rite by slot id. Item grids serialize
  // through their own model (setItem/getItem); equipment through CharacterPanel.
  serialize() {
    const out = {};
    for (const slot of this.actionSlots) out[slot.slotId] = slot.icon?.iconName ?? null;
    return out;
  },

  // Restore a serialize() snapshot: clears every registered slot, then refills.
  restore(state) {
    for (const slot of this.actionSlots) {
      if (slot.icon) { const ic = slot.takeIcon(); ic.dispose(); }
    }
    for (const slot of this.actionSlots) {
      const name = state?.[slot.slotId];
      if (name) this.createIconInSlot(slot, name);
    }
    this.updateCooldownVisuals();
  },

  performDrop(targetSlot, iconName, sourceSlot, draggedIcon) {
    if (sourceSlot === targetSlot) { this.updateCooldownVisuals(); return; }

    // ---- the refusal ladder rides the oracle (one truth for drops AND lighting);
    // each reason keeps its own voice. Refusals happen BEFORE any mutation — the icon
    // never left home. `_dropTargetAt` is deliberately NOT filtered by accepts: hiding
    // a refusing zone from target resolution would route the release to the item
    // DISCARD-CONFIRM flow, offering to destroy a stack a zone merely declined. ----
    const veto = this._acceptVeto(targetSlot, {
      itemId: draggedIcon?.itemId ?? null,
      count: draggedIcon?.count ?? 1,
      sourceSlot,
    });
    if (veto) {
      EldEvents.log(str({ family: 'dropRejected', sealed: 'gridSealed', zone: 'zoneRefused', stackFull: 'stackFull', barLocked: 'barLocked' }[veto]));
      uisound(targetSlot, 'error');
      if (veto === 'family' || veto === 'barLocked') this.updateCooldownVisuals();
      return;
    }

    const isItemDrag = draggedIcon?.itemId != null;
    if (isItemDrag) {
      const tIcon = targetSlot.icon;
      if (tIcon && tIcon.itemId === draggedIcon.itemId) {
        // merge: fill the target; the remainder stays behind in the source slot
        // (the oracle already refused FULL stacks — space is positive here)
        const max = itemData(draggedIcon.itemId).stackMax;
        const space = max - tIcon.count;
        const moved = Math.min(space, draggedIcon.count);
        tIcon.count += moved;
        draggedIcon.count -= moved;
        if (draggedIcon.count <= 0) {
          sourceSlot.takeIcon();
          draggedIcon.dispose();
        }
        sourceSlot._refresh?.();
        targetSlot._refresh?.();
        EldEvents.log(str('stackMerged', moved, tIcon.itemId));
        uisound(targetSlot, 'drop', { action: 'merge' });
        this._dispatchItemChange(sourceSlot, tIcon.itemId, Math.max(0, draggedIcon.count), 'merge');
        this._dispatchItemChange(targetSlot, tIcon.itemId, tIcon.count, 'merge');
      } else if (tIcon) {
        // different items: swap the real nodes (counts ride on the icons)
        targetSlot.takeIcon(); sourceSlot.takeIcon();
        sourceSlot.setIcon(tIcon);
        targetSlot.setIcon(draggedIcon);
        sourceSlot._refresh?.();
        targetSlot._refresh?.();
        EldEvents.log(str('swapped', draggedIcon.itemId, tIcon.itemId));
        uisound(targetSlot, 'swap');
        this._dispatchItemChange(sourceSlot, tIcon.itemId, tIcon.count, 'swap');
        this._dispatchItemChange(targetSlot, draggedIcon.itemId, draggedIcon.count, 'swap');
      } else {
        sourceSlot.takeIcon();
        targetSlot.setIcon(draggedIcon);
        sourceSlot._refresh?.();
        targetSlot._refresh?.();
        EldEvents.log(str('itemMoved', draggedIcon.itemId, targetSlot.slotId));
        uisound(targetSlot, 'drop');
        this._dispatchItemChange(sourceSlot, draggedIcon.itemId, 0, 'move');
        this._dispatchItemChange(targetSlot, draggedIcon.itemId, draggedIcon.count, 'move');
      }
      return;
    }

    // (The bar-lock target seal now lives in the oracle above — 'barLocked'.)
    if (sourceSlot && draggedIcon) {
      const targetIcon = targetSlot.icon;
      if (targetIcon) {
        // swap the real nodes
        targetSlot.takeIcon(); sourceSlot.takeIcon();
        sourceSlot.setIcon(targetIcon);
        targetSlot.setIcon(draggedIcon);
        EldEvents.log(str('swapped', iconName, targetIcon.iconName));
        uisound(targetSlot, 'swap');
        this._dispatchSlotChange(sourceSlot, targetIcon.iconName, 'add');
        this._dispatchSlotChange(targetSlot, iconName, 'add');
      } else {
        sourceSlot.takeIcon();
        targetSlot.setIcon(draggedIcon);
        EldEvents.log(str('riteMoved', iconName, sourceSlot.slotId, targetSlot.slotId));
        uisound(targetSlot, 'drop');
        this._dispatchSlotChange(sourceSlot, iconName, 'remove');
        this._dispatchSlotChange(targetSlot, iconName, 'add');
      }
    } else {
      // palette -> slot: infinite source
      const existing = targetSlot.icon;
      if (existing) {
        targetSlot.takeIcon();
        existing.dispose();
        this._dispatchSlotChange(targetSlot, existing.iconName, 'remove');
      }
      this.createIconInSlot(targetSlot, iconName);
      EldEvents.log(str('riteDropped', iconName, targetSlot.slotId));
      uisound(targetSlot, 'drop');
      this._dispatchSlotChange(targetSlot, iconName, 'add');
    }
    this.updateCooldownVisuals();
  },

  createIconInSlot(slot, iconName) {
    const icon = new DraggableIcon(iconName, { fromPalette: false, size: METRICS.slotIcon });
    slot.setIcon(icon);
    return icon;
  },

  triggerAction(slot) {
    if (!slot.icon) return;
    const iconName = slot.icon.iconName;
    EldEvents.log(str('actionTriggered', iconName, slot.slotId));
    this.listeners.emit('action-triggered', { slot: slot.slotId, icon: iconName });
    slot.dispatch('action-triggered', { slot: slot.slotId, icon: iconName });
    uisound(slot, 'click', { action: 'trigger' });
    if (!this.iconCooldowns.has(iconName)) this._startCooldown(iconName);
  },

  _startCooldown(iconName) {
    // Ticker-driven off a wall-clock end time: drift-free across tab suspends, and
    // engine teardown (which clears ticker callbacks) can never strand a timer that
    // would keep poking disposed slots the way a raw interval could.
    const entry = { remaining: METRICS.cooldownSeconds, stop: null };
    const end = performance.now() + METRICS.cooldownSeconds * 1000;
    this.iconCooldowns.set(iconName, entry);
    this.updateCooldownVisuals();
    entry.stop = this.engine.ticker.add(() => {
      const rem = Math.ceil((end - performance.now()) / 1000);
      if (rem === entry.remaining) return;
      if (rem <= 0) {
        entry.stop();
        this.iconCooldowns.delete(iconName);
        uisound(null, 'cooldown', { icon: iconName }); // the ready ping
      } else {
        entry.remaining = rem;
      }
      this.updateCooldownVisuals();
    });
  },

  updateCooldownVisuals() {
    // A cooldown belongs to the RITE, not a slot: every hotbar instance of the icon shows it.
    for (const s of this.actionSlots) {
      const cd = s.icon ? this.iconCooldowns.get(s.icon.iconName) : null;
      s.setCooldown(cd ? cd.remaining : 0);
    }
  },

  _dispatchSlotChange(slot, iconName, action) {
    const detail = { slot: slot.slotId, icon: iconName, action };
    slot.dispatch('slotchange', detail);
    this.listeners.emit('slotchange', detail);
  },

  // Item slots speak itemchange: flat payload, count reflects the slot AFTER the change
  // (0 when the slot emptied). action: 'set' | 'clear' | 'move' | 'swap' | 'merge' | 'split'.
  _dispatchItemChange(slot, itemId, count, action) {
    const detail = { slot: slot.slotId, item: itemId, count, action };
    slot.dispatch('itemchange', detail);
    this.listeners.emit('itemchange', detail);
  },
};

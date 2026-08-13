// Hit testing (reverse paint-order walk — no Raycaster) and hover/enter/leave synthesis.

export function hitTest(engine, x, y, pad = 0) {
  const list = engine.paintList;
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    // disposed nodes linger in the paint list until the next renumber — never hittable
    if (!n.interactive || n.disposed) continue;
    if (n.containsPoint(x, y, pad)) return n;
  }
  return null;
}

// elementsFromPoint equivalent; `filter` narrows (e.g., drop targets).
export function hitTestAll(engine, x, y, filter = null) {
  const out = [];
  const list = engine.paintList;
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (!n.interactive || n.disposed) continue;
    if (filter && !filter(n)) continue;
    if (n.containsPoint(x, y)) out.push(n);
  }
  return out;
}

function pathOf(node) {
  const path = [];
  let n = node;
  while (n) { path.push(n); n = n.parent; }
  return path;
}

export class HoverManager {
  constructor(engine) {
    this.engine = engine;
    this.path = [];      // current hover path, target first
    this.target = null;
  }

  // Re-evaluate hover at pointer position. Suppressed while a pointer gesture holds capture
  // (matches the source library's interaction guard: gestures own the pointer exclusively)
  // and while a pan-scroll owns the pointer — pans hold no capture, but content sliding
  // beneath the pointer must not storm enter/leave on everything it passes.
  update(x, y, force = false) {
    const engine = this.engine;
    if (engine.capturedNode || engine.input?.isPanning) return;
    const hit = engine.pointerInside ? hitTest(engine, x, y) : null;
    if (hit === this.target && !force) return;
    const newPath = hit ? pathOf(hit) : [];
    const newSet = new Set(newPath);
    const oldPath = this.path;
    const oldSet = new Set(oldPath);
    // publish BEFORE the emit loops: engine.hover is public, and an enter/leave
    // handler reading hover.target must see the NEW state, not the node the pointer
    // just left (the capture-then-callback class, hover plane)
    this.path = newPath;
    this.target = hit;
    // leave: deepest-first on nodes no longer in path
    for (const n of oldPath) {
      if (!newSet.has(n)) n.emit('pointerleave', { target: n, x, y });
    }
    // enter: outermost-first on newly entered nodes
    for (let i = newPath.length - 1; i >= 0; i--) {
      const n = newPath[i];
      if (!oldSet.has(n)) n.emit('pointerenter', { target: n, x, y });
    }
    this.applyCursor();
  }

  clear() {
    const oldPath = this.path;
    this.path = [];
    this.target = null;
    for (const n of oldPath) n.emit('pointerleave', { target: n, x: -1, y: -1 });
  }

  applyCursor() {
    if (this.engine.input.isPanning) return; // pan-scroll owns the cursor (isPanning = _pan OR touch-pan)
    let cursor = null;
    for (const n of this.path) { if (n.cursor) { cursor = n.cursor; break; } }
    this.engine.input.setCursor(cursor ?? this.engine.defaultCursor);
  }
}

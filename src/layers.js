// Paint-order renumbering: reproduces DOM compositing with a single global counter on renderOrder.
// Root layers paint in fixed band order. Any node with `sortChildrenByFocus` paints its children
// by ascending focusOrder (the incrementing focus counter mirrored from the source library).
// 3D accents get per-window z-slabs so a lower window's statue never pokes through a higher one.

// 'cinematic': letterbox bars and scene chrome — above every interactive
// surface incl. tooltips, below only the vignette so the frame keeps its mood.
// 'radial': the summoning circle's own band — above 'overlay' so later
// page/runtime add() calls can never bury an open wheel, below 'ghost' (a
// mid-drag ghost still floats over everything) and 'tooltip' (the wheel's
// sealed-sector reason lines, and toasts, render over the ring). Modal popups
// live on 'overlay' BELOW this band; the wheel keeps the law — "on top
// of everything except dialogs" — by CLOSING when engine.modalActive flips
// (see RadialMenu's frame hook), never by sitting buried under a scrim.
export const LAYER_ORDER = ['background', 'windows', 'dropdown', 'taskbar', 'overlay', 'radial', 'ghost', 'tooltip', 'cinematic', 'vignette'];

let _focusCounter = 100; // ever-increasing window z; reset only at full teardown
export function nextFocusOrder() { return ++_focusCounter; }
export function resetFocusCounter() { _focusCounter = 100; }

const ACCENT_SLAB = 50;

export function renumber(engine) {
  let counter = 0;
  let slabIndex = 0;
  const paintList = [];

  const visit = (node, isSlabRoot) => {
    if (!node._visible) return;
    if (isSlabRoot) slabIndex++;
    node.paintIndex = counter;
    paintList.push(node);
    if (node.accent3d) {
      node.setZSlab(ACCENT_SLAB * slabIndex + 10);
      const ro = counter++;
      // renderOrder must go on drawables only: a Group's renderOrder becomes groupOrder,
      // which outranks every per-mesh renderOrder in three's transparent sort.
      node.content.traverse(obj => { if (obj.isMesh || obj.isPoints || obj.isLine) obj.renderOrder = ro; });
    } else if (node.mesh) {
      node.mesh.renderOrder = counter++;
    } else {
      counter++;
    }
    const kids = node.sortChildrenByFocus
      ? [...node.children].sort((a, b) => a.focusOrder - b.focusOrder)
      : node.children;
    for (const c of kids) visit(c, node.sortChildrenByFocus === true);
  };

  for (const layerName of LAYER_ORDER) {
    const layer = engine.layers[layerName];
    if (!layer) continue;
    visit(layer, true);
  }
  engine.paintList = paintList;
  engine.paintDirty = false;
}

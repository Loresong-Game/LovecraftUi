// The Bound Ledger: a small observable store and the one-line widget
// bindings. Paths are dot-strings into a plain-object tree ('player.hp'). Notify is
// MICROTASK-BATCHED: any number of set() calls in one tick flush as one call per
// affected subscriber, each receiving the CURRENT value at its own subscribed path.
// A subscriber fires when its path OVERLAPS a written path in either direction —
// subscribing 'player' hears 'player.hp' sets, and subscribing 'player.hp' hears a
// whole-'player' replacement. Explicit non-goal: computed/derived graphs — this is
// a ledger, not a spreadsheet.

function segs(path) { return String(path).split('.'); }

// segment-wise: is `a` equal to or an ancestor of `b`?
function covers(a, b) {
  if (a === b) return true;
  return b.startsWith(a + '.') || a.startsWith(b + '.');
}

export class Store {
  constructor(initial = {}) {
    this._root = initial;
    this._subs = new Map();    // path -> Set(fn)
    this._dirty = new Set();   // paths written since the last flush
    this._queued = false;
  }

  get(path) {
    let v = this._root;
    for (const k of segs(path)) {
      if (v == null) return undefined;
      v = v[k];
    }
    return v;
  }

  set(path, value) {
    const parts = segs(path);
    let v = this._root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (v[parts[i]] == null || typeof v[parts[i]] !== 'object') v[parts[i]] = {};
      v = v[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    if (v[leaf] === value) return this; // unchanged: no dirty mark, no flush
    v[leaf] = value;
    this._dirty.add(String(path));
    if (!this._queued) {
      this._queued = true;
      queueMicrotask(() => this._flush());
    }
    return this;
  }

  subscribe(path, fn) {
    const key = String(path);
    let set = this._subs.get(key);
    if (!set) { set = new Set(); this._subs.set(key, set); }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this._subs.delete(key);
    };
  }

  _flush() {
    this._queued = false;
    // Friendly-errors v2: a subscriber writing back a value that never
    // settles chains microtask flushes forever and the page never yields. Count
    // CONSECUTIVE flushes; the chain resets whenever a flush ends with nothing
    // re-queued. At the cap, warn once and drop the generation — the store stays
    // usable and the loop is named instead of hanging the tab.
    this._chain = (this._chain ?? 0) + 1;
    if (this._chain >= 64) {
      if (this._chain === 64) {
        console.warn('LovecraftUI Store: 64 consecutive notify flushes without settling - a subscriber is '
          + `probably writing back a value that never converges (paths: ${[...this._dirty].join(', ')}). Dropping this generation.`);
      }
      this._chain = 0;
      this._dirty.clear();
      return;
    }
    const dirty = [...this._dirty];
    this._dirty.clear();
    // each affected subscriber fires ONCE per flush, with its own path's current value
    for (const [subPath, fns] of [...this._subs]) {
      if (!dirty.some((d) => covers(subPath, d))) continue;
      const value = this.get(subPath);
      for (const fn of [...fns]) fn(value, subPath);
    }
    if (!this._queued) this._chain = 0; // settled: the chain ended with this flush
  }
}

// Two-way widget binding: inbound store changes land silently (no change dispatch),
// outbound loud `change` commits write the store. No event loops by construction —
// the inbound path is silent AND skips writes that already match the widget. Initial
// sync: a defined store value wins (pushed into the widget); otherwise the widget's
// current value seeds the store. Returns off(); the widget's dispose also unbinds.
export function bind(widget, store, path) {
  const checked = typeof widget.setChecked === 'function';
  const read = () => (checked ? widget.checked : widget.value);
  const write = (v) => (checked ? widget.setChecked(v, { silent: true }) : widget.setValue(v, { silent: true }));

  const initial = store.get(path);
  if (initial !== undefined) write(initial);
  else store.set(path, read());

  const offStore = store.subscribe(path, (v) => {
    if (v === read()) return; // already in agreement: no write, no churn
    write(v);
  });
  const onChange = (e) => store.set(path, checked ? e.checked : e.value);
  widget.on('change', onChange);
  const offDispose = widget.on('dispose', () => off());
  const off = () => {
    offStore();
    widget.off?.('change', onChange);
    offDispose?.();
  };
  return off;
}

// One-way text binding: the node's text follows the path (through fmt when given).
export function bindText(textNode, store, path, fmt = null) {
  const paint = (v) => textNode.setText(fmt ? fmt(v) : String(v ?? ''));
  paint(store.get(path));
  const offStore = store.subscribe(path, paint);
  const offDispose = textNode.on('dispose', () => offStore());
  return () => { offStore(); offDispose?.(); };
}

// One-way enabled binding: a truthy value enables the widget.
export function bindEnabled(widget, store, path) {
  const apply = (v) => widget.setDisabled(!v);
  apply(store.get(path));
  const offStore = store.subscribe(path, apply);
  const offDispose = widget.on('dispose', () => offStore());
  return () => { offStore(); offDispose?.(); };
}

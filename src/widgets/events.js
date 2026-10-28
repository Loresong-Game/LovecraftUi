// EldEvents: the event log sink. log(message, type) is a no-op until an
// EventLog widget registers itself. Sinks STACK: the newest
// registered log receives the lines; disposing or unregistering it hands the sink back
// to the previously registered one — a temporary log no longer orphans the log beneath.

export const EldEvents = {
  sinks: [],
  // Taps: non-stealing observers — every log line reaches every tap
  // REGARDLESS of the sink stack (the DebugConsole echoes without robbing the
  // game's own EventLog). tap(fn) returns off().
  taps: new Set(),

  // The receiving sink = the top of the stack (readable, as before, for tests).
  get sink() { return this.sinks.length ? this.sinks[this.sinks.length - 1] : null; },

  tap(fn) {
    this.taps.add(fn);
    return () => this.taps.delete(fn);
  },

  // Re-registering a known sink promotes it to the top (never duplicates).
  register(sink) {
    if (!sink) return;
    const i = this.sinks.indexOf(sink);
    if (i !== -1) this.sinks.splice(i, 1);
    this.sinks.push(sink);
  },

  // Disposed logs unregister themselves; removal works from anywhere in the stack.
  unregister(sink) {
    const i = this.sinks.indexOf(sink);
    if (i !== -1) this.sinks.splice(i, 1);
  },

  log(message, type = 'EVENT') {
    for (const t of [...this.taps]) {
      // taps hear even with no sink — and a THROWING tap must not rob the real sink
      // of the line (X16: one buggy observer silenced the whole log path)
      try { t(message, type); } catch (err) { console.warn('LovecraftUI: an EldEvents tap threw; the line still reaches the sink.', err); }
    }
    const top = this.sink;
    if (!top) return;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    top.append(`[${ts}]`, type, message);
  },

  _reset() { this.sinks.length = 0; this.taps.clear(); },
};

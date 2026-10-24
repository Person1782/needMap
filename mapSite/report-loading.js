/**
 * Keeps the initial report loader open while Firestore is still serving an
 * online cache snapshot. Firestore metadata changes provide the later server
 * snapshot; an explicit offline cache state, listener error, or bounded wait
 * also releases it. The Firestore listener remains active after the wait so a
 * later server snapshot can restore the live state.
 */
export const INITIAL_REPORT_LOAD_WATCHDOG_MS = 45_000;

export function createInitialReportLoadGate({
  isOnline = () => globalThis.navigator?.onLine !== false,
  eventTarget = globalThis.window,
  onFinish = () => {},
  watchdogMs = INITIAL_REPORT_LOAD_WATCHDOG_MS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let finished = false;
  let sawSnapshot = false;
  let destroyed = false;
  let watchdogTimer;

  function clearWatchdog() {
    if (watchdogTimer !== undefined) clearTimer(watchdogTimer);
    watchdogTimer = undefined;
  }

  function finish(reason) {
    if (finished || destroyed) return false;
    finished = true;
    clearWatchdog();
    eventTarget?.removeEventListener?.("offline", onOffline);
    onFinish({ reason, hasSnapshot: sawSnapshot });
    return true;
  }

  function onOffline() {
    if (sawSnapshot) finish("offline-cache");
  }

  eventTarget?.addEventListener?.("offline", onOffline);
  const delay = Number.isFinite(watchdogMs) ? Math.max(1, watchdogMs) : INITIAL_REPORT_LOAD_WATCHDOG_MS;
  const timer = setTimer(() => finish("watchdog"), delay);
  watchdogTimer = timer;
  // Also support injected test/host timers that invoke synchronously.
  if (finished || destroyed) clearWatchdog();

  return {
    observe(snapshot) {
      sawSnapshot = true;
      const fromCache = snapshot?.metadata?.fromCache === true;
      if (!fromCache) finish("server");
      else if (!isOnline()) finish("offline-cache");
      return { fromCache, finished };
    },
    fail() { finish("error"); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearWatchdog();
      eventTarget?.removeEventListener?.("offline", onOffline);
    },
    get finished() { return finished; },
    get hasSnapshot() { return sawSnapshot; },
  };
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createInitialReportLoadGate, INITIAL_REPORT_LOAD_WATCHDOG_MS } from "../report-loading.js";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    emit(type) { listeners.get(type)?.(); },
    get size() { return listeners.size; },
  };
}

test("an online Firestore cache snapshot stays loading until a metadata server snapshot arrives", async () => {
  const target = eventTarget();
  const finishes = [];
  const gate = createInitialReportLoadGate({ eventTarget: target, isOnline: () => true, onFinish: (state) => finishes.push(state) });

  assert.deepEqual(gate.observe({ metadata: { fromCache: true } }), { fromCache: true, finished: false });
  assert.deepEqual(finishes, []);
  assert.deepEqual(gate.observe({ metadata: { fromCache: false } }), { fromCache: false, finished: true });
  assert.deepEqual(finishes, [{ reason: "server", hasSnapshot: true }]);
  assert.equal(target.size, 0);

  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /onSnapshot\([^]*includeMetadataChanges:\s*true/);
  assert.match(app, /if \(!fromCache\) \{ reportsReady = true; connectionFailed = false; \}/,
    "a late server snapshot must restore the live connection after watchdog expiry");
});

test("explicit offline cache state and listener errors release the initial report loader once", () => {
  const target = eventTarget();
  const offlineFinishes = [];
  let online = true;
  const offlineGate = createInitialReportLoadGate({ eventTarget: target, isOnline: () => online, onFinish: (state) => offlineFinishes.push(state) });
  offlineGate.observe({ metadata: { fromCache: true } });
  online = false; target.emit("offline");
  offlineGate.fail();
  assert.deepEqual(offlineFinishes, [{ reason: "offline-cache", hasSnapshot: true }]);

  const errors = [];
  const errorGate = createInitialReportLoadGate({ eventTarget: eventTarget(), onFinish: (state) => errors.push(state) });
  errorGate.fail(); errorGate.fail();
  assert.deepEqual(errors, [{ reason: "error", hasSnapshot: false }]);
});

test("the bounded watchdog releases a silent online cache wait while preserving later server recovery", () => {
  const timers = new Map(); const cleared = [];
  let nextTimer = 0;
  const finishes = [];
  const gate = createInitialReportLoadGate({
    eventTarget: eventTarget(), isOnline: () => true,
    setTimer(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimer(id) { cleared.push(id); timers.delete(id); },
    onFinish: (state) => finishes.push(state),
  });
  assert.equal(timers.get(1).delay, INITIAL_REPORT_LOAD_WATCHDOG_MS);
  gate.observe({ metadata: { fromCache: true } });
  const watchdog = timers.get(1).callback; watchdog();
  assert.deepEqual(finishes, [{ reason: "watchdog", hasSnapshot: true }]);
  assert.deepEqual(cleared, [1]);

  assert.deepEqual(gate.observe({ metadata: { fromCache: false } }), { fromCache: false, finished: true });
  assert.equal(finishes.length, 1, "the app handles the later server snapshot without firing initial completion twice");
});

test("server completion and destruction clear the watchdog and suppress queued callbacks", () => {
  const callbacks = [], cleared = [], finishes = [];
  const makeGate = () => createInitialReportLoadGate({
    eventTarget: eventTarget(),
    setTimer(callback) { callbacks.push(callback); return callbacks.length; },
    clearTimer(id) { cleared.push(id); },
    onFinish: (state) => finishes.push(state),
  });
  const serverGate = makeGate();
  serverGate.observe({ metadata: { fromCache: false } });
  callbacks[0]();
  assert.deepEqual(finishes, [{ reason: "server", hasSnapshot: true }]);
  assert.deepEqual(cleared, [1]);

  const destroyedGate = makeGate(); destroyedGate.destroy(); callbacks[1]();
  assert.equal(finishes.length, 1);
  assert.deepEqual(cleared, [1, 2]);
});

test("contextual loading replaces the obsolete fixed global strip", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /global-loading/);
  assert.match(html, /data-loading-for="status"/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachMapZoom } from '../map-zoom.js';

class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  divideBy(value) { return new Point(this.x / value, this.y / value); }
  subtract(other) { return new Point(this.x - other.x, this.y - other.y); }
}

function fixture() {
  const listeners = new Map(), calls = [], frames = new Map(), timers = new Map();
  let id = 0, time = 0, zoom = 10, center = new Point(0, 0);
  const viewHalf = new Point(400, 300);
  const container = {
    clientHeight: 600,
    addEventListener(type, listener, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ listener, options });
    },
    removeEventListener(type, listener, capture) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry.listener !== listener || entry.options.capture !== capture));
    },
  };
  const map = {
    options: { zoomSnap: 0.25, zoomAnimation: true },
    getContainer: () => container,
    getZoom: () => zoom,
    getMinZoom: () => 2,
    getMaxZoom: () => 19,
    getSize: () => viewHalf.divideBy(0.5),
    mouseEventToContainerPoint: (event) => new Point(event.clientX - 100, event.clientY - 50),
    containerPointToLatLng(point) {
      const scale = 2 ** zoom;
      return new Point(center.x + (point.x - viewHalf.x) / scale, center.y + (point.y - viewHalf.y) / scale);
    },
    project(latlng, value) { const scale = 2 ** value; return new Point(latlng.x * scale, latlng.y * scale); },
    unproject(point, value) { const scale = 2 ** value; return new Point(point.x / scale, point.y / scale); },
    _stop() { calls.push({ type: 'stop' }); },
    _moveStart(zoomChanged, noMoveStart) { calls.push({ type: 'start', zoomChanged, noMoveStart }); },
    _move(value, nextZoom, data) { center = value; zoom = nextZoom; calls.push({ type: 'move', center: value, zoom: nextZoom, data }); },
    _animateZoom(value, nextZoom, start, noUpdate) { center = value; zoom = nextZoom; calls.push({ type: 'settle', center: value, zoom: nextZoom, start, noUpdate }); },
    _resetView(value, nextZoom) { center = value; zoom = nextZoom; calls.push({ type: 'reset', zoom: nextZoom }); },
    setZoomAround(anchor, nextZoom) { zoom = nextZoom; calls.push({ type: 'fallback', anchor, zoom: nextZoom }); },
  };
  const scheduler = {
    now: () => time,
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(frameId) { frames.delete(frameId); },
    setTimeout(callback, delay) { timers.set(++id, { callback, at: time + delay }); return id; },
    clearTimeout(timerId) { timers.delete(timerId); },
  };
  const cleanup = attachMapZoom(map, scheduler);
  function dispatch(type, fields = {}) {
    const event = {
      ctrlKey: false, metaKey: false, deltaY: 0, deltaMode: 0, clientX: 200, clientY: 150,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...fields,
    };
    for (const { listener } of listeners.get(type) || []) { listener(event); if (event.stopped) break; }
    return event;
  }
  function flush() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); }
  function advance(value) {
    time += value;
    for (const [timerId, timer] of [...timers]) if (timer.at <= time) { timers.delete(timerId); timer.callback(); }
  }
  return { container, listeners, calls, frames, timers, map, cleanup, dispatch, flush, advance };
}

const callsOf = (fixtureValue, type) => fixtureValue.calls.filter((call) => call.type === type);

test('every wheel gesture uses the immediate continuous map path', () => {
  const f = fixture();
  let nativeWheels = 0;
  f.container.addEventListener('wheel', () => nativeWheels++, { capture: false });
  const wheel = f.dispatch('wheel', { deltaY: -30 });
  assert.equal(wheel.prevented, true); assert.equal(wheel.stopped, true);
  f.flush();
  assert.equal(callsOf(f, 'move')[0].zoom, 10.75);
  const pinch = f.dispatch('wheel', { ctrlKey: true, deltaY: -15 });
  assert.equal(pinch.prevented, true); assert.equal(pinch.stopped, true);
  f.flush();
  assert.equal(nativeWheels, 0);
  assert.equal(callsOf(f, 'move').length, 2);
  assert.equal(callsOf(f, 'move')[1].zoom, 11.125);
  assert.deepEqual(callsOf(f, 'move')[1].data, { pinch: true, round: false });
  f.cleanup();
});

test('trackpad deltas remain continuous and settle to zoomSnap only after the gesture becomes idle', () => {
  const f = fixture();
  for (let index = 0; index < 30; index++) {
    f.dispatch('wheel', { ctrlKey: true, deltaY: -1 }); f.flush(); f.advance(5);
  }
  assert.equal(callsOf(f, 'move').length, 30);
  assert.ok(Math.abs(callsOf(f, 'move').at(-1).zoom - 10.75) < 1e-9);
  assert.equal(callsOf(f, 'settle').length, 0);
  f.advance(81);
  assert.equal(callsOf(f, 'settle').length, 1);
  assert.equal(callsOf(f, 'settle')[0].zoom, 10.75);
  f.cleanup();
});

test('the geographic point under the cursor remains fixed throughout continuous zoom', () => {
  const f = fixture();
  const anchor = new Point(100, 100);
  const before = f.map.containerPointToLatLng(anchor);
  for (const deltaY of [-7, -9, -13]) { f.dispatch('wheel', { ctrlKey: true, deltaY }); f.flush(); }
  const after = f.map.containerPointToLatLng(anchor);
  assert.ok(Math.abs(before.x - after.x) < 1e-12);
  assert.ok(Math.abs(before.y - after.y) < 1e-12);
  f.cleanup();
});

test('line and page wheel units clamp smoothly to map zoom bounds', () => {
  const f = fixture();
  f.dispatch('wheel', { ctrlKey: true, deltaY: -1, deltaMode: 1 }); f.flush();
  assert.equal(callsOf(f, 'move').at(-1).zoom, 10.4);
  f.advance(81);
  f.dispatch('wheel', { ctrlKey: true, deltaY: -1, deltaMode: 2 }); f.flush();
  assert.equal(callsOf(f, 'move').at(-1).zoom, 19);
  f.dispatch('wheel', { ctrlKey: true, deltaY: -10000 }); f.flush();
  assert.equal(callsOf(f, 'move').at(-1).zoom, 19);
  const count = callsOf(f, 'move').length;
  for (const deltaY of [0, NaN, Infinity]) assert.equal(f.dispatch('wheel', { ctrlKey: true, deltaY }).prevented, true);
  f.flush(); assert.equal(callsOf(f, 'move').length, count);
  f.cleanup();
});

test('Safari gesture scale is cumulative, settles once, and duplicate wheel events are ignored', () => {
  const f = fixture();
  f.dispatch('gesturestart');
  f.dispatch('gesturechange', { scale: 2 }); f.flush();
  f.dispatch('wheel', { ctrlKey: true, deltaY: -50 }); f.flush();
  f.dispatch('gesturechange', { scale: 4 }); f.flush();
  assert.deepEqual(callsOf(f, 'move').map((call) => call.zoom), [11, 12]);
  f.dispatch('gestureend');
  assert.equal(callsOf(f, 'settle').length, 1);
  assert.equal(callsOf(f, 'settle')[0].zoom, 12);
  f.cleanup();
});

test('native two-finger touch remains owned by Leaflet', () => {
  const f = fixture();
  const touch = f.dispatch('touchstart', { touches: [{}, {}] });
  f.dispatch('gesturestart'); f.dispatch('gesturechange', { scale: 2 });
  f.dispatch('wheel', { ctrlKey: true, deltaY: -50 });
  f.dispatch('touchend', { touches: [] }); f.dispatch('gestureend'); f.flush();
  assert.equal(touch.prevented, false); assert.equal(touch.stopped, false);
  assert.equal(callsOf(f, 'move').length, 0);
  f.cleanup();
});

test('cleanup cancels pending frames and timers without changing the map', () => {
  const f = fixture();
  f.dispatch('wheel', { metaKey: true, deltaY: -25 });
  assert.equal(f.frames.size, 1); assert.equal(f.timers.size, 1);
  f.cleanup(); f.cleanup();
  assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  assert.equal([...f.listeners.values()].flat().length, 0);
  f.flush(); f.advance(500);
  assert.equal(f.calls.length, 0);
});

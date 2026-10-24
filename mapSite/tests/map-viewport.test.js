import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachMapViewport, MAP_WORLD_BOUNDS, MAP_VIEWPORT_OPTIONS } from '../map-viewport.js';

function fixture({ width = 800, height = 440, zoom = 2, minimum = 2, maximum = 19, snap = 0.25, loaded = true } = {}) {
  const handlers = new Map(), queuedZooms = [], calls = { minimums: [], constraints: 0, invalidations: 0, setViews: 0, explicitZooms: [], implicitZooms: [] };
  let observer;
  const container = { clientWidth: width, clientHeight: height, ownerDocument: { defaultView: { ResizeObserver: class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { assert.equal(target, container); }
    disconnect() { this.disconnected = true; }
  } } } };
  let cachedSize = { x: width, y: height };
  const map = {
    options: { ...MAP_VIEWPORT_OPTIONS, zoomSnap: snap },
    on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return this; },
    off(type, fn) { handlers.get(type)?.delete(fn); return this; },
    fire(type, event = {}) { for (const fn of [...handlers.get(type) || []]) fn(event); return this; },
    getContainer: () => container, getSize: () => cachedSize,
    invalidateSize() {
      calls.invalidations++;
      cachedSize = { x: container.clientWidth, y: container.clientHeight };
      this.fire('resize');
    },
    getMinZoom: () => minimum, getMaxZoom: () => maximum, getZoom: () => loaded ? zoom : undefined,
    setZoom(value, options) { calls.explicitZooms.push({ value, options }); zoom = value; this.fire('move', { pinch: true }); },
    setMinZoom(value) {
      minimum = value; calls.minimums.push(value);
      if (loaded && zoom < value) { calls.implicitZooms.push(value); queuedZooms.push(() => { zoom = value; }); }
      this.fire('move', { pinch: true });
    },
    project([latitude, longitude], atZoom) {
      const sin = Math.sin(latitude * Math.PI / 180), scale = 256 * 2 ** atZoom;
      return { x: (longitude + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
    },
    getScaleZoom: (scale, fromZoom) => fromZoom + Math.log2(scale),
    panInsideBounds(bounds, options) {
      assert.equal(bounds, MAP_WORLD_BOUNDS); assert.equal(options.animate, false);
      calls.constraints++; this.fire('move', { pinch: true });
    },
    setView(_point, value) { calls.setViews++; zoom = value; },
  };
  const controller = attachMapViewport(map);
  return { map, container, calls, controller, get observer() { return observer; }, handlers,
    resize(width, height) { container.clientWidth = width; container.clientHeight = height; observer.callback(); },
    load() { loaded = true; map.fire('load'); },
    settleAnimations() { for (const finish of queuedZooms.splice(0)) finish(); },
  };
}

test('shared bounds use the complete Mercator world and prevent drag or touch zoom bounce', () => {
  assert.deepEqual(MAP_WORLD_BOUNDS, [[-85.0511287798, -180], [85.0511287798, 180]]);
  assert.equal(MAP_VIEWPORT_OPTIONS.maxBounds, MAP_WORLD_BOUNDS);
  assert.equal(MAP_VIEWPORT_OPTIONS.maxBoundsViscosity, 1);
  assert.equal(MAP_VIEWPORT_OPTIONS.bounceAtZoomLimits, false);
  assert.equal(MAP_VIEWPORT_OPTIONS.wheelDebounceTime, 0);
  assert.equal(MAP_VIEWPORT_OPTIONS.wheelPxPerZoomLevel, 40);
});

test('wide and tall viewports calculate snapped coverage from true projection with a safety margin', () => {
  for (const [width, height, expected] of [[1500, 440, 2.75], [800, 1700, 2.75], [1024, 440, 2.25], [800, 440, 2]]) {
    const f = fixture({ width, height });
    assert.equal(f.map.getMinZoom(), expected);
    const coveredPixels = 256 * 2 ** f.map.getMinZoom();
    assert.ok(coveredPixels >= width + 2 && coveredPixels >= height + 2);
    assert.equal(f.calls.invalidations, 1, 'Resize emitted by invalidation must not recurse');
    assert.equal(f.calls.constraints, 1);
    f.controller.destroy();
  }
});

test('shrinking lowers the dynamic minimum without zooming out an existing regional view', () => {
  const f = fixture({ width: 1900, zoom: 12 });
  assert.equal(f.map.getMinZoom(), 3);
  f.resize(600, 400);
  assert.equal(f.map.getMinZoom(), 2);
  assert.equal(f.map.getZoom(), 12);
  assert.equal(f.calls.setViews, 0);
  f.controller.destroy();
});

test('hidden containers are skipped until visible, and unloaded maps constrain after load', () => {
  const f = fixture({ width: 0, height: 0, loaded: false });
  assert.equal(f.calls.invalidations, 0); assert.equal(f.calls.constraints, 0);
  f.resize(1500, 440);
  assert.equal(f.map.getMinZoom(), 2.75); assert.equal(f.calls.constraints, 0);
  f.load(); assert.equal(f.calls.constraints, 1);
  f.resize(0, 0);
  assert.equal(f.map.getMinZoom(), 2.75);
  f.resize(600, 400); assert.equal(f.map.getMinZoom(), 2);
  f.controller.destroy();
});

test('base floors, fractional unsnapped coverage and maximum zoom are respected', () => {
  const miniature = fixture({ minimum: 14, maximum: 14, zoom: 14 });
  assert.equal(miniature.map.getMinZoom(), 14); miniature.controller.destroy();
  const free = fixture({ minimum: 0, width: 900, snap: 0 });
  assert.ok(Math.abs(free.map.getMinZoom() - Math.log2(902 / 256)) < 1e-9); free.controller.destroy();
  const capped = fixture({ width: 2000, maximum: 2 });
  assert.equal(capped.map.getMinZoom(), 2); capped.controller.destroy();
});

test('continuous native pinch translation is constrained, while ordinary dragging is left alone', () => {
  const f = fixture();
  const before = f.calls.constraints;
  f.map.fire('move'); assert.equal(f.calls.constraints, before);
  f.map.fire('move', { pinch: true }); assert.equal(f.calls.constraints, before + 1);
  f.map.fire('move', { pinch: true }); assert.equal(f.calls.constraints, before + 2);
  f.controller.destroy();
});

test('remove and explicit teardown disconnect all observers and listeners idempotently', () => {
  const f = fixture();
  const before = { ...f.calls };
  f.map.fire('remove'); f.controller.destroy();
  assert.equal(f.observer.disconnected, true);
  assert.equal([...f.handlers.values()].reduce((sum, set) => sum + set.size, 0), 0);
  f.resize(3000, 1500); f.controller.refresh(); f.map.fire('move', { pinch: true });
  assert.equal(f.calls.invalidations, before.invalidations); assert.equal(f.calls.constraints, before.constraints);
});


test('raising viewport minimum cannot queue an animation that overwrites the next region fit', () => {
  const f = fixture({ width: 1400, height: 440 });
  assert.equal(f.map.getMinZoom(), 2.5);
  assert.deepEqual(f.calls.explicitZooms, [{ value: 2.5, options: { animate: false } }]);
  assert.deepEqual(f.calls.implicitZooms, []);
  f.map.setView([34.05, 67.7], 5.5);
  f.settleAnimations();
  assert.equal(f.map.getZoom(), 5.5, 'Afghanistan fit must survive the viewport adjustment');
  f.resize(2000, 440);
  assert.equal(f.calls.explicitZooms.length, 1, 'A regional view already above minimum should be preserved');
  f.settleAnimations(); assert.equal(f.map.getZoom(), 5.5);
  f.controller.destroy();
});

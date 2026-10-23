import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createPopulationAreaMap } from "../population-area-map.js";

const geometry = { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };
function mock({ fail = false, valid = true } = {}) {
  const { document } = parseHTML('<html><body><div id="map"></div></body></html>');
  const calls = { markers: [], removed: 0 };
  const handlers = new Map();
  const bounds = { isValid: () => valid };
  const map = { getContainer: () => document.getElementById("map"), attributionControl: { setPrefix(value) { calls.prefix = value; } },
    getMinZoom: () => calls.minimumZoom ?? calls.map?.options.minZoom ?? 0,
    getMaxZoom: () => calls.map?.options.maxZoom ?? 19,
    getSize: () => ({ x: 0, y: 0 }),
    getZoom: () => calls.fit ? 15 : undefined,
    setMinZoom(value) { calls.minimumZoom = value; return this; },
    panInsideBounds(value, options) { calls.worldPan = { value, options }; return this; },
    invalidateSize() { return this; },
    on(types, fn) { for (const type of types.split(/\s+/)) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); } return this; },
    off(types, fn) { for (const type of types.split(/\s+/)) handlers.get(type)?.delete(fn); return this; },
    handlerCount: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
    fitBounds(value, options) { calls.fit = { value, options }; }, remove() { calls.removed++; } };
  const L = {
    map(container, options) { calls.map = { container, options }; return map; },
    tileLayer(url, options) { calls.tiles = { url, options }; return { addTo() { if (fail) throw new Error("Tiles failed"); } }; },
    geoJSON(value, options) { calls.area = { value, options }; return { addTo() {
      assert.ok(calls.fit, "Leaflet paths require an initialized view before their first clipping pass"); return this;
    }, getBounds: () => bounds }; },
    circleMarker(point, options) { calls.markers.push({ point, options }); return { addTo() { assert.ok(calls.fit); } }; },
  };
  return { L, calls, bounds, map };
}

test("renders the exact query boundary and deduplicated report points, fits area, and keeps tile attribution", () => {
  const { L, calls, bounds, map } = mock();
  const reports = [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }, { latitude: 0.1, longitude: 0.1 }, { latitude: null, longitude: 0 }];
  const handle = createPopulationAreaMap(L, {}, { geometry, reports });
  assert.equal(calls.area.value, geometry);
  assert.equal(calls.area.options.interactive, false);
  assert.equal(calls.markers.length, 2);
  assert.deepEqual(calls.markers[0].point, [0, 0]);
  assert.equal(calls.markers[0].options.interactive, false);
  assert.equal(calls.fit.value, bounds);
  assert.equal(calls.fit.options.maxZoom, 15);
  assert.match(calls.tiles.options.attribution, /OpenStreetMap contributors/);
  assert.equal(calls.tiles.options.noWrap, true);
  assert.equal(calls.prefix, false);
  handle.destroy(); handle.destroy();
  assert.equal(calls.removed, 1);
  assert.equal(map.handlerCount(), 0, "Viewport listeners must be released during teardown");
});

test("unavailable geometry does not initialize a map and partial construction releases listeners", () => {
  for (const geometry of [null, {}, { type: "Point", coordinates: [0, 0] }, { type: "MultiPolygon", coordinates: [] }]) {
    const { L, calls } = mock();
    assert.throws(() => createPopulationAreaMap(L, {}, { geometry }), TypeError);
    assert.equal(calls.map, undefined);
  }
  for (const options of [{ fail: true }, { valid: false }]) {
    const { L, calls, map } = mock(options);
    assert.throws(() => createPopulationAreaMap(L, {}, { geometry }));
    assert.equal(calls.removed, 1);
    assert.equal(map.handlerCount(), 0, "Failed construction must release viewport listeners");
  }
});

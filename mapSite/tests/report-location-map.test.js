import assert from "node:assert/strict";
import { test } from "node:test";
import { createReportLocationMap, getReportCoordinates } from "../report-location-map.js";
import { serviceIconSvg } from "../service-icons.js";

const report = { latitude: -1.2921, longitude: 36.8219, category: "water", severity: "high" };

function leafletMock({ failureAt, removalFailure = false } = {}) {
  const calls = {};
  const failure = new Error("Map creation failed");
  const fail = (stage) => { if (failureAt === stage) throw failure; };
  const map = {
    attributionControl: { setPrefix(value) { calls.prefix = value; fail("attribution"); } },
    setView(coordinates, zoom) { calls.view = { coordinates, zoom }; fail("view"); return this; },
    remove() { calls.removed = (calls.removed || 0) + 1; if (removalFailure) throw new Error("Removal failed"); },
  };
  const tileHandlers = new Map();
  const tileLayer = {
    on(type, callback) { tileHandlers.set(type, callback); return this; },
    off(type, callback) { if (tileHandlers.get(type) === callback) tileHandlers.delete(type); return this; },
    emit(type) { tileHandlers.get(type)?.(); },
    listenerCount() { return tileHandlers.size; },
    addTo(target) { calls.tileTarget = target; fail("tileAdd"); return this; },
  };
  const L = {
    map(container, options) { calls.map = { container, options }; fail("map"); return map; },
    tileLayer(url, options) {
      calls.tiles = { url, options }; fail("tiles");
      calls.tileLayer = tileLayer;
      return tileLayer;
    },
    divIcon(options) { calls.icon = options; fail("icon"); return options; },
    marker(coordinates, options) {
      calls.marker = { coordinates, options }; fail("marker");
      return { addTo(target) { calls.markerTarget = target; fail("markerAdd"); return this; } };
    },
  };
  return { L, map, calls, failure };
}

test("coordinates preserve valid numeric locations, including zero and projection boundaries", () => {
  for (const [latitude, longitude] of [[0, 0], [-1.2921, 36.8219], [85.0511287798, 180], [-85.0511287798, -180]]) {
    assert.deepEqual(getReportCoordinates({ latitude, longitude }), [latitude, longitude]);
  }
});

test("missing, nonnumeric and unrenderable locations are never coerced or replaced", () => {
  for (const invalid of [null, undefined, {}, { lat: 0, lon: 0 },
    ...["0", null, undefined, NaN, Infinity, -Infinity, true, [], 85.0511287799, -85.0511287799].map((latitude) => ({ latitude, longitude: 0 })),
    ...["0", null, undefined, NaN, Infinity, -Infinity, false, {}, 180.0001, -180.0001].map((longitude) => ({ latitude: 0, longitude })),
  ]) {
    assert.equal(getReportCoordinates(invalid), null);
    const mock = leafletMock();
    assert.throws(() => createReportLocationMap(mock.L, {}, invalid), RangeError);
    assert.equal(mock.calls.map, undefined, "Invalid locations must not initialize a map");
  }
});

test("mini-map centers the matching category marker at the report location with interactions disabled", () => {
  const mock = leafletMock();
  const container = {};
  const handle = createReportLocationMap(mock.L, container, report);
  assert.equal(mock.calls.map.container, container);
  assert.deepEqual(mock.calls.view, { coordinates: [-1.2921, 36.8219], zoom: 14 });
  const options = mock.calls.map.options;
  for (const setting of ["zoomControl", "dragging", "scrollWheelZoom", "doubleClickZoom", "keyboard", "touchZoom", "boxZoom", "tapHold"]) assert.equal(options[setting], false, setting);
  assert.equal(options.minZoom, 14);
  assert.equal(options.maxZoom, 14);
  assert.deepEqual(options.maxBounds, [[-85.0511287798, -180], [85.0511287798, 180]]);
  assert.equal(options.maxBoundsViscosity, 1);
  assert.equal(options.bounceAtZoomLimits, false);
  assert.deepEqual(mock.calls.marker.coordinates, mock.calls.view.coordinates);
  assert.equal(mock.calls.marker.options.icon, mock.calls.icon);
  for (const setting of ["interactive", "keyboard", "draggable"]) assert.equal(mock.calls.marker.options[setting], false, setting);
  assert.equal(mock.calls.icon.html, `<span class="report-marker" style="background:#c34e42" aria-hidden="true">${serviceIconSvg("water")}</span>`);
  assert.deepEqual(mock.calls.icon.iconSize, [26, 26]);
  assert.deepEqual(mock.calls.icon.iconAnchor, [13, 13]);
  assert.equal(mock.calls.markerTarget, mock.map);
  handle.destroy();
  handle.destroy();
  assert.equal(mock.calls.removed, 1, "Destroy must release the Leaflet map exactly once");
});

test("tiles use the existing OpenStreetMap provider and retain required attribution", () => {
  const mock = leafletMock();
  createReportLocationMap(mock.L, {}, report).destroy();
  assert.equal(mock.calls.tiles.url, "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
  assert.equal(mock.calls.tiles.options.noWrap, true);
  assert.deepEqual(mock.calls.tiles.options.bounds, [[-85.0511287798, -180], [85.0511287798, 180]]);
  assert.equal(mock.calls.tiles.options.attribution, '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>');
  assert.equal(mock.calls.map.options.attributionControl, true);
  assert.equal(mock.calls.prefix, false);
  assert.equal(mock.calls.tileTarget, mock.map);
});

test("mini-map tile activity reaches the global loading hook and releases on teardown", () => {
  const mock = leafletMock();
  let starts = 0, stops = 0;
  const handle = createReportLocationMap(mock.L, {}, report, { onLoading({ key }) {
    assert.equal(key, "report-map-tiles"); starts++;
    let stopped = false;
    return () => { if (!stopped) { stopped = true; stops++; } };
  } });
  mock.calls.tileLayer.emit("loading");
  mock.calls.tileLayer.emit("loading");
  assert.equal(starts, 1);
  mock.calls.tileLayer.emit("load");
  assert.equal(stops, 1);
  mock.calls.tileLayer.emit("loading");
  handle.destroy();
  assert.equal(stops, 2);
  assert.equal(mock.calls.tileLayer.listenerCount(), 0);
});

test("marker colors match urgency and unknown report values cannot inject markup", () => {
  for (const [severity, color] of [["low", "#2f8a69"], ["medium", "#d28b27"], ["high", "#c34e42"], [undefined, "#526575"], ["__proto__", "#526575"], ['"><img src=x onerror=alert(1)>', "#526575"]]) {
    const mock = leafletMock();
    createReportLocationMap(mock.L, {}, { ...report, severity, category: '<script>alert(1)</script>' }).destroy();
    assert.ok(mock.calls.icon.html.includes(`background:${color}`));
    assert.ok(mock.calls.icon.html.includes(serviceIconSvg("other")));
    assert.doesNotMatch(mock.calls.icon.html, /<script|<img|onerror/);
  }
});

test("every failure after map creation releases the map and preserves the original error", () => {
  for (const failureAt of ["map", "attribution", "view", "tiles", "tileAdd", "icon", "marker", "markerAdd"]) {
    const mock = leafletMock({ failureAt });
    assert.throws(() => createReportLocationMap(mock.L, {}, report), (error) => error === mock.failure);
    assert.equal(mock.calls.removed || 0, failureAt === "map" ? 0 : 1, failureAt);
  }
  const mock = leafletMock({ failureAt: "markerAdd", removalFailure: true });
  assert.throws(() => createReportLocationMap(mock.L, {}, report), (error) => error === mock.failure);
  assert.equal(mock.calls.removed, 1);
});

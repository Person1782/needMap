import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecommendations, weightedGeometricMedian } from "../analysis.js";
import { pointInGeometry, enrichSignalsWithRegions } from "../regions.js";
import { buildOverpassQuery, loadNearbyServices, parseOverpassServices } from "../existing-services.js";

const square = (west, south, east, north) => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});
const region = { id: "test-region", name: "Test region", geometry: square(-10, -10, 10, 10) };
const report = (id, longitude, severity = "low") => ({
  id, latitude: 0, longitude, severity, category: "food", summary: "Food access needed", region,
});

test("geometries reject malformed data and exclude holes", () => {
  for (const geometry of [null, {}, { type: "Polygon" }, { type: "MultiPolygon" },
    { type: "Polygon", coordinates: [null] }, { type: "Polygon", coordinates: [[[1, 2]]] }]) {
    assert.equal(pointInGeometry(0, 0, geometry), false);
  }
  const geometry = square(-2, -2, 2, 2);
  geometry.coordinates.push(square(-1, -1, 1, 1).coordinates[0]);
  assert.equal(pointInGeometry(0, 0, geometry), false);
  assert.equal(pointInGeometry(1.5, 0, geometry), true);
  assert.equal(pointInGeometry(2, 0, geometry), true);
});

test("regions and candidate placements stay near the date line", () => {
  const geometry = square(179, -2, -179, 2);
  assert.equal(pointInGeometry(179.5, 0, geometry), true);
  assert.equal(pointInGeometry(-179.5, 0, geometry), true);
  assert.equal(pointInGeometry(0, 0, geometry), false);
  const position = weightedGeometricMedian([report("a", 179.5), report("b", -179.5)]);
  assert.ok(Math.abs(position.longitude) > 179);
  assert.equal(pointInGeometry(position.longitude, position.latitude, geometry), true);
});

test("median does not stop at a coincident report unless its weight balances the others", () => {
  // The initial mean is zero, coincident with a report, but the median is one.
  const position = weightedGeometricMedian([
    report("a", -3), report("b", 0), report("c", 1), report("d", 1), report("e", 1),
  ]);
  assert.ok(Math.abs(position.longitude - 1) < 0.0001);
  assert.ok(Number.isFinite(weightedGeometricMedian([{ ...report("pole", 15), latitude: 90 }]).longitude));
  assert.throws(() => weightedGeometricMedian([]), /valid report/);
});

test("recommendations exclude invalid coordinates and reports outside the assigned region", () => {
  const candidates = buildRecommendations([
    report("a", 0), report("b", 1), { ...report("bad", 1), latitude: NaN },
    report("outside", 80), null,
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].signals.length, 2);
  assert.deepEqual(buildRecommendations(null), []);
  assert.equal(buildRecommendations([report("a", 0), report("b", 1)].map((item) =>
    ({ ...item, category: "constructor", severity: "constructor" })))[0].urgencyScore, 2);
});

test("service queries reject missing coordinates and handle unknown category names", () => {
  for (const value of [null, undefined, "", " ", false, [], {}]) {
    assert.throws(() => buildOverpassQuery("food", value, 0), /coordinate/);
  }
  assert.match(buildOverpassQuery("constructor", 1, 2), /community_centre/);
});

test("service parsing ignores incomplete elements and de-duplicates OSM identifiers", () => {
  const valid = { type: "node", id: 1, lat: 1, lon: 2, tags: { amenity: "clinic" } };
  const services = parseOverpassServices({ elements: [valid, valid,
    { ...valid, id: 2, lat: "" }, { ...valid, id: null },
    { type: "way", id: 3, center: { lat: 3, lon: 4 }, tags: { name: "Clinic" } },
  ] });
  assert.equal(services.length, 2);
  assert.equal(services[1].name, "Clinic");
});

test("provider failures are not cached as an empty service inventory", async (t) => {
  const cache = new Map();
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ remark: "runtime error: timeout", elements: [] }) }));
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  t.after(() => { globalThis.localStorage = previousStorage; });
  const candidate = { category: "food", position: { latitude: 1, longitude: 2 } };
  await assert.rejects(loadNearbyServices(candidate), /could not be completed/);
  assert.equal(cache.size, 0);
});

test("service inventory caches are isolated by provider endpoint", async (t) => {
  const cache = new Map();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return { ok: true, json: async () => ({ elements: [] }) }; });
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  t.after(() => { globalThis.localStorage = previousStorage; });
  const candidate = { category: "food", position: { latitude: 1, longitude: 2 } };
  await loadNearbyServices(candidate, { endpoint: "https://one.example/api" });
  await loadNearbyServices(candidate, { endpoint: "https://two.example/api" });
  assert.equal((await loadNearbyServices(candidate, { endpoint: "https://two.example/api" })).source, "cache");
  assert.equal(calls, 2);
});

test("region enrichment skips invalid positions without network requests", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const result = await enrichSignalsWithRegions([{ latitude: null, longitude: 1 }]);
  assert.equal(result[0].region, null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("cancelled region work stops before starting network requests", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(enrichSignalsWithRegions([report("a", 0)], { signal: controller.signal }), { name: "AbortError" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("a failed detailed boundary lookup retains its verified base boundary", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls > 1) throw new Error("Provider unavailable");
    return { ok: true, json: async () => ({ osm_id: 50, osm_type: "relation", name: "Village", type: "village", geojson: square(40, 40, 42, 42) }) };
  });
  t.mock.method(console, "warn", () => {});
  const result = await enrichSignalsWithRegions([{ latitude: 41, longitude: 41 }]);
  assert.equal(result[0].region.name, "Village");
  assert.equal(calls, 2);
});


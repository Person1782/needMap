import assert from "node:assert/strict";
import { test } from "node:test";
import { pointInGeometry } from "../regions.js";
import { loadWorldRegionSet, WORLD_REGION_BOUNDARY_LIMITS } from "../world-region-boundaries.js";

const rectangle = (west = 0, south = 0, east = 4, north = 4) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const entry = (id = "XX-ONE", extra = {}) => ({ id, name: "Example State", kind: "state", countryCode: "XX",
  parentId: "", boundaryFile: `data/regions/${id}.json`, ...extra });
const data = (parentId = "XX-ONE", countryCode = "XX") => ({ version: "needmap-v2", parentId, regions: [
  { id: parentId, name: "Example State", kind: "state", countryCode, parentId: "", geometry: rectangle(), bounds: [[20, 20], [30, 30]] },
  { id: `${parentId}:needmap-v2:west`, name: "Example State — West", kind: "needmap", countryCode, parentId,
    source: "NeedMap regions grouped from geoBoundaries administrative areas", geometry: rectangle(0, 0, 2, 4), excludedGeometry: rectangle(-1, -1, 5, 5) },
  { id: `${parentId}:needmap-v2:east`, name: "Example State — East", kind: "needmap", countryCode, parentId,
    geometry: rectangle(2, 0, 4, 4), excludedGeometry: null },
] });
const response = (value, init) => new Response(typeof value === "string" ? value : JSON.stringify(value), init);
const provider = (value = data()) => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url: String(url), options }); return response(value); };
  return { calls, fetchImpl };
};
const contains = (region, longitude, latitude) => pointInGeometry(longitude, latitude, region.geometry) &&
  (!region.excludedGeometry || !pointInGeometry(longitude, latitude, region.excludedGeometry));

test("loads one same-origin region set, recomputes bounds, and reconstructs deterministic seam ownership", async () => {
  const { calls, fetchImpl } = provider();
  const regions = await loadWorldRegionSet(entry(), { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost/data/regions/XX-ONE.json");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(regions[0].bounds, [[0, 0], [4, 4]]);
  assert.equal(regions[1].excludedGeometry, null);
  assert.equal(regions[2].excludedGeometry.type, "MultiPolygon");
  assert.deepEqual(regions.slice(1).filter((region) => contains(region, 2, 2)).map((region) => region.id), [regions[1].id]);
  assert.equal(regions[0].source, "geoBoundaries CGAZ");
  const sibling = entry(regions[2].id, { kind: "needmap", parentId: "XX-ONE", boundaryFile: "data/regions/XX-ONE.json" });
  assert.strictEqual(await loadWorldRegionSet(sibling, { fetchImpl }), regions);
  assert.equal(calls.length, 1);
});

test("relative deployment paths resolve beneath the current site directory", async () => {
  const original = globalThis.location;
  globalThis.location = { href: "https://example.test/needmap/index.html?mode=map#regions" };
  try {
    const { calls, fetchImpl } = provider();
    await loadWorldRegionSet(entry(), { fetchImpl });
    assert.equal(calls[0].url, "https://example.test/needmap/data/regions/XX-ONE.json");
  } finally {
    if (original === undefined) delete globalThis.location;
    else globalThis.location = original;
  }
});

test("unsafe paths and invalid requested identities never initiate a download", async () => {
  const { calls, fetchImpl } = provider();
  for (const boundaryFile of ["https://other.example/data/regions/XX-ONE.json", "//other.example/regions/a.json",
    "/data/regions/XX-ONE.json", "data/regions/../secret.json", "data/regions/%2e%2e.json",
    "data/regions/XX-ONE.json?token=secret", "data/regions/XX-ONE.json#extra", "data/regions/a/b.json",
    "data\\regions\\XX-ONE.json", "data/regions/XX-ONE.geojson", "data/regions/a..b.json"]) {
    await assert.rejects(loadWorldRegionSet(entry("XX-ONE", { boundaryFile }), { fetchImpl }), /safe local data path/);
  }
  for (const invalid of [{ ...entry(), id: "../secret" }, { ...entry(), countryCode: "wrong" },
    { ...entry(), kind: "needmap", parentId: "" }, { ...entry(), kind: "road" }]) {
    await assert.rejects(loadWorldRegionSet(invalid, { fetchImpl }), /identification/);
  }
  assert.equal(calls.length, 0);
});

test("malformed, mixed-parent, wrong-country, duplicate, and incomplete payloads reject the whole set", async () => {
  const invalid = [null, {}, { ...data(), version: "needmap-v1" }, { ...data(), parentId: "XX-TWO" },
    { ...data(), regions: [] }, { ...data(), regions: [data().regions[1], data().regions[0]] }];
  for (const change of [
    (value) => { value.regions[0].kind = "needmap"; },
    (value) => { value.regions[0].parentId = "unexpected"; },
    (value) => { value.regions[1].id = value.regions[2].id; },
    (value) => { value.regions[1].parentId = "XX-TWO"; },
    (value) => { value.regions[1].countryCode = "YY"; },
    (value) => { value.regions[1].id = "XX-TWO:needmap-v2:west"; },
    (value) => { value.regions[1].name = " "; },
  ]) { const value = data(); change(value); invalid.push(value); }
  for (const value of invalid) await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl: provider(value).fetchImpl }), /Region boundaries unavailable/);
  const requested = entry("XX-ONE:needmap-v2:missing", { kind: "needmap", parentId: "XX-ONE", boundaryFile: "data/regions/XX-ONE.json" });
  await assert.rejects(loadWorldRegionSet(requested, { fetchImpl: provider().fetchImpl }), /missing/);
});

test("invalid coordinates, open or degenerate rings, and unsupported shapes are rejected", async () => {
  for (const geometry of [null, {}, { type: "Point", coordinates: [0, 0] },
    { type: "MultiPolygon", coordinates: [] }, { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4]]] },
    { type: "Polygon", coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] },
    rectangle(0, 0, 181, 4), rectangle(0, -91, 4, 4),
    { type: "Polygon", coordinates: [[[0, 0], [4, "0"], [4, 4], [0, 0]]] },
  ]) {
    const value = data(); value.regions[2].geometry = geometry;
    await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl: provider(value).fetchImpl }), /polygon is invalid or too complex/);
  }
});

test("date-line and polar bounds remain visible and country parent files are supported", async () => {
  const value = data("XX");
  value.regions = [{ ...value.regions[0], kind: "country", geometry: rectangle(179, 86, -179, 89) }];
  const regions = await loadWorldRegionSet(entry("XX", { kind: "country" }), { fetchImpl: provider(value).fetchImpl });
  assert.deepEqual(regions[0].bounds, [[85, -180], [85, 180]]);
});

test("Natural Earth source metadata is pinned to both American Samoa catalog identities", async () => {
  for (const descriptor of [entry("AS", { kind: "country", countryCode: "AS", boundaryFile: "data/regions/as.json" }),
    entry("US-AS", { kind: "state", countryCode: "US", boundaryFile: "data/regions/us-as.json" })]) {
    const value = data(descriptor.id, descriptor.countryCode);
    value.regions = [{ ...value.regions[0], kind: descriptor.kind, source: "Natural Earth", sourceVersion: "5.1.1" }];
    const records = await loadWorldRegionSet(descriptor, { fetchImpl: provider(value).fetchImpl });
    assert.equal(records[0].source, "Natural Earth");
    assert.equal(records[0].sourceVersion, "5.1.1");
    for (const change of [{ source: "geoBoundaries CGAZ" }, { source: "Unverified" }, { source: undefined },
      { sourceVersion: undefined }, { sourceVersion: "5.1.0" }, { kind: descriptor.kind === "country" ? "state" : "country" }]) {
      const invalid = structuredClone(value); Object.assign(invalid.regions[0], change);
      await assert.rejects(loadWorldRegionSet(descriptor, { fetchImpl: provider(invalid).fetchImpl }), /source does not match/);
    }
    await assert.rejects(loadWorldRegionSet({ ...descriptor, boundaryFile: "data/regions/unregistered.json" },
      { fetchImpl: provider(value).fetchImpl }), /source does not match/);
    const invalidGeometry = structuredClone(value);
    invalidGeometry.regions[0].geometry = { type: "Point", coordinates: [-170.7, -14.3] };
    await assert.rejects(loadWorldRegionSet(descriptor, { fetchImpl: provider(invalidGeometry).fetchImpl }), /polygon is invalid/);
  }
  const unrelated = data();
  unrelated.regions[0].source = "Natural Earth"; unrelated.regions[0].sourceVersion = "5.1.1";
  await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl: provider(unrelated).fetchImpl }), /source does not match/);
});

test("size and coordinate limits reject downloads without silent truncation", async () => {
  await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl: async () => response("{}", {
    headers: { "content-length": String(WORLD_REGION_BOUNDARY_LIMITS.maxBytes + 1) },
  }) }), /size limit/);
  let cancelled = false;
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(WORLD_REGION_BOUNDARY_LIMITS.maxBytes + 1)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl }), /size limit/);
  assert.equal(cancelled, true);
  const oversized = data();
  oversized.regions[0].geometry.coordinates = [Array.from({ length: WORLD_REGION_BOUNDARY_LIMITS.maxPositions + 1 }, (_, index) =>
    index === 0 || index === WORLD_REGION_BOUNDARY_LIMITS.maxPositions ? [0, 0] : [index % 2, index % 3])];
  await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl: provider(oversized).fetchImpl }), /too complex/);
});

test("invalid or truncated JSON, HTTP, network, and redirect failures are never cached", async () => {
  for (const fail of [() => response('{"version":"needmap-v2","regions":['), () => response("busy", { status: 503 }),
    () => { throw new TypeError("network failure"); },
    () => ({ ok: true, url: "https://unrelated.example/file.json", body: null, text: async () => JSON.stringify(data()) }),
  ]) {
    let calls = 0;
    const fetchImpl = async () => ++calls === 1 ? fail() : response(data());
    await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl }));
    assert.equal((await loadWorldRegionSet(entry(), { fetchImpl })).length, 3);
    assert.equal(calls, 2);
  }
});

test("already aborted loads do not fetch or return a cached set", async () => {
  const { calls, fetchImpl } = provider();
  await loadWorldRegionSet(entry(), { fetchImpl });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl, signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls.length, 1);
});

test("timeout and caller abort settle promptly even when fetch ignores the signal", async () => {
  const never = async () => new Promise(() => {});
  await assert.rejects(loadWorldRegionSet(entry(), { fetchImpl: never, timeoutMs: 5 }), { name: "TimeoutError" });
  const controller = new AbortController();
  const pending = loadWorldRegionSet(entry(), { fetchImpl: never, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("late cancelled fetches cannot fill the cache and stalled body reads can be cancelled", async () => {
  let release, calls = 0;
  const fetchImpl = async () => ++calls === 1 ? new Promise((resolve) => { release = resolve; }) : response(data());
  const controller = new AbortController();
  const pending = loadWorldRegionSet(entry(), { fetchImpl, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  release(response(data()));
  await loadWorldRegionSet(entry(), { fetchImpl });
  assert.equal(calls, 2);
  await assert.rejects(loadWorldRegionSet(entry(), { timeoutMs: 5,
    fetchImpl: async () => ({ ok: true, headers: new Headers(), text: async () => new Promise(() => {}) }),
  }), { name: "TimeoutError" });
  let readerCancelled = false;
  await assert.rejects(loadWorldRegionSet(entry(), { timeoutMs: 5,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { readerCancelled = true; } })),
  }), { name: "TimeoutError" });
  assert.equal(readerCancelled, true);
});

test("the successful LRU cache retains eight parent sets and isolates country identities", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const id = String(url).match(/\/([^/]+)\.json$/)[1];
    calls.push(id); return response(data(id));
  };
  for (let index = 0; index < 8; index += 1) await loadWorldRegionSet(entry(`XX-${index}`), { fetchImpl });
  await loadWorldRegionSet(entry("XX-0"), { fetchImpl });
  await loadWorldRegionSet(entry("XX-8"), { fetchImpl });
  await loadWorldRegionSet(entry("XX-0"), { fetchImpl });
  await loadWorldRegionSet(entry("XX-1"), { fetchImpl });
  assert.deepEqual(calls, ["XX-0", "XX-1", "XX-2", "XX-3", "XX-4", "XX-5", "XX-6", "XX-7", "XX-8", "XX-1"]);
  await assert.rejects(loadWorldRegionSet(entry("XX-0", { countryCode: "YY" }), { fetchImpl }), /mixed-parent identification/);
  assert.equal(calls.length, 11);
});

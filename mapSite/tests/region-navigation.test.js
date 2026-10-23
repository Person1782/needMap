import assert from "node:assert/strict";
import { test } from "node:test";
import { createRegionNavigation as makeRegionNavigation, countRegions, loadIpRegion, normalizeNavigationRegion, regionContains, searchRegions, WORLD_REGION, SAVED_REGION_KEY } from "../region-navigation.js";
import { REGION_CATALOG_ROWS } from "../region-catalog.js";

const countryNames = new Map(REGION_CATALOG_ROWS.filter(([id]) => id.length === 2).map(([id, name]) => [id, name]));
const fallbackEntries = REGION_CATALOG_ROWS.map(([id, name, nativeName]) => {
  const countryCode = id.slice(0, 2), country = countryNames.get(countryCode), kind = id.length === 2 ? "country" : "state";
  return { id, name, nativeName, kind, countryCode, country, boundaryFile: "", parentId: "", label: kind === "country" ? name : `${name}, ${country}` };
});
const createRegionNavigation = (options) => makeRegionNavigation({ entries: fallbackEntries, ...options });

const square = (west = -125, south = 32, east = -114, north = 42) => ({
  type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});
const california = (extra = {}) => ({
  name: "California", addresstype: "state", osm_type: "relation", osm_id: 165475,
  address: { state: "California", country: "United States", country_code: "us", "ISO3166-2-lvl4": "US-CA" },
  geojson: square(), ...extra,
});
const country = (code = "US", name = "United States") => ({
  name, addresstype: "country", osm_type: "relation", osm_id: code,
  address: { country: name, country_code: code.toLowerCase() }, geojson: square(-140, 15, -50, 75),
});
const located = async () => ({ ok: true, json: async () => ({ success: true, country_code: "US", region_code: "CA", region: "California" }) });
const deferred = () => { let resolve; return { promise: new Promise((done) => { resolve = done; }), resolve: (value) => resolve(value) }; };
const preferenceStore = (initial) => {
  const values = new Map(initial === undefined ? [] : [[SAVED_REGION_KEY, initial]]);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test("the local picker searches countries and states across continents and accents", () => {
  for (const [query, id] of [["California", "US-CA"], ["Tamil Nadu", "IN-TN"],
    ["Lagos", "NG-LA"], ["Sao Paulo", "BR-SP"], ["New South Wales", "AU-NSW"],
    ["Kenya", "KE"], ["Indonesia", "ID"]]) {
    assert.ok(searchRegions(query).some((entry) => entry.id === id), query);
  }
  assert.equal(searchRegions("California United States")[0].id, "US-CA");
  assert.equal(searchRegions("United States")[0].id, "US");
  assert.equal(searchRegions("US-CA")[0].id, "US-CA");
  assert.deepEqual(searchRegions("region-that-does-not-exist"), []);
  assert.ok(searchRegions("").some((entry) => entry.kind === "state"));
});

test("country browsing returns every indexed country immediately without a result limit", () => {
  const countries = searchRegions("", { kind: "country", limit: Infinity });
  assert.equal(countries.length, 250);
  assert.equal(countRegions("", { kind: "country" }), countries.length);
  assert.deepEqual(countries.map((entry) => entry.id).sort(), fallbackEntries.filter((entry) => entry.kind === "country").map((entry) => entry.id).sort());
  assert.equal(countries[0].name, "Afghanistan"); assert.equal(countries.at(-1).name, "Zimbabwe");
  assert.ok(countries.every((entry) => entry.kind === "country"));
});

test("common country aliases rank the intended country first, including UK over Ukraine", () => {
  for (const [query, id] of [["UK", "GB"], ["USA", "US"], ["UAE", "AE"], ["Czechia", "CZ"]]) {
    assert.equal(searchRegions(query, { limit: Infinity })[0].id, id, query);
    assert.equal(searchRegions(query, { kind: "country", limit: Infinity })[0].id, id, `${query} in country results`);
  }
});

test("unlimited regional searches include matches beyond the former 40 and 100 limits", () => {
  const results = searchRegions("USA", { limit: Infinity });
  assert.ok(results.length > 100);
  assert.equal(results.length, countRegions("USA"));
  assert.equal(new Set(results.map((entry) => entry.id)).size, results.length);
  assert.ok(results.some((entry) => entry.kind === "country"));
  assert.ok(results.some((entry) => entry.kind === "state"));
  assert.ok(results.some((entry) => entry.kind === "needmap"));
});

test("region membership uses polygons, holes, and the date line, never bounding boxes", () => {
  const shape = square(-2, -2, 2, 2);
  shape.coordinates.push(square(-1, -1, 1, 1).coordinates[0]);
  const region = normalizeNavigationRegion(california({ geojson: shape }));
  assert.equal(regionContains(region, 0, 0), false);
  assert.equal(regionContains(region, 0, 1.5), true);
  assert.equal(regionContains(region, 0, 10), false);
  const dateline = normalizeNavigationRegion(california({ geojson: square(179, -2, -179, 2) }));
  assert.equal(regionContains(dateline, 0, 179.5), true);
  assert.equal(regionContains(dateline, 0, -179.5), true);
  assert.equal(regionContains(dateline, 0, 0), false);
  assert.deepEqual(dateline.bounds, [[-2, -180], [2, 180]]);
  assert.equal(regionContains(WORLD_REGION, 0, 0), true);
  assert.equal(regionContains(WORLD_REGION, NaN, 0), false);
  assert.deepEqual(normalizeNavigationRegion(california({ geojson: square(10, 86, 20, 89) })).bounds,
    [[85, 10], [85, 20]]);
});

test("malformed, incomplete, and non-administrative boundaries are rejected", () => {
  for (const geojson of [null, {}, { type: "Point", coordinates: [-122, 37] },
    { type: "Polygon", coordinates: [] }, square(181, -2, 190, 2),
    { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [2, 2]]] }]) {
    assert.equal(normalizeNavigationRegion(california({ geojson })), null);
  }
  assert.equal(normalizeNavigationRegion(california({ addresstype: "house" })), null);
  const expected = searchRegions("California")[0];
  assert.equal(normalizeNavigationRegion(country(), expected), null);
  assert.equal(normalizeNavigationRegion(california({ address: { country_code: "ca" } }), expected), null);
  assert.equal(normalizeNavigationRegion(california({ name: "Nevada", address: { country_code: "us", state: "Nevada" } }), expected), null);
});

test("automatic IP detection selects a state without requesting device location", async () => {
  const requests = [], changes = [], writes = [];
  const navigation = createRegionNavigation({ fetchImpl: located,
    storage: { setItem: (...args) => writes.push(args), getItem: () => null },
    request: async (url) => { requests.push(url); return [california()]; },
    onChange: (...args) => changes.push(args),
  });
  await navigation.detect();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, "/search");
  assert.equal(requests[0].searchParams.get("state"), "California");
  assert.equal(requests[0].searchParams.has("lat"), false);
  assert.equal(requests[0].searchParams.has("lon"), false);
  assert.equal(changes[0][0].id, "US-CA");
  assert.equal(changes[0][1].source, "detected");
  assert.equal(writes.length, 2); // Existing boundary cache plus the selected catalog ID.
  assert.deepEqual(JSON.parse(writes.find(([key]) => key === SAVED_REGION_KEY)[1]), { version: 1, id: "US-CA" });
  navigation.destroy();
});

test("IP lookup keeps administrative fields and rounded in-memory position only", async () => {
  let options;
  const result = await loadIpRegion({ fetchImpl: async (url, config) => {
    options = config;
    return { ok: true, json: async () => ({ country_code: "us", region_code: "US-CA", region: "California",
      ip: "192.0.2.4", latitude: 37.123456789, longitude: -122.987654321, city: "Private city" }) };
  } });
  assert.deepEqual(result, { countryCode: "US", stateCode: "CA", stateName: "California", position: { latitude: 37.12, longitude: -122.99 } });
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
});

test("a missing or failed state boundary falls back to the country", async () => {
  for (const fails of [false, true]) {
    const levels = [];
    const navigation = createRegionNavigation({ fetchImpl: located, storage: null,
      request: async (url) => {
        levels.push(url.searchParams.get("featureType"));
        if (levels.length === 1) {
          if (fails) throw new Error("temporary failure");
          return [california({ geojson: { type: "Point", coordinates: [-122, 37] } })];
        }
        return [country()];
      },
    });
    assert.equal((await navigation.detect()).id, "US");
    assert.deepEqual(levels, ["state", "country"]);
    navigation.destroy();
  }
});

test("unknown state codes use country; a missing code can resolve the state's name", async () => {
  for (const [location, expected] of [
    [{ country_code: "US", region_code: "unknown", region: "Unknown" }, "US"],
    [{ country_code: "US", region: "California" }, "US-CA"],
    [{ country_code: "US", region_code: "FR-IDF", region: "California" }, "US-CA"],
  ]) {
    const navigation = createRegionNavigation({ storage: null,
      fetchImpl: async () => ({ ok: true, json: async () => location }),
      request: async (url) => [url.searchParams.has("state") ? california() : country()],
    });
    assert.equal((await navigation.detect()).id, expected);
    navigation.destroy();
  }
});

test("malformed IP data, rate limits, blocked CORS, and network errors preserve Worldwide", async () => {
  const providers = [
    async () => { throw new TypeError("Failed to fetch"); },
    async () => ({ ok: false, status: 429 }),
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } }),
    ...[null, [], {}, { country_code: "ZZ" }, { country_code: "USA" },
      { success: false, country_code: "US" }, { error: true, country_code: "US" }]
      .map((value) => async () => ({ ok: true, json: async () => value })),
  ];
  for (const fetchImpl of providers) {
    const statuses = [];
    let boundaryRequests = 0;
    const navigation = createRegionNavigation({ fetchImpl, storage: null,
      request: async () => { boundaryRequests += 1; throw new Error("No request expected"); },
      onStatus: (value) => statuses.push(value),
    });
    assert.equal(await navigation.detect(), null);
    assert.equal(navigation.getSelected(), WORLD_REGION);
    assert.equal(boundaryRequests, 0);
    assert.match(statuses.at(-1).message, /Worldwide; choose any region/);
    navigation.destroy();
  }
});

test("IP lookup timeout and caller cancellation abort its fetch", async () => {
  const waitingFetch = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  await assert.rejects(loadIpRegion({ fetchImpl: waitingFetch, timeoutMs: 5 }), { name: "AbortError" });
  const controller = new AbortController();
  const pending = loadIpRegion({ fetchImpl: waitingFetch, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("manual selection wins over an unresolved IP response", async () => {
  const ip = deferred(), changes = [];
  const navigation = createRegionNavigation({ fetchImpl: () => ip.promise, storage: null,
    request: async () => [country()], onChange: (value) => changes.push(value.id),
  });
  const detecting = navigation.detect();
  await navigation.select("US");
  ip.resolve(await located());
  await detecting;
  assert.deepEqual(changes, ["US"]);
  assert.equal(navigation.getSelected().id, "US");
  navigation.destroy();
});

test("late boundary responses cannot replace a newer choice even if requests ignore abort", async () => {
  const pending = deferred(), changes = [];
  const navigation = createRegionNavigation({ storage: null, request: () => pending.promise,
    onChange: (region) => changes.push(region.id),
  });
  const selecting = navigation.select("US-CA");
  navigation.worldwide();
  pending.resolve([california()]);
  await selecting;
  assert.deepEqual(changes, ["world"]);
  assert.equal(navigation.getSelected(), WORLD_REGION);
  navigation.destroy();
});

test("failed selection preserves the prior verified scope and cached boundaries work offline", async () => {
  const stored = new Map();
  const storage = { getItem: (key) => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) };
  let calls = 0;
  const navigation = createRegionNavigation({ storage,
    request: async () => { if (++calls > 1) throw new Error("offline"); return [california()]; },
  });
  assert.equal((await navigation.select("US-CA")).id, "US-CA");
  assert.equal(await navigation.select("US"), null);
  assert.equal(navigation.getSelected().id, "US-CA");
  navigation.worldwide();
  assert.equal((await navigation.select("US-CA")).id, "US-CA");
  assert.equal(calls, 2);
  navigation.destroy();
});

test("destroy suppresses late detection changes", async () => {
  const pending = deferred(), changes = [];
  const navigation = createRegionNavigation({ fetchImpl: located, storage: null,
    request: () => pending.promise, onChange: (region) => changes.push(region),
  });
  const detecting = navigation.detect();
  await Promise.resolve();
  navigation.destroy();
  pending.resolve([california()]);
  await detecting;
  assert.deepEqual(changes, []);
});

test("initialization restores a saved selection with a verified boundary before any IP request", async () => {
  const storage = preferenceStore(JSON.stringify({ version: 1, id: "US-CA", geometry: square(1, 1, 2, 2) }));
  const changes = [];
  let ipCalls = 0, boundaryCalls = 0;
  const navigation = createRegionNavigation({ storage,
    fetchImpl: async () => { ipCalls += 1; throw new Error("IP lookup should be skipped"); },
    request: async () => { boundaryCalls += 1; return [california()]; },
    onChange: (region, details) => changes.push([region.id, details.source]),
  });
  const restored = await navigation.initialize();
  assert.equal(restored.id, "US-CA");
  assert.deepEqual(restored.geometry, square());
  assert.equal(boundaryCalls, 1); assert.equal(ipCalls, 0);
  assert.deepEqual(changes, [["US-CA", "saved"]]);
  assert.deepEqual(JSON.parse(storage.getItem(SAVED_REGION_KEY)), { version: 1, id: "US-CA" });
  navigation.destroy();
});

test("manual selections persist across controllers and a failed choice does not replace them", async () => {
  const storage = preferenceStore();
  const first = createRegionNavigation({ storage, request: async (url) => {
    if (!url.searchParams.has("state")) throw new Error("Unavailable country boundary");
    return [california()];
  } });
  await first.select("US-CA");
  await first.select("US");
  assert.deepEqual(JSON.parse(storage.getItem(SAVED_REGION_KEY)), { version: 1, id: "US-CA" });
  first.destroy();
  const second = createRegionNavigation({ storage,
    request: async () => { throw new Error("Saved boundary should be cached"); },
    fetchImpl: async () => { throw new Error("Saved region should not request IP"); },
  });
  assert.equal((await second.initialize()).id, "US-CA");
  second.destroy();
});

test("missing, malformed, outdated, and deleted selections fall back to IP detection", async () => {
  for (const stored of [undefined, "{broken", "null", "[]", JSON.stringify({ version: 1, id: "deleted-region" }),
    JSON.stringify({ version: 0, id: "US-CA" }), JSON.stringify({ version: 1, id: { value: "US-CA" } })]) {
    const storage = preferenceStore(stored);
    let ipCalls = 0;
    const navigation = createRegionNavigation({ storage,
      fetchImpl: async () => { ipCalls += 1; return located(); }, request: async () => [california()],
    });
    assert.equal((await navigation.initialize()).id, "US-CA", stored);
    assert.equal(ipCalls, 1);
    assert.deepEqual(JSON.parse(storage.getItem(SAVED_REGION_KEY)), { version: 1, id: "US-CA" });
    navigation.destroy();
  }
});

test("an unavailable saved boundary falls back to detection and saves the verified replacement", async () => {
  const storage = preferenceStore(JSON.stringify({ version: 1, id: "CA" }));
  const changes = [];
  const navigation = createRegionNavigation({ storage, fetchImpl: located,
    request: async (url) => {
      if (url.searchParams.get("countrycodes") === "ca") throw new Error("Missing saved boundary");
      return [california()];
    }, onChange: (region, details) => changes.push([region.id, details.source]),
  });
  assert.equal((await navigation.initialize()).id, "US-CA");
  assert.deepEqual(changes, [["US-CA", "detected"]]);
  assert.deepEqual(JSON.parse(storage.getItem(SAVED_REGION_KEY)), { version: 1, id: "US-CA" });
  navigation.destroy();
});

test("a saved NeedMap area reloads its actual parent file and selects the child", async () => {
  const entries = [
    { id: "US", name: "United States", label: "United States", kind: "country", countryCode: "US", parentId: "", boundaryFile: "" },
    { id: "US-CA", name: "California", label: "California, United States", kind: "state", countryCode: "US", parentId: "", boundaryFile: "data/regions/US-CA.json" },
    { id: "US-CA-north", name: "California — North", label: "California — North, United States", kind: "needmap", countryCode: "US", parentId: "US-CA", boundaryFile: "data/regions/US-CA.json" },
  ];
  const storage = preferenceStore(JSON.stringify({ version: 1, id: "US-CA-north" }));
  const loaded = [];
  const navigation = makeRegionNavigation({ entries, storage,
    loadBoundarySet: async (entry) => { loaded.push(entry.id); return entries.slice(1).map((entry) => ({ ...entry, geometry: square() })); },
    fetchImpl: async () => { throw new Error("IP lookup should be skipped"); },
  });
  assert.equal((await navigation.initialize()).id, "US-CA-north");
  assert.deepEqual(loaded, ["US-CA"]);
  assert.equal(navigation.getRegions().length, 1);
  navigation.destroy();
});

test("manual choice during saved-region restoration stops stale restoration and its detection fallback", async () => {
  const storage = preferenceStore(JSON.stringify({ version: 1, id: "US-CA" }));
  const pending = deferred(), changes = [];
  let ipCalls = 0;
  const navigation = createRegionNavigation({ storage,
    fetchImpl: async () => { ipCalls += 1; return located(); },
    request: async (url) => url.searchParams.has("state") ? pending.promise : [country()],
    onChange: (region) => changes.push(region.id),
  });
  const restoring = navigation.initialize();
  await navigation.select("US");
  pending.resolve([california()]);
  assert.equal(await restoring, null);
  assert.equal(navigation.getSelected().id, "US");
  assert.equal(ipCalls, 0);
  assert.deepEqual(changes, ["US"]);
  assert.deepEqual(JSON.parse(storage.getItem(SAVED_REGION_KEY)), { version: 1, id: "US" });
  navigation.destroy();
});

test("blocked preference storage permits automatic initialization and subsequent manual changes", async () => {
  const blocked = () => { throw new Error("Storage blocked"); };
  const navigation = createRegionNavigation({ storage: { getItem: blocked, setItem: blocked, removeItem: blocked },
    fetchImpl: located, request: async (url) => [url.searchParams.has("state") ? california() : country()],
  });
  assert.equal((await navigation.initialize()).id, "US-CA");
  assert.equal((await navigation.select("US")).id, "US");
  navigation.destroy();
});

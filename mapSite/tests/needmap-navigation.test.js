import assert from "node:assert/strict";
import { test } from "node:test";
import { createRegionNavigation, countRegions, regionContains, searchRegions, WORLD_REGION, SAVED_REGION_KEY } from "../region-navigation.js";
import { WORLD_REGION_ROWS } from "../world-region-catalog.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const countries = [["US", "United States"], ["IN", "India"], ["AU", "Australia"], ["CA", "Canada"],
  ["MX", "Mexico"], ["BR", "Brazil"], ["AR", "Argentina"], ["NZ", "New Zealand"], ["JP", "Japan"]]
  .map(([id, name]) => ({ id, name, label: name, kind: "country", country: name, countryCode: id, parentId: "", boundaryFile: "" }));
const specifications = [
  ["US-CA", "California", "US", [-124, 32, -114, 42]],
  ["IN-TN", "Tamil Nadu", "IN", [76, 8, 81, 14]],
  ["AU-NSW", "New South Wales", "AU", [141, -37, 154, -28]],
];
const descriptors = [...countries], boundarySets = new Map();
const childId = (parentId, direction) => `${parentId}:needmap-v2:${direction}`;
for (const [id, name, code, bounds] of specifications) {
  const country = countries.find((entry) => entry.id === code).name;
  const parent = { id, name, label: `${name}, ${country}`, kind: "state", countryCode: code, country,
    nativeName: name, parentId: "", boundaryFile: `regions/${id}.json` };
  const [west, south, east, north] = bounds, middle = (south + north) / 2;
  const records = [{ ...parent, geometry: square(...bounds) }];
  descriptors.push(parent);
  for (const [direction, low, high] of [["north", middle, north], ["south", south, middle]]) {
    const child = { ...parent, id: childId(id, direction), name: `${name} — ${direction}`, label: `${name} — ${direction}, ${country}`,
      kind: "needmap", parentId: id, parentName: name };
    descriptors.push(child); records.push({ ...child, geometry: square(west, low, east, high) });
  }
  boundarySets.set(id, records);
}
const fallbackRequest = async (url) => {
  const code = url.searchParams.get("countrycodes").toUpperCase(), entry = countries.find((country) => country.id === code);
  return [{ name: entry.name, addresstype: "country", address: { country: entry.name, country_code: code.toLowerCase() }, geojson: square(-140, 10, -50, 75) }];
};
const located = async () => ({ ok: true, json: async () => ({ country_code: "US", region_code: "CA", region: "California",
  latitude: 37.123456789, longitude: -121.234567891, ip: "192.0.2.4", city: "Private city" }) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const createNavigation = (options = {}) => createRegionNavigation({ entries: descriptors, request: fallbackRequest, storage: null,
  fetchImpl: located, loadBoundarySet: async (entry) => structuredClone(boundarySets.get(entry.id)), ...options });

test("every generated global directory entry is reachable exactly once through paginated browsing", () => {
  const count = countRegions(""), found = [];
  assert.equal(count, WORLD_REGION_ROWS.length);
  for (let offset = 0; offset < count; offset += 100) found.push(...searchRegions("", { offset, limit: 100 }));
  assert.equal(new Set(found.map((entry) => entry.id)).size, count);
  assert.deepEqual(found.map((entry) => entry.id).sort(), WORLD_REGION_ROWS.map(([id]) => id).sort());
  const alphabetical = [...found].sort((first, second) => first.label.localeCompare(second.label) || first.id.localeCompare(second.id));
  for (let index = 0; index < found.length; index += 1) assert.equal(found[index].id, alphabetical[index].id, `Directory order at row ${index}`);
  assert.deepEqual(searchRegions("", { offset: count, limit: 100 }), []);
  assert.ok(found.some((entry) => entry.kind === "country"));
  assert.ok(found.some((entry) => entry.kind === "state"));
  assert.ok(found.some((entry) => entry.kind === "needmap"), "The complete release must include precomputed NeedMap regions");
});

test("precomputed custom regions across continents are discoverable before opening any parent", () => {
  const custom = WORLD_REGION_ROWS.filter((row) => row[3] === "needmap");
  for (const code of ["US", "IN", "AU", "BR"]) {
    const entry = custom.find((row) => row[4] === code);
    assert.ok(entry, `The worldwide index should include ${code} custom regions`);
    assert.equal(searchRegions(entry[0])[0]?.id, entry[0]);
    assert.ok(searchRegions(entry[1], { limit: 100 }).some((result) => result.id === entry[0]));
  }
});

test("an indexed child opens directly before its parent and exposes verified siblings", async () => {
  for (const [parentId] of specifications) {
    const loads = [], changes = [];
    const navigation = createNavigation({
      loadBoundarySet: async (entry, options) => { loads.push([entry.id, options]); return structuredClone(boundarySets.get(entry.id)); },
      onChange: (region) => changes.push(region.id),
    });
    try {
      const id = childId(parentId, "south");
      assert.equal((await navigation.select(id)).id, id);
      assert.deepEqual(changes, [id]); assert.deepEqual(navigation.getRegions().map((entry) => entry.id), [childId(parentId, "north"), id]);
      assert.equal(loads.length, 1); assert.equal(loads[0][0], parentId); assert.ok(loads[0][1].signal instanceof AbortSignal);
      assert.equal((await navigation.select(parentId)).id, parentId);
      assert.equal(navigation.getSelected().id, parentId); assert.equal(loads.length, 1);
    } finally { navigation.destroy(); }
  }
});

test("directory labels and computed bounds override untrusted labels and bounds in a downloaded file", async () => {
  const navigation = createNavigation({ loadBoundarySet: async () => boundarySets.get("US-CA").map((record) => ({ ...record, name: "Wrong name", label: "Wrong label", bounds: [[0, 0], [0, 0]] })) });
  try {
    const selected = await navigation.select(childId("US-CA", "north"));
    assert.equal(selected.label, "California — north, United States");
    assert.deepEqual(selected.bounds, [[37, -124], [42, -114]]);
  } finally { navigation.destroy(); }
});

test("IP detection selects the containing indexed child and never passes or persists IP coordinates outside local selection", async () => {
  const calls = [], writes = [], changes = [];
  const navigation = createNavigation({ storage: { getItem: () => null, setItem: (...args) => writes.push(args) },
    request: async () => assert.fail("Indexed regions should not use the fallback geocoder"),
    loadBoundarySet: async (entry, options) => { calls.push([entry, Object.keys(options)]); return structuredClone(boundarySets.get(entry.id)); },
    onChange: (region, meta) => changes.push([region.id, meta.source]),
  });
  try {
    assert.equal((await navigation.detect()).id, childId("US-CA", "north"));
    assert.deepEqual(changes, [[childId("US-CA", "north"), "detected"]]);
    assert.equal(calls.length, 1); assert.deepEqual(calls[0][1].sort(), ["fetchImpl", "signal"]);
    assert.doesNotMatch(JSON.stringify(calls[0][0]), /37\.12|-121\.23|192\.0\.2\.4|Private city|latitude|longitude|position/);
    assert.deepEqual(writes, [[SAVED_REGION_KEY, JSON.stringify({ version: 1, id: childId("US-CA", "north") })]]);
    assert.doesNotMatch(JSON.stringify(writes), /37\.12|-121\.23|192\.0\.2\.4|Private city|latitude|longitude|position/);
  } finally { navigation.destroy(); }
});

test("automatic child selection respects exclusions and keeps whole states for missing or out-of-parent coordinates", async () => {
  const records = structuredClone(boundarySets.get("US-CA"));
  records[1].geometry = records[0].geometry;
  records[1].excludedGeometry = square(-124, 37, -114, 42);
  records[2].geometry = square(-124, 37, -114, 42);
  assert.equal(regionContains(records[1], 37.12, -121.23), false);
  const excluded = createNavigation({ loadBoundarySet: async () => records });
  try { assert.equal((await excluded.detect()).id, childId("US-CA", "south")); } finally { excluded.destroy(); }
  for (const position of [{}, { latitude: 0, longitude: 0 }, { latitude: "", longitude: "" }]) {
    const navigation = createNavigation({ fetchImpl: async () => ({ ok: true, json: async () => ({ country_code: "US", region_code: "CA", ...position }) }) });
    try { assert.equal((await navigation.detect()).id, "US-CA"); } finally { navigation.destroy(); }
  }
});

test("provider failure, missing records, mismatched IDs, duplicated records and invalid geometry preserve the previous selection", async () => {
  const original = boundarySets.get("US-CA");
  const providers = [
    async () => { throw new Error("Offline"); }, async () => [], async () => original.slice(0, -1),
    async () => [...original, original[1]],
    ...[
      { id: "US-CA:needmap-v2:unknown" }, { countryCode: "IN" }, { parentId: "AU-NSW" }, { kind: "state" },
      { geometry: { type: "Point", coordinates: [-120, 37] } }, { excludedGeometry: { type: "Polygon", coordinates: [] } },
    ].map((invalid) => async () => original.map((record, index) => index === 1 ? { ...record, ...invalid } : record)),
  ];
  for (const loadBoundarySet of providers) {
    const statuses = [], updates = [];
    const navigation = createNavigation({ loadBoundarySet, onStatus: (value) => statuses.push(value), onRegions: (...args) => updates.push(args) });
    try {
      await navigation.select("CA");
      assert.equal(await navigation.select(childId("US-CA", "north")), null);
      assert.equal(navigation.getSelected().id, "CA"); assert.equal(statuses.at(-1).state, "error");
      assert.deepEqual(updates, []); assert.deepEqual(navigation.getRegions(), []);
    } finally { navigation.destroy(); }
  }
});

test("a failed boundary file can be retried without a poisoned cache", async () => {
  let loads = 0;
  const navigation = createNavigation({ loadBoundarySet: async () => ++loads === 1 ? [] : structuredClone(boundarySets.get("US-CA")) });
  try {
    assert.equal(await navigation.select(childId("US-CA", "north")), null);
    assert.equal((await navigation.select(childId("US-CA", "north"))).id, childId("US-CA", "north"));
    assert.equal(loads, 2);
  } finally { navigation.destroy(); }
});

test("automatic detection falls back to its verified country when the indexed state file fails", async () => {
  const requests = [];
  const navigation = createNavigation({ loadBoundarySet: async () => { throw new Error("Missing state file"); },
    request: async (url) => { requests.push(url); return fallbackRequest(url); },
  });
  try {
    assert.equal((await navigation.detect()).id, "US");
    assert.equal(requests.length, 1); assert.equal(requests[0].searchParams.get("featureType"), "country");
    assert.equal(requests[0].searchParams.has("lat"), false); assert.equal(requests[0].searchParams.has("lon"), false);
    assert.deepEqual(navigation.getRegions(), []);
  } finally { navigation.destroy(); }
});

test("loaded siblings and their whole state remain usable offline with blocked persistent storage", async () => {
  for (const storage of [null, { getItem() { throw new Error("Blocked"); }, setItem() { throw new Error("Blocked"); } }]) {
    let loads = 0;
    const navigation = createNavigation({ storage, loadBoundarySet: async () => { if (++loads > 1) throw new Error("Offline"); return structuredClone(boundarySets.get("US-CA")); } });
    try {
      await navigation.select(childId("US-CA", "north"));
      assert.equal((await navigation.select(childId("US-CA", "south"))).id, childId("US-CA", "south"));
      assert.equal((await navigation.select("US-CA")).id, "US-CA");
      navigation.worldwide(); assert.equal((await navigation.select(childId("US-CA", "north"))).id, childId("US-CA", "north"));
      assert.equal(loads, 1);
    } finally { navigation.destroy(); }
  }
});

test("a failed IP request preserves an already selected custom region", async () => {
  const navigation = createNavigation({ fetchImpl: async () => { throw new TypeError("Offline"); } });
  try {
    await navigation.select(childId("IN-TN", "north"));
    assert.equal(await navigation.detect(), null); assert.equal(navigation.getSelected().id, childId("IN-TN", "north"));
  } finally { navigation.destroy(); }
});

test("manual choices beat late IP and boundary-file responses even if the providers ignore abort", async () => {
  for (const stage of ["ip", "boundary"]) {
    const pending = deferred(), entered = deferred(), changes = [], updates = [];
    const navigation = createNavigation({
      fetchImpl: stage === "ip" ? () => { entered.resolve(); return pending.promise; } : located,
      loadBoundarySet: stage === "boundary" ? () => { entered.resolve(); return pending.promise; } : async (entry) => structuredClone(boundarySets.get(entry.id)),
      onChange: (region) => changes.push(region.id), onRegions: (regions) => updates.push(regions),
    });
    try {
      const detecting = navigation.detect(); await entered.promise;
      await navigation.select("CA");
      pending.resolve(stage === "ip" ? await located() : structuredClone(boundarySets.get("US-CA"))); await detecting;
      assert.deepEqual(changes, ["CA"]); assert.deepEqual(updates, []); assert.equal(navigation.getSelected().id, "CA");
    } finally { navigation.destroy(); }
  }
});

test("late boundary failure does not overwrite the current region's successful status", async () => {
  const pending = deferred(), entered = deferred(), statuses = [];
  const navigation = createNavigation({ loadBoundarySet: () => { entered.resolve(); return pending.promise; }, onStatus: (status) => statuses.push(status) });
  try {
    const selecting = navigation.select(childId("US-CA", "north")); await entered.promise;
    await navigation.select("CA"); const last = statuses.at(-1);
    pending.reject(new Error("Late failure")); await selecting;
    assert.equal(statuses.at(-1), last); assert.equal(navigation.getSelected().id, "CA");
  } finally { navigation.destroy(); }
});

test("Worldwide and destroy suppress pending custom selection and prevent stale files entering memory", async () => {
  for (const destroy of [false, true]) {
    const pending = deferred(), entered = deferred(), changes = [], updates = [];
    let calls = 0;
    const navigation = createNavigation({ loadBoundarySet: async () => { if (++calls > 1) return structuredClone(boundarySets.get("US-CA")); entered.resolve(); return pending.promise; },
      onChange: (region) => changes.push(region.id), onRegions: (regions) => updates.push(regions),
    });
    const selecting = navigation.select(childId("US-CA", "north")); await entered.promise;
    if (destroy) navigation.destroy(); else navigation.worldwide();
    pending.resolve(structuredClone(boundarySets.get("US-CA"))); await selecting;
    assert.equal(navigation.getSelected(), WORLD_REGION); assert.deepEqual(updates, []);
    assert.deepEqual(changes, destroy ? [] : ["world"]);
    if (!destroy) { await navigation.select(childId("US-CA", "north")); assert.equal(calls, 2); navigation.destroy(); }
  }
});

test("verified parent memory is bounded and retains recently visited entries", async () => {
  const calls = [], navigation = createNavigation({ request: async (url) => { calls.push(url.searchParams.get("countrycodes").toUpperCase()); return fallbackRequest(url); } });
  try {
    for (const country of countries.slice(0, 8)) await navigation.select(country.id);
    await navigation.select("US"); assert.equal(calls.length, 8);
    await navigation.select("JP"); await navigation.select("US"); assert.equal(calls.length, 9);
    await navigation.select("IN"); assert.deepEqual(calls, [...countries.map((entry) => entry.id), "IN"]);
  } finally { navigation.destroy(); }
});

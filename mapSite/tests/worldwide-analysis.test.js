import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendationsForRegion } from "../analysis.js";
import { createWorldwideAnalysisRegionLoader, worldwideAnalysisScopeEntries } from "../worldwide-analysis-regions.js";
import { loadNavigationRegion, WORLD_REGION } from "../region-navigation.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const country = { id: "AA", name: "First country", kind: "country", countryCode: "AA", geometry: square(-10, -10, 10, 10) };
const west = { id: "AA-W", name: "Western state", kind: "state", countryCode: "AA", geometry: square(-10, -10, 0, 10) };
const east = { id: "AA-E", name: "Eastern state", kind: "state", countryCode: "AA", geometry: square(0, -10, 10, 10) };
const north = { id: "AA-W:north", name: "North area", kind: "needmap", parentId: west.id, countryCode: "AA", geometry: square(-10, 0, 0, 10) };
const south = { id: "AA-W:south", name: "South area", kind: "needmap", parentId: west.id, countryCode: "AA", geometry: square(-10, -10, 0, 0) };
const foreign = { id: "BB", name: "Second country", kind: "country", countryCode: "BB", geometry: square(15, -10, 25, 10) };
const rows = [country, west, east, north, south, foreign].map((region) =>
  [region.id, region.name, "", region.kind, region.countryCode, region.parentId || "", ""]);
const report = (id, longitude, region, extra = {}) => ({
  id, longitude, latitude: 1, category: "water", severity: "low", summary: "Water is unavailable", region, ...extra,
});
const waterAcrossStates = () => [report("west", -4, west), report("east", 4, east, { severity: "high" })];
const waterAcrossChildren = () => [report("north", -4, north), report("south", -4, south, { latitude: -1 })];
const world = (reports, analysisRegions = []) => buildRecommendationsForRegion(reports, WORLD_REGION, { analysisRegions });

test("Worldwide includes supported country analysis without inventing a site for either regional singleton", () => {
  const reports = waterAcrossStates();
  assert.deepEqual(world(reports), []);
  const candidates = world(reports, [country]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].region.id, country.id);
  assert.equal(candidates[0].signals.length, 2);
  assert.equal(candidates[0].urgencyScore, 3, "the high-report weight remains two");
  assert.deepEqual(candidates, buildRecommendationsForRegion(reports, country));
  assert.deepEqual(world([reports[0]], [country, west]), []);
});

test("identical evidence prefers detailed analysis and broader distinct evidence prefers state over country", () => {
  const reports = [...waterAcrossChildren(), report("south-two", -4.01, south, { latitude: -1 })];
  const candidates = world(reports, [country, west]);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => [candidate.region.id, candidate.signals.length]).sort(),
    [[west.id, 3], [south.id, 2]].sort());
  assert.deepEqual(world([...reports].reverse(), [west, country, west]), candidates);
  assert.deepEqual(world(reports.slice(1), [west, country]), world(reports.slice(1)),
    "the same two reports must not create child/state/country copies");
});

test("Worldwide has no global three-location cap and preserves independent scope ranks", () => {
  const scopes = [], reports = [];
  for (const [index, code] of ["AA", "BB", "CC", "DD"].entries()) {
    const longitude = -70 + index * 40;
    const scope = { ...country, id: code, countryCode: code, geometry: square(longitude, -2, longitude + 10, 2) };
    const first = { ...west, id: `${code}-W`, countryCode: code, geometry: square(longitude, -2, longitude + 5, 2) };
    const second = { ...east, id: `${code}-E`, countryCode: code, geometry: square(longitude + 5, -2, longitude + 10, 2) };
    scopes.push(scope);
    reports.push(report(`${code}-a`, longitude + 2, first), report(`${code}-b`, longitude + 8, second));
  }
  const candidates = world(reports, scopes);
  assert.equal(candidates.length, 4);
  assert.ok(candidates.every(({ signals, locationRank, locationCount }) => signals.length === 2 && locationRank === 1 && locationCount === 1));
});

test("extra scopes cannot mix countries or use reports outside their verified source assignment", () => {
  const domestic = waterAcrossStates();
  const broad = { ...country, geometry: square(-30, -10, 30, 10) };
  const invalid = [report("foreign", 20, foreign, { severity: "high" }),
    report("stale", 6, west, { severity: "high" }), report("no-boundary", 0, { id: "unknown", countryCode: "AA" })];
  assert.deepEqual(world([...domestic, ...invalid], [broad]), world(domestic, [broad]));
  assert.deepEqual(world(domestic, [{ ...country, countryCode: "BB" }]), []);
  const before = structuredClone(domestic);
  assert.deepEqual(buildRecommendationsForRegion(domestic, west, { analysisRegions: [country] }),
    buildRecommendationsForRegion(domestic, west));
  assert.deepEqual(domestic, before);
});

test("scope discovery requests only shared-country and shared-parent analyses with unique matching support", () => {
  assert.deepEqual(worldwideAnalysisScopeEntries(waterAcrossStates(), rows).map(({ id }) => id), [country.id]);
  assert.deepEqual(worldwideAnalysisScopeEntries(waterAcrossChildren(), rows).map(({ id }) => id), [west.id, country.id]);
  assert.deepEqual(worldwideAnalysisScopeEntries([report("a", -4, north), report("b", -4.01, north)], rows), []);
  assert.deepEqual(worldwideAnalysisScopeEntries([report("a", -4, west), report("b", 4, east, { category: "food" })], rows), []);
  assert.deepEqual(worldwideAnalysisScopeEntries([report("same", -4, west), report("same", 4, east)], rows), []);
  assert.deepEqual(worldwideAnalysisScopeEntries([report("a", -4, west), report("b", 20, foreign)], rows), []);
  assert.deepEqual(worldwideAnalysisScopeEntries([report("a", -4, west), report("b", 4, west)], rows), []);
});

test("scope loading preserves partial success, retries failures, and caches verified boundaries", async () => {
  const calls = [], progress = [];
  let failParent = true;
  const load = createWorldwideAnalysisRegionLoader({ rows, loadRegion: async (entry) => {
    calls.push(entry.id);
    if (entry.id === west.id && failParent) throw new Error("Temporary boundary failure");
    return entry.id === west.id ? west : country;
  } });
  const first = await load(waterAcrossChildren(), { onProgress: (...values) => progress.push(values) });
  assert.deepEqual(first.regions, [country]);
  assert.equal(first.failures[0].regionId, west.id);
  assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
  failParent = false;
  const second = await load(waterAcrossChildren());
  assert.deepEqual(second, { regions: [west, country], failures: [] });
  assert.deepEqual(calls, [west.id, country.id, west.id]);
});

test("expired or mismatched country boundaries cannot be reused", async () => {
  let time = 1000, calls = 0;
  const load = createWorldwideAnalysisRegionLoader({ rows, now: () => time, loadRegion: async () => {
    calls += 1;
    return calls === 1 ? country : { ...country, countryCode: "BB" };
  } });
  assert.equal((await load(waterAcrossStates())).regions.length, 1);
  time += 31 * 24 * 60 * 60 * 1000;
  const result = await load(waterAcrossStates());
  assert.equal(result.regions.length, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(calls, 2);
});

test("aborted scope loads reject promptly and late ignored-abort responses cannot populate the cache", async () => {
  let calls = 0, deliver;
  const load = createWorldwideAnalysisRegionLoader({ rows, loadRegion: async () => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { deliver = resolve; });
    return country;
  } });
  const before = new AbortController(); before.abort();
  await assert.rejects(load(waterAcrossStates(), { signal: before.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
  const active = new AbortController();
  const operation = load(waterAcrossStates(), { signal: active.signal });
  await Promise.resolve();
  active.abort();
  await assert.rejects(operation, { name: "AbortError" });
  deliver(country);
  await Promise.resolve();
  assert.deepEqual(await load(waterAcrossStates()), { regions: [country], failures: [] });
  assert.equal(calls, 2);
});

test("nonmutating country boundary loading verifies country identity and uses the existing cache", async () => {
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  let calls = 0;
  const request = async () => {
    calls += 1;
    return [{ osm_id: 999, osm_type: "relation", name: "Canada", type: "country", addresstype: "country",
      address: { country: "Canada", country_code: "ca" }, geojson: square(-140, 45, -50, 80) }];
  };
  const first = await loadNavigationRegion({ id: "CA" }, { request, storage });
  const second = await loadNavigationRegion({ id: "CA" }, { request, storage });
  assert.equal(first.id, "CA");
  assert.equal(first.countryCode, "CA");
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.ok([...saved.keys()].every((key) => key.startsWith("needmap-navigation-v1:")), "boundary loading cannot change the selected-region preference");
  await assert.rejects(loadNavigationRegion({ id: "AU" }, { request, storage }), /verified boundary/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendationsForRegion, weightedGeographicCenter } from "../analysis.js";
import { buildPlanModel } from "../plans-model.js";
import { WORLD_REGION } from "../region-navigation.js";
import { haversineDistance } from "../decision-tools.js";
import { pointInGeometry } from "../regions.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const country = { id: "AA", name: "First country", kind: "country", countryCode: "AA", geometry: square(-5, -5, 5, 5) };
const west = { id: "AA-W", name: "Western state", kind: "state", countryCode: "AA", geometry: square(-5, -5, 0, 5) };
const east = { id: "AA-E", name: "Eastern state", kind: "state", countryCode: "AA", geometry: square(0, -5, 5, 5) };
const foreign = { id: "BB", name: "Second country", kind: "country", countryCode: "BB", geometry: square(5.01, -5, 15, 5) };
const report = (id, longitude, region, extra = {}) => ({
  id, longitude, latitude: 0, category: "water", severity: "low", summary: "Reliable water is needed", region, ...extra,
});
const pair = (prefix, longitude, region, extra = {}) => [
  report(`${prefix}-a`, longitude, region, extra), report(`${prefix}-b`, longitude + 0.02, region, extra),
];
const plans = (reports, region) => buildPlanModel({ reports, region, type: "water_facility", currentYear: 2026 });
const placementSummary = (candidates) => candidates.map((candidate) => ({
  regionId: candidate.region.id,
  position: candidate.position,
  reportIds: (candidate.signals || candidate.supportingReports).map(({ id }) => id).sort(),
  urgencyScore: candidate.urgencyScore,
})).sort((first, second) => JSON.stringify(first.reportIds).localeCompare(JSON.stringify(second.reportIds)));

test("a selected state is unchanged by sibling-state and foreign reports, including stale region metadata", () => {
  const local = pair("local", -3, west);
  const outside = [
    ...pair("sibling", 3, east, { severity: "high" }),
    ...pair("foreign", 8, foreign, { severity: "high" }),
    // A stale foreign record must not replace the genuine local record with this ID.
    report(local[0].id, 9, west, { severity: "high" }),
  ];
  const all = [...outside, ...local];
  const before = structuredClone(all);
  const expectedMap = buildRecommendationsForRegion(local, west);
  const expectedPlans = plans(local, west).candidates;
  assert.equal(expectedMap.length, 1);
  assert.deepEqual(buildRecommendationsForRegion(all, west), expectedMap);
  assert.deepEqual(plans(all, west).candidates, expectedPlans);
  assert.deepEqual(placementSummary(expectedMap), placementSummary(expectedPlans));
  assert.deepEqual(all, before, "scoping must not rewrite report data or its resolved region");
});

test("selecting a country can combine its subregions without a report-distance cutoff", () => {
  const domestic = [report("western", -3, west), report("eastern", 3, east, { severity: "high" })];
  assert.ok(haversineDistance(domestic[0], domestic[1]) > 600);
  const expectedCenter = weightedGeographicCenter(domestic);
  const countryMap = buildRecommendationsForRegion(domestic, country);
  const countryPlans = plans(domestic, country).candidates;
  assert.equal(countryMap.length, 1);
  assert.equal(countryMap[0].region.id, country.id);
  assert.deepEqual(countryMap[0].position, expectedCenter);
  assert.deepEqual(countryMap[0].signals.map(({ id }) => id).sort(), ["eastern", "western"]);
  assert.equal(countryMap[0].urgencyScore, 3);
  assert.equal(pointInGeometry(expectedCenter.longitude, expectedCenter.latitude, country.geometry), true);
  assert.deepEqual(placementSummary(countryPlans), placementSummary(countryMap));

  // The same two reports do not meet minimum support in either state or in
  // Worldwide, which preserves each report's own resolved region.
  for (const selected of [west, east, WORLD_REGION]) {
    assert.deepEqual(buildRecommendationsForRegion(domestic, selected), []);
    assert.deepEqual(plans(domestic, selected).candidates, []);
  }
});

test("a selected country's proposal ignores foreign coordinates even when their metadata claims the selected country", () => {
  const domestic = [report("western", -3, west), report("eastern", 3, east)];
  const foreignReports = [
    ...pair("foreign", 8, foreign, { severity: "high" }),
    report("stale-country", 8.5, country, { severity: "high" }),
    report("stale-state", 9, west, { severity: "high" }),
    report("invalid", 0, country, { latitude: NaN, severity: "high" }),
  ];
  assert.deepEqual(buildRecommendationsForRegion([...domestic, ...foreignReports], country),
    buildRecommendationsForRegion(domestic, country));
  assert.deepEqual(plans([...domestic, ...foreignReports], country).candidates, plans(domestic, country).candidates);
});

test("Worldwide keeps nearby cross-border reports in separate regional groups", () => {
  const crossBorder = [report("first-country", 4.999, east), report("second-country", 5.011, foreign)];
  assert.ok(haversineDistance(crossBorder[0], crossBorder[1]) < 2);
  assert.deepEqual(buildRecommendationsForRegion(crossBorder, WORLD_REGION), []);
  assert.deepEqual(plans(crossBorder, WORLD_REGION).candidates, []);
  for (const selected of [country, foreign]) {
    assert.deepEqual(buildRecommendationsForRegion(crossBorder, selected), []);
    assert.deepEqual(plans(crossBorder, selected).candidates, []);
  }
});

test("additional regional groups cannot move or change the supporting evidence of an existing Worldwide proposal", () => {
  const local = pair("local", -3, west);
  const other = [...pair("sibling", 3, east), ...pair("foreign", 8, foreign, { severity: "high" })];
  const expectedMap = buildRecommendationsForRegion(local, WORLD_REGION);
  const expectedPlans = plans(local, WORLD_REGION).candidates;
  const combinedMap = buildRecommendationsForRegion([...other, ...local], WORLD_REGION);
  const combinedPlans = plans([...other, ...local], WORLD_REGION).candidates;
  assert.equal(combinedMap.length, 3);
  assert.equal(combinedPlans.length, 3);
  assert.deepEqual(combinedMap.filter(({ region }) => region.id === west.id), expectedMap);
  // Worldwide's display rank may change; the regional proposal itself cannot.
  assert.deepEqual(placementSummary(combinedPlans.filter(({ region }) => region.id === west.id)),
    placementSummary(expectedPlans));
  assert.deepEqual(placementSummary(combinedMap), placementSummary(combinedPlans));
});

test("excluded regional partitions cannot supply evidence or attract the proposed center", () => {
  const partition = { ...country, id: "AA-partition", kind: "needmap", excludedGeometry: square(-1, -1, 1, 1) };
  const local = pair("local", -3, west);
  const excluded = pair("excluded", 0, country, { severity: "high" });
  const expected = buildRecommendationsForRegion(local, partition);
  assert.equal(expected.length, 1);
  assert.deepEqual(buildRecommendationsForRegion([...local, ...excluded], partition), expected);
  assert.deepEqual(plans([...local, ...excluded], partition).candidates, plans(local, partition).candidates);
  assert.equal(pointInGeometry(expected[0].position.longitude, expected[0].position.latitude, partition.excludedGeometry), false);
});

test("a selected region without a verified boundary cannot fall back to Worldwide proposals", () => {
  const reports = pair("known", -3, west);
  for (const selected of [null, { id: "AA-W", kind: "state", countryCode: "AA" }]) {
    assert.deepEqual(buildRecommendationsForRegion(reports, selected), []);
    const model = plans(reports, selected);
    assert.deepEqual(model.candidates, []);
    assert.equal(model.reason, "region-boundary-unavailable");
  }
});

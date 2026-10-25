import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendations, weightedGeographicCenter } from "../analysis.js";
import { haversineDistance } from "../decision-tools.js";
import { pointInGeometry } from "../regions.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const region = { id: "local-test", name: "Test region", geometry: square(-20, -20, 20, 20) };
const report = (id, longitude, extra = {}) => ({
  id, longitude, latitude: 0, category: "water", severity: "low", summary: "Water is unavailable", region, ...extra,
});

function assertRegional(candidates) {
  const used = new Set();
  const perGroup = new Map();
  for (const candidate of candidates) {
    assert.ok(candidate.signals.length >= 2);
    const distances = candidate.signals.map((signal) => haversineDistance(candidate.position, signal));
    assert.ok(Math.abs(candidate.maxSupportingDistanceKm - Math.max(...distances)) < 1e-8);
    assert.equal(pointInGeometry(candidate.position.longitude, candidate.position.latitude, candidate.region.geometry), true);
    for (const signal of candidate.signals) {
      assert.ok(!used.has(signal.id), "each report supports at most one location");
      used.add(signal.id);
    }
    const count = (perGroup.get(candidate.recommendationGroupId) || 0) + 1;
    perGroup.set(candidate.recommendationGroupId, count);
    assert.ok(count <= 3);
  }
}

test("Andhra screenshot: regional water analysis remains available for reports 181 km apart", () => {
  // Approximate public report coordinates from the reported failure. A food and
  // water report share the western point; all three remain input reports.
  const andhra = { id: "IN-AP", name: "Andhra Pradesh", geometry: square(79, 14, 83, 18) };
  const reports = [
    report("western-water", 80.1855, { latitude: 15.9255, severity: "high", region: andhra }),
    report("western-food", 80.1855, { latitude: 15.9255, severity: "high", category: "food", region: andhra }),
    report("eastern-water", 81.806039, { latitude: 16.404333, region: andhra }),
  ];
  const before = structuredClone(reports);
  assert.ok(haversineDistance(reports[0], reports[2]) > 181);
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].category, "water");
  assert.equal(candidates[0].signals.length, 2);
  assert.equal(candidates[0].urgencyScore, 3);
  const fraction = haversineDistance(reports[0], candidates[0].position) / haversineDistance(reports[0], reports[2]);
  assert.ok(Math.abs(fraction - 1 / 3) < 0.0001, "The point reflects the 2-to-1 weights without snapping to high urgency");
  assertRegional(candidates);
  assert.deepEqual(reports, before, "placement must not alter or remove source reports");
});

test("a distant same-region report contributes with the configured urgency weight", () => {
  const nearby = [report("local-a", 0), report("local-b", 0.002)];
  const candidates = buildRecommendations([...nearby, report("remote", 1, { severity: "high" })]);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].signals.map(({ id }) => id), ["local-a", "local-b", "remote"]);
  assert.ok(candidates[0].position.longitude > 0.50 && candidates[0].position.longitude < 0.51);
  assert.equal(candidates[0].urgencyScore, 4);
  assertRegional(candidates);
});

test("regional splitting retains all reports even when some are widely separated", () => {
  const nearby = [report("central-a", -0.001), report("central-b", 0.001)];
  const candidates = buildRecommendations([...nearby, report("west", -1), report("east", 1)]);
  assert.ok(candidates.length >= 1);
  assert.deepEqual(candidates.flatMap(({ signals }) => signals.map(({ id }) => id)).sort(), ["central-a", "central-b", "east", "west"]);
  assertRegional(candidates);
});

test("pairs within one region remain eligible regardless of their distance", () => {
  // Both equal-weight and high/low pairs 8.9 km apart have a local center.
  const equal = [report("a", -0.04), report("b", 0.04)];
  const supported = buildRecommendations(equal);
  assert.equal(supported.length, 1);
  assertRegional(supported);
  const lightlyWeighted = buildRecommendations([equal[0], { ...equal[1], severity: "high" }]);
  assert.equal(lightlyWeighted.length, 1);
  assertRegional(lightlyWeighted);
  for (const longitude of [0.044, 0.06, 1, 10]) {
    const candidates = buildRecommendations([report("a", -longitude), report("b", longitude, { severity: "high" })]);
    assert.equal(candidates.length, 1);
    assertRegional(candidates);
  }
});

test("high urgency shifts a nearby pair's center without snapping it to one report", () => {
  const low = report("low", 0), high = report("high", 0.01, { severity: "high" });
  const center = weightedGeographicCenter([low, high]);
  const fraction = haversineDistance(low, center) / haversineDistance(low, high);
  assert.ok(Math.abs(fraction - 2 / 3) < 1e-6);
  assert.ok(fraction > 0.66 && fraction < 0.67);
  const candidate = buildRecommendations([low, high])[0];
  assert.deepEqual(candidate.position, center);
  assert.equal(candidate.urgencyScore, 3);
  assert.equal(candidate.placementMethod, "report-cluster-weighted-center");
  assertRegional([candidate]);
});

test("long regional distributions retain their evidence across at most three sites", () => {
  const reports = Array.from({ length: 30 }, (_, index) => report(`chain-${index}`, index * 0.03));
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 3);
  assert.equal(candidates.flatMap(({ signals }) => signals).length, reports.length);
  assertRegional(candidates);
  assert.deepEqual(buildRecommendations([...reports].reverse()), candidates);
});

test("crossing the former five-kilometre cutoff no longer hides analysis", () => {
  const longitude = (kilometres) => kilometres / 6371.0088 * 180 / Math.PI;
  const candidates = buildRecommendations([report("a", -longitude(5)), report("b", longitude(5))]);
  assert.equal(candidates.length, 1);
  assertRegional(candidates);
  const beyond = buildRecommendations([
    report("a", -longitude(5.000001)), report("b", longitude(5.000001)),
  ]);
  assert.equal(beyond.length, 1);
  assertRegional(beyond);
});

test("nearby reports across the date line and at high latitudes use kilometres, not raw degree gaps", () => {
  const dateline = { ...region, geometry: square(178, -2, -178, 2) };
  const datePair = [report("a", 179.995, { region: dateline }), report("b", -179.995, { region: dateline })];
  const dateCandidates = buildRecommendations(datePair);
  assert.equal(dateCandidates.length, 1);
  assertRegional(dateCandidates);
  const polar = { ...region, geometry: square(-10, 85, 10, 90) };
  const polarPair = [report("a", -0.5, { latitude: 89, region: polar }), report("b", 0.5, { latitude: 89, region: polar })];
  const polarCandidates = buildRecommendations(polarPair);
  assert.equal(polarCandidates.length, 1);
  assertRegional(polarCandidates);
});

test("incidental words about other services cannot change the proposed service category", () => {
  const cases = [
    ["water", "Water is unavailable near the hospital and gas station", "Community water station"],
    ["healthcare", "A bus to the pharmacy cannot supply our medication", "Pharmacy"],
    ["healthcare", "The clinic has no drinking water", "Community health clinic"],
    ["food", "The grocery store near the bus stop and pharmacy is closed", "Grocery store"],
    ["broadband", "Internet access is unavailable near the clinic", "Public internet access point"],
    ["transportation", "No bus service to the hospital", "Transit stop or shuttle hub"],
    ["emergency_response", "Emergency response is slow near the gas station", "Emergency response station"],
    ["fuel", "The gas station is closed", "Gas station"],
  ];
  for (const [category, summary, facilityType] of cases) {
    const candidates = buildRecommendations([report("a", 0, { category, summary }), report("b", 0.002, { category, summary })]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].analysis.facilityType, facilityType, summary);
    assertRegional(candidates);
  }
});

test("seeded mixed regional distributions preserve all support, bounds, rank caps and determinism", () => {
  let seed = 61821;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const reports = Array.from({ length: 30 }, (_, index) => {
      const center = index % 4;
      return report(`report-${index}`, center + random() * 0.08, {
        latitude: random() * 0.08,
        severity: ["low", "medium", "high"][Math.floor(random() * 3)],
      });
    });
    reports.push(report("remote", 15, { severity: "high" }));
    const candidates = buildRecommendations(reports);
    assert.ok(candidates.length > 0);
    assertRegional(candidates);
    assert.deepEqual(buildRecommendations([...reports].reverse()), candidates);
    assert.equal(candidates.flatMap(({ signals }) => signals).length, reports.length);
  }
});

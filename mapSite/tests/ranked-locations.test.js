import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecommendations, inferServiceNeed, MIN_LOCATION_SEPARATION_KM } from "../analysis.js";
import { pointInGeometry } from "../regions.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const region = { id: "test", name: "Test region", geometry: square(-20, -20, 20, 20) };
const report = (id, longitude, extra = {}) => ({
  id, latitude: 0, longitude, severity: "low", category: "healthcare", summary: "Medical care needed", region, ...extra,
});
const pair = (prefix, longitude, extra = {}) => [report(`${prefix}-a`, longitude, extra), report(`${prefix}-b`, longitude + 0.01, extra)];
const assertRegionalSupport = (candidates) => {
  const usedReports = new Set();
  for (const candidate of candidates) {
    assert.ok(candidate.signals.length >= 2);
    assert.equal(pointInGeometry(candidate.position.longitude, candidate.position.latitude, candidate.region.geometry), true);
    if (candidate.region.excludedGeometry) {
      assert.equal(pointInGeometry(candidate.position.longitude, candidate.position.latitude, candidate.region.excludedGeometry), false);
    }
    for (const signal of candidate.signals) {
      assert.equal(signal.region.id, candidate.region.id);
      assert.equal(pointInGeometry(signal.longitude, signal.latitude, candidate.region.geometry), true);
      assert.equal(usedReports.has(signal.id), false, `${signal.id} must support only one location`);
      usedReports.add(signal.id);
    }
  }
};

test("three separated report groups produce three distinct ranked locations with disjoint evidence", () => {
  const reports = [...pair("west", -10), ...pair("center", 0, { severity: "high" }), ...pair("east", 10, { severity: "medium" })];
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((item) => item.locationRank), [1, 2, 3]);
  assert.deepEqual(candidates.map((item) => item.urgencyScore), [4, 2.34, 2]);
  assert.deepEqual(candidates.flatMap((item) => item.signals.map((signal) => signal.id)).sort(), reports.map((item) => item.id).sort());
  assert.equal(new Set(candidates.map((item) => item.id)).size, 3);
  for (const candidate of candidates) {
    assert.equal(candidate.locationCount, 3);
    assert.equal(candidate.recommendationGroupId, "test:healthcare");
    assert.equal(candidate.signals.length, 2);
    assert.equal(candidate.analysis.evidence.length, 2);
    assert.equal(pointInGeometry(candidate.position.longitude, candidate.position.latitude, region.geometry), true);
    assert.match(candidate.analysis.placementRationale, /does not establish a globally optimal/);
  }
  assert.ok(Math.abs(candidates[0].position.longitude) < 0.02);
  assert.ok(Math.abs(candidates[1].position.longitude - 10) < 0.02);
  assert.ok(Math.abs(candidates[2].position.longitude + 10) < 0.02);
  assertRegionalSupport(candidates);
});

test("one, two, and three report groups require at least two unique reports each", () => {
  assert.deepEqual(buildRecommendations([report("one", 0)], { minimumSize: 1 }), []);
  assert.deepEqual(buildRecommendations([report("same", 0), report("same", 0)]), []);
  assert.equal(buildRecommendations(pair("only", 0))[0].id, "test:healthcare");
  assert.equal(buildRecommendations([...pair("one", -10), ...pair("two", 10)]).length, 2);
  const withSingleton = buildRecommendations([...pair("one", -10), ...pair("two", 10), report("extra", 0)]);
  assert.equal(withSingleton.length, 2);
  assert.equal(withSingleton.flatMap((item) => item.signals).length, 5);
  assert.ok(withSingleton.some((item) => item.signals.some((signal) => signal.id === "extra")));
  assertRegionalSupport(withSingleton);
  const largerMinimum = buildRecommendations([...pair("one", -10), ...pair("two", 10)], { minimumSize: 3 });
  assert.equal(largerMinimum.length, 1);
  assert.equal(largerMinimum[0].signals.length, 4);
  assertRegionalSupport(largerMinimum);
});

test("coincident reports and reports within 250 meters do not fabricate additional locations", () => {
  assert.equal(MIN_LOCATION_SEPARATION_KM, 0.25);
  const coincident = Array.from({ length: 8 }, (_, index) => report(`same-place-${index}`, 0));
  assert.equal(buildRecommendations(coincident).length, 1);
  const close = Array.from({ length: 8 }, (_, index) => report(`close-${index}`, index * 0.0001));
  assert.equal(buildRecommendations(close).length, 1);
});

test("a remote report in the same region contributes without creating a singleton location", () => {
  const reports = Array.from({ length: 5 }, (_, index) => report(`local-${index}`, index * 0.00001));
  const candidates = buildRecommendations([...reports, report("remote", 10, { severity: "high" })]);
  assert.ok(candidates.length >= 1 && candidates.length <= 3);
  assert.deepEqual(candidates.flatMap((candidate) => candidate.signals.map(({ id }) => id)).sort(), [...reports.map((signal) => signal.id), "remote"]);
  assert.equal(Math.round(candidates.reduce((sum, candidate) => sum + candidate.urgencyScore, 0) * 100), 700);
  assertRegionalSupport(candidates);
});

test("location IDs, ranks, positions, and evidence are deterministic under input reordering", () => {
  const reports = [...pair("west", -10), ...pair("center", 0), ...pair("east", 10)];
  const expected = buildRecommendations(reports);
  assert.deepEqual(buildRecommendations([...reports].reverse()), expected);
  assert.deepEqual(buildRecommendations([reports[3], reports[1], reports[5], reports[0], reports[4], reports[2]]), expected);
  const changedText = buildRecommendations(reports.map((item) => ({ ...item, summary: "Updated medical evidence" })));
  assert.deepEqual(changedText.map((item) => item.id), expected.map((item) => item.id));
});

test("rankings cover all regional reports using at most three locations per category", () => {
  const reports = [-12, -4, 4, 12].flatMap((longitude, index) =>
    pair(`medical-${index}`, longitude, { severity: ["low", "medium", "high", "high"][index] }));
  const candidates = buildRecommendations([...reports, ...pair("food", 2, { category: "food" })]);
  assert.equal(candidates.filter((item) => item.category === "healthcare").length, 3);
  assert.deepEqual(candidates.filter((item) => item.category === "healthcare").map((item) => item.locationRank), [1, 2, 3]);
  assert.equal(candidates.find((item) => item.category === "food").locationRank, 1);
  assert.equal(candidates.flatMap((item) => item.signals).length, 10);
  assert.deepEqual(candidates.filter((item) => item.category === "healthcare").flatMap((item) => item.signals.map(({ id }) => id)).sort(), reports.map(({ id }) => id).sort());
  const scores = candidates.filter((item) => item.category === "healthcare").map((item) => item.urgencyScore);
  assert.deepEqual(scores, [...scores].sort((first, second) => second - first));
  assert.equal(Math.round(scores.reduce((sum, score) => sum + score, 0) * 100), 1234);
  assertRegionalSupport(candidates);
});

test("two high-urgency reports rank above three low-urgency reports at a weight of 2", () => {
  const reports = [
    report("low-a", 0), report("low-b", 0.0001), report("low-c", 0.0002),
    ...pair("high", 1, { severity: "high" }),
  ];
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.urgencyScore), [4, 3]);
  assert.deepEqual(candidates[0].signals.map(({ id }) => id), ["high-a", "high-b"]);
  assertRegionalSupport(candidates);
});

test("mathematically equal decimal urgency totals retain the stable identifier tie-break", () => {
  const reports = [
    ...["low", "medium", "high"].map((severity, index) => report(`mixed-${index}`, 0, { severity })),
    ...["high", "medium", "low"].map((severity, index) => report(`reversed-${index}`, 1, { severity })),
  ];
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.urgencyScore), [4.17, 4.17]);
  assert.deepEqual(candidates.map(({ id }) => id), candidates.map(({ id }) => id).sort());
  assert.deepEqual(buildRecommendations([...reports].reverse()), candidates);
  assertRegionalSupport(candidates);
});

test("splitting and positions remain within a region that crosses the date line", () => {
  const datelineRegion = { ...region, id: "dateline", geometry: square(178, -3, -178, 3) };
  const reports = [
    ...pair("west", 179.7, { region: datelineRegion }),
    report("crossing-a", 179.9975, { region: datelineRegion }),
    report("crossing-b", -179.9975, { region: datelineRegion }),
    ...pair("east", -179.7, { region: datelineRegion }),
  ];
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 3);
  for (const { position } of candidates) {
    assert.ok(Math.abs(position.longitude) > 178);
    assert.equal(pointInGeometry(position.longitude, position.latitude, datelineRegion.geometry), true);
  }
  assert.deepEqual(buildRecommendations(reports.reverse()), candidates);
  assertRegionalSupport(candidates);
});

test("suggestions stay on valid land components when their center falls in a boundary hole", () => {
  const geometry = square(-0.1, -0.1, 0.1, 0.1);
  geometry.coordinates.push(square(-0.01, -0.01, 0.01, 0.01).coordinates[0]);
  const holeRegion = { ...region, geometry };
  const candidates = buildRecommendations([report("west", -0.02, { region: holeRegion }), report("east", 0.02, { region: holeRegion })]);
  assert.equal(candidates.length, 1);
  assert.equal(pointInGeometry(candidates[0].position.longitude, candidates[0].position.latitude, geometry), true);
  assertRegionalSupport(candidates);
});


test("legacy medication and healthcare reports form one shared regional group capped at three locations", () => {
  const reports = [-12, -4, 4, 12].flatMap((longitude, index) => [
    report(`care-${index}`, longitude),
    report(`medicine-${index}`, longitude + 0.01, { category: "medication_access", summary: "Prescription medicines unavailable" }),
  ]);
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((item) => item.locationRank), [1, 2, 3]);
  assert.ok(candidates.every((item) => item.category === "healthcare" && item.recommendationGroupId === "test:healthcare" && item.locationCount === 3));
  const supportingIds = candidates.flatMap((item) => item.signals.map((signal) => signal.id));
  assert.equal(supportingIds.length, 8);
  assert.equal(new Set(supportingIds).size, 8);
  assert.deepEqual([...supportingIds].sort(), reports.map(({ id }) => id).sort());
  assert.deepEqual(buildRecommendations([...reports].reverse()), candidates);
  assertRegionalSupport(candidates);
});

test("one medication report and one healthcare report together meet the minimum support", () => {
  const candidates = buildRecommendations([
    report("clinic", 0),
    report("medicine", 0.0001, { category: "medication_access", summary: "Prescription medicines unavailable" }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, "test:healthcare");
  assert.equal(candidates[0].signals.length, 2);
  assert.equal(candidates[0].analysis.facilityType, "Pharmacy");
});

test("merged healthcare retains existing text-based pharmacy and clinic proposals and direct legacy input", () => {
  const medication = (id, extra = {}) => report(id, 0, { summary: "No pharmacy has the required medication", ...extra });
  const pharmacy = buildRecommendations([medication("a"), medication("b", { category: "medication_access", summary: "Treatment unavailable" }), report("c", 0)])[0];
  assert.equal(pharmacy.category, "healthcare");
  assert.equal(pharmacy.analysis.facilityType, "Pharmacy");
  const clinic = buildRecommendations([report("b", 0), report("c", 0)])[0];
  assert.equal(clinic.category, "healthcare");
  assert.equal(clinic.analysis.facilityType, "Community health clinic");
  assert.equal(inferServiceNeed({ category: "medication_access", signals: pair("legacy", 0), region }).facilityType, "Pharmacy");
});


test("medication-only wording and plural medicine terms still propose pharmacies after the category merge", () => {
  for (const summary of ["Medication unavailable", "Medications unavailable", "Medicines unavailable", "Prescriptions unavailable", "Pharmacies unavailable"]) {
    const candidates = buildRecommendations(pair("medicine", 0, { summary }));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].category, "healthcare");
    assert.equal(candidates[0].analysis.facilityType, "Pharmacy", summary);
  }
});

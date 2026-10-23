import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecommendations, MIN_LOCATION_SEPARATION_KM } from "../analysis.js";
import { pointInGeometry } from "../regions.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const region = { id: "test", name: "Test region", geometry: square(-20, -20, 20, 20) };
const report = (id, longitude, extra = {}) => ({
  id, latitude: 0, longitude, severity: "low", category: "healthcare", summary: "Medical care needed", region, ...extra,
});
const pair = (prefix, longitude, extra = {}) => [report(`${prefix}-a`, longitude, extra), report(`${prefix}-b`, longitude + 0.01, extra)];

test("three separated report groups produce three distinct ranked locations with disjoint evidence", () => {
  const reports = [...pair("west", -10), ...pair("center", 0, { severity: "high" }), ...pair("east", 10, { severity: "medium" })];
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((item) => item.locationRank), [1, 2, 3]);
  assert.deepEqual(candidates.map((item) => item.urgencyScore), [6, 4, 2]);
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
});

test("one, two, and three report groups require at least two unique reports each", () => {
  assert.deepEqual(buildRecommendations([report("one", 0)], { minimumSize: 1 }), []);
  assert.deepEqual(buildRecommendations([report("same", 0), report("same", 0)]), []);
  assert.equal(buildRecommendations(pair("only", 0))[0].id, "test:healthcare");
  assert.equal(buildRecommendations([...pair("one", -10), ...pair("two", 10)]).length, 2);
  assert.ok(buildRecommendations([...pair("one", -10), ...pair("two", 10), report("extra", 0)]).length <= 2);
  assert.equal(buildRecommendations([...pair("one", -10), ...pair("two", 10)], { minimumSize: 3 }).length, 1);
});

test("coincident reports and reports within 250 meters do not fabricate additional locations", () => {
  assert.equal(MIN_LOCATION_SEPARATION_KM, 0.25);
  const coincident = Array.from({ length: 8 }, (_, index) => report(`same-place-${index}`, 0));
  assert.equal(buildRecommendations(coincident).length, 1);
  const close = Array.from({ length: 8 }, (_, index) => report(`close-${index}`, index * 0.0001));
  assert.equal(buildRecommendations(close).length, 1);
});

test("a solitary remote report cannot create its own proposed location", () => {
  const reports = Array.from({ length: 5 }, (_, index) => report(`local-${index}`, index * 0.00001));
  const candidates = buildRecommendations([...reports, report("remote", 10)]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].signals.length, 6);
});

test("location IDs, ranks, positions, and evidence are deterministic under input reordering", () => {
  const reports = [...pair("west", -10), ...pair("center", 0), ...pair("east", 10)];
  const expected = buildRecommendations(reports);
  assert.deepEqual(buildRecommendations([...reports].reverse()), expected);
  assert.deepEqual(buildRecommendations([reports[3], reports[1], reports[5], reports[0], reports[4], reports[2]]), expected);
  const changedText = buildRecommendations(reports.map((item) => ({ ...item, summary: "Updated medical evidence" })));
  assert.deepEqual(changedText.map((item) => item.id), expected.map((item) => item.id));
});

test("rankings restart for each category and never exceed three locations", () => {
  const reports = [-12, -4, 4, 12].flatMap((longitude, index) => pair(`medical-${index}`, longitude));
  const candidates = buildRecommendations([...reports, ...pair("food", 2, { category: "food" })]);
  assert.equal(candidates.filter((item) => item.category === "healthcare").length, 3);
  assert.deepEqual(candidates.filter((item) => item.category === "healthcare").map((item) => item.locationRank), [1, 2, 3]);
  assert.equal(candidates.find((item) => item.category === "food").locationRank, 1);
  assert.equal(candidates.flatMap((item) => item.signals).length, 10);
});

test("splitting and positions remain within a region that crosses the date line", () => {
  const datelineRegion = { ...region, id: "dateline", geometry: square(178, -3, -178, 3) };
  const reports = [179, 179.9, -179].flatMap((longitude, index) => pair(`island-${index}`, longitude, { region: datelineRegion }));
  const candidates = buildRecommendations(reports);
  assert.equal(candidates.length, 3);
  for (const { position } of candidates) {
    assert.ok(Math.abs(position.longitude) > 178);
    assert.equal(pointInGeometry(position.longitude, position.latitude, datelineRegion.geometry), true);
  }
  assert.deepEqual(buildRecommendations(reports.reverse()), candidates);
});

test("suggestions stay on valid land components when a median falls in a boundary hole", () => {
  const geometry = square(-10, -10, 10, 10);
  geometry.coordinates.push(square(-2, -2, 2, 2).coordinates[0]);
  const holeRegion = { ...region, geometry };
  const candidates = buildRecommendations([report("west", -3, { region: holeRegion }), report("east", 3, { region: holeRegion })]);
  assert.equal(candidates.length, 1);
  assert.equal(pointInGeometry(candidates[0].position.longitude, candidates[0].position.latitude, geometry), true);
});

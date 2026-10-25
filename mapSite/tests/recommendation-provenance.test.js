import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecommendations, buildRecommendationsForRegion, buildWorldwideRecommendations, isRecommendationEvidence,
  weightedGeographicCenter, weightedGeometricMedian,
} from "../analysis.js";
import { WORLD_REGION } from "../region-navigation.js";
import { createWorldwideAnalysisRegionLoader, worldwideAnalysisScopeEntries } from "../worldwide-analysis-regions.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const canada = { id: "CA", name: "Canada", kind: "country", countryCode: "CA", geometry: square(-140, 40, -50, 85) };
const western = { ...canada, id: "CA-W", name: "Western region", kind: "state", geometry: square(-140, 40, -100, 85) };
const eastern = { ...canada, id: "CA-E", name: "Eastern region", kind: "state", geometry: square(-100, 40, -50, 85) };
const australia = { id: "AU", name: "Australia", kind: "country", countryCode: "AU", geometry: square(110, -45, 155, -10) };
const ausWest = { ...australia, id: "AU-W", kind: "state", geometry: square(110, -45, 135, -10) };
const ausEast = { ...australia, id: "AU-E", kind: "state", geometry: square(135, -45, 155, -10) };
const rows = [canada, western, eastern, australia, ausWest, ausEast].map(({ id, name, kind, countryCode }) =>
  [id, name, "", kind, countryCode, "", ""]);
const report = (id, longitude, region = western, extra = {}) => ({
  id, latitude: 50, longitude, region, category: "water", severity: "low", summary: "Reliable water is needed", ...extra,
});
const pair = () => [report("real-a", -120), report("real-b", -119.99, western, { severity: "high", isSynthetic: false })];
const worldwide = (reports) => buildRecommendationsForRegion(reports, WORLD_REGION, { analysisRegions: [western, canada] });

test("explicit demo reports cannot change real support, placement, ranking, or generated analysis", () => {
  const real = pair();
  const demo = Array.from({ length: 12 }, (_, index) => report(`demo-${index}`, -139 + index * 2,
    western, { isSynthetic: true, severity: "high", summary: "Synthetic pharmacy and water example" }));
  const mixed = [...demo, ...real];
  const before = structuredClone(mixed);
  const expected = buildRecommendations(real);
  assert.equal(expected.length, 1);
  assert.equal(expected[0].urgencyScore, 3, "the current high-urgency weight remains two");
  assert.deepEqual(buildRecommendations(mixed), expected);
  for (const region of [western, canada]) {
    assert.deepEqual(buildRecommendationsForRegion(mixed, region), buildRecommendationsForRegion(real, region));
  }
  assert.deepEqual(worldwide(mixed), worldwide(real));
  assert.deepEqual(mixed, before, "demo reports remain intact for their existing display and storage flows");
});

test("a real report plus any number of demo reports cannot satisfy minimum support", () => {
  const mixed = [pair()[0], ...Array.from({ length: 8 }, (_, index) =>
    report(`demo-${index}`, -120 + index * 0.001, western, { isSynthetic: true, severity: "high" }))];
  assert.deepEqual(buildRecommendations(mixed), []);
  assert.deepEqual(buildRecommendationsForRegion(mixed, canada), []);
  assert.deepEqual(worldwide(mixed), []);
});

test("Canada's widely separated demo reports produce no country or Worldwide service sites", () => {
  const demos = [
    report("demo-yellowknife", -114.3765, western, { latitude: 62.4555, category: "emergency_response", severity: "medium", isSynthetic: true }),
    report("demo-alberta", -113.814, western, { latitude: 52.2675, category: "emergency_response", isSynthetic: true }),
    report("demo-yukon", -135.054, western, { latitude: 60.723, category: "healthcare", severity: "high", isSynthetic: true }),
    report("demo-ontario", -80.991, eastern, { latitude: 46.494, category: "healthcare", severity: "high", isSynthetic: true }),
  ];
  assert.deepEqual(buildRecommendations(demos), []);
  assert.deepEqual(buildRecommendationsForRegion(demos, canada), []);
  assert.deepEqual(worldwide(demos), []);
  assert.deepEqual(worldwideAnalysisScopeEntries(demos, rows), []);
});

test("a demo duplicate is removed before identity deduplication and cannot suppress a real report", () => {
  const real = pair();
  const duplicate = { ...real[0], longitude: -139, severity: "high", isSynthetic: true };
  for (const mixed of [[duplicate, ...real], [...real, duplicate]]) {
    assert.deepEqual(buildRecommendations(mixed), buildRecommendations(real));
    assert.deepEqual(buildRecommendationsForRegion(mixed, canada), buildRecommendationsForRegion(real, canada));
    assert.deepEqual(worldwide(mixed), worldwide(real));
  }
});

test("legacy reports without the demo flag and explicit non-demo reports remain eligible", () => {
  const legacy = pair().map(({ isSynthetic, ...item }) => item);
  const explicit = legacy.map((item) => ({ ...item, isSynthetic: false }));
  const candidate = buildRecommendations(legacy)[0];
  const explicitCandidate = buildRecommendations(explicit)[0];
  assert.deepEqual(candidate.position, explicitCandidate.position);
  assert.equal(candidate.urgencyScore, explicitCandidate.urgencyScore);
  assert.equal(candidate.signals.length, 2);
  assert.equal(isRecommendationEvidence(legacy[0]), true);
  assert.equal(isRecommendationEvidence(explicit[0]), true);
  assert.equal(isRecommendationEvidence({ ...legacy[0], isSynthetic: "true" }), true, "only the explicit boolean demo marker is excluded");
  assert.equal(isRecommendationEvidence({ ...legacy[0], isSynthetic: true }), false);
  assert.equal(isRecommendationEvidence({ ...legacy[0], latitude: NaN }), false);
  assert.equal(isRecommendationEvidence(null), false);
});

test("shared placement calculations exclude demo coordinates before urgency weighting", () => {
  const real = pair();
  const mixed = [...real, report("demo", -130, western, { severity: "high", isSynthetic: true })];
  for (const center of [weightedGeographicCenter, weightedGeometricMedian]) {
    assert.deepEqual(center(mixed), center(real));
    assert.throws(() => center([mixed[2]]), RangeError);
  }
});

test("Worldwide loads only real-supported scopes and ignores demo-only or mixed singleton support", async () => {
  const domestic = [report("west-real", -120), report("east-real", -80, eastern)];
  const demos = [
    report("demo-au-west", 120, ausWest, { latitude: -30, isSynthetic: true }),
    report("demo-au-east", 145, ausEast, { latitude: -30, isSynthetic: true }),
    report("west-real", -139, western, { isSynthetic: true }),
  ];
  const calls = [], progress = [];
  const load = createWorldwideAnalysisRegionLoader({ rows, loadRegion: async (entry) => {
    calls.push(entry.id);
    return entry.id === canada.id ? canada : australia;
  } });
  assert.deepEqual(await load(demos, { onProgress: (...values) => progress.push(values) }), { regions: [], failures: [] });
  assert.deepEqual(await load([domestic[0], { ...domestic[1], isSynthetic: true }]), { regions: [], failures: [] });
  assert.deepEqual(calls, []);
  assert.deepEqual(progress, [[0, 0]]);
  assert.deepEqual(worldwideAnalysisScopeEntries([...demos, ...domestic], rows).map(({ id }) => id), [canada.id]);
  assert.deepEqual(await load([...demos, ...domestic]), { regions: [canada], failures: [] });
  assert.deepEqual(calls, [canada.id]);
  assert.equal(worldwide(domestic).length, 1, "real-supported country aggregation remains available");
});

const demoOptions = { includeDemonstrationReports: true };
const provenance = ({ evidenceMode, demonstrationReportCount, nonDemonstrationReportCount }) =>
  ({ evidenceMode, demonstrationReportCount, nonDemonstrationReportCount });

test("demo analysis is explicit, retains minimum support, and marks proposals in every scope", () => {
  const demos = pair().map((item) => ({ ...item, isSynthetic: true }));
  const builders = [
    (reports, options) => buildRecommendations(reports, options),
    (reports, options) => buildRecommendationsForRegion(reports, western, options),
    (reports, options) => buildRecommendationsForRegion(reports, canada, options),
    (reports, options) => buildRecommendationsForRegion(reports, WORLD_REGION, { analysisRegions: [canada], ...options }),
    (reports, options) => buildWorldwideRecommendations(reports, { analysisRegions: [canada], ...options }),
  ];
  for (const build of builders) {
    assert.deepEqual(build(demos), []);
    assert.deepEqual(build(demos, { includeDemonstrationReports: false }), []);
    assert.deepEqual(build(demos, { includeDemonstrationReports: "true" }), [], "truthy values cannot silently enable demo mode");
    assert.deepEqual(build(demos.slice(0, 1), demoOptions), []);
    const candidates = build(demos, demoOptions);
    assert.equal(candidates.length, 1);
    assert.deepEqual(provenance(candidates[0]), {
      evidenceMode: "demonstration", demonstrationReportCount: 2, nonDemonstrationReportCount: 0,
    });
    assert.equal(candidates[0].urgencyScore, 3);
    assert.deepEqual(candidates[0].position, weightedGeographicCenter(demos, demoOptions));
    assert.match(candidates[0].analysis.decisionSummary, /not evidence of real local demand/);
    assert.match(candidates[0].analysis.placementRationale, /2 demonstration and 0 non-demo reports/);
  }
});

test("mixed-evidence preview counts all accepted reports and labels the whole proposal as demonstration", () => {
  const real = pair();
  const demo = report("demo", -119.995, western, { isSynthetic: true, severity: "high" });
  const mixed = [...real, demo];
  const preview = buildRecommendations(mixed, demoOptions)[0];
  assert.deepEqual(provenance(preview), {
    evidenceMode: "demonstration", demonstrationReportCount: 1, nonDemonstrationReportCount: 2,
  });
  assert.equal(preview.signals.length, 3);
  assert.equal(preview.urgencyScore, 5);
  assert.deepEqual(preview.position, weightedGeographicCenter(mixed, demoOptions));
  assert.match(preview.analysis.decisionSummary, /1 demonstration and 2 non-demo reports/);
  const community = buildRecommendations(mixed)[0];
  assert.deepEqual(community, buildRecommendations(real)[0]);
  assert.deepEqual(provenance(community), {
    evidenceMode: "community", demonstrationReportCount: 0, nonDemonstrationReportCount: 2,
  });
  assert.deepEqual(buildRecommendations(real, demoOptions), buildRecommendations(real), "enabling previews cannot relabel real-only proposals");
});

test("demo-mode country aggregation retains verified scope isolation and no distance cutoff", () => {
  const demos = [report("west-demo", -120, western, { isSynthetic: true }),
    report("east-demo", -80, eastern, { isSynthetic: true, severity: "high" })];
  assert.deepEqual(buildWorldwideRecommendations(demos, demoOptions), []);
  const selected = buildRecommendationsForRegion(demos, canada, demoOptions);
  const combined = buildWorldwideRecommendations(demos, { ...demoOptions, analysisRegions: [canada] });
  assert.equal(combined.length, 1);
  assert.deepEqual(combined, selected);
  assert.deepEqual(combined[0].position, weightedGeographicCenter(demos, demoOptions));
  const foreign = report("foreign-demo", 120, ausWest, { latitude: -30, isSynthetic: true, severity: "high" });
  assert.deepEqual(buildWorldwideRecommendations([...demos, foreign], { ...demoOptions, analysisRegions: [canada] }), combined);
  assert.deepEqual(buildRecommendationsForRegion([...demos, foreign], canada, demoOptions), selected);
});

test("a duplicate demo cannot replace community evidence even when demo mode is enabled", () => {
  const real = pair();
  const duplicate = { ...real[0], longitude: -139, isSynthetic: true, severity: "high" };
  assert.deepEqual(buildRecommendations([duplicate, ...real], demoOptions), buildRecommendations(real));
  assert.deepEqual(buildRecommendations([...real, duplicate], demoOptions), buildRecommendations(real));
});

test("coordinate helpers include demo evidence only with the explicit option", () => {
  const demos = pair().map((item) => ({ ...item, isSynthetic: true }));
  for (const center of [weightedGeographicCenter, weightedGeometricMedian]) {
    assert.throws(() => center(demos), RangeError);
    assert.deepEqual(center(demos, demoOptions), center(pair()));
  }
  assert.equal(isRecommendationEvidence(demos[0], demoOptions), true);
  assert.equal(isRecommendationEvidence(demos[0]), false);
  assert.equal(isRecommendationEvidence({ ...demos[0], longitude: 181 }, demoOptions), false);
});

test("Worldwide scope loading obeys demo mode on each call even after boundaries are cached", async () => {
  const demos = [report("west-demo", -120, western, { isSynthetic: true }),
    report("east-demo", -80, eastern, { isSynthetic: true })];
  const calls = [];
  const load = createWorldwideAnalysisRegionLoader({ rows, loadRegion: async (entry) => {
    calls.push(entry.id);
    return canada;
  } });
  assert.deepEqual(worldwideAnalysisScopeEntries(demos, rows), []);
  assert.deepEqual(worldwideAnalysisScopeEntries(demos, rows, demoOptions).map(({ id }) => id), [canada.id]);
  assert.deepEqual(await load(demos), { regions: [], failures: [] });
  assert.deepEqual(calls, []);
  assert.deepEqual(await load(demos, demoOptions), { regions: [canada], failures: [] });
  assert.deepEqual(calls, [canada.id]);
  assert.deepEqual(await load(demos), { regions: [], failures: [] });
  assert.deepEqual(await load(demos, demoOptions), { regions: [canada], failures: [] });
  assert.deepEqual(calls, [canada.id], "verified geometry is reusable, but cached demo eligibility is not");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAN_TYPES,
  PLAN_TYPE_IDS,
  applyEstimateEvidence,
  buildPlanModel,
  planTypeForReport,
  reportsForPlanType,
} from "../plans-model.js";
import { haversineDistance } from "../decision-tools.js";
import { pointInGeometry } from "../regions.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const region = { id: "US-TEST", name: "Test Region", countryCode: "US", kind: "state", geometry: square(-20, -20, 20, 20) };
const world = { id: "world", name: "Worldwide", kind: "world", geometry: null };
const report = (id, longitude = 0, extra = {}) => ({
  id, latitude: 0, longitude, severity: "low", category: "healthcare",
  summary: "A nearby hospital is needed", region, ...extra,
});
const pair = (prefix, longitude, extra = {}) => [
  report(`${prefix}-a`, longitude, extra), report(`${prefix}-b`, longitude + 0.01, extra),
];
const assertRegionalSupport = (candidates) => {
  for (const candidate of candidates) {
    assert.ok(candidate.supportingReports.length >= 2);
    assert.equal(pointInGeometry(candidate.position.longitude, candidate.position.latitude, candidate.region.geometry), true);
    if (candidate.region.excludedGeometry) {
      assert.equal(pointInGeometry(candidate.position.longitude, candidate.position.latitude, candidate.region.excludedGeometry), false);
    }
    for (const report of candidate.supportingReports) {
      assert.equal(pointInGeometry(report.longitude, report.latitude, candidate.region.geometry), true);
      if (candidate.region.excludedGeometry) {
        assert.equal(pointInGeometry(report.longitude, report.latitude, candidate.region.excludedGeometry), false);
      }
    }
  }
};
const source = (usedFor = "Cost estimate") => ({
  id: `source-${usedFor.toLowerCase().replaceAll(" ", "-")}`,
  title: `${usedFor} source`, publisher: "Public agency",
  url: "https://example.gov/data", usedFor, publishedYear: 2025,
});
const evidence = (overrides = {}) => ({
  id: "hospital-us-2025", type: "hospital", scope: "One reference district hospital project",
  geography: { countryCode: "US", level: "country" }, evidenceYear: 2025,
  cost: { low: 10_000_000, high: 20_000_000, currency: "USD", priceYear: 2025,
    formula: { expression: "published low to high range", inputs: [10_000_000, 20_000_000] } },
  timeline: { lowMonths: 24, highMonths: 36 },
  assumptions: ["Comparable scope only"], sources: [source("Cost and completion time")],
  ...overrides,
});

test("defines only explicit infrastructure choices and rejects All", () => {
  assert.deepEqual(PLAN_TYPE_IDS, [
    "hospital", "pharmacy", "school", "water_facility", "electricity", "internet",
    "roads", "transportation", "emergency", "food", "fuel", "other",
  ]);
  assert.equal(Object.hasOwn(PLAN_TYPES, "all"), false);
  assert.throws(() => reportsForPlanType([], "all"), /supported infrastructure type/);
  assert.throws(() => buildPlanModel({ type: "all", region }), /All is not supported/);
});

test("classifies medication-explicit healthcare separately from hospitals", () => {
  assert.equal(planTypeForReport(report("hospital")), "hospital");
  for (const summary of ["A pharmacy is unavailable", "Medication access is limited", "Medicines are unavailable", "Prescription pickup is difficult"]) {
    assert.equal(planTypeForReport(report(summary, 0, { summary })), "pharmacy", summary);
  }
  assert.equal(planTypeForReport(report("legacy", 0, { category: "medication_access", summary: "Treatment unavailable" })), "pharmacy");
  assert.equal(planTypeForReport(report("legacy-category", 0, { category: "pharmacy", summary: "Treatment unavailable" })), "pharmacy");
  assert.equal(planTypeForReport(report("food", 0, { category: "food", summary: "The pharmacy is beside the food pantry" })), "food");
});

test("conservatively maps every remaining planning type", () => {
  const cases = [
    ["school", { category: "other", summary: "The school has no classrooms" }],
    ["water_facility", { category: "water", summary: "No clean water" }],
    ["electricity", { category: "other", summary: "Repeated power outages affect the electric grid" }],
    ["internet", { category: "internet", summary: "No internet access" }],
    ["roads", { category: "transportation", summary: "The road is damaged and impassable" }],
    ["transportation", { category: "transportation", summary: "There is no bus service" }],
    ["emergency", { category: "emergency_response", summary: "Ambulance access is delayed" }],
    ["food", { category: "food", summary: "No grocery access" }],
    ["fuel", { category: "other", summary: "The nearest gas station has no diesel fuel" }],
    ["other", { category: "other", summary: "A public facility is inaccessible" }],
  ];
  for (const [expected, patch] of cases) assert.equal(planTypeForReport(report(expected, 0, patch)), expected);
  assert.equal(planTypeForReport(null), null);
});

test("returns at most three ranked candidates deterministically for a selected type", () => {
  const reports = [
    ...pair("west", -12), ...pair("middle-west", -4, { severity: "medium" }),
    ...pair("middle-east", 4, { severity: "high" }), ...pair("east", 12),
    ...pair("pharmacy", 1, { summary: "The pharmacy has no medicines" }),
  ];
  const first = buildPlanModel({ reports, region, type: "hospital", currentYear: 2026 });
  const reversed = buildPlanModel({ reports: [...reports].reverse(), region, type: "hospital", currentYear: 2026 });
  assert.equal(first.status, "ready");
  assert.equal(first.candidates.length, 3);
  assert.deepEqual(first.candidates.map((candidate) => candidate.rank), [1, 2, 3]);
  assert.ok(first.candidates.every((candidate) => candidate.type === "hospital" && candidate.facilityLabel === "Hospital"));
  assert.deepEqual(first.candidates.map(({ id, rank, position, urgencyScore }) => ({ id, rank, position, urgencyScore })),
    reversed.candidates.map(({ id, rank, position, urgencyScore }) => ({ id, rank, position, urgencyScore })));
  assert.equal(first.matchedReportCount, 8);
  assert.equal(first.contributingReportCount, 8);
  assert.deepEqual(first.candidates.flatMap((candidate) => candidate.supportingReports.map(({ id }) => id)).sort(), reports.filter((report) => !report.id.startsWith("pharmacy")).map(({ id }) => id).sort());
  const scores = first.candidates.map((candidate) => candidate.urgencyScore);
  assert.deepEqual(scores, [...scores].sort((first, second) => second - first));
  assert.equal(Math.round(scores.reduce((sum, score) => sum + score, 0) * 100), 1034);
  assertRegionalSupport(first.candidates);
});

test("selected regions exclude outside reports while Worldwide ranks across report regions", () => {
  const otherRegion = { id: "CA-TEST", name: "Other Region", countryCode: "CA", kind: "state", geometry: square(30, -20, 60, 20) };
  const local = pair("local", 0);
  const outsideSelectedBoundary = pair("outside", 35, { region: otherRegion, severity: "high" });
  const selected = buildPlanModel({ reports: [...local, ...outsideSelectedBoundary], region, type: "hospital", currentYear: 2026 });
  assert.equal(selected.candidates.length, 1);
  assert.equal(selected.excluded.outsideRegion, 2);
  assert.deepEqual(selected.candidates[0].supportingReports.map(({ id }) => id).sort(), ["local-a", "local-b"]);
  const global = buildPlanModel({ reports: [...local, ...outsideSelectedBoundary], region: world, type: "hospital", currentYear: 2026 });
  assert.equal(global.candidates.length, 2);
  assert.equal(global.candidates[0].region.id, "CA-TEST");
  assert.equal(global.candidates[0].rank, 1);
  assert.equal(global.candidates[1].rank, 2);
});

test("reports need valid IDs, coordinates, boundaries, and at least two unique citations", () => {
  const one = buildPlanModel({ reports: [report("one")], region, type: "hospital", currentYear: 2026 });
  assert.equal(one.status, "empty");
  assert.equal(one.reason, "insufficient-reports");
  const duplicate = buildPlanModel({ reports: [report("same"), report("same", 1)], region, type: "hospital", currentYear: 2026 });
  assert.equal(duplicate.candidates.length, 0);
  const invalid = buildPlanModel({ reports: [report(""), report("bad", 0, { latitude: 100 })], region, type: "hospital", currentYear: 2026 });
  assert.equal(invalid.excluded.missingReportId, 1);
  assert.equal(invalid.excluded.invalidReport, 1);
  const noBoundary = buildPlanModel({ reports: pair("valid", 0), region: { id: "missing", name: "Missing" }, type: "hospital", currentYear: 2026 });
  assert.equal(noBoundary.status, "unavailable");
  assert.equal(noBoundary.reason, "region-boundary-unavailable");
});

test("preserves original reports and creates encoded links to the Analysis page", () => {
  const reports = pair("citation", 0, { summary: "Resident wording stays unchanged",
    region: { ...region, name: "Nearby district", hierarchy: "Nearby district, Test Region" } });
  reports[0].id = "report / one?";
  const model = buildPlanModel({ reports, region, type: "hospital", currentYear: 2026 });
  const candidate = model.candidates[0];
  assert.equal(candidate.supportingReports.includes(reports[0]), true);
  assert.equal(candidate.supportingReports.includes(reports[1]), true);
  const citation = candidate.reportCitations.find((item) => item.reportId === "report / one?");
  assert.equal(citation.summary, "Resident wording stays unchanged");
  assert.equal(citation.category, "healthcare");
  assert.equal(citation.baseCategory, "healthcare");
  assert.equal(citation.analysisHref, "#analysis?category=healthcare&report=report%20%2F%20one%3F");
  assert.equal(candidate.locationLabel, "Nearby district");
  assert.equal(candidate.locationHierarchy, "Nearby district, Test Region");
});

test("location labels use the nearest supporting report and break equal-distance ties by report id", () => {
  const leftRegion = { ...region, id: "left-place", name: "Left place", hierarchy: "Left place, Test Region" };
  const rightRegion = { ...region, id: "right-place", name: "Right place", hierarchy: "Right place, Test Region" };
  const reports = [
    report("b-report", -0.01, { region: leftRegion }),
    report("a-report", 0.01, { region: rightRegion }),
  ];
  const model = buildPlanModel({ reports, region, type: "hospital", currentYear: 2026 });
  assert.equal(model.candidates.length, 1);
  assert.equal(model.candidates[0].locationLabel, "Right place");
  assert.equal(model.candidates[0].locationHierarchy, "Right place, Test Region");
  assert.ok(Number.isFinite(model.candidates[0].position.latitude));
  assert.ok(Number.isFinite(model.candidates[0].position.longitude));
  assertRegionalSupport(model.candidates);
});

test("derives a transparent bounded service radius from contributing report distances", () => {
  const close = buildPlanModel({ reports: pair("close", 0, { summary: "The pharmacy cannot supply medicines" }), region, type: "pharmacy", currentYear: 2026 });
  assert.equal(close.candidates[0].serviceArea.radiusKm, PLAN_TYPES.pharmacy.serviceRadius.minKm);
  assert.equal(close.candidates[0].serviceArea.cappedAtMaximum, false);
  assert.match(close.candidates[0].serviceArea.formula, /clamp/);
  assert.match(close.candidates[0].serviceArea.assumption, /not a verified service boundary/);
  assertRegionalSupport(close.candidates);

  const wider = buildPlanModel({ reports: [report("local-a", -0.02), report("local-b", 0.02)], region, type: "hospital", currentYear: 2026 });
  assert.ok(wider.candidates[0].serviceArea.radiusKm > PLAN_TYPES.hospital.serviceRadius.minKm);
  assert.equal(wider.candidates[0].serviceArea.cappedAtMaximum, false);
  assertRegionalSupport(wider.candidates);
});

test("distant reports in one region create a plan while its capped service display remains explicit", () => {
  const farRegion = { ...region, id: "wide", geometry: square(-50, -20, 50, 20) };
  const far = buildPlanModel({ reports: [report("far-a", -40), report("far-b", 40)], region: farRegion, type: "hospital", currentYear: 2026 });
  assert.equal(far.status, "ready");
  assert.equal(far.matchedReportCount, 2);
  assert.equal(far.contributingReportCount, 2);
  assert.equal(far.candidates.length, 1);
  const [candidate] = far.candidates;
  assert.ok(Math.abs(candidate.position.longitude) < 1e-9);
  assert.equal(candidate.serviceArea.radiusKm, PLAN_TYPES.hospital.serviceRadius.maxKm);
  assert.equal(candidate.serviceArea.cappedAtMaximum, true);
  assert.equal(candidate.serviceArea.allSupportingReportsInside, false);
  assert.ok(candidate.supportingReports.every((report) => haversineDistance(candidate.position, report) > PLAN_TYPES.hospital.serviceRadius.maxKm));
  assertRegionalSupport(far.candidates);
});

test("keeps candidates inside boundaries with holes and date-line geometry", () => {
  const holed = { ...region, id: "hole", geometry: square(-0.1, -0.1, 0.1, 0.1) };
  holed.geometry.coordinates.push(square(-0.01, -0.01, 0.01, 0.01).coordinates[0]);
  const holeModel = buildPlanModel({ reports: [report("west", -0.02), report("east", 0.02)], region: holed, type: "hospital", currentYear: 2026 });
  assert.equal(holeModel.candidates.length, 1);
  assert.notDeepEqual(holeModel.candidates[0].position, { latitude: 0, longitude: 0 });
  assert.equal(pointInGeometry(holeModel.candidates[0].position.longitude, holeModel.candidates[0].position.latitude, holed.geometry), true);
  assertRegionalSupport(holeModel.candidates);

  const dateline = { ...region, id: "dateline", geometry: square(179.9, -0.1, -179.9, 0.1) };
  const dateReports = [report("date-a", 179.99, { region: dateline }), report("date-b", -179.99, { region: dateline })];
  const dateModel = buildPlanModel({ reports: dateReports, region: dateline, type: "hospital", currentYear: 2026 });
  assert.equal(dateModel.candidates.length, 1);
  assert.ok(Math.abs(dateModel.candidates[0].position.longitude) > 179.9);
  assertRegionalSupport(dateModel.candidates);
});

test("plans keep supporting reports and proposed points outside excluded region partitions", () => {
  const partition = { ...region, geometry: square(-0.1, -0.1, 0.1, 0.1),
    excludedGeometry: square(-0.01, -0.01, 0.01, 0.01) };
  const model = buildPlanModel({
    reports: [report("west", -0.02), report("east", 0.02), report("excluded", 0, { severity: "high" })],
    region: partition, type: "hospital", currentYear: 2026,
  });
  assert.equal(model.candidates.length, 1);
  assert.equal(model.contributingReportCount, 2);
  const [candidate] = model.candidates;
  assert.deepEqual(candidate.supportingReports.map(({ id }) => id).sort(), ["east", "west"]);
  assert.equal(pointInGeometry(candidate.position.longitude, candidate.position.latitude, partition.geometry), true);
  assert.equal(pointInGeometry(candidate.position.longitude, candidate.position.latitude, partition.excludedGeometry), false);
  assertRegionalSupport(model.candidates);
});

test("applies exact-region evidence before country and global evidence", () => {
  const records = [
    evidence({ id: "global", geography: { level: "global" }, evidenceYear: 2026,
      cost: { low: 1, high: 2, currency: "USD", priceYear: 2026 } }),
    evidence({ id: "country", evidenceYear: 2026,
      cost: { low: 3, high: 4, currency: "USD", priceYear: 2026 } }),
    evidence({ id: "region", geography: { regionId: "US-TEST", countryCode: "US", level: "region" }, evidenceYear: 2024,
      cost: { low: 5, high: 6, currency: "USD", priceYear: 2024 } }),
  ];
  const result = applyEstimateEvidence({ evidence: records, type: "hospital", region, currentYear: 2026 });
  assert.equal(result.cost.evidenceId, "region");
  assert.equal(result.cost.specificity, "region");
  assert.equal(result.timeline.evidenceId, "region");
});

test("uses newest deterministic matching evidence without combining incompatible ranges", () => {
  const result = applyEstimateEvidence({
    evidence: [evidence({ id: "b", evidenceYear: 2025 }), evidence({ id: "a", evidenceYear: 2025 }),
      evidence({ id: "older", evidenceYear: 2024 })],
    type: "hospital", region, currentYear: 2026,
  });
  assert.equal(result.cost.evidenceId, "a");
  assert.equal(result.timeline.evidenceId, "a");
  assert.equal(result.cost.low, 10_000_000);
  assert.equal(result.cost.high, 20_000_000);
});

test("rejects invalid or mismatched estimate evidence instead of inventing values", () => {
  const invalid = [
    evidence({ id: "wrong-type", type: "school" }),
    evidence({ id: "wrong-country", geography: { countryCode: "CA" } }),
    evidence({ id: "http-source", sources: [{ ...source(), url: "http://example.gov/data" }] }),
    evidence({ id: "reversed-cost", cost: { low: 20, high: 10, currency: "USD", priceYear: 2025 } }),
    evidence({ id: "zero-cost", cost: { low: 0, high: 10, currency: "USD", priceYear: 2025 } }),
    evidence({ id: "bad-currency", cost: { low: 10, high: 20, currency: "dollars", priceYear: 2025 } }),
    evidence({ id: "future", evidenceYear: 2027 }),
    evidence({ id: "negative-time", timeline: { lowMonths: -1, highMonths: 3 } }),
  ];
  for (const record of invalid) {
    const result = applyEstimateEvidence({ evidence: [record], type: "hospital", region, currentYear: 2026 });
    if (["reversed-cost", "zero-cost", "bad-currency"].includes(record.id)) {
      assert.equal(result.cost.status, "unavailable", record.id);
      assert.equal(result.timeline.status, "estimated", record.id);
    } else if (record.id === "negative-time") {
      assert.equal(result.cost.status, "estimated", record.id);
      assert.equal(result.timeline.status, "unavailable", record.id);
    } else {
      assert.equal(result.cost.status, "unavailable", record.id);
      assert.equal(result.timeline.status, "unavailable", record.id);
    }
  }
  const empty = applyEstimateEvidence({ evidence: [], type: "hospital", region, currentYear: 2026 });
  assert.equal(empty.cost.status, "unavailable");
  assert.equal(empty.timeline.status, "unavailable");
  assert.equal("low" in empty.cost, false);
});

test("preserves validated sources, assumptions, formulas, scope, and price year", () => {
  const record = evidence({
    assumptions: ["National benchmark"],
    cost: { low: 100, high: 200, currency: "USD", priceYear: 2025,
      assumptions: ["Land is excluded"], formula: { expression: "unit cost × one facility", inputs: { facilities: 1 } } },
    timeline: { lowMonths: 12, highMonths: 18, assumptions: ["Permitting included"], formula: "published range" },
  });
  const result = applyEstimateEvidence({ evidence: [record], type: "hospital", region, currentYear: 2026 });
  assert.deepEqual(result.cost.assumptions, ["National benchmark", "Land is excluded"]);
  assert.deepEqual(result.cost.formula, { expression: "unit cost × one facility", inputs: { facilities: 1 } });
  assert.equal(result.cost.scope, record.scope);
  assert.equal(result.cost.priceYear, 2025);
  assert.equal(result.cost.sources[0].publisher, "Public agency");
  assert.deepEqual(result.timeline.assumptions, ["National benchmark", "Permitting included"]);
  assert.equal(result.timeline.formula, "published range");
});

test("estimate values never affect candidate IDs, ranks, or locations", () => {
  const reports = [...pair("low", -10), ...pair("high", 10, { severity: "high" })];
  const without = buildPlanModel({ reports, region, type: "hospital", currentYear: 2026 });
  const withEvidence = buildPlanModel({ reports, region, type: "hospital", estimateEvidence: [evidence()], currentYear: 2026 });
  const shape = (model) => model.candidates.map(({ id, rank, position, urgencyScore }) => ({ id, rank, position, urgencyScore }));
  assert.deepEqual(shape(withEvidence), shape(without));
  assert.ok(withEvidence.candidates.every((candidate) => candidate.estimates.cost.status === "estimated"));
  assert.ok(without.candidates.every((candidate) => candidate.estimates.cost.status === "unavailable"));
});

test("reports-loading, connection-failure, no-match, and demonstration states stay explicit", () => {
  const loading = buildPlanModel({ reports: pair("a", 0), reportsAvailable: false, region, type: "hospital", currentYear: 2026 });
  assert.equal(loading.status, "loading");
  const failed = buildPlanModel({ reports: pair("a", 0), reportsAvailable: false, connectionFailed: true, region, type: "hospital", currentYear: 2026 });
  assert.equal(failed.status, "unavailable");
  const noMatch = buildPlanModel({ reports: pair("water", 0, { category: "water", summary: "No water" }), region, type: "hospital", currentYear: 2026 });
  assert.equal(noMatch.reason, "no-matching-reports");
  const demo = buildPlanModel({ reports: pair("demo", 0, { isSynthetic: true }), region, type: "hospital", currentYear: 2026 });
  assert.ok(demo.notices.some((notice) => /demonstration data/.test(notice)));
  assert.deepEqual(demo.candidates, []);
  assert.equal(demo.usableReportCount, 0);
  assert.equal(demo.contributingReportCount, 0);
  assert.equal(demo.excluded.demonstrationReports, 2);
  assert.equal(demo.reason, "insufficient-reports");
});

test("demonstration reports cannot complete a pair or change real plan support", () => {
  const demo = pair("demo", 10, { isSynthetic: true, severity: "high" });
  const real = pair("real", 0);
  const single = buildPlanModel({ reports: [real[0], ...demo], region, type: "hospital" });
  assert.deepEqual(single.candidates, []);
  assert.equal(single.usableReportCount, 1);
  assert.equal(single.reason, "insufficient-reports");
  assert.equal(single.excluded.demonstrationReports, 2);

  const clean = buildPlanModel({ reports: real, region, type: "hospital" });
  const mixed = buildPlanModel({ reports: [...real, ...demo], region, type: "hospital" });
  assert.deepEqual(mixed.candidates, clean.candidates, "Demo urgency, positions and citations must not influence a plan");
  assert.equal(mixed.usableReportCount, 2);
  assert.equal(mixed.contributingReportCount, 2);
  assert.equal(mixed.excluded.demonstrationReports, 2);
});

test("Plans only counts excluded demonstration reports inside the selected planning region", () => {
  const reports = [report("inside", 0, { isSynthetic: true }), report("outside", 30, { isSynthetic: true })];
  const model = buildPlanModel({ reports, region, type: "hospital" });
  assert.deepEqual(model.candidates, []);
  assert.equal(model.excluded.demonstrationReports, 1);
  assert.equal(model.excluded.outsideRegion, 1);
  assert.equal(model.usableReportCount, 0);
});

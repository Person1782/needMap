import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEstimateEvidence } from "../plans-model.js";
import {
  buildPlanBenchmark, buildPlanBenchmarkEvidence, buildPlanBenchmarkEvidenceSet,
  getPlanBenchmark, hasPlanBenchmark, PLAN_ESTIMATE_TYPES,
} from "../plans-benchmarks.js";

const numericTypes = PLAN_ESTIMATE_TYPES.filter((type) => type !== "other");
const timelineTypes = new Set(["hospital", "pharmacy", "school", "water_facility", "roads", "transportation", "emergency", "food", "fuel"]);

test("the catalog includes every approved plan type and deliberately excludes an all option", () => {
  assert.deepEqual(PLAN_ESTIMATE_TYPES, ["hospital", "pharmacy", "school", "water_facility", "electricity", "internet", "roads", "transportation", "emergency", "food", "fuel", "other"]);
  assert.equal(PLAN_ESTIMATE_TYPES.includes("all"), false);
  assert.equal(hasPlanBenchmark("hospital"), true);
  assert.equal(hasPlanBenchmark("other"), false);
});

test("every cost estimate has an ordered range, exact asset, assumptions, and traceable sources", () => {
  for (const type of numericTypes) {
    const estimate = buildPlanBenchmark(type, { region: { name: "Example Region" } });
    assert.equal(estimate.status, "ready", type);
    assert.ok(Number.isFinite(estimate.cost.low) && estimate.cost.low > 0, type);
    assert.ok(Number.isFinite(estimate.cost.high) && estimate.cost.high >= estimate.cost.low, type);
    assert.equal(estimate.cost.currency, "USD", type);
    assert.equal(estimate.cost.priceYear, 2024, type);
    assert.match(estimate.cost.geography, /not localized for Example Region/, type);
    assert.ok(estimate.asset.name && estimate.asset.scale && estimate.asset.unit, type);
    assert.ok(estimate.calculation.cost, type);
    assert.ok(estimate.inclusions.length && estimate.exclusions.length && estimate.assumptions.length, type);
    assert.ok(estimate.sources.length >= 1, type);
    assert.ok(estimate.sources.every((item) => item.title && item.publisher && Object.hasOwn(item, "year") && item.url.startsWith("https://") && item.usedFor), type);
    assert.ok(estimate.sources.some((item) => /unit cost|comparator|installed cost/i.test(item.usedFor)), type);
    if (timelineTypes.has(type)) {
      assert.ok(Number.isFinite(estimate.timeline.low) && estimate.timeline.low > 0, type);
      assert.ok(Number.isFinite(estimate.timeline.high) && estimate.timeline.high >= estimate.timeline.low, type);
      assert.equal(estimate.timeline.type, "observed U.S. construction-duration benchmark", type);
      assert.match(estimate.timeline.basis, /construction-duration benchmark/, type);
      assert.match(estimate.calculation.timeline, /lowest and highest U\.S\. Census average construction durations/, type);
      assert.ok(estimate.sources.some((item) => item.url === "https://www.census.gov/construction/c30/length.html"), type);
    } else {
      assert.equal(estimate.timeline, null, type);
      assert.equal(estimate.calculation.timeline, null, type);
      assert.match(estimate.assumptions.join(" "), /No numeric completion time is shown/, type);
    }
    assert.equal(Object.isFrozen(estimate), true, type);
  }
});

test("cost formulas reproduce the cited base rates and stated asset scales", () => {
  assert.deepEqual(buildPlanBenchmark("hospital").cost, {
    low: 22_790_250, high: 45_580_500, currency: "USD", priceYear: 2024,
    geography: "Cited U.S. or global benchmark; not localized", estimateType: "preliminary benchmark estimate",
    baseLow: 22_790_250, baseHigh: 45_580_500, baseGeography: "United States facilities benchmark",
  });
  assert.deepEqual(buildPlanBenchmark("pharmacy").cost, {
    low: 1_384_000, high: 4_456_000, currency: "USD", priceYear: 2024,
    geography: "Cited U.S. or global benchmark; not localized", estimateType: "preliminary benchmark estimate",
    baseLow: 1_384_000, baseHigh: 4_456_000, baseGeography: "United States facilities benchmark",
  });
  assert.deepEqual(buildPlanBenchmark("school").cost, {
    low: 5_880_000, high: 23_360_000, currency: "USD", priceYear: 2024,
    geography: "Cited U.S. or global benchmark; not localized", estimateType: "preliminary benchmark estimate",
    baseLow: 5_880_000, baseHigh: 23_360_000, baseGeography: "United States facilities benchmark",
  });
  assert.equal(buildPlanBenchmark("water_facility").cost.low, 2_240_103);
  assert.equal(buildPlanBenchmark("water_facility").cost.high, 4_480_205);
  assert.deepEqual([buildPlanBenchmark("electricity").cost.low, buildPlanBenchmark("electricity").cost.high], [489_000, 1_610_000]);
  assert.deepEqual([buildPlanBenchmark("internet").cost.low, buildPlanBenchmark("internet").cost.high], [552_625, 1_941_609]);
  assert.deepEqual([buildPlanBenchmark("roads").cost.low, buildPlanBenchmark("roads").cost.high], [537_185, 2_148_740]);
  assert.deepEqual([buildPlanBenchmark("transportation").cost.low, buildPlanBenchmark("transportation").cost.high], [962_450, 2_887_350]);
  assert.deepEqual([buildPlanBenchmark("emergency").cost.low, buildPlanBenchmark("emergency").cost.high], [8_352_000, 11_142_000]);
  assert.deepEqual([buildPlanBenchmark("food").cost.low, buildPlanBenchmark("food").cost.high], [4_065_000, 8_130_000]);
  assert.deepEqual([buildPlanBenchmark("fuel").cost.low, buildPlanBenchmark("fuel").cost.high], [643_124, 1_286_248]);
});

test("timeline ranges are derived from matching Census construction categories, value bands, and cohorts", () => {
  const expected = {
    hospital: [19.3, 20.8], pharmacy: [8.1, 11.8], school: [16, 26.1], water_facility: [11.6, 17.4],
    roads: [5.9, 9.4], transportation: [5.3, 10.7], emergency: [19.1, 27.7], food: [11.5, 13.6], fuel: [5.6, 8.3],
  };
  for (const [type, range] of Object.entries(expected)) {
    const timeline = getPlanBenchmark(type).timeline;
    assert.deepEqual([timeline.low, timeline.high], range, type);
    assert.match(getPlanBenchmark(type).calculation.timeline, /2022–23, 2023–24, and 2024–25/, type);
    assert.match(getPlanBenchmark(type).calculation.timeline, /construction start to completion only/, type);
  }
  for (const type of ["electricity", "internet"]) assert.equal(getPlanBenchmark(type).timeline, null, type);
});

test("an evidence-backed multiplier adjusts both ends and remains fully disclosed", () => {
  const source = {
    title: "Official local construction cost index", publisher: "National statistics office", year: 2024,
    url: "https://statistics.example.gov/construction-index", usedFor: "A 0.75 local-to-benchmark construction cost multiplier.",
  };
  const result = buildPlanBenchmark("hospital", { region: "Local Region", localCostAdjustment: {
    multiplier: 0.75, geography: "Local Region", method: "2024 local construction index divided by the cited benchmark index", source,
  } });
  assert.deepEqual([result.cost.low, result.cost.high], [17_092_688, 34_185_375]);
  assert.match(result.cost.geography, /^Local Region; adjusted/);
  assert.equal(result.cost.priceYear, 2024);
  assert.equal(result.localization.multiplier, 0.75);
  assert.equal(result.localization.source.url, source.url);
  assert.equal(result.sources.at(-1).usedFor, source.usedFor);
  assert.match(result.calculation.cost, /multiplies both ends by 0.75/);
});

test("local adjustment fails closed without a valid number and dated evidence", () => {
  const valid = { multiplier: 1, geography: "A", method: "Official index ratio", source: {
    title: "Index", publisher: "Statistics office", year: 2024, url: "https://example.gov/index", usedFor: "Local adjustment",
  } };
  for (const multiplier of [0, -1, NaN, Infinity, 101, "1"]) {
    assert.throws(() => buildPlanBenchmark("school", { localCostAdjustment: { ...valid, multiplier } }), /multiplier/i);
  }
  assert.throws(() => buildPlanBenchmark("school", { localCostAdjustment: { ...valid, geography: "" } }), /geography/i);
  assert.throws(() => buildPlanBenchmark("school", { localCostAdjustment: { ...valid, method: "" } }), /method/i);
  assert.throws(() => buildPlanBenchmark("school", { localCostAdjustment: { ...valid, source: { ...valid.source, url: "http://example.com" } } }), /dated HTTPS source/i);
  assert.throws(() => buildPlanBenchmark("school", { localCostAdjustment: { ...valid, source: { ...valid.source, usedFor: "" } } }), /dated HTTPS source/i);
});

test("other stays unavailable rather than fabricating cost or time", () => {
  const result = buildPlanBenchmark("other", { region: "Anywhere", localCostAdjustment: { multiplier: 2 } });
  assert.equal(result.status, "unavailable");
  assert.equal(result.available, false);
  assert.equal(result.cost, null);
  assert.equal(result.timeline, null);
  assert.equal(result.sources.length, 0);
  assert.match(result.explanation, /defined asset/);
});

test("unsupported values, including all, are rejected", () => {
  assert.throws(() => buildPlanBenchmark("all"), /Unsupported plan type/);
  assert.throws(() => buildPlanBenchmark("airport"), /Unsupported plan type/);
  assert.throws(() => buildPlanBenchmark(null), /Unsupported plan type/);
});

test("evidence adapter satisfies the Plans model contract without losing disclosures", () => {
  const records = buildPlanBenchmarkEvidenceSet();
  assert.equal(records.length, numericTypes.length);
  assert.equal(records.some((record) => record.type === "other"), false);
  const record = buildPlanBenchmarkEvidence("hospital");
  assert.deepEqual(record.geography, { level: "global" });
  assert.match(record.scope, /Small community hospital/);
  assert.match(record.scope, /not localized/);
  assert.match(record.cost.formula.explanation, /25,000/);
  assert.match(record.timeline.formula.explanation, /lowest and highest U\.S\. Census average construction durations/);
  assert.ok(record.sources.every((item) => item.id && item.title && item.publisher && item.url.startsWith("https://") && item.usedFor));

  const selected = applyEstimateEvidence({
    evidence: records,
    type: "hospital",
    region: { id: "CA", name: "California", countryCode: "US" },
    currentYear: 2026,
  });
  assert.equal(selected.cost.status, "estimated");
  assert.equal(selected.cost.low, 22_790_250);
  assert.equal(selected.timeline.lowMonths, 19.3);
  assert.match(selected.cost.scope, /not localized/);
});

test("types without category-specific duration evidence keep cost but fail closed on completion time", () => {
  for (const type of ["electricity", "internet"]) {
    const record = buildPlanBenchmarkEvidence(type);
    assert.equal(record.timeline, null, type);
    const selected = applyEstimateEvidence({
      evidence: [record], type, region: { id: "CA", countryCode: "US" }, currentYear: 2026,
    });
    assert.equal(selected.cost.status, "estimated", type);
    assert.equal(selected.timeline.status, "unavailable", type);
    assert.match(selected.timeline.reason, /No supported completion-time estimate/, type);
  }
});

test("localized evidence is scoped to the named region and cannot become a global adjustment", () => {
  const adjustment = {
    multiplier: 0.8, geography: "Test Region", method: "Official construction-index ratio",
    source: { title: "Construction index", publisher: "Statistics office", year: 2024,
      url: "https://example.gov/construction", usedFor: "Local cost multiplier." },
  };
  assert.throws(() => buildPlanBenchmarkEvidence("school", { region: "Test Region", localCostAdjustment: adjustment }), /region ID|country code/i);
  const record = buildPlanBenchmarkEvidence("school", {
    region: { id: "TEST-1", countryCode: "TT", name: "Test Region" }, localCostAdjustment: adjustment,
  });
  assert.deepEqual(record.geography, { regionId: "TEST-1", countryCode: "TT", level: "region" });
  assert.equal(record.cost.low, 4_704_000);
  const local = applyEstimateEvidence({ evidence: [record], type: "school",
    region: { id: "TEST-1", countryCode: "TT" }, currentYear: 2026 });
  const elsewhere = applyEstimateEvidence({ evidence: [record], type: "school",
    region: { id: "TEST-2", countryCode: "TT" }, currentYear: 2026 });
  assert.equal(local.cost.status, "estimated");
  assert.equal(elsewhere.cost.status, "unavailable");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateTimeTrends,
  calculateCoverageMetrics,
  calculateDuplicateSimilarity,
  compareScenarios,
  evaluateNeedAlerts,
  findPotentialDuplicates,
  scoreReportQuality,
  serializeCsv,
} from "../decision-tools.js";

const origin = { latitude: 0, longitude: 0 };
const report = (id, overrides = {}) => ({
  id, ...origin, category: "healthcare", severity: "high",
  region: { id: "region-a", name: "Region A" },
  summary: "Residents need a nearby clinic with accessible appointments and weekend service.",
  submittedAt: "2026-10-16T12:00:00Z", ...overrides,
});

test("coverage uses exact travel times at the threshold and excludes invalid coordinates", () => {
  const justOutside = { latitude: (5.04 / 60 * 4.8 / 1.2) / 111.1950802335329, longitude: 0 };
  const result = calculateCoverageMetrics(origin, [justOutside, origin, { latitude: "", longitude: 0 }, null], {
    thresholdsMinutes: [5],
  });
  assert.equal(result.reportMetrics[0].travelTimes.walk.minutes, 5);
  assert.equal(result.modes.walk.thresholds[0].reportCount, 1);
  assert.equal(result.validReportCount, 2);
  assert.equal(result.excludedReportCount, 2);
});

test("invalid optional threshold arrays fall back without crashing the coverage analysis", () => {
  const result = calculateCoverageMetrics(origin, [origin], { thresholdsMinutes: null, urgencyWeights: null });
  assert.deepEqual(result.modes.walk.thresholds.map((threshold) => threshold.minutes), [5, 10, 20]);
});

test("trends reject impossible timestamps and exclude reports after the as-of time", () => {
  const result = aggregateTimeTrends([
    report("past", { submittedAt: "2026-10-15T12:00:00Z" }),
    report("future", { submittedAt: "2026-10-28T12:00:00Z" }),
    report("invalid", { submittedAt: 1e40 }),
    report("invalid-seconds", { submittedAt: { seconds: 1e40 } }),
  ], { bucket: "month", lookbackPeriods: 2, endDate: "2026-10-16T12:00:00Z" });
  assert.equal(result.series.at(-1).reportCount, 1);
  assert.equal(result.excludedUndatedReports, 2);
  assert.equal(result.series.at(-1).label, "2026-10");
});

test("live trends can end at today even when the dataset contains only old reports", () => {
  const result = aggregateTimeTrends([report("old", { submittedAt: "2020-01-01" })], {
    bucket: "month", lookbackPeriods: 3, endDate: "2026-10-16",
  });
  assert.equal(result.series.at(-1).label, "2026-10");
  assert.equal(result.series.reduce((sum, period) => sum + period.reportCount, 0), 0);
});

test("trend history bounds prevent unbounded allocations from persisted settings", () => {
  assert.equal(aggregateTimeTrends([], { lookbackPeriods: 1e15 }).series.length, 1000);
});

test("non-Latin report text retains duplicate and quality evidence", () => {
  const first = report("a", { summary: "附近 没有 医院 居民 需要 诊所 提供 医疗 服务" });
  const second = report("b", { summary: first.summary });
  assert.equal(calculateDuplicateSimilarity(first, second).textSimilarity, 1);
  assert.ok(scoreReportQuality(first).checks.wordCount > 0);
});

test("duplicate scanning tolerates malformed optional records", () => {
  assert.doesNotThrow(() => findPotentialDuplicates([null, report("a")], { threshold: 0 }));
});

test("scenario scoring ignores unknown weights and invalid scenarios", () => {
  const result = compareScenarios([
    null,
    { id: "valid", candidate: origin, feasibilityScore: 0 },
  ], [origin], { weights: { coverage: 1, misspelledWeight: 99 } });
  assert.equal(result.ranked[0].score, 100);
  assert.equal(result.ranked[0].feasibilityScore, 0);
  assert.equal(result.excludedScenarioCount, 1);
});

test("negative or invalid costs cannot award scores greater than 100", () => {
  const result = compareScenarios([
    { id: "invalid-cost", candidate: origin, estimatedCost: -1000 },
    { id: "first", candidate: origin, estimatedCost: 100 },
    { id: "second", candidate: origin, estimatedCost: 200 },
  ], [], { weights: { cost: 1 } });
  assert.equal(result.ranked.find((scenario) => scenario.id === "invalid-cost").costScore, 50);
  assert.ok(result.ranked.every((scenario) => scenario.score >= 0 && scenario.score <= 100));
});

test("CSV escapes formulas after whitespace, quotes, multiline fields, and invalid dates", () => {
  const csv = serializeCsv([
    { note: '\n=HYPERLINK("https://example.invalid")', date: new Date(NaN), count: -5 },
  ]);
  assert.equal(csv, 'note,date,count\r\n"\'\n=HYPERLINK(""https://example.invalid"")",,-5');
  assert.ok(serializeCsv([{ note: "\uFEFF@SUM(1+1)" }]).includes("'\uFEFF@SUM(1+1)"));
});

test("new report evidence changes an alert revision while reordering does not", () => {
  const reports = [report("a"), report("b"), report("c")];
  const first = evaluateNeedAlerts(reports)[0];
  assert.equal(evaluateNeedAlerts([...reports].reverse())[0].revision, first.revision);
  assert.notEqual(evaluateNeedAlerts([...reports, report("d")])[0].revision, first.revision);
  assert.equal(evaluateNeedAlerts([...reports, null])[0].reportCount, 3);
});

test("a new trend window reports its new-activity spike without an undefined percentage", () => {
  const result = evaluateNeedAlerts([report("a"), report("b"), report("c")], {
    trendOptions: { bucket: "week", endDate: "2026-10-16T12:00:00Z" },
  });
  const spike = result[0].alerts.find((alert) => alert.id === "recent-spike");
  assert.ok(spike);
  assert.match(spike.message, /after a period with no reports/);
});

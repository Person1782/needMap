import assert from "node:assert/strict";
import { test } from "node:test";
import { ANALYSIS_CATEGORIES, PRIORITY_WEIGHTS, buildAnalysisModel, categoryForReport, parseDurationQuote } from "../analysis-model.js";

const now = Date.parse("2026-10-22T00:00:00Z");
const country = { id: "KE", countryCode: "KE", name: "Kenya", kind: "country" };
const county = { id: "KE-30", countryCode: "KE", name: "Nairobi", kind: "state" };
const source = { id: "water", title: "Basic water access", publisher: "WHO / UNICEF", url: "https://data.worldbank.org/indicator/SH.H2O.BASW.ZS", usedFor: "Share of residents without basic drinking water" };
const report = (id, category = "water", extra = {}) => ({ id, category, summary: "Service unavailable", severity: "high", ...extra });
const indicator = (id, kind, value, extra = {}) => ({ id, kind, value, category: "water", year: 2024, unit: kind === "affected_population" ? "people" : "percent", scope: { regionId: "KE", countryCode: "KE", level: "country" }, source, eligibleForScore: true, ...extra });
const model = (options = {}) => buildAnalysisModel({ region: country, now, ...options });
const factor = (row, id) => row.factors.find((item) => item.id === id);

test("taxonomy refines legacy categories and avoids incidental destination words", () => {
  assert.equal(categoryForReport(report("a", "healthcare", { summary: "The pharmacy has no medicine" })), "healthcare");
  assert.equal(categoryForReport(report("b", "transportation", { summary: "Potholes block the bridge" })), "roads");
  assert.equal(categoryForReport(report("c", "other", { summary: "Our school has no classroom" })), "education");
  assert.equal(categoryForReport(report("d", "transportation", { summary: "No bus to the school on Main Road" })), "transportation");
  assert.equal(categoryForReport(report("e", "healthcare", { summary: "The clinic on School Road is unavailable" })), "healthcare");
  assert.equal(categoryForReport(report("f", "internet")), "broadband");
  assert.equal(categoryForReport(null), "other");
  assert.equal(categoryForReport({ category: "__proto__" }), "other");
});

test("medication aliases and legacy other reports share the Healthcare category without rewriting reports", () => {
  assert.equal(ANALYSIS_CATEGORIES.filter((item) => item.id === "healthcare").length, 1);
  assert.equal(ANALYSIS_CATEGORIES.find((item) => item.id === "healthcare").label, "Healthcare");
  assert.ok(!ANALYSIS_CATEGORIES.some((item) => item.id === "medication_access"));
  for (const category of ["healthcare", "medical", "medicine", "medication", "medications", "pharmacy", "medication_access", " Medication_Access "]) {
    const legacy = report("legacy", category);
    assert.equal(categoryForReport(legacy), "healthcare", category);
    assert.equal(legacy.category, category);
  }
  assert.equal(categoryForReport(report("a", "other", { summary: "The pharmacy has no prescriptions available" })), "healthcare");
  assert.equal(categoryForReport(report("b", "healthcare", { summary: "Clinic closed and medications unavailable" })), "healthcare");
  assert.equal(categoryForReport(report("c", "transportation", { summary: "No bus to the pharmacy" })), "transportation");
});

test("care and medication reports form one deduplicated Healthcare overview and priority row", () => {
  const reports = [
    report("care", "healthcare", { resolved: false, problemDurationDays: 365 }),
    report("medicine", "medication_access", { severity: "low", status: "resolved", problemDurationDays: 0 }),
    report("medicine", "healthcare", { severity: "high", resolved: false, problemDurationDays: 365 }),
    report("pharmacy", "other", { summary: "The pharmacy is unavailable", status: "open" }),
    report("water"),
  ];
  const full = model({ reports });
  const healthcare = full.rankings.find((row) => row.category === "healthcare");
  assert.equal(full.overview.totalReports, 4);
  assert.deepEqual(full.overview.mostCommonProblem, { category: "healthcare", label: "Healthcare", count: 3,
    tied: [{ category: "healthcare", label: "Healthcare", count: 3 }] });
  assert.equal(full.rankings.filter((row) => row.category === "healthcare").length, 1);
  assert.ok(!full.rankings.some((row) => row.category === "medication_access"));
  assert.equal(healthcare.reportCount, 3);
  assert.deepEqual(healthcare.reports.map((item) => item.id), ["care", "medicine", "pharmacy"]);
  assert.equal(factor(healthcare, "frequency").score, 75);
  assert.equal(factor(healthcare, "severity").reportUrgencyMean, 75);
  assert.equal(factor(healthcare, "duration").reportEvidence.length, 2);
  for (const category of ["healthcare", "medicine", "medication", "medications", "pharmacy", "medication_access", " MEDICATION_ACCESS "]) {
    const filtered = model({ reports, category });
    assert.equal(filtered.category, "healthcare", category);
    assert.equal(filtered.overview.totalReports, 3, category);
    assert.equal(filtered.overview.unresolvedIssues, 2, category);
    assert.equal(filtered.overview.resolvedReports, 1, category);
    assert.deepEqual(filtered.rankings, [healthcare], category);
  }
});

test("overview deduplicates report IDs, filters categories, and does not invent resolution", () => {
  const reports = [report("a"), report("b", "healthcare"), report("b", "healthcare"), report("c", "water", { status: "resolved" })];
  const all = model({ reports });
  assert.equal(all.overview.totalReports, 3);
  assert.equal(all.overview.unresolvedIssues, null);
  assert.equal(all.overview.unknownResolutionReports, 2);
  assert.equal(all.overview.resolvedReports, 1);
  assert.equal(all.overview.mostCommonProblem.category, "water");
  assert.equal(all.overview.mostCommonProblem.count, 2);
  const health = model({ reports, category: "healthcare" });
  assert.equal(health.overview.totalReports, 1);
  assert.deepEqual(health.rankings.map((row) => row.category), ["healthcare"]);
  assert.equal(health.overview.mostCommonProblem.category, "healthcare");
  assert.equal(health.rankings[0].rank, all.rankings.find((row) => row.category === "healthcare").rank);
});

test("only explicit resolution fields support unresolved counts and contradictions stay unknown", () => {
  const explicit = model({ reports: [report("a", "water", { status: "open" }), report("b", "water", { resolved: true }), report("c", "water", { resolutionStatus: "in progress" })] });
  assert.equal(explicit.overview.unresolvedIssues, 2);
  assert.equal(explicit.overview.resolvedReports, 1);
  const conflicting = model({ reports: [report("a", "water", { status: "resolved", resolved: false })] });
  assert.equal(conflicting.overview.unresolvedIssues, null);
  assert.equal(model({ reports: [report("b", "water", { status: "closed" })] }).overview.unresolvedIssues, null);
});

test("missing evidence produces a supported score interval without reweighting", () => {
  assert.equal(Object.values(PRIORITY_WEIGHTS).reduce((sum, weight) => sum + weight), 100);
  const row = model({ reports: [report("a")] }).rankings[0];
  assert.equal(row.score, 45); // severity 30 + report share 15
  assert.equal(row.scoreUpperBound, 100);
  assert.equal(row.coverage, 45);
  assert.equal(factor(row, "affected_population").score, null);
  assert.equal(factor(row, "access").score, null);
  assert.equal(factor(row, "duration").score, null);
  assert.match(factor(row, "severity").description, /policy choices, not an official/);
});

test("severity baseline places water above broadband for otherwise identical evidence", () => {
  const result = model({ reports: [report("w", "water"), report("b", "broadband")] });
  assert.equal(result.rankings[0].category, "water");
  assert.ok(factor(result.rankings[0], "severity").score > factor(result.rankings[1], "severity").score);
  assert.equal(ANALYSIS_CATEGORIES.find((item) => item.id === "water").severity, 100);
});

test("severity factors cite authoritative consequence context without outsourcing NeedMap's policy baseline", () => {
  const expected = new Map([
    ["water", ["World Health Organization", "https://www.who.int/news-room/fact-sheets/detail/drinking-water"]],
    ["healthcare", ["World Health Organization", "https://www.who.int/news-room/fact-sheets/detail/universal-health-coverage-%28uhc%29"]],
    ["emergency_response", ["World Health Organization", "https://www.who.int/health-topics/emergency-care"]],
    ["food", ["World Health Organization", "https://www.who.int/en/news-room/fact-sheets/detail/malnutrition"]],
    ["roads", ["World Health Organization", "https://www.who.int/news-room/fact-sheets/detail/road-traffic-injuries"]],
    ["transportation", ["World Bank", "https://www.worldbank.org/ext/en/topic/transport"]],
    ["education", ["UNESCO", "https://www.unesco.org/en/right-education?hub=66970"]],
    ["fuel", ["International Energy Agency", "https://www.iea.org/reports/sdg7-data-and-projections"]],
    ["broadband", ["International Telecommunication Union", "https://www.itu.int/dms_pub/itu-d/opb/ind/D-IND-ICT_MDD.GCR-2025-4-PDF-E.pdf"]],
  ]);
  const result = model({ reports: ANALYSIS_CATEGORIES.map(({ id }) => report(`report-${id}`, id)) });

  for (const definition of ANALYSIS_CATEGORIES) {
    const severity = factor(result.rankings.find((row) => row.category === definition.id), "severity");
    if (definition.id === "other") {
      assert.equal(definition.severitySource, undefined);
      assert.deepEqual(severity.sources, []);
      assert.match(definition.rationale, /more context is needed/i);
      assert.match(severity.description, /No category-level source is attached because more context is needed/);
      continue;
    }

    const [publisher, url] = expected.get(definition.id);
    assert.equal(severity.sources.length, 1, definition.id);
    const cited = severity.sources[0];
    assert.equal(cited.publisher, publisher, definition.id);
    assert.equal(cited.url, url, definition.id);
    assert.ok(cited.title.trim(), definition.id);
    assert.ok(cited.usedFor.trim(), definition.id);
    assert.ok(cited.uses.includes(cited.usedFor), definition.id);
    assert.match(cited.usedFor, /not support for NeedMap's numeric policy baseline/, definition.id);
    assert.match(severity.description, /cited source provides consequence context only/, definition.id);
    assert.match(severity.description, /does not endorse NeedMap's numeric baseline/, definition.id);
  }
});

test("category filters never inflate report-frequency scores or change overall ranks", () => {
  const reports = [report("a"), report("b", "healthcare"), report("c", "healthcare"), report("d", "education")];
  const full = model({ reports });
  const filtered = model({ reports, category: "water" });
  assert.equal(factor(filtered.rankings[0], "frequency").score, 25);
  assert.equal(filtered.rankings[0].score, full.rankings.find((row) => row.category === "water").score);
  assert.equal(filtered.rankings[0].rank, full.rankings.find((row) => row.category === "water").rank);
});

test("country evidence cannot score a local region or supply its affected population", () => {
  const evidence = { indicators: [indicator("affected", "affected_population", 100000), indicator("access", "access_gap_percent", 20)] };
  const national = model({ reports: [report("a")], evidence, category: "water" });
  assert.equal(national.overview.estimatedPopulationAffected.value, 100000);
  assert.equal(factor(national.rankings[0], "access").score, 20);
  const local = model({ region: county, reports: [report("a")], evidence, category: "water" });
  assert.equal(local.overview.estimatedPopulationAffected, null);
  assert.equal(local.rankings[0].indicators.length, 0);
  assert.equal(local.rankings[0].contextIndicators.length, 2);
  assert.equal(factor(local.rankings[0], "access").score, null);
  assert.equal(local.rankings[0].score, 45);
});

test("published index gaps are not converted to affected people and unrelated country sources are discarded", () => {
  const evidence = { indicators: [indicator("health", "access_gap_index", 40, { category: "healthcare" }), indicator("population", "population", 1000000, { category: "all" }), indicator("wrong", "affected_population", 123, { scope: { regionId: "UG", countryCode: "UG", level: "country" } })] };
  const result = model({ reports: [report("a", "healthcare")], evidence, category: "healthcare" });
  assert.equal(result.overview.estimatedPopulationAffected, null);
  assert.equal(factor(result.rankings[0], "access").score, 40);
  assert.match(factor(result.rankings[0], "access").description, /not a percentage/);
  assert.equal(result.rankings[0].indicators.length, 1);
});

test("affected population uses the latest exact-geography estimate and preserves both derived-count citations", () => {
  const populationSource = { id: "population", title: "Population", publisher: "United Nations", url: "https://data.worldbank.org/indicator/SP.POP.TOTL", usedFor: "Same-year population used to estimate the number affected" };
  const evidence = { indicators: [indicator("old", "affected_population", 100, { year: 2022 }), indicator("new", "affected_population", 200, { sources: [source, populationSource] })] };
  const result = model({ evidence, category: "water" });
  assert.equal(result.overview.estimatedPopulationAffected.value, 200);
  assert.equal(result.overview.estimatedPopulationAffected.sources.length, 2);
  assert.equal(factor(result.rankings[0], "affected_population").sources.length, 2);
  assert.ok(result.sources.find((item) => item.id === "population").uses.includes(populationSource.usedFor));
  assert.equal(model({ evidence }).overview.estimatedPopulationAffected, null);
});

test("unrelated population context does not leak into a selected problem's sources", () => {
  const populationSource = { id: "population", title: "Population", publisher: "United Nations", url: "https://data.worldbank.org/indicator/SP.POP.TOTL" };
  const evidence = { indicators: [indicator("population", "population", 1000000, { category: "all", source: populationSource }), indicator("water", "access_gap_percent", 20)] };
  assert.deepEqual(model({ evidence, category: "medication_access" }).sources, []);
  assert.deepEqual(model({ evidence, category: "water" }).sources.map((item) => item.id), ["water"]);
  assert.deepEqual(model({ evidence }).sources.map((item) => item.id), ["water"]);
});

test("invalid, future, uncited and explicitly ineligible indicators cannot enter scores", () => {
  const evidence = { indicators: [indicator("negative", "affected_population", -1), indicator("infinite", "affected_population", Infinity), indicator("over100", "access_gap_percent", 101), indicator("future", "access_gap_percent", 25, { year: 2030 }), indicator("uncited", "access_gap_percent", 50, { source: null }), indicator("unsafe", "access_gap_percent", 50, { source: { ...source, url: "javascript:alert(1)" } }), indicator("context", "access_gap_percent", 80, { eligibleForScore: false })] };
  const row = model({ reports: [report("a")], evidence }).rankings[0];
  assert.equal(row.indicators.length, 0);
  assert.equal(row.contextIndicators.length, 1);
  assert.equal(row.score, 45);
});

test("missing urgency and duration only partially cover their factors", () => {
  const row = model({ reports: [report("a", "water", { problemDurationDays: 365 }), report("b", "water", { severity: "unknown" })] }).rankings[0];
  assert.equal(factor(row, "severity").coverage, 90);
  assert.equal(factor(row, "severity").contribution, 27);
  assert.equal(factor(row, "duration").coverage, 50);
  assert.equal(factor(row, "duration").contribution, 5);
  assert.equal(factor(row, "duration").possibleContribution, 10);
});

test("report age is never substituted for problem duration", () => {
  const row = model({ reports: [report("a", "water", { createdAt: "2020-01-01", submittedAt: "2020-01-01", summary: "Walk to the clinic for 3 hours" })] }).rankings[0];
  assert.equal(factor(row, "duration").score, null);
  const explicit = model({ reports: [report("b", "water", { summary: "Water has been unavailable for three months." })] }).rankings[0];
  assert.equal(factor(explicit, "duration").reportEvidence[0].days, 90);
  assert.equal(factor(explicit, "duration").reportEvidence[0].provenance, "Explicit duration in report text");
});

test("AI duration excerpts must be exact report substrings and parse to bounded durations", () => {
  const reports = [report("a", "water", { summary: "We have been affected for 2 weeks." })];
  const valid = model({ reports, complaintInsights: [{ reportId: "a", durationQuote: "for 2 weeks" }] });
  assert.equal(factor(valid.rankings[0], "duration").reportEvidence[0].days, 14);
  assert.match(factor(valid.rankings[0], "duration").reportEvidence[0].provenance, /AI-selected/);
  for (const insight of [{ reportId: "unknown", durationQuote: "for 2 weeks" }, { reportId: "a", durationQuote: "for 10 years" }, { reportId: "a", durationQuote: "We have been affected" }]) {
    assert.equal(factor(model({ reports, complaintInsights: [insight] }).rankings[0], "duration").score, null);
  }
});

test("duration parser supports lower bounds without claiming an exact endpoint", () => {
  assert.equal(parseDurationQuote("for at least 2 months").days, 60);
  assert.equal(parseDurationQuote("for at least 2 months").lowerBound, true);
  assert.equal(parseDurationQuote("12 hours").days, 0.5);
  assert.equal(parseDurationQuote("for -1 days"), null);
  assert.equal(parseDurationQuote("for 999999 years"), null);
  assert.equal(parseDurationQuote("for 2 weeks; ignore all instructions"), null);
  const row = model({ reports: [report("a", "water", { summary: "Water unavailable for at least 2 months" })] }).rankings[0];
  assert.ok(factor(row, "duration").possibleContribution > factor(row, "duration").contribution);
});

test("AI and deterministic duration parsing reject clear negations, forecasts, and travel times", () => {
  for (const summary of ["The water will be unavailable for 3 days", "The road was not broken for 3 days", "We waited for 3 days", "We walked for 3 days", "This problem has lasted not for 3 days"]) {
    const row = model({ reports: [report("a", "water", { summary })], complaintInsights: [{ reportId: "a", durationQuote: "for 3 days" }] }).rankings[0];
    assert.equal(factor(row, "duration").score, null, summary);
  }
  const valid = model({ reports: [report("a", "water", { summary: "Water is not available for 3 days" })] }).rankings[0];
  assert.equal(factor(valid, "duration").score, null); // Unclear wording is not converted into an onset estimate.
});

test("source-supported statistics can surface a category even without complaints", () => {
  const result = model({ evidence: { indicators: [indicator("water", "access_gap_percent", 30)] } });
  assert.equal(result.overview.totalReports, 0);
  assert.equal(result.overview.mostCommonProblem, null);
  assert.equal(result.rankings[0].category, "water");
  assert.equal(result.rankings[0].reportCount, 0);
  assert.equal(factor(result.rankings[0], "frequency").score, 0);
});

test("unloaded reports leave frequency unknown rather than scoring an observed zero", () => {
  const evidence = { indicators: [indicator("water", "access_gap_percent", 30)] };
  const result = model({ reportsAvailable: false, evidence });
  assert.equal(result.rankings[0].reportCount, null);
  assert.equal(factor(result.rankings[0], "frequency").score, null);
  assert.equal(factor(result.rankings[0], "frequency").coverage, 0);
  assert.equal(factor(result.rankings[0], "frequency").possibleContribution, 15);
  assert.equal(result.rankings[0].hasLocalEvidence, true);
  assert.match(factor(result.rankings[0], "frequency").description, /unknown, not zero/);
});

test("national context without local reports cannot create a local priority rank", () => {
  const evidence = { indicators: [indicator("water", "access_gap_percent", 30), indicator("health", "access_gap_index", 40, { category: "healthcare" })] };
  const result = model({ region: county, reports: [report("a", "education")], evidence });
  assert.equal(result.rankings[0].category, "education");
  assert.equal(result.rankings[0].rank, 1);
  for (const row of result.rankings.slice(1)) {
    assert.equal(row.hasLocalEvidence, false);
    assert.equal(row.rank, null);
    assert.equal(row.score, null);
    assert.equal(row.scoreUpperBound, null);
    assert.ok(row.contextIndicators.length);
  }
  const filtered = model({ region: county, evidence, category: "water" });
  assert.equal(filtered.rankings[0].rank, null);
  assert.equal(filtered.rankings[0].contextIndicators.length, 1);
});

test("synthetic reports are counted and clearly identified as demonstration evidence", () => {
  const result = model({ reports: [report("a", "water", { isSynthetic: true }), report("b", "healthcare")] });
  assert.equal(result.overview.syntheticReports, 1);
  assert.equal(result.rankings.find((row) => row.category === "water").syntheticReports, 1);
  assert.ok(result.notes.some((note) => /synthetic\/demo data/.test(note)));
});

test("equal scores have equal ranks and most-common ties remain visible", () => {
  const result = model({ reports: [report("a", "healthcare"), report("b", "emergency_response")] });
  assert.deepEqual(result.rankings.map((row) => row.rank), [1, 1]);
  assert.equal(result.overview.mostCommonProblem.tied.length, 2);
  assert.deepEqual(model({ reports: [] }).rankings, []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { createAnalysisWorkspace } from "../analysis-workspace.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const country = { id: "KE", name: "Kenya", country: "Kenya", countryCode: "KE", kind: "country" };
const local = { id: "KE-30", name: "Nairobi", country: "Kenya", countryCode: "KE", kind: "state" };
const report = (id, category, summary = "Service unavailable") => ({ id, category, summary, severity: "high", submittedAt: { seconds: 1700000000 } });
const source = { id: "water", publisher: "WHO/UNICEF", title: "Basic water access", url: "https://data.worldbank.org/indicator/SH.H2O.BASW.ZS", usedFor: "Water access" };
const evidence = { status: "ready", indicators: [{ id: "gap", title: "People without basic water", description: "Share of people without basic drinking water service.", category: "water", kind: "access_gap_percent", value: 20, unit: "%", year: 2024, source, sources: [source], eligibleForScore: true, scope: { regionId: "KE", countryCode: "KE", name: "Kenya" } }], sources: [source] };
const populationSource = { id: "population", publisher: "UN Population Division via World Bank", title: "Population", url: "https://data.worldbank.org/indicator/SP.POP.TOTL", usedFor: "Same-year population input" };
const affectedEvidence = (extra = {}) => ({ status: "ready", indicators: [{
  id: "affected", title: "Estimated people without basic drinking water service", description: "Published national estimate; it does not count people affected by reports.",
  category: "water", kind: "affected_population", value: 250, unit: "people", year: 2024,
  source, sources: [source, populationSource], eligibleForScore: true,
  scope: { regionId: "KE", countryCode: "KE", name: "Kenya" }, ...extra,
}], sources: [source, populationSource] });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(options = {}) {
  const { document, window } = parseHTML(html);
  const workspace = createAnalysisWorkspace({ document, loadEvidence: async () => evidence, loadPopulation: async () => ({ status: "unavailable" }), ...options });
  const query = (selector) => document.querySelector(selector);
  const choose = (category) => { query(`#analysis-category option[value="${category}"]`).selected = true; query("#analysis-category").dispatchEvent(new window.Event("change")); };
  return { document, window, workspace, query, choose, text: (selector) => query(selector).textContent };
}
test("analysis loads lazily, then category updates the overview, rankings, reports and public facts", async () => {
  let calls = 0;
  const page = fixture({ loadEvidence: async () => { calls++; return evidence; } });
  try {
    page.workspace.update({ region: country, reports: [report("a", "water"), report("b", "healthcare", "Clinic unavailable")], reportsReady: true });
    assert.equal(calls, 0);
    page.workspace.setVisible(true); await tick();
    assert.equal(calls, 1);
    assert.match(page.text("#analysis-overview"), /Total reports2/);
    assert.doesNotMatch(page.text("#analysis-view"), /Unresolved issues|resolution status/i);
    assert.equal(page.query("#analysis-rankings").children.length, 2);
    assert.match(page.text("#analysis-rankings"), /People without basic water: 20 %/);
    assert.deepEqual([...page.query("#analysis-rankings").children].map((row) => row.dataset.category), ["water", "healthcare"]);
    page.choose("healthcare");
    assert.match(page.text("#analysis-scope"), /Healthcare/);
    assert.match(page.text("#analysis-overview"), /Total reports1/);
    assert.equal(page.query("#analysis-rankings").children.length, 1);
    assert.match(page.text("#analysis-rankings"), /Clinic unavailable/);
    assert.doesNotMatch(page.text("#analysis-rankings"), /People without basic water/);
    assert.equal(calls, 1, "Changing a problem uses the same regional evidence");
    page.choose("all");
    assert.equal(page.query("#analysis-rankings").children.length, 2);
  } finally { page.workspace.destroy(); }
});

test("a Plans report citation opens the matching Analysis problem and report", () => {
  const page = fixture({ loadEvidence: async () => ({ status: "unavailable", indicators: [] }) });
  try {
    page.workspace.update({
      region: country,
      reports: [report("water-report", "water", "This is the linked water report"), report("health-report", "healthcare")],
      reportsReady: true,
    });
    page.workspace.setVisible(true);
    assert.equal(page.workspace.focusReport("water", "water-report"), true);
    assert.equal(page.query("#analysis-category").value, "water");
    const row = page.query('.priority-row[data-category="water"]');
    assert.equal(row.open, true);
    const linked = row.querySelector('[data-report-id="water-report"]');
    assert.ok(linked);
    assert.match(linked.textContent, /linked water report/);
    assert.equal(page.workspace.focusReport("unknown", "water-report"), false);
  } finally { page.workspace.destroy(); }
});

test("overview map follows report and recommendation filters without resetting on evidence completion", async () => {
  const updates = []; let created = 0, destroyed = 0;
  const page = fixture({ createOverviewMap: () => {
    created++;
    return { update: (context) => updates.push(context), destroy: () => destroyed++ };
  } });
  const reports = [report("w", "water"), report("h", "medical")];
  const recommendations = [{ id: "rw", category: "water" }, { id: "rh", category: "medical" }];
  try {
    page.workspace.update({ region: country, reports, recommendations, reportsReady: true });
    assert.equal(created, 0, "No overview map is mounted on the Map tab");
    page.workspace.setVisible(true); await tick();
    assert.equal(created, 1); assert.equal(updates.length, 1);
    assert.equal(updates[0].reports.length, 2); assert.equal(updates[0].recommendations.length, 2);
    page.choose("healthcare");
    assert.deepEqual(updates.at(-1).reports.map((item) => item.id), ["h"]);
    assert.deepEqual(updates.at(-1).recommendations.map((item) => item.id), ["rh"]);
    assert.equal(updates.at(-1).recommendations[0].category, "healthcare");
    page.workspace.update({ region: local, reports: [], recommendations: [], reportsReady: true }); await tick();
    assert.equal(updates.at(-1).region.id, local.id); assert.equal(updates.at(-1).reports.length, 0);
    page.workspace.setVisible(false); assert.equal(destroyed, 1);
    page.workspace.setVisible(true); assert.equal(created, 2);
  } finally { page.workspace.destroy(); }
  assert.equal(destroyed, 2);
});
test("Healthcare combines clinic and medication reports into one option, ranking, chart and overview map filter", async () => {
  const updates = [];
  const page = fixture({
    loadEvidence: async () => ({ status: "unavailable", indicators: [] }),
    createOverviewMap: () => ({ update: (context) => updates.push(context), destroy() {} }),
  });
  const reports = [
    report("clinic", "healthcare", "Clinic unavailable"),
    report("pharmacy", "healthcare", "Pharmacy has no essential medication"),
    report("legacy", "medication_access", "Prescription supply unavailable"),
    report("water", "water", "Water unavailable"),
  ];
  const recommendations = [
    { id: "clinic-service", category: "healthcare", analysis: { facilityType: "Clinic" } },
    { id: "pharmacy-service", category: "medication_access", analysis: { facilityType: "Pharmacy" } },
    { id: "water-service", category: "water", analysis: { facilityType: "Water station" } },
  ];
  const ids = (items) => items.map((item) => item.id).sort();
  const chartRows = () => [...page.query("#analysis-report-chart").querySelectorAll(".report-chart-row")];
  try {
    page.workspace.update({ region: country, reports, recommendations, reportsReady: true });
    page.workspace.setVisible(true); await tick();
    const options = [...page.query("#analysis-category").options];
    assert.equal(options.filter((option) => option.textContent === "Healthcare").length, 1);
    assert.equal(options.some((option) => option.value === "medication_access" || option.textContent === "Medication access"), false);
    assert.match(page.text("#analysis-overview"), /Total reports4/);
    assert.equal(page.query("#analysis-rankings").children.length, 2);
    assert.equal(page.query('.priority-row[data-category="medication_access"]'), null);
    const healthcare = page.query('.priority-row[data-category="healthcare"]');
    assert.equal(healthcare.querySelectorAll(".analysis-report").length, 3);
    for (const entry of reports.slice(0, 3)) assert.ok(healthcare.textContent.includes(entry.summary));
    assert.deepEqual(chartRows().map((row) => row.dataset.category), ["healthcare", "water"]);
    assert.deepEqual(chartRows().map((row) => row.querySelector(".report-chart-count").textContent), ["3 reports", "1 report"]);
    assert.deepEqual(ids(updates.at(-1).reports), ["clinic", "legacy", "pharmacy", "water"]);
    assert.deepEqual(ids(updates.at(-1).recommendations), ["clinic-service", "pharmacy-service", "water-service"]);

    page.choose("healthcare");
    assert.match(page.text("#analysis-overview"), /Total reports3/);
    assert.equal(page.query("#analysis-rankings").children.length, 1);
    assert.deepEqual(chartRows().map((row) => row.dataset.category), ["healthcare"]);
    assert.equal(chartRows()[0].querySelector(".report-chart-count").textContent, "3 reports");
    assert.deepEqual(ids(updates.at(-1).reports), ["clinic", "legacy", "pharmacy"]);
    assert.ok(updates.at(-1).reports.every((entry) => entry.category === "healthcare"));
    assert.deepEqual(ids(updates.at(-1).recommendations), ["clinic-service", "pharmacy-service"]);
    assert.ok(updates.at(-1).recommendations.every((entry) => entry.category === "healthcare"));
    assert.doesNotMatch(page.text("#analysis-rankings"), /Water unavailable/);

    page.choose("all");
    assert.match(page.text("#analysis-overview"), /Total reports4/);
    assert.deepEqual(ids(updates.at(-1).reports), ["clinic", "legacy", "pharmacy", "water"]);
    assert.equal(page.query("#analysis-rankings").children.length, 2);
    assert.equal(reports[2].category, "medication_access", "Filtering preserves the stored legacy report");
  } finally { page.workspace.destroy(); }
});

test("late evidence cannot overwrite a newer region; prior counts and public facts clear immediately", async () => {
  const pending = [];
  const page = fixture({ loadEvidence: (region, { signal }) => new Promise((resolve) => pending.push({ region, signal, resolve })) });
  try {
    page.workspace.update({ region: country, reports: [report("a", "water")], reportsReady: true }); page.workspace.setVisible(true);
    page.workspace.update({ region: { id: "IN", countryCode: "IN", name: "India", kind: "country" }, reports: [], reportsReady: true });
    assert.equal(pending[0].signal.aborted, true);
    assert.match(page.text("#analysis-scope"), /India/);
    assert.match(page.text("#analysis-overview"), /Total reports0/);
    pending[1].resolve({ status: "unavailable", indicators: [], sources: [] }); await tick();
    pending[0].resolve(evidence); await tick();
    assert.match(page.text("#analysis-scope"), /India/);
    assert.doesNotMatch(page.text("#analysis-rankings"), /People without basic water/);
  } finally { page.workspace.destroy(); }
});
test("country context does not invent local affected population or priority", async () => {
  const page = fixture({ loadEvidence: async () => ({ ...evidence, status: "partial", indicators: evidence.indicators.map((item) => ({ ...item, eligibleForScore: false })) }) });
  try {
    page.workspace.update({ region: local, reports: [], reportsReady: true }); page.workspace.setVisible(true); await tick();
    assert.match(page.text("#analysis-overview"), /Estimated residents near reportsNo reports/);
    assert.match(page.text("#analysis-rankings"), /Context only/);
    assert.match(page.text("#analysis-rankings"), /Not ranked/);
  } finally { page.workspace.destroy(); }
});
test("public facts and reports stay readable without citations, index measurements or score controls", async () => {
  const publicEvidence = { ...evidence, indicators: [...evidence.indicators,
    { ...evidence.indicators[0], id: "affected", kind: "affected_population", title: "People affected", value: 100000, unit: "people" },
    { ...evidence.indicators[0], id: "index", kind: "access_index", title: "Hidden access index", value: 80, unit: "/100" },
    { ...evidence.indicators[0], id: "index-gap", kind: "access_gap_index", title: "Hidden access gap index", value: 20, unit: "/100" },
  ] };
  const page = fixture({ loadEvidence: async () => publicEvidence });
  try {
    page.workspace.update({ region: country, reports: [report("x", "water", '<img src=x onerror="alert(1)">')], reportsReady: true }); page.workspace.setVisible(true); await tick();
    assert.equal(page.query("#analysis-rankings").querySelector("img"), null);
    assert.match(page.text("#analysis-rankings"), /<img src=x/);
    assert.match(page.text("#analysis-rankings"), /People without basic water: 20 %/);
    assert.doesNotMatch(page.text("#analysis-rankings"), /Hidden access|\/\s*100|Possible range|scoring inputs|What went into this rank/);
    for (const selector of ["#analysis-sources", ".analysis-sources-section", ".analysis-source", ".source-reference", ".priority-score", ".factor-table", ".scoring-method"]) assert.equal(page.query(selector), null, `${selector} must not be displayed`);
    assert.doesNotMatch(page.text("#analysis-view"), /out of 100|0 to 100|score ranges|How the score is calculated/);
    page.choose("water");
    await tick();
    assert.match(page.text("#analysis-overview"), /Estimated residents near reportsUnavailable/);
  } finally { page.workspace.destroy(); }
});
test("failure and loading remain unknown, not zero confirmed reports", async () => {
  const page = fixture();
  try {
    page.workspace.update({ region: country, reports: [], reportsReady: false, connectionFailed: true }); page.workspace.setVisible(true); await tick();
    assert.match(page.text("#analysis-overview"), /Total reportsUnknown/);
    assert.match(page.text("#analysis-status"), /could not be loaded/);
    assert.match(page.text("#analysis-rankings"), /Unknown reports/);
    assert.equal(page.query(".factor-table"), null);
  } finally { page.workspace.destroy(); }
});
test("destroying the page cancels in-flight evidence and suppresses late rendering", async () => {
  let resolve, signal;
  const page = fixture({ loadEvidence: (_, options) => { signal = options.signal; return new Promise((done) => { resolve = done; }); } });
  page.workspace.update({ region: country, reports: [], reportsReady: true }); page.workspace.setVisible(true);
  const before = page.text("#analysis-status"); page.workspace.destroy();
  assert.equal(signal.aborted, true); resolve(evidence); await tick();
  assert.equal(page.text("#analysis-status"), before);
});

test("AI provider failure falls back to a cited local evidence review without replacing statistics or reports", async () => {
  const page = fixture({ reviewComplaints: async () => { throw new Error("Provider unavailable"); } });
  try {
    page.workspace.update({ region: country, reports: [report("a", "water")], reportsReady: true }); page.workspace.setVisible(true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.match(page.text("#analysis-ai-status"), /completed the review from the cited evidence using its built-in fallback/);
    assert.doesNotMatch(page.text("#analysis-ai-status"), /unavailable/i);
    assert.match(page.text("#analysis-rankings"), /People without basic water: 20 %/);
    assert.match(page.text("#analysis-overview"), /Total reports1/);
    assert.match(page.text("#analysis-rankings"), /Service unavailable/);
    assert.match(page.text(".priority-ai-line"), /AI review: NeedMap checked the cited severity, affected-population, and report inputs/);
    assert.match(page.text(".priority-ai-line"), /no external AI output was used/);
  } finally { page.workspace.destroy(); }
});

test("each rank gives one concise sourced reason and one honest AI-review sentence", async () => {
  const unsafeTextSource = { ...source, publisher: "<img src=x onerror=alert(1)>", usedFor: "Affected-population input" };
  const published = affectedEvidence({ title: "<img src=x> Estimated people without water", source: unsafeTextSource, sources: [unsafeTextSource, populationSource] });
  let suppliedPriorityContexts;
  const page = fixture({
    loadEvidence: async () => published,
    reviewComplaints: async (_, __, options) => {
      suppliedPriorityContexts = options.priorityContexts;
      const water = suppliedPriorityContexts.find((context) => context.category === "water");
      return { insights: [{ reportId: "water", quote: "Water has been unavailable", durationQuote: "for 3 months" }], reviewedCount: 1,
        priorityReviews: [{ category: "water", decision: "severity_outweighs_population",
          severitySourceIds: water.severity.sources.map((item) => item.id), populationSourceIds: water.affectedPopulation.sources.map((item) => item.id) }] };
    },
  });
  try {
    page.workspace.update({ region: country, reports: [report("water", "water", "Water has been unavailable for 3 months")], reportsReady: true });
    page.workspace.setVisible(true);
    assert.match(page.text(".priority-ai-line"), /AI review: Checking exact report excerpts and explicit durations; AI does not set the rank\./);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const explanation = page.query('.priority-row[data-category="water"] .priority-reason');
    assert.equal(explanation.querySelectorAll("p").length, 2, "one reason sentence plus one AI-review sentence");
    assert.match(explanation.querySelector("h4").textContent, /AI review: Why it ranks here/);
    assert.match(explanation.querySelector("p").textContent, /Rank #1: Safe water and sanitation are essential/);
    assert.match(explanation.querySelector("p").textContent, /1 of 1 reports were high urgency/);
    assert.match(explanation.querySelector("p").textContent, /<img src=x> Estimated people without water: 250 people in Kenya/);
    assert.match(explanation.querySelector("p").textContent, /2024; published input, not a confirmed count from reports/);
    assert.doesNotMatch(explanation.textContent, /\/\s*100|out of 100/i);
    assert.equal(explanation.querySelector("img"), null, "provider text must render as text, not markup");
    const links = [...explanation.querySelectorAll(".priority-source-link")];
    assert.equal(links.length, 3);
    assert.equal(links[0].textContent, "World Health Organization", "severity consequence has its own citation");
    assert.match(links[0].getAttribute("href"), /who\.int\/news-room\/fact-sheets\/detail\/drinking-water/);
    assert.equal(links[1].textContent, unsafeTextSource.publisher);
    assert.equal(links[1].getAttribute("href"), unsafeTextSource.url);
    assert.match(links[1].getAttribute("title"), /Used for: Affected-population input/);
    const suppliedWater = suppliedPriorityContexts.find((context) => context.category === "water");
    assert.equal(suppliedWater.severity.weight, 30);
    assert.equal(suppliedWater.affectedPopulation.weight, 25);
    assert.equal(suppliedWater.affectedPopulation.value, 250);
    assert.equal(suppliedWater.affectedPopulation.year, 2024);
    assert.match(page.text(".priority-ai-line"), /AI review: Checked 1 reports overall and verified 1 exact excerpts plus 1 explicit durations used in this rank; AI did not set the rank\./);
  } finally { page.workspace.destroy(); }
});

test("ranking reasons distinguish pending, missing, zero-report and context-only evidence", async () => {
  let resolveEvidence;
  const pending = fixture({ loadEvidence: () => new Promise((resolve) => { resolveEvidence = resolve; }) });
  try {
    pending.workspace.update({ region: country, reports: [report("water", "water")], reportsReady: true }); pending.workspace.setVisible(true);
    assert.match(pending.text(".priority-reason"), /population evidence is still loading/);
    resolveEvidence({ status: "unavailable", indicators: [] }); await tick();
    assert.match(pending.text(".priority-reason"), /no exact-region population input was available/);
    assert.match(pending.text(".priority-reason"), /severity therefore carried more weight and the order is provisional/);
  } finally { pending.workspace.destroy(); }

  const reports = fixture({ loadEvidence: async () => affectedEvidence() });
  try {
    reports.workspace.update({ region: country, reports: [], reportsReady: false }); reports.workspace.setVisible(true); await tick();
    assert.match(reports.text(".priority-reason"), /community reports are still loading/);
    assert.match(reports.text(".priority-ai-line"), /Waiting for community reports/);
    reports.workspace.update({ region: country, reports: [], reportsReady: true });
    assert.match(reports.text(".priority-reason"), /no community report added an urgency signal/);
    assert.match(reports.text(".priority-ai-line"), /No community reports were available to check/);
  } finally { reports.workspace.destroy(); }

  const context = fixture({ loadEvidence: async () => affectedEvidence({ eligibleForScore: false }) });
  try {
    context.workspace.update({ region: local, reports: [], reportsReady: true }); context.workspace.setVisible(true); await tick();
    assert.match(context.text(".priority-reason"), /Not ranked:/);
    const links = [...context.document.querySelectorAll(".priority-reason .priority-source-link")];
    assert.equal(links.length, 1, "country context cannot become a local population input");
    assert.equal(links[0].textContent, "World Health Organization", "only category severity context remains cited");
  } finally { context.workspace.destroy(); }
});

test("a late AI result cannot appear in a newly selected region", async () => {
  let resolve, signal;
  const page = fixture({ reviewComplaints: (_, reports, options) => { signal = options.signal; return new Promise((done) => { resolve = done; }); } });
  try {
    page.workspace.update({ region: country, reports: [report("a", "water", "Old region complaint")], reportsReady: true }); page.workspace.setVisible(true);
    await new Promise((done) => setTimeout(done, 650));
    page.workspace.update({ region: local, reports: [], reportsReady: true });
    assert.equal(signal.aborted, true);
    resolve({ insights: [{ reportId: "a", quote: "Old region complaint" }], reviewedCount: 1 }); await tick();
    assert.doesNotMatch(page.text("#analysis-rankings"), /Old region complaint|AI-selected/);
    assert.equal(page.text("#analysis-ai-status"), "");
  } finally { page.workspace.destroy(); }
});

test("report chart compares actual counts, updates both filters, and retains approved category names", async () => {
  const page = fixture();
  try {
    page.workspace.update({ region: country, reports: [report("a", "water"), report("b", "water"), report("b", "water"), report("c", "food")], reportsReady: true });
    page.workspace.setVisible(true); await tick();
    const rows = () => [...page.query("#analysis-report-chart").querySelectorAll(".report-chart-row")];
    assert.deepEqual(rows().map((row) => row.dataset.category), ["water", "food"]);
    assert.deepEqual(rows().map((row) => row.querySelector(".report-chart-count").textContent), ["2 reports", "1 report"]);
    assert.deepEqual(rows().map((row) => row.querySelector(".report-chart-bar").style.width), ["100%", "50%"]);
    assert.match(page.text("#analysis-report-chart"), /Food access/);
    assert.match(page.text("#report-chart-note"), /Reports submitted in Kenya/);
    assert.equal(page.query("#report-chart-note a"), null);
    page.choose("food");
    assert.deepEqual(rows().map((row) => row.dataset.category), ["food"]);
    assert.equal(rows()[0].querySelector(".report-chart-count").textContent, "1 report");
    page.workspace.update({ region: local, reports: [report("d", "food", "Food needed"), report("e", "food", "Food unavailable")], reportsReady: true });
    assert.equal(rows()[0].querySelector(".report-chart-count").textContent, "2 reports");
    assert.match(page.text("#report-chart-note"), /Reports submitted in Nairobi/);
  } finally { page.workspace.destroy(); }
});

test("chart distinguishes loading, failed, empty, demonstration and stale reports", async () => {
  const page = fixture();
  try {
    page.workspace.update({ region: country, reports: [], reportsReady: false }); page.workspace.setVisible(true);
    assert.match(page.text("#analysis-report-chart"), /Loading reports/);
    page.workspace.update({ region: country, reports: [], reportsReady: false, connectionFailed: true });
    assert.match(page.text("#analysis-report-chart"), /could not be loaded/);
    assert.equal(page.query(".report-chart-bar"), null);
    page.workspace.update({ region: country, reports: [], reportsReady: true }); await tick();
    assert.match(page.text("#analysis-report-chart"), /No reports have been submitted/);
    assert.equal(page.query(".report-chart-bar"), null, "National statistics must not create report bars");
    page.workspace.update({ region: country, reports: [{ ...report("d", "water"), isSynthetic: true }], reportsReady: true, connectionFailed: true });
    assert.match(page.text("#report-chart-note"), /Includes 1 demonstration report\./);
    assert.match(page.text("#report-chart-note"), /last loaded reports/);
    page.choose("roads");
    assert.match(page.text("#analysis-report-chart"), /No reports match this problem/);
  } finally { page.workspace.destroy(); }
});

function setExpanded(page, category, expanded = true) {
  const row = page.query(`.priority-row[data-category="${category}"]`);
  // linkedom does not reflect the details.open property into its HTML attribute.
  row.open = expanded;
  row.toggleAttribute("open", expanded);
  row.dispatchEvent(new page.window.Event("toggle"));
  return row;
}
function fakeReportMaps() {
  const maps = [];
  return { maps, createReportMap(container, report) {
    const map = { container, report, destroyCount: 0, destroy() { this.destroyCount++; } };
    maps.push(map);
    return map;
  } };
}
const locatedReport = (id, category = "water", extra = {}) => ({ ...report(id, category), latitude: -1.2921, longitude: 36.8219, ...extra });

test("report maps load only after expansion and release maps on collapse, refresh, hiding and destruction", async () => {
  const factory = fakeReportMaps();
  const page = fixture({ createReportMap: factory.createReportMap });
  const oldObserver = page.window.IntersectionObserver;
  page.window.IntersectionObserver = undefined;
  const submitted = locatedReport("clinic", "medical");
  try {
    page.workspace.update({ region: country, reports: [submitted], reportsReady: true });
    page.workspace.setVisible(true); await tick();
    assert.equal(factory.maps.length, 0, "Collapsed reports must not initialize map instances");
    setExpanded(page, "healthcare");
    assert.equal(factory.maps.length, 1);
    assert.equal(factory.maps[0].container, page.query(".analysis-report-map"));
    assert.deepEqual([factory.maps[0].report.latitude, factory.maps[0].report.longitude], [-1.2921, 36.8219]);
    assert.equal(factory.maps[0].report.category, "healthcare", "Map icons receive the normalized problem category");
    assert.equal(submitted.category, "medical", "Rendering must not mutate the submitted report");
    setExpanded(page, "healthcare", false);
    assert.equal(factory.maps[0].destroyCount, 1);
    setExpanded(page, "healthcare");
    assert.equal(factory.maps.length, 2);
    page.workspace.update({ region: country, reports: [{ ...submitted, longitude: 36.9 }], reportsReady: true });
    assert.equal(factory.maps[1].destroyCount, 1, "Refreshing reports disposes the previous map");
    assert.equal(factory.maps.length, 3, "An expanded report receives a fresh map after refresh");
    assert.equal(factory.maps[2].report.longitude, 36.9);
    page.workspace.setVisible(false);
    assert.equal(factory.maps[2].destroyCount, 1);
    setExpanded(page, "healthcare");
    assert.equal(factory.maps.length, 3, "Toggle events while hidden cannot initialize maps");
    page.workspace.setVisible(true);
    assert.equal(factory.maps.length, 4);
    page.workspace.destroy();
    assert.deepEqual(factory.maps.map((map) => map.destroyCount), [1, 1, 1, 1]);
    setExpanded(page, "healthcare");
    assert.equal(factory.maps.length, 4, "Destroyed workspaces cannot recreate maps");
  } finally {
    page.workspace.destroy();
    if (oldObserver === undefined) delete page.window.IntersectionObserver;
    else page.window.IntersectionObserver = oldObserver;
  }
});

test("intersection observers defer report maps and stale callbacks cannot revive maps after view changes", async () => {
  const factory = fakeReportMaps();
  const observers = [];
  class FakeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnected = false; observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
    emit(target, isIntersecting = true) { this.callback([{ target, isIntersecting }]); }
  }
  const page = fixture({ createReportMap: factory.createReportMap });
  const oldObserver = page.window.IntersectionObserver;
  page.window.IntersectionObserver = FakeObserver;
  try {
    page.workspace.update({ region: country, reports: [locatedReport("a"), locatedReport("b", "healthcare")], reportsReady: true });
    page.workspace.setVisible(true); await tick();
    assert.equal(observers.length, 0, "Collapsed rows must not create visibility observers");
    setExpanded(page, "water");
    const waterObserver = observers.at(-1), waterContainer = page.query('.priority-row[data-category="water"] .analysis-report-map');
    assert.ok(waterObserver.targets.has(waterContainer));
    assert.equal(factory.maps.length, 0, "Expanded but offscreen report maps stay unloaded");
    waterObserver.emit(waterContainer, false);
    assert.equal(factory.maps.length, 0);
    waterObserver.emit(waterContainer);
    waterObserver.emit(waterContainer);
    assert.equal(factory.maps.length, 1, "Repeated visibility notifications cannot duplicate a map");
    assert.equal(waterObserver.targets.has(waterContainer), false);
    page.choose("healthcare");
    assert.equal(waterObserver.disconnected, true);
    assert.equal(factory.maps[0].destroyCount, 1);
    waterObserver.emit(waterContainer);
    assert.equal(factory.maps.length, 1, "A queued callback from the previous filter is ignored");

    setExpanded(page, "healthcare");
    const clinicObserver = observers.at(-1), clinicContainer = page.query(".analysis-report-map");
    clinicObserver.emit(clinicContainer);
    assert.equal(factory.maps.length, 2);
    page.workspace.update({ region: local, reports: [locatedReport("c", "healthcare")], reportsReady: true }); await tick();
    assert.equal(clinicObserver.disconnected, true);
    assert.equal(factory.maps[1].destroyCount, 1);
    clinicObserver.emit(clinicContainer);
    assert.equal(factory.maps.length, 2, "A queued callback from the previous region is ignored");

    setExpanded(page, "healthcare");
    const localObserver = observers.at(-1), localContainer = page.query(".analysis-report-map");
    localObserver.emit(localContainer);
    assert.equal(factory.maps.length, 3);
    setExpanded(page, "healthcare", false);
    assert.equal(localObserver.disconnected, true);
    assert.equal(factory.maps[2].destroyCount, 1);
    localObserver.emit(localContainer);
    assert.equal(factory.maps.length, 3, "Collapsed rows ignore queued visibility callbacks");

    setExpanded(page, "healthcare");
    const hiddenObserver = observers.at(-1);
    localObserver.emit(localContainer);
    assert.equal(factory.maps.length, 3, "A callback from before collapse cannot mount a reopened offscreen map");
    assert.ok(hiddenObserver.targets.has(localContainer), "The current observer still watches the reopened report");
    page.workspace.setVisible(false);
    assert.equal(hiddenObserver.disconnected, true);
    hiddenObserver.emit(localContainer);
    assert.equal(factory.maps.length, 3, "Hidden views ignore queued visibility callbacks");
    page.workspace.setVisible(true);
    const finalObserver = observers.at(-1), finalContainer = page.query(".analysis-report-map");
    finalObserver.emit(finalContainer);
    assert.equal(factory.maps.length, 4);
    page.workspace.destroy();
    assert.equal(finalObserver.disconnected, true);
    finalObserver.emit(finalContainer);
    assert.equal(factory.maps.length, 4, "Destroyed views ignore queued visibility callbacks");
    assert.deepEqual(factory.maps.map((map) => map.destroyCount), [1, 1, 1, 1]);
  } finally {
    page.workspace.destroy();
    if (oldObserver === undefined) delete page.window.IntersectionObserver;
    else page.window.IntersectionObserver = oldObserver;
  }
});

test("invalid locations and map failures preserve report text without substituting zero coordinates", async () => {
  const attempted = [];
  let destroyed = 0;
  const page = fixture({ createReportMap: (_, entry) => {
    attempted.push(entry);
    if (entry.id === "failed") throw new Error("Map failed to initialize");
    return { destroy() { destroyed++; } };
  } });
  const oldObserver = page.window.IntersectionObserver;
  page.window.IntersectionObserver = undefined;
  const submitted = [
    report("missing", "water", "Missing location report"),
    locatedReport("null", "water", { latitude: null, summary: "Null location report" }),
    locatedReport("text", "water", { longitude: "36.8", summary: "Text location report" }),
    locatedReport("infinite", "water", { latitude: Infinity, summary: "Infinite location report" }),
    locatedReport("outside", "water", { longitude: 181, summary: "Out-of-range location report" }),
    locatedReport("failed", "water", { summary: "Map failure report" }),
    locatedReport("valid", "water", { summary: "Valid location report" }),
  ];
  try {
    page.workspace.update({ region: country, reports: submitted, reportsReady: true });
    page.workspace.setVisible(true); await tick();
    assert.equal(page.query("#analysis-rankings").querySelectorAll(".analysis-map-unavailable").length, 5);
    assert.equal(page.query("#analysis-rankings").querySelectorAll(".analysis-report-map").length, 2);
    setExpanded(page, "water");
    assert.deepEqual(attempted.map((entry) => entry.id), ["failed", "valid"]);
    for (const entry of attempted) assert.deepEqual([entry.latitude, entry.longitude], [-1.2921, 36.8219]);
    assert.match(page.text("#analysis-rankings"), /Map unavailable/);
    for (const entry of submitted) assert.ok(page.text("#analysis-rankings").includes(entry.summary));
    page.workspace.destroy();
    assert.equal(destroyed, 1, "A failed map must not prevent a successful map from being disposed");
  } finally {
    page.workspace.destroy();
    if (oldObserver === undefined) delete page.window.IntersectionObserver;
    else page.window.IntersectionObserver = oldObserver;
  }
});

test("cancelled Analysis population work releases only its own loading token", async () => {
  const pending = [], active = new Set(); let sequence = 0;
  const page = fixture({
    loadEvidence: async () => ({ status: "unavailable", indicators: [] }),
    loadPopulation: (context, { signal }) => new Promise((resolve) => pending.push({ context, signal, resolve })),
    onLoading({ key }) { const token = `${key}:${++sequence}`; active.add(token); return () => active.delete(token); },
  });
  try {
    page.workspace.update({ region: country, reports: [locatedReport("first")], reportsReady: true });
    page.workspace.setVisible(true); await tick();
    assert.equal(pending.length, 1);
    assert.equal([...active].filter((token) => token.startsWith("analysis-population:")).length, 1);
    page.workspace.update({ region: local, reports: [locatedReport("second")], reportsReady: true });
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(pending.length, 2);
    assert.equal([...active].filter((token) => token.startsWith("analysis-population:")).length, 1);
    pending[0].resolve({ status: "ready", value: 1 }); await tick();
    assert.equal([...active].filter((token) => token.startsWith("analysis-population:")).length, 1, "a stale completion cannot clear the replacement request");
    pending[1].resolve({ status: "ready", value: 2, year: 2025, reportCount: 1 }); await tick();
    assert.equal([...active].filter((token) => token.startsWith("analysis-population:")).length, 0);
  } finally { page.workspace.destroy(); }
  assert.equal(active.size, 0);
});

test("hiding Analysis cancels evidence and AI work, releases loaders, and reloads on revisit", async () => {
  const evidenceRequests = [], aiRequests = [], active = new Set(); let sequence = 0;
  const abortable = (requests, signal) => new Promise((resolve, reject) => {
    const request = { signal, resolve, reject }; requests.push(request);
    signal.addEventListener("abort", () => {
      const error = new Error("cancelled"); error.name = "AbortError"; reject(error);
    }, { once: true });
  });
  const page = fixture({
    loadEvidence: (_, { signal }) => abortable(evidenceRequests, signal),
    reviewComplaints: (_, __, { signal }) => abortable(aiRequests, signal),
    onLoading({ key }) { const token = `${key}:${++sequence}`; active.add(token); return () => active.delete(token); },
  });
  try {
    page.workspace.update({ region: country, reports: [report("a", "water")], reportsReady: true });
    page.workspace.setVisible(true);
    await tick();
    assert.equal(evidenceRequests.length, 1); assert.equal(aiRequests.length, 0, "AI waits for cited public inputs");
    assert.equal([...active].filter((token) => /analysis-(?:evidence|ai):/.test(token)).length, 1);

    page.workspace.setVisible(false); await tick();
    assert.equal(evidenceRequests[0].signal.aborted, true);
    assert.equal([...active].filter((token) => /analysis-(?:evidence|ai):/.test(token)).length, 0);

    page.workspace.setVisible(true);
    await tick();
    assert.equal(evidenceRequests.length, 2); assert.equal(aiRequests.length, 0);
    evidenceRequests[1].resolve(evidence);
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(aiRequests.length, 1);
    assert.equal([...active].filter((token) => /analysis-(?:evidence|ai):/.test(token)).length, 1);
    page.workspace.setVisible(false); await tick();
    assert.equal(aiRequests[0].signal.aborted, true);
    assert.equal([...active].filter((token) => /analysis-(?:evidence|ai):/.test(token)).length, 0);

    page.workspace.setVisible(true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(aiRequests.length, 2);
    aiRequests[1].resolve({ insights: [], priorityReviews: [], reviewedCount: 1 });
    await tick();
    assert.equal([...active].filter((token) => /analysis-(?:evidence|ai):/.test(token)).length, 0);
  } finally { page.workspace.destroy(); }
  assert.equal(active.size, 0);
});

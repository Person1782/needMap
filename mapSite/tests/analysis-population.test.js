import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { createAnalysisWorkspace } from "../analysis-workspace.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const region = { id: "KE", countryCode: "KE", name: "Kenya", kind: "country" };
const reports = [
  { id: "water", category: "water", summary: "Water missing", latitude: -1.29, longitude: 36.82 },
  { id: "clinic", category: "medical", summary: "Clinic needed", latitude: -1.291, longitude: 36.821 },
];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(loadPopulation) {
  const { document, window } = parseHTML(html);
  const workspace = createAnalysisWorkspace({ document, loadPopulation, loadEvidence: async () => ({ status: "unavailable", indicators: [] }) });
  const text = () => document.querySelector("#analysis-population").textContent;
  const choose = (category) => { document.querySelector(`#analysis-category option[value="${category}"]`).selected = true; document.querySelector("#analysis-category").dispatchEvent(new window.Event("change")); };
  return { document, workspace, text, choose };
}
const result = (value, reportCount = 1) => ({ status: "ready", value, reportCount, year: 2025, radiusMeters: 500 });

test("population counts follow both filters, suppress stale requests, and update only the metric", async () => {
  const pending = [];
  const page = fixture((scope, { signal }) => new Promise((resolve) => pending.push({ scope, signal, resolve })));
  try {
    page.workspace.update({ region, reports, reportsReady: true });
    assert.equal(pending.length, 0, "No population requests on Map");
    page.workspace.setVisible(true); await tick();
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0].scope.reports.map((report) => report.id), ["water", "clinic"]);
    assert.match(page.text(), /Loading/);
    page.choose("healthcare");
    assert.equal(pending[0].signal.aborted, true);
    assert.deepEqual(pending[1].scope.reports.map((report) => report.id), ["clinic"]);
    const ranking = page.document.querySelector(".priority-row");
    pending[1].resolve(result(1234.56)); await tick();
    assert.match(page.text(), /About 1,200/);
    assert.match(page.text(), /500 m of 1 report · WorldPop 2025/);
    assert.match(page.text(), /not confirmed people affected/);
    assert.equal(page.document.querySelector(".priority-row"), ranking, "Population completion does not rebuild report maps");
    pending[0].resolve(result(99999, 2)); await tick();
    assert.doesNotMatch(page.text(), /100,000/);
    page.workspace.update({ region: { ...region, id: "KE-30", name: "Nairobi" }, reports, reportsReady: true });
    assert.match(page.text(), /Loading/);
    assert.equal(pending[2].scope.region.name, "Nairobi");
    pending[2].resolve(result(0)); await tick();
    assert.match(page.text(), /About 0/);
    page.choose("roads");
    assert.match(page.text(), /No reports/);
    assert.equal(pending.length, 3, "Empty selections do not consume API requests");
    page.choose("all");
    assert.deepEqual(pending[3].scope.reports.map((report) => report.id), ["water", "clinic"], "All Problems gets one combined estimate, not category totals added");
  } finally { page.workspace.destroy(); }
});

test("Healthcare population requests combine clinic and medication locations once while All Problems retains other categories", async () => {
  const calls = [];
  const page = fixture(async (scope) => { calls.push(scope); return result(1200, scope.reports.length); });
  const submitted = [
    { id: "clinic", category: "healthcare", summary: "Clinic needed", latitude: -1.29, longitude: 36.82 },
    { id: "pharmacy", category: "healthcare", summary: "Pharmacy has no medicine", latitude: -1.291, longitude: 36.821 },
    { id: "legacy", category: "medication_access", summary: "Prescription unavailable", latitude: -1.292, longitude: 36.822 },
    { id: "water", category: "water", summary: "Water missing", latitude: -1.293, longitude: 36.823 },
  ];
  const ids = (scope) => scope.reports.map((entry) => entry.id).sort();
  try {
    page.workspace.update({ region, reports: submitted, reportsReady: true });
    page.workspace.setVisible(true); await tick();
    assert.equal(calls.length, 1);
    assert.deepEqual(ids(calls[0]), ["clinic", "legacy", "pharmacy", "water"]);
    page.choose("healthcare"); await tick();
    assert.equal(calls.length, 2);
    assert.deepEqual(ids(calls[1]), ["clinic", "legacy", "pharmacy"], "Merged Healthcare uses one request containing every selected report exactly once");
    assert.deepEqual(calls[1].reports.map(({ latitude, longitude }) => [latitude, longitude]), submitted.slice(0, 3).map(({ latitude, longitude }) => [latitude, longitude]));
    assert.match(page.text(), /500 m of 3 reports/);
    assert.equal(calls[1].region.id, region.id);
    page.choose("all"); await tick();
    assert.equal(calls.length, 3);
    assert.deepEqual(ids(calls[2]), ["clinic", "legacy", "pharmacy", "water"]);
    assert.match(page.text(), /500 m of 4 reports/);
    page.choose("water"); await tick();
    assert.deepEqual(ids(calls[3]), ["water"], "Unrelated categories remain independently filterable");
    assert.equal(submitted[2].category, "medication_access", "Population filtering never rewrites stored reports");
  } finally { page.workspace.destroy(); }
});

test("loading, failure, changed coordinates and hidden/destroyed views cannot display an old population", async () => {
  const pending = [];
  const page = fixture((scope, { signal }) => new Promise((resolve, reject) => pending.push({ scope, signal, resolve, reject })));
  try {
    page.workspace.update({ region, reports: [], reportsReady: false }); page.workspace.setVisible(true);
    assert.match(page.text(), /Unknown/); assert.equal(pending.length, 0);
    page.workspace.update({ region, reports, reportsReady: true });
    page.workspace.setVisible(false);
    assert.equal(pending[0].signal.aborted, true);
    pending[0].resolve(result(200)); await tick();
    page.workspace.setVisible(true); assert.equal(pending.length, 2);
    pending[1].reject(new Error("Offline")); await tick();
    assert.match(page.text(), /Unavailable/); assert.doesNotMatch(page.text(), /About 0/);
    page.workspace.update({ region, reports: reports.map((report) => ({ ...report, longitude: 36.9 })), reportsReady: true });
    assert.equal(pending.length, 3);
    assert.match(page.text(), /Loading/);
    page.workspace.destroy();
    assert.equal(pending[2].signal.aborted, true);
    const before = page.text(); pending[2].resolve(result(9999)); await tick();
    assert.equal(page.text(), before);
  } finally { page.workspace.destroy(); }
});

test("population details open only on click, update while loading, and close when scope changes", async () => {
  let resolve;
  const page = fixture(() => new Promise((done) => { resolve = done; }));
  try {
    page.workspace.update({ region, reports, reportsReady: true }); page.workspace.setVisible(true);
    assert.equal(page.document.querySelector(".population-dialog"), null);
    page.document.querySelector("#analysis-population").click();
    assert.match(page.document.querySelector(".population-dialog").textContent, /still being calculated/);
    resolve({ ...result(1234, 2), areaKm2: 1.1, geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] } }); await tick();
    const dialog = page.document.querySelector(".population-dialog");
    assert.match(dialog.textContent, /About 1,200 residents/);
    assert.match(dialog.textContent, /All Problems/);
    assert.match(dialog.textContent, /Sources for this calculation/);
    page.choose("healthcare");
    assert.equal(page.document.querySelector(".population-dialog"), null);
    page.document.querySelector("#analysis-population").click();
    assert.match(page.document.querySelector(".population-dialog").textContent, /Healthcare/);
    page.workspace.setVisible(false);
    assert.equal(page.document.querySelector(".population-dialog"), null);
  } finally { page.workspace.destroy(); }
});

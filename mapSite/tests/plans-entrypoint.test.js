import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { createPlansWorkspace } from "../plans-workspace.js";
import { regionContains } from "../region-navigation.js";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = app.indexOf("const plansWorkspace = createPlansWorkspace(");
const end = app.indexOf("planCostLoader = createPlanLocalCostLoader(", start);
assert.ok(start >= 0 && end > start, "The Plans entry point must be available");

test("the dashboard includes legacy-flagged reports in Plans while retaining region and minimum-support filters", () => {
  const { document } = parseHTML(html);
  const region = {
    id: "test-region", name: "Test region", kind: "state", countryCode: "US",
    geometry: { type: "Polygon", coordinates: [
      [[-123, 36], [-121, 36], [-121, 38], [-123, 38], [-123, 36]],
    ] },
  };
  const report = (id, longitude) => ({
    id, latitude: 37, longitude, category: "healthcare", severity: "medium",
    summary: "Hospital access is limited", isSynthetic: true,
  });
  const reports = [report("inside-a", -122), report("inside-b", -122.01), report("outside", -100)];
  const before = structuredClone(reports);
  const context = {
    document, reports, selectedRegion: region, reportsReady: true, connectionFailed: false,
    i18n: undefined, dynamicTranslator: undefined, onLoading: undefined,
    L: {}, planCostLoader: undefined, regionContains,
    buildPlanBenchmarkEvidence: () => null,
    createPlansLocationMap: () => ({ update() {}, destroy() {} }),
    createPlansWorkspace: (options) => createPlansWorkspace({
      ...options, document, loadPopulation: async () => ({ status: "unavailable" }),
    }),
  };
  // Exercise the actual dashboard wiring, filtering, model, and DOM renderer
  // without starting the unrelated Firebase subscription or external services.
  vm.runInNewContext(`${app.slice(start, end)}
    this.update = updatePlans;
    this.workspace = plansWorkspace;`, context);
  try {
    context.update();
    assert.equal(document.querySelectorAll(".plan-card").length, 1);
    assert.equal(document.querySelectorAll(".plan-report").length, 2);
    assert.deepEqual(reports, before, "The source flags and reports stay unchanged");

    context.reports = [reports[0], reports[2]];
    context.update();
    assert.equal(document.querySelectorAll(".plan-card").length, 0);
    assert.match(document.getElementById("plans-status").textContent, /Matching reports: 1\./);
    assert.match(document.getElementById("plans-results").textContent, /At least two usable reports/);
  } finally {
    context.workspace.destroy();
  }
});

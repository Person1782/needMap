import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { createPlansWorkspace } from "../plans-workspace.js";
import { buildPlanBenchmarkEvidence } from "../plans-benchmarks.js";
import arabicMessages from "../i18n/locales/ar.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const region = {
  id: "US-CA", name: "California", label: "California, United States", countryCode: "US", kind: "state",
  geometry: { type: "Polygon", coordinates: [[[-123, 36], [-121, 36], [-121, 38], [-123, 38], [-123, 36]]] },
  bounds: [[36, -123], [38, -121]],
};
const report = (id, latitude, longitude, summary = "Water supply fails every week") => ({
  id, latitude, longitude, summary, category: "water", severity: "high",
  region: { id: `local-${id}`, name: id === "a" ? "West County" : "East County", hierarchy: "California", geometry: region.geometry },
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function localizedI18n(code, messages) {
  return {
    code,
    t(key, values = {}) {
      return String(messages[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
    },
    number(value, options) { return Number(value).toLocaleString(code, options); },
    subscribe() { return () => {}; },
  };
}

function select(window, element, value) {
  for (const option of element.options) option.removeAttribute("selected");
  [...element.options].find((option) => option.value === value).setAttribute("selected", "");
  element.dispatchEvent(new window.Event("change"));
}

test("Plans exposes exact infrastructure choices, renders sourced recommendations, maps, report links, and potential residents", async () => {
  const { document, window } = parseHTML(html);
  const mapUpdates = [];
  let mapsCreated = 0, mapsDestroyed = 0, populationCalls = 0;
  const workspace = createPlansWorkspace({
    document,
    evidenceFor(type, selectedRegion) {
      const evidence = buildPlanBenchmarkEvidence(type, { region: selectedRegion });
      return evidence ? [evidence] : [];
    },
    createLocationMap() {
      mapsCreated += 1;
      return { update(context) { mapUpdates.push(context); }, destroy() { mapsDestroyed += 1; } };
    },
    async loadPopulation({ radiusMeters }) {
      populationCalls += 1;
      return { status: "ready", value: 1234, year: 2025, radiusMeters };
    },
  });
  try {
    const type = document.getElementById("plans-type");
    assert.equal(type.options.length, 12);
    assert.equal([...type.options].some((option) => option.value === "all"), false);
    select(window, type, "water_facility");
    workspace.update({ region, reports: [report("a", 37, -122.1), report("b", 37.02, -122)], reportsReady: true });
    assert.equal(mapsCreated, 0, "hidden Plans does not mount maps");
    assert.equal(populationCalls, 0, "hidden Plans does not start population requests");

    workspace.setVisible(true);
    await tick(); await tick();
    const cards = document.querySelectorAll(".plan-card");
    assert.equal(cards.length, 1);
    assert.equal(mapsCreated >= 1, true);
    assert.equal(mapUpdates.at(-1).geometry.type, "MultiPolygon");
    assert.equal(mapUpdates.at(-1).candidate.supportingReports.length, 2);
    assert.equal(populationCalls, 1);
    assert.match(cards[0].textContent, /Estimated cost/);
    assert.match(cards[0].textContent, /Estimated completion time/);
    assert.match(cards[0].textContent, /11\.6–17\.4 months/);
    assert.match(cards[0].textContent, /About 1,200/);
    assert.match(cards[0].textContent, /Sources and what they support/);
    assert.match(cards[0].textContent, /DoD Facilities Pricing Guide/);
    assert.match(cards[0].textContent, /Construction Length of Time Statistics/);
    const reportLinks = cards[0].querySelectorAll('.plan-report a[href^="#analysis?"]');
    assert.equal(reportLinks.length, 2);
    assert.ok([...reportLinks].every((link) => link.href.includes("category=water") && link.href.includes("report=")));

    select(window, type, "hospital");
    await tick();
    assert.equal(document.querySelectorAll(".plan-card").length, 0);
    assert.match(document.getElementById("plans-results").textContent, /No Hospitals reports/);
  } finally { workspace.destroy(); }
  assert.equal(mapsDestroyed, mapsCreated);
});

test("Plans never creates a recommendation from one report and never fabricates an Other estimate", async () => {
  const { document, window } = parseHTML(html);
  const workspace = createPlansWorkspace({
    document,
    evidenceFor(type, selectedRegion) {
      const evidence = buildPlanBenchmarkEvidence(type, { region: selectedRegion });
      return evidence ? [evidence] : [];
    },
    createLocationMap: () => ({ update() {}, destroy() {} }),
    loadPopulation: async () => ({ status: "unavailable" }),
  });
  try {
    const type = document.getElementById("plans-type");
    select(window, type, "water_facility");
    workspace.update({ region, reports: [report("only", 37, -122)], reportsReady: true });
    workspace.setVisible(true);
    assert.equal(document.querySelectorAll(".plan-card").length, 0);
    assert.match(document.getElementById("plans-results").textContent, /At least two usable reports/);

    select(window, type, "other");
    workspace.update({ region, reports: [
      { ...report("x", 37, -122, "Community building needed"), category: "other" },
      { ...report("y", 37.01, -122.01, "Community building needed"), category: "other" },
    ], reportsReady: true });
    assert.equal(document.querySelectorAll(".plan-card").length, 1);
    const estimates = document.querySelector(".plan-estimates").textContent;
    assert.equal((estimates.match(/Supported estimate unavailable/g) || []).length, 2);
  } finally { workspace.destroy(); }
});

test("Plans translates dynamic estimate explanations instead of leaking English evidence prose", async () => {
  const { document, window } = parseHTML(html);
  const i18n = localizedI18n("ar", arabicMessages);
  const localCostAdjustment = {
    multiplier: 0.75,
    geography: "Test national price level",
    method: "World Bank price level index divided by 100",
    source: {
      title: "Price level index (GDP)", publisher: "World Bank, World Development Indicators",
      year: 2024, url: "https://data.worldbank.org/indicator/PA.NUS.GDP.PLI?locations=US",
      usedFor: "Country price-level adjustment for the base cost.",
    },
  };
  const workspace = createPlansWorkspace({
    document, i18n,
    evidenceFor(type, selectedRegion) {
      const evidence = buildPlanBenchmarkEvidence(type, {
        region: selectedRegion,
        localCostAdjustment: selectedRegion?.id ? localCostAdjustment : null,
      });
      return evidence ? [evidence] : [];
    },
    createLocationMap: () => ({ update() {}, destroy() {} }),
    loadPopulation: async () => ({ status: "ready", value: 1234, year: 2025 }),
  });
  try {
    select(window, document.getElementById("plans-type"), "water_facility");
    workspace.update({ region, reports: [report("a", 37, -122.1), report("b", 37.02, -122)], reportsReady: true });
    workspace.setVisible(true);
    await tick(); await tick();
    const text = document.querySelector(".plan-card").textContent;
    for (const key of ["plans.sourceCost", "plans.sourceTime", "plans.sourceLocal", "plans.sourcePopulation", "plans.calculationSummary"]) {
      assert.match(text, new RegExp(arabicMessages[key].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), key);
    }
    assert.match(text, /التكلفة والمدة نطاقان أوليان/);
    for (const english of ["The shaded radius", "A preliminary facility", "NeedMap takes the lowest", "Used for:", "This is a national economy-wide"]) {
      assert.doesNotMatch(text, new RegExp(english), english);
    }
  } finally { workspace.destroy(); }
});

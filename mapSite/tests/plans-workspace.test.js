import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { createPlansWorkspace } from "../plans-workspace.js";
import { buildPlanBenchmarkEvidence } from "../plans-benchmarks.js";
import arabicMessages from "../i18n/locales/ar.js";
import englishMessages from "../i18n/locales/en.js";

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

test("Plans connects each map container before creating and updating its map", () => {
  const { document, window } = parseHTML(html);
  let created = 0, updated = 0, destroyed = 0;
  const workspace = createPlansWorkspace({
    document,
    evidenceFor(type, selectedRegion) {
      const evidence = buildPlanBenchmarkEvidence(type, { region: selectedRegion });
      return evidence ? [evidence] : [];
    },
    createLocationMap(container) {
      created += 1;
      assert.equal(container.isConnected, true, "Leaflet must measure an attached map container");
      return {
        update() {
          updated += 1;
          assert.equal(container.isConnected, true, "the initial viewport fit must run after attachment");
        },
        destroy() { destroyed += 1; },
      };
    },
    loadPopulation: async () => ({ status: "unavailable" }),
  });
  try {
    select(window, document.getElementById("plans-type"), "water_facility");
    workspace.update({
      region,
      reports: [report("a", 37, -122.1), report("b", 37.02, -122)],
      reportsReady: true,
    });
    workspace.setVisible(true);
    assert.equal(created, 1);
    assert.equal(updated, 1);
  } finally { workspace.destroy(); }
  assert.equal(destroyed, created);
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

test("Plans keeps insufficient-support states localized without demo labels or unnecessary map and population requests", () => {
  for (const [code, messages] of [["en", englishMessages], ["ar", arabicMessages]]) {
    const { document, window } = parseHTML(html);
    const i18n = localizedI18n(code, messages);
    let mapsCreated = 0, populationCalls = 0;
    const workspace = createPlansWorkspace({
      document, i18n,
      createLocationMap() { mapsCreated += 1; return { update() {}, destroy() {} }; },
      async loadPopulation() { populationCalls += 1; return { status: "unavailable" }; },
    });
    try {
      select(window, document.getElementById("plans-type"), "water_facility");
      const reports = [report("a", 37, -122.1), report("b", 37.02, -122)]
        .map((item) => ({ ...item, isSynthetic: true }));
      workspace.update({ region, reports, reportsReady: true });
      workspace.setVisible(true);
      assert.equal(document.querySelectorAll(".plan-card").length, 0);
      assert.equal(document.getElementById("plans-results").textContent.includes(
        i18n.t("analysis.demoWarning", { count: i18n.number(2) })), false, code);
      assert.ok(document.getElementById("plans-results").textContent.includes(i18n.t("plans.needTwoReports")), code);

      workspace.update({ region, reports: [{ ...reports[0], isSynthetic: false }, reports[1]], reportsReady: true });
      assert.equal(document.querySelectorAll(".plan-card").length, 0, "One real report plus a demo does not support a plan");
      assert.equal(document.getElementById("plans-results").textContent.includes(
        i18n.t("analysis.demoWarning", { count: i18n.number(1) })), false, code);
      assert.ok(document.getElementById("plans-results").textContent.includes(i18n.t("plans.needTwoReports")), code);
      assert.equal(mapsCreated, 0);
      assert.equal(populationCalls, 0);
    } finally { workspace.destroy(); }
  }
});

test("a provenance-only update removes an unsupported plan and cancels its pending population estimate", async () => {
  const { document, window } = parseHTML(html);
  let populationSignal, finishPopulation, calls = 0;
  const workspace = createPlansWorkspace({
    document,
    createLocationMap: () => ({ update() {}, destroy() {} }),
    loadPopulation(context, { signal }) {
      calls += 1; populationSignal = signal;
      return new Promise((resolve) => { finishPopulation = resolve; });
    },
  });
  try {
    select(window, document.getElementById("plans-type"), "water_facility");
    const reports = [report("a", 37, -122.1), report("b", 37.02, -122)];
    workspace.update({ region, reports, reportsReady: true });
    workspace.setVisible(true);
    assert.equal(document.querySelectorAll(".plan-card").length, 1);
    assert.equal(calls, 1);
    workspace.update({ region, reports: reports.map((item) => ({ ...item, isSynthetic: true })), reportsReady: true });
    assert.equal(populationSignal.aborted, true);
    assert.equal(document.querySelectorAll(".plan-card").length, 0);
    assert.equal(calls, 1);
    finishPopulation({ status: "ready", value: 1234, year: 2025 });
    await tick();
    assert.equal(document.querySelectorAll(".plan-card").length, 0, "Late population results cannot restore a rejected plan");
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

test("Plans population loading tokens survive stale completions and clear on cancellation", async () => {
  const { document, window } = parseHTML(html);
  const pending = [], active = new Set(); let sequence = 0;
  const workspace = createPlansWorkspace({
    document,
    evidenceFor(type, selectedRegion) { const evidence = buildPlanBenchmarkEvidence(type, { region: selectedRegion }); return evidence ? [evidence] : []; },
    createLocationMap: () => ({ update() {}, destroy() {} }),
    loadPopulation(context, { signal }) { return new Promise((resolve) => pending.push({ context, signal, resolve })); },
    onLoading({ key }) { const token = `${key}:${++sequence}`; active.add(token); return () => active.delete(token); },
  });
  try {
    select(window, document.getElementById("plans-type"), "water_facility");
    workspace.update({ region, reports: [report("a", 37, -122.1), report("b", 37.02, -122)], reportsReady: true });
    workspace.setVisible(true);
    assert.equal(pending.length, 1);
    assert.equal(active.size, 1);
    workspace.update({ region: { ...region, id: "US-CA-2", name: "New region" }, reports: [report("c", 37, -122.1), report("d", 37.02, -122)], reportsReady: true });
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(pending.length, 2);
    assert.equal(active.size, 1);
    pending[0].resolve({ status: "ready", value: 1 }); await tick();
    assert.equal(active.size, 1);
    workspace.setVisible(false);
    assert.equal(pending[1].signal.aborted, true);
    assert.equal(active.size, 0);
  } finally { workspace.destroy(); }
});

test("each Plans population bar stays with its loading benefit card through partial completion and translation", async () => {
  const { document, window } = parseHTML(html);
  const pending = [], activities = [];
  let languageListener = () => {};
  const i18n = localizedI18n("en", englishMessages);
  i18n.subscribe = (listener) => { languageListener = listener; return () => { languageListener = () => {}; }; };
  const workspace = createPlansWorkspace({
    document,
    i18n,
    evidenceFor(type, selectedRegion) { const evidence = buildPlanBenchmarkEvidence(type, { region: selectedRegion }); return evidence ? [evidence] : []; },
    createLocationMap: () => ({ update() {}, destroy() {} }),
    loadPopulation(context, { signal }) { return new Promise((resolve) => pending.push({ context, signal, resolve })); },
    onLoading(options) {
      const activity = { ...options, released: false };
      activities.push(activity);
      return () => { activity.released = true; };
    },
  });
  const clustered = [
    report("a", 36.3, -122.7), report("b", 36.31, -122.69),
    report("c", 37.6, -121.3), report("d", 37.61, -121.29),
  ];
  const activePopulation = () => activities.filter((activity) => activity.key === "plans-population" && !activity.released);
  try {
    select(window, document.getElementById("plans-type"), "water_facility");
    workspace.update({ region, reports: clustered, reportsReady: true });
    workspace.setVisible(true);
    assert.equal(pending.length, 2);
    assert.deepEqual(activePopulation().map((activity) => activity.target.id), ["plan-benefit-1", "plan-benefit-2"]);
    for (const activity of activePopulation()) {
      assert.equal(activity.target.isConnected, true);
      assert.ok(activity.target.querySelector(`[data-loading-for="${activity.target.id}"]`));
      assert.match(activity.target.textContent, /Loading/);
    }

    pending[0].resolve({ status: "ready", value: 1200, year: 2025 }); await tick();
    assert.equal(activePopulation().length, 2, "a fast candidate keeps its bar until its loading card is rerendered");
    assert.match(document.getElementById("plan-benefit-1").textContent, /Loading/);

    const oldTargets = activePopulation().map((activity) => activity.target);
    languageListener();
    assert.equal(activePopulation().length, 1);
    assert.equal(activePopulation()[0].target.id, "plan-benefit-2");
    assert.equal(activePopulation()[0].target, document.getElementById("plan-benefit-2"));
    assert.equal(activePopulation()[0].target.isConnected, true);
    assert.notEqual(activePopulation()[0].target, oldTargets[1]);
    assert.match(document.getElementById("plan-benefit-1").textContent, /About 1,200/);
    assert.match(document.getElementById("plan-benefit-2").textContent, /Loading/);

    pending[1].resolve({ status: "ready", value: 2400, year: 2025 }); await tick();
    assert.equal(activePopulation().length, 0);
    assert.match(document.getElementById("plan-benefit-2").textContent, /About 2,400/);
  } finally { workspace.destroy(); }
});

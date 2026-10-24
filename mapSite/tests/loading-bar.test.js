import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createLoadingBar } from "../loading-bar.js";
import { trackLeafletTileLayer } from "../leaflet-loading.js";

function fixture(markup = '<div id="surface"></div>', options = {}) {
  const { document } = parseHTML(`<body>${markup}</body>`);
  const surface = document.getElementById("surface");
  const bar = createLoadingBar({ document, defaultTarget: surface, minimumVisibleMs: 0, ...options });
  return { document, surface, bar };
}

test("concurrent work on one surface keeps its contextual card until every token releases", () => {
  const { surface, bar } = fixture();
  const first = bar.start("population", "Loading population…");
  const second = bar.start("population", "Refreshing population…");
  const panel = surface.querySelector(".context-loading-card");
  assert.ok(panel.classList.contains("is-loading"));
  assert.equal(bar.activeCount, 2);
  assert.equal(panel.querySelector(".context-loading-label").textContent, "Refreshing population…");
  assert.equal(surface.getAttribute("aria-busy"), "true");
  first(); first();
  assert.ok(panel.classList.contains("is-loading"), "an older release cannot hide newer work with the same key");
  second();
  assert.ok(!panel.classList.contains("is-loading"));
  assert.equal(surface.hasAttribute("aria-busy"), false);
});

test("different loading surfaces remain visible independently", () => {
  const { document, bar } = fixture('<div id="surface"></div><div id="second"></div>');
  const first = bar.start("reports", "Loading reports…", { target: "#surface" });
  const second = bar.start("map", "Loading map…", { target: "#second", appearance: "map" });
  assert.ok(document.querySelector("#surface .context-loading").classList.contains("is-loading"));
  assert.ok(document.querySelector("#second .context-loading").classList.contains("is-loading"));
  first();
  assert.ok(!document.querySelector("#surface .context-loading").classList.contains("is-loading"));
  assert.ok(document.querySelector("#second .context-loading").classList.contains("is-loading"));
  second();
});

test("reserved status slots put progress under the live text without adding another live label", () => {
  const markup = '<div id="stack"><span id="surface" role="status">Connecting…</span><span data-loading-for="surface" class="context-loading-slot" aria-hidden="true"></span></div>';
  const { document, surface, bar } = fixture(markup);
  const stop = bar.start("reports", "Connecting…", { target: surface, appearance: "status" });
  const slot = document.querySelector('[data-loading-for="surface"]');
  assert.ok(slot.classList.contains("is-loading"));
  assert.equal(slot.querySelector(".context-loading-label").hidden, true);
  assert.equal(slot.querySelector('[role="status"]'), null);
  assert.equal(slot.querySelector('[role="progressbar"]').getAttribute("aria-label"), "Connecting…");
  assert.equal(document.getElementById("stack").getAttribute("aria-busy"), "true");
  assert.equal(surface.hasAttribute("aria-busy"), false, "the live status itself must remain announceable");
  stop();
  assert.ok(!slot.classList.contains("is-loading"));
});

test("a dynamic metric keeps busy state on its non-live card and announces its value separately", () => {
  const markup = '<button id="surface"><strong role="status" aria-live="polite">Loading…</strong><span data-loading-for="surface" class="context-loading-slot" aria-hidden="true"></span></button>';
  const { surface, bar } = fixture(markup);
  const stop = bar.start("population", "Estimating residents…", { target: surface, appearance: "status" });
  assert.equal(surface.getAttribute("aria-busy"), "true");
  assert.equal(surface.hasAttribute("aria-live"), false);
  assert.equal(surface.querySelector("strong").getAttribute("aria-live"), "polite");
  assert.equal(surface.querySelector('[role="progressbar"]').getAttribute("aria-label"), "Estimating residents…");
  stop();
  assert.equal(surface.hasAttribute("aria-busy"), false);
});

test("map cards expose a visible live label and label the progressbar with it", () => {
  const { surface, bar } = fixture();
  const stop = bar.start("tiles", "Loading map…", { appearance: "map" });
  const label = surface.querySelector(".context-loading-label");
  const progress = surface.querySelector('[role="progressbar"]');
  assert.equal(label.getAttribute("role"), "status");
  assert.equal(label.getAttribute("aria-live"), "polite");
  assert.equal(label.hidden, false);
  assert.equal(progress.getAttribute("aria-labelledby"), label.id);
  stop();
});

test("a rerendered map container receives a fresh card instead of retaining a detached one", () => {
  const { surface, bar } = fixture();
  const first = bar.start("tiles", "Loading map…", { appearance: "map" });
  const oldPanel = surface.querySelector(".context-loading-card");
  first();
  surface.replaceChildren();
  const second = bar.start("tiles", "Loading the new map…", { appearance: "map" });
  const newPanel = surface.querySelector(".context-loading-card");
  assert.ok(newPanel);
  assert.notEqual(newPanel, oldPanel);
  assert.equal(newPanel.querySelector(".context-loading-label").textContent, "Loading the new map…");
  second();
});

test("keyed state is idempotent and initial work uses its contextual target", () => {
  const { document } = parseHTML('<body><div id="surface"></div><div id="second"></div></body>');
  const bar = createLoadingBar({ document, initialKey: "boot", initialTarget: "#surface", minimumVisibleMs: 0 });
  assert.equal(bar.activeCount, 1);
  assert.ok(document.querySelector("#surface .context-loading").classList.contains("is-loading"));
  bar.set("region", true, "Opening region…", { target: "#second" });
  bar.set("region", true, "Still opening region…", { target: "#second" });
  assert.equal(bar.activeCount, 2);
  bar.finish("boot");
  assert.ok(document.querySelector("#second .context-loading").classList.contains("is-loading"));
  bar.finish("region");
  assert.ok(!document.querySelector("#second .context-loading").classList.contains("is-loading"));
  bar.destroy(); bar.finish("region");
});

test("a cancelled delayed tile request never creates or flashes a card", () => {
  const callbacks = new Map(); let nextTimer = 0;
  const { surface, bar } = fixture(undefined, {
    setTimer(callback) { callbacks.set(++nextTimer, callback); return nextTimer; },
    clearTimer(id) { callbacks.delete(id); },
  });
  const stop = bar.start("tiles", "Loading map…", { delayMs: 80, appearance: "map" });
  assert.equal(surface.querySelector(".context-loading"), null);
  stop();
  for (const callback of callbacks.values()) callback();
  assert.equal(surface.querySelector(".context-loading"), null);
  assert.equal(bar.activeCount, 0);
});

test("Leaflet tile cycles use the exact map container and release without leaking listeners", () => {
  const listeners = new Map();
  const layer = {
    on(type, callback) { listeners.set(type, callback); },
    off(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
  };
  const target = {};
  let starts = 0, stops = 0, received;
  const dispose = trackLeafletTileLayer(layer, { target, onLoading(options) {
    starts++; received = options; let stopped = false;
    return () => { if (!stopped) { stopped = true; stops++; } };
  } });
  listeners.get("loading")(); listeners.get("loading")();
  assert.equal(starts, 1);
  assert.equal(received.target, target);
  assert.equal(received.appearance, "map");
  assert.equal(received.delayMs, 80);
  listeners.get("load")();
  assert.equal(stops, 1);
  listeners.get("loading")();
  assert.equal(starts, 2);
  dispose(); dispose();
  assert.equal(stops, 2);
  assert.equal(listeners.size, 0);
});

test("each Leaflet tile cycle resolves its label in the currently selected language", () => {
  const listeners = new Map();
  const layer = {
    on(type, callback) { listeners.set(type, callback); },
    off(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
  };
  let language = "English";
  const labels = [];
  const dispose = trackLeafletTileLayer(layer, {
    label: () => `${language} map`,
    onLoading({ label }) { labels.push(label); return () => {}; },
  });
  listeners.get("loading")(); listeners.get("load")();
  language = "Español";
  listeners.get("loading")(); listeners.get("load")();
  assert.deepEqual(labels, ["English map", "Español map"]);
  dispose();
});

test("every Leaflet map sends tile progress to its own exact container", async () => {
  const files = ["app.js", "analysis-overview-map.js", "population-area-map.js", "report-location-map.js", "plans-location-map.js"];
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /trackLeafletTileLayer\([^\n]+label:\s*\(\)\s*=>[^\n]+target:/, file);
  }
});

test("dashboard markup uses contextual slots and no fixed global loading strip", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="global-loading"|class="global-loading/);
  for (const id of ["status", "region-status", "language-search-status", "analysis-status", "analysis-ai-status", "plans-status"]) {
    assert.match(html, new RegExp(`data-loading-for="${id}"`), id);
  }
  const [analysis, plans] = await Promise.all([
    readFile(new URL("../analysis-workspace.js", import.meta.url), "utf8"),
    readFile(new URL("../plans-workspace.js", import.meta.url), "utf8"),
  ]);
  assert.match(analysis, /loadingSlot\.dataset\.loadingFor\s*=\s*result\.id/);
  assert.match(plans, /loadingSlot\.dataset\.loadingFor\s*=\s*box\.id/);
});

test("manual language loading uses the open language-menu status while automatic loading stays by the top control", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(source, /key\s*===\s*"language"\s*&&\s*source\s*===\s*"manual"/);
  assert.match(source, /manualLanguageStatus\.textContent\s*=\s*resolvedLabel/);
  assert.match(source, /manualLanguageStatus\s*\|\|\s*loadingTargetSelectors\[key\]/);
});

test("Plans local-cost loading updates the visible Plans status before attaching its bar", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(source, /#plans-status"\)\.textContent\s*=\s*label;[\s\S]{0,180}target:\s*\$\("#plans-status"\)/);
});

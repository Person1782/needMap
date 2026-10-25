import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createPopulationDetails } from "../population-details.js";

const geometry = { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };
const population = { status: "ready", value: 1234.56, areaKm2: 1.4, radiusMeters: 500, reportCount: 3,
  year: 2025, geometry, dataset: "worldpop_R2025A_2025_100m", retrievedAt: "2026-10-22T10:00:00Z",
  taskUrl: "https://api.worldpop.org/v2/tasks/5f4280c3-7af9-4f79-93c8-20da95313887",
  components: [{ index: 0, population: 1000, areaKm2: 1 }, { index: 1, population: 234.56, areaKm2: 0.4 }] };
const context = { population, reports: [{ id: "a", latitude: 0, longitude: 0 }], region: { label: "Selected region" }, category: "Water supply" };
function setup({ failMap = false, dynamicTranslator } = {}) {
  const { document, window } = parseHTML('<html><body><button id="trigger">Estimate</button></body></html>');
  let active = document.body;
  Object.defineProperty(document, "activeElement", { get: () => active });
  window.HTMLElement.prototype.focus = function () { active = this; };
  const trigger = document.getElementById("trigger"); trigger.focus();
  const calls = [];
  const controller = createPopulationDetails({ document, dynamicTranslator, createMap(container, options) {
    const call = { container, options, destroyed: 0 }; calls.push(call);
    if (failMap) throw new Error("Tiles unavailable");
    return { destroy() { call.destroyed++; } };
  } });
  return { document, window, calls, trigger, controller };
}

test("only opens on request and shows the actual area, arithmetic, underlying values and exact source", () => {
  const { document, calls, controller, trigger } = setup();
  assert.equal(document.querySelector("dialog"), null);
  controller.open(context);
  const dialog = document.querySelector("dialog");
  assert.ok(dialog.hasAttribute("open"));
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.geometry, geometry);
  assert.equal(calls[0].options.reports, context.reports);
  const content = dialog.textContent;
  assert.match(content, /About 1,200 residents/);
  assert.match(content, /1,234.56 residents/);
  assert.match(content, /500-meter/);
  assert.match(content, /1.4 km²/);
  assert.match(content, /not population density/);
  assert.match(content, /does not confirm/);
  assert.equal(dialog.querySelectorAll(".population-steps li").length, 3);
  assert.equal(dialog.querySelectorAll(".population-pockets li").length, 2);
  assert.equal(dialog.querySelector(".population-pocket-track span").style.width, "100%");
  assert.ok([...dialog.querySelectorAll("a")].some((link) => link.href === population.taskUrl));
  assert.match(content, /2025 population dataset/);
  assert.match(content, /Oct 22, 2026/);
  assert.equal(document.activeElement.textContent, "Close");
  dialog.querySelector("button").click();
  assert.equal(document.querySelector("dialog"), null);
  assert.equal(calls[0].destroyed, 1);
  assert.equal(document.activeElement, trigger);
  controller.close(); controller.destroy();
  assert.equal(calls[0].destroyed, 1);
});

test("loading details update when ready, close via Escape, backdrop or native cancel, and release every map", () => {
  const { document, window, calls, controller } = setup();
  controller.update(context);
  assert.equal(document.querySelector("dialog"), null);
  controller.open({ ...context, population: { status: "loading" } });
  assert.match(document.querySelector("dialog").textContent, /details will appear here/);
  assert.equal(calls.length, 0);
  controller.update(context);
  assert.equal(calls.length, 1);
  const escape = new window.Event("keydown", { cancelable: true }); escape.key = "Escape";
  document.dispatchEvent(escape);
  assert.equal(document.querySelector("dialog"), null);
  assert.equal(calls[0].destroyed, 1);
  controller.open(context); document.querySelector("dialog").click();
  assert.equal(calls[1].destroyed, 1);
  controller.open(context); document.querySelector("dialog").dispatchEvent(new window.Event("cancel", { cancelable: true }));
  assert.equal(calls[2].destroyed, 1);
  controller.destroy(); controller.open(context);
  assert.equal(document.querySelector("dialog"), null);
});

test("keeps unavailable and true zero distinct, handles map failure and does not build unsafe source links", () => {
  const { document, calls, controller } = setup({ failMap: true });
  controller.open({ ...context, population: { status: "unavailable", message: "Coverage unavailable." } });
  assert.match(document.querySelector("dialog").textContent, /Coverage unavailable/);
  assert.equal(document.querySelector(".population-result"), null);
  assert.equal(calls.length, 0);
  controller.open({ ...context, population: { ...population, value: 0, components: [], taskUrl: "https://evil.example/" }, reports: [{ isSynthetic: true }] });
  assert.match(document.querySelector("dialog").textContent, /About 0 residents/);
  assert.ok(document.querySelector("[data-population-area-fallback] path"), "The real calculation area remains visible if Leaflet fails");
  assert.doesNotMatch(document.querySelector("dialog").textContent, /area map is unavailable/);
  assert.doesNotMatch(document.querySelector("dialog").textContent, /demonstration reports/);
  assert.match(document.querySelector("dialog").textContent, /not a measured impact boundary/);
  assert.equal(document.querySelector("a[href='https://evil.example/']"), null);
  assert.equal(document.querySelector(".population-pockets"), null);
  controller.destroy();
});

test("renders the counted area without a Leaflet factory or network request", () => {
  const { document } = parseHTML('<html><body></body></html>');
  const controller = createPopulationDetails({ document });
  controller.open(context);
  assert.ok(document.querySelector("[data-population-area-fallback] path"));
  assert.equal(document.querySelectorAll("[data-population-area-fallback] circle").length, 1);
  controller.destroy();
  assert.equal(document.querySelector("[data-population-area-fallback]"), null);
});

test("escapes report and region content and traps focus without swallowing other keys", () => {
  const { document, window, controller } = setup();
  controller.open({ ...context, region: { label: '<img src=x onerror="alert(1)">' }, category: "<script>" });
  assert.equal(document.querySelector("img"), null);
  assert.equal(document.querySelector("script"), null);
  const closeButton = document.querySelector(".population-close");
  const links = [...document.querySelectorAll("dialog a")];
  const tab = new window.Event("keydown", { cancelable: true }); tab.key = "Tab";
  links.at(-1).focus(); document.dispatchEvent(tab);
  assert.equal(document.activeElement, closeButton);
  const back = new window.Event("keydown", { cancelable: true }); back.key = "Tab"; back.shiftKey = true;
  document.dispatchEvent(back);
  assert.equal(document.activeElement, links.at(-1));
  controller.destroy();
});

test("returns focus to a refreshed overview card after asynchronous population completion", () => {
  const { document, trigger, controller } = setup();
  controller.open({ ...context, population: { status: "loading" } });
  const replacement = document.createElement("button"); replacement.id = trigger.id;
  trigger.replaceWith(replacement);
  controller.update(context);
  controller.close();
  assert.equal(document.activeElement, replacement);
});

test("uses the translated region display without replacing the source region value", () => {
  const translations = [];
  const dynamicTranslator = { bind(element, text, options) {
    translations.push({ text, options });
    element.textContent = `Région : ${text}`;
    return element;
  } };
  const { document, controller } = setup({ dynamicTranslator });
  const region = { label: "Northern California" };
  controller.open({ ...context, region });
  assert.match(document.querySelector(".population-scope").textContent, /^Région : Northern California · Water supply$/);
  assert.deepEqual(translations, [{ text: "Northern California", options: { sourceLanguage: "en" } }]);
  assert.deepEqual(region, { label: "Northern California" });
  controller.destroy();
});

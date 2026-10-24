import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { read } from "./test-helpers.js";

function element({ hidden = false, text = "" } = {}) {
  return {
    hidden,
    textContent: text,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; }
  };
}

function mount() {
  const elements = {
    "form-loading": element(),
    "loading-status": element(),
    "form-loading-label": element({ text: "Loading the form…" }),
    "language-loading": element({ hidden: true }),
    "language-picker": element(),
    "language-loading-label": element({ text: "Loading the form…" }),
    "location-loading": element({ hidden: true }),
    "location-loading-area": element(),
    "location-status": element({ text: "No location added yet." }),
    "search-loading": element({ hidden: true }),
    "search-loading-area": element(),
    "place-search-status": element(),
    "submission-loading": element({ hidden: true }),
    "submission-loading-area": element(),
    "form-status": element()
  };
  const listeners = {};
  const context = vm.createContext({
    document: { getElementById(id) { return elements[id] || null; } },
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); }
  });
  context.window = context;
  vm.runInContext(read("loading-bar.js"), context);
  return { api: context.NeedMapLoading, elements, listeners, context };
}

test("each task appears at its own form area and clears only that area's busy state", () => {
  const page = mount();
  assert.equal(page.api.isActive("boot"), true);
  assert.equal(page.elements["form-loading"].hidden, false);
  assert.equal(page.elements["loading-status"].attributes["aria-busy"], "true");
  page.api.end("boot");
  assert.equal(page.elements["form-loading"].hidden, true);
  assert.equal(page.elements["loading-status"].hidden, true);

  const endLocation = page.api.begin("region", "locationFinding", "Finding location…", "location");
  const endSearch = page.api.begin("search", "searchLooking", "Looking for matching places…", "search");
  assert.equal(page.elements["location-loading"].hidden, false);
  assert.equal(page.elements["search-loading"].hidden, false);
  assert.equal(page.elements["location-loading-area"].attributes["aria-busy"], "true");
  assert.equal(page.elements["search-loading-area"].attributes["aria-busy"], "true");
  assert.equal(page.elements["location-status"].attributes["aria-busy"], undefined);
  assert.equal(page.elements["place-search-status"].attributes["aria-busy"], undefined);

  endSearch();
  assert.equal(page.elements["search-loading"].hidden, true);
  assert.equal(page.elements["search-loading-area"].attributes["aria-busy"], undefined);
  assert.equal(page.elements["location-loading"].hidden, false);
  endLocation();
  assert.equal(page.api.isActive(), false);
});

test("overlapping work in one area keeps the newest label until every current task ends", () => {
  const page = mount();
  page.api.end("boot");
  const endDetection = page.api.begin("region", "loading", "Detecting language", "form");
  const endPack = page.api.begin("pack", "loading", "Loading language", "form");
  assert.equal(page.elements["form-loading-label"].textContent, "Loading language");
  endPack();
  assert.equal(page.elements["form-loading"].hidden, false);
  assert.equal(page.elements["form-loading-label"].textContent, "Detecting language");
  endDetection();
  assert.equal(page.elements["form-loading"].hidden, true);
});

test("a stale completion cannot hide replacement work with the same key or another target", () => {
  const page = mount();
  page.api.end("boot");
  const staleFinish = page.api.begin("request", "loading", "First request", "location");
  const currentFinish = page.api.begin("request", "loading", "Replacement request", "submission");
  staleFinish();
  assert.equal(page.api.isActive("request"), true);
  assert.equal(page.elements["location-loading"].hidden, true);
  assert.equal(page.elements["submission-loading"].hidden, false);
  assert.equal(page.elements["submission-loading-area"].attributes["aria-busy"], "true");
  assert.equal(page.elements["form-status"].attributes["aria-busy"], undefined);
  currentFinish(new Error("network"));
  assert.equal(page.api.isActive(), false);
  assert.equal(page.elements["submission-loading"].hidden, true);
  assert.equal(page.elements["submission-loading-area"].attributes["aria-busy"], undefined);
});

test("visible boot and language labels refresh after a language change", () => {
  const page = mount();
  page.api.end("boot");
  page.api.begin("language", "loading", "Loading language…", "language");
  page.context.NeedMapI18n = { t(key) { return key === "loading" ? "Cargando el idioma…" : key; } };
  for (const listener of page.listeners["needmap-languagechange"]) listener();
  assert.equal(page.elements["language-loading-label"].textContent, "Cargando el idioma…");
  assert.equal(page.elements["language-loading"].hidden, false);
  assert.equal(page.elements["language-picker"].attributes["aria-busy"], "true");
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { COUNTRY_LANGUAGE_CANDIDATES, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, createI18n, languageForCountry, normalizeLanguageCode } from "../i18n/index.js";
import { createLanguagePicker } from "../i18n/language-picker.js";
import { MESSAGE_KEYS } from "../i18n/messages.js";
import { WORLD_REGION_ROWS } from "../world-region-catalog.js";

function storage(values = {}) {
  const data = new Map(Object.entries(values));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key), data };
}
function loaders(overrides = {}) {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map(({ code }) => [code, overrides[code] || (() => Promise.resolve({ default: {
    "language.button": code === "es" ? "Idioma" : "Language", "language.menu": "Choose language", "language.searchLabel": "Search languages",
    "language.searchPlaceholder": "Language name", "language.noMatches": "No matching languages.", "language.results": "Available languages", "language.loadError": "Could not load language.",
    greeting: code,
  } }))]));
}

test("language catalog uses the shared 18 codes and strict BCP-47 normalization", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES.map(({ code }) => code), ["en", "ar", "bn", "zh-Hans", "zh-Hant", "fr", "de", "hi", "id", "ja", "ko", "pt", "ru", "es", "sw", "tr", "ur", "vi"]);
  assert.equal(normalizeLanguageCode("pt_br"), "pt");
  assert.equal(normalizeLanguageCode("zh-TW"), "zh-Hant");
  assert.equal(normalizeLanguageCode("es-MX"), "es");
  assert.equal(normalizeLanguageCode("../../ar"), null);
  assert.equal(normalizeLanguageCode("not-a-language"), null);
});

test("all language packs include the complete priority reason and AI-review copy", async () => {
  const required = ["analysis.rankReasonTitle", "analysis.rankReasonRankedLead", "analysis.rankReasonPopulation",
    "analysis.rankReasonPopulationUnavailable", "analysis.rankReasonPopulationLoading", "analysis.aiReviewTitle",
    "analysis.aiReviewLoadingRank", "analysis.aiReviewUnavailableRank", "analysis.aiReviewReadyRank", "analysis.rationale.water"];
  for (const { code } of SUPPORTED_LANGUAGES) {
    const messages = (await import(`../i18n/locales/${code}.js`)).default;
    assert.equal(Object.keys(messages).length, MESSAGE_KEYS.length, code);
    for (const key of required) assert.equal(typeof messages[key], "string", `${code}:${key}`);
    assert.match(messages["analysis.rankReasonRankedLead"], /\{rank\}/, code);
    assert.match(messages["analysis.aiReviewReadyRank"], /\{reviewed\}/, code);
  }
});

test("country defaults are supported and browser language breaks official-language ties", () => {
  for (const candidates of Object.values(COUNTRY_LANGUAGE_CANDIDATES)) {
    assert.ok(candidates.length);
    candidates.forEach((code) => assert.ok(SUPPORTED_LANGUAGES.some((item) => item.code === code), code));
  }
  assert.equal(languageForCountry("DJ", ["ar"]), "ar");
  assert.equal(languageForCountry("DJ", ["en", "fr"]), "fr");
  assert.equal(languageForCountry("SG", ["zh-SG"]), "zh-Hans");
  assert.equal(languageForCountry("SG", ["en-SG"]), "en");
  assert.equal(languageForCountry("ZZ", ["es"]), "en");
  const supported = new Set(SUPPORTED_LANGUAGES.map(({ code }) => code));
  for (const [id, , , kind] of WORLD_REGION_ROWS) if (kind === "country") assert.ok(supported.has(languageForCountry(id)), id);
});

test("saved preference wins over query handoff; a validated query persists when no preference exists", async () => {
  const saved = storage({ [LANGUAGE_STORAGE_KEY]: "fr" });
  const first = createI18n({ storage: saved, navigator: { languages: ["en"] }, location: { search: "?lang=es" }, packLoaders: loaders(), document: parseHTML("<html></html>").document });
  await first.initialize();
  assert.equal(first.code, "fr"); assert.equal(saved.getItem(LANGUAGE_STORAGE_KEY), "fr");

  const empty = storage();
  const second = createI18n({ storage: empty, navigator: { languages: ["en"] }, location: { search: "?lang=es" }, packLoaders: loaders(), document: parseHTML("<html></html>").document });
  await second.initialize();
  assert.equal(second.code, "es"); assert.equal(empty.getItem(LANGUAGE_STORAGE_KEY), "es");

  const invalid = storage();
  const third = createI18n({ storage: invalid, navigator: { languages: ["fr"] }, location: { search: "?lang=../../ar" }, packLoaders: loaders(), document: parseHTML("<html></html>").document });
  await third.initialize();
  assert.equal(third.code, "fr"); assert.equal(invalid.getItem(LANGUAGE_STORAGE_KEY), null);
});

test("failed and stale pack loads do not change or persist the active preference", async () => {
  let releaseFrench, releaseSpanish;
  const pending = loaders({
    fr: () => new Promise((resolve) => { releaseFrench = resolve; }),
    es: () => new Promise((resolve) => { releaseSpanish = resolve; }),
    de: () => Promise.reject(new Error("offline")),
  });
  const store = storage();
  const i18n = createI18n({ storage: store, navigator: { languages: ["en"] }, location: { search: "" }, packLoaders: pending, document: parseHTML("<html></html>").document });
  await i18n.initialize();
  await assert.rejects(i18n.select("de"), /offline/);
  assert.equal(i18n.code, "en"); assert.equal(store.getItem(LANGUAGE_STORAGE_KEY), null);
  const french = i18n.select("fr"), spanish = i18n.select("es");
  releaseSpanish({ default: { greeting: "es" } }); await spanish;
  releaseFrench({ default: { greeting: "fr" } }); await french;
  assert.equal(i18n.code, "es"); assert.equal(store.getItem(LANGUAGE_STORAGE_KEY), "es");
});

test("language-pack loading exposes balanced activity tokens for success and failure", async () => {
  const active = new Set(); let sequence = 0;
  const onLoading = ({ key, code }) => {
    const token = `${key}:${code}:${++sequence}`; active.add(token);
    let released = false;
    return () => { if (!released) { released = true; active.delete(token); } };
  };
  const i18n = createI18n({
    storage: storage(), navigator: { languages: ["en"] }, location: { search: "" }, document: parseHTML("<html></html>").document,
    packLoaders: loaders({ de: () => Promise.reject(new Error("offline")) }), onLoading,
  });
  const initialization = i18n.initialize();
  assert.equal(active.size, 1);
  await initialization;
  assert.equal(active.size, 0);
  await assert.rejects(i18n.select("de"), /offline/);
  assert.equal(active.size, 0);
});

test("manual or saved language is never replaced by a later region and RTL updates the document", async () => {
  const document = parseHTML("<html></html>").document;
  const i18n = createI18n({ storage: storage(), navigator: { languages: ["en"] }, location: { search: "" }, packLoaders: loaders(), document });
  await i18n.initialize(); await i18n.applyRegion("EG");
  assert.equal(i18n.code, "ar"); assert.equal(document.documentElement.dir, "rtl");
  await i18n.select("es"); await i18n.applyRegion("JP");
  assert.equal(i18n.code, "es"); assert.equal(document.documentElement.dir, "ltr");
});

test("searchable language picker matches English and native names and reports failed chunks", async () => {
  const { document, window } = parseHTML(`<html><body><div class="language-navigation"><button id="change-language"><span></span></button><section id="language-menu" hidden><label for="language-search"></label><input id="language-search"><p id="language-search-status"></p><ul id="language-results"></ul></section></div></body></html>`);
  const subscribers = new Set();
  const i18n = { code: "en", language: SUPPORTED_LANGUAGES[0], t(key) { return key; }, subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }, async select() { throw new Error("offline"); } };
  const picker = createLanguagePicker({ i18n, document });
  document.getElementById("change-language").dispatchEvent(new window.Event("click", { bubbles: true }));
  const search = document.getElementById("language-search"); search.value = "español"; search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.deepEqual([...document.querySelectorAll("#language-results button")].map((item) => item.dataset.language), ["es"]);
  document.querySelector("#language-results button").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("language-search-status").dataset.error, "true");
  picker.destroy(); assert.equal(subscribers.size, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { read } from "./test-helpers.js";
import { languageForCountry as mapLanguageForCountry } from "../mapSite/i18n/index.js";

const source = read("i18n.js");
const keys = Function('return [' + source.match(/var KEYS = \[([\s\S]*?)\n  \];/)[1] + ']')();
const english = Function('return [' + source.match(/var ENGLISH = \[([\s\S]*?)\n  \];/)[1] + ']')();
const codes = ["en", "es", "fr", "pt", "ar", "zh-Hans", "zh-Hant", "hi", "bn", "ur", "ru", "de", "id", "ja", "ko", "vi", "tr", "sw"];
const countryCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

class Element {
  constructor() { this.attributes = {}; this.listeners = {}; this.hidden = false; this.value = ""; this.textContent = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
}

function runI18n({ saved = null, country = null, packCode = null, packMessages = english, deferCountry = false, navigator = { languages: ["en-US"], onLine: true } } = {}) {
  const requests = [], savedValues = [], events = [];
  let pendingCountry = null;
  class XHR {
    open(_method, url) { this.url = url; }
    setRequestHeader() {}
    abort() {}
    send() {
      requests.push(this.url);
      if (deferCountry && this.url.includes("geojs")) { pendingCountry = this; return; }
      this.respond();
    }
    respond() {
      this.status = 200;
      this.readyState = 4;
      this.responseText = this.url.includes("geojs")
        ? JSON.stringify({ country_code: country })
        : JSON.stringify({ locale: packCode || this.url.match(/locales\/(.+)\.json/)[1], messages: packMessages });
      this.onreadystatechange();
    }
  }
  const rootEvents = {};
  const documentElement = new Element();
  const document = {
    documentElement, title: "", activeElement: null,
    querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
    addEventListener() {}, createEvent() { return { initEvent(type) { this.type = type; } }; }
  };
  const context = vm.createContext({
    console, JSON, encodeURIComponent, navigator, document, XMLHttpRequest: XHR,
    localStorage: { getItem(key) { return key === "needmap-language-v1" ? saved : null; }, setItem(key, value) { savedValues.push([key, value]); } },
    setTimeout() { return 1; }, clearTimeout() {},
    addEventListener(name, callback) { (rootEvents[name] ||= []).push(callback); },
    dispatchEvent(event) { events.push(event.type); for (const callback of rootEvents[event.type] || []) callback(event); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  });
  context.window = context;
  vm.runInContext(source, context);
  return { api: context.NeedMapI18n, requests, savedValues, events, documentElement, document,
    resolveCountry() { pendingCountry.respond(); } };
}

test("language registry and country defaults match the dashboard policy", () => {
  const { api } = runI18n({ saved: "en" });
  assert.deepEqual(Array.from(api.getLanguages(), ({ code }) => code), codes);
  assert.equal(api.storageKey, "needmap-language-v1");
  assert.equal(api.countryLanguage("CH", ["fr-CH"]), "fr");
  assert.equal(api.countryLanguage("CH", ["it-CH"]), "de");
  assert.equal(api.countryLanguage("SG", ["zh-CN"]), "zh-Hans");
  assert.equal(api.countryLanguage("CA", ["fr-CA"]), "fr");
  assert.equal(api.countryLanguage("DJ", ["ar"]), "ar");
  assert.equal(api.countryLanguage("TD", ["es"]), "fr");
  assert.equal(api.countryLanguage("SO", ["en"]), "ar");
  assert.equal(api.countryLanguage("DZ", []), "ar");
  assert.equal(api.countryLanguage("MA", []), "ar");
  assert.equal(api.countryLanguage("MR", []), "ar");
  assert.equal(api.countryLanguage("TN", []), "ar");
  for (const code of countryCodes) assert.ok(codes.includes(api.countryLanguage(code, [])), code);
});

test("country language selection stays aligned with the map page", () => {
  const { api } = runI18n({ saved: "en" });
  const preferenceSets = [[], ["en-US"], ["fr-FR"], ["ar"], ["ru"], ["sw"], ["zh-CN"], ["de-CH"]];
  for (const countryCode of countryCodes) {
    for (const preferences of preferenceSets) {
      assert.equal(api.countryLanguage(countryCode, preferences), mapLanguageForCountry(countryCode, preferences),
        countryCode + " with " + (preferences.join(",") || "no browser preference"));
    }
  }
});

test("saved preference skips IP lookup; automatic country selection is not persisted", () => {
  const saved = runI18n({ saved: "ar", packCode: "ar" });
  assert.deepEqual(saved.requests, ["./locales/ar.json"]);
  assert.equal(saved.api.getLanguage(), "ar");
  assert.equal(saved.documentElement.attributes.dir, "rtl");
  assert.deepEqual(saved.savedValues, []);

  const detected = runI18n({ country: "TW", packCode: "zh-Hant" });
  assert.deepEqual(detected.requests, ["https://get.geojs.io/v1/ip/country.json", "./locales/zh-Hant.json"]);
  assert.equal(detected.api.getLanguage(), "zh-Hant");
  assert.deepEqual(detected.savedValues, []);
});

test("manual selection is saved and switching back to English restores English messages", () => {
  const translated = english.map((message, index) => index === keys.indexOf("pageTitle") ? "Arabic title" : "AR " + message);
  const page = runI18n({ saved: "ar", packCode: "ar", packMessages: translated });
  assert.equal(page.api.t("pageTitle"), "Arabic title");
  let completed = false;
  page.api.setLanguage("en", (error) => { assert.equal(error, null); completed = true; });
  assert.equal(completed, true);
  assert.equal(page.api.t("pageTitle"), "Report a concern | NeedMap Community");
  assert.deepEqual(page.savedValues.at(-1), ["needmap-language-v1", "en"]);
  assert.equal(page.documentElement.attributes.dir, "ltr");
});

test("English is ready immediately and a late IP response cannot override a manual choice", () => {
  const page = runI18n({ country: "TW", deferCountry: true });
  assert.equal(page.api.getLanguage(), "en");
  let completed = false;
  page.api.setLanguage("fr", (error) => { assert.equal(error, null); completed = true; });
  assert.equal(completed, true);
  assert.equal(page.api.getLanguage(), "fr");
  page.resolveCountry();
  assert.equal(page.api.getLanguage(), "fr");
  assert.deepEqual(page.requests, ["https://get.geojs.io/v1/ip/country.json", "./locales/fr.json"]);
});

test("every shipped pack is complete, preserves placeholders and contains real translations", () => {
  const files = readdirSync(new URL("locales", import.meta.url)).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(files, codes.slice(1).map((code) => code + ".json").sort());
  for (const code of codes.slice(1)) {
    const pack = JSON.parse(readFileSync(new URL("locales/" + code + ".json", import.meta.url), "utf8"));
    assert.equal(pack.locale, code);
    assert.equal(pack.messages.length, keys.length);
    let identical = 0;
    for (let index = 0; index < keys.length; index++) {
      assert.ok(pack.messages[index].trim(), code + ":" + keys[index]);
      assert.deepEqual(pack.messages[index].match(/\{\w+\}/g) || [], english[index].match(/\{\w+\}/g) || [], code + ":" + keys[index]);
      if (pack.messages[index] === english[index]) identical++;
    }
    assert.ok(identical <= 8, code + " left " + identical + " English strings unchanged");
  }
});


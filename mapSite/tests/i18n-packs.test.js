import test from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_KEYS } from "../i18n/messages.js";
import { SUPPORTED_LANGUAGES, createI18n } from "../i18n/index.js";
import english from "../i18n/locales/en.js";

const load = (code) => import(`../i18n/locales/${code}.js`).then((module) => module.default);
function placeholders(message) {
  const result = [];
  const rest = String(message).replace(/\{(\w+),\s*plural,\s*one\s*\{[^{}]*\}\s*other\s*\{[^{}]*\}\}/g, (_, name) => { result.push(name); return ""; });
  for (const match of rest.matchAll(/\{(\w+)\}/g)) result.push(match[1]);
  return result.sort();
}

test("every listed language has a complete nonempty pack with matching placeholders", async () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const pack = await load(language.code);
    assert.deepEqual(Object.keys(pack), MESSAGE_KEYS, `${language.code} key order`);
    for (const key of MESSAGE_KEYS) {
      assert.equal(typeof pack[key], "string", `${language.code}:${key}`);
      assert.ok(pack[key].trim(), `${language.code}:${key} is empty`);
      assert.deepEqual(placeholders(pack[key]), placeholders(english[key]), `${language.code}:${key} placeholders`);
    }
  }
});

test("non-English packs do not hide missing translations behind copied English", async () => {
  const unavoidable = new Set(["unit.percent"]);
  for (const { code } of SUPPORTED_LANGUAGES.filter(({ code }) => code !== "en")) {
    const pack = await load(code);
    const copied = MESSAGE_KEYS.filter((key) => !unavoidable.has(key) && pack[key] === english[key]);
    assert.ok(copied.length <= 4, `${code} copied ${copied.length} English messages: ${copied.join(", ")}`);
  }
});

test("only Arabic and Urdu packs request right-to-left document layout", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES.filter(({ direction }) => direction === "rtl").map(({ code }) => code), ["ar", "ur"]);
});

test("demonstration proposal disclosures and the display toggle are translated and substitute localized counts", async () => {
  const keys = ["candidate.demonstrationTitle", "candidate.demonstrationNotice", "candidate.includeDemonstrations"];
  assert.equal(english["candidate.includeDemonstrations"], "Show all proposed services", "The existing proposal display toggle keeps its neutral label");
  for (const { code } of SUPPORTED_LANGUAGES) {
    const pack = await load(code);
    const i18n = createI18n({ document: undefined, storage: { getItem: () => code }, navigator: { languages: [code] }, location: { search: "" } });
    await i18n.initialize();
    assert.equal(i18n.code, code);
    for (const key of keys) {
      assert.ok(pack[key].trim());
      if (code !== "en") assert.notEqual(pack[key], english[key], `${code}:${key} must not use English fallback`);
    }
    const count = i18n.number(12);
    const notice = i18n.t("candidate.demonstrationNotice", { count });
    assert.ok(notice.includes(count), `${code} preserves the localized proposal count`);
    assert.doesNotMatch(notice, /\{count\}/, `${code} replaces the count placeholder`);
    assert.equal(i18n.t("candidate.demonstrationTitle"), pack["candidate.demonstrationTitle"]);
    assert.equal(i18n.t("candidate.includeDemonstrations"), pack["candidate.includeDemonstrations"]);
  }
});

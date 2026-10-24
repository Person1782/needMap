import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createDynamicTranslator } from "../i18n/dynamic-translation.js";
import { filterReports } from "../dashboard-state.js";

function i18n(initial = "fr") {
  let code = initial;
  const listeners = new Set();
  return {
    get code() { return code; },
    change(next) { code = next; for (const listener of listeners) listener({ code: next }); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

test("on-device translations are deduplicated, cached, and searchable", async () => {
  const language = i18n("fr");
  let creates = 0, calls = 0;
  const service = createDynamicTranslator({
    i18n: language,
    scope: {
      queueMicrotask,
      Translator: {
        availability: async () => "available",
        async create({ targetLanguage }) {
          creates += 1;
          return { async translate(text) { calls += 1; return targetLanguage === "fr" ? `FR:${text}` : text; }, destroy() {} };
        },
      },
    },
  });
  const [first, second] = await Promise.all([
    service.translate("The pharmacy closed", { sourceLanguage: "en" }),
    service.translate("The pharmacy closed", { sourceLanguage: "en" }),
  ]);
  assert.equal(first, "FR:The pharmacy closed");
  assert.equal(second, first);
  assert.equal(calls, 1);
  assert.equal(await service.translate("The pharmacy closed", { sourceLanguage: "en" }), first);
  assert.equal(calls, 1);
  assert.equal(creates, 1);
  assert.deepEqual(filterReports([{ summary: "The pharmacy closed", translatedSummary: first }], { query: "fr:the" }).length, 1);
  service.destroy();
});

test("a stale translation cannot replace a newer binding after language changes", async () => {
  const language = i18n("fr");
  const releases = new Map();
  const service = createDynamicTranslator({
    i18n: language,
    scope: {
      queueMicrotask,
      Translator: {
        availability: async () => "available",
        async create({ targetLanguage }) {
          return {
            translate(text) {
              if (targetLanguage === "es") return Promise.resolve(`ES:${text}`);
              return new Promise((resolve) => releases.set(targetLanguage, () => resolve(`FR:${text}`)));
            },
            destroy() {},
          };
        },
      },
    },
  });
  const { document } = parseHTML("<html><body><p id='text'></p></body></html>");
  const node = document.getElementById("text");
  service.bind(node, "Water is unavailable", { sourceLanguage: "en" });
  await Promise.resolve(); await Promise.resolve();
  language.change("es");
  service.bind(node, "Water is unavailable", { sourceLanguage: "en" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(node.textContent, "ES:Water is unavailable");
  releases.get("fr")?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(node.textContent, "ES:Water is unavailable");
  service.destroy();
});

test("unsupported browser translation keeps the original report text", async () => {
  const service = createDynamicTranslator({ i18n: i18n("fr"), scope: { queueMicrotask } });
  assert.equal(await service.translate("Original community report", { sourceLanguage: "en" }), "Original community report");
  service.destroy();
});

test("model creation exposes and releases contextual loading", async () => {
  const events = [];
  const service = createDynamicTranslator({
    i18n: i18n("fr"),
    onLoading(options) { events.push(["start", options]); return () => events.push(["finish", options.key]); },
    scope: {
      queueMicrotask,
      Translator: {
        async create({ targetLanguage }) {
          return { async translate(text) { return `${targetLanguage}:${text}`; }, destroy() {} };
        },
      },
    },
  });
  service.prepareForLanguage("fr");
  assert.equal(await service.translate("A community report", { sourceLanguage: "en" }), "fr:A community report");
  assert.equal(events.length, 2);
  assert.equal(events[0][0], "start");
  assert.equal(events[0][1].key, "dynamic-language");
  assert.equal(events[1][0], "finish");
  service.destroy();
});


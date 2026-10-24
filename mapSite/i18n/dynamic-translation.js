const MAX_CACHE_ENTRIES = 600;

function apiLanguage(code) {
  if (typeof code !== "string") return "";
  const normalized = code.trim().replaceAll("_", "-");
  if (!normalized) return "";
  if (/^zh-(?:hans|cn|sg)$/i.test(normalized)) return "zh";
  if (/^zh-(?:hant|tw|hk|mo)$/i.test(normalized)) return "zh-Hant";
  return normalized.split("-")[0].toLowerCase();
}

function sameLanguage(source, target) {
  const left = apiLanguage(source), right = apiLanguage(target);
  if (!left || !right) return false;
  if (left.startsWith("zh") || right.startsWith("zh")) return left === right;
  return left === right;
}

function scriptLanguage(text) {
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  if (/[\u0900-\u097f]/u.test(text)) return "hi";
  if (/[\u0980-\u09ff]/u.test(text)) return "bn";
  if (/[\u4e00-\u9fff]/u.test(text)) return "zh";
  if (/[\u0400-\u04ff]/u.test(text)) return "ru";
  if (/[\u0600-\u06ff]/u.test(text)) return "ar";
  return "";
}

function boundedSet(map, key, value, limit = MAX_CACHE_ENTRIES) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

/**
 * Translates user-authored dashboard text with the browser's on-device models.
 * Unsupported browsers, language pairs, downloads and errors always retain the
 * original text; no report content is sent to Firebase or another web service.
 */
export function createDynamicTranslator({
  i18n,
  scope = globalThis,
  maxCacheEntries = MAX_CACHE_ENTRIES,
  onLoading,
} = {}) {
  const TranslatorApi = scope?.Translator;
  const DetectorApi = scope?.LanguageDetector;
  const translations = new Map();
  const displayCache = new Map();
  const pending = new Map();
  const translators = new Map();
  const bindings = new WeakMap();
  const listeners = new Set();
  let detectorPromise;
  let revision = 0;
  let destroyed = false;
  let notificationQueued = false;

  const target = () => apiLanguage(i18n?.code || "en") || "en";
  const stopLanguage = i18n?.subscribe?.(() => { revision += 1; }) || (() => {});

  async function detector() {
    if (!DetectorApi?.create) return null;
    detectorPromise ||= Promise.resolve()
      .then(async () => typeof DetectorApi.availability === "function" ? DetectorApi.availability() : "available")
      .then((availability) => availability === "unavailable" ? null : DetectorApi.create())
      .catch(() => null);
    return detectorPromise;
  }

  async function sourceFor(text, supplied) {
    const explicit = apiLanguage(supplied);
    if (explicit) return explicit;
    const instance = await detector();
    if (instance?.detect) {
      try {
        const matches = await instance.detect(text);
        const detected = apiLanguage(matches?.find((item) => item?.detectedLanguage)?.detectedLanguage);
        if (detected) return detected;
      } catch { /* English is the safe fallback for the existing report data. */ }
    }
    const scripted = scriptLanguage(text);
    if (scripted) return scripted;
    return "en";
  }

  function notify() {
    if (notificationQueued || destroyed) return;
    notificationQueued = true;
    (scope?.queueMicrotask || queueMicrotask)(() => {
      notificationQueued = false;
      if (!destroyed) for (const listener of listeners) listener();
    });
  }

  function translatorFor(sourceLanguage, targetLanguage, { activated = false } = {}) {
    if (!TranslatorApi?.create) return Promise.resolve(null);
    const key = `${sourceLanguage}>${targetLanguage}`;
    if (translators.has(key)) return translators.get(key);
    const options = { sourceLanguage, targetLanguage };
    let releaseLoading = () => {};
    const create = () => {
      releaseLoading = onLoading?.({ key: "dynamic-language", source: "translation", delayMs: 150 }) || (() => {});
      try { return Promise.resolve(TranslatorApi.create(options)); }
      catch { return Promise.resolve(null); }
    };
    const promise = (activated
      ? create()
      : Promise.resolve()
        .then(async () => typeof TranslatorApi.availability === "function" ? TranslatorApi.availability(options) : "available")
        .then((availability) => availability === "unavailable" ? null : create()))
      .catch(() => null)
      .finally(() => releaseLoading());
    translators.set(key, promise);
    void promise.then((instance) => {
      if (!instance && translators.get(key) === promise) translators.delete(key);
      else if (instance) notify();
    });
    return promise;
  }

  async function translate(text, { sourceLanguage } = {}) {
    const original = typeof text === "string" ? text : "";
    if (!original.trim() || destroyed) return original;
    const requestRevision = revision;
    const targetLanguage = target();
    const displayKey = `${targetLanguage}\u0000${original}`;
    if (displayCache.has(displayKey)) return displayCache.get(displayKey);
    const source = await sourceFor(original, sourceLanguage);
    if (destroyed || requestRevision !== revision || sameLanguage(source, targetLanguage)) return original;
    const key = `${source}>${targetLanguage}\u0000${original}`;
    if (translations.has(key)) return translations.get(key);
    if (pending.has(key)) return pending.get(key);
    const promise = translatorFor(source, targetLanguage).then(async (instance) => {
      if (!instance?.translate) return { value: original, cacheable: false };
      try {
        const result = await instance.translate(original);
        return { value: typeof result === "string" && result.trim() ? result.trim() : original, cacheable: true };
      } catch { return { value: original, cacheable: false }; }
    }).then(({ value, cacheable }) => {
      if (cacheable) {
        boundedSet(translations, key, value, maxCacheEntries);
        boundedSet(displayCache, displayKey, value, maxCacheEntries);
      }
      pending.delete(key);
      if (value !== original) notify();
      return value;
    });
    pending.set(key, promise);
    return promise;
  }

  function bind(node, text, options = {}) {
    if (!node) return node;
    const original = typeof text === "string" ? text : "";
    node.textContent = original;
    node.dir = "auto";
    const token = Symbol("dynamic-translation");
    const requestRevision = revision;
    bindings.set(node, token);
    void translate(original, options).then((value) => {
      if (destroyed || requestRevision !== revision || bindings.get(node) !== token || node.isConnected === false) return;
      node.textContent = value;
      node.lang = target();
      node.dir = "auto";
    });
    return node;
  }

  // Call from the language option's click handler so Chrome may download or
  // create the on-device models while transient user activation is present.
  function prepareForLanguage(code, sourceLanguages = ["en"]) {
    const nextTarget = apiLanguage(code);
    if (!nextTarget || !TranslatorApi?.create) return;
    if (DetectorApi?.create && !detectorPromise) detectorPromise = Promise.resolve(DetectorApi.create()).catch(() => null);
    for (const value of sourceLanguages) {
      const source = apiLanguage(value);
      if (source && !sameLanguage(source, nextTarget)) void translatorFor(source, nextTarget, { activated: true });
    }
  }

  function cached(text) {
    const original = typeof text === "string" ? text : "";
    return displayCache.get(`${target()}\u0000${original}`) || original;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    revision += 1;
    stopLanguage();
    void detectorPromise?.then((instance) => instance?.destroy?.());
    for (const promise of translators.values()) void promise.then((instance) => instance?.destroy?.());
    listeners.clear(); translations.clear(); displayCache.clear(); pending.clear(); translators.clear();
  }

  return {
    translate, bind, cached, prepareForLanguage,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy,
  };
}


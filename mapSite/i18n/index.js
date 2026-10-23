export const LANGUAGE_STORAGE_KEY = "needmap-language-v1";

export const SUPPORTED_LANGUAGES = Object.freeze([
  { code: "en", englishName: "English", nativeName: "English", direction: "ltr" },
  { code: "ar", englishName: "Arabic", nativeName: "العربية", direction: "rtl" },
  { code: "bn", englishName: "Bengali", nativeName: "বাংলা", direction: "ltr" },
  { code: "zh-Hans", englishName: "Chinese (Simplified)", nativeName: "简体中文", direction: "ltr" },
  { code: "zh-Hant", englishName: "Chinese (Traditional)", nativeName: "繁體中文", direction: "ltr" },
  { code: "fr", englishName: "French", nativeName: "Français", direction: "ltr" },
  { code: "de", englishName: "German", nativeName: "Deutsch", direction: "ltr" },
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी", direction: "ltr" },
  { code: "id", englishName: "Indonesian", nativeName: "Bahasa Indonesia", direction: "ltr" },
  { code: "ja", englishName: "Japanese", nativeName: "日本語", direction: "ltr" },
  { code: "ko", englishName: "Korean", nativeName: "한국어", direction: "ltr" },
  { code: "pt", englishName: "Portuguese", nativeName: "Português", direction: "ltr" },
  { code: "ru", englishName: "Russian", nativeName: "Русский", direction: "ltr" },
  { code: "es", englishName: "Spanish", nativeName: "Español", direction: "ltr" },
  { code: "sw", englishName: "Swahili", nativeName: "Kiswahili", direction: "ltr" },
  { code: "tr", englishName: "Turkish", nativeName: "Türkçe", direction: "ltr" },
  { code: "ur", englishName: "Urdu", nativeName: "اردو", direction: "rtl" },
  { code: "vi", englishName: "Vietnamese", nativeName: "Tiếng Việt", direction: "ltr" },
]);

const loaders = {
  en: () => import("./locales/en.js"), ar: () => import("./locales/ar.js"),
  bn: () => import("./locales/bn.js"), "zh-Hans": () => import("./locales/zh-Hans.js"),
  "zh-Hant": () => import("./locales/zh-Hant.js"), fr: () => import("./locales/fr.js"),
  de: () => import("./locales/de.js"), hi: () => import("./locales/hi.js"),
  id: () => import("./locales/id.js"), ja: () => import("./locales/ja.js"),
  ko: () => import("./locales/ko.js"), pt: () => import("./locales/pt.js"),
  ru: () => import("./locales/ru.js"), es: () => import("./locales/es.js"),
  sw: () => import("./locales/sw.js"), tr: () => import("./locales/tr.js"),
  ur: () => import("./locales/ur.js"), vi: () => import("./locales/vi.js"),
};

const spanish = new Set(["AR", "BO", "CL", "CO", "CR", "CU", "DO", "EC", "ES", "GQ", "GT", "HN", "MX", "NI", "PA", "PE", "PR", "PY", "SV", "UY", "VE"]);
const french = new Set(["BF", "BI", "BJ", "BL", "CD", "CF", "CG", "CI", "CM", "DJ", "FR", "GA", "GF", "GN", "GP", "HT", "KM", "LU", "MC", "MF", "MG", "ML", "MQ", "MU", "NC", "NE", "PF", "PM", "RE", "RW", "SC", "SN", "TD", "TF", "TG", "VU", "WF", "YT"]);
const portuguese = new Set(["AO", "BR", "CV", "GW", "MZ", "PT", "ST", "TL"]);
const arabic = new Set(["AE", "BH", "DZ", "EG", "EH", "IQ", "JO", "KW", "LB", "LY", "MA", "MR", "OM", "PS", "QA", "SA", "SD", "SO", "SY", "TN", "YE"]);
const german = new Set(["AT", "DE", "LI"]);
const russian = new Set(["BY", "KG", "KZ", "RU", "TJ"]);
const swahili = new Set(["KE", "TZ", "UG"]);
const LANGUAGE_BY_COUNTRY = new Map([
  ...[...spanish].map((code) => [code, "es"]), ...[...french].map((code) => [code, "fr"]),
  ...[...portuguese].map((code) => [code, "pt"]), ...[...arabic].map((code) => [code, "ar"]),
  ...[...german].map((code) => [code, "de"]), ...[...russian].map((code) => [code, "ru"]),
  ...[...swahili].map((code) => [code, "sw"]),
  ["BD", "bn"], ["CN", "zh-Hans"], ["HK", "zh-Hant"], ["MO", "zh-Hant"], ["TW", "zh-Hant"],
  ["IN", "hi"], ["ID", "id"], ["JP", "ja"], ["KP", "ko"], ["KR", "ko"], ["PK", "ur"], ["TR", "tr"], ["VN", "vi"],
]);
const multilingualCountries = {
  BE: ["fr", "de", "en"], CA: ["en", "fr"], CH: ["de", "fr", "en"], DJ: ["fr", "ar"],
  DZ: ["ar", "fr"], MA: ["ar", "fr"], MR: ["ar", "fr"], TN: ["ar", "fr"],
  ER: ["en", "ar"], IN: ["hi", "en"], KE: ["sw", "en"], KM: ["fr", "ar"],
  PK: ["ur", "en"], SG: ["en", "zh-Hans"], TD: ["fr", "ar"], TZ: ["sw", "en"],
};
export const COUNTRY_LANGUAGE_CANDIDATES = Object.freeze(Object.fromEntries(
  [...LANGUAGE_BY_COUNTRY].map(([country, language]) => [country, Object.freeze(multilingualCountries[country] || [language])])
    .concat(Object.entries(multilingualCountries).filter(([country]) => !LANGUAGE_BY_COUNTRY.has(country)).map(([country, values]) => [country, Object.freeze(values)])),
));

const languageCodes = new Set(SUPPORTED_LANGUAGES.map(({ code }) => code));
export function normalizeLanguageCode(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim().replaceAll("_", "-");
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(candidate)) return null;
  const normalized = candidate.toLowerCase();
  return SUPPORTED_LANGUAGES.find(({ code }) => code.toLowerCase() === normalized)?.code ||
    (normalized.startsWith("zh") ? /(?:tw|hk|mo|hant)/.test(normalized) ? "zh-Hant" : "zh-Hans"
      : SUPPORTED_LANGUAGES.find(({ code }) => code.split("-")[0].toLowerCase() === normalized.split("-")[0])?.code) || null;
}
export function languageForCountry(countryCode, preferredLanguages = []) {
  const candidates = COUNTRY_LANGUAGE_CANDIDATES[String(countryCode || "").toUpperCase()] || ["en"];
  const preferences = (Array.isArray(preferredLanguages) ? preferredLanguages : [preferredLanguages]).map(normalizeLanguageCode).filter(Boolean);
  return preferences.find((language) => candidates.includes(language)) || candidates[0];
}

function safeStorage(storage) {
  try { return storage || globalThis.localStorage; } catch { return null; }
}
function storedLanguage(storage) {
  try { const code = storage?.getItem(LANGUAGE_STORAGE_KEY); return languageCodes.has(code) ? code : null; }
  catch { return null; }
}
function browserLanguage(navigator) {
  for (const value of navigator?.languages || [navigator?.language]) {
    const code = normalizeLanguageCode(value);
    if (code) return code;
  }
  return "en";
}

export function createI18n({ document = globalThis.document, storage, navigator = globalThis.navigator, location = globalThis.location, packLoaders = loaders } = {}) {
  const localStorage = safeStorage(storage);
  const saved = storedLanguage(localStorage);
  const query = (() => { try { return normalizeLanguageCode(location?.search ? new URLSearchParams(location.search).get("lang") : null); } catch { return null; } })();
  let code = saved || query || browserLanguage(navigator), messages = null, revision = 0, regionApplied = false;
  let explicit = Boolean(saved || query), loadPromise;
  const listeners = new Set();
  const info = () => SUPPORTED_LANGUAGES.find((item) => item.code === code) || SUPPORTED_LANGUAGES[0];
  function format(message, variables = {}) {
    return String(message).replace(/\{(\w+),\s*plural,\s*one\s*\{([^{}]*)\}\s*other\s*\{([^{}]*)\}\}/g,
      (_, name, one, other) => new Intl.PluralRules(code).select(Number(variables[name])) === "one" ? one : other)
      .replace(/\{(\w+)\}/g, (_, name) => typeof variables[name] === "number" ? variables[name].toLocaleString(code) : variables[name] ?? `{${name}}`);
  }
  function t(key, variables) {
    if (!messages || !Object.hasOwn(messages, key)) return key;
    return format(messages[key], variables);
  }
  function applyDocument() {
    if (!document?.documentElement) return;
    document.documentElement.lang = code;
    document.documentElement.dir = info().direction;
  }
  async function load(next, { persist = false, source = "automatic" } = {}) {
    const supported = normalizeLanguageCode(next) || "en";
    if (messages && supported === code) {
      if (persist) {
        explicit = true;
        try { localStorage?.setItem(LANGUAGE_STORAGE_KEY, supported); } catch { /* Preference remains active for this visit. */ }
      }
      return code;
    }
    const current = ++revision;
    const module = await packLoaders[supported]();
    if (current !== revision) return code;
    code = supported; messages = module.default; applyDocument();
    if (persist || (source === "query" || (!saved && query && supported === query))) {
      explicit = true;
      try { localStorage?.setItem(LANGUAGE_STORAGE_KEY, supported); } catch { /* Preference remains active for this visit. */ }
    }
    for (const listener of listeners) listener({ code, source });
    return code;
  }
  async function initialize() {
    loadPromise ||= load(code, { source: saved ? "saved" : query ? "query" : "browser" }).catch(async (error) => {
      if (code === "en") throw error;
      code = "en"; explicit = false;
      try { localStorage?.removeItem(LANGUAGE_STORAGE_KEY); } catch { /* English fallback still works. */ }
      return load("en", { source: "fallback" });
    });
    return loadPromise;
  }
  async function select(next) { return load(next, { persist: true, source: "manual" }); }
  async function applyRegion(countryCode) {
    if (explicit || regionApplied) return code;
    regionApplied = true;
    try { return await load(languageForCountry(countryCode, navigator?.languages || [navigator?.language]), { source: "region" }); }
    catch { return code; }
  }
  return {
    initialize, select, applyRegion, t,
    number(value, options) { return Number(value).toLocaleString(code, options); },
    date(value, options) { return new Intl.DateTimeFormat(code, options).format(value); },
    get code() { return code; }, get direction() { return info().direction; }, get language() { return info(); },
    get hasSavedPreference() { return explicit; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

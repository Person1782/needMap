import { COUNTRY_ALPHA3 } from "./country-alpha3.js";

// These are measurements, not AI estimates. Definitions and source limitations
// are documented in ANALYSIS-EVIDENCE.md. All values are fetched at runtime.
export const WORLD_BANK_API = "https://api.worldbank.org/v2";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 12;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_ROWS = 200;
const MAX_AGE_YEARS = 10;
const DEFAULT_TIMEOUT_MS = 20_000;
const cacheByFetch = new WeakMap();

export const ANALYSIS_INDICATORS = Object.freeze([
  { code: "SP.POP.TOTL", category: "all", kind: "population", unit: "people",
    title: "Total population", publisher: "UN Population Division and national statistical offices via World Bank",
    description: "Resident population, estimated at midyear. Total population is not an estimate of people affected by infrastructure problems.",
    usedFor: "Population context and the same-year denominator for supported population estimates." },
  { code: "SH.H2O.BASW.ZS", category: "water", kind: "access_percent", unit: "%",
    title: "People using at least basic drinking water services", publisher: "WHO/UNICEF Joint Monitoring Programme via World Bank",
    description: "Share of people using an improved drinking-water source with a round trip collection time of at most 30 minutes. Basic service does not establish that water is safely managed.",
    usedFor: "Water service access gap; combined with population from the same year to estimate people without basic drinking water service.",
    gap: true, affected: true },
  { code: "SH_UHC_SCI", category: "healthcare", kind: "access_index", unit: "index points",
    title: "Universal health coverage service coverage index", publisher: "World Health Organization via World Bank",
    description: "A 0–100 composite of essential health-service coverage. The difference from 100 is an index gap, not a percentage of people without healthcare.",
    usedFor: "Healthcare service-access factor only; never converted into a number of affected people.", gap: true },
  { code: "IT.NET.USER.ZS", category: "broadband", kind: "access_percent", unit: "%",
    title: "Individuals using the Internet", publisher: "International Telecommunication Union via World Bank",
    description: "Share of people who used the Internet in the last three months. Non-use may reflect affordability, skills, or choice as well as service availability; it does not measure a broadband outage.",
    usedFor: "Internet participation gap as an explicitly limited proxy for access; never an estimate of people affected by an infrastructure failure.",
    gap: true, proxy: true },
  { code: "SE.PRM.UNER.ZS", category: "education", kind: "access_gap_percent", unit: "%",
    title: "Primary-school-age children out of school", publisher: "UNESCO Institute for Statistics via World Bank",
    description: "Share of children of primary-school age who are not enrolled in primary or secondary education. Non-enrollment has multiple causes and does not establish a shortage of school buildings.",
    usedFor: "School participation gap as a limited proxy for education access.", proxy: true },
  { code: "SE.PRM.UNER", category: "education", kind: "affected_population", unit: "children",
    title: "Number of primary-school-age children out of school", publisher: "UNESCO Institute for Statistics via World Bank",
    description: "Reported number of primary-school-age children outside primary or secondary education. It is not a count of people affected by the submitted reports or proof of infrastructure failure.",
    usedFor: "Population affected by non-enrollment; a contextual education measure, with no claim about the cause.", proxy: true },
  { code: "SN.ITK.MSFI.ZS", category: "food", kind: "access_gap_percent", unit: "%",
    title: "Moderate or severe food insecurity", publisher: "Food and Agriculture Organization of the United Nations via World Bank",
    description: "Share of people in households experiencing moderate or severe food insecurity. This measures food-access difficulties, not specifically a lack of grocery stores.",
    usedFor: "Food-access gap and, with same-year population, an estimated count of people experiencing food insecurity.",
    affected: true, proxy: true },
].map((item) => Object.freeze(item)));

const definitions = new Map(ANALYSIS_INDICATORS.map((item) => [item.code, item]));

function abortError() {
  const error = new Error("Evidence request cancelled.");
  error.name = "AbortError";
  return error;
}

function assertActive(signal) { if (signal?.aborted) throw abortError(); }

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  const time = value === undefined ? Date.now() : Number(value);
  if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getUTCFullYear())) {
    throw new TypeError("A valid evidence retrieval date is required.");
  }
  return time;
}

function emptyResult(region, countryCode, note) {
  return { regionId: region?.id || null, countryCode, status: "unavailable",
    indicators: [], sources: [], notes: [note], unavailableCategories: [], retrievedAt: null };
}

function indicatorUrl(code, countryCode, year) {
  const url = new URL(`${WORLD_BANK_API}/country/${countryCode}/indicator/${code}`);
  url.searchParams.set("source", "2");
  url.searchParams.set("format", "json");
  url.searchParams.set("date", `${year - MAX_AGE_YEARS}:${year}`);
  url.searchParams.set("per_page", String(MAX_ROWS));
  return url.href;
}

async function requestJson(url, { fetchImpl, signal, timeoutMs }) {
  assertActive(signal);
  const controller = new AbortController();
  let stop, timer;
  const interrupted = new Promise((_, reject) => {
    stop = () => { controller.abort(); reject(abortError()); };
    signal?.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The statistics provider did not respond in time."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([interrupted, (async () => {
      const response = await fetchImpl(url, { signal: controller.signal, credentials: "omit",
        referrerPolicy: "no-referrer", headers: { Accept: "application/json" } });
      if (!response?.ok) throw new Error("The statistics provider could not be reached.");
      const size = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) throw new Error("Statistics response was too large.");
      // Read with a strict limit when the browser exposes a stream. The json()
      // fallback also supports small test responses and older implementations.
      if (!response.body?.getReader) return await response.json();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let total = 0, body = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_RESPONSE_BYTES) throw new Error("Statistics response was too large.");
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
        return JSON.parse(body);
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally { reader.releaseLock(); }
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

function validRows(payload, definition, countryCode, year) {
  if (!Array.isArray(payload) || payload.length !== 2 || !payload[0] ||
      !Array.isArray(payload[1]) || payload[1].length > MAX_ROWS ||
      Number(payload[0].pages) > 1 || payload[0].message ||
      (payload[0].sourceid != null && String(payload[0].sourceid) !== "2")) {
    throw new Error("Statistics response could not be verified.");
  }
  const rows = [];
  const seen = new Set();
  for (const row of payload[1]) {
    // Reject a response for a different place/series, including aggregate codes.
    if (row?.country?.id !== countryCode || row?.countryiso3code !== COUNTRY_ALPHA3[countryCode] ||
        row?.indicator?.id !== definition.code || !/^\d{4}$/.test(String(row?.date))) {
      throw new Error("Statistics response was for a different place or indicator.");
    }
    const rowYear = Number(row.date);
    if (seen.has(rowYear)) throw new Error("Statistics response contained duplicate years.");
    seen.add(rowYear);
    if (rowYear < year - MAX_AGE_YEARS || rowYear > year || row.value === null || row.value === undefined) continue;
    // Forecasts and numeric strings are not observations. Keep unavailable
    // values missing instead of coercing null to zero or parsing a range.
    if (row.obs_status === "F" || !Number.isFinite(row.value) || row.value < 0 ||
        ((definition.unit === "%" || definition.unit === "index points") && row.value > 100) ||
        (definition.unit === "people" && row.value > 20_000_000_000) ||
        (definition.unit === "children" && row.value > 2_000_000_000)) continue;
    rows.push({ year: rowYear, value: row.value });
  }
  return rows.sort((a, b) => b.year - a.year);
}

function sourceFor(definition, observation, countryCode, countryName, retrievedAt, exact) {
  return {
    id: `wb:${countryCode}:${definition.code}:${observation.year}`,
    title: definition.title, publisher: definition.publisher,
    url: `https://data.worldbank.org/indicator/${definition.code}?locations=${countryCode}`,
    dataUrl: `${WORLD_BANK_API}/country/${countryCode}/indicator/${definition.code}?source=2&format=json&date=${observation.year}`,
    metadataUrl: `https://databank.worldbank.org/metadataglossary/world-development-indicators/series/${definition.code}`,
    usedFor: exact ? definition.usedFor : `National context only; excluded from local priority scoring and local affected-population estimates. ${definition.usedFor}`,
    year: observation.year, countryCode,
    geography: countryName, geographyLevel: "country", retrievedAt,
  };
}

function buildEvidence(region, countryCode, response, now) {
  const exact = region.kind === "country" && region.id === countryCode;
  const countryName = region.country || (exact ? region.name : countryCode) || countryCode;
  const scope = { regionId: countryCode, countryCode, level: "country", name: countryName };
  const sources = new Map(), indicators = [];
  const source = (definition, observation) => {
    const item = sourceFor(definition, observation, countryCode, countryName, response.retrievedAt, exact);
    sources.set(item.id, item);
    return item;
  };
  const make = (definition, observation, extra = {}) => {
    const primary = source(definition, observation);
    const result = {
      id: `${countryCode}:${definition.code}:${observation.year}`, category: definition.category,
      kind: definition.kind, value: observation.value, unit: definition.unit, year: observation.year,
      scope: { ...scope }, source: primary, sources: [primary], sourceIds: [primary.id],
      title: definition.title, description: definition.description, usedFor: primary.usedFor,
      eligibleForScore: exact, isProxy: Boolean(definition.proxy), isEstimate: false,
      ...extra,
    };
    indicators.push(result);
    return result;
  };

  for (const definition of ANALYSIS_INDICATORS) {
    const observation = response.series[definition.code]?.[0];
    if (!observation) continue;
    const base = make(definition, observation);
    if (definition.gap) {
      make(definition, observation, {
        id: `${base.id}:gap`, title: definition.category === "water" ? "People without basic drinking water service"
          : definition.category === "healthcare" ? "Essential health-service coverage index gap" : "People not using the Internet",
        kind: definition.kind === "access_index" ? "access_gap_index" : "access_gap_percent",
        value: 100 - observation.value,
        description: definition.category === "water" ? "Share of people without at least basic drinking water service, calculated as 100 minus the reported access percentage. This is not a measure of all sanitation or water-safety problems."
          : definition.category === "healthcare" ? "Difference between 100 and the essential health-service coverage index. This is an index gap, not a percentage of people without healthcare."
          : "Share of people who did not use the Internet in the last three months, calculated as 100 minus reported use. Non-use can reflect affordability, skills or choice as well as availability; it does not establish an infrastructure failure.",
        calculation: definition.kind === "access_index" ? "100 − service coverage index" : "100 − reported percentage",
      });
    }
    if (definition.affected) {
      // No nearest-year substitutions, national-to-local allocation, or sum of
      // overlapping categories. Both measurements must describe the same year.
      const population = response.series["SP.POP.TOTL"]?.find((item) => item.year === observation.year);
      if (!population || population.value <= 0) continue;
      const populationSource = source(definitions.get("SP.POP.TOTL"), population);
      const gap = definition.kind === "access_percent" ? 100 - observation.value : observation.value;
      make(definition, observation, {
        id: `${base.id}:affected`, kind: "affected_population", unit: "people",
        value: Math.round(population.value * gap / 100), isEstimate: true,
        title: definition.category === "water" ? "Estimated people without basic drinking water service" : "Estimated people experiencing moderate or severe food insecurity",
        description: definition.category === "water" ? "Estimated from the national share without basic drinking water service and national population in the same year. It does not measure sanitation, water safety, or people affected by submitted reports."
          : "Estimated from the national food-insecurity rate and national population in the same year. Food insecurity can arise from many causes, including affordability; this is not proof of infrastructure failure.",
        calculation: `${population.value} × ${gap} / 100`,
        sources: [base.source, populationSource], sourceIds: [base.source.id, populationSource.id],
      });
    }
  }
  const presentCategories = new Set(indicators.map((item) => item.category));
  const unavailableCategories = ["healthcare", "medication_access", "education", "roads", "transportation",
    "water", "broadband", "food", "fuel", "emergency_response", "other"].filter((category) => !presentCategories.has(category));
  const notes = [];
  if (!exact && indicators.length) notes.push(`These statistics describe ${countryName} as a whole. They are national context, not estimates for ${region.name || "the selected region"}, and do not contribute to its priority scores.`);
  if (!indicators.length) notes.push("No verified statistics were available from this provider for the selected country in the past ten years.");
  if (response.failed.length) notes.push("Some statistics could not be loaded or verified. Missing values are not treated as zero.");
  notes.push("Measurements may refer to different years. National indicators describe broader service gaps; they do not establish the number of people affected by individual reports.");
  return { regionId: region.id, countryCode,
    status: !indicators.length ? "unavailable" : response.failed.length || !exact ? "partial" : "ready",
    indicators, sources: [...sources.values()], notes, unavailableCategories,
    retrievedAt: response.retrievedAt, checkedAt: new Date(now).toISOString() };
}

/**
 * Load public, national statistics with their measurement years and provenance.
 * A subregion receives explicitly ineligible national context, never invented
 * local estimates. The consumer should abort when its selected region changes.
 */
export async function loadAnalysisEvidence(region, {
  fetchImpl = globalThis.fetch, signal, now, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  assertActive(signal);
  const time = timestamp(now), year = new Date(time).getUTCFullYear();
  const countryCode = typeof region?.countryCode === "string" ? region.countryCode.toUpperCase() : "";
  if (!region?.id || region.kind === "world" || !Object.hasOwn(COUNTRY_ALPHA3, countryCode)) {
    return emptyResult(region, countryCode || null, "Select a country or region to load verified statistics.");
  }
  if (typeof fetchImpl !== "function") return emptyResult(region, countryCode, "Online statistics are unavailable in this browser.");
  const timeout = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(60_000, timeoutMs)) : DEFAULT_TIMEOUT_MS;
  let cache = cacheByFetch.get(fetchImpl);
  if (!cache) { cache = new Map(); cacheByFetch.set(fetchImpl, cache); }
  const key = `${countryCode}:${year}`;
  const cached = cache.get(key);
  if (cached && time >= cached.time && time - cached.time < CACHE_TTL_MS) {
    cache.delete(key); cache.set(key, cached);
    return buildEvidence(region, countryCode, cached.value, time);
  }
  if (cached) cache.delete(key);
  const value = { series: {}, failed: [], retrievedAt: new Date(time).toISOString() };
  // Independent series preserve available data when one indicator has no
  // coverage. Three requests at a time keep concurrency bounded.
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < ANALYSIS_INDICATORS.length) {
      assertActive(signal);
      const definition = ANALYSIS_INDICATORS[next++];
      try {
        const json = await requestJson(indicatorUrl(definition.code, countryCode, year), { fetchImpl, signal, timeoutMs: timeout });
        assertActive(signal);
        value.series[definition.code] = validRows(json, definition, countryCode, year);
      } catch (error) {
        if (signal?.aborted || error.name === "AbortError") throw abortError();
        value.failed.push(definition.code);
      }
    }
  }));
  assertActive(signal);
  // Cache complete retrievals only. A failed/offline request can be retried on
  // the next visit instead of persisting an absence of data for an hour.
  if (!value.failed.length) {
    cache.set(key, { time, value });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  return buildEvidence(region, countryCode, value, time);
}

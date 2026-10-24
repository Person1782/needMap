import { COUNTRY_ALPHA3 } from "./country-alpha3.js";

export const PLAN_COST_INDICATOR = "PA.NUS.GDP.PLI";
export const PLAN_COST_PRICE_YEAR = 2024;

const WORLD_BANK_API = "https://api.worldbank.org/v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 48;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_ROWS = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const cacheByFetch = new WeakMap();

function abortError() {
  const error = new Error("Local cost evidence request cancelled.");
  error.name = "AbortError";
  return error;
}

function assertActive(signal) {
  if (signal?.aborted) throw abortError();
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  const time = value === undefined ? Date.now() : Number(value);
  if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getUTCFullYear())) {
    throw new TypeError("A valid local-cost evidence retrieval date is required.");
  }
  return time;
}

function countryCodeFor(region) {
  const value = typeof region?.countryCode === "string" ? region.countryCode.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(value) && Object.hasOwn(COUNTRY_ALPHA3, value) ? value : null;
}

function countryNameFor(region, countryCode) {
  if (typeof region?.country === "string" && region.country.trim()) return region.country.trim();
  if (region?.kind === "country" && typeof region.name === "string" && region.name.trim()) return region.name.trim();
  return countryCode;
}

function evidenceUrl(countryCode, priceYear = PLAN_COST_PRICE_YEAR) {
  const url = new URL(`${WORLD_BANK_API}/country/${countryCode}/indicator/${PLAN_COST_INDICATOR}`);
  url.searchParams.set("source", "2");
  url.searchParams.set("format", "json");
  url.searchParams.set("date", String(priceYear));
  url.searchParams.set("per_page", String(MAX_ROWS));
  return url.href;
}

async function requestJson(url, { fetchImpl, signal, timeoutMs }) {
  assertActive(signal);
  const controller = new AbortController();
  let stop;
  let timer;
  const interrupted = new Promise((_, reject) => {
    stop = () => { controller.abort(); reject(abortError()); };
    signal?.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The World Bank cost evidence request timed out."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([interrupted, (async () => {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
      });
      if (!response?.ok) throw new Error("World Bank cost evidence could not be reached.");
      const size = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) throw new Error("World Bank cost evidence response was too large.");
      if (!response.body?.getReader) return await response.json();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let total = 0;
      let body = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_RESPONSE_BYTES) throw new Error("World Bank cost evidence response was too large.");
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
        return JSON.parse(body);
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

function observationFrom(payload, countryCode, priceYear) {
  if (!Array.isArray(payload) || payload.length !== 2 || !payload[0] || !Array.isArray(payload[1])) {
    throw new Error("World Bank cost evidence response could not be verified.");
  }
  const [metadata, rows] = payload;
  const page = Number(metadata.page);
  const pages = Number(metadata.pages);
  const total = Number(metadata.total);
  if (metadata.message || page !== 1 || pages !== 1 || !Number.isInteger(total) || total !== rows.length ||
      total > MAX_ROWS || rows.length > MAX_ROWS || String(metadata.sourceid) !== "2") {
    throw new Error("World Bank cost evidence response could not be verified.");
  }
  let observation = null;
  let seen = false;
  for (const row of rows) {
    if (row?.country?.id !== countryCode || row?.countryiso3code !== COUNTRY_ALPHA3[countryCode] ||
        row?.indicator?.id !== PLAN_COST_INDICATOR || String(row?.date) !== String(priceYear)) {
      throw new Error("World Bank cost evidence described a different country, year, or indicator.");
    }
    if (seen) throw new Error("World Bank cost evidence contained a duplicate observation.");
    seen = true;
    if (row.value == null || row.obs_status === "F") continue;
    if (!Number.isFinite(row.value) || row.value <= 0 || row.value > 10_000) {
      throw new Error("World Bank price-level observation was invalid.");
    }
    observation = Object.freeze({ year: priceYear, value: row.value });
  }
  return observation;
}

function unavailable(region, countryCode, reason) {
  return Object.freeze({
    status: "unavailable",
    regionId: region?.id || null,
    countryCode,
    adjustment: null,
    reason,
  });
}

function resultFor(region, countryCode, observation) {
  const countryName = countryNameFor(region, countryCode);
  // The World Bank defines the U.S. as 100 for this indicator. Preserve enough
  // precision to reproduce the source value without presenting it as a quote.
  const multiplier = Number((observation.value / 100).toPrecision(10));
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
    return unavailable(region, countryCode, "The verified price-level observation could not produce a safe multiplier.");
  }
  const valueText = observation.value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  const multiplierText = multiplier.toLocaleString("en-US", { maximumFractionDigits: 6 });
  const dataPage = `https://data.worldbank.org/indicator/${PLAN_COST_INDICATOR}?locations=${countryCode}`;
  const limitation = "This is a national economy-wide price-level proxy, not a construction cost index. It does not measure subnational differences, land, taxes, imported equipment, financing, or project-specific conditions.";
  const method = `World Bank ${observation.year} GDP price-level index ${valueText} divided by the United States reference value 100, giving ${multiplierText}. ${limitation}`;
  const source = Object.freeze({
    title: `Price level index (GDP) — ${countryName}`,
    publisher: "World Bank, World Development Indicators",
    year: observation.year,
    url: dataPage,
    usedFor: `NeedMap's broad national price-level adjustment: ${valueText} ÷ 100 = ${multiplierText}. ${limitation}`,
  });
  const adjustment = Object.freeze({
    multiplier,
    geography: `${countryName} national price level; no subnational adjustment`,
    method,
    source,
  });
  return Object.freeze({
    status: "ready",
    regionId: region?.id || null,
    countryCode,
    countryName,
    indicator: Object.freeze({ code: PLAN_COST_INDICATOR, year: observation.year, value: observation.value }),
    adjustment,
  });
}

/**
 * Loads a free, keyless World Bank GDP price-level index for the selected
 * region's country. A result is used only when it matches the benchmark's 2024
 * price year. Missing or unverifiable data leaves the source benchmark intact.
 */
export async function loadPlanLocalCostAdjustment(region, {
  fetchImpl = globalThis.fetch,
  signal,
  now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  priceYear = PLAN_COST_PRICE_YEAR,
} = {}) {
  assertActive(signal);
  const time = timestamp(now);
  const countryCode = countryCodeFor(region);
  if (!region?.id || region.kind === "world" || !countryCode) {
    return unavailable(region, countryCode, "Select a country or region to load a verified national price-level adjustment.");
  }
  if (!Number.isInteger(priceYear) || priceYear < 1900 || priceYear > new Date(time).getUTCFullYear()) {
    throw new RangeError("A valid benchmark price year is required.");
  }
  if (typeof fetchImpl !== "function") {
    return unavailable(region, countryCode, "Online World Bank price-level evidence is unavailable in this browser.");
  }

  let cache = cacheByFetch.get(fetchImpl);
  if (!cache) { cache = new Map(); cacheByFetch.set(fetchImpl, cache); }
  const key = `${countryCode}:${priceYear}`;
  const cached = cache.get(key);
  if (cached && time >= cached.time && time - cached.time < CACHE_TTL_MS) {
    cache.delete(key);
    cache.set(key, cached);
    return resultFor(region, countryCode, cached.observation);
  }
  if (cached) cache.delete(key);

  let observation;
  try {
    const payload = await requestJson(evidenceUrl(countryCode, priceYear), {
      fetchImpl,
      signal,
      timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1, Math.min(60_000, timeoutMs)) : DEFAULT_TIMEOUT_MS,
    });
    assertActive(signal);
    observation = observationFrom(payload, countryCode, priceYear);
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw abortError();
    return unavailable(region, countryCode, "No verified World Bank price-level adjustment is available, so NeedMap keeps the cited benchmark unlocalized.");
  }
  if (!observation) {
    return unavailable(region, countryCode, `World Bank has no verified ${priceYear} GDP price-level observation for this country, so NeedMap keeps the cited benchmark unlocalized.`);
  }
  cache.set(key, { time, observation });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return resultFor(region, countryCode, observation);
}

/** Owns the single Plans price-level request and makes tab changes cancellable. */
export function createPlanLocalCostLoader({
  load = loadPlanLocalCostAdjustment,
  onLoading = () => () => {},
  loadingLabel = () => "Loading…",
  onStateChange = () => {},
} = {}) {
  let state = { countryCode: null, status: "idle", adjustment: null };
  let controller;
  let releaseLoading;
  let revision = 0;
  let destroyed = false;

  function publish(next, notify = true) {
    state = next;
    if (notify && !destroyed) onStateChange(state);
  }

  function cancel() {
    if (state.status !== "loading") return false;
    revision += 1;
    controller?.abort(); controller = undefined;
    releaseLoading?.(); releaseLoading = undefined;
    publish({ countryCode: state.countryCode, status: "idle", adjustment: null }, false);
    return true;
  }

  async function ensure(region) {
    if (destroyed) return state;
    const countryCode = countryCodeFor(region);
    if (!countryCode || region?.kind === "world") {
      if (state.status === "unavailable" && state.countryCode === null) return state;
      cancel(); revision += 1;
      publish({ countryCode: null, status: "unavailable", adjustment: null });
      return state;
    }
    if (state.countryCode === countryCode && ["loading", "ready", "unavailable"].includes(state.status)) return state;

    cancel();
    const currentController = new AbortController();
    controller = currentController;
    const currentRevision = ++revision;
    publish({ countryCode, status: "loading", adjustment: null }, false);
    const stopLoading = onLoading({ key: "plans-local-cost", label: loadingLabel() }) || (() => {});
    releaseLoading = stopLoading;
    try {
      const result = await load(region, { signal: currentController.signal });
      if (destroyed || currentController.signal.aborted || currentRevision !== revision) return state;
      publish({ countryCode, status: result.status, adjustment: result.adjustment });
    } catch (error) {
      if (!destroyed && !currentController.signal.aborted && currentRevision === revision && error?.name !== "AbortError") {
        publish({ countryCode, status: "unavailable", adjustment: null });
      }
    } finally {
      stopLoading();
      if (releaseLoading === stopLoading) releaseLoading = undefined;
      if (controller === currentController) controller = undefined;
    }
    return state;
  }

  return {
    ensure,
    cancel,
    get state() { return state; },
    destroy() {
      if (destroyed) return;
      destroyed = true; revision += 1;
      controller?.abort(); controller = undefined;
      releaseLoading?.(); releaseLoading = undefined;
    },
  };
}

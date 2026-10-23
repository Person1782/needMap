import { buildReportPopulationArea, REPORT_POPULATION_RADIUS_METERS } from "./report-population-area.js";

export const WORLDPOP_POPULATION_API = "https://api.worldpop.org/v2";
export const WORLDPOP_POPULATION_YEAR = 2025;
const DATASET = "worldpop_R2025A_2025_100m";
const TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 12;
const MAX_POLLS = 30;
const MAX_RESPONSE_BYTES = 128 * 1024;
const cacheByFetch = new WeakMap();

function abortError() {
  return new DOMException("Population request cancelled.", "AbortError");
}

function assertActive(signal) {
  if (signal?.aborted) throw abortError();
}

function wait(delay, signal) {
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, delay);
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function readJson(response) {
  if (!response?.ok) throw new Error("WorldPop could not be reached.");
  if (Number(response.headers?.get?.("content-length")) > MAX_RESPONSE_BYTES) {
    throw new Error("Population response was too large.");
  }
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error("Population response was too large.");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

function validatedPopulation(result, polygonCount) {
  if (!result || !Number.isFinite(result.total_population) || result.total_population < 0 ||
      result.total_population > 20_000_000_000 || result.data_year !== WORLDPOP_POPULATION_YEAR ||
      result.data_source !== DATASET || !Number.isFinite(result.area_km2) || result.area_km2 <= 0) {
    throw new Error("Population response could not be verified.");
  }
  // The v2 service returns one component result per disjoint polygon. Reject a
  // partial result instead of silently presenting its sum as the whole area.
  if (polygonCount > 1 || result.polygons !== undefined) {
    if (!Array.isArray(result.polygons) || result.polygons.length !== polygonCount) {
      throw new Error("Population coverage was incomplete.");
    }
    const indexes = new Set();
    let sum = 0;
    for (const item of result.polygons) {
      if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= polygonCount ||
          indexes.has(item.index) || !Number.isFinite(item.population) || item.population < 0 ||
          !Number.isFinite(item.area_km2) || item.area_km2 <= 0 || item.error) {
        throw new Error("Population coverage was incomplete.");
      }
      indexes.add(item.index);
      sum += item.population;
    }
    // WorldPop rounds each polygon independently to two decimal places.
    if (Math.abs(sum - result.total_population) > 0.01 * polygonCount + 0.001) {
      throw new Error("Population components did not match the total.");
    }
  }
  return result.total_population;
}

async function queryPopulation(geometry, { signal, fetchImpl, pollDelayMs }) {
  const request = async (url, options = {}) => {
    assertActive(signal);
    return readJson(await fetchImpl(url, {
      ...options, signal, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
      headers: { Accept: "application/json", ...options.headers },
    }));
  };
  const submitted = await request(`${WORLDPOP_POPULATION_API}/population`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geojson: geometry, year: WORLDPOP_POPULATION_YEAR, resolution: "100m" }),
  });
  const id = submitted?.task_id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "") ||
      !["pending", "progress", "success"].includes(submitted.status) || submitted.error) {
    throw new Error("WorldPop did not accept the population request.");
  }
  // The current service advertises an obsolete /api/v1/ check_url. Construct
  // the documented v2 route ourselves; never follow URLs from remote JSON.
  const url = `${WORLDPOP_POPULATION_API}/tasks/${id}`;
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    if (attempt) await wait(pollDelayMs, signal);
    const task = await request(url);
    if (task?.task_id !== id || task.error) throw new Error("Population calculation failed.");
    if (task.status === "success") return validatedPopulation(task.result, geometry.coordinates.length);
    if (!["pending", "progress", "started", "processing"].includes(task.status)) {
      throw new Error("Population calculation failed.");
    }
  }
  throw new Error("Population calculation took too long.");
}

async function withDeadline(operation, signal, timeoutMs) {
  assertActive(signal);
  const controller = new AbortController();
  let stop, timer;
  const interrupted = new Promise((_, reject) => {
    stop = () => { controller.abort(); reject(abortError()); };
    signal?.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Population calculation took too long."));
    }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), interrupted]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

/** Estimates residents near the supplied reports, never confirmed impact. */
export async function loadReportPopulation({ reports = [], region = null } = {}, {
  signal, fetchImpl = globalThis.fetch, timeoutMs = 60_000, pollDelayMs = 1_500, now = Date.now,
} = {}) {
  assertActive(signal);
  let area;
  const base = { radiusMeters: REPORT_POPULATION_RADIUS_METERS, reportCount: 0,
    year: WORLDPOP_POPULATION_YEAR };
  try {
    area = buildReportPopulationArea(reports, region);
    base.reportCount = area.reportCount;
    if (area.missingLocationCount) return { ...base, status: "unavailable",
      message: "Some reports have no usable location, so their nearby population cannot be estimated." };
    if (!area.reportCount) return { ...base, status: "empty", message: "No reports in this selection." };
    if (!area.geometry) return { ...base, status: "unavailable",
      message: "No report neighborhoods fall inside the selected region." };
    if (typeof fetchImpl !== "function") throw new Error("Population provider unavailable.");
    const timestamp = typeof now === "function" ? now() : now;
    if (!Number.isFinite(timestamp)) throw new Error("Invalid retrieval date.");
    const key = JSON.stringify([WORLDPOP_POPULATION_YEAR, area.geometry]);
    let cache = cacheByFetch.get(fetchImpl);
    if (!cache) { cache = new Map(); cacheByFetch.set(fetchImpl, cache); }
    const cached = cache.get(key);
    if (cached && timestamp >= cached.time && timestamp - cached.time < TTL_MS) {
      cache.delete(key); cache.set(key, cached);
      return { ...base, status: "ready", value: cached.value, retrievedAt: cached.retrievedAt };
    }
    cache.delete(key);
    const value = await withDeadline((activeSignal) => queryPopulation(area.geometry, {
      signal: activeSignal, fetchImpl,
      pollDelayMs: Number.isFinite(pollDelayMs) ? Math.max(0, Math.min(5000, pollDelayMs)) : 1500,
    }), signal, Number.isFinite(timeoutMs) ? Math.max(1, Math.min(60_000, timeoutMs)) : 60_000);
    assertActive(signal);
    const retrievedAt = new Date(timestamp).toISOString();
    cache.set(key, { value, retrievedAt, time: timestamp });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return { ...base, status: "ready", value, retrievedAt };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    return { ...base, status: "unavailable",
      message: "Population data is unavailable for this selection. No estimate is shown." };
  }
}

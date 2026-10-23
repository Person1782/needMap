export const WORLD_REGION_BOUNDARY_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024, maxPositions: 1000000, maxRegions: 64,
  timeoutMs: 15000, cacheEntries: 8,
});
const VERSION = "needmap-v2";
const SOURCE = "geoBoundaries CGAZ";
const DERIVED_SOURCE = "NeedMap regions grouped from geoBoundaries administrative areas";
// These two catalog identities describe the same territory. Its complete island
// geometry is pinned separately because the CGAZ record omits Rose and Swains.
const NATURAL_EARTH_BOUNDARIES = Object.freeze({
  AS: { file: "data/regions/as.json", kind: "country", countryCode: "AS" },
  "US-AS": { file: "data/regions/us-as.json", kind: "state", countryCode: "US" },
});
const NATURAL_EARTH_VERSION = "5.1.1";
const caches = new WeakMap();

function boundaryError(message) {
  return new Error(`Region boundaries unavailable: ${message}`);
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Request aborted.", "AbortError");
}

function cancelQuietly(target, reason) {
  try { Promise.resolve(target?.cancel?.(reason)).catch(() => {}); }
  catch { /* Cancellation should not delay or replace the original error. */ }
}

/** Abort promptly even when a fetch implementation or response ignores signal. */
function abortable(operation, signal, discard = () => {}) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return false;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
      return true;
    };
    const abort = () => finish(reject, signal.reason || new DOMException("Request aborted.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      Promise.resolve(operation()).then((value) => {
        if (!finish(resolve, value)) discard(value);
      }, (error) => finish(reject, error));
    } catch (error) { finish(reject, error); }
  });
}

function resolveEntry(entry) {
  const validId = (id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(id);
  const countryCode = entry?.countryCode;
  const parentId = entry?.kind === "needmap" ? entry.parentId : entry?.id;
  if (!validId(entry?.id) || !validId(parentId) || !/^[A-Z]{2}$/.test(countryCode || "") ||
      !["state", "country", "needmap"].includes(entry?.kind)) {
    throw boundaryError("the requested region identification is invalid.");
  }
  const file = entry.boundaryFile;
  if (typeof file !== "string" || !/^data\/regions\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/.test(file) ||
      file.includes("..")) throw boundaryError("the boundary file must be a safe local data path.");
  const page = new URL(globalThis.location?.href || "http://localhost/");
  const base = new URL(import.meta.env?.BASE_URL || "./", page);
  const url = new URL(file, base);
  if (!["http:", "https:"].includes(page.protocol) || url.origin !== page.origin ||
      url.username || url.password || url.search || url.hash) {
    throw boundaryError("the boundary URL must use this website's origin.");
  }
  const naturalEarth = NATURAL_EARTH_BOUNDARIES[parentId];
  const registeredNaturalEarth = naturalEarth?.file === file && naturalEarth.countryCode === countryCode;
  return { parentId, countryCode, url, entryId: entry.id, entryKind: entry.kind,
    source: registeredNaturalEarth ? "Natural Earth" : SOURCE,
    sourceVersion: registeredNaturalEarth ? NATURAL_EARTH_VERSION : null,
    parentKind: registeredNaturalEarth ? naturalEarth.kind : null };
}

async function readBoundedText(response, signal) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > WORLD_REGION_BOUNDARY_LIMITS.maxBytes) {
    cancelQuietly(response.body);
    throw boundaryError("the download exceeds the size limit.");
  }
  if (!response.body?.getReader) {
    const text = await abortable(() => response.text(), signal);
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > WORLD_REGION_BOUNDARY_LIMITS.maxBytes) {
      throw boundaryError("the download exceeds the size limit.");
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await abortable(() => reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > WORLD_REGION_BOUNDARY_LIMITS.maxBytes) throw boundaryError("the download exceeds the size limit.");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    cancelQuietly(reader, error);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* A nonstandard reader may ignore cancellation. */ }
  }
}

function validateSet(value, expected) {
  if (value?.version !== VERSION || value.parentId !== expected.parentId ||
      !Array.isArray(value.regions) || !value.regions.length ||
      value.regions.length > WORLD_REGION_BOUNDARY_LIMITS.maxRegions) {
    throw boundaryError("the region set is incomplete or belongs to a different parent.");
  }
  const ids = new Set();
  let positions = 0, preceding = [];
  const result = value.regions.map((record, index) => {
    const parent = index === 0;
    if (!record || typeof record.id !== "string" || ids.has(record.id) ||
        typeof record.name !== "string" || !record.name.trim() || record.name.length > 300 ||
        record.countryCode !== expected.countryCode ||
        (parent ? record.id !== expected.parentId || !["state", "country"].includes(record.kind) ||
          (record.parentId !== undefined && record.parentId !== null && record.parentId !== "")
          : record.kind !== "needmap" || record.parentId !== expected.parentId ||
            !record.id.startsWith(`${expected.parentId}:${VERSION}:`) || record.id.length > 250)) {
      throw boundaryError("a region has invalid, duplicate, or mixed-parent identification.");
    }
    if (expected.source === "Natural Earth"
      ? record.source !== expected.source || record.sourceVersion !== expected.sourceVersion || (parent && record.kind !== expected.parentKind)
      : record.source !== undefined && record.source !== SOURCE && !(!parent && record.source === DERIVED_SOURCE)) {
      throw boundaryError("the boundary source does not match its verified catalog metadata.");
    }
    ids.add(record.id);
    const geometry = record.geometry;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon" ? geometry.coordinates : null;
    let south = 90, north = -90, west = 180, east = -180, crossesDateline = false;
    const validRing = (ring) => {
      if (!Array.isArray(ring) || ring.length < 4) return false;
      const distinct = new Set();
      for (let index = 0; index < ring.length; index += 1) {
        const point = ring[index];
        positions += 1;
        if (positions > WORLD_REGION_BOUNDARY_LIMITS.maxPositions || !Array.isArray(point) ||
            point.length < 2 || point.length > 3 || !point.every(Number.isFinite) ||
            Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return false;
        const [longitude, latitude] = point;
        if (distinct.size < 3) distinct.add(`${longitude}:${latitude}`);
        south = Math.min(south, latitude); north = Math.max(north, latitude);
        west = Math.min(west, longitude); east = Math.max(east, longitude);
        if (index && Math.abs(longitude - ring[index - 1][0]) > 180) crossesDateline = true;
      }
      return distinct.size >= 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
    };
    if (!Array.isArray(polygons) || !polygons.length || !polygons.every((polygon) =>
      Array.isArray(polygon) && polygon.length > 0 && polygon.every(validRing))) {
      throw boundaryError("an administrative polygon is invalid or too complex.");
    }
    if (crossesDateline || east - west > 300) { west = -180; east = 180; }
    const latitude = (number) => Math.max(-85, Math.min(85, number));
    const region = {
      id: record.id, name: record.name.trim(), kind: record.kind,
      countryCode: record.countryCode, parentId: parent ? null : expected.parentId,
      geometry: { type: geometry.type, coordinates: geometry.coordinates },
      bounds: [[latitude(south), west], [latitude(north), east]], source: expected.source,
      ...(expected.sourceVersion ? { sourceVersion: expected.sourceVersion } : {}),
    };
    if (!parent) {
      region.parentName = value.regions[0].name.trim();
      region.excludedGeometry = preceding.length ? { type: "MultiPolygon", coordinates: preceding } : null;
      preceding = [...preceding, ...polygons];
    }
    return region;
  });
  const requested = result.find((record) => record.id === expected.entryId);
  if (!requested || requested.kind !== expected.entryKind) throw boundaryError("the requested region is missing from its boundary file.");
  return result;
}

/** Load one precomputed parent and all its children from this site's static data. */
export async function loadWorldRegionSet(entry, {
  signal, fetchImpl = globalThis.fetch, timeoutMs = WORLD_REGION_BOUNDARY_LIMITS.timeoutMs,
} = {}) {
  checkAbort(signal);
  if (typeof fetchImpl !== "function") throw boundaryError("network requests are unavailable.");
  const expected = resolveEntry(entry);
  const key = `${expected.url.href}|${expected.parentId}|${expected.countryCode}`;
  let cache = caches.get(fetchImpl);
  if (!cache) { cache = new Map(); caches.set(fetchImpl, cache); }
  if (cache.has(key)) {
    const cached = cache.get(key);
    if (!cached.some((record) => record.id === expected.entryId && record.kind === expected.entryKind)) {
      throw boundaryError("the requested region is missing from its boundary file.");
    }
    cache.delete(key); cache.set(key, cached);
    return cached;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, WORLD_REGION_BOUNDARY_LIMITS.timeoutMs) : WORLD_REGION_BOUNDARY_LIMITS.timeoutMs;
  const timeout = setTimeout(() => controller.abort(new DOMException("Region lookup timed out.", "TimeoutError")), duration);
  try {
    const response = await abortable(() => fetchImpl(expected.url.href, {
      method: "GET", headers: { Accept: "application/json" }, credentials: "omit",
      referrerPolicy: "no-referrer", redirect: "error", signal: controller.signal,
    }), controller.signal, (late) => cancelQuietly(late?.body));
    if (!response?.ok) throw boundaryError(`the server returned HTTP ${response?.status || "error"}.`);
    // Redirects to a different host are not part of the static-data contract.
    if (response.url && new URL(response.url).origin !== expected.url.origin) {
      cancelQuietly(response.body);
      throw boundaryError("the response redirected to another origin.");
    }
    const text = await readBoundedText(response, controller.signal);
    checkAbort(controller.signal);
    let value;
    try { value = JSON.parse(text); }
    catch { throw boundaryError("the boundary file contains invalid or truncated JSON."); }
    const regions = validateSet(value, expected);
    checkAbort(controller.signal);
    cache.set(key, regions);
    while (cache.size > WORLD_REGION_BOUNDARY_LIMITS.cacheEntries) cache.delete(cache.keys().next().value);
    return regions;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

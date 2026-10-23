import { WORLD_REGION_ROWS } from "./world-region-catalog.js";
import { COUNTRY_ALPHA3 } from "./country-alpha3.js";
import { pointInGeometry, policyLimitedFetch, REGION_ENDPOINT } from "./regions.js";
import { loadWorldRegionSet } from "./world-region-boundaries.js";

export const WORLD_REGION = Object.freeze({
  id: "world", name: "Worldwide", label: "Worldwide", kind: "world",
  geometry: null, bounds: [[-60, -180], [80, 180]],
});
const CACHE_PREFIX = "needmap-navigation-v1:";
const CACHE_AGE = 30 * 24 * 60 * 60 * 1000;
const MAX_MEMORY_PARENTS = 8;
export const SAVED_REGION_KEY = "needmap-selected-region-v1";
const SAVED_REGION_VERSION = 1;
export const IP_LOCATION_ENDPOINT = import.meta.env?.VITE_IP_LOCATION_ENDPOINT ||
  "https://get.geojs.io/v1/ip/geo.json";
const countries = new Map(WORLD_REGION_ROWS.filter((row) => row[3] === "country")
  .map(([id, name]) => [id, name]));
const normalize = (value) => String(value || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[—–&]/g, " ").toLowerCase().trim();
const names = new Map(WORLD_REGION_ROWS.map(([id, name]) => [id, name]));
const countryAliases = {
  GB: ["UK", "Britain", "Great Britain"],
  US: ["United States of America"],
  AE: ["UAE"],
  CZ: ["Czechia"],
};
const catalog = WORLD_REGION_ROWS.map(([id, name, native, kind, countryCode, parentId, boundaryFile]) => {
  const country = countries.get(countryCode) || countryCode;
  const label = kind === "country" ? name : `${name}, ${country}`;
  const parentName = names.get(parentId) || "";
  const aliases = [COUNTRY_ALPHA3[countryCode], ...(countryAliases[countryCode] || [])].filter(Boolean);
  const directions = name.replace(/\bNorth\b/g, "Northern").replace(/\bSouth\b/g, "Southern")
    .replace(/\bWest\b/g, "Western").replace(/\bEast\b/g, "Eastern");
  return {
    id, name, label, kind, country, countryCode, nativeName: native, parentId, parentName, boundaryFile,
    aliases: kind === "country" ? aliases : [],
    stateCode: kind === "state" ? id.slice(3) : null,
    searchText: normalize(`${label} ${native} ${directions} ${parentName} ${aliases.join(" ")} ${id} ${kind === "country" ? countryCode : id.slice(3)}`),
  };
});

function matchingRegions(query = "", { kind } = {}) {
  const normalized = normalize(query);
  const tokens = normalized.split(/[\s,]+/).filter(Boolean);
  return catalog.filter((entry) => (!kind || entry.kind === kind) &&
    tokens.every((token) => entry.searchText.includes(token)));
}

/** Every region is indexed before navigation; typing never downloads boundaries. */
export function searchRegions(query = "", { limit = 40, offset = 0, kind } = {}) {
  const normalized = normalize(query);
  const phrase = (value) => normalize(value).split(/[\s,]+/).filter(Boolean).join(" ");
  const fullQuery = phrase(query);
  const matches = matchingRegions(query, { kind });
  const score = (entry) => !normalized ? 0
    : normalize(entry.name) === normalized || phrase(entry.label) === fullQuery ||
      entry.aliases.some((alias) => normalize(alias) === normalized) ? 0
    : normalize(entry.id) === normalized ? 1
    : normalize(entry.stateCode) === normalized ? 2
    : normalize(entry.name).startsWith(normalized) ? 3 : 4;
  const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const length = limit === Infinity ? matches.length
    : Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 40;
  return matches.sort((first, second) => score(first) - score(second) ||
    first.label.localeCompare(second.label) || first.id.localeCompare(second.id)).slice(start, start + length)
    .map(({ searchText, ...entry }) => entry);
}

export function countRegions(query = "", options = {}) { return matchingRegions(query, options).length; }

function validCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

export function regionContains(region, latitude, longitude) {
  if (!validCoordinate(latitude, longitude)) return false;
  if (region?.kind === "needmap") return pointInGeometry(longitude, latitude, region.geometry) &&
    (!region.excludedGeometry || !pointInGeometry(longitude, latitude, region.excludedGeometry));
  return !region || region.kind === "world" ||
    pointInGeometry(longitude, latitude, region.geometry);
}

function validPolygon(polygon) {
  return Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) =>
    Array.isArray(ring) && ring.length >= 4 && ring.every((point) =>
      Array.isArray(point) && validCoordinate(point[1], point[0])) &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]);
}

function validGeometry(geometry) {
  return geometry?.type === "Polygon" ? validPolygon(geometry.coordinates)
    : geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0 && geometry.coordinates.every(validPolygon);
}

function geometryBounds(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let south = 90, north = -90, west = 180, east = -180;
  let crossesDateline = false;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let index = 0; index < ring.length; index += 1) {
        const [longitude, latitude] = ring[index];
        south = Math.min(south, latitude); north = Math.max(north, latitude);
        west = Math.min(west, longitude); east = Math.max(east, longitude);
        if (index && Math.abs(longitude - ring[index - 1][0]) > 180) crossesDateline = true;
      }
    }
  }
  // Keep both sides visible in the map's ordinary world copy. A small inverted
  // box around the date line would otherwise hide islands and report markers.
  if (crossesDateline || east - west > 300) { west = -180; east = 180; }
  const clampLatitude = (value) => Math.max(-85, Math.min(85, value));
  return [[clampLatitude(south), west], [clampLatitude(north), east]];
}

export function normalizeNavigationRegion(result, expected = null) {
  if (!result || !validGeometry(result.geojson)) return null;
  const countryCode = String(result.address?.country_code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;
  if (expected?.countryCode && countryCode !== expected.countryCode.toUpperCase()) return null;
  const type = result.addresstype || result.type;
  const kind = type === "country" ? "country" : "state";
  if (expected?.kind && expected.kind !== kind) return null;
  // Reject place/road/building shapes even when a provider unexpectedly returns
  // them for an administrative lookup.
  if (!/^(country|state|province|region|state_district|county|municipality|administrative)$/.test(type || "")) return null;
  const name = result.name || result.address?.state || result.address?.country;
  if (typeof name !== "string" || !name.trim()) return null;
  const aliases = [name, result.address?.state, result.address?.region,
    result.address?.province, ...Object.values(result.namedetails || {})].map(normalize);
  const isoCode = result.extratags?.["ISO3166-2"] || result.address?.["ISO3166-2-lvl4"] ||
    result.address?.["ISO3166-2-lvl3"] || result.address?.["ISO3166-2-lvl6"];
  if (expected?.kind === "state" && normalize(isoCode) !== normalize(expected.id) &&
      !aliases.includes(normalize(expected.name))) return null;
  const country = result.address?.country || countries.get(countryCode) || countryCode;
  return {
    id: expected?.id || (kind === "country" ? countryCode : isoCode || `osm-${result.osm_type}-${result.osm_id}`),
    name: expected?.name || name,
    label: expected?.label || (kind === "country" ? name : `${name}, ${country}`),
    kind, country, countryCode, geometry: result.geojson,
    bounds: geometryBounds(result.geojson), source: "OpenStreetMap Nominatim",
  };
}

function cachedRegion(storage, entry) {
  try {
    const cached = JSON.parse(storage?.getItem(`${CACHE_PREFIX}${entry.id}`));
    if (!cached || !Number.isFinite(cached.savedAt) || cached.savedAt > Date.now() ||
        Date.now() - cached.savedAt > CACHE_AGE) return null;
    const region = cached.region;
    if (region?.id !== entry.id || region.countryCode !== entry.countryCode ||
        region.kind !== entry.kind || !validGeometry(region.geometry)) return null;
    return { ...region, bounds: geometryBounds(region.geometry) };
  } catch { return null; }
}

function saveRegion(storage, region) {
  try { storage?.setItem(`${CACHE_PREFIX}${region.id}`, JSON.stringify({ savedAt: Date.now(), region })); }
  catch { /* Selection still works with storage disabled or full. */ }
}

function lookupUrl(path, parameters) {
  const url = new URL(`${REGION_ENDPOINT}/${path}`);
  url.search = new URLSearchParams({
    format: "jsonv2", addressdetails: "1", namedetails: "1", extratags: "1",
    polygon_geojson: "1", polygon_threshold: "0.002", "accept-language": "en", ...parameters,
  });
  return url;
}

async function resolveSelection(entry, request, storage, signal) {
  const cached = cachedRegion(storage, entry);
  if (cached) return cached;
  const result = await request(lookupUrl("search", {
    country: entry.country, countrycodes: entry.countryCode.toLowerCase(),
    ...(entry.kind === "state" ? { state: entry.name } : {}),
    featureType: entry.kind, limit: "5",
  }), signal);
  signal?.throwIfAborted();
  const region = Array.isArray(result) ? result.map((item) => normalizeNavigationRegion(item, entry)).find(Boolean) : null;
  if (!region) throw new Error(`A verified boundary for ${entry.label} is unavailable. Choose another region or Worldwide.`);
  saveRegion(storage, region);
  return region;
}

export async function loadIpRegion({
  signal, fetchImpl = globalThis.fetch, endpoint = IP_LOCATION_ENDPOINT, timeoutMs = 8000,
} = {}) {
  signal?.throwIfAborted();
  if (typeof fetchImpl !== "function") throw new Error("Automatic region detection is unavailable.");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET", headers: { Accept: "application/json" },
      credentials: "omit", cache: "no-store", referrerPolicy: "strict-origin-when-cross-origin",
      signal: controller.signal,
    });
    controller.signal.throwIfAborted();
    if (!response.ok) throw new Error(`IP region lookup failed with status ${response.status}.`);
    const value = await response.json();
    controller.signal.throwIfAborted();
    if (!value || typeof value !== "object" || Array.isArray(value) || value.error || value.success === false) {
      throw new Error("IP region lookup is temporarily unavailable.");
    }
    const countryCode = typeof value.country_code === "string" ? value.country_code.trim().toUpperCase() : "";
    if (!/^[A-Z]{2}$/.test(countryCode) || !countries.has(countryCode)) {
      throw new Error("IP region lookup did not provide a recognized country.");
    }
    const code = typeof value.region_code === "string" ? value.region_code.trim().toUpperCase() : "";
    const stateCode = /^[A-Z0-9-]{1,10}$/.test(code) ? code.replace(new RegExp(`^${countryCode}-`), "") : "";
    const stateName = typeof value.region === "string" && value.region.length <= 200 ? value.region.trim() : "";
    const coordinate = (input) => (typeof input === "number" || typeof input === "string") && String(input).trim() ? Number(input) : NaN;
    const latitude = coordinate(value.latitude), longitude = coordinate(value.longitude);
    // Approximate IP coordinates stay in memory, rounded, only to choose a
    // NeedMap area locally. They are never sent to the boundary service or stored.
    const position = validCoordinate(latitude, longitude)
      ? { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 } : null;
    return { countryCode, stateCode, stateName, position };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function detectedEntries(location, entries = catalog) {
  const country = entries.find((entry) => entry.id === location.countryCode);
  const state = entries.find((entry) => entry.kind === "state" &&
    entry.countryCode === location.countryCode && entry.id === `${location.countryCode}-${location.stateCode}`) ||
    (location.stateName && entries.find((entry) => entry.kind === "state" &&
      entry.countryCode === location.countryCode &&
      [entry.name, entry.nativeName].some((name) => normalize(name) === normalize(location.stateName))));
  return [state, country].filter(Boolean);
}

/** Navigation is independent of report snapshots; newer user choices always win. */
export function createRegionNavigation({
  request = policyLimitedFetch,
  fetchImpl = globalThis.fetch,
  ipEndpoint = IP_LOCATION_ENDPOINT,
  loadBoundarySet = loadWorldRegionSet,
  // An injectable directory keeps fallback-provider and cancellation tests independent
  // of updates to the generated worldwide data release.
  entries = catalog,
  storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(),
  onChange = () => {}, onStatus = () => {}, onRegions = () => {},
} = {}) {
  let selected = WORLD_REGION;
  let revision = 0;
  let controller;
  let destroyed = false;
  // Worldwide is a selectable saved scope, not a country or catalog boundary.
  const byId = new Map([...entries, WORLD_REGION].map((entry) => [entry.id, entry]));
  const regionSets = new Map();
  const parentRegions = new Map();
  const clearSavedSelection = () => {
    try { storage?.removeItem(SAVED_REGION_KEY); }
    catch { /* A blocked preference store must not prevent navigation. */ }
  };
  const readSavedSelection = () => {
    try {
      const value = JSON.parse(storage?.getItem(SAVED_REGION_KEY));
      if (value?.version === SAVED_REGION_VERSION && typeof value.id === "string" && byId.has(value.id)) {
        return byId.get(value.id);
      }
    } catch { /* Malformed or inaccessible preferences fall back to detection. */ }
    clearSavedSelection();
    return null;
  };
  const begin = () => {
    controller?.abort();
    controller = new AbortController();
    return { revision: ++revision, signal: controller.signal };
  };
  const current = (operation) => !destroyed && operation.revision === revision;
  const resolveParent = async (entry, operation) => {
    operation.signal.throwIfAborted();
    let region = parentRegions.get(entry.id);
    if (!region) {
      if (entry.boundaryFile) {
        const records = await loadBoundarySet(entry, { signal: operation.signal, fetchImpl });
        operation.signal.throwIfAborted();
        const expected = entries.filter((item) => item.boundaryFile === entry.boundaryFile);
        const expectedIds = new Set(expected.map((item) => item.id));
        const foundIds = new Set();
        const verified = records.map((record) => {
          const descriptor = byId.get(record.id);
          if (!descriptor || !expectedIds.has(record.id) || foundIds.has(record.id) ||
              descriptor.kind !== record.kind || descriptor.countryCode !== record.countryCode ||
              (descriptor.parentId || "") !== (record.parentId || "") || !validGeometry(record.geometry) ||
              (record.excludedGeometry && !validGeometry(record.excludedGeometry))) {
            throw new Error("This boundary file does not match the worldwide region directory. Please reload and try again.");
          }
          foundIds.add(record.id);
          const { searchText, ...details } = descriptor;
          return { ...record, ...details, bounds: geometryBounds(record.geometry) };
        });
        if (foundIds.size !== expectedIds.size) throw new Error("This region's boundary file is incomplete. Please try again.");
        region = verified.find((record) => record.id === entry.id);
        if (!region) throw new Error("The selected region's boundary is unavailable.");
        if (!current(operation)) return region;
        const children = verified.filter((record) => record.parentId === entry.id);
        regionSets.set(entry.id, children);
        onRegions(children, region);
      } else {
        region = await resolveSelection(entry, request, storage, operation.signal);
        operation.signal.throwIfAborted();
        if (!current(operation)) return region;
      }
    }
    parentRegions.delete(entry.id);
    parentRegions.set(entry.id, region);
    while (parentRegions.size > MAX_MEMORY_PARENTS) {
      const oldest = parentRegions.keys().next().value;
      parentRegions.delete(oldest);
      regionSets.delete(oldest);
    }
    return region;
  };
  const resolveEntry = async (entry, operation) => {
    if (entry.kind === "world") return WORLD_REGION;
    const parentEntry = entry.kind === "needmap" ? byId.get(entry.parentId) : entry;
    if (!parentEntry) throw new Error("This area's parent region is unavailable.");
    const parent = await resolveParent(parentEntry, operation);
    operation.signal.throwIfAborted();
    const region = entry.kind === "needmap"
      ? regionSets.get(parentEntry.id)?.find((item) => item.id === entry.id) : parent;
    if (!region) throw new Error(`The boundary for ${entry.name} is unavailable. You can still choose ${parentEntry.name}.`);
    return region;
  };
  const apply = (region, source) => {
    selected = region;
    if (byId.has(region.id)) {
      try {
        storage?.setItem(SAVED_REGION_KEY, JSON.stringify({ version: SAVED_REGION_VERSION, id: region.id }));
      } catch { /* The selected region remains available for this visit. */ }
    } else {
      clearSavedSelection();
    }
    onChange(region, { source });
    onStatus({ state: "ready", message: `Viewing ${region.label}.`, key: "region.viewing", values: { region: region.label } });
    return region;
  };
  const detectRegion = async (operation) => {
    onStatus({ state: "locating", message: "Finding your approximate region from your internet connection…", key: "region.findingIp", values: {} });
    try {
      const location = await loadIpRegion({ fetchImpl, endpoint: ipEndpoint, signal: operation.signal });
      operation.signal.throwIfAborted();
      let region;
      const possible = detectedEntries(location, entries);
      for (const entry of possible) {
        try {
          region = await resolveParent(entry, operation);
          operation.signal.throwIfAborted();
          if (region) break;
        } catch (error) {
          operation.signal.throwIfAborted();
          if (entry.kind === "country") throw error;
        }
      }
      if (!region) throw new Error("No verified state or country boundary is available for this location.");
      if (location.position) {
        const children = regionSets.get(region.id) || [];
        region = children.find((child) => regionContains(child, location.position.latitude, location.position.longitude)) || region;
      }
      if (!current(operation)) return null;
      apply(region, "detected");
      onStatus({ state: "ready", message: `Approximate IP region: ${region.label}. Change Region if this is incorrect.`, key: "region.ipReady", values: { region: region.label } });
      return region;
    } catch {
      if (!current(operation)) return null;
      onStatus({ state: "error", message: `Your approximate region could not be detected. Viewing ${selected.label}; choose any region below.`, key: "region.detectError", values: { region: selected.label } });
      return null;
    }
  };
  return {
    search: searchRegions,
    count: countRegions,
    getRegions: () => regionSets.get(selected.parentId || selected.id) || [],
    getSelected: () => selected,
    async initialize() {
      if (destroyed) return null;
      const operation = begin();
      const entry = readSavedSelection();
      if (entry) {
        onStatus({ state: "loading", message: `Opening your saved region, ${entry.label}…`, key: "region.openingSaved", values: { region: entry.label } });
        try {
          const region = await resolveEntry(entry, operation);
          if (!current(operation)) return null;
          return apply(region, "saved");
        } catch {
          // A newer manual choice must also stop the detection fallback.
          if (!current(operation)) return null;
          clearSavedSelection();
        }
      }
      return detectRegion(operation);
    },
    async select(value) {
      if (destroyed) return null;
      if (value?.kind === "world" || value === "world") return this.worldwide();
      const id = typeof value === "string" ? value : value?.id;
      const entry = byId.get(id);
      if (!entry) return null;
      const operation = begin();
      onStatus({ state: "loading", message: `Opening ${entry.label}…`, key: "region.opening", values: { region: entry.label } });
      try {
        const region = await resolveEntry(entry, operation);
        if (!current(operation)) return null;
        apply(region, "manual");
        const children = regionSets.get(region.id) || [];
        if (children.length) onStatus({ state: "ready", message: `Viewing all of ${region.name}. ${children.length} smaller NeedMap areas are available in Change Region.`, key: "region.children", values: { region: region.name, count: children.length } });
        return region;
      } catch (error) {
        if (current(operation)) onStatus({ state: "error", message: error.message || "Region lookup is unavailable. Your previous region is still selected.", key: "region.lookupUnavailable", values: {} });
        return null;
      }
    },
    worldwide() {
      if (destroyed) return null;
      begin();
      return apply(WORLD_REGION, "manual");
    },
    async detect() {
      if (destroyed) return null;
      return detectRegion(begin());
    },
    destroy() { destroyed = true; revision += 1; controller?.abort(); parentRegions.clear(); regionSets.clear(); },
  };
}

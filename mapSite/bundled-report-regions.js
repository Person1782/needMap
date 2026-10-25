import { WORLD_REGION_ROWS } from "./world-region-catalog.js";
import { REPORT_REGION_BOUNDS } from "./report-region-bounds.js";
import { loadWorldRegionSet } from "./world-region-boundaries.js";
import { pointInGeometry } from "./regions.js";

const CACHE_ENTRIES = 16;
const defaultResolvers = new WeakMap();
const validPoint = ({ latitude, longitude } = {}) => Number.isFinite(latitude) && Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
const contains = (region, point) => pointInGeometry(point.longitude, point.latitude, region.geometry) &&
  (!region.excludedGeometry || !pointInGeometry(point.longitude, point.latitude, region.excludedGeometry));
const checkAbort = (signal) => signal?.throwIfAborted();

/** Exact, same-origin polygon lookup. Bounding boxes only reduce downloads. */
export function createBundledReportRegionResolver({
  rows = WORLD_REGION_ROWS, bounds = REPORT_REGION_BOUNDS,
  fetchImpl = globalThis.fetch, loadBoundarySet = loadWorldRegionSet,
} = {}) {
  const catalog = new Map(rows.map(([id, name, nativeName, kind, countryCode, parentId, boundaryFile]) =>
    [id, { id, name, nativeName, kind, countryCode, parentId, boundaryFile }]));
  const expectedByFile = new Map();
  for (const entry of catalog.values()) if (entry.boundaryFile) {
    if (!expectedByFile.has(entry.boundaryFile)) expectedByFile.set(entry.boundaryFile, new Set());
    expectedByFile.get(entry.boundaryFile).add(entry.id);
  }
  const cache = new Map();
  async function load(entry, signal) {
    checkAbort(signal);
    if (cache.has(entry.id)) {
      const cached = cache.get(entry.id);
      cache.delete(entry.id); cache.set(entry.id, cached);
      return cached;
    }
    const records = await loadBoundarySet(entry, { signal, fetchImpl });
    checkAbort(signal);
    const expected = expectedByFile.get(entry.boundaryFile);
    const seen = new Set();
    const verified = records.map((record) => {
      const descriptor = catalog.get(record.id);
      if (!descriptor || !expected?.has(record.id) || seen.has(record.id) ||
          descriptor.kind !== record.kind || descriptor.countryCode !== record.countryCode ||
          (descriptor.parentId || "") !== (record.parentId || "")) {
        throw new Error("Bundled report boundaries do not match the region catalog.");
      }
      seen.add(record.id);
      const country = catalog.get(descriptor.countryCode)?.name || descriptor.countryCode;
      return { ...record, ...descriptor, country,
        label: descriptor.kind === "country" ? descriptor.name : `${descriptor.name}, ${country}`,
        hierarchy: descriptor.kind === "needmap" ? `${record.parentName}, ${country}`
          : descriptor.kind === "country" ? "" : country };
    });
    if (!expected || seen.size !== expected.size) throw new Error("The bundled report boundary file is incomplete.");
    cache.set(entry.id, verified);
    while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return verified;
  }

  return async (point, { signal } = {}) => {
    checkAbort(signal);
    if (!point || !validPoint(point)) return null;
    const shortlist = bounds.filter(([, south, west, north, east]) =>
      point.latitude >= south && point.latitude <= north && point.longitude >= west && point.longitude <= east);
    const matches = [];
    for (const [id] of shortlist) {
      checkAbort(signal);
      const entry = catalog.get(id);
      if (!entry || !["state", "country"].includes(entry.kind) || !entry.boundaryFile) {
        throw new Error("The bundled report bounds index does not match the catalog.");
      }
      const records = await load(entry, signal);
      const parent = records.find((record) => record.id === id);
      if (!parent || !contains(parent, point)) continue;
      // Child exclusions give shared edges one deterministic owner. Never
      // assign a nearby child unless the report is actually inside its polygon.
      matches.push(records.find((record) => record.kind === "needmap" && contains(record, point)) || parent);
    }
    checkAbort(signal);
    // AS and US-AS are explicitly pinned aliases of the same territory. Use
    // the country identity consistently instead of depending on catalog order.
    const canonical = matches.some((region) => region.id === "AS")
      ? matches.filter((region) => region.id !== "US-AS") : matches;
    if (new Set(canonical.map((region) => region.countryCode)).size > 1) return null;
    return canonical.sort((a, b) => (a.kind === "needmap" ? 0 : 1) - (b.kind === "needmap" ? 0 : 1) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] || null;
  };
}

export async function resolveBundledReportRegion(point, { signal, fetchImpl = globalThis.fetch } = {}) {
  checkAbort(signal);
  if (!point || !validPoint(point) || typeof fetchImpl !== "function") return null;
  let resolver = defaultResolvers.get(fetchImpl);
  if (!resolver) {
    resolver = createBundledReportRegionResolver({ fetchImpl });
    defaultResolvers.set(fetchImpl, resolver);
  }
  return resolver(point, { signal });
}

import { WORLD_REGION_ROWS } from "./world-region-catalog.js";
import { categoryForReport } from "./analysis-model.js";
import { isRecommendationEvidence } from "./analysis.js";
import { pointInGeometry } from "./regions.js";
import { loadNavigationRegion } from "./region-navigation.js";

const CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;
const contains = (region, report) => pointInGeometry(report.longitude, report.latitude, region.geometry) &&
  (!region.excludedGeometry || !pointInGeometry(report.longitude, report.latitude, region.excludedGeometry));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function abortable(operation, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => finish(reject, signal.reason || new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal?.throwIfAborted(); return operation(); })
      .then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

/** Only scopes that can add supported analysis need a boundary download. */
export function worldwideAnalysisScopeEntries(reports, rows = WORLD_REGION_ROWS, options) {
  const catalog = new Map(rows.map(([id, name, , kind, countryCode, parentId, boundaryFile]) =>
    [id, { id, name, kind, countryCode, parentId, boundaryFile }]));
  const groups = new Map();
  const seen = new Set();
  const source = (Array.isArray(reports) ? reports : []).filter((report) =>
    isRecommendationEvidence(report, options) && typeof report.id === "string" && report.id && report.region?.geometry &&
    typeof report.region.id === "string" && /^[A-Z]{2}$/.test(report.region.countryCode || "") &&
    contains(report.region, report)).sort((a, b) => Number(a.isSynthetic === true) - Number(b.isSynthetic === true) ||
      compare(JSON.stringify([a.id, a.latitude, a.longitude]), JSON.stringify([b.id, b.latitude, b.longitude])));
  for (const report of source) {
    if (seen.has(report.id)) continue;
    seen.add(report.id);
    const country = catalog.get(report.region.countryCode);
    if (!country || country.kind !== "country" || country.id !== country.countryCode) continue;
    const parentId = report.region.kind === "needmap" ? report.region.parentId : report.region.id;
    const parent = catalog.get(parentId);
    const scopes = [country];
    if (parent?.kind === "state" && parent.countryCode === country.id) scopes.push(parent);
    for (const entry of scopes) {
      if (!groups.has(entry.id)) groups.set(entry.id, { entry, categories: new Map() });
      const categories = groups.get(entry.id).categories;
      const category = categoryForReport(report);
      if (!categories.has(category)) categories.set(category, { ids: new Set(), regions: new Set() });
      categories.get(category).ids.add(report.id);
      categories.get(category).regions.add(report.region.id);
    }
  }
  return [...groups.values()].filter(({ categories }) => [...categories.values()].some((group) =>
    group.ids.size >= 2 && group.regions.size >= 2)).map(({ entry }) => entry)
    .sort((a, b) => (a.kind === "state" ? 0 : 1) - (b.kind === "state" ? 0 : 1) || compare(a.id, b.id));
}

export function createWorldwideAnalysisRegionLoader({
  rows = WORLD_REGION_ROWS, loadRegion = loadNavigationRegion, now = Date.now,
} = {}) {
  const cache = new Map();
  return async (reports, { signal, onProgress, includeDemonstrationReports = false } = {}) => {
    signal?.throwIfAborted();
    const entries = worldwideAnalysisScopeEntries(reports, rows, { includeDemonstrationReports });
    const regions = [], failures = [];
    onProgress?.(0, entries.length);
    for (const [index, entry] of entries.entries()) {
      signal?.throwIfAborted();
      try {
        const cached = cache.get(entry.id);
        let region;
        if (cached && now() >= cached.savedAt && now() - cached.savedAt <= CACHE_AGE_MS) {
          region = cached.region;
          cache.delete(entry.id); cache.set(entry.id, cached);
        } else {
          cache.delete(entry.id);
          region = await abortable(() => loadRegion(entry, { signal }), signal);
          signal?.throwIfAborted();
          if (region?.id !== entry.id || region.kind !== entry.kind || region.countryCode !== entry.countryCode ||
              !region.geometry || !["Polygon", "MultiPolygon"].includes(region.geometry.type)) {
            throw new Error("The loaded boundary does not match the requested region.");
          }
          cache.set(entry.id, { region, savedAt: now() });
          while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        }
        regions.push(region);
      } catch (error) {
        signal?.throwIfAborted();
        failures.push({ regionId: entry.id, name: entry.name, countryCode: entry.countryCode,
          message: error?.message || "The verified boundary is unavailable." });
      }
      signal?.throwIfAborted();
      onProgress?.(index + 1, entries.length);
    }
    return { regions, failures };
  };
}

export const loadWorldwideAnalysisRegions = createWorldwideAnalysisRegionLoader();

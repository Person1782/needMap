const EARTH_RADIUS_KM = 6371;
const REQUEST_GAP_MS = 1100;
const REQUEST_TIMEOUT_MS = 15000;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "needmap-region-v1:";
const REGION_ENDPOINT = (
  import.meta.env?.VITE_REGION_LOOKUP_ENDPOINT ||
  "https://nominatim.openstreetmap.org"
).replace(/\/$/, "");

let requestQueue = Promise.resolve();
let lastRequestStartedAt = 0;
const knownRegions = [];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function coordinateCacheKey(latitude, longitude, zoom) {
  return `${CACHE_PREFIX}${latitude.toFixed(4)}:${longitude.toFixed(4)}:${zoom}`;
}

function readCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (!cached || !Number.isFinite(cached.savedAt) || cached.savedAt > Date.now() ||
        Date.now() - cached.savedAt > CACHE_MAX_AGE_MS) return null;
    return cached.value;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Region lookups still work if private browsing or storage limits block caching.
  }
}

async function policyLimitedFetch(url, signal) {
  const request = requestQueue.then(async () => {
    signal?.throwIfAborted();
    const waitFor = REQUEST_GAP_MS - (Date.now() - lastRequestStartedAt);
    if (waitFor > 0) await delay(waitFor);
    signal?.throwIfAborted();
    lastRequestStartedAt = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        referrerPolicy: "strict-origin-when-cross-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Region lookup failed with status ${response.status}.`);
      }
      const result = await response.json();
      if (!result || typeof result !== "object" || result.error) {
        throw new Error("Region information is temporarily unavailable.");
      }
      return result;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  });

  requestQueue = request.catch(() => undefined);
  return request;
}

function pointOnSegment(point, first, second) {
  const [x, y] = point;
  const [x1, y1] = first;
  const [x2, y2] = second;
  const squaredLength = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (squaredLength < 1e-20) {
    return (x - x1) ** 2 + (y - y1) ** 2 < 1e-20;
  }
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1);
  if (dot < 0) return false;
  return dot <= squaredLength;
}

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every((coordinate) =>
    Array.isArray(coordinate) && Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1]) && Math.abs(coordinate[0]) <= 180 &&
    Math.abs(coordinate[1]) <= 90);
}

function unwrapRing(ring) {
  let previousLongitude = ring[0][0];
  return ring.map(([longitude, latitude]) => {
    longitude += Math.round((previousLongitude - longitude) / 360) * 360;
    previousLongitude = longitude;
    return [longitude, latitude];
  });
}

function pointInRing(point, inputRing) {
  if (!validRing(inputRing)) return false;
  const ring = unwrapRing(inputRing);
  const centerLongitude = ring.reduce((sum, coordinate) => sum + coordinate[0], 0) / ring.length;
  point = [point[0] + Math.round((centerLongitude - point[0]) / 360) * 360, point[1]];
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;

    const intersects = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]) &&
      point[0] < (previousPoint[0] - currentPoint[0]) *
        (point[1] - currentPoint[1]) /
        (previousPoint[1] - currentPoint[1]) + currentPoint[0];
    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygonCoordinates(point, coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length ||
      !coordinates.every(validRing) || !pointInRing(point, coordinates[0])) return false;
  return !coordinates.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInGeometry(longitude, latitude, geometry) {
  if (!geometry || !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return false;
  const point = [longitude, latitude];

  if (geometry.type === "Polygon") {
    return pointInPolygonCoordinates(point, geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    return Array.isArray(geometry.coordinates) && geometry.coordinates.some((polygon) =>
      pointInPolygonCoordinates(point, polygon));
  }

  return false;
}

function geometryComponents(geometry) {
  if (geometry?.type === "Polygon") return [geometry];
  if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map((coordinates) => ({
      type: "Polygon",
      coordinates,
    }));
  }
  return [];
}

function containingComponent(geometry, longitude, latitude) {
  const components = geometryComponents(geometry);
  const componentIndex = components.findIndex((component) =>
    pointInGeometry(longitude, latitude, component));

  if (componentIndex === -1) return null;
  return { geometry: components[componentIndex], componentIndex };
}

function ringAreaKm2(ring) {
  if (!validRing(ring)) return 0;
  ring = unwrapRing(ring);
  const meanLatitude = ring.reduce((sum, coordinate) => sum + coordinate[1], 0) /
    ring.length * Math.PI / 180;
  const points = ring.map(([longitude, latitude]) => ({
    x: longitude * Math.PI / 180 * EARTH_RADIUS_KM * Math.cos(meanLatitude),
    y: latitude * Math.PI / 180 * EARTH_RADIUS_KM,
  }));
  let doubledArea = 0;

  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    doubledArea += points[index].x * next.y - next.x * points[index].y;
  }

  return Math.abs(doubledArea) / 2;
}

function polygonAreaKm2(geometry) {
  if (geometry?.type !== "Polygon" || !Array.isArray(geometry.coordinates) ||
      !geometry.coordinates.length || !geometry.coordinates.every(validRing)) return null;
  const outerArea = ringAreaKm2(geometry.coordinates[0]);
  const holesArea = geometry.coordinates.slice(1)
    .reduce((sum, ring) => sum + ringAreaKm2(ring), 0);
  return Math.max(0, outerArea - holesArea);
}

function geometryBounds(geometry) {
  const coordinates = [];
  const collectCoordinates = (value) => {
    if (Array.isArray(value) && value.length >= 2 &&
        Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      coordinates.push(value);
      return;
    }
    if (Array.isArray(value)) value.forEach(collectCoordinates);
  };
  collectCoordinates(geometry?.coordinates);
  if (!coordinates.length) return null;
  const referenceLongitude = coordinates[0][0];
  return coordinates.reduce((bounds, [longitude, latitude]) => {
    longitude += Math.round((referenceLongitude - longitude) / 360) * 360;
    bounds[0][0] = Math.min(bounds[0][0], latitude);
    bounds[0][1] = Math.min(bounds[0][1], longitude);
    bounds[1][0] = Math.max(bounds[1][0], latitude);
    bounds[1][1] = Math.max(bounds[1][1], longitude);
    return bounds;
  }, [[Infinity, Infinity], [-Infinity, -Infinity]]);
}

function parsePopulation(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const population = Number(value.replaceAll(/[^0-9.]/g, ""));
  return Number.isFinite(population) && population > 0 ? population : null;
}

function regionName(result) {
  return result.name || result.address?.neighbourhood || result.address?.suburb ||
    result.address?.city_district || result.address?.city || result.address?.town ||
    result.address?.village || result.address?.municipality || result.address?.county ||
    result.address?.state || result.display_name || "Named region";
}

function regionHierarchy(result, name) {
  const address = result.address || {};
  const values = [
    address.neighbourhood,
    address.suburb,
    address.city_district,
    address.city,
    address.town,
    address.village,
    address.municipality,
    address.county,
    address.state,
    address.country,
  ].filter(Boolean);
  return [...new Set(values)].filter((value) => value !== name).join(", ");
}

function normalizeResult(result, latitude, longitude, zoom) {
  const component = containingComponent(result?.geojson, longitude, latitude);
  if (!component) return null;

  const name = regionName(result);
  const areaKm2 = polygonAreaKm2(component.geometry);
  const components = geometryComponents(result.geojson);
  const totalAreaKm2 = components.reduce((sum, item) => sum + (polygonAreaKm2(item) || 0), 0);
  const regionPopulation = parsePopulation(result.extratags?.population);
  // A population for a multi-part region cannot be assigned to one island or
  // detached component. Retain whole-region density only as context.
  const population = components.length === 1 ? regionPopulation : null;
  const densityPerKm2 = regionPopulation && totalAreaKm2
    ? regionPopulation / totalAreaKm2
    : null;
  const osmType = result.osm_type || "place";
  const osmId = result.osm_id || result.place_id;
  if (!osmId) return null;

  return {
    id: `${osmType}-${osmId}-${component.componentIndex}`,
    osmId: `${osmType}-${osmId}`,
    name,
    hierarchy: regionHierarchy(result, name),
    type: result.addresstype || result.type || "administrative region",
    population,
    populationDate: result.extratags?.["population:date"] || null,
    areaKm2,
    densityPerKm2,
    densityIsContextual: components.length > 1 && densityPerKm2 !== null,
    geometry: component.geometry,
    bounds: geometryBounds(component.geometry),
    lookupZoom: zoom,
    source: "OpenStreetMap Nominatim",
  };
}

function classifyRurality(region) {
  const density = region.densityPerKm2;
  if (Number.isFinite(density)) {
    if (density >= 1500) return "dense urban";
    if (density >= 500) return "urban";
    if (density >= 150) return "suburban";
    return "rural";
  }

  const type = String(region.type).toLowerCase();
  if (/hamlet|village|isolated|locality|county|district/.test(type)) return "rural";
  if (/city|borough|suburb|neighbou?rhood/.test(type)) return "urban";
  return "mixed";
}

function adaptiveZoom(region) {
  const density = region.densityPerKm2;
  const type = String(region.type).toLowerCase();

  if (/hamlet|village|isolated|locality/.test(type) ||
      (Number.isFinite(density) && density < 100)) {
    return 8;
  }
  if (Number.isFinite(density) && density >= 1000) return 14;
  if (Number.isFinite(density) && density >= 350) return 12;
  return 10;
}

async function lookup(latitude, longitude, zoom, signal) {
  const cacheKey = coordinateCacheKey(latitude, longitude, zoom);
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const url = new URL(`${REGION_ENDPOINT}/reverse`);
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: String(zoom),
    addressdetails: "1",
    extratags: "1",
    polygon_geojson: "1",
    polygon_threshold: "0.002",
    "accept-language": "en",
  });

  const result = await policyLimitedFetch(url, signal);
  writeCache(cacheKey, result);
  return result;
}

function knownRegionFor(latitude, longitude) {
  return knownRegions.find((region) =>
    pointInGeometry(longitude, latitude, region.geometry));
}

async function resolveRegion(report, signal) {
  signal?.throwIfAborted();
  const { latitude, longitude } = report;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const known = knownRegionFor(latitude, longitude);
  if (known) return known;

  const baseResult = await lookup(latitude, longitude, 10, signal);
  const baseRegion = normalizeResult(
    baseResult,
    latitude,
    longitude,
    10,
  );
  if (!baseRegion) return null;

  const targetZoom = adaptiveZoom(baseRegion);
  let selectedRegion = baseRegion;

  if (targetZoom !== 10) {
    try {
      const adaptiveResult = await lookup(latitude, longitude, targetZoom, signal);
      const adaptiveRegion = normalizeResult(adaptiveResult, latitude, longitude, targetZoom);
      if (adaptiveRegion) selectedRegion = adaptiveRegion;
    } catch (error) {
      signal?.throwIfAborted();
      // A more detailed boundary is optional; retain the verified base region.
      console.warn("NeedMap detailed region lookup failed:", error);
    }
  }

  const contextualDensity = selectedRegion.densityPerKm2 ?? baseRegion.densityPerKm2;
  const finalRegion = {
    ...selectedRegion,
    densityPerKm2: contextualDensity,
    densityIsContextual: selectedRegion.densityIsContextual ||
      (selectedRegion.densityPerKm2 === null && contextualDensity !== null),
    rurality: classifyRurality({
      ...selectedRegion,
      densityPerKm2: contextualDensity,
    }),
  };
  knownRegions.push(finalRegion);
  return finalRegion;
}

export async function enrichSignalsWithRegions(signals, { onProgress, signal: abortSignal } = {}) {
  const enrichedSignals = [];

  for (let index = 0; index < signals.length; index += 1) {
    abortSignal?.throwIfAborted();
    const signal = signals[index];
    onProgress?.(index, signals.length);

    try {
      const region = await resolveRegion(signal, abortSignal);
      enrichedSignals.push({ ...signal, region });
    } catch (error) {
      abortSignal?.throwIfAborted();
      console.warn("NeedMap region lookup failed:", error);
      enrichedSignals.push({ ...signal, region: null });
    }
  }

  onProgress?.(signals.length, signals.length);
  return enrichedSignals;
}

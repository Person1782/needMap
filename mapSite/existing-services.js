const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const CACHE_PREFIX = "needmap.services.v3:";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 25000;

const CATEGORY_FILTERS = {
  transportation: [
    '["amenity"="bus_station"]',
    '["public_transport"="station"]',
    '["public_transport"="stop_position"]',
    '["highway"="bus_stop"]',
    '["amenity"="fuel"]',
  ],
  healthcare: [
    '["amenity"="clinic"]',
    '["amenity"="hospital"]',
    '["amenity"="doctors"]',
    '["amenity"="pharmacy"]',
  ],
  food: [
    '["shop"="supermarket"]',
    '["shop"="convenience"]',
    '["amenity"="food_bank"]',
    '["social_facility"="food_bank"]',
  ],
  water: [
    '["amenity"="drinking_water"]',
    '["man_made"="water_tap"]',
  ],
  broadband: [
    '["internet_access"]',
    '["amenity"="library"]',
  ],
  emergency_response: [
    '["amenity"="fire_station"]',
    '["amenity"="police"]',
    '["emergency"="ambulance_station"]',
  ],
  other: [
    '["amenity"="community_centre"]',
    '["office"="ngo"]',
  ],
};

function validCoordinate(value, minimum, maximum) {
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function cacheKey(category, latitude, longitude, radiusMeters, endpoint) {
  // Four decimals keeps candidates roughly 11 m apart at the equator. A coarser
  // key can incorrectly reuse services from a different neighborhood.
  return `${CACHE_PREFIX}${endpoint}:${category}:${latitude.toFixed(4)}:${longitude.toFixed(4)}:${radiusMeters}`;
}

function readCache(key) {
  try {
    const entry = JSON.parse(localStorage.getItem(key));
    if (!entry || !Number.isFinite(entry.savedAt) || entry.savedAt > Date.now() ||
        Date.now() - entry.savedAt > CACHE_MAX_AGE_MS ||
        !Array.isArray(entry.services) || !entry.services.every((service) =>
          service && validCoordinate(service.latitude, -90, 90) !== null &&
          validCoordinate(service.longitude, -180, 180) !== null &&
          typeof service.id === "string" && typeof service.name === "string")) return null;
    return entry.services;
  } catch {
    return null;
  }
}

function writeCache(key, services) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), services }));
  } catch {
    // Cache failure should never block the service inventory.
  }
}

export function buildOverpassQuery(category, latitude, longitude, radiusMeters = 5000) {
  const lat = validCoordinate(latitude, -90, 90);
  const lon = validCoordinate(longitude, -180, 180);
  const radius = Math.round(Math.max(250, Math.min(20000, Number(radiusMeters) || 5000)));
  if (lat === null || lon === null) {
    throw new TypeError("A valid candidate coordinate is required.");
  }
  const filters = Object.hasOwn(CATEGORY_FILTERS, category)
    ? CATEGORY_FILTERS[category] : CATEGORY_FILTERS.other;
  const statements = filters.flatMap((filter) => [
    `node(around:${radius},${lat},${lon})${filter};`,
    `way(around:${radius},${lat},${lon})${filter};`,
    `relation(around:${radius},${lat},${lon})${filter};`,
  ]).join("\n");
  return `[out:json][timeout:20];\n(\n${statements}\n);\nout center tags qt;`;
}

function serviceType(tags = {}) {
  return tags.amenity || tags.shop || tags.public_transport || tags.highway ||
    tags.emergency || tags.social_facility || tags.internet_access ||
    tags.man_made || tags.office || "service";
}

export function parseOverpassServices(payload) {
  if (!payload || !Array.isArray(payload.elements)) return [];
  const seen = new Set();
  return payload.elements.flatMap((element) => {
    if (!element || typeof element !== "object") return [];
    if (!["node", "way", "relation"].includes(element.type) ||
        !Number.isSafeInteger(element.id) || element.id <= 0) return [];
    const latitude = validCoordinate(element.lat ?? element.center?.lat, -90, 90);
    const longitude = validCoordinate(element.lon ?? element.center?.lon, -180, 180);
    if (latitude === null || longitude === null) return [];
    const id = `${element.type || "element"}-${element.id}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const tags = element.tags && typeof element.tags === "object" ? element.tags : {};
    const type = String(serviceType(tags));
    const name = String(tags.name || tags.operator || type.replaceAll("_", " "));
    return [{
      id,
      osmId: element.id,
      osmType: element.type,
      latitude,
      longitude,
      name,
      type,
      category: type,
      tags,
    }];
  });
}

export async function loadNearbyServices(
  recommendation,
  {
    radiusMeters = 5000,
    endpoint = import.meta.env?.VITE_OVERPASS_ENDPOINT || DEFAULT_ENDPOINT,
    force = false,
  } = {},
) {
  const latitude = validCoordinate(recommendation?.position?.latitude, -90, 90);
  const longitude = validCoordinate(recommendation?.position?.longitude, -180, 180);
  if (latitude === null || longitude === null) {
    throw new TypeError("The recommendation does not have a valid position.");
  }
  const category = Object.hasOwn(CATEGORY_FILTERS, recommendation.category)
    ? recommendation.category : "other";
  const radius = Math.round(Math.max(250, Math.min(20000, Number(radiusMeters) || 5000)));
  let endpointUrl;
  try {
    endpointUrl = new URL(String(endpoint || DEFAULT_ENDPOINT));
  } catch {
    throw new TypeError("The OpenStreetMap service endpoint is not a valid URL.");
  }
  if (!["https:", "http:"].includes(endpointUrl.protocol)) {
    throw new TypeError("The OpenStreetMap service endpoint must use HTTP or HTTPS.");
  }
  const key = cacheKey(category, latitude, longitude, radius, endpointUrl.href);
  const cached = force ? null : readCache(key);
  if (cached) return { services: cached, source: "cache", radiusMeters: radius };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpointUrl.href, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `data=${encodeURIComponent(buildOverpassQuery(
        category,
        latitude,
        longitude,
        radius,
      ))}`,
      signal: controller.signal,
    });
    if (!response.ok) {
      const suffix = response.status === 429
        ? " The public service is busy; wait a moment and try again."
        : response.status >= 500
          ? " The public service is temporarily unavailable."
          : "";
      throw new Error(`OpenStreetMap service lookup returned ${response.status}.${suffix}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("OpenStreetMap returned an unreadable service response.");
    }
    if (!payload || !Array.isArray(payload.elements) || payload.remark) {
      // Overpass can return HTTP 200 with a timeout or memory-limit remark.
      // Never record incomplete results as an absence of nearby services.
      throw new Error("The service inventory could not be completed. Try again shortly.");
    }
    const services = parseOverpassServices(payload);
    writeCache(key, services);
    return { services, source: "OpenStreetMap", radiusMeters: radius };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The existing-service lookup timed out. Try again shortly.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const serviceInventorySource = {
  name: "OpenStreetMap via Overpass API",
  url: "https://wiki.openstreetmap.org/wiki/Overpass_API",
  attribution: "© OpenStreetMap contributors",
};

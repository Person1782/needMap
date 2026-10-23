import polygonClipping from "polygon-clipping";

export const REPORT_POPULATION_RADIUS_METERS = 500;
const EARTH_RADIUS_METERS = 6371008.8;
const MAX_LOCATIONS = 200;
const STEPS = 64;
const RAD = Math.PI / 180;

const snap = (value) => Math.round(value * 1e10) / 1e10;
const validLocation = (report) => Number.isFinite(report?.latitude) &&
  Number.isFinite(report?.longitude) && Math.abs(report.latitude) <= 90 && Math.abs(report.longitude) <= 180;

// A local north/east vector basis remains defined even at either geographic
// pole, where the usual latitude/longitude destination formula is singular.
function bufferRing(longitude, latitude) {
  const lon = longitude * RAD;
  const lat = latitude * RAD;
  const distance = REPORT_POPULATION_RADIUS_METERS / EARTH_RADIUS_METERS;
  const center = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const ring = [];
  for (let i = 0; i < STEPS; i += 1) {
    const bearing = i * Math.PI * 2 / STEPS;
    const point = center.map((value, axis) => value * Math.cos(distance) +
      (north[axis] * Math.cos(bearing) + east[axis] * Math.sin(bearing)) * Math.sin(distance));
    let x = Math.atan2(point[1], point[0]) / RAD;
    const y = Math.atan2(point[2], Math.hypot(point[0], point[1])) / RAD;
    const previous = ring.length ? ring[ring.length - 1][0] : longitude;
    while (x - previous > 180) x -= 360;
    while (x - previous < -180) x += 360;
    ring.push([snap(x), snap(y)]);
  }
  let endLongitude = ring[0][0];
  while (endLongitude - ring[ring.length - 1][0] > 180) endLongitude -= 360;
  while (endLongitude - ring[ring.length - 1][0] < -180) endLongitude += 360;
  ring.push([endLongitude, ring[0][1]]);
  // A circle enclosing a pole winds around all longitudes. Close its cap at
  // the pole rather than drawing a spurious chord through the rest of Earth.
  if (Math.abs(endLongitude - ring[0][0]) > 180) {
    const pole = latitude >= 0 ? 90 : -90;
    ring.push([endLongitude, pole], [ring[0][0], pole], [...ring[0]]);
  } else ring[ring.length - 1] = [...ring[0]];
  return ring;
}

function splitLongitudeBands(polygon) {
  const longitudes = polygon[0].map(([longitude]) => longitude);
  const first = Math.floor((Math.min(...longitudes) + 180) / 360);
  const last = Math.floor((Math.max(...longitudes) + 180) / 360);
  const pieces = [];
  for (let band = first; band <= last; band += 1) {
    const left = -180 + band * 360;
    const right = 180 + band * 360;
    const box = [[[left, -90], [right, -90], [right, 90], [left, 90], [left, -90]]];
    const clipped = polygonClipping.intersection(polygon, box);
    pieces.push(...clipped.map((part) => part.map((ring) => ring.map(([x, y]) => [snap(x - band * 360), snap(y)]))));
  }
  return pieces;
}

function regionPolygons(geometry) {
  if (!geometry) return null;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates]
    : geometry.type === "MultiPolygon" ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length) throw new TypeError("A population boundary must be a Polygon or MultiPolygon.");
  return polygons.flatMap((polygon) => {
    if (!Array.isArray(polygon) || !polygon.length) throw new TypeError("Invalid population boundary.");
    let outerCenter = null;
    const unwrapped = polygon.map((ring) => {
      if (!Array.isArray(ring) || ring.length < 4 || ring.some((point) => !Array.isArray(point) ||
        !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) ||
        ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        throw new TypeError("Invalid population boundary ring.");
      }
      const result = [];
      for (const [longitude, latitude] of ring) {
        let x = longitude;
        if (result.length) {
          const previous = result[result.length - 1][0];
          // Preserve a deliberate full-world edge from -180 to +180.
          if (Math.abs(longitude - ring[result.length - 1][0]) < 360 - 1e-9) {
            while (x - previous > 180) x -= 360;
            while (x - previous < -180) x += 360;
          }
        }
        result.push([x, latitude]);
      }
      const center = result.reduce((sum, [x]) => sum + x, 0) / result.length;
      const shift = outerCenter === null ? 0 : Math.round((outerCenter - center) / 360) * 360;
      if (outerCenter === null) outerCenter = center;
      return result.map(([x, y]) => [x + shift, y]);
    });
    return splitLongitudeBands(unwrapped);
  });
}

/** Union of 500 m report neighborhoods; never a claim of confirmed impact. */
export function buildReportPopulationArea(reports = [], region = null) {
  const seenIds = new Set();
  const locations = new Map();
  let reportCount = 0;
  let missingLocationCount = 0;
  for (const report of Array.isArray(reports) ? reports : []) {
    const id = report?.id;
    if (id !== undefined && id !== null && id !== "") {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    if (!validLocation(report)) { missingLocationCount += 1; continue; }
    reportCount += 1;
    const longitude = report.longitude === 180 ? -180 : report.longitude;
    // All longitudes at a pole describe the same physical location.
    const point = [Math.abs(report.latitude) === 90 ? 0 : longitude, report.latitude];
    locations.set(JSON.stringify(point), point);
  }
  if (locations.size > MAX_LOCATIONS) throw new RangeError(`Population estimates support at most ${MAX_LOCATIONS} distinct report locations.`);
  const ordered = [...locations.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pieces = ordered.flatMap(([longitude, latitude]) => splitLongitudeBands([bufferRing(longitude, latitude)]));
  let coordinates = pieces.length ? polygonClipping.union(...pieces) : [];
  const boundary = regionPolygons(region?.geometry);
  if (boundary && coordinates.length) coordinates = polygonClipping.intersection(coordinates, boundary);
  const geometry = coordinates.length ? { type: "MultiPolygon", coordinates } : null;
  const radiusMeters = REPORT_POPULATION_RADIUS_METERS;
  return { geometry, reportCount, missingLocationCount, radiusMeters,
    key: JSON.stringify(["report-population-v1", region?.id ?? null, radiusMeters, reportCount, missingLocationCount, geometry]) };
}

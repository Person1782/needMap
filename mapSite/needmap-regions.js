import polygonClipping from "polygon-clipping";
import { pointInGeometry } from "./regions.js";

const EARTH_RADIUS_KM = 6371.0088;
const MIN_SPLIT_AREA_KM2 = 120000;
const MIN_COVERAGE = 0.98;
const MAX_UNITS = 2000;
export const NEEDMAP_REGION_VERSION = "needmap-v2";
const normalize = (value) => String(value || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function polygonCoordinates(geometry) {
  return geometry?.type === "Polygon" ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
}

function validGeometry(geometry) {
  const polygons = polygonCoordinates(geometry);
  return Array.isArray(polygons) && polygons.length > 0 && polygons.every((polygon) =>
    Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) =>
      Array.isArray(ring) && ring.length >= 4 && ring.every((point) =>
        Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
        Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90) &&
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]));
}

function shape(coordinates) {
  return { type: "MultiPolygon", coordinates };
}

function snapCoordinates(coordinates, scale = 1e6) {
  // Normalize source coordinates once. A roughly10cm grid is much finer than
  // either source dataset; keeping subsequent computed intersections at full
  // precision avoids repeatedly introducing small gaps between shared edges.
  return coordinates.map((polygon) => polygon.map((ring) => {
    const points = [];
    for (const coordinate of ring) {
      const point = coordinate.map((value) => Math.round(value * scale) / scale);
      const previous = points[points.length - 1];
      if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
    }
    if (points.length && (points[0][0] !== points[points.length - 1][0] ||
        points[0][1] !== points[points.length - 1][1])) points.push([...points[0]]);
    return points;
  }).filter((ring) => ring.length >= 4)).filter((polygon) => polygon.length > 0);
}

function clip(operation, ...geometries) {
  try { return polygonClipping[operation](...geometries); }
  catch (originalError) {
    // Intersections that differ only in floating-point noise can confuse the
    // overlay sweep. Retry up to a roughly millimeter grid without rounding the
    // result; this remains much finer than the source's roughly10cm snap.
    for (const scale of [1e10, 1e9, 1e8]) {
      try { return polygonClipping[operation](...geometries.map((geometry) => snapCoordinates(geometry, scale))); }
      catch { /* A final failure keeps the complete parent available. */ }
    }
    throw originalError;
  }
}

function boundsOf(geometry) {
  const bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];
  for (const polygon of polygonCoordinates(geometry)) for (const ring of polygon) {
    for (const [longitude, latitude] of ring) {
      bounds[0][0] = Math.min(bounds[0][0], latitude);
      bounds[0][1] = Math.min(bounds[0][1], longitude);
      bounds[1][0] = Math.max(bounds[1][0], latitude);
      bounds[1][1] = Math.max(bounds[1][1], longitude);
    }
  }
  return bounds;
}

function crossesDateLine(geometry) {
  if (boundsOf(geometry)[1][1] - boundsOf(geometry)[0][1] > 180) return true;
  return polygonCoordinates(geometry).some((polygon) => polygon.some((ring) =>
    ring.some((point, index) => index && Math.abs(point[0] - ring[index - 1][0]) > 180)));
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const first = ring[index], second = ring[index + 1];
    sum += (second[0] - first[0]) * Math.PI / 180 *
      (2 + Math.sin(first[1] * Math.PI / 180) + Math.sin(second[1] * Math.PI / 180));
  }
  return Math.abs(sum * EARTH_RADIUS_KM ** 2 / 2);
}

export function regionAreaKm2(geometry) {
  if (!validGeometry(geometry) || crossesDateLine(geometry)) return 0;
  return polygonCoordinates(geometry).reduce((sum, polygon) => sum + Math.max(0,
    ringArea(polygon[0]) - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0)), 0);
}

export function shouldSplitRegion(parent) {
  if (!parent?.id || parent.kind !== "state" || !validGeometry(parent.geometry) || crossesDateLine(parent.geometry)) return false;
  return regionAreaKm2(parent.geometry) > MIN_SPLIT_AREA_KM2;
}

function overlapsBounds(first, second) {
  return first[0][0] <= second[1][0] && first[1][0] >= second[0][0] &&
    first[0][1] <= second[1][1] && first[1][1] >= second[0][1];
}

function centerOf(geometry) {
  let weight = 0, x = 0, y = 0;
  for (const polygon of polygonCoordinates(geometry)) {
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
      const ring = polygon[ringIndex];
      let crossSum = 0, ringX = 0, ringY = 0;
      for (let index = 0; index < ring.length - 1; index += 1) {
        const first = ring[index], second = ring[index + 1];
        const cross = first[0] * second[1] - second[0] * first[1];
        crossSum += cross;
        ringX += (first[0] + second[0]) * cross;
        ringY += (first[1] + second[1]) * cross;
      }
      if (Math.abs(crossSum) < 1e-14) continue;
      const area = ringArea(ring) * (ringIndex ? -1 : 1);
      x += ringX / (3 * crossSum) * area;
      y += ringY / (3 * crossSum) * area;
      weight += area;
    }
  }
  if (weight > 0) return [x / weight, y / weight];
  const bounds = boundsOf(geometry);
  return [(bounds[0][1] + bounds[1][1]) / 2, (bounds[0][0] + bounds[1][0]) / 2];
}

function squaredDistance(first, second) {
  const latitudeScale = Math.cos((first[1] + second[1]) / 2 * Math.PI / 180);
  return ((first[0] - second[0]) * latitudeScale) ** 2 + (first[1] - second[1]) ** 2;
}

function selectUnits(parent, featureCollection) {
  const parentBounds = boundsOf(parent.geometry);
  const parentCoordinates = snapCoordinates(polygonCoordinates(parent.geometry));
  const candidates = [];
  for (const feature of featureCollection.features) {
    const geometry = feature?.geometry;
    if (!validGeometry(geometry) || crossesDateLine(geometry) ||
        !overlapsBounds(parentBounds, boundsOf(geometry))) continue;
    const name = String(feature.properties?.shapeName || feature.properties?.name || "").trim();
    if (!name) continue;
    const coordinates = clip("intersection", parentCoordinates, snapCoordinates(polygonCoordinates(geometry)));
    if (!coordinates.length) continue;
    const clipped = shape(coordinates), area = regionAreaKm2(clipped);
    // Neighboring counties can overlap a simplified state line by a small
    // amount. Only units mostly inside this parent belong to its partition.
    if (area <= 0 || area / regionAreaKm2(geometry) < 0.5) continue;
    const center = centerOf(clipped);
    candidates.push({ name, key: `${normalize(name)}:${String(feature.properties?.shapeID || "")}:${center.join(":")}`,
      geometry: clipped, coordinates, area, center });
    if (candidates.length > MAX_UNITS) return [];
  }
  return candidates.sort((first, second) => first.key.localeCompare(second.key));
}

function unitNeighbors(units) {
  const neighbors = units.map(() => new Set());
  const vertices = new Map();
  units.forEach((unit, index) => {
    for (const polygon of unit.coordinates) for (const ring of polygon) for (const point of ring) {
      const key = `${Math.round(point[0] * 1e5)}:${Math.round(point[1] * 1e5)}`;
      const owners = vertices.get(key) || [];
      for (const owner of owners) if (owner !== index) {
        neighbors[index].add(owner); neighbors[owner].add(index);
      }
      if (!owners.includes(index)) owners.push(index);
      vertices.set(key, owners);
    }
  });

  // Detached islands and independently simplified boundaries can leave graph
  // components disconnected. Join the nearest components deterministically;
  // no geometry is fabricated across the sea or between administrative units.
  const roots = units.map((_, index) => index);
  const root = (value) => {
    while (roots[value] !== value) { roots[value] = roots[roots[value]]; value = roots[value]; }
    return value;
  };
  const join = (first, second) => { roots[root(second)] = root(first); };
  neighbors.forEach((entries, index) => entries.forEach((other) => join(index, other)));
  while (new Set(roots.map((_, index) => root(index))).size > 1) {
    const nearest = new Map();
    for (let first = 0; first < units.length; first += 1) {
      for (let second = first + 1; second < units.length; second += 1) {
        const firstRoot = root(first), secondRoot = root(second);
        if (firstRoot === secondRoot) continue;
        const distance = squaredDistance(units[first].center, units[second].center);
        for (const key of [firstRoot, secondRoot]) {
          if (!nearest.has(key) || distance < nearest.get(key).distance) nearest.set(key, { first, second, distance });
        }
      }
    }
    if (!nearest.size) break;
    for (const { first, second } of nearest.values()) {
      neighbors[first].add(second); neighbors[second].add(first); join(first, second);
    }
  }
  return neighbors;
}

function geographicPartition(parent, units) {
  if (units.length < 4) return [];
  const area = regionAreaKm2(parent.geometry);
  const targetCount = Math.min(6, Math.floor(units.length / 2), Math.max(2, Math.round(area / 100000)));
  const targetArea = area / targetCount;
  const neighbors = unitNeighbors(units);
  const groups = new Map(units.map((unit, index) => [index, {
    id: index, units: [unit], area: unit.area, center: unit.center, neighbors: neighbors[index],
  }]));
  while (groups.size > targetCount || [...groups.values()].some((group) => group.units.length < 2)) {
    const smallest = [...groups.values()].sort((first, second) =>
      (first.units.length === 1 ? 0 : 1) - (second.units.length === 1 ? 0 : 1) ||
      first.area - second.area || first.id - second.id)[0];
    if (!smallest || groups.size < 2) return [];
    const options = [...smallest.neighbors].map((id) => groups.get(id)).filter(Boolean);
    const singletonOptions = smallest.units.length === 1 ? options.filter((group) => group.units.length === 1) : [];
    const nearest = (singletonOptions.length ? singletonOptions : options).sort((first, second) => {
      const score = (group) => squaredDistance(smallest.center, group.center) * (1 + group.area / targetArea);
      return score(first) - score(second) || first.id - second.id;
    })[0];
    if (!nearest) return [];
    const combinedArea = smallest.area + nearest.area;
    nearest.center = [0, 1].map((axis) =>
      (nearest.center[axis] * nearest.area + smallest.center[axis] * smallest.area) / combinedArea);
    nearest.area = combinedArea;
    nearest.units.push(...smallest.units);
    for (const id of smallest.neighbors) if (id !== nearest.id) {
      nearest.neighbors.add(id);
      const neighbor = groups.get(id);
      neighbor?.neighbors.delete(smallest.id);
      neighbor?.neighbors.add(nearest.id);
    }
    nearest.neighbors.delete(smallest.id);
    nearest.neighbors.delete(nearest.id);
    groups.delete(smallest.id);
  }
  if (groups.size < 2) return [];
  const bounds = boundsOf(parent.geometry), latitude = (bounds[0][0] + bounds[1][0]) / 2;
  const northSouth = bounds[1][0] - bounds[0][0] >=
    (bounds[1][1] - bounds[0][1]) * Math.cos(latitude * Math.PI / 180);
  const ordered = [...groups.values()].sort((first, second) => northSouth
    ? second.center[1] - first.center[1] || first.center[0] - second.center[0]
    : first.center[0] - second.center[0] || second.center[1] - first.center[1]);
  const labels = {
    2: ["North", "South"],
    3: ["North", "Central", "South"],
    4: ["North", "North Central", "South Central", "South"],
    5: ["North", "Upper Central", "Central", "Lower Central", "South"],
    6: ["Far North", "North", "North Central", "South Central", "South", "Far South"],
  }[ordered.length];
  return ordered.map((group, index) => {
    let direction = labels[index];
    if (!northSouth) direction = direction.replace(/North/g, "West").replace(/South/g, "East")
      .replace("Upper", "Western").replace("Lower", "Eastern");
    const slug = direction.toLowerCase().replaceAll(" ", "-");
    const name = `${parent.name} — ${direction}`;
    return { units: group.units, descriptor: {
      id: `${parent.id}:${NEEDMAP_REGION_VERSION}:${slug}`, slug, name,
      label: `${name}, ${parent.country || parent.name}`, kind: "needmap",
      parentId: parent.id, parentName: parent.name, country: parent.country,
      countryCode: parent.countryCode,
      memberNames: [...new Set(group.units.map((unit) => unit.name))].sort(),
    } };
  });
}

function clipHalfPlane(polygon, a, b, maximum) {
  const result = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const first = polygon[index], second = polygon[(index + 1) % polygon.length];
    const firstValue = a * first[0] + b * first[1] - maximum;
    const secondValue = a * second[0] + b * second[1] - maximum;
    if (firstValue <= 0) result.push(first);
    if ((firstValue <= 0) !== (secondValue <= 0)) {
      const fraction = firstValue / (firstValue - secondValue);
      result.push([first[0] + fraction * (second[0] - first[0]),
        first[1] + fraction * (second[1] - first[1])]);
    }
  }
  return result;
}

function nearestCenterCell(index, centers, bounds) {
  const west = bounds[0][1], south = bounds[0][0], east = bounds[1][1], north = bounds[1][0];
  const scaleSquared = Math.cos((south + north) / 2 * Math.PI / 180) ** 2;
  let polygon = [[west, south], [east, south], [east, north], [west, north]];
  const first = centers[index];
  centers.forEach((second, other) => {
    if (other === index || polygon.length < 3) return;
    const a = 2 * (second[0] - first[0]) * scaleSquared, b = 2 * (second[1] - first[1]);
    const maximum = (second[0] ** 2 - first[0] ** 2) * scaleSquared + second[1] ** 2 - first[1] ** 2;
    if (Math.abs(a) + Math.abs(b) < 1e-12) {
      if (other < index) polygon = [];
    } else polygon = clipHalfPlane(polygon, a, b, maximum);
  });
  return polygon.length < 3 ? [] : [[polygon.concat([polygon[0]])]];
}

/** Group verified neighboring administrative areas inside a selected parent.
 * Incomplete, malformed, excessively large, or date-line data leaves the
 * original parent usable rather than inventing a replacement boundary.
 */
export function buildNeedMapRegions(parent, featureCollection) {
  if (!shouldSplitRegion(parent) || featureCollection?.type !== "FeatureCollection" ||
      !Array.isArray(featureCollection.features)) return [];
  try {
    const units = selectUnits(parent, featureCollection);
    if (units.length < 4) return [];
    const groups = geographicPartition(parent, units);
    if (groups.length < 2) return [];
    const parentCoordinates = snapCoordinates(polygonCoordinates(parent.geometry));
    const covered = clip("union", ...units.map((unit) => unit.coordinates));
    const parentArea = regionAreaKm2(parent.geometry);
    if (regionAreaKm2(shape(covered)) / parentArea < MIN_COVERAGE) return [];
    const remainder = clip("difference", parentCoordinates, covered);
    const groupCoordinates = groups.map((group) => clip("union", ...group.units.map((unit) => unit.coordinates)));
    const centers = groupCoordinates.map((coordinates) => centerOf(shape(coordinates)));
    const parentBounds = boundsOf(parent.geometry);
    let assigned = [];
    const regions = [];
    for (let index = 0; index < groups.length; index += 1) {
      let coordinates = groupCoordinates[index];
      if (remainder.length) {
        const cell = nearestCenterCell(index, centers, parentBounds);
        const gap = cell.length ? clip("intersection", remainder, cell) : [];
        if (gap.length) coordinates = clip("union", coordinates, gap);
      }
      if (assigned.length) coordinates = clip("difference", coordinates, assigned);
      if (!coordinates.length) return [];
      const geometry = shape(coordinates);
      regions.push({ ...groups[index].descriptor, geometry, bounds: boundsOf(geometry),
        areaKm2: regionAreaKm2(geometry),
        // Earlier regions own shared seams, matching deterministic IP selection.
        excludedGeometry: assigned.length ? shape(assigned) : null,
        source: "NeedMap regions grouped from geoBoundaries administrative areas",
      });
      assigned = clip("union", assigned, coordinates);
    }
    // All parent territory, including small coast/source discrepancies, must
    // remain in the partition. A meaningful uncovered area fails safely.
    const missing = clip("difference", parentCoordinates, assigned);
    // Retry overlays can leave very narrow slivers at complex borders. Attach
    // only this numerically tiny remainder to the nearest existing region, then
    // recompute seam ownership; meaningful gaps still reject the partition.
    if (missing.length) {
      if (regionAreaKm2(shape(missing)) > Math.max(0.01, parentArea * 1e-6)) return [];
      const repairs = regions.map(() => []);
      for (const polygon of missing) {
        const center = centerOf(shape([polygon]));
        let closest = 0;
        for (let index = 1; index < centers.length; index += 1) {
          if (squaredDistance(center, centers[index]) < squaredDistance(center, centers[closest])) closest = index;
        }
        repairs[closest].push(polygon);
      }
      regions.forEach((region, index) => {
        if (!repairs[index].length) return;
        // The remainder already excludes every group's interior. Keep these
        // small parts directly, avoiding another unstable floating-point
        // overlay; multipart rendering and containment need no union here.
        region.geometry = shape([...region.geometry.coordinates, ...repairs[index]]);
        region.bounds = boundsOf(region.geometry);
        region.areaKm2 = regionAreaKm2(region.geometry);
      });
      assigned = [];
      for (const region of regions) {
        region.excludedGeometry = assigned.length ? shape(assigned) : null;
        assigned = [...assigned, ...region.geometry.coordinates];
      }
    }
    return regions;
  } catch {
    return [];
  }
}

export function needMapRegionContains(region, latitude, longitude) {
  return pointInGeometry(longitude, latitude, region?.geometry) &&
    (!region.excludedGeometry || !pointInGeometry(longitude, latitude, region.excludedGeometry));
}

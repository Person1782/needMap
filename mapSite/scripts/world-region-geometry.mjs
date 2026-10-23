// Source simplification/coordinate rounding can collapse a microscopic ring.
// Keep polygon/hole hierarchy: an invalid shell drops its whole polygon, while
// an invalid hole is omitted without ever turning another hole into a shell.
export function cleanWorldGeometry(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let removedRings = 0;
  const cleanRing = (ring) => {
    const result = [];
    for (const point of ring) {
      const previous = result[result.length - 1];
      if (!previous || point[0] !== previous[0] || point[1] !== previous[1]) result.push(point);
    }
    if (result.length && (result[0][0] !== result.at(-1)[0] || result[0][1] !== result.at(-1)[1])) result.push([...result[0]]);
    return result.length >= 4 && new Set(result.map((point) => `${point[0]},${point[1]}`)).size >= 3 ? result : null;
  };
  const cleaned = [];
  for (const polygon of polygons) {
    const shell = cleanRing(polygon[0]);
    if (!shell) { removedRings += polygon.length; continue; }
    const holes = [];
    for (const ring of polygon.slice(1)) {
      const hole = cleanRing(ring);
      if (hole) holes.push(hole); else removedRings += 1;
    }
    cleaned.push([shell, ...holes]);
  }
  if (!cleaned.length) throw new Error("Source boundary contains no non-degenerate polygon.");
  return { geometry: geometry.type === "Polygon" ? { type: "Polygon", coordinates: cleaned[0] }
    : { type: "MultiPolygon", coordinates: cleaned }, removedRings };
}

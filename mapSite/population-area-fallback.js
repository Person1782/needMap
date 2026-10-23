const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 900, HEIGHT = 340, PADDING = 26;
let nextId = 0;
const validPoint = (point) => Array.isArray(point) && point.length >= 2 &&
  Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
const longitude360 = (value) => (value % 360 + 360) % 360;

/** A network-free outline of the exact queried geometry, not a density map. */
export function createPopulationAreaFallback(container, { geometry, reports = [], i18n } = {}) {
  if (geometry?.type !== "MultiPolygon" || !Array.isArray(geometry.coordinates) || !geometry.coordinates.length) {
    throw new TypeError("A calculated population area is required.");
  }
  const polygons = geometry.coordinates;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new TypeError("Invalid population polygon.");
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.some((point) => !validPoint(point)) ||
          ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
        throw new TypeError("Invalid population ring.");
      }
    }
  }
  const vertices = polygons.flat(2);
  const polar = vertices.some(([, latitude]) => Math.abs(latitude) === 90);
  // Put the longitude seam in the largest unoccupied gap. The two pieces of
  // a small area split at +/-180 then sit next to each other, rather than at
  // opposite sides of a world-spanning view. Polar caps retain their full span.
  const longitudes = [...new Set(vertices.map(([longitude]) => longitude360(longitude)))].sort((a, b) => a - b);
  let seam = longitudes[0], largestGap = -1;
  for (let i = 0; i < longitudes.length; i++) {
    const next = longitudes[(i + 1) % longitudes.length] + (i === longitudes.length - 1 ? 360 : 0);
    if (next - longitudes[i] > largestGap) { largestGap = next - longitudes[i]; seam = next % 360; }
  }
  const unwrap = (longitude) => {
    if (polar) return longitude;
    const value = longitude360(longitude);
    return value < seam - 1e-10 ? value + 360 : value;
  };
  const latitudes = vertices.map(([, latitude]) => latitude);
  const middleLatitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  const longitudeScale = Math.max(0.000001, Math.cos(middleLatitude * Math.PI / 180));
  const project = ([longitude, latitude]) => [unwrap(longitude) * longitudeScale, -latitude];
  const projected = vertices.map(project);
  const xs = projected.map(([x]) => x), ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const xSpan = maxX - minX, ySpan = maxY - minY;
  if (!Number.isFinite(xSpan) || !Number.isFinite(ySpan) || xSpan <= 0 || ySpan <= 0) throw new RangeError("The population area has no drawable extent.");
  const scale = Math.min((WIDTH - 2 * PADDING) / xSpan, (HEIGHT - 2 * PADDING) / ySpan);
  const offsetX = (WIDTH - xSpan * scale) / 2, offsetY = (HEIGHT - ySpan * scale) / 2;
  const screen = (point) => { const [x, y] = project(point); return [offsetX + (x - minX) * scale, offsetY + (y - minY) * scale]; };
  const doc = container.ownerDocument;
  const tr = (key, fallback) => i18n ? i18n.t(key) : fallback;
  const svgNode = (tag, attributes = {}, text) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const id = `population-outline-${++nextId}`;
  const svg = svgNode("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, width: "100%", height: "100%", preserveAspectRatio: "xMidYMid meet",
    role: "img", "aria-labelledby": `${id}-title ${id}-description`, "data-population-area-fallback": "" });
  svg.append(svgNode("title", { id: `${id}-title` }, tr("population.fallbackTitle", "Report locations and the area used for the population estimate")));
  svg.append(svgNode("desc", { id: `${id}-description` }, tr("population.fallbackDescription", "Area outline only; the background map is unavailable. Blue shapes are the actual merged calculation areas, including any holes. Dark dots are report locations. This is not a population-density map. North is up.")));
  svg.append(svgNode("rect", { width: WIDTH, height: HEIGHT, fill: "#edf2f6" }));
  for (const polygon of polygons) {
    const d = polygon.map((ring) => `${ring.map((point, index) => {
      const [x, y] = screen(point); return `${index ? "L" : "M"}${x.toFixed(3)},${y.toFixed(3)}`;
    }).join(" ")} Z`).join(" ");
    svg.append(svgNode("path", { d, fill: "#007ac2", "fill-opacity": 0.18, stroke: "#005ea8", "stroke-width": 2, "fill-rule": "evenodd", "vector-effect": "non-scaling-stroke" }));
  }
  const seen = new Set();
  for (const report of Array.isArray(reports) ? reports : []) {
    const point = [report?.longitude, report?.latitude];
    if (!validPoint(point) || seen.has(point.join(","))) continue;
    seen.add(point.join(","));
    const [x, y] = screen(point);
    // An out-of-selection coordinate must not distort the actual area view.
    if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) continue;
    svg.append(svgNode("circle", { cx: x.toFixed(3), cy: y.toFixed(3), r: 5, fill: "#15344a", stroke: "#fff", "stroke-width": 2 }));
  }
  svg.append(svgNode("text", { x: 14, y: 20, fill: "#526575", "font-size": 12, "font-family": "system-ui, sans-serif" }, tr("population.fallbackCaption", "Area outline only · background map unavailable")));
  container.replaceChildren(svg);
  return { destroy() { svg.remove(); } };
}

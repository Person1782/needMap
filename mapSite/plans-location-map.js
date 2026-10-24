import { serviceIconSvg } from "./service-icons.js";
import { getReportCoordinates } from "./report-location-map.js";
import { attachMapZoom } from "./map-zoom.js";
import { attachMapViewport, MAP_WORLD_BOUNDS, MAP_VIEWPORT_OPTIONS } from "./map-viewport.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_WIDTH = 800;
const FALLBACK_HEIGHT = 420;
const FALLBACK_PADDING = 34;

function svgNode(document, name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function validGeoPoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}

function geometryPolygons(geometry) {
  const source = geometry?.type === "MultiPolygon" ? geometry.coordinates
    : geometry?.type === "Polygon" ? [geometry.coordinates] : [];
  if (!Array.isArray(source)) return [];
  return source.map((polygon) => Array.isArray(polygon)
    ? polygon.filter((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(validGeoPoint))
    : []).filter((polygon) => polygon.length);
}

function decimal(value) {
  return Number(value.toFixed(2));
}

/**
 * Draws the supplied GeoJSON planning area and locations when Leaflet cannot
 * initialize. Coordinates are projected together, so the outline, candidate,
 * and reports retain their real relative positions instead of becoming a
 * decorative placeholder.
 */
export function renderPlansLocationFallback(container, { candidate, geometry, i18n } = {}) {
  if (!container?.ownerDocument) throw new TypeError("A Plans map container is required.");
  const document = container.ownerDocument;
  const tr = (key, values = {}, fallback = key) => i18n
    ? i18n.t(key, values)
    : Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), fallback);
  const polygons = geometryPolygons(geometry);
  const candidatePoint = getReportCoordinates(candidate?.position);
  const reportPoints = (candidate?.supportingReports || []).map((report) => ({
    report,
    point: getReportCoordinates(report),
  })).filter((entry) => entry.point);
  const geometryPoints = polygons.flatMap((polygon) => polygon.flat());
  const anchorLongitude = candidatePoint?.[1] ?? geometryPoints[0]?.[0] ?? reportPoints[0]?.point[1] ?? 0;
  const unwrapLongitude = (longitude) => {
    let value = longitude;
    while (value - anchorLongitude > 180) value -= 360;
    while (value - anchorLongitude < -180) value += 360;
    return value;
  };
  const sourcePoints = [
    ...geometryPoints.map(([longitude, latitude]) => [latitude, unwrapLongitude(longitude)]),
    ...reportPoints.map(({ point }) => [point[0], unwrapLongitude(point[1])]),
    ...(candidatePoint ? [[candidatePoint[0], unwrapLongitude(candidatePoint[1])]] : []),
  ];
  const latitudes = sourcePoints.map(([latitude]) => latitude);
  const referenceLatitude = latitudes.length
    ? (Math.min(...latitudes) + Math.max(...latitudes)) / 2
    : 0;
  const longitudeScale = Math.max(0.05, Math.cos(referenceLatitude * Math.PI / 180));
  const projected = sourcePoints.map(([latitude, longitude]) => ({
    x: (longitude - anchorLongitude) * longitudeScale,
    y: -latitude,
  }));
  const rawMinX = projected.length ? Math.min(...projected.map(({ x }) => x)) : -0.5;
  const rawMaxX = projected.length ? Math.max(...projected.map(({ x }) => x)) : 0.5;
  const rawMinY = projected.length ? Math.min(...projected.map(({ y }) => y)) : -0.5;
  const rawMaxY = projected.length ? Math.max(...projected.map(({ y }) => y)) : 0.5;
  const centerX = (rawMinX + rawMaxX) / 2;
  const centerY = (rawMinY + rawMaxY) / 2;
  const spanX = Math.max(rawMaxX - rawMinX, 1e-6);
  const spanY = Math.max(rawMaxY - rawMinY, 1e-6);
  const scale = Math.min(
    (FALLBACK_WIDTH - FALLBACK_PADDING * 2) / spanX,
    (FALLBACK_HEIGHT - FALLBACK_PADDING * 2) / spanY,
  );
  const project = (latitude, longitude) => ({
    x: FALLBACK_WIDTH / 2 + ((unwrapLongitude(longitude) - anchorLongitude) * longitudeScale - centerX) * scale,
    y: FALLBACK_HEIGHT / 2 + (-latitude - centerY) * scale,
  });

  const svg = svgNode(document, "svg", {
    class: "plan-fallback-map",
    viewBox: `0 0 ${FALLBACK_WIDTH} ${FALLBACK_HEIGHT}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": tr("plans.vectorMap", {}, "Planning area outline"),
  });
  svg.append(svgNode(document, "rect", {
    class: "plan-fallback-background", x: 0, y: 0,
    width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT,
  }));

  if (polygons.length) {
    const pathData = polygons.map((polygon) => polygon.map((ring) => ring.map(([longitude, latitude], index) => {
      const point = project(latitude, longitude);
      return `${index ? "L" : "M"}${decimal(point.x)} ${decimal(point.y)}`;
    }).join(" ") + " Z").join(" ")).join(" ");
    svg.append(svgNode(document, "path", {
      class: "plan-fallback-area",
      d: pathData,
      "fill-rule": "evenodd",
      "data-geographic-role": "service-area",
    }));
  }

  for (const { report, point: [latitude, longitude] } of reportPoints) {
    const point = project(latitude, longitude);
    const marker = svgNode(document, "circle", {
      class: "plan-fallback-report",
      cx: decimal(point.x), cy: decimal(point.y), r: 6,
      "data-geographic-role": "report",
      "data-report-id": report?.id ?? "",
      "data-latitude": latitude,
      "data-longitude": longitude,
    });
    const title = svgNode(document, "title");
    title.textContent = typeof report?.summary === "string" && report.summary.trim()
      ? report.summary.trim() : tr("plans.reportLocations", {}, "Supporting report location");
    marker.append(title);
    svg.append(marker);
  }

  if (candidatePoint) {
    const [latitude, longitude] = candidatePoint;
    const point = project(latitude, longitude);
    const rank = [1, 2, 3].includes(candidate?.rank) ? candidate.rank : 1;
    const marker = svgNode(document, "g", {
      class: "plan-fallback-candidate",
      transform: `translate(${decimal(point.x)} ${decimal(point.y)})`,
      "data-geographic-role": "candidate",
      "data-latitude": latitude,
      "data-longitude": longitude,
    });
    const title = svgNode(document, "title");
    title.textContent = tr("plans.mapCandidate", { rank }, `Recommended location ${rank}`);
    marker.append(title, svgNode(document, "rect", {
      x: -20, y: -20, width: 40, height: 40, rx: 8,
    }));
    const icon = svgNode(document, "g", { class: "plan-fallback-icon" });
    icon.innerHTML = serviceIconSvg(candidate?.iconKey);
    const nestedIcon = icon.querySelector("svg");
    nestedIcon?.setAttribute("x", "-11");
    nestedIcon?.setAttribute("y", "-11");
    nestedIcon?.setAttribute("width", "22");
    nestedIcon?.setAttribute("height", "22");
    marker.append(icon);
    const rankCircle = svgNode(document, "circle", { class: "plan-fallback-rank", cx: 19, cy: -19, r: 11 });
    const rankText = svgNode(document, "text", { class: "plan-fallback-rank-text", x: 19, y: -15 });
    rankText.textContent = String(rank);
    marker.append(rankCircle, rankText);
    svg.append(marker);
  }

  container.style.background = "";
  container.replaceChildren(svg);
  return svg;
}

/**
 * Shows the exact planning area used for a recommendation. The vector area,
 * report points and candidate remain visible even when background tiles fail.
 */
export function createPlansLocationMap(L, container, { i18n } = {}) {
  if (!container) throw new TypeError("A Plans map container is required.");
  let map;
  let viewport;
  let detachZoom;
  let stopped = false;
  const tr = (key, values = {}, fallback = key) => i18n
    ? i18n.t(key, values)
    : Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), fallback);

  function translateControls() {
    for (const [control, key, fallback] of [
      [container.querySelector?.(".leaflet-control-zoom-in"), "map.zoomIn", "Zoom in"],
      [container.querySelector?.(".leaflet-control-zoom-out"), "map.zoomOut", "Zoom out"],
    ]) {
      if (!control) continue;
      const value = tr(key, {}, fallback);
      control.title = value;
      control.setAttribute("aria-label", value);
    }
  }

  try {
    map = L.map(container, {
      ...MAP_VIEWPORT_OPTIONS,
      minZoom: 2,
      scrollWheelZoom: true,
      touchZoom: true,
      zoomSnap: 0.25,
      zoomControl: true,
      attributionControl: true,
    }).setView([20, 0], 2);
    viewport = attachMapViewport(map);
    detachZoom = attachMapZoom(map);
    map.attributionControl.setPrefix(false);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      noWrap: true,
      bounds: MAP_WORLD_BOUNDS,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(map);
    const boundaryLayer = L.layerGroup().addTo(map);
    const areaLayer = L.layerGroup().addTo(map);
    const reportLayer = L.layerGroup().addTo(map);
    const candidateLayer = L.layerGroup().addTo(map);
    translateControls();
    const stopLanguage = i18n?.subscribe(translateControls) || (() => {});

    function update({ candidate, geometry, region } = {}) {
      if (!map || stopped) return;
      boundaryLayer.clearLayers();
      areaLayer.clearLayers();
      reportLayer.clearLayers();
      candidateLayer.clearLayers();
      if (region?.geometry) {
        L.geoJSON(region.geometry, {
          interactive: false,
          style: { color: "#55788f", weight: 1.5, dashArray: "5 5", fillOpacity: 0 },
        }).addTo(boundaryLayer);
      }
      let planningArea;
      if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
        planningArea = L.geoJSON(geometry, {
          interactive: false,
          style: { color: "#005ea8", weight: 2.5, fillColor: "#35a3d1", fillOpacity: 0.25 },
        }).addTo(areaLayer);
      }
      const points = [];
      for (const report of candidate?.supportingReports || []) {
        const point = getReportCoordinates(report);
        if (!point) continue;
        points.push(point);
        L.circleMarker(point, {
          radius: 5,
          weight: 2,
          color: "#fff",
          fillColor: "#15344a",
          fillOpacity: 1,
          interactive: false,
        }).addTo(reportLayer);
      }
      const center = getReportCoordinates(candidate?.position);
      if (center) {
        points.push(center);
        const rank = [1, 2, 3].includes(candidate.rank) ? candidate.rank : 1;
        const icon = L.divIcon({
          className: "",
          html: `<span class="plans-candidate-marker" aria-hidden="true">${serviceIconSvg(candidate.iconKey)}<b>${rank}</b></span>`,
          iconSize: [42, 42],
          iconAnchor: [21, 21],
        });
        L.marker(center, {
          icon,
          title: tr("plans.mapCandidate", { rank }, `Recommended location ${rank}`),
          keyboard: false,
          interactive: false,
        }).addTo(candidateLayer);
      }
      viewport.refresh();
      const bounds = planningArea?.getBounds();
      if (bounds?.isValid()) map.fitBounds(bounds, { padding: [34, 34], maxZoom: 13, animate: false });
      else if (points.length) map.fitBounds(points, { padding: [34, 34], maxZoom: 13, animate: false });
      else if (region?.bounds) map.fitBounds(region.bounds, { padding: [28, 28], maxZoom: 11, animate: false });
      else map.setView([20, 0], 2, { animate: false });
    }

    return {
      update,
      destroy() {
        if (stopped) return;
        stopped = true;
        stopLanguage();
        viewport?.destroy();
        detachZoom?.();
        const current = map;
        map = null;
        current?.remove();
      },
    };
  } catch (error) {
    stopped = true;
    viewport?.destroy();
    detachZoom?.();
    try { map?.remove(); } catch { /* Keep the original creation error. */ }
    throw error;
  }
}

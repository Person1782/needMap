import { getReportCoordinates } from "./report-location-map.js";
import { attachMapZoom } from "./map-zoom.js";
import { attachMapViewport, MAP_WORLD_BOUNDS, MAP_VIEWPORT_OPTIONS } from "./map-viewport.js";

/** Draws the exact queried area, not a simulated population-density layer. */
export function createPopulationAreaMap(L, container, { geometry, reports = [], i18n } = {}) {
  if (geometry?.type !== "MultiPolygon" || !Array.isArray(geometry.coordinates) || !geometry.coordinates.length) {
    throw new TypeError("A calculated population area is required.");
  }
  let map;
  let detachZoom;
  let viewport;
  try {
    map = L.map(container, { ...MAP_VIEWPORT_OPTIONS, attributionControl: true, scrollWheelZoom: true, touchZoom: true, zoomSnap: 0.25, zoomControl: true });
    viewport = attachMapViewport(map);
    detachZoom = attachMapZoom(map);
    map.attributionControl.setPrefix(false);
    const translateControls = () => {
      for (const [control, key, fallback] of [[container.querySelector?.(".leaflet-control-zoom-in"), "map.zoomIn", "Zoom in"], [container.querySelector?.(".leaflet-control-zoom-out"), "map.zoomOut", "Zoom out"]]) if (control) { const value = i18n ? i18n.t(key) : fallback; control.title = value; control.setAttribute("aria-label", value); }
    };
    translateControls();
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, noWrap: true, bounds: MAP_WORLD_BOUNDS,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(map);
    const layer = L.geoJSON(geometry, {
      interactive: false,
      style: { color: "#005ea8", weight: 2, fillColor: "#007ac2", fillOpacity: 0.18 },
    });
    const bounds = layer.getBounds();
    if (!bounds.isValid()) throw new RangeError("The population area cannot be displayed.");
    // Establish the view before adding paths: Leaflet needs renderer bounds
    // before its first polygon clipping pass, including inside a new dialog.
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: false });
    layer.addTo(map);
    const seen = new Set();
    for (const report of reports) {
      const point = getReportCoordinates(report);
      if (!point || seen.has(point.join(","))) continue;
      seen.add(point.join(","));
      L.circleMarker(point, { radius: 5, weight: 2, color: "#fff", fillColor: "#15344a", fillOpacity: 1, interactive: false }).addTo(map);
    }
  } catch (error) {
    viewport?.destroy();
    detachZoom?.();
    try { map?.remove(); } catch { /* Preserve the original error. */ }
    throw error;
  }
  return { destroy() { viewport?.destroy(); detachZoom?.(); const current = map; map = null; current?.remove(); } };
}

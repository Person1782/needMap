import { serviceIconSvg } from "./service-icons.js";
import { MAP_WORLD_BOUNDS, MAP_VIEWPORT_OPTIONS } from "./map-viewport.js";
import { trackLeafletTileLayer } from "./leaflet-loading.js";

const MAX_LATITUDE = 85.0511287798;
const urgencyColors = Object.freeze({ low: "#2f8a69", medium: "#d28b27", high: "#c34e42", unknown: "#526575" });

export function getReportCoordinates(report) {
  const latitude = report?.latitude;
  const longitude = report?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > MAX_LATITUDE || Math.abs(longitude) > 180) return null;
  return [latitude, longitude];
}

export function createReportLocationMap(L, container, report, { onLoading, loadingLabel = "Loading map…" } = {}) {
  const coordinates = getReportCoordinates(report);
  if (!coordinates) throw new RangeError("This report has no valid map location.");
  let map;
  let stopTileLoading = () => {};
  try {
    map = L.map(container, {
      ...MAP_VIEWPORT_OPTIONS,
      zoomControl: false,
      attributionControl: true,
      minZoom: 14,
      maxZoom: 14,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      keyboard: false,
      touchZoom: false,
      boxZoom: false,
      tapHold: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });
    map.attributionControl.setPrefix(false);
    map.setView(coordinates, 14);
    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      noWrap: true,
      bounds: MAP_WORLD_BOUNDS,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    });
    stopTileLoading = trackLeafletTileLayer(tiles, { onLoading, key: "report-map-tiles", label: () => typeof loadingLabel === "function" ? loadingLabel() : loadingLabel, target: container });
    tiles.addTo(map);
    const color = Object.hasOwn(urgencyColors, report.severity) ? urgencyColors[report.severity] : urgencyColors.unknown;
    const icon = L.divIcon({
      className: "",
      html: `<span class="report-marker" style="background:${color}" aria-hidden="true">${serviceIconSvg(report.category)}</span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    L.marker(coordinates, { icon, interactive: false, keyboard: false, draggable: false }).addTo(map);
  } catch (error) {
    stopTileLoading();
    // A partially created map still owns DOM listeners and tile requests.
    try { map?.remove(); } catch { /* Preserve the original creation failure. */ }
    throw error;
  }
  return {
    destroy() {
      stopTileLoading();
      const currentMap = map;
      map = null;
      currentMap?.remove();
    },
  };
}

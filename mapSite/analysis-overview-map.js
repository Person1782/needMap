import { serviceIconSvg } from './service-icons.js';
import { getReportCoordinates } from './report-location-map.js';
import { createMapPopups } from './map-popups.js';
import { attachMapZoom } from './map-zoom.js';
import { attachMapViewport, MAP_WORLD_BOUNDS, MAP_VIEWPORT_OPTIONS } from './map-viewport.js';
import { trackLeafletTileLayer } from './leaflet-loading.js';
import { CANDIDATE_MARKER_Z_INDEX, REPORT_MARKER_Z_INDEX, separatedCandidateIconOptions } from './map-marker-layout.js';

const colors = { low: '#2f8a69', medium: '#d28b27', high: '#c34e42', unknown: '#526575' };

export function createAnalysisOverviewMap(L, container, { reportPopup, candidatePopup, i18n, onLoading } = {}) {
  let map;
  let popups;
  let viewport;
  let detachZoom;
  let pendingFit;
  let stopTileLoading = () => {};
  const tr = (key, values = {}, fallback = key) => i18n ? i18n.t(key, values) : Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), fallback);
  const categoryName = (category) => tr(`category.${category}`, {}, String(category || "other").replaceAll("_", " "));
  function translateControls() {
    for (const [control, key] of [[container.querySelector(".leaflet-control-zoom-in"), "map.zoomIn"], [container.querySelector(".leaflet-control-zoom-out"), "map.zoomOut"]]) if (control) { control.title = tr(key, {}, control.title); control.setAttribute("aria-label", tr(key, {}, control.title)); }
    container.querySelectorAll(".leaflet-popup-close-button").forEach((button) => { button.title = tr("map.closePopup", {}, "Close popup"); button.setAttribute("aria-label", tr("map.closePopup", {}, "Close popup")); });
  }
  function applyPendingFit() {
    if (!map || !pendingFit || !(container.clientWidth > 0 && container.clientHeight > 0)) return;
    const fit = pendingFit;
    // Clear before refreshing: invalidating Leaflet's size can emit resize.
    pendingFit = undefined;
    viewport.refresh();
    if (fit.points.length) map.fitBounds(fit.points, { padding: [35, 35], maxZoom: 14, animate: false });
    else if (fit.bounds) map.fitBounds(fit.bounds, { padding: [25, 25], maxZoom: 11, animate: false });
    else map.setView([20, 0], 2, { animate: false });
  }
  try {
    map = L.map(container, { ...MAP_VIEWPORT_OPTIONS, minZoom: 2, scrollWheelZoom: true, touchZoom: true, zoomSnap: 0.25 }).setView([20, 0], 2);
    viewport = attachMapViewport(map);
    map.on('resize', applyPendingFit);
    detachZoom = attachMapZoom(map);
    map.attributionControl.setPrefix(false);
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, noWrap: true, bounds: MAP_WORLD_BOUNDS,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    });
    stopTileLoading = trackLeafletTileLayer(tiles, { onLoading, key: "analysis-map-tiles", label: () => tr("analysis.loadingMap", {}, "Loading map…"), target: container });
    tiles.addTo(map);
    const reportsLayer = L.layerGroup().addTo(map);
    const candidatesLayer = L.layerGroup().addTo(map);
    const boundaryLayer = L.layerGroup().addTo(map);
    popups = createMapPopups(L, map, { document: container.ownerDocument });
    translateControls(); map.on("popupopen", translateControls);
    const stopLanguage = i18n?.subscribe(translateControls) || (() => {});
    return {
      update({ region, reports = [], recommendations = [], category = 'all' } = {}) {
        if (!map) return;
        popups.close();
        reportsLayer.clearLayers(); candidatesLayer.clearLayers(); boundaryLayer.clearLayers();
        if (region?.geometry) L.geoJSON(region.geometry, { style: { color: '#005ea8', weight: 2, fillOpacity: .025 }, interactive: false }).addTo(boundaryLayer);
        const points = [];
        for (const report of reports) {
          if (category !== 'all' && report.category !== category) continue;
          const point = getReportCoordinates(report);
          if (!point) continue;
          points.push(point);
          const color = Object.hasOwn(colors, report.severity) ? colors[report.severity] : colors.unknown;
          const icon = L.divIcon({ className: '', html: `<span class="report-marker" style="background:${color}" aria-hidden="true">${serviceIconSvg(report.category)}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
          const marker = L.marker(point, { icon, zIndexOffset: REPORT_MARKER_Z_INDEX, title: tr("map.reportTitle", { category: categoryName(report.category), urgency: tr(`urgency.${report.severity || "unknown"}`, {}, report.severity || "unknown") }, `${report.category} report`) }).addTo(reportsLayer);
          popups.register(marker, () => reportPopup ? reportPopup(report) : safeText(container, report.summary || tr("analysis.communityReports", {}, "Community report")));
        }
        for (const candidate of recommendations) {
          if (category !== 'all' && candidate.category !== category) continue;
          const point = getReportCoordinates(candidate.position);
          if (!point) continue;
          points.push(point);
          const rank = [1, 2, 3].includes(candidate.locationRank) ? candidate.locationRank : 1;
          const type = categoryName(candidate.category);
          const icon = L.divIcon(separatedCandidateIconOptions(`<span class="candidate-marker" aria-hidden="true">${serviceIconSvg(candidate.category, type)}<b>${rank}</b></span>`));
          const marker = L.marker(point, { icon, zIndexOffset: CANDIDATE_MARKER_Z_INDEX, title: tr("map.suggestedTitle", { type, rank }, `${type} · suggested location ${rank}`) }).addTo(candidatesLayer);
          popups.register(marker, () => candidatePopup ? candidatePopup(candidate) : safeText(container, type));
        }
        pendingFit = { points, bounds: region?.bounds };
        applyPendingFit();
      },
      destroy() {
        if (!map) return;
        stopTileLoading();
        pendingFit = undefined;
        map.off('resize', applyPendingFit); map.off('popupopen', translateControls); stopLanguage();
        viewport?.destroy(); popups.destroy(); detachZoom?.();
        const old = map; map = null; old?.remove();
      },
    };
  } catch (error) {
    stopTileLoading();
    map?.off('resize', applyPendingFit);
    viewport?.destroy(); popups?.destroy(); detachZoom?.();
    try { map?.remove(); } catch { /* Preserve the creation failure. */ }
    throw error;
  }
}

function safeText(container, value) {
  const node = container.ownerDocument.createElement('p'); node.textContent = value; return node;
}

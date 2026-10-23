import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { CustomProvider, initializeAppCheck } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { buildRecommendations } from "./analysis.js";
import { enrichSignalsWithRegions } from "./regions.js";
import { loadNearbyServices } from "./existing-services.js";
import { normalizeReport, filterReports, reportSnapshotKey } from "./dashboard-state.js";
import { createRegionNavigation, regionContains, WORLD_REGION } from "./region-navigation.js";
import { createRegionPicker } from "./region-picker.js";
import { serviceIconSvg } from "./service-icons.js";
import { ANALYSIS_CATEGORIES, categoryForReport } from "./analysis-model.js";
import { createAnalysisWorkspace } from "./analysis-workspace.js";
import { createReportLocationMap } from "./report-location-map.js";
import { reviewComplaints } from "./analysis-ai.js";
import "./analysis.css";

const firebaseApp = initializeApp(firebaseConfig);
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
  initializeAppCheck(firebaseApp, {
    provider: new CustomProvider({ getToken: async () => { throw new Error("The local App Check debug provider was not activated."); } }),
    isTokenAutoRefreshEnabled: true,
  });
}
const db = getFirestore(firebaseApp);
const $ = (selector) => document.querySelector(selector);
const status = $("#status");
const liveDot = $("#live-dot");
const reportList = $("#report-list");
const search = $("#report-search");
const category = $("#category-filter");
const urgency = $("#urgency-filter");
const viewport = $("#viewport-filter");
const mapMessage = $("#map-message");
const map = L.map("map", { maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1, minZoom: 2 }).setView([20, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, noWrap: true, bounds: [[-85.051129, -180], [85.051129, 180]], attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
}).addTo(map);
const reportsLayer = L.layerGroup().addTo(map);
const candidatesLayer = L.layerGroup().addTo(map);
const servicesLayer = L.layerGroup().addTo(map);
const selectedRegionLayer = L.layerGroup().addTo(map);
const colors = { low: "#2f8a69", medium: "#d28b27", high: "#c34e42", unknown: "#526575" };
let reports = [];
let recommendations = [];
let selectedRegion = WORLD_REGION;
let snapshotKey = "";
let regionRevision = 0;
let regionController;
let resolving = false;
let serviceRevision = 0;
let renderFrame;
let connectionFailed = false;
let reportsReady = false;
const analysisWorkspace = createAnalysisWorkspace({ firebaseApp, reviewComplaints, createReportMap: (container, report) => createReportLocationMap(L, container, report) });
function updateAnalysis() {
  analysisWorkspace.update({ region: selectedRegion, reports: regionReports(), reportsReady, connectionFailed });
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function label(value) { return ANALYSIS_CATEGORIES.find((entry) => entry.id === value)?.label || String(value || "other").replaceAll("_", " "); }
function iconElement(category, detail) {
  const icon = element("span", undefined, "service-icon");
  icon.setAttribute("aria-hidden", "true");
  // Only fixed, locally defined SVG paths are inserted; report text is never HTML.
  icon.innerHTML = serviceIconSvg(category, detail);
  return icon;
}
function regionReports() {
  return reports.filter((report) => regionContains(selectedRegion, report.latitude, report.longitude))
    .map((report) => ({ ...report, category: categoryForReport(report) }));
}
function reportPopup(report) {
  const content = element("div", undefined, "report-popup");
  const heading = element("strong", undefined, "service-heading");
  heading.append(iconElement(report.category), element("span", label(report.category)));
  content.append(heading, element("p", report.summary), element("small", `${label(report.severity)} urgency · ${report.region?.name || "Approximate map area"} · Approximate location`));
  return content;
}
function selectedReports() {
  const bounds = map.getBounds();
  return filterReports(regionReports(), {
    query: search.value, category: category.value, urgency: urgency.value,
    contains: viewport.checked ? (report) => bounds.contains([report.latitude, report.longitude]) : undefined,
  });
}
function renderReports() {
  const selected = selectedReports();
  $("#report-count").textContent = selected.length;
  $("#urgent-count").textContent = selected.filter((report) => report.severity === "high").length;
  $("#report-scope").textContent = `${selected.length} of ${regionReports().length} reports in ${selectedRegion.name}${viewport.checked ? " · limited to the map area" : ""}.`;
  reportsLayer.clearLayers();
  reportList.replaceChildren();
  if (!selected.length) reportList.append(element("p", reports.length ? "No reports match these filters." : "Community reports will appear here when they arrive.", "empty-state"));
  selected.forEach((report) => {
    const icon = L.divIcon({ className: "", html: `<span class="report-marker" style="background:${colors[report.severity] || colors.unknown}" aria-hidden="true">${serviceIconSvg(report.category)}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([report.latitude, report.longitude], { icon, title: `${label(report.category)} · ${label(report.severity)} urgency` }).bindPopup(() => reportPopup(report)).addTo(reportsLayer);
    const card = element("button", undefined, "report-card");
    card.type = "button";
    const heading = element("span", undefined, "report-card-heading");
    const title = element("strong", undefined, "service-heading");
    title.append(iconElement(report.category), element("span", label(report.category)));
    heading.append(title, element("span", label(report.severity), `urgency-tag ${report.severity}`));
    card.append(heading, element("span", report.summary || "No description provided.", "report-copy"), element("small", report.region?.name || "Locating region…"));
    card.addEventListener("click", () => {
      map.setView([report.latitude, report.longitude], 14);
      // Map movement may rebuild markers when the viewport filter is enabled.
      L.popup().setLatLng([report.latitude, report.longitude]).setContent(reportPopup(report)).openOn(map);
    });
    reportList.append(card);
  });
}
function refreshCategories() {
  const previous = category.value;
  const categories = [...new Set(regionReports().map((report) => report.category))].sort();
  category.replaceChildren(new Option("All services", "all"), ...categories.map((name) => new Option(label(name), name)));
  category.value = categories.includes(previous) ? previous : "all";
}
function candidatePopup(candidate) {
  const content = element("div", undefined, "report-popup");
  const heading = element("strong", undefined, "service-heading");
  heading.append(iconElement(candidate.category, candidate.analysis.facilityType), element("span", candidate.analysis.facilityType));
  content.append(heading, element("p", `Suggested location ${candidate.locationRank || 1} of ${candidate.locationCount || 1} · ${candidate.signals.length} supporting reports`), element("p", candidate.analysis.decisionSummary || candidate.analysis.rationale));
  const services = element("button", "Find nearby existing services", "text-button");
  services.type = "button";
  services.addEventListener("click", () => showServices(candidate));
  content.append(element("small", "Report-based suggestions ranked by urgency and demand. Local site checks are still needed."), services);
  return content;
}
function renderCandidates() {
  candidatesLayer.clearLayers();
  recommendations.forEach((candidate) => {
    const rank = [1, 2, 3].includes(candidate.locationRank) ? candidate.locationRank : 1;
    const icon = L.divIcon({ className: "", html: `<span class="candidate-marker" aria-hidden="true">${serviceIconSvg(candidate.category, candidate.analysis.facilityType)}<b>${rank}</b></span>`, iconSize: [36, 36], iconAnchor: [18, 18] });
    L.marker([candidate.position.latitude, candidate.position.longitude], { icon, title: `${candidate.analysis.facilityType} · suggested location ${rank}` }).bindPopup(() => candidatePopup(candidate)).addTo(candidatesLayer);
  });
}
async function showServices(candidate) {
  const revision = ++serviceRevision;
  servicesLayer.clearLayers();
  mapMessage.hidden = false;
  mapMessage.textContent = "Looking for existing services within 5 km…";
  try {
    const result = await loadNearbyServices(candidate, { radiusMeters: 5000 });
    if (revision !== serviceRevision) return;
    result.services.forEach((service) => {
      const content = element("div");
      content.append(element("strong", service.name || "Existing service"), element("p", "OpenStreetMap listing; verify current opening hours and capacity."));
      L.circleMarker([service.latitude, service.longitude], { radius: 6, color: "#15344a", fillColor: "#fff", fillOpacity: 1 }).bindPopup(content).addTo(servicesLayer);
    });
    mapMessage.textContent = `${result.services.length} existing service listings within 5 km. OpenStreetMap coverage may be incomplete.`;
  } catch {
    if (revision === serviceRevision) mapMessage.textContent = "Existing services could not be loaded. Try again shortly.";
  }
}
function updateCandidates() {
  const scoped = regionReports();
  // An explicitly selected boundary defines the service-planning area.
  const candidates = buildRecommendations(selectedRegion.geometry ? scoped.map((report) => ({ ...report, region: selectedRegion })) : scoped);
  recommendations = candidates;
  renderCandidates();
  const candidateStatus = $("#candidate-status");
  candidateStatus.textContent = candidates.length
    ? `${candidates.length} proposed service locations. Numbered icons show up to three locations per service.`
    : resolving && !selectedRegion.geometry ? "Finding locations for proposed services…" : "Proposed services need at least two reports in the same region and category.";
  if (connectionFailed) candidateStatus.textContent += " Reports may be out of date while the connection is unavailable.";
}

[search, category, urgency, viewport].forEach((control) => control.addEventListener("input", renderReports));
$("#fit-reports").addEventListener("click", () => {
  viewport.checked = false;
  const selected = selectedReports();
  if (selected.length) map.fitBounds(selected.map((report) => [report.latitude, report.longitude]), { padding: [45, 45], maxZoom: 13 });
  renderReports();
});
$("#layer-reports").addEventListener("change", (event) => event.target.checked ? reportsLayer.addTo(map) : reportsLayer.removeFrom(map));
$("#layer-candidates").addEventListener("change", (event) => {
  event.target.checked ? candidatesLayer.addTo(map) : candidatesLayer.removeFrom(map);
});
map.on("moveend zoomend", () => { if (viewport.checked) renderReports(); });
const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
});
observer?.observe($("#map"));
if (["#plan", "#decisions"].includes(window.location.hash)) window.history.replaceState(null, "", "#explore-view");
function showPage() {
  const analyzing = window.location.hash.startsWith("#analysis");
  // Preserve the current Analysis view when the skip link targets it.
  if (analyzing && !$("#analysis-view").hidden) return;
  $("#explore-view").hidden = analyzing;
  $("#analysis-view").hidden = !analyzing;
  for (const [id, active] of [["#map-tab", !analyzing], ["#analysis-tab", analyzing]]) {
    if (active) $(id).setAttribute("aria-current", "page"); else $(id).removeAttribute("aria-current");
  }
  document.querySelector(".skip-link").href = analyzing ? "#analysis-view" : "#explore-view";
  document.querySelector(".skip-link").textContent = analyzing ? "Skip to analysis" : "Skip to map and reports";
  document.title = analyzing ? "NeedMap | Regional Analysis" : "NeedMap | Community Map";
  updateAnalysis(); analysisWorkspace.setVisible(analyzing);
  if (!analyzing) requestAnimationFrame(() => map.invalidateSize({ pan: false }));
}
window.addEventListener("hashchange", showPage);
showPage();

const regionNavigation = createRegionNavigation({
  onChange(region) {
    selectedRegion = region;
    serviceRevision += 1;
    servicesLayer.clearLayers();
    selectedRegionLayer.clearLayers();
    map.closePopup();
    mapMessage.hidden = true;
    viewport.checked = false;
    $("#current-region").textContent = region.label || region.name;
    $("#map-region-label").textContent = region.name === "Worldwide" ? "Worldwide community map" : region.name;
    if (region.geometry) L.geoJSON(region.geometry, { style: { color: "#005ea8", weight: 2, fillOpacity: .025 }, interactive: false }).addTo(selectedRegionLayer);
    if (region.bounds) map.fitBounds(region.bounds, { padding: [35, 35], maxZoom: 11, animate: false });
    else map.setView([20, 0], 2, { animate: false });
    refreshCategories();
    renderReports();
    updateCandidates();
    updateAnalysis();
    regionPicker.close();
  },
  onStatus({ state, message }) {
    $("#region-status").textContent = message;
    $("#region-action-status").textContent = message;
    $("#region-action-status").hidden = state === "ready";
  },
});
const regionPicker = createRegionPicker({ navigation: regionNavigation });
regionNavigation.initialize();

const unsubscribe = onSnapshot(collection(db, "incomingSignals"), (snapshot) => {
  reportsReady = true;
  connectionFailed = false;
  const incoming = [];
  snapshot.forEach((document) => { const report = normalizeReport(document.id, document.data()); if (report) incoming.push(report); });
  const nextKey = reportSnapshotKey(incoming);
  if (nextKey === snapshotKey) { updateAnalysis(); return; }
  snapshotKey = nextKey;
  regionController?.abort();
  regionController = new AbortController();
  const revision = ++regionRevision;
  serviceRevision += 1;
  servicesLayer.clearLayers();
  mapMessage.hidden = true;
  reports = incoming;
  resolving = reports.length > 0;
  refreshCategories();
  renderReports();
  updateCandidates();
  updateAnalysis();
  liveDot.className = "live-dot connected";
  status.textContent = resolving ? `Finding regions · 0/${reports.length}` : "Live · no reports yet";
  if (!reports.length) return;
  enrichSignalsWithRegions(reports, {
    signal: regionController.signal,
    onProgress(done, total) { if (revision === regionRevision) status.textContent = `Finding regions · ${done}/${total}`; },
  }).then((enriched) => {
    if (revision !== regionRevision) return;
    reports = enriched;
    resolving = false;
    const missing = reports.filter((report) => !report.region).length;
    status.textContent = missing ? `Live · ${missing} region${missing === 1 ? "" : "s"} unavailable` : `Live · ${reports.length} reports`;
    renderReports();
    updateCandidates();
  }).catch((error) => {
    if (revision !== regionRevision) return;
    console.error("NeedMap region lookup:", error);
    resolving = false;
    status.textContent = "Live · region lookup unavailable";
    updateCandidates();
  });
}, (error) => {
  console.error("NeedMap report connection:", error);
  regionController?.abort();
  regionRevision += 1;
  resolving = false;
  connectionFailed = true;
  status.textContent = "Connection unavailable · reload to reconnect";
  liveDot.className = "live-dot error";
  updateCandidates();
  updateAnalysis();
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  unsubscribe(); regionController?.abort(); regionNavigation.destroy(); regionPicker.destroy(); observer?.disconnect(); analysisWorkspace.destroy();
  window.removeEventListener("hashchange", showPage);
});

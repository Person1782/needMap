import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./planning.css";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { CustomProvider, initializeAppCheck } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { buildRecommendations } from "./analysis.js";
import { analyzeWithGemini } from "./gemini-analysis.js";
import { analysisFailureMessage } from "./analysis-status.js";
import { createAnalysisCoordinator } from "./analysis-coordinator.js";
import { enrichSignalsWithRegions } from "./regions.js";
import { loadNearbyServices } from "./existing-services.js";
import { createPlanningWorkspace } from "./planning-workspace.js";
import { getPlanningReference } from "./planning-references.js";
import { normalizeView, normalizeReport, filterReports, reportSnapshotKey, bindViewTabs } from "./dashboard-state.js";

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
const tabs = [...document.querySelectorAll("[data-view]")];
const status = $("#status");
const liveDot = $("#live-dot");
const exploreView = $("#explore-view");
const planView = $("#plan-view");
const reportList = $("#report-list");
const search = $("#report-search");
const category = $("#category-filter");
const urgency = $("#urgency-filter");
const viewport = $("#viewport-filter");
const analysisStatus = $("#analysis-status");
const progress = $("#analysis-progress");
const refreshButton = $("#refresh-analysis");
const mapMessage = $("#map-message");
const map = L.map("map", { maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1, minZoom: 2 }).setView([37.7749, -122.4194], 10);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, noWrap: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
}).addTo(map);
const reportsLayer = L.layerGroup().addTo(map);
const candidatesLayer = L.layerGroup().addTo(map);
const servicesLayer = L.layerGroup().addTo(map);
const regionLayer = L.layerGroup().addTo(map);
const colors = { low: "#2f8a69", medium: "#d28b27", high: "#c34e42", unknown: "#526575" };
let reports = [];
let recommendations = [];
let activeView = "explore";
let snapshotKey = "";
let regionRevision = 0;
let regionController;
let resolving = false;
let firstView = true;
let serviceRevision = 0;
let renderFrame;
const planner = createPlanningWorkspace({ root: $("#planning-workspace"), onShowRecommendation: showCandidate, getPlanningReference });

const coordinator = createAnalysisCoordinator({
  analyze: (batch, options) => analyzeWithGemini(firebaseApp, batch, options),
  onUpdate(items) {
    recommendations = items;
    planner.updateRecommendations(items);
    renderCandidates();
  },
  onProgress({ running, processed, total, analyzed, failed, error }) {
    refreshButton.disabled = running || resolving || !recommendations.length;
    progress.hidden = !running;
    progress.value = total ? processed / total * 100 : 0;
    analysisStatus.textContent = running
      ? `Reviewing report evidence · ${processed} of ${total} service candidates complete…`
      : failed
        ? `${analysisFailureMessage(error)} ${analyzed} of ${total} candidates were reviewed this time; earlier or report-based evidence is retained for the others.`
        : `Evidence reviewed for all ${total} service candidates. Select one below to build a plan.`;
  },
  onError(error) { console.error("NeedMap analysis:", error); },
});

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function label(value) { return String(value || "other").replaceAll("_", " "); }
function setView(value) {
  activeView = normalizeView(value);
  exploreView.hidden = activeView !== "explore";
  planView.hidden = activeView !== "plan";
  planner.setActive(activeView === "plan");
  tabs.forEach((tab) => {
    const selected = tab.dataset.view === activeView;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  const hash = `#${activeView}`;
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  if (activeView === "explore") requestAnimationFrame(() => map.invalidateSize());
  else if (!resolving) coordinator.run();
}
function reportPopup(report) {
  const content = element("div", undefined, "report-popup");
  content.append(element("strong", label(report.category)), element("p", report.summary), element("small", `${label(report.severity)} urgency · ${report.region?.name || "Region loading"} · Approximate location`));
  return content;
}
function selectedReports() {
  const bounds = map.getBounds();
  return filterReports(reports, {
    query: search.value, category: category.value, urgency: urgency.value,
    contains: viewport.checked ? (report) => bounds.contains([report.latitude, report.longitude]) : undefined,
  });
}
function renderReports() {
  const selected = selectedReports();
  $("#report-count").textContent = selected.length;
  $("#urgent-count").textContent = selected.filter((report) => report.severity === "high").length;
  $("#report-scope").textContent = `${selected.length} of ${reports.length} reports${viewport.checked ? " in this map area" : " across all regions"}.`;
  reportsLayer.clearLayers();
  reportList.replaceChildren();
  if (!selected.length) reportList.append(element("p", reports.length ? "No reports match these filters." : "Community reports will appear here when they arrive.", "empty-state"));
  selected.forEach((report) => {
    const marker = L.circleMarker([report.latitude, report.longitude], { radius: 7, weight: 2, color: "#fff", fillColor: colors[report.severity], fillOpacity: .92 }).bindPopup(() => reportPopup(report)).addTo(reportsLayer);
    const card = element("button", undefined, "report-card");
    card.type = "button";
    const heading = element("span", undefined, "report-card-heading");
    heading.append(element("strong", label(report.category)), element("span", label(report.severity), `urgency-tag ${report.severity}`));
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
  const categories = [...new Set(reports.map((report) => report.category))].sort();
  category.replaceChildren(new Option("All services", "all"), ...categories.map((name) => new Option(label(name), name)));
  category.value = categories.includes(previous) ? previous : "all";
}
function candidatePopup(candidate) {
  const content = element("div", undefined, "report-popup");
  content.append(element("strong", candidate.analysis.facilityType), element("p", candidate.analysis.decisionSummary || candidate.analysis.rationale));
  const plan = element("button", "Build a plan", "primary-button");
  plan.type = "button";
  plan.addEventListener("click", () => { planner.selectRecommendation(candidate.id); setView("plan"); });
  const services = element("button", "Find nearby existing services", "text-button");
  services.type = "button";
  services.addEventListener("click", () => showServices(candidate));
  content.append(plan, services);
  return content;
}
function renderCandidates() {
  candidatesLayer.clearLayers();
  recommendations.forEach((candidate) => {
    const icon = L.divIcon({ className: "", html: '<span class="candidate-marker" aria-hidden="true">✦</span>', iconSize: [30, 30], iconAnchor: [15, 15] });
    L.marker([candidate.position.latitude, candidate.position.longitude], { icon, title: candidate.analysis.facilityType }).bindPopup(() => candidatePopup(candidate)).addTo(candidatesLayer);
  });
}
function showCandidate(candidate) {
  setView("explore");
  regionLayer.clearLayers();
  if (candidate.region?.geometry) L.geoJSON(candidate.region.geometry, { style: { color: "#005ea8", weight: 2, fillOpacity: .07 } }).addTo(regionLayer);
  $("#layer-candidates").checked = true;
  candidatesLayer.addTo(map);
  regionLayer.addTo(map);
  requestAnimationFrame(() => {
    map.setView([candidate.position.latitude, candidate.position.longitude], 13);
    L.popup().setLatLng([candidate.position.latitude, candidate.position.longitude]).setContent(candidatePopup(candidate)).openOn(map);
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
  const candidates = buildRecommendations(reports);
  coordinator.replace(candidates);
  refreshButton.disabled = resolving || !candidates.length;
  analysisStatus.textContent = candidates.length
    ? `${candidates.length} report-based service candidates are ready. Evidence review runs when you open Plan.`
    : resolving ? "Finding the regions for community reports…" : "A service candidate needs at least two reports in the same region and category.";
  progress.hidden = true;
  if (activeView === "plan" && !resolving && candidates.length) coordinator.run();
}

bindViewTabs(tabs, setView);
window.addEventListener("hashchange", () => setView(window.location.hash.slice(1)));
$("#open-plan").addEventListener("click", () => setView("plan"));
refreshButton.addEventListener("click", () => coordinator.run({ force: true }));
[search, category, urgency, viewport].forEach((control) => control.addEventListener("input", renderReports));
$("#fit-reports").addEventListener("click", () => {
  viewport.checked = false;
  const selected = selectedReports();
  if (selected.length) map.fitBounds(selected.map((report) => [report.latitude, report.longitude]), { padding: [45, 45], maxZoom: 13 });
  renderReports();
});
$("#layer-reports").addEventListener("change", (event) => event.target.checked ? reportsLayer.addTo(map) : reportsLayer.removeFrom(map));
$("#layer-candidates").addEventListener("change", (event) => {
  [candidatesLayer, regionLayer].forEach((layer) => event.target.checked ? layer.addTo(map) : layer.removeFrom(map));
});
map.on("moveend zoomend", () => { if (viewport.checked) renderReports(); });
const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
});
observer?.observe($("#map"));
setView(window.location.hash.slice(1));

const unsubscribe = onSnapshot(collection(db, "incomingSignals"), (snapshot) => {
  const incoming = [];
  snapshot.forEach((document) => { const report = normalizeReport(document.id, document.data()); if (report) incoming.push(report); });
  const nextKey = reportSnapshotKey(incoming);
  if (nextKey === snapshotKey) return;
  snapshotKey = nextKey;
  regionController?.abort();
  regionController = new AbortController();
  const revision = ++regionRevision;
  serviceRevision += 1;
  servicesLayer.clearLayers();
  regionLayer.clearLayers();
  mapMessage.hidden = true;
  reports = incoming;
  resolving = reports.length > 0;
  planner.updateSignals(reports);
  refreshCategories();
  renderReports();
  updateCandidates();
  liveDot.className = "live-dot connected";
  status.textContent = resolving ? `Finding regions · 0/${reports.length}` : "Live · no reports yet";
  if (firstView && reports.length) {
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    map.setView([median(reports.map((report) => report.latitude)), median(reports.map((report) => report.longitude))], 10, { animate: false });
    firstView = false;
  }
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
    planner.updateSignals(reports);
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
  coordinator.destroy();
  resolving = false;
  refreshButton.disabled = true;
  progress.hidden = true;
  status.textContent = "Connection unavailable · reload to reconnect";
  liveDot.className = "live-dot error";
  analysisStatus.textContent = "The live connection is unavailable. Any visible reports and plans may be out of date.";
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  unsubscribe(); regionController?.abort(); coordinator.destroy(); planner.destroy(); observer?.disconnect();
});

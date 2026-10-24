import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { CustomProvider, initializeAppCheck } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { buildRecommendations } from "./analysis.js";
import { enrichSignalsWithRegions } from "./regions.js";
import { normalizeReport, filterReports, reportSnapshotKey } from "./dashboard-state.js";
import { createRegionNavigation, regionContains, WORLD_REGION } from "./region-navigation.js";
import { createRegionPicker } from "./region-picker.js";
import { serviceIconSvg } from "./service-icons.js";
import { ANALYSIS_CATEGORIES, categoryForReport } from "./analysis-model.js";
import { createAnalysisWorkspace } from "./analysis-workspace.js";
import { createReportLocationMap } from "./report-location-map.js";
import { createAnalysisOverviewMap } from "./analysis-overview-map.js";
import { createMapPopups } from "./map-popups.js";
import { attachMapZoom } from "./map-zoom.js";
import { attachMapViewport, MAP_WORLD_BOUNDS, MAP_VIEWPORT_OPTIONS } from "./map-viewport.js";
import { reviewComplaints } from "./analysis-ai.js";
import "./analysis.css";
import { createPopulationAreaMap } from "./population-area-map.js";
import "./population-details.css";
import { createI18n } from "./i18n/index.js";
import { createLanguagePicker } from "./i18n/language-picker.js";
import { createPlansWorkspace } from "./plans-workspace.js";
import { createPlansLocationMap } from "./plans-location-map.js";
import { buildPlanBenchmarkEvidence } from "./plans-benchmarks.js";
import { loadPlanLocalCostAdjustment } from "./plans-local-cost.js";
import "./plans.css";

const i18n = createI18n();
await i18n.initialize();

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
function translateStaticInterface() {
  document.documentElement.style.setProperty("--language-direction", i18n.direction);
  const meta = document.querySelector('meta[name="description"]'); if (meta) meta.content = i18n.t("meta.description");
  document.querySelectorAll("[data-i18n]").forEach((item) => { item.textContent = i18n.t(item.dataset.i18n); });
  const text = {
    ".skip-link": "skip.map", "#change-region": "region.change", "#region-status": "region.finding", "#region-search-form label": "region.find",
    "#region-search-form button": "region.search", "#region-search-hint": "region.hint", "#region-data-label": "region.data", "#region-boundaries-label": "region.boundaries", "#map-tab": "nav.map", "#analysis-tab": "nav.analysis", "#plans-tab": "nav.plans",
    ".explore-panel>.eyebrow": "explore.eyebrow", ".explore-panel>h2": "explore.title", ".explore-panel>.intro": "explore.intro",
    ".explore-metrics>div:first-child span": "explore.reportsShown", ".explore-metrics>div:last-child span": "explore.highUrgency", "#candidate-status": "explore.waitingServices", "#report-scope": "explore.waitingReports",
    ".report-filters>label[for=report-search]": "explore.searchLabel", ".filter-row label:first-child": "explore.service", ".filter-row label:last-child": "explore.urgency",
    ".check-label": "explore.onlyMap", ".report-list-heading h3": "explore.communityReports", ".map-caption span": "map.approximate",
    "#fit-reports": "map.center", ".map-layer-control strong": "map.show", ".map-layer-control label:first-of-type": "map.reports", ".map-layer-control label:last-of-type": "map.services",
    ".map-legend strong": "urgency.label", ".map-legend span:nth-of-type(1)": "urgency.low", ".map-legend span:nth-of-type(2)": "urgency.medium", ".map-legend span:nth-of-type(3)": "urgency.high", ".map-legend span:nth-of-type(4)": "map.ranked",
    ".analysis-heading .eyebrow": "analysis.eyebrow", "#analysis-title": "analysis.title", ".analysis-filter": "analysis.problem", "#analysis-map-title": "analysis.mapTitle",
    "#analysis-map-note": "analysis.mapNote", ".analysis-map-legend span:nth-child(1)": "analysis.communityReports", ".analysis-map-legend span:nth-child(2)": "analysis.serviceLocations", ".analysis-map-location-note": "map.approximate",
    "#report-comparison-title": "analysis.reportsByProblem", ".report-comparison>.analysis-note": "analysis.chartHelp", "#priority-title": "analysis.priorityTitle", ".analysis-section-heading>span": "analysis.priorityInspect", ".analysis-priorities>.analysis-note": "analysis.priorityHelp",
  };
  for (const [selector, key] of Object.entries(text)) {
    const item = document.querySelector(selector); if (!item) continue;
    if (["#change-region", "#fit-reports"].includes(selector)) {
      for (const child of [...item.childNodes]) if (child.nodeType === 3) child.remove();
      if (selector === "#fit-reports") item.append(document.createTextNode(i18n.t(key)));
      else item.prepend(document.createTextNode(`${i18n.t(key)} `));
    } else if ([".filter-row label:first-child", ".filter-row label:last-child", ".check-label", ".analysis-filter", ".map-layer-control label:first-of-type", ".map-layer-control label:last-of-type", ".map-legend span:nth-of-type(1)", ".map-legend span:nth-of-type(2)", ".map-legend span:nth-of-type(3)", ".map-legend span:nth-of-type(4)", ".analysis-map-legend span:nth-child(1)", ".analysis-map-legend span:nth-child(2)"].includes(selector)) {
      for (const child of [...item.childNodes]) if (child.nodeType === 3) child.textContent = ` ${i18n.t(key)}`;
    } else item.textContent = i18n.t(key);
  }
  const attributes = [
    ["#region-menu", "aria-label", "region.menu"], ["#region-search", "placeholder", "region.placeholder"], ["#region-results", "aria-label", "region.results"],
    [".page-navigation", "aria-label", "nav.label"], ["#explore-view", "aria-label", "skip.map"], ["#report-search", "placeholder", "explore.searchPlaceholder"],
    ["#map", "aria-label", "map.community", { region: document.getElementById("current-region")?.textContent || "Worldwide" }], ["#fit-reports", "title", "map.centerTitle"], [".map-layer-control", "aria-label", "map.layers"], [".map-legend", "aria-label", "map.symbols"],
    ["#analysis-overview-map", "aria-label", "analysis.mapLabel"], [".analysis-map-legend", "aria-label", "analysis.symbols"], ["#analysis-overview", "aria-label", "analysis.overview"],
    ["#plans-view", "aria-label", "skip.plans"], ["#plans-region-menu", "aria-label", "region.menu"], ["#plans-region-search", "placeholder", "region.placeholder"], ["#plans-region-results", "aria-label", "region.results"],
  ];
  for (const [selector, attribute, key, values] of attributes) document.querySelector(selector)?.setAttribute(attribute, i18n.t(key, values));
  search.placeholder = i18n.t("explore.searchPlaceholder");
  const urgencyValue = urgency.value;
  urgency.replaceChildren(new Option(i18n.t("explore.allLevels"), "all"), new Option(i18n.t("urgency.high"), "high"), new Option(i18n.t("urgency.medium"), "medium"), new Option(i18n.t("urgency.low"), "low"));
  urgency.value = urgencyValue;
}
translateStaticInterface();
const languagePicker = createLanguagePicker({ i18n });
const map = L.map("map", { ...MAP_VIEWPORT_OPTIONS, minZoom: 2, scrollWheelZoom: true, touchZoom: true, zoomSnap: 0.25 }).setView([20, 0], 2);
function translateMapControls() {
  const zoomIn = document.querySelector("#map .leaflet-control-zoom-in"), zoomOut = document.querySelector("#map .leaflet-control-zoom-out");
  for (const [control, key] of [[zoomIn, "map.zoomIn"], [zoomOut, "map.zoomOut"]]) if (control) { control.title = i18n.t(key); control.setAttribute("aria-label", i18n.t(key)); }
  document.querySelectorAll("#map .leaflet-popup-close-button").forEach((button) => { button.title = i18n.t("map.closePopup"); button.setAttribute("aria-label", i18n.t("map.closePopup")); });
}
translateMapControls();
map.on("popupopen", translateMapControls);
const mapViewport = attachMapViewport(map);
const detachMapZoom = attachMapZoom(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, noWrap: true, bounds: MAP_WORLD_BOUNDS, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
}).addTo(map);
const reportsLayer = L.layerGroup().addTo(map);
const candidatesLayer = L.layerGroup().addTo(map);
const mapPopups = createMapPopups(L, map);
let reportPopupDisposers = [];
let candidatePopupDisposers = [];
const selectedRegionLayer = L.layerGroup().addTo(map);
const colors = { low: "#2f8a69", medium: "#d28b27", high: "#c34e42", unknown: "#526575" };
let reports = [];
let recommendations = [];
let selectedRegion = WORLD_REGION;
let pendingRegionFit = false;
let snapshotKey = "";
let regionRevision = 0;
let regionController;
let resolving = false;
let connectionFailed = false;
let reportsReady = false;
let connectionMessage = { key: "connection.connecting", values: {} };
let regionMessage = { key: "region.finding", values: {} };
let planCostState = { countryCode: null, status: "idle", adjustment: null };
let planCostRevision = 0;
let planCostController;
function setConnectionMessage(key, values = {}) { connectionMessage = { key, values }; status.textContent = i18n.t(key, values); }
setConnectionMessage("connection.connecting");
const analysisWorkspace = createAnalysisWorkspace({ i18n, firebaseApp, reviewComplaints, createPopulationMap: (container, options) => createPopulationAreaMap(L, container, { ...options, i18n }), createOverviewMap: (container) => createAnalysisOverviewMap(L, container, { reportPopup, candidatePopup, i18n }), createReportMap: (container, report) => createReportLocationMap(L, container, report) });
function updateAnalysis() {
  analysisWorkspace.update({ region: selectedRegion, reports: regionReports(), recommendations, reportsReady, connectionFailed });
}
const plansWorkspace = createPlansWorkspace({
  i18n,
  createLocationMap: (container) => createPlansLocationMap(L, container, { i18n }),
  evidenceFor(type, region) {
    const countryCode = typeof region?.countryCode === "string" ? region.countryCode.trim().toUpperCase() : "";
    const canLocalize = !["electricity", "other"].includes(type) && planCostState.status === "ready" &&
      planCostState.countryCode === countryCode;
    const evidence = buildPlanBenchmarkEvidence(type, {
      region,
      localCostAdjustment: canLocalize ? planCostState.adjustment : null,
    });
    return evidence ? [evidence] : [];
  },
});
function updatePlans() {
  const planReports = reports.filter((report) => regionContains(selectedRegion, report.latitude, report.longitude));
  plansWorkspace.update({ region: selectedRegion, reports: planReports, reportsReady, connectionFailed });
}
async function ensurePlanLocalCost() {
  const region = selectedRegion;
  const countryCode = typeof region?.countryCode === "string" ? region.countryCode.trim().toUpperCase() : "";
  if (!countryCode || region?.kind === "world") {
    planCostController?.abort();
    planCostController = undefined;
    planCostRevision += 1;
    planCostState = { countryCode: null, status: "unavailable", adjustment: null };
    return;
  }
  if (planCostState.countryCode === countryCode && ["loading", "ready", "unavailable"].includes(planCostState.status)) return;
  planCostController?.abort();
  const controller = new AbortController();
  planCostController = controller;
  const revision = ++planCostRevision;
  planCostState = { countryCode, status: "loading", adjustment: null };
  try {
    const result = await loadPlanLocalCostAdjustment(region, { signal: controller.signal });
    if (controller.signal.aborted || revision !== planCostRevision ||
        String(selectedRegion?.countryCode || "").toUpperCase() !== countryCode) return;
    planCostState = { countryCode, status: result.status, adjustment: result.adjustment };
    updatePlans();
  } catch (error) {
    if (error?.name !== "AbortError") {
      planCostState = { countryCode, status: "unavailable", adjustment: null };
      updatePlans();
    }
  }
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function label(value) {
  const normalized = value === "medication_access" ? "healthcare" : value;
  if (ANALYSIS_CATEGORIES.some((entry) => entry.id === normalized)) return i18n.t(`category.${normalized}`);
  if (["high", "medium", "low", "unknown"].includes(normalized)) return i18n.t(`urgency.${normalized}`);
  return String(value || i18n.t("category.other")).replaceAll("_", " ");
}
const facilityKeys = new Map(Object.entries({
  "Gas station": "gasStation", "Transit stop or shuttle hub": "transitStop", Pharmacy: "pharmacy", "Community health clinic": "healthClinic",
  "Grocery store": "grocery", "Food distribution point": "foodDistribution", "Public internet access point": "internet", "Community water station": "waterStation",
  "Transit access hub": "transitHub", "School or education center": "education", "Road access improvements": "road", "Food access center": "foodCenter",
  "Water and sanitation service point": "waterSanitation", "Emergency response station": "emergency", "Community service center": "community",
}));
function facilityLabel(value) { const key = facilityKeys.get(value); return key ? i18n.t(`facility.${key}`) : value || i18n.t("facility.community"); }
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
function fitSelectedRegion() {
  const container = map.getContainer();
  if (!container.clientWidth || !container.clientHeight) {
    pendingRegionFit = true;
    return;
  }
  pendingRegionFit = false;
  mapViewport.refresh();
  if (selectedRegion.bounds) map.fitBounds(selectedRegion.bounds, { padding: [35, 35], maxZoom: 11, animate: false });
  else map.setView([20, 0], 2, { animate: false });
}
function reportPopup(report) {
  const content = element("div", undefined, "report-popup");
  const heading = element("strong", undefined, "service-heading");
  heading.append(iconElement(report.category), element("span", label(report.category)));
  const copy = element("p", report.summary); copy.dir = "auto";
  content.append(heading, copy, element("small", `${label(report.severity)} ${i18n.t("urgency.label")} · ${report.region?.name || i18n.t("map.approximateArea")} · ${i18n.t("map.approximate")}`));
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
  $("#report-scope").textContent = `${i18n.t("explore.scope", { shown: i18n.number(selected.length), total: i18n.number(regionReports().length), region: selectedRegion.name })}${viewport.checked ? i18n.t("explore.scopeMap") : ""}.`;
  // Hidden Leaflet layers do not emit marker removal events when rebuilt.
  for (const dispose of reportPopupDisposers) dispose();
  reportPopupDisposers = [];
  reportsLayer.clearLayers();
  reportList.replaceChildren();
  if (!selected.length) reportList.append(element("p", regionReports().length ? i18n.t("explore.noMatch")
    : reportsReady ? i18n.t("explore.noRegion", { region: selectedRegion.name }) : i18n.t("explore.reportsLater"), "empty-state"));
  selected.forEach((report) => {
    const icon = L.divIcon({ className: "", html: `<span class="report-marker" style="background:${colors[report.severity] || colors.unknown}" aria-hidden="true">${serviceIconSvg(report.category)}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    const marker = L.marker([report.latitude, report.longitude], { icon, title: i18n.t("map.reportTitle", { category: label(report.category), urgency: label(report.severity) }) }).addTo(reportsLayer);
    reportPopupDisposers.push(mapPopups.register(marker, () => reportPopup(report)));
    const card = element("button", undefined, "report-card");
    card.type = "button";
    const heading = element("span", undefined, "report-card-heading");
    const title = element("strong", undefined, "service-heading");
    title.append(iconElement(report.category), element("span", label(report.category)));
    heading.append(title, element("span", label(report.severity), `urgency-tag ${report.severity}`));
    const reportCopy = element("span", report.summary || i18n.t("explore.noDescription"), "report-copy"); reportCopy.dir = "auto";
    card.append(heading, reportCopy, element("small", report.region?.name || i18n.t("explore.locating")));
    card.addEventListener("click", () => {
      map.setView([report.latitude, report.longitude], 14);
      // Map movement may rebuild markers when the viewport filter is enabled.
      mapPopups.openAt([report.latitude, report.longitude], () => reportPopup(report));
    });
    reportList.append(card);
  });
}
function refreshCategories() {
  const previous = category.value;
  const categories = [...new Set(regionReports().map((report) => report.category))].sort();
  category.replaceChildren(new Option(i18n.t("explore.allServices"), "all"), ...categories.map((name) => new Option(label(name), name)));
  category.value = categories.includes(previous) ? previous : "all";
}
function candidatePopup(candidate) {
  const content = element("div", undefined, "report-popup");
  const heading = element("strong", undefined, "service-heading");
  heading.append(iconElement(candidate.category, candidate.analysis.facilityType), element("span", facilityLabel(candidate.analysis.facilityType)));
  content.append(heading, element("p", `${i18n.t("candidate.suggested", { rank: candidate.locationRank || 1, count: candidate.locationCount || 1 })} · ${i18n.t("candidate.supporting", { count: candidate.signals.length })}`));
  content.append(element("p", i18n.t("candidate.rationale", { count: candidate.signals.length, category: label(candidate.category), region: candidate.region?.name || selectedRegion.name, service: facilityLabel(candidate.analysis.facilityType) })));
  content.append(element("small", i18n.t("candidate.caution")));
  return content;
}
function renderCandidates() {
  for (const dispose of candidatePopupDisposers) dispose();
  candidatePopupDisposers = [];
  candidatesLayer.clearLayers();
  recommendations.forEach((candidate) => {
    const rank = [1, 2, 3].includes(candidate.locationRank) ? candidate.locationRank : 1;
    const icon = L.divIcon({ className: "", html: `<span class="candidate-marker" aria-hidden="true">${serviceIconSvg(candidate.category, candidate.analysis.facilityType)}<b>${rank}</b></span>`, iconSize: [36, 36], iconAnchor: [18, 18] });
    const marker = L.marker([candidate.position.latitude, candidate.position.longitude], { icon, title: i18n.t("map.suggestedTitle", { type: facilityLabel(candidate.analysis.facilityType), rank }) }).addTo(candidatesLayer);
    candidatePopupDisposers.push(mapPopups.register(marker, () => candidatePopup(candidate)));
  });
}
function updateCandidates() {
  const scoped = regionReports();
  // An explicitly selected boundary defines the service-planning area.
  const candidates = buildRecommendations(selectedRegion.geometry ? scoped.map((report) => ({ ...report, region: selectedRegion })) : scoped);
  recommendations = candidates;
  renderCandidates();
  const candidateStatus = $("#candidate-status");
  candidateStatus.textContent = candidates.length
    ? i18n.t("candidate.count", { count: i18n.number(candidates.length) })
    : resolving && !selectedRegion.geometry ? i18n.t("candidate.finding") : i18n.t("candidate.needReports");
  if (connectionFailed) candidateStatus.textContent += i18n.t("candidate.outdated");
  updateAnalysis(); updatePlans();
}

[search, category, urgency, viewport].forEach((control) => control.addEventListener("input", renderReports));
$("#fit-reports").addEventListener("click", () => {
  viewport.checked = false;
  const selected = selectedReports();
  const points = $("#layer-reports").checked ? selected.map((report) => [report.latitude, report.longitude]) : [];
  if ($("#layer-candidates").checked) points.push(...recommendations.map((candidate) => [candidate.position.latitude, candidate.position.longitude]));
  if (points.length) map.fitBounds(points, { padding: [45, 45], maxZoom: 13 });
  else if (selectedRegion.bounds) map.fitBounds(selectedRegion.bounds, { padding: [35, 35], maxZoom: 11 });
  else map.setView([20, 0], 2);
  renderReports();
});
$("#layer-reports").addEventListener("change", (event) => {
  if (event.target.checked) { renderReports(); reportsLayer.addTo(map); }
  else reportsLayer.removeFrom(map);
});
$("#layer-candidates").addEventListener("change", (event) => {
  if (event.target.checked) { renderCandidates(); candidatesLayer.addTo(map); }
  else candidatesLayer.removeFrom(map);
});
map.on("moveend zoomend", () => { if (viewport.checked) renderReports(); });
if (["#plan", "#decisions"].includes(window.location.hash)) window.history.replaceState(null, "", "#plans");
function translatePageShell(page) {
  const skipLink = document.querySelector(".skip-link");
  const target = page === "analysis" ? "analysis" : page === "plans" ? "plans" : "map";
  skipLink.href = `#${target === "map" ? "explore" : target}-view`;
  skipLink.textContent = i18n.t(`skip.${target}`);
  document.title = i18n.t(`document.${target}Title`);
}
function showPage() {
  const hash = window.location.hash;
  const page = hash.startsWith("#analysis") ? "analysis" : hash.startsWith("#plans") ? "plans" : "map";
  const analyzing = page === "analysis", planning = page === "plans";
  translatePageShell(page);
  $("#explore-view").hidden = page !== "map";
  $("#analysis-view").hidden = !analyzing;
  $("#plans-view").hidden = !planning;
  for (const [id, active] of [["#map-tab", page === "map"], ["#analysis-tab", analyzing], ["#plans-tab", planning]]) {
    if (active) $(id).setAttribute("aria-current", "page"); else $(id).removeAttribute("aria-current");
  }
  updateAnalysis(); updatePlans();
  analysisWorkspace.setVisible(analyzing); plansWorkspace.setVisible(planning);
  if (planning) void ensurePlanLocalCost();
  if (analyzing && hash.includes("?")) {
    const parameters = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
    analysisWorkspace.focusReport(parameters.get("category"), parameters.get("report"));
  }
  if (page === "map") requestAnimationFrame(() => {
    if ($("#explore-view").hidden) return;
    if (pendingRegionFit) fitSelectedRegion();
    else mapViewport.refresh();
  });
}
window.addEventListener("hashchange", showPage);
showPage();

const regionNavigation = createRegionNavigation({
  onChange(region, { source } = {}) {
    selectedRegion = region;
    if ((source === "detected" || source === "saved") && /^[A-Z]{2}$/.test(region.countryCode || "")) i18n.applyRegion(region.countryCode);
    selectedRegionLayer.clearLayers();
    map.closePopup();
    viewport.checked = false;
    $("#current-region").textContent = region.label || region.name;
    $("#plans-current-region").textContent = region.label || region.name;
    $("#map-region-label").textContent = i18n.t("map.community", { region: region.name });
    if (region.geometry) L.geoJSON(region.geometry, { style: { color: "#005ea8", weight: 2, fillOpacity: .025 }, interactive: false }).addTo(selectedRegionLayer);
    fitSelectedRegion();
    refreshCategories();
    renderReports();
    updateCandidates();
    if (window.location.hash.startsWith("#plans")) void ensurePlanLocalCost();
    regionPicker.close(); plansRegionPicker.close();
  },
  onStatus({ state, message, key, values }) {
    regionMessage = key ? { key, values } : { message };
    const localized = key ? i18n.t(key, values) : message;
    $("#region-status").textContent = localized;
    $("#region-action-status").textContent = localized;
    $("#region-action-status").hidden = state === "ready";
  },
});
const regionPicker = createRegionPicker({ navigation: regionNavigation, i18n });
const plansRegionPicker = createRegionPicker({
  navigation: regionNavigation,
  i18n,
  rootSelector: ".plans-region-navigation",
  ids: {
    menu: "plans-region-menu",
    search: "plans-region-search",
    results: "plans-region-results",
    toggle: "plans-change-region",
    form: "plans-region-search-form",
    status: "plans-region-search-status",
  },
});
const stopLanguageSubscription = i18n.subscribe(() => {
  translateStaticInterface();
  translateMapControls();
  $("#current-region").textContent = selectedRegion.label || selectedRegion.name;
  $("#plans-current-region").textContent = selectedRegion.label || selectedRegion.name;
  $("#map-region-label").textContent = i18n.t("map.community", { region: selectedRegion.name });
  const localizedRegion = regionMessage.key ? i18n.t(regionMessage.key, regionMessage.values) : regionMessage.message;
  $("#region-status").textContent = localizedRegion; $("#region-action-status").textContent = localizedRegion;
  status.textContent = i18n.t(connectionMessage.key, connectionMessage.values);
  map.closePopup(); regionPicker.render(); plansRegionPicker.render(); refreshCategories(); renderReports(); updateCandidates(); showPage();
});
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
  reports = incoming;
  resolving = reports.length > 0;
  refreshCategories();
  renderReports();
  updateCandidates();
  liveDot.className = "live-dot connected";
  setConnectionMessage(resolving ? "connection.finding" : "connection.noReports", resolving ? { done: 0, total: reports.length } : {});
  if (!reports.length) return;
  enrichSignalsWithRegions(reports, {
    signal: regionController.signal,
    onProgress(done, total) { if (revision === regionRevision) setConnectionMessage("connection.finding", { done, total }); },
  }).then((enriched) => {
    if (revision !== regionRevision) return;
    reports = enriched;
    resolving = false;
    const missing = reports.filter((report) => !report.region).length;
    setConnectionMessage(missing ? "connection.regionsUnavailable" : "connection.live", { count: missing || reports.length });
    renderReports();
    updateCandidates();
  }).catch((error) => {
    if (revision !== regionRevision) return;
    console.error("NeedMap region lookup:", error);
    resolving = false;
    setConnectionMessage("connection.regionUnavailable");
    updateCandidates();
  });
}, (error) => {
  console.error("NeedMap report connection:", error);
  regionController?.abort();
  regionRevision += 1;
  resolving = false;
  connectionFailed = true;
  setConnectionMessage("connection.unavailable");
  liveDot.className = "live-dot error";
  updateCandidates();
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  unsubscribe(); stopLanguageSubscription(); languagePicker.destroy(); regionController?.abort(); planCostController?.abort(); regionNavigation.destroy(); regionPicker.destroy(); plansRegionPicker.destroy(); mapViewport.destroy(); analysisWorkspace.destroy(); plansWorkspace.destroy(); mapPopups.destroy(); detachMapZoom();
  window.removeEventListener("hashchange", showPage);
});

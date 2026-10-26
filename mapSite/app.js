import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { CustomProvider, initializeAppCheck } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { buildRecommendationsForRegion } from "./analysis.js";
import { loadWorldwideAnalysisRegions } from "./worldwide-analysis-regions.js";
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
import { createReportLocationPopups } from "./report-location-popups.js";
import { attachMapZoom } from "./map-zoom.js";
import { attachMapViewport, MAP_WORLD_BOUNDS, MAP_VIEWPORT_OPTIONS } from "./map-viewport.js";
import { REPORT_MARKER_Z_INDEX } from "./map-marker-layout.js";
import { createCandidateMarkerLayer } from "./candidate-marker-layer.js";
import { reviewComplaints } from "./analysis-ai.js";
import "./analysis.css";
import { createPopulationAreaMap } from "./population-area-map.js";
import "./population-details.css";
import { createI18n } from "./i18n/index.js";
import { createLanguagePicker } from "./i18n/language-picker.js";
import { createDynamicTranslator } from "./i18n/dynamic-translation.js";
import { createPlansWorkspace } from "./plans-workspace.js";
import { createPlansLocationMap } from "./plans-location-map.js";
import { buildPlanBenchmarkEvidence } from "./plans-benchmarks.js";
import { createPlanLocalCostLoader } from "./plans-local-cost.js";
import "./plans.css";
import { createLoadingBar } from "./loading-bar.js";
import { trackLeafletTileLayer } from "./leaflet-loading.js";
import { createInitialReportLoadGate, loadedReportConnectionMessage } from "./report-loading.js";

const loadingTargetSelectors = Object.freeze({
  boot: "#map",
  language: ".language-navigation",
  "dynamic-language": ".language-navigation",
  "reports-connection": "#status",
  "report-region-enrichment": "#status",
  "worldwide-analysis": "#candidate-status",
  region: "#region-status",
  "main-map-tiles": "#map",
  "analysis-evidence": "#analysis-status",
  "analysis-ai": "#analysis-ai-status",
  "analysis-population": "#analysis-population",
  "plans-local-cost": "#plans-status",
});
const loadingBar = createLoadingBar({
  initialKey: "boot",
  initialTarget: "#map",
  defaultLabel: "Loading NeedMap…",
  resolveTarget: (key) => loadingTargetSelectors[key] || "#status",
});
let i18n;
const onLoading = ({ key = "loading", label, delayMs = 0, target, appearance, source } = {}) => {
  const resolvedLabel = label || i18n?.t("common.loading") || "Loading…";
  const manualLanguageStatus = key === "language" && source === "manual"
    ? document.getElementById("language-search-status")
    : null;
  if (manualLanguageStatus) manualLanguageStatus.textContent = resolvedLabel;
  return loadingBar.start(key, resolvedLabel, {
    delayMs,
    target: target || manualLanguageStatus || loadingTargetSelectors[key],
    appearance: manualLanguageStatus ? "status" : appearance,
  });
};
i18n = createI18n({ onLoading });
await i18n.initialize();
loadingBar.setDefaultLabel(i18n.t("common.loading"));

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
    ".check-label": "explore.onlyMap", ".report-list-heading h3": "explore.communityReports", ".map-caption > span": "map.approximate",
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
const dynamicTranslator = createDynamicTranslator({ i18n, onLoading });
const languagePicker = createLanguagePicker({
  i18n,
  onBeforeSelect: (code) => dynamicTranslator.prepareForLanguage(code),
});
const prepareDynamicTranslation = () => dynamicTranslator.prepareForLanguage(i18n.code);
document.addEventListener("pointerdown", prepareDynamicTranslation, true);
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
const mainTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, noWrap: true, bounds: MAP_WORLD_BOUNDS, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
});
const stopMainTileLoading = trackLeafletTileLayer(mainTiles, { onLoading, key: "main-map-tiles", label: () => i18n.t("analysis.loadingMap"), target: map.getContainer() });
mainTiles.addTo(map);
const reportsLayer = L.layerGroup().addTo(map);
const candidatesLayer = L.layerGroup().addTo(map);
const mapPopups = createMapPopups(L, map);
let reportPopupDisposers = [];
const candidateMarkers = createCandidateMarkerLayer(L, map, {
  layer: candidatesLayer, popups: mapPopups, renderPopup: candidatePopup,
  titleFor: (candidate) => i18n.t("map.suggestedTitle", { type: facilityLabel(candidate.analysis.facilityType), rank: candidate.locationRank || 1 }),
  groupTitleFor: (count) => i18n.t("candidate.group", { count: i18n.number(count) }),
});
const selectedRegionLayer = L.layerGroup().addTo(map);
const colors = { low: "#2f8a69", medium: "#d28b27", high: "#c34e42", unknown: "#526575" };
let reports = [];
let recommendations = [];
let analysisRecommendations = [];
let analysisIncludesDemonstrations = true;
let selectedRegion = WORLD_REGION;
let pendingRegionFit = false;
let snapshotKey = "";
let regionRevision = 0;
let regionController;
let resolving = false;
let connectionFailed = false;
let reportsReady = false;
let worldwideAnalysisRegions = [];
let worldwideAnalysisState = "idle";
let connectionMessage = { key: "connection.connecting", values: {} };
let regionMessage = { key: "region.finding", values: {} };
let planCostLoader;
function setConnectionMessage(key, values = {}) { connectionMessage = { key, values }; status.textContent = i18n.t(key, values); }
setConnectionMessage("connection.connecting");
loadingBar.set("reports-connection", true, i18n.t("connection.connecting"));
const analysisWorkspace = createAnalysisWorkspace({ i18n, dynamicTranslator, firebaseApp, reviewComplaints, onLoading, onDemonstrationReportsChange(value) { analysisIncludesDemonstrations = value; updateCandidates(); }, createPopulationMap: (container, options) => createPopulationAreaMap(L, container, { ...options, i18n, onLoading }), createOverviewMap: (container) => createAnalysisOverviewMap(L, container, { reportPopup, candidatePopup, i18n, dynamicTranslator, onLoading }), createReportMap: (container, report) => createReportLocationMap(L, container, report, { onLoading, loadingLabel: () => i18n.t("analysis.loadingMap") }) });
function updateAnalysis() {
  analysisWorkspace.update({ region: selectedRegion, reports: regionReports(), recommendations: analysisRecommendations, includeDemonstrationReports: analysisIncludesDemonstrations, reportsReady, connectionFailed,
    recommendationState: selectedRegion.kind === "world" ? worldwideAnalysisState : "ready" });
}
const plansWorkspace = createPlansWorkspace({
  i18n,
  dynamicTranslator,
  // Use the same submitted-report set as Map, including legacy demo flags.
  includeDemonstrationReports: true,
  onLoading,
  createLocationMap: (container) => createPlansLocationMap(L, container, { i18n, onLoading }),
  evidenceFor(type, region) {
    const planCostState = planCostLoader?.state || { countryCode: null, status: "idle", adjustment: null };
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
planCostLoader = createPlanLocalCostLoader({
  onLoading(options) {
    const label = options?.label || i18n.t("common.loading");
    $("#plans-status").textContent = label;
    return onLoading({ ...options, label, target: $("#plans-status"), appearance: "status" });
  },
  loadingLabel: () => i18n.t("common.loading"),
  onStateChange: updatePlans,
});
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function translatedText(node, value, sourceLanguage) {
  return dynamicTranslator.bind(node, value || "", { sourceLanguage });
}
function translatedTemplate(node, template, marker, value, sourceLanguage = "en") {
  const index = template.indexOf(marker);
  if (index < 0) { node.textContent = template.replace(marker, value); return node; }
  node.replaceChildren(document.createTextNode(template.slice(0, index)), translatedText(element("span"), value, sourceLanguage), document.createTextNode(template.slice(index + marker.length)));
  return node;
}
function renderRegionMessage(target, record) {
  if (!target) return;
  if (!record?.key) {
    translatedText(target, record?.message || "", "en");
    return;
  }
  const values = { ...(record.values || {}) };
  if (typeof values.region === "string" && values.region) {
    const marker = "\u0000REGION\u0000";
    const region = values.region;
    values.region = marker;
    translatedTemplate(target, i18n.t(record.key, values), marker, region);
    return;
  }
  target.textContent = i18n.t(record.key, values);
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
  const copy = translatedText(element("p"), report.summary, report.language || report.locale);
  const meta = element("small");
  meta.append(document.createTextNode(`${label(report.severity)} ${i18n.t("urgency.label")} · `));
  meta.append(translatedText(element("span"), report.region?.name || i18n.t("map.approximateArea"), report.region ? "en" : i18n.code));
  meta.append(document.createTextNode(` · ${i18n.t("map.approximate")}`));
  content.append(heading);
  content.append(copy, meta);
  return content;
}
function selectedReports() {
  const bounds = map.getBounds();
  const translated = regionReports().map((report) => ({
    ...report,
    translatedSummary: dynamicTranslator.cached(report.summary),
    translatedRegionName: dynamicTranslator.cached(report.region?.name || ""),
  }));
  return filterReports(translated, {
    query: search.value, category: category.value, urgency: urgency.value,
    contains: viewport.checked ? (report) => bounds.contains([report.latitude, report.longitude]) : undefined,
  });
}
function renderReports() {
  const selected = selectedReports();
  const locationPopup = createReportLocationPopups(selected, reportPopup, {
    document, groupLabel: (count) => i18n.t("analysis.reportCount", { count }),
  });
  $("#report-count").textContent = selected.length;
  $("#urgent-count").textContent = selected.filter((report) => report.severity === "high").length;
  const regionMarker = "\u0000REGION\u0000";
  translatedTemplate($("#report-scope"), `${i18n.t("explore.scope", { shown: i18n.number(selected.length), total: i18n.number(regionReports().length), region: regionMarker })}${viewport.checked ? i18n.t("explore.scopeMap") : ""}.`, regionMarker, selectedRegion.name);
  // Hidden Leaflet layers do not emit marker removal events when rebuilt.
  for (const dispose of reportPopupDisposers) dispose();
  reportPopupDisposers = [];
  reportsLayer.clearLayers();
  reportList.replaceChildren();
  if (!selected.length) {
    const empty = element("p", undefined, "empty-state");
    if (regionReports().length) empty.textContent = i18n.t("explore.noMatch");
    else if (!reportsReady) empty.textContent = i18n.t("explore.reportsLater");
    else {
      const marker = "\u0000REGION\u0000";
      translatedTemplate(empty, i18n.t("explore.noRegion", { region: marker }), marker, selectedRegion.name);
    }
    reportList.append(empty);
  }
  selected.forEach((report) => {
    const icon = L.divIcon({ className: "", html: `<span class="report-marker" style="background:${colors[report.severity] || colors.unknown}" aria-hidden="true">${serviceIconSvg(report.category)}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    const marker = L.marker([report.latitude, report.longitude], { icon, zIndexOffset: REPORT_MARKER_Z_INDEX, title: i18n.t("map.reportTitle", { category: label(report.category), urgency: label(report.severity) }) }).addTo(reportsLayer);
    reportPopupDisposers.push(mapPopups.register(marker, () => locationPopup(report)));
    const card = element("button", undefined, "report-card");
    card.type = "button";
    const heading = element("span", undefined, "report-card-heading");
    const title = element("strong", undefined, "service-heading");
    title.append(iconElement(report.category), element("span", label(report.category)));
    heading.append(title, element("span", label(report.severity), `urgency-tag ${report.severity}`));
    const reportCopy = translatedText(element("span", undefined, "report-copy"), report.summary || i18n.t("explore.noDescription"), report.summary ? report.language || report.locale : i18n.code);
    const place = translatedText(element("small"), report.region?.name || i18n.t(resolving ? "explore.locating" : "map.approximateArea"), report.region ? "en" : i18n.code);
    card.append(heading, reportCopy, place);
    card.addEventListener("click", () => {
      map.setView([report.latitude, report.longitude], 14);
      // Map movement may rebuild markers when the viewport filter is enabled.
      mapPopups.openAt([report.latitude, report.longitude], () => locationPopup(report));
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
  const rationale = element("p");
  const marker = "\u0000REGION\u0000";
  translatedTemplate(rationale, i18n.t("candidate.rationale", { count: candidate.signals.length, category: label(candidate.category), region: marker, service: facilityLabel(candidate.analysis.facilityType) }), marker, candidate.region?.name || selectedRegion.name);
  content.append(rationale);
  content.append(element("small", i18n.t("candidate.caution")));
  return content;
}
function renderCandidates() {
  candidateMarkers.update(recommendations);
}
function updateCandidates() {
  // An explicitly selected boundary defines the service-planning area.
  const candidates = buildRecommendationsForRegion(reports, selectedRegion, { analysisRegions: worldwideAnalysisRegions, includeDemonstrationReports: true });
  recommendations = candidates;
  analysisRecommendations = analysisIncludesDemonstrations
    ? candidates
    : buildRecommendationsForRegion(reports, selectedRegion, { analysisRegions: worldwideAnalysisRegions });
  renderCandidates();
  const candidateStatus = $("#candidate-status");
  candidateStatus.textContent = candidates.length
    ? i18n.t("candidate.count", { count: i18n.number(candidates.length) })
    : resolving && !selectedRegion.geometry ? i18n.t("candidate.finding") : i18n.t("candidate.needReports");
  const world = selectedRegion.kind === "world";
  if (world && worldwideAnalysisState === "loading") {
    candidateStatus.textContent = `${candidates.length ? `${candidateStatus.textContent} ` : ""}${i18n.t("candidate.worldLoading")}`;
  } else if (world && worldwideAnalysisState === "partial") {
    candidateStatus.textContent += ` ${i18n.t("candidate.worldPartial")}`;
  }
  loadingBar.set("worldwide-analysis", world && worldwideAnalysisState === "loading", i18n.t("candidate.worldLoading"));
  if (connectionFailed) candidateStatus.textContent += i18n.t("candidate.outdated");
  updateAnalysis(); updatePlans();
}

async function refreshWorldwideAnalyses(enriched, revision, signal) {
  worldwideAnalysisState = "loading";
  updateCandidates();
  try {
    // Load the boundaries for all proposals shown by Map and Analysis.
    // Report metadata and the model defaults remain unchanged.
    const result = await loadWorldwideAnalysisRegions(enriched, { signal, includeDemonstrationReports: true });
    if (revision !== regionRevision || signal.aborted) return;
    worldwideAnalysisRegions = result.regions;
    worldwideAnalysisState = result.failures.length ? "partial" : "ready";
  } catch (error) {
    if (revision !== regionRevision || signal.aborted) return;
    console.error("NeedMap worldwide analyses:", error);
    worldwideAnalysisState = "partial";
  }
  updateCandidates();
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
  if (planning) void planCostLoader.ensure(selectedRegion);
  else planCostLoader.cancel();
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
    translatedText($("#current-region"), region.label || region.name, "en");
    translatedText($("#plans-current-region"), region.label || region.name, "en");
    translatedTemplate($("#map-region-label"), i18n.t("map.community", { region: "\u0000REGION\u0000" }), "\u0000REGION\u0000", region.name);
    if (region.geometry) L.geoJSON(region.geometry, { style: { color: "#005ea8", weight: 2, fillOpacity: .025 }, interactive: false }).addTo(selectedRegionLayer);
    fitSelectedRegion();
    refreshCategories();
    renderReports();
    updateCandidates();
    if (window.location.hash.startsWith("#plans")) void planCostLoader.ensure(selectedRegion);
    regionPicker.close(); plansRegionPicker.close();
  },
  onStatus({ state, message, key, values }) {
    regionMessage = key ? { key, values } : { message };
    const localized = key ? i18n.t(key, values) : message;
    renderRegionMessage($("#region-status"), regionMessage);
    renderRegionMessage($("#region-action-status"), regionMessage);
    $("#region-action-status").hidden = state === "ready";
    loadingBar.set("region", state === "loading" || state === "locating", localized);
  },
});
const regionPicker = createRegionPicker({ navigation: regionNavigation, i18n, dynamicTranslator });
const plansRegionPicker = createRegionPicker({
  navigation: regionNavigation,
  i18n,
  dynamicTranslator,
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
  loadingBar.setDefaultLabel(i18n.t("common.loading"));
  translateStaticInterface();
  translateMapControls();
  translatedText($("#current-region"), selectedRegion.label || selectedRegion.name, "en");
  translatedText($("#plans-current-region"), selectedRegion.label || selectedRegion.name, "en");
  translatedTemplate($("#map-region-label"), i18n.t("map.community", { region: "\u0000REGION\u0000" }), "\u0000REGION\u0000", selectedRegion.name);
  renderRegionMessage($("#region-status"), regionMessage); renderRegionMessage($("#region-action-status"), regionMessage);
  status.textContent = i18n.t(connectionMessage.key, connectionMessage.values);
  loadingBar.refresh();
  map.closePopup(); regionPicker.render(); plansRegionPicker.render(); refreshCategories(); renderReports(); updateCandidates(); showPage();
});
let dynamicTranslationFrame;
const stopDynamicTranslation = dynamicTranslator.subscribe(() => {
  if (dynamicTranslationFrame) return;
  dynamicTranslationFrame = requestAnimationFrame(() => {
    dynamicTranslationFrame = undefined;
    translateStaticInterface();
    renderRegionMessage($("#region-status"), regionMessage); renderRegionMessage($("#region-action-status"), regionMessage);
    regionPicker.render(); plansRegionPicker.render(); renderReports(); updateAnalysis(); updatePlans();
  });
});
void regionNavigation.initialize();

const reportLoadGate = createInitialReportLoadGate({
  onFinish({ reason, hasSnapshot }) {
    loadingBar.finish("reports-connection");
    if (reason === "server") {
      reportsReady = true;
      connectionFailed = false;
      return;
    }
    reportsReady = hasSnapshot;
    connectionFailed = true;
    setConnectionMessage("connection.unavailable");
    liveDot.className = "live-dot error";
    updateCandidates();
  },
});
const unsubscribe = onSnapshot(collection(db, "incomingSignals"), { includeMetadataChanges: true }, (snapshot) => {
  const { fromCache } = reportLoadGate.observe(snapshot);
  if (!fromCache) { reportsReady = true; connectionFailed = false; }
  const incoming = [];
  snapshot.forEach((document) => { const report = normalizeReport(document.id, document.data()); if (report) incoming.push(report); });
  const nextKey = reportSnapshotKey(incoming);
  if (nextKey === snapshotKey) {
    if (!fromCache) {
      liveDot.className = "live-dot connected";
      if (!resolving) {
        const message = loadedReportConnectionMessage(reports);
        setConnectionMessage(message.key, message.values);
      }
    } else if (connectionFailed) {
      liveDot.className = "live-dot error";
      setConnectionMessage("connection.unavailable");
    }
    updateCandidates();
    return;
  }
  snapshotKey = nextKey;
  regionController?.abort();
  regionController = new AbortController();
  const revision = ++regionRevision;
  reports = incoming;
  worldwideAnalysisRegions = [];
  worldwideAnalysisState = "idle";
  resolving = reports.length > 0;
  refreshCategories();
  renderReports();
  updateCandidates();
  liveDot.className = connectionFailed ? "live-dot error" : reportsReady ? "live-dot connected" : "live-dot";
  if (connectionFailed) setConnectionMessage("connection.unavailable");
  else if (!reportsReady) setConnectionMessage("connection.connecting");
  else setConnectionMessage(resolving ? "connection.finding" : "connection.noReports", resolving ? { done: 0, total: reports.length } : {});
  if (!reports.length) return;
  const stopEnrichmentLoading = onLoading({ key: "report-region-enrichment", label: () => status.textContent });
  enrichSignalsWithRegions(reports, {
    signal: regionController.signal,
    onProgress(done, total) {
      if (revision === regionRevision && reportsReady && !connectionFailed) {
        setConnectionMessage("connection.finding", { done, total });
        loadingBar.refresh();
      }
    },
  }).then((enriched) => {
    if (revision !== regionRevision) return;
    reports = enriched;
    resolving = false;
    const message = loadedReportConnectionMessage(reports);
    if (!reportsReady) setConnectionMessage("connection.connecting");
    else if (connectionFailed) setConnectionMessage("connection.unavailable");
    else setConnectionMessage(message.key, message.values);
    renderReports();
    updateCandidates();
    void refreshWorldwideAnalyses(enriched, revision, regionController.signal);
  }).catch((error) => {
    if (revision !== regionRevision) return;
    console.error("NeedMap region lookup:", error);
    resolving = false;
    setConnectionMessage(connectionFailed ? "connection.unavailable" : !reportsReady ? "connection.connecting" : "connection.regionUnavailable");
    renderReports();
    updateCandidates();
  }).finally(stopEnrichmentLoading);
}, (error) => {
  reportLoadGate.fail();
  console.error("NeedMap report connection:", error);
  regionController?.abort();
  regionRevision += 1;
  resolving = false;
  if (worldwideAnalysisState === "loading") worldwideAnalysisState = "partial";
  connectionFailed = true;
  setConnectionMessage("connection.unavailable");
  liveDot.className = "live-dot error";
  updateCandidates();
});
loadingBar.finish("boot");
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  unsubscribe(); reportLoadGate.destroy(); stopLanguageSubscription(); stopDynamicTranslation(); if (dynamicTranslationFrame) cancelAnimationFrame(dynamicTranslationFrame); document.removeEventListener("pointerdown", prepareDynamicTranslation, true); languagePicker.destroy(); dynamicTranslator.destroy(); regionController?.abort(); planCostLoader.destroy(); stopMainTileLoading(); regionNavigation.destroy(); regionPicker.destroy(); plansRegionPicker.destroy(); mapViewport.destroy(); analysisWorkspace.destroy(); plansWorkspace.destroy(); candidateMarkers.destroy(); mapPopups.destroy(); detachMapZoom(); loadingBar.destroy();
  window.removeEventListener("hashchange", showPage);
});

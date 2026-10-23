import L from "leaflet";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  DEFAULT_TRAVEL_PROFILES,
  aggregateTimeTrends,
  calculateCoverageMetrics,
  compareScenarios,
  evaluateNeedAlerts,
  findPotentialDuplicates,
  scoreExistingServiceGap,
  scoreReportQuality,
  serializeCsv,
} from "./decision-tools.js";
import { loadNearbyServices, serviceInventorySource } from "./existing-services.js";

const STORAGE_KEY = "needmap.decision-workspace.v2";
const STAFF_ROLES = new Set(["viewer", "analyst", "moderator", "admin"]);
const WRITE_ROLES = new Set(["analyst", "moderator", "admin"]);
const WORKFLOW_STATUSES = ["new", "reviewing", "approved", "rejected", "pilot", "built"];
const MAX_DUPLICATE_SCAN_REPORTS = 400;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = typeof value === "number" || (typeof value === "string" && value.trim())
    ? Number(value)
    : NaN;
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function validPosition(value) {
  if (!isRecord(value)) return null;
  const latitude = boundedNumber(value.latitude, -Infinity, Infinity, NaN);
  const longitude = boundedNumber(value.longitude, -Infinity, Infinity, NaN);
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

function normalizeWorkflows(records) {
  return Object.fromEntries(Object.entries(isRecord(records) ? records : {}).flatMap(([id, record]) => {
    if (!isRecord(record)) return [];
    return [[id, {
      ...record,
      status: WORKFLOW_STATUSES.includes(record.status) ? record.status : "new",
      owner: safeText(record.owner).slice(0, 80),
      note: safeText(record.note).slice(0, 600),
    }]];
  }));
}

function normalizeModeration(records) {
  return Object.fromEntries(Object.entries(isRecord(records) ? records : {}).filter(([, record]) =>
    isRecord(record) && ["approved", "duplicate", "hidden"].includes(record.status)));
}

function normalizeOutcomes(records) {
  return (Array.isArray(records) ? records : []).filter((record) => isRecord(record) &&
    typeof record.recommendationId === "string" &&
    ["better", "same", "worse"].includes(record.accessChange) &&
    Number.isInteger(record.rating) && record.rating >= 1 && record.rating <= 5 &&
    typeof record.note === "string");
}

function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function categoryLabel(category) {
  return safeText(category, "other").replaceAll("_", " ");
}

function safeDocumentId(value) {
  const source = String(value ?? "").trim() || "untitled";
  try {
    return encodeURIComponent(source).slice(0, 900);
  } catch {
    const codePoints = Array.from(source, (character) =>
      character.codePointAt(0).toString(16)).join("-");
    return `candidate-${codePoints}`.slice(0, 900);
  }
}

function timestampMilliseconds(value) {
  try {
    if (typeof value?.toDate === "function") return timestampMilliseconds(value.toDate());
    if (value && typeof value === "object" && Number.isFinite(value.seconds)) {
      return value.seconds * 1000;
    }
    if (value === null || value === undefined || value === "") return 0;
    const date = value instanceof Date ? value : new Date(
      typeof value === "number" && Math.abs(value) < 1e11 ? value * 1000 : value,
    );
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  } catch {
    return 0;
  }
}

function formatDateTime(value) {
  const milliseconds = timestampMilliseconds(value);
  return milliseconds ? new Date(milliseconds).toLocaleString() : "Not recorded";
}

function defaultLocalState() {
  return {
    mode: "readonly",
    workflows: {},
    moderation: {},
    outcomes: [],
    acknowledgedAlerts: [],
    settings: {
      highUrgencyThreshold: 3,
      trendRatio: 1.5,
    },
  };
}

function loadLocalState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!isRecord(parsed)) return defaultLocalState();
    const defaults = defaultLocalState();
    return {
      ...defaults,
      mode: parsed.mode === "local" ? "local" : "readonly",
      workflows: normalizeWorkflows(parsed.workflows),
      moderation: normalizeModeration(parsed.moderation),
      outcomes: normalizeOutcomes(parsed.outcomes),
      acknowledgedAlerts: Array.isArray(parsed.acknowledgedAlerts)
        ? parsed.acknowledgedAlerts.filter((id) => typeof id === "string").slice(-500)
        : [],
      settings: {
        highUrgencyThreshold: Math.round(boundedNumber(parsed.settings?.highUrgencyThreshold, 1, 100, defaults.settings.highUrgencyThreshold)),
        trendRatio: boundedNumber(parsed.settings?.trendRatio, 1, 10, defaults.settings.trendRatio),
      },
    };
  } catch {
    return defaultLocalState();
  }
}

function saveLocalState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The dashboard remains usable in-memory when storage is unavailable.
  }
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createMetric(label, value) {
  const card = createElement("article", "decision-metric");
  card.append(createElement("strong", "", String(value)), createElement("span", "", label));
  return card;
}

function workflowFor(state, recommendationId) {
  return (Object.hasOwn(state.workflows, recommendationId) ? state.workflows[recommendationId] : null) || {
    status: "new",
    owner: "",
    note: "",
    updatedAt: null,
  };
}

function analysisPriority(recommendation) {
  return safeText(recommendation?.analysis?.priority, "medium").toLowerCase();
}

function priorityRank(priority) {
  return { critical: 4, high: 3, medium: 2, emerging: 1 }[priority] || 0;
}

function recommendationSignals(recommendation) {
  return Array.isArray(recommendation?.signals) ? recommendation.signals.filter(isRecord) : [];
}

function uniqueRecommendationReports(recommendations) {
  const reports = new Map();
  recommendations.forEach((recommendation) => {
    const signals = recommendationSignals(recommendation);
    signals.forEach((signal, index) => {
      const id = signal?.id ?? `${recommendation?.id || "recommendation"}:${index}`;
      reports.set(String(id), signal);
    });
  });
  return [...reports.values()];
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Allow the browser to start the download before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function coverageRadiusMeters(mode, minutes) {
  const profile = DEFAULT_TRAVEL_PROFILES[mode] || DEFAULT_TRAVEL_PROFILES.transit;
  const movingMinutes = Math.max(0, minutes - profile.fixedMinutes);
  return movingMinutes / 60 * profile.speedKmh / profile.routeFactor * 1000;
}

function serviceSearchRadiusMeters(recommendation) {
  const region = recommendation?.region || {};
  const density = Number(region.densityPerKm2);
  const area = Number(region.areaKm2);
  const rurality = safeText(region.rurality).toLowerCase();
  if (/remote|rural/.test(rurality) || (Number.isFinite(density) && density < 250)) {
    return 20000;
  }
  if (/suburban|peri-urban/.test(rurality) ||
      (Number.isFinite(density) && density < 1500) ||
      (Number.isFinite(area) && area > 750)) {
    return 10000;
  }
  return 5000;
}

function serviceLookupKey(recommendation) {
  return JSON.stringify([
    recommendation?.position?.latitude, recommendation?.position?.longitude,
    recommendation?.category, recommendation?.analysis?.facilityType,
    serviceSearchRadiusMeters(recommendation),
  ]);
}

export function createDecisionWorkspace({
  firebaseApp,
  db,
  map,
  onShowRecommendation,
  onModerationChanged,
} = {}) {
  const elements = {
    view: document.querySelector("#decisions-view"),
    updatedAt: document.querySelector("#decision-updated-at"),
    metrics: document.querySelector("#decision-metrics"),
    accessBanner: document.querySelector("#decision-access-banner"),
    alertStrip: document.querySelector("#decision-alert-strip"),
    trendRange: document.querySelector("#trend-range"),
    trendChart: document.querySelector("#trend-chart"),
    trendSummary: document.querySelector("#trend-summary"),
    scenarioA: document.querySelector("#scenario-a"),
    scenarioB: document.querySelector("#scenario-b"),
    scenarioMode: document.querySelector("#scenario-mode"),
    scenarioComparison: document.querySelector("#scenario-comparison"),
    decisionSearch: document.querySelector("#decision-search"),
    filterSummary: document.querySelector("#decision-filter-summary"),
    decisionList: document.querySelector("#decision-list"),
    decisionDetail: document.querySelector("#decision-detail"),
    qualityFilter: document.querySelector("#quality-filter"),
    qualityQueue: document.querySelector("#quality-queue"),
    exportCsv: document.querySelector("#export-csv-button"),
    exportBrief: document.querySelector("#export-brief-button"),
    staffButton: document.querySelector("#staff-button"),
    staffRole: document.querySelector("#staff-role"),
    staffDialog: document.querySelector("#staff-dialog"),
    staffForm: document.querySelector("#staff-login-form"),
    staffStatus: document.querySelector("#staff-dialog-status"),
    staffFields: document.querySelector("#staff-login-fields"),
    staffEmail: document.querySelector("#staff-email"),
    staffPassword: document.querySelector("#staff-password"),
    staffSignOut: document.querySelector("#staff-sign-out"),
    localDemoButton: document.querySelector("#local-demo-button"),
    alertsButton: document.querySelector("#alerts-button"),
    alertsCount: document.querySelector("#alerts-count"),
    alertsDialog: document.querySelector("#alerts-dialog"),
    alertsList: document.querySelector("#alerts-list"),
    alertHighThreshold: document.querySelector("#alert-high-threshold"),
    alertTrendThreshold: document.querySelector("#alert-trend-threshold"),
    notificationButton: document.querySelector("#notification-button"),
    layerServices: document.querySelector("#layer-services"),
    layerCoverage: document.querySelector("#layer-coverage"),
  };

  const missingElements = Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([name]) => name);
  if (missingElements.length) {
    throw new Error(`Decision workspace is missing required UI elements: ${missingElements.join(", ")}`);
  }
  if (!firebaseApp || !db || !map) {
    throw new TypeError("Decision workspace requires Firebase, Firestore, and a Leaflet map.");
  }

  const auth = getAuth(firebaseApp);
  const localState = loadLocalState();
  const localWorkspace = {
    workflows: { ...localState.workflows },
    moderation: { ...localState.moderation },
    outcomes: [...localState.outcomes],
  };
  const startsInLocalMode = localState.mode === "local";
  const state = {
    visible: false,
    signals: [],
    recommendations: [],
    selectedRecommendationId: "",
    search: "",
    mode: startsInLocalMode ? "local" : "readonly",
    role: startsInLocalMode ? "local planner" : "viewer",
    user: null,
    workflows: startsInLocalMode ? { ...localWorkspace.workflows } : {},
    moderation: startsInLocalMode ? { ...localWorkspace.moderation } : {},
    outcomes: startsInLocalMode ? [...localWorkspace.outcomes] : [],
    acknowledgedAlerts: new Set(localState.acknowledgedAlerts),
    settings: { ...localState.settings },
    alerts: [],
    duplicatePairs: [],
    qualityRecords: [],
    servicesByRecommendation: new Map(),
    coverageMode: "transit",
    unsubscribers: [],
    detailMap: null,
    initializedDetailRecommendationId: "",
    accessVersion: 0,
    subscriptionVersion: 0,
    accessMessage: "",
    destroyed: false,
    workflowDrafts: new Map(),
    outcomeDrafts: new Map(),
    pendingWrites: new Set(),
    writeErrors: new Map(),
    signingIn: false,
  };

  const removeEventListeners = [];
  function listen(target, eventName, handler) {
    target.addEventListener(eventName, handler);
    removeEventListeners.push(() => target.removeEventListener(eventName, handler));
  }

  function writeKey(kind, id) {
    return JSON.stringify([state.mode, state.user?.uid, kind, id]);
  }

  const serviceLayer = L.layerGroup();
  const coverageLayer = L.layerGroup();
  if (elements.layerServices?.checked) serviceLayer.addTo(map);
  if (elements.layerCoverage?.checked) coverageLayer.addTo(map);

  function canWrite(kind = "workflow") {
    if (state.destroyed) return false;
    if (state.mode === "local") return true;
    if (state.mode !== "staff") return false;
    if (kind === "moderation") return ["moderator", "admin"].includes(state.role);
    return WRITE_ROLES.has(state.role);
  }

  function persistLocalState() {
    saveLocalState({
      mode: state.mode === "local" ? "local" : "readonly",
      workflows: localWorkspace.workflows,
      moderation: localWorkspace.moderation,
      outcomes: localWorkspace.outcomes,
      acknowledgedAlerts: [...state.acknowledgedAlerts].slice(-500),
      settings: state.settings,
    });
  }

  function clearSharedWorkspace() {
    state.workflows = {};
    state.moderation = {};
    state.outcomes = [];
    state.workflowDrafts.clear();
    state.outcomeDrafts.clear();
    state.writeErrors.clear();
    onModerationChanged?.({});
  }

  function activateLocalWorkspace() {
    state.workflowDrafts.clear();
    state.outcomeDrafts.clear();
    state.writeErrors.clear();
    state.workflows = { ...localWorkspace.workflows };
    state.moderation = { ...localWorkspace.moderation };
    state.outcomes = [...localWorkspace.outcomes];
    onModerationChanged?.(state.moderation);
  }

  function closeRealtimeSubscriptions() {
    state.subscriptionVersion += 1;
    state.unsubscribers.forEach((unsubscribe) => unsubscribe());
    state.unsubscribers = [];
  }

  function updateAccessUi(message = state.accessMessage) {
    elements.accessBanner.className = "decision-access-banner";
    if (state.mode === "staff") {
      elements.accessBanner.classList.add("staff");
      const accessDescription = canWrite("workflow")
        ? "Authorized changes are shared with your team."
        : "This staff role has shared read-only access.";
      elements.accessBanner.textContent = message ||
        `Shared staff workspace enabled · ${state.role}. ${accessDescription}`;
      elements.staffRole.textContent = state.role;
      elements.staffStatus.textContent = `${state.user?.email || "Staff user"} is signed in with the ${state.role} role.`;
      elements.staffFields.hidden = true;
      elements.staffSignOut.hidden = false;
      elements.localDemoButton.textContent = "Use device-local planner instead";
    } else if (state.mode === "local") {
      elements.accessBanner.classList.add("local");
      elements.accessBanner.textContent = message ||
        "Device-local planner mode · saved only in this browser, not shared or secure.";
      elements.staffRole.textContent = "Local planner";
      elements.staffStatus.textContent = "Local planning is active. Decisions are saved only in this browser.";
      elements.staffFields.hidden = Boolean(state.user);
      elements.staffSignOut.hidden = !state.user;
      elements.localDemoButton.textContent = state.user
        ? "Return to shared staff workspace"
        : "Return to read-only mode";
    } else {
      elements.accessBanner.textContent = message ||
        "Planning controls are read only. Sign in as staff or enable local planning to save decisions.";
      elements.staffRole.textContent = "Read only";
      elements.staffStatus.textContent = state.user
        ? "This account does not have an active NeedMap staff role."
        : "Sign in with your staff account. Your assigned role determines which changes you can make.";
      elements.staffFields.hidden = false;
      elements.staffSignOut.hidden = !state.user;
      elements.localDemoButton.textContent = "Enable device-local planner";
    }
  }

  function friendlyAuthError(error) {
    const code = String(error?.code || "");
    if (code.includes("invalid-credential") || code.includes("wrong-password") ||
        code.includes("user-not-found")) return "Email or password was not accepted.";
    if (code.includes("operation-not-allowed")) {
      return "Staff sign-in is not available. Contact your administrator.";
    }
    if (code.includes("too-many-requests")) return "Too many attempts. Wait a moment and try again.";
    return safeText(error?.message, "Staff sign-in failed.");
  }

  function subscribeStaffCollections() {
    closeRealtimeSubscriptions();
    const version = state.subscriptionVersion;
    const userId = state.user?.uid;
    const isCurrent = () => !state.destroyed && state.mode === "staff" &&
      state.subscriptionVersion === version && state.user?.uid === userId;
    const subscribe = (name, onData) => {
      const unsubscribe = onSnapshot(collection(db, name), (snapshot) => {
        if (!isCurrent()) return;
        onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      }, (error) => {
        if (!isCurrent()) return;
        console.error(`NeedMap ${name} listener error:`, error);
        state.accessMessage = "Shared planning data could not be loaded. Check your connection or contact your administrator.";
        if (String(error?.code).includes("permission-denied")) {
          closeRealtimeSubscriptions();
          state.mode = "readonly";
          state.role = "viewer";
          state.accessMessage = "Shared planning access is no longer available. Contact your administrator to verify your staff role.";
          clearSharedWorkspace();
          render();
        } else {
          updateAccessUi();
        }
      });
      state.unsubscribers.push(unsubscribe);
    };
    subscribe("recommendationReviews", (records) => {
      state.workflows = normalizeWorkflows(Object.fromEntries(records
        .filter((record) => typeof record.candidateId === "string")
        .map((record) => [record.candidateId, record])));
      render();
    });
    subscribe("reportModeration", (records) => {
      state.moderation = normalizeModeration(Object.fromEntries(records
        .filter((record) => typeof record.reportId === "string")
        .map((record) => [record.reportId, record])));
      onModerationChanged?.(state.moderation);
      renderQualityQueue();
      renderTrend();
      recalculateAlerts();
    });
    subscribe("outcomeFeedback", (records) => {
      state.outcomes = normalizeOutcomes(records);
      renderDetail();
    });
  }

  async function resolveStaffAccess(user) {
    if (state.destroyed) return;
    const version = ++state.accessVersion;
    closeRealtimeSubscriptions();
    state.user = user;
    state.accessMessage = "";
    // Local planning is an explicit preference, including across a page reload.
    // Auth callbacks must not silently replace local drafts with shared records.
    if (state.mode === "local") {
      updateAccessUi();
      render();
      return;
    }
    state.mode = "readonly";
    state.role = "viewer";
    clearSharedWorkspace();
    updateAccessUi();
    render();
    if (!user) return;
    const isCurrent = () => !state.destroyed && version === state.accessVersion &&
      auth.currentUser?.uid === user.uid && state.mode !== "local";
    try {
      const profileSnapshot = await getDoc(doc(db, "staffProfiles", user.uid));
      if (!isCurrent()) return;
      const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;
      const role = safeText(profile?.role).toLowerCase();
      if (profile?.active === true && STAFF_ROLES.has(role)) {
        state.mode = "staff";
        state.role = role;
        clearSharedWorkspace();
        subscribeStaffCollections();
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error("NeedMap staff profile error:", error);
      state.accessMessage = "Your staff access could not be verified. Check your connection or contact your administrator.";
      render();
      return;
    }
    persistLocalState();
    updateAccessUi();
    render();
  }

  const unsubscribeAuth = onAuthStateChanged(auth, resolveStaffAccess);

  function renderMetrics() {
    const reports = uniqueRecommendationReports(state.recommendations);
    const regions = new Set(state.recommendations.map((item) => item.region?.id).filter(Boolean));
    const highPriority = state.recommendations.filter((item) =>
      priorityRank(analysisPriority(item)) >= priorityRank("high")).length;
    elements.metrics.replaceChildren(
      createMetric("open recommendations", state.recommendations.filter((item) =>
        !["rejected", "built"].includes(workflowFor(state, item.id).status)).length),
      createMetric("critical or high", highPriority),
      createMetric("reports represented", reports.length),
      createMetric("regions", regions.size),
    );
  }

  function renderTrend() {
    const periods = Number(elements.trendRange.value) || 12;
    const trend = aggregateTimeTrends(planningSignals(), {
      bucket: "month",
      lookbackPeriods: periods,
      comparisonPeriods: Math.min(3, Math.floor(periods / 2)),
      endDate: new Date(),
    });
    elements.trendChart.replaceChildren();
    const maximum = Math.max(1, ...trend.series.map((entry) => entry.urgencyScore));
    trend.series.forEach((entry) => {
      const wrapper = createElement("div", "trend-bar-wrap");
      const count = createElement("strong", "", String(entry.reportCount));
      const bar = createElement("div", "trend-bar");
      bar.style.height = `${Math.max(3, entry.urgencyScore / maximum * 100)}%`;
      bar.title = `${entry.label}: ${entry.reportCount} reports, urgency score ${entry.urgencyScore}`;
      const label = createElement("span", "", new Date(entry.start).toLocaleDateString(undefined, {
        month: "short",
        timeZone: "UTC",
      }));
      label.title = entry.label;
      wrapper.append(count, bar, label);
      elements.trendChart.append(wrapper);
    });
    const comparison = trend.comparison;
    const change = comparison.reportChangePercent;
    const changeText = change === null
      ? "New recent activity after a period with no reports"
      : `${Math.abs(change).toFixed(0)}% ${change >= 0 ? "increase" : "decrease"} versus the previous window`;
    elements.trendSummary.textContent = trend.validDatedReports
      ? `${comparison.direction[0].toUpperCase()}${comparison.direction.slice(1)} demand · ${changeText}. ${trend.excludedUndatedReports} undated report${trend.excludedUndatedReports === 1 ? " was" : "s were"} excluded.`
      : "No reports with usable timestamps are available for trend analysis.";
  }

  function alertAcknowledgementKey(alert) {
    return `${alert.id}:${alert.revision}`;
  }

  function planningSignals() {
    return state.signals.filter((report) => !["hidden", "duplicate"].includes(
      state.moderation[report.id]?.status ?? report.moderationStatus,
    ));
  }

  function activeAlerts() {
    return state.alerts.filter((alert) => !state.acknowledgedAlerts.has(alertAcknowledgementKey(alert)));
  }

  function renderAlerts() {
    const alerts = activeAlerts();
    elements.alertsCount.hidden = !alerts.length;
    elements.alertsCount.textContent = String(alerts.length);
    elements.alertStrip.hidden = !alerts.length;
    if (alerts.length) {
      const first = alerts[0];
      elements.alertStrip.textContent = `${alerts.length} active signal alert${alerts.length === 1 ? "" : "s"}. ${first.regionName}: ${categoryLabel(first.category)} has ${first.reportCount} reports and urgency score ${first.urgencyScore}.`;
    }
    elements.alertsList.replaceChildren();
    if (!alerts.length) {
      elements.alertsList.append(createElement("div", "alerts-empty", "No active alerts at the current thresholds."));
      return;
    }
    alerts.forEach((alert) => {
      const card = createElement("article", "alert-card");
      const title = createElement("strong", "", `${alert.regionName} · ${categoryLabel(alert.category)}`);
      const messages = alert.alerts.map((item) => item.message).join(" ");
      const copy = createElement("span", "", messages);
      const acknowledge = createElement("button", "compact-button", "Acknowledge");
      acknowledge.type = "button";
      acknowledge.addEventListener("click", () => {
        state.acknowledgedAlerts.add(alertAcknowledgementKey(alert));
        persistLocalState();
        renderAlerts();
      });
      card.append(title, copy, acknowledge);
      elements.alertsList.append(card);
    });
  }

  function recalculateAlerts() {
    state.alerts = evaluateNeedAlerts(planningSignals(), {
      minimumHighUrgencyReports: Number(state.settings.highUrgencyThreshold) || 3,
      spikePercent: Math.max(0, ((Number(state.settings.trendRatio) || 1.5) - 1) * 100),
      trendOptions: { bucket: "week", lookbackPeriods: 8, comparisonPeriods: 2, endDate: new Date() },
    });
    renderAlerts();
  }

  function optionLabel(recommendation) {
    return `${safeText(recommendation.analysis?.facilityType, "Service")} · ${safeText(recommendation.region?.name, "Region")}`;
  }

  function syncScenarioOptions() {
    const previousA = elements.scenarioA.value;
    const previousB = elements.scenarioB.value;
    [elements.scenarioA, elements.scenarioB].forEach((select) => {
      select.replaceChildren();
      state.recommendations.forEach((recommendation) => {
        const option = document.createElement("option");
        option.value = recommendation.id;
        option.textContent = optionLabel(recommendation);
        select.append(option);
      });
    });
    elements.scenarioA.value = state.recommendations.some((item) => item.id === previousA)
      ? previousA
      : state.recommendations[0]?.id || "";
    elements.scenarioB.value = state.recommendations.some((item) => item.id === previousB)
      ? previousB
      : state.recommendations[1]?.id || state.recommendations[0]?.id || "";
  }

  function renderScenarioComparison() {
    elements.scenarioComparison.replaceChildren();
    const first = state.recommendations.find((item) => item.id === elements.scenarioA.value);
    const second = state.recommendations.find((item) => item.id === elements.scenarioB.value);
    const selected = [...new Map([first, second].filter(Boolean).map((item) => [item.id, item])).values()];
    if (!selected.length) {
      elements.scenarioComparison.append(createElement("div", "alerts-empty", "Add at least one recommendation to compare scenarios."));
      return;
    }
    if (selected.length > 1 && selected.some((item) =>
      item.category !== selected[0].category || item.region?.id !== selected[0].region?.id)) {
      elements.scenarioComparison.append(createElement(
        "div", "alerts-empty",
        "These recommendations serve different regions or service needs. Select options in the same region and service category to compare coverage. Review each recommendation's evidence before allocating resources.",
      ));
      return;
    }
    const reports = uniqueRecommendationReports(selected);
    const hasComparableServiceInventory = selected.every((item) =>
      Array.isArray(state.servicesByRecommendation.get(item.id)?.services));
    const result = compareScenarios(selected.map((recommendation) => ({
      id: recommendation.id,
      name: optionLabel(recommendation),
      candidate: recommendation.position,
      serviceType: recommendation.analysis?.facilityType,
      existingServices: state.servicesByRecommendation.get(recommendation.id)?.services || [],
      feasibilityScore: boundedNumber(recommendation.analysis?.confidence, 0, 1, 0.5) * 100,
    })), reports, {
      coverageMode: elements.scenarioMode.value,
      coverageThresholdMinutes: 15,
      weights: hasComparableServiceInventory
        ? { coverage: 0.5, serviceGap: 0.25, feasibility: 0.25, cost: 0 }
        : { coverage: 0.65, serviceGap: 0, feasibility: 0.35, cost: 0 },
    });
    const table = createElement("table", "scenario-table");
    const head = document.createElement("thead");
    const headingRow = document.createElement("tr");
    ["Option", "Score", "15 min coverage", "Avg. time", "Service gap"].forEach((label) => {
      headingRow.append(createElement("th", "", label));
    });
    head.append(headingRow);
    const body = document.createElement("tbody");
    result.ranked.forEach((scenario) => {
      const row = document.createElement("tr");
      [
        scenario.name,
        `${scenario.score}/100`,
        `${scenario.coveredReportPercent}%`,
        `${scenario.averageTravelMinutes} min`,
        hasComparableServiceInventory ? scenario.serviceGap.rating : "Load for both",
      ].forEach((value) => row.append(createElement("td", "", value)));
      body.append(row);
    });
    table.append(head, body);
    elements.scenarioComparison.append(table);
    if (result.ranked[0]) {
      elements.scenarioComparison.append(createElement(
        "span",
        "scenario-winner",
        `${reports.length ? "Highest model score" : "Preliminary score; no report coverage evidence"}: ${result.ranked[0].name}`,
      ));
    }
  }

  function filteredRecommendations() {
    const query = state.search.trim().toLowerCase();
    if (!query) return state.recommendations;
    return state.recommendations.filter((recommendation) => [
      recommendation.analysis?.facilityType,
      recommendation.region?.name,
      recommendation.region?.hierarchy,
      recommendation.category,
      workflowFor(state, recommendation.id).status,
      workflowFor(state, recommendation.id).owner,
    ].filter(Boolean).join(" ").toLowerCase().includes(query));
  }

  function renderDecisionList() {
    const recommendations = filteredRecommendations();
    elements.filterSummary.textContent = `${recommendations.length} item${recommendations.length === 1 ? "" : "s"}`;
    elements.decisionList.replaceChildren();
    if (!recommendations.length) {
      elements.decisionList.append(createElement("div", "alerts-empty", "No recommendations match this search."));
      return;
    }
    recommendations.forEach((recommendation) => {
      const workflow = workflowFor(state, recommendation.id);
      const button = createElement("button", "decision-list-card");
      button.type = "button";
      button.classList.toggle("active", recommendation.id === state.selectedRecommendationId);
      button.setAttribute("aria-pressed", String(recommendation.id === state.selectedRecommendationId));
      button.append(
        createElement("strong", "", safeText(recommendation.analysis?.facilityType, "Community service")),
        createElement("span", "", `${recommendation.region?.name || "Unknown region"} · ${categoryLabel(recommendation.category)}`),
        createElement("span", "", `${analysisPriority(recommendation)} priority · ${workflow.status}`),
      );
      button.addEventListener("click", () => {
        state.selectedRecommendationId = recommendation.id;
        renderDecisionList();
        renderDetail();
      });
      elements.decisionList.append(button);
    });
  }

  function calculateQualityRecords() {
    const reports = state.signals
      .slice()
      .sort((first, second) => timestampMilliseconds(second.submittedAt) -
        timestampMilliseconds(first.submittedAt))
      .slice(0, MAX_DUPLICATE_SCAN_REPORTS);
    state.duplicatePairs = findPotentialDuplicates(reports, {
      threshold: 0.68,
      maximumPairs: 100,
    });
    const duplicateByReport = new Map();
    state.duplicatePairs.forEach((pair) => {
      [pair.firstReportId, pair.secondReportId].forEach((reportId) => {
        if (!duplicateByReport.has(reportId) ||
            duplicateByReport.get(reportId).score < pair.score) {
          duplicateByReport.set(reportId, pair);
        }
      });
    });
    state.qualityRecords = reports.map((report) => ({
      report,
      duplicate: duplicateByReport.get(String(report.id)) || null,
      quality: scoreReportQuality(report, {
        duplicateScore: duplicateByReport.get(String(report.id))?.score || 0,
      }),
      moderation: state.moderation[report.id] || null,
    })).filter((entry) => entry.duplicate || entry.quality.score < 80 || entry.moderation);
  }

  function renderQualityQueue() {
    calculateQualityRecords();
    const filter = elements.qualityFilter.value;
    const records = state.qualityRecords.filter((entry) => {
      if (filter === "duplicate") return Boolean(entry.duplicate);
      if (filter === "low_quality") return entry.quality.rating === "low";
      if (filter === "moderated") return Boolean(entry.moderation);
      return true;
    });
    elements.qualityQueue.replaceChildren();
    if (!records.length) {
      elements.qualityQueue.append(createElement("div", "alerts-empty", "No reports need review under this filter."));
      return;
    }
    records.slice(0, 100).forEach((entry) => {
      const row = createElement("article", "quality-row");
      const score = createElement("span", "quality-score", String(Math.round(entry.quality.score)));
      const copy = createElement("div", "quality-copy");
      const label = entry.moderation?.status
        ? `${entry.moderation.status.replaceAll("_", " ")} · ${categoryLabel(entry.report.category)}`
        : `${entry.quality.rating} quality · ${categoryLabel(entry.report.category)}`;
      copy.append(
        createElement("strong", "", label),
        createElement("span", "", safeText(entry.report.summary, "No summary")),
        createElement("span", "", entry.duplicate
          ? `${Math.round(entry.duplicate.score * 100)}% possible duplicate · ${entry.duplicate.reasons.join(", ")}`
          : entry.quality.issues.join(" ")),
      );
      const actions = createElement("div", "quality-actions");
      [
        ["approved", "Approve", ""],
        ["duplicate", "Mark duplicate", ""],
        ["hidden", "Hide", "danger"],
      ].forEach(([status, labelText, className]) => {
        const button = createElement("button", `compact-button ${className}`.trim(), labelText);
        button.type = "button";
        button.disabled = !canWrite("moderation");
        button.addEventListener("click", async () => {
          const buttons = [...actions.querySelectorAll("button")];
          buttons.forEach((item) => { item.disabled = true; });
          try {
            await saveModeration(entry.report, status, entry.quality, entry.duplicate);
          } catch (error) {
            console.error("NeedMap moderation save error:", error);
            const feedback = createElement(
              "span",
              "write-hint",
              safeText(error?.message, "Could not save the moderation decision."),
            );
            feedback.setAttribute("role", "status");
            copy.append(feedback);
            buttons.forEach((item) => { item.disabled = !canWrite("moderation"); });
          }
        });
        actions.append(button);
      });
      row.append(score, copy, actions);
      elements.qualityQueue.append(row);
    });
  }

  function updateMainMapLayers(recommendation) {
    serviceLayer.clearLayers();
    coverageLayer.clearLayers();
    if (!recommendation) return;
    const serviceState = state.servicesByRecommendation.get(recommendation.id);
    (serviceState?.services || []).forEach((service) => {
      L.circleMarker([service.latitude, service.longitude], {
        radius: 6,
        color: "#fff",
        fillColor: "#2166a5",
        fillOpacity: 0.95,
        weight: 1.5,
      }).bindTooltip(createElement("span", "", `${safeText(service.name, "Mapped service")} · ${categoryLabel(service.type)}`), {
        direction: "top",
      }).addTo(serviceLayer);
    });
    [20, 10, 5].forEach((minutes, index) => {
      L.circle(
        [recommendation.position.latitude, recommendation.position.longitude],
        {
          radius: coverageRadiusMeters(state.coverageMode, minutes),
          color: ["#9273b9", "#5f8c7d", "#176b5a"][index],
          fillColor: ["#9273b9", "#5f8c7d", "#176b5a"][index],
          fillOpacity: 0.04,
          weight: 1.5,
          dashArray: "5 5",
        },
      ).addTo(coverageLayer);
    });
  }

  function initializeDetailMap(container, recommendation) {
    if (state.destroyed || !state.visible || !container.isConnected || !container.offsetWidth) return;
    if (state.detailMap) state.detailMap.remove();
    const detailMap = L.map(container, {
      attributionControl: true,
      zoomControl: true,
      scrollWheelZoom: false,
    });
    state.detailMap = detailMap;
    state.initializedDetailRecommendationId = recommendation.id;
    const signals = recommendationSignals(recommendation).filter((signal) => validPosition(signal));
    const bounds = L.latLngBounds([
      ...signals.map((signal) => [signal.latitude, signal.longitude]),
      [recommendation.position.latitude, recommendation.position.longitude],
    ]);
    if (recommendation.region?.geometry) {
      try {
        const regionBounds = L.geoJSON(recommendation.region.geometry).getBounds();
        if (regionBounds.isValid()) bounds.extend(regionBounds);
      } catch {
        // A malformed optional region shape should not prevent the candidate map.
      }
    }
    if (bounds.isValid() && !bounds.getNorthEast().equals(bounds.getSouthWest())) {
      detailMap.fitBounds(bounds, { padding: [22, 22], maxZoom: 13 });
    } else {
      detailMap.setView([recommendation.position.latitude, recommendation.position.longitude], 13);
    }
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      noWrap: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(detailMap);
    if (recommendation.region?.geometry) {
      try {
        L.geoJSON(recommendation.region.geometry, {
          style: {
            color: "#6336a5",
            fillColor: "#8d67bb",
            fillOpacity: 0.08,
            weight: 2,
          },
        }).addTo(detailMap);
      } catch {
        // Keep the report and candidate layers usable if the boundary is malformed.
      }
    }
    [20, 10, 5].forEach((minutes, index) => {
      L.circle(
        [recommendation.position.latitude, recommendation.position.longitude],
        {
          radius: coverageRadiusMeters(state.coverageMode, minutes),
          color: ["#9273b9", "#5f8c7d", "#176b5a"][index],
          fillColor: ["#9273b9", "#5f8c7d", "#176b5a"][index],
          fillOpacity: 0.035,
          weight: 1.4,
          dashArray: "4 4",
        },
      ).bindTooltip(`${minutes}-minute estimated ${state.coverageMode} band`)
        .addTo(detailMap);
    });
    signals.forEach((signal) => {
      const colors = { high: "#c34e42", medium: "#d28b27", low: "#2f8a69" };
      L.circleMarker([signal.latitude, signal.longitude], {
        radius: signal.severity === "high" ? 7 : 5,
        color: "#fff",
        fillColor: colors[signal.severity] || "#426f91",
        fillOpacity: 0.95,
        weight: 1.5,
      }).bindTooltip(createElement("span", "", `${safeText(signal.severity, "unknown")} urgency report`))
        .addTo(detailMap);
    });
    const serviceState = state.servicesByRecommendation.get(recommendation.id);
    (serviceState?.services || []).forEach((service) => {
      L.circleMarker([service.latitude, service.longitude], {
        radius: 6,
        color: "#fff",
        fillColor: "#2166a5",
        fillOpacity: 0.95,
        weight: 1.5,
      }).bindTooltip(createElement("span", "", safeText(service.name, "Mapped service"))).addTo(detailMap);
    });
    const icon = L.divIcon({
      className: "",
      html: '<span class="recommendation-marker" aria-hidden="true">✦</span>',
      iconAnchor: [17, 17],
      iconSize: [34, 34],
    });
    L.marker(
      [recommendation.position.latitude, recommendation.position.longitude],
      { icon, title: safeText(recommendation.analysis?.facilityType, "Candidate") },
    ).bindTooltip("Candidate placement").addTo(detailMap);
  }

  function createCoverageSection(recommendation) {
    const section = createElement("section", "detail-section");
    section.append(createElement("h4", "", "Estimated travel-time coverage"));
    const controls = createElement("div", "coverage-controls");
    const modeLabel = document.createElement("label");
    modeLabel.append(createElement("span", "", "Travel mode"));
    const mode = document.createElement("select");
    [["walk", "Walk"], ["transit", "Transit"], ["drive", "Drive"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      mode.append(option);
    });
    mode.value = state.coverageMode;
    mode.addEventListener("change", () => {
      state.coverageMode = mode.value;
      elements.scenarioMode.value = mode.value;
      updateMainMapLayers(recommendation);
      renderScenarioComparison();
      renderDetail();
    });
    modeLabel.append(mode);
    controls.append(modeLabel);
    const note = createElement(
      "p",
      "panel-note",
      "Planning estimate using straight-line distance, route factors, average speed, and fixed wait time. It is not live routing.",
    );
    const signals = recommendationSignals(recommendation);
    const coverage = calculateCoverageMetrics(recommendation.position, signals);
    const selectedMode = coverage.modes[state.coverageMode] || coverage.modes.transit;
    const grid = createElement("div", "coverage-grid");
    selectedMode.thresholds.forEach((threshold) => {
      const card = createElement("article", "coverage-card");
      card.append(
        createElement("strong", "", `${threshold.reportPercent}%`),
        createElement("span", "", `${threshold.reportCount} of ${coverage.validReportCount} reports within ${threshold.minutes} min`),
        createElement("span", "", `${threshold.urgencyPercent}% of urgency weight covered`),
      );
      grid.append(card);
    });
    section.append(controls, grid, note);
    return section;
  }

  function createServiceGapSection(recommendation) {
    const section = createElement("section", "detail-section");
    section.append(createElement("h4", "", "Existing-service gap"));
    const actions = createElement("div", "service-actions");
    const loadButton = createElement("button", "secondary-button", "Check nearby services");
    loadButton.type = "button";
    const serviceState = state.servicesByRecommendation.get(recommendation.id);
    const plannedRadiusKm = serviceSearchRadiusMeters(recommendation) / 1000;
    loadButton.disabled = serviceState?.loading;
    const status = createElement("span", "service-status", serviceState?.loading
      ? "Querying OpenStreetMap…"
      : serviceState?.error
        ? serviceState.error
        : serviceState?.gap
          ? `${serviceState.gap.rating} · gap score ${serviceState.gap.gapScore}/100 · ${(serviceState.radiusMeters || plannedRadiusKm * 1000) / 1000} km search`
          : `Load mapped services within ${plannedRadiusKm} km to test whether this is a real gap.`);
    loadButton.addEventListener("click", () => loadServices(recommendation));
    actions.append(loadButton, status);
    section.append(actions);
    if (serviceState?.gap) {
      const list = createElement("div", "service-list");
      if (serviceState.gap.nearestServices.length) {
        serviceState.gap.nearestServices.forEach((service) => {
          const row = createElement("div", "service-row");
          row.append(
            createElement("strong", "", service.name),
            createElement("span", "", `${service.distanceKm} km away`),
          );
          list.append(row);
        });
      } else {
        list.append(createElement("div", "alerts-empty", "No matching mapped services were found within the search area."));
      }
      const attribution = createElement("a", "service-attribution", serviceInventorySource.attribution);
      attribution.href = serviceInventorySource.url;
      attribution.target = "_blank";
      attribution.rel = "noreferrer";
      section.append(list, attribution);
    }
    return section;
  }

  function createEvidenceSection(recommendation) {
    const section = createElement("section", "detail-section detail-evidence");
    section.append(createElement("h4", "", "Cited report evidence"));
    const suppliedEvidence = Array.isArray(recommendation.analysis?.evidence)
      ? recommendation.analysis.evidence.filter(isRecord)
      : [];
    const evidence = suppliedEvidence.length
      ? suppliedEvidence
      : recommendationSignals(recommendation).map((signal, index) => ({
          citation: `R${index + 1}`,
          summary: signal.summary,
          urgency: signal.severity,
          relevance: "Included in the regional need pattern.",
        }));
    const list = createElement("ol", "decision-evidence-list");
    evidence.forEach((item) => {
      const row = createElement("li", "decision-evidence-row");
      row.append(
        createElement("span", "evidence-ref", safeText(item.citation || item.evidenceId, "R")),
        createElement("blockquote", "", safeText(item.summary, "No summary available")),
        createElement("cite", "", `${safeText(item.urgency, "unknown")} urgency · ${safeText(item.relevance, "Supports this recommendation")}`),
      );
      list.append(row);
    });
    section.append(list);
    return section;
  }

  function createWorkflowSection(recommendation) {
    const workflow = workflowFor(state, recommendation.id);
    const draft = state.workflowDrafts.get(recommendation.id) || workflow;
    const key = writeKey("workflow", recommendation.id);
    const section = createElement("section", "detail-section workflow-panel");
    section.append(createElement("h4", "", "Recommendation workflow"));
    const form = createElement("form", "workflow-form");
    const grid = createElement("div", "workflow-grid");
    const statusLabel = document.createElement("label");
    statusLabel.append(createElement("span", "", "Status"));
    const statusSelect = document.createElement("select");
    WORKFLOW_STATUSES.forEach((statusValue) => {
      const option = document.createElement("option");
      option.value = statusValue;
      option.textContent = statusValue[0].toUpperCase() + statusValue.slice(1);
      statusSelect.append(option);
    });
    statusSelect.value = draft.status || "new";
    statusLabel.append(statusSelect);
    const ownerLabel = document.createElement("label");
    ownerLabel.append(createElement("span", "", "Owner"));
    const ownerInput = document.createElement("input");
    ownerInput.value = draft.owner || "";
    ownerInput.maxLength = 80;
    ownerInput.placeholder = "Team or staff owner";
    ownerLabel.append(ownerInput);
    const noteLabel = document.createElement("label");
    noteLabel.append(createElement("span", "", "Decision note"));
    const noteInput = document.createElement("textarea");
    noteInput.rows = 3;
    noteInput.maxLength = 600;
    noteInput.value = draft.note || "";
    noteInput.placeholder = "Record why the status changed and what happens next…";
    [statusSelect, ownerInput, noteInput].forEach((control) => { control.disabled = !canWrite("workflow"); });
    noteLabel.append(noteInput);
    grid.append(statusLabel, ownerLabel, noteLabel);
    const actions = createElement("div", "workflow-actions");
    const save = createElement("button", "primary-button", "Save workflow");
    save.type = "submit";
    save.disabled = !canWrite("workflow") || state.pendingWrites.has(key);
    const hint = createElement("span", "write-hint", state.writeErrors.get(key) || (canWrite("workflow")
      ? `Last updated ${formatDateTime(workflow.updatedAt)}`
      : "Enable staff or device-local planner access to save."));
    hint.setAttribute("role", "status");
    actions.append(save, hint);
    form.append(grid, actions);
    form.addEventListener("input", () => state.workflowDrafts.set(recommendation.id, {
      status: statusSelect.value, owner: ownerInput.value, note: noteInput.value,
    }));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const accessVersion = state.accessVersion;
      const submittedDraft = state.workflowDrafts.get(recommendation.id);
      state.writeErrors.delete(key);
      save.disabled = true;
      hint.textContent = "Saving…";
      try {
        await saveWorkflow(recommendation, {
          status: statusSelect.value,
          owner: ownerInput.value.trim(),
          note: noteInput.value.trim(),
        });
        if (state.destroyed || accessVersion !== state.accessVersion) return;
        if (state.workflowDrafts.get(recommendation.id) === submittedDraft) {
          state.workflowDrafts.delete(recommendation.id);
        }
        hint.textContent = "Saved.";
      } catch (error) {
        if (state.destroyed || accessVersion !== state.accessVersion) return;
        console.error("NeedMap workflow save error:", error);
        hint.textContent = safeText(error?.message, "Could not save the workflow.");
        state.writeErrors.set(key, hint.textContent);
      } finally {
        save.disabled = !canWrite("workflow");
        if (!state.destroyed && accessVersion === state.accessVersion && !form.isConnected) renderDetail();
      }
    });
    section.append(form);
    return section;
  }

  function createOutcomesSection(recommendation) {
    const draft = state.outcomeDrafts.get(recommendation.id);
    const key = writeKey("outcome", recommendation.id);
    const section = createElement("section", "detail-section outcomes-panel");
    section.append(createElement("h4", "", "Community outcomes and feedback"));
    const outcomes = state.outcomes.filter((item) => item.recommendationId === recommendation.id);
    const list = createElement("div", "outcome-list");
    if (outcomes.length) {
      outcomes
        .sort((first, second) => timestampMilliseconds(second.createdAt) - timestampMilliseconds(first.createdAt))
        .forEach((outcome) => {
          list.append(createElement(
            "article",
            "outcome-row",
            `${safeText(outcome.accessChange, "unknown")} access · ${outcome.rating || "–"}/5 · ${safeText(outcome.note, "No note")} · ${formatDateTime(outcome.createdAt)}`,
          ));
        });
    } else {
      list.append(createElement("div", "alerts-empty", "No post-implementation outcomes have been recorded."));
    }
    const form = createElement("form", "outcome-form");
    const changeLabel = document.createElement("label");
    changeLabel.append(createElement("span", "", "Access changed"));
    const change = document.createElement("select");
    [["better", "Better"], ["same", "About the same"], ["worse", "Worse"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      change.append(option);
    });
    changeLabel.append(change);
    if (draft) change.value = draft.accessChange;
    const ratingLabel = document.createElement("label");
    ratingLabel.append(createElement("span", "", "Usefulness rating"));
    const rating = document.createElement("select");
    [5, 4, 3, 2, 1].forEach((value) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${value} / 5`;
      rating.append(option);
    });
    ratingLabel.append(rating);
    if (draft) rating.value = String(draft.rating);
    const noteLabel = document.createElement("label");
    noteLabel.append(createElement("span", "", "Observed result"));
    const note = document.createElement("textarea");
    note.required = true;
    note.rows = 3;
    note.maxLength = 500;
    note.placeholder = "What changed after the pilot or service opened?";
    note.value = draft?.note || "";
    [change, rating, note].forEach((control) => { control.disabled = !canWrite("workflow"); });
    noteLabel.append(note);
    const save = createElement("button", "secondary-button", "Record outcome");
    save.type = "submit";
    save.disabled = !canWrite("workflow") || state.pendingWrites.has(key);
    const feedback = createElement("span", "write-hint", state.writeErrors.get(key) || "");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    form.append(changeLabel, ratingLabel, noteLabel, save, feedback);
    form.addEventListener("input", () => state.outcomeDrafts.set(recommendation.id, {
      accessChange: change.value, rating: Number(rating.value), note: note.value,
    }));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const accessVersion = state.accessVersion;
      const submittedDraft = state.outcomeDrafts.get(recommendation.id);
      state.writeErrors.delete(key);
      save.disabled = true;
      feedback.textContent = "Saving…";
      try {
        await saveOutcome(recommendation, {
          accessChange: change.value,
          rating: Number(rating.value),
          note: note.value.trim(),
        });
        if (state.destroyed || accessVersion !== state.accessVersion) return;
        if (state.outcomeDrafts.get(recommendation.id) === submittedDraft) {
          state.outcomeDrafts.delete(recommendation.id);
          note.value = "";
        }
        feedback.textContent = "Outcome recorded.";
      } catch (error) {
        if (state.destroyed || accessVersion !== state.accessVersion) return;
        console.error("NeedMap outcome save error:", error);
        feedback.textContent = safeText(error?.message, "Could not save the outcome.");
        state.writeErrors.set(key, feedback.textContent);
      } finally {
        save.disabled = !canWrite("workflow");
        if (!state.destroyed && accessVersion === state.accessVersion && !form.isConnected) renderDetail();
      }
    });
    section.append(list, form);
    return section;
  }

  function renderDetail() {
    if (state.destroyed) return;
    if (state.detailMap) {
      state.detailMap.remove();
      state.detailMap = null;
    }
    elements.decisionDetail.replaceChildren();
    const recommendation = state.recommendations.find(
      (item) => item.id === state.selectedRecommendationId,
    );
    if (!recommendation) {
      elements.decisionDetail.append(createElement(
        "div",
        "decision-empty",
        state.recommendations.length
          ? "Select a recommendation to inspect its coverage, evidence, workflow, and outcomes."
          : "Placement recommendations will appear after enough reports form a regional need pattern.",
      ));
      updateMainMapLayers(null);
      return;
    }
    const workflow = workflowFor(state, recommendation.id);
    const hero = createElement("header", "detail-hero");
    const heading = document.createElement("div");
    heading.append(
      createElement("p", "placement-kicker", `${categoryLabel(recommendation.category)} · ${recommendation.region?.name || "Unknown region"}`),
      createElement("h3", "", safeText(recommendation.analysis?.facilityType, "Community service")),
      createElement("p", "", safeText(recommendation.analysis?.decisionSummary || recommendation.analysis?.rationale, "Evidence-backed placement candidate.")),
    );
    const status = createElement("span", "detail-status", workflow.status || "new");
    hero.append(heading, status);
    const metrics = createElement("dl", "detail-metrics");
    [
      ["Priority", analysisPriority(recommendation)],
      ["Confidence", `${Math.round((recommendation.analysis?.confidence || 0) * 100)}%`],
      ["Reports", recommendationSignals(recommendation).length],
      ["Urgency score", recommendation.urgencyScore],
    ].forEach(([label, value]) => {
      const wrapper = document.createElement("div");
      wrapper.append(createElement("dt", "", label), createElement("dd", "", String(value)));
      metrics.append(wrapper);
    });
    const actions = createElement("div", "detail-primary-actions");
    const mapButton = createElement("button", "primary-button", "Open on main map");
    mapButton.type = "button";
    mapButton.addEventListener("click", () => {
      updateMainMapLayers(recommendation);
      onShowRecommendation?.(recommendation);
    });
    actions.append(mapButton);
    const mapGrid = createElement("div", "decision-map-grid");
    const mapContainer = createElement("div", "decision-map");
    mapContainer.setAttribute("aria-label", `Decision map for ${recommendation.region?.name || "candidate region"}`);
    const mapCopy = createElement("div", "decision-map-copy");
    mapCopy.append(
      createElement("strong", "", `${recommendation.position.latitude.toFixed(4)}, ${recommendation.position.longitude.toFixed(4)}`),
      createElement("p", "", "The star marks the candidate location. Dots show reports, blue markers show loaded existing services, and dashed rings show estimated travel-time bands."),
      actions,
    );
    mapGrid.append(mapContainer, mapCopy);
    const analysisSection = createElement("section", "detail-section detail-analysis");
    analysisSection.append(
      createElement("h4", "", "Why this service and location"),
      createElement("p", "", safeText(recommendation.analysis?.needAnalysis, recommendation.analysis?.rationale)),
      createElement("p", "", safeText(recommendation.analysis?.placementRationale, "The point minimizes weighted distance to the reports while staying inside the verified region.")),
    );
    const nextSteps = createElement("section", "detail-section detail-checklist");
    nextSteps.append(createElement("h4", "", "Implementation and safeguards"));
    const list = document.createElement("ul");
    const implementationSteps = Array.isArray(recommendation.analysis?.implementationSteps)
      ? recommendation.analysis.implementationSteps
      : [];
    const limitations = Array.isArray(recommendation.analysis?.limitations)
      ? recommendation.analysis.limitations
      : [];
    const checklistItems = [...implementationSteps, ...limitations];
    (checklistItems.length
      ? checklistItems
      : ["Confirm roads, parcels, zoning, operating cost, accessibility, and safety before implementation."]
    ).forEach((item) => list.append(createElement("li", "", safeText(item))));
    nextSteps.append(list);
    elements.decisionDetail.append(
      hero,
      metrics,
      mapGrid,
      createCoverageSection(recommendation),
      createServiceGapSection(recommendation),
      analysisSection,
      createEvidenceSection(recommendation),
      nextSteps,
      createWorkflowSection(recommendation),
      createOutcomesSection(recommendation),
    );
    updateMainMapLayers(recommendation);
    requestAnimationFrame(() => initializeDetailMap(mapContainer, recommendation));
  }

  async function loadServices(recommendation) {
    if (state.destroyed) return;
    const request = { ...state.servicesByRecommendation.get(recommendation.id), loading: true, error: "" };
    state.servicesByRecommendation.set(recommendation.id, request);
    const isCurrent = () => !state.destroyed && state.servicesByRecommendation.get(recommendation.id) === request;
    renderDetail();
    try {
      const radiusMeters = serviceSearchRadiusMeters(recommendation);
      const result = await loadNearbyServices(recommendation, { radiusMeters });
      if (!isCurrent()) return;
      const searchRadiusKm = result.radiusMeters / 1000;
      const gap = scoreExistingServiceGap(recommendation.position, result.services, {
        serviceType: recommendation.analysis?.facilityType || categoryLabel(recommendation.category),
        searchRadiusKm,
        idealGapKm: Math.max(3, searchRadiusKm / 2),
        saturationCount: 3,
      });
      state.servicesByRecommendation.set(recommendation.id, {
        ...result,
        gap,
        loadedAt: new Date().toISOString(),
      });
      renderScenarioComparison();
      renderDetail();
    } catch (error) {
      if (!isCurrent()) return;
      console.error("NeedMap existing-service lookup error:", error);
      state.servicesByRecommendation.set(recommendation.id, {
        error: safeText(error?.message, "Existing services could not be loaded."),
      });
      renderDetail();
    }
  }

  async function saveWorkflow(recommendation, values) {
    if (!canWrite("workflow")) throw new Error("Staff or local planner access is required.");
    const record = {
      candidateId: recommendation.id,
      facilityType: safeText(recommendation.analysis?.facilityType, "Community service"),
      regionId: recommendation.region?.id || "",
      regionName: recommendation.region?.name || "",
      category: recommendation.category || "other",
      latitude: recommendation.position.latitude,
      longitude: recommendation.position.longitude,
      status: WORKFLOW_STATUSES.includes(values.status) ? values.status : "new",
      owner: values.owner.slice(0, 80),
      note: values.note.slice(0, 600),
      updatedBy: state.user?.uid || "local-demo",
    };
    if (state.mode === "local") {
      state.workflows = { ...state.workflows, [recommendation.id]: {
        ...record, updatedAt: new Date().toISOString(),
      } };
      state.workflowDrafts.delete(recommendation.id);
      localWorkspace.workflows = { ...state.workflows };
      persistLocalState();
      renderDecisionList();
      renderDetail();
      renderMetrics();
      return;
    }
    const key = writeKey("workflow", recommendation.id);
    if (state.pendingWrites.has(key)) throw new Error("This workflow is already being saved.");
    state.pendingWrites.add(key);
    try {
      await setDoc(
        doc(db, "recommendationReviews", safeDocumentId(recommendation.id)),
        { ...record, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } finally {
      state.pendingWrites.delete(key);
    }
  }

  async function saveModeration(report, status, quality, duplicate) {
    if (!canWrite("moderation")) throw new Error("Moderator or local planner access is required.");
    const record = {
      reportId: String(report.id),
      status,
      qualityScore: quality.score,
      qualityIssues: quality.issues.slice(0, 8),
      possibleDuplicateOf: duplicate
        ? duplicate.firstReportId === String(report.id)
          ? duplicate.secondReportId
          : duplicate.firstReportId
        : "",
      duplicateScore: duplicate?.score || 0,
      updatedBy: state.user?.uid || "local-demo",
    };
    if (state.mode === "local") {
      state.moderation = { ...state.moderation, [report.id]: { ...record, updatedAt: new Date().toISOString() } };
      localWorkspace.moderation = { ...state.moderation };
      persistLocalState();
      onModerationChanged?.(state.moderation);
      renderQualityQueue();
      renderDetail();
      return;
    }
    await setDoc(
      doc(db, "reportModeration", safeDocumentId(report.id)),
      { ...record, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  async function saveOutcome(recommendation, values) {
    if (!canWrite("workflow")) throw new Error("Staff or local planner access is required.");
    if (!values.note) throw new Error("Add an observed result before saving.");
    const record = {
      recommendationId: recommendation.id,
      accessChange: ["better", "same", "worse"].includes(values.accessChange)
        ? values.accessChange
        : "same",
      rating: Math.round(boundedNumber(values.rating, 1, 5, 3)),
      note: values.note.slice(0, 500),
      authorUid: state.user?.uid || "local-demo",
    };
    if (state.mode === "local") {
      state.outcomes.push({
        ...record,
        id: `local-${Date.now()}`,
        createdAt: new Date().toISOString(),
      });
      localWorkspace.outcomes = [...state.outcomes];
      state.outcomeDrafts.delete(recommendation.id);
      persistLocalState();
      renderDetail();
      return;
    }
    const key = writeKey("outcome", recommendation.id);
    if (state.pendingWrites.has(key)) throw new Error("This outcome is already being saved.");
    state.pendingWrites.add(key);
    try {
      await addDoc(collection(db, "outcomeFeedback"), {
        ...record,
        createdAt: serverTimestamp(),
      });
    } finally {
      state.pendingWrites.delete(key);
    }
  }

  function exportCsv() {
    const rows = state.recommendations.map((recommendation) => {
      const workflow = workflowFor(state, recommendation.id);
      const signals = recommendationSignals(recommendation);
      const coverage = calculateCoverageMetrics(recommendation.position, signals);
      const serviceState = state.servicesByRecommendation.get(recommendation.id);
      return {
        candidateId: recommendation.id,
        facility: recommendation.analysis?.facilityType,
        region: recommendation.region?.name,
        category: recommendation.category,
        priority: analysisPriority(recommendation),
        confidence: recommendation.analysis?.confidence,
        reportCount: signals.length,
        urgencyScore: recommendation.urgencyScore,
        latitude: recommendation.position.latitude,
        longitude: recommendation.position.longitude,
        transit10MinuteCoverage: coverage.modes.transit.thresholds.find((item) => item.minutes === 10)?.reportPercent ?? "",
        serviceGapScore: serviceState?.gap?.gapScore ?? "not loaded",
        serviceGapRating: serviceState?.gap?.rating ?? "not loaded",
        workflowStatus: workflow.status,
        owner: workflow.owner,
        note: workflow.note,
        evidence: (Array.isArray(recommendation.analysis?.evidence)
          ? recommendation.analysis.evidence.filter(isRecord)
          : []).map((item) =>
          `[${item.citation || item.evidenceId}] ${item.summary}`).join(" | "),
      };
    });
    const csv = serializeCsv(rows, {
      includeBom: true,
      columns: [
        { key: "candidateId", label: "Candidate ID" },
        { key: "facility", label: "Recommended facility" },
        { key: "region", label: "Region" },
        { key: "category", label: "Category" },
        { key: "priority", label: "Priority" },
        { key: "confidence", label: "Confidence" },
        { key: "reportCount", label: "Reports" },
        { key: "urgencyScore", label: "Urgency score" },
        { key: "latitude", label: "Candidate latitude" },
        { key: "longitude", label: "Candidate longitude" },
        { key: "transit10MinuteCoverage", label: "Estimated transit coverage within 10 minutes percent" },
        { key: "serviceGapScore", label: "Existing-service gap score" },
        { key: "serviceGapRating", label: "Existing-service gap rating" },
        { key: "workflowStatus", label: "Workflow status" },
        { key: "owner", label: "Owner" },
        { key: "note", label: "Decision note" },
        { key: "evidence", label: "Report evidence" },
      ],
    });
    const date = new Date().toISOString().slice(0, 10);
    downloadText(`needmap-decisions-${date}.csv`, csv, "text/csv;charset=utf-8");
  }

  function notifyNewAlerts() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    let notified = new Set();
    try {
      const stored = JSON.parse(sessionStorage.getItem("needmap.notifiedAlerts") || "[]");
      if (Array.isArray(stored)) notified = new Set(stored);
    } catch {
      // Invalid or blocked session storage should not stop alerts from rendering.
    }
    activeAlerts().forEach((alert) => {
      const key = alertAcknowledgementKey(alert);
      if (notified.has(key)) return;
      try {
        new Notification(`NeedMap: ${alert.priority} signal`, {
          body: `${alert.regionName} · ${categoryLabel(alert.category)} · ${alert.reportCount} reports`,
        });
        notified.add(key);
      } catch {
        // Notifications can be blocked by browser or operating-system policy.
      }
    });
    try {
      sessionStorage.setItem("needmap.notifiedAlerts", JSON.stringify([...notified].slice(-500)));
    } catch {
      // Notifications still work when session storage is unavailable.
    }
  }

  function render() {
    if (state.destroyed) return;
    if (!state.selectedRecommendationId ||
        !state.recommendations.some((item) => item.id === state.selectedRecommendationId)) {
      state.selectedRecommendationId = state.recommendations[0]?.id || "";
    }
    elements.updatedAt.textContent = state.recommendations.length
      ? `Updated ${new Date().toLocaleString()} · ${state.recommendations.length} ranked candidate${state.recommendations.length === 1 ? "" : "s"}`
      : "Waiting for placement analysis…";
    renderMetrics();
    renderTrend();
    recalculateAlerts();
    notifyNewAlerts();
    syncScenarioOptions();
    renderScenarioComparison();
    renderDecisionList();
    renderQualityQueue();
    renderDetail();
    updateAccessUi();
  }

  listen(elements.decisionSearch, "input", () => {
    state.search = elements.decisionSearch.value;
    renderDecisionList();
  });
  listen(elements.trendRange, "change", renderTrend);
  listen(elements.scenarioA, "change", renderScenarioComparison);
  listen(elements.scenarioB, "change", renderScenarioComparison);
  listen(elements.scenarioMode, "change", () => {
    state.coverageMode = elements.scenarioMode.value;
    renderScenarioComparison();
    renderDetail();
  });
  listen(elements.qualityFilter, "change", renderQualityQueue);
  listen(elements.exportCsv, "click", exportCsv);
  listen(elements.exportBrief, "click", () => window.print());
  listen(elements.staffButton, "click", () => {
    if (!elements.staffDialog.open) elements.staffDialog.showModal();
  });
  listen(elements.alertsButton, "click", () => {
    if (!elements.alertsDialog.open) elements.alertsDialog.showModal();
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    listen(button, "click", () => {
      document.querySelector(`#${button.dataset.closeDialog}`)?.close();
    });
  });
  listen(elements.staffForm, "submit", async (event) => {
    event.preventDefault();
    if (state.signingIn) return;
    state.signingIn = true;
    if (state.mode === "local") {
      state.mode = "readonly";
      state.role = "viewer";
      clearSharedWorkspace();
      persistLocalState();
      render();
    }
    elements.staffStatus.textContent = "Signing in and verifying staff access…";
    try {
      await signInWithEmailAndPassword(
        auth,
        elements.staffEmail.value.trim(),
        elements.staffPassword.value,
      );
      elements.staffPassword.value = "";
    } catch (error) {
      elements.staffStatus.textContent = friendlyAuthError(error);
    } finally {
      state.signingIn = false;
    }
  });
  listen(elements.staffSignOut, "click", async () => {
    elements.staffStatus.textContent = "Signing out…";
    try {
      await signOut(auth);
    } catch (error) {
      elements.staffStatus.textContent = safeText(error?.message, "Could not sign out.");
    }
  });
  listen(elements.localDemoButton, "click", async () => {
    state.accessVersion += 1;
    state.accessMessage = "";
    closeRealtimeSubscriptions();
    if (state.mode === "local") {
      state.mode = "readonly";
      state.role = "viewer";
      clearSharedWorkspace();
      persistLocalState();
      if (state.user) {
        await resolveStaffAccess(state.user);
        return;
      }
    } else {
      state.mode = "local";
      state.role = "local planner";
      activateLocalWorkspace();
    }
    persistLocalState();
    updateAccessUi();
    render();
  });
  elements.alertHighThreshold.value = String(state.settings.highUrgencyThreshold);
  elements.alertTrendThreshold.value = String(state.settings.trendRatio);
  listen(elements.alertHighThreshold, "change", () => {
    state.settings.highUrgencyThreshold = Math.round(boundedNumber(elements.alertHighThreshold.value, 1, 100, 3));
    elements.alertHighThreshold.value = String(state.settings.highUrgencyThreshold);
    persistLocalState();
    recalculateAlerts();
    notifyNewAlerts();
  });
  listen(elements.alertTrendThreshold, "change", () => {
    state.settings.trendRatio = boundedNumber(elements.alertTrendThreshold.value, 1, 10, 1.5);
    elements.alertTrendThreshold.value = String(state.settings.trendRatio);
    persistLocalState();
    recalculateAlerts();
    notifyNewAlerts();
  });
  listen(elements.notificationButton, "click", async () => {
    if (!("Notification" in window)) {
      elements.notificationButton.textContent = "Notifications unsupported";
      elements.notificationButton.disabled = true;
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      elements.notificationButton.textContent = permission === "granted"
        ? "Browser notifications enabled"
        : "Notifications were not enabled";
      notifyNewAlerts();
    } catch {
      elements.notificationButton.textContent = "Notifications were not enabled";
    }
  });
  listen(elements.layerServices, "change", () => {
    if (elements.layerServices.checked) serviceLayer.addTo(map);
    else serviceLayer.removeFrom(map);
  });
  listen(elements.layerCoverage, "change", () => {
    if (elements.layerCoverage.checked) coverageLayer.addTo(map);
    else coverageLayer.removeFrom(map);
  });

  updateAccessUi();
  render();

  return {
    updateSignals(signals) {
      if (state.destroyed) return;
      state.signals = Array.isArray(signals) ? signals.filter(isRecord) : [];
      recalculateAlerts();
      notifyNewAlerts();
      renderTrend();
      renderQualityQueue();
      renderMetrics();
    },
    updateRecommendations(recommendations) {
      if (state.destroyed) return;
      const previousKeys = new Map(state.recommendations.map((item) => [item.id, serviceLookupKey(item)]));
      state.recommendations = Array.isArray(recommendations)
        ? [...new Map(recommendations.flatMap((item) => {
          const position = validPosition(item?.position);
          const id = safeText(item?.id);
          return position && id ? [[id, { ...item, id, position }]] : [];
        })).values()].sort((first, second) =>
            priorityRank(analysisPriority(second)) - priorityRank(analysisPriority(first)) ||
            second.urgencyScore - first.urgencyScore)
        : [];
      const currentKeys = new Map(state.recommendations.map((item) => [item.id, serviceLookupKey(item)]));
      for (const id of state.servicesByRecommendation.keys()) {
        if (!currentKeys.has(id) || currentKeys.get(id) !== previousKeys.get(id)) {
          state.servicesByRecommendation.delete(id);
        }
      }
      render();
    },
    setVisible(visible) {
      if (state.destroyed) return;
      state.visible = Boolean(visible);
      if (state.visible) render();
      else if (state.detailMap) {
        state.detailMap.remove();
        state.detailMap = null;
      }
    },
    getModeration() {
      return { ...state.moderation };
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      state.accessVersion += 1;
      removeEventListeners.forEach((removeListener) => removeListener());
      closeRealtimeSubscriptions();
      unsubscribeAuth();
      if (state.detailMap) state.detailMap.remove();
      serviceLayer.remove();
      coverageLayer.remove();
    },
  };
}

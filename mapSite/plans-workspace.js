import { PLAN_TYPE_IDS, PLAN_TYPES, buildPlanModel } from "./plans-model.js";
import { buildReportPopulationArea } from "./report-population-area.js";
import { loadReportPopulation } from "./report-population.js";
import { serviceIconSvg } from "./service-icons.js";
import { renderPlansLocationFallback } from "./plans-location-map.js";

const POPULATION_SOURCE = Object.freeze({
  title: "WorldPop 2025 population dataset",
  publisher: "WorldPop · University of Southampton",
  year: 2025,
  url: "https://www.worldpop.org/methods/populations/",
  usedFor: "Modeled resident population inside the highlighted planning area.",
});

function uniqueSources(...groups) {
  const values = new Map();
  for (const source of groups.flat().filter(Boolean)) {
    if (!source?.url || !source?.title) continue;
    const current = values.get(source.url);
    const used = Array.isArray(source.usedFor) ? source.usedFor : [source.usedFor];
    values.set(source.url, {
      ...source,
      usedFor: [...new Set([...(current?.usedFor || []), ...used].filter(Boolean))],
    });
  }
  return [...values.values()];
}

function formulaText(formula) {
  if (!formula) return "";
  if (typeof formula === "string") return formula;
  if (typeof formula?.display === "string") return formula.display;
  if (typeof formula?.description === "string") return formula.description;
  return Object.entries(formula).map(([key, value]) => `${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join(" × ") : value}`).join(" · ");
}

function roundedResidents(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 10) return Math.round(value);
  const magnitude = 10 ** Math.max(1, Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
}

function formatCoordinates(position, number) {
  if (!Number.isFinite(position?.latitude) || !Number.isFinite(position?.longitude)) return "";
  return `${number(Math.abs(position.latitude), 3)}°${position.latitude < 0 ? "S" : "N"}, ${number(Math.abs(position.longitude), 3)}°${position.longitude < 0 ? "W" : "E"}`;
}

export function createPlansWorkspace({
  i18n,
  document = globalThis.document,
  createLocationMap,
  loadPopulation = loadReportPopulation,
  buildArea = buildReportPopulationArea,
  evidenceFor = () => [],
} = {}) {
  const byId = (id) => document.getElementById(id);
  const typeSelect = byId("plans-type");
  const results = byId("plans-results");
  if (!typeSelect || !results || !byId("plans-status") || !byId("plans-scope")) {
    throw new TypeError("Plans page controls are incomplete.");
  }
  const tr = (key, values = {}, fallback = key) => i18n
    ? i18n.t(key, values)
    : Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), fallback);
  const number = (value, digits = 0) => i18n?.number
    ? i18n.number(value, { maximumFractionDigits: digits })
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  const usesTranslatedEvidenceCopy = () => Boolean(i18n?.code && i18n.code !== "en");
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const icon = (key) => {
    const element = node("span", undefined, "service-icon");
    element.setAttribute("aria-hidden", "true");
    element.innerHTML = serviceIconSvg(key);
    return element;
  };

  let region;
  let reports = [];
  let reportsReady = false;
  let connectionFailed = false;
  let visible = false;
  let destroyed = false;
  let populationRevision = 0;
  let populationController;
  let maps = [];
  let populationByCandidate = new Map();
  let areaByCandidate = new Map();
  let model;

  function typeName(type) {
    return tr(`plans.type.${type}`, {}, PLAN_TYPES[type]?.label || type.replaceAll("_", " "));
  }

  function selectedType() {
    const selected = [...typeSelect.options].find((option) => option.selected)?.value || typeSelect.value;
    return Object.hasOwn(PLAN_TYPES, selected) ? selected : "hospital";
  }

  function refreshOptions() {
    const selected = selectedType();
    typeSelect.replaceChildren(...PLAN_TYPE_IDS.map((type) => {
      const option = node("option", typeName(type)); option.value = type; return option;
    }));
    for (const option of typeSelect.options) option.removeAttribute("selected");
    [...typeSelect.options].find((option) => option.value === selected)?.setAttribute("selected", "");
    byId("plans-type-icon").innerHTML = serviceIconSvg(PLAN_TYPES[selected].iconKey);
  }

  function destroyMaps() {
    for (const map of maps) map.destroy();
    maps = [];
  }

  function cancelPopulation() {
    populationRevision += 1;
    populationController?.abort();
    populationController = undefined;
  }

  function makeArea(candidate) {
    try {
      return buildArea([{ id: candidate.id, ...candidate.position }], region, {
        radiusMeters: candidate.serviceArea.radiusMeters,
      });
    } catch {
      return { geometry: null, reportCount: 0, radiusMeters: candidate.serviceArea.radiusMeters };
    }
  }

  function costText(cost) {
    if (cost?.status !== "estimated") return tr("plans.estimateUnavailable", {}, "Supported estimate unavailable");
    const formatter = new Intl.NumberFormat(i18n?.code || document.documentElement.lang || "en", {
      style: "currency", currency: cost.currency, notation: "compact", maximumFractionDigits: 2,
    });
    return `${formatter.format(cost.low)}–${formatter.format(cost.high)} ${cost.currency}`;
  }

  function timelineText(timeline) {
    return timeline?.status === "estimated"
      ? tr("plans.monthRange", { low: number(timeline.lowMonths, 1), high: number(timeline.highMonths, 1) }, `${number(timeline.lowMonths, 1)}–${number(timeline.highMonths, 1)} months`)
      : tr("plans.estimateUnavailable", {}, "Supported estimate unavailable");
  }

  function estimateBox(label, value, detail) {
    const box = node("div", undefined, "plan-estimate");
    box.append(node("span", label, "plan-estimate-label"), node("strong", value), node("small", detail));
    return box;
  }

  function populationBox(candidate) {
    const state = populationByCandidate.get(candidate.id);
    const box = node("div", undefined, "plan-benefit");
    box.append(node("span", tr("plans.potentialResidents", {}, "Potential nearby residents")));
    if (state?.status === "ready") {
      const rounded = roundedResidents(state.value);
      box.append(node("strong", tr("plans.aboutResidents", { count: number(rounded) }, `About ${number(rounded)}`)));
      box.append(node("small", tr("plans.populationDetail", { radius: number(candidate.serviceArea.radiusKm, 1), year: String(state.year) }, `Modeled residents in the highlighted ${number(candidate.serviceArea.radiusKm, 1)} km planning area · WorldPop ${state.year}. This does not predict actual users.`)));
    } else if (state?.status === "unavailable") {
      box.append(node("strong", tr("common.unavailable", {}, "Unavailable")));
      box.append(node("small", tr("plans.populationUnavailable", {}, "WorldPop could not verify a resident estimate for this planning area.")));
    } else {
      box.append(node("strong", tr("common.loading", {}, "Loading…")));
      box.append(node("small", tr("plans.populationLoading", {}, "Calculating the modeled population inside the highlighted area.")));
    }
    return box;
  }

  function reportSection(candidate) {
    const section = node("section", undefined, "plan-section");
    section.append(node("h4", tr("plans.whyLocation", {}, "Why NeedMap selected this location")));
    const facts = node("ul", undefined, "plan-facts");
    const urgencyCount = candidate.urgencyBreakdown.high;
    const data = [
      [number(candidate.reportCount), tr("plans.supportingReports", {}, "supporting reports")],
      [number(urgencyCount), tr("plans.highUrgencyReports", {}, "high-urgency reports")],
      [tr("plans.weightedMedian", {}, "Weighted center"), tr("plans.weightedMedianDetail", {}, "uses report locations and urgency")],
    ];
    for (const [value, label] of data) { const item = node("li"); item.append(node("strong", value), document.createTextNode(label)); facts.append(item); }
    section.append(facts);
    const list = node("ol", undefined, "plan-reports");
    candidate.reportCitations.forEach((citation, index) => {
      const item = node("li", undefined, "plan-report");
      const link = node("a", tr("plans.openReport", { number: index + 1 }, `Report ${index + 1} · open in Analysis`));
      link.href = citation.analysisHref;
      const copy = node("p", citation.summary || tr("explore.noDescription", {}, "No description provided."));
      copy.dir = "auto";
      item.append(link, copy); list.append(item);
    });
    section.append(list);
    return section;
  }

  function sourceBox(candidate, population) {
    const cost = candidate.estimates.cost;
    const timeline = candidate.estimates.timeline;
    const sources = uniqueSources(cost.sources || [], timeline.sources || [], population?.status === "ready" ? [POPULATION_SOURCE] : []);
    const box = node("section", undefined, "plan-source-box");
    box.append(node("h4", tr("plans.sources", {}, "Sources and what they support")));
    if (!sources.length) box.append(node("p", tr("plans.noEstimateSources", {}, "No source supports a numeric estimate for this selection, so no number is shown."), "plans-status"));
    else {
      const list = node("ul", undefined, "plan-source-list");
      for (const source of sources) {
        const item = node("li");
        const link = node("a", source.title); link.href = source.url; link.target = "_blank"; link.rel = "noreferrer";
        const year = source.publishedYear || source.year;
        const rawUse = source.usedFor.join(" ");
        const searchable = `${source.id || ""} ${source.url} ${rawUse}`.toLowerCase();
        const purposes = [];
        if (usesTranslatedEvidenceCopy()) {
          if (/worldpop|population/.test(searchable)) purposes.push(tr("plans.sourcePopulation", {}, "Modeled population inside the highlighted planning area."));
          if (/price.level|price-level|purchasing.power|local.cost|adjust/.test(searchable)) purposes.push(tr("plans.sourceLocal", {}, "Country price-level data used to adjust the base cost."));
          if (/duration|timeline|schedule|month|completion.time|census-construction-definition|construction (?:type|category)|c30\/definitions/.test(searchable)) purposes.push(tr("plans.sourceTime", {}, "Published duration evidence used for the preliminary estimate."));
          if (/cost|pricing|unit.rate|unit-cost|usd|price guide/.test(searchable)) purposes.push(tr("plans.sourceCost", {}, "Cost benchmark used for the preliminary estimate."));
        }
        const use = purposes.length ? [...new Set(purposes)].join(" ") : rawUse;
        item.append(link, node("span", `${source.publisher}${year ? ` · ${year}` : ""}`), node("span", tr("plans.usedFor", { purpose: use }, `Used for: ${use}`)));
        list.append(item);
      }
      box.append(list);
    }
    const calculations = [formulaText(cost.formula), formulaText(timeline.formula)].filter(Boolean);
    if (calculations.length) {
      const summary = usesTranslatedEvidenceCopy()
        ? tr("plans.calculationSummary", {}, "NeedMap applies the cited asset size or capacity and unit cost, then any cited country adjustment. Values are rounded.")
        : calculations.join(" · ");
      box.append(node("p", `${tr("plans.calculation", {}, "Calculation")}: ${summary}`, "plan-calculation"));
    }
    return box;
  }

  function assumptionsSection(candidate) {
    const assumptions = usesTranslatedEvidenceCopy()
      ? [
        tr("plans.areaNote", { radius: number(candidate.serviceArea.radiusKm, 1) }, `The ${number(candidate.serviceArea.radiusKm, 1)} km radius is a NeedMap planning assumption based on supporting-report distances. It is not a verified service boundary.`),
        tr("plans.assumptionEstimate", { type: typeName(candidate.type) }, `Cost and time are preliminary ranges for a typical ${typeName(candidate.type)}. Local land, detailed site conditions, utilities, permits, taxes, financing, staffing, and operations can change the result.`),
      ]
      : [...new Set([
        candidate.serviceArea.assumption,
        ...(candidate.estimates.cost.assumptions || []),
        ...(candidate.estimates.timeline.assumptions || []),
      ])];
    const section = node("section", undefined, "plan-section");
    section.append(node("h4", tr("plans.assumptions", {}, "Assumptions and limits")));
    const list = node("ul", undefined, "plan-assumptions");
    for (const assumption of assumptions) list.append(node("li", assumption));
    section.append(list);
    return section;
  }

  function fallbackMap(container, geometry, candidate) {
    return renderPlansLocationFallback(container, { geometry, candidate, i18n });
  }

  function candidateCard(candidate) {
    const card = node("article", undefined, "plan-card");
    const header = node("header", undefined, "plan-card-header");
    const title = node("div", undefined, "plan-card-title");
    const heading = node("h3");
    heading.append(icon(candidate.iconKey), document.createTextNode(candidate.locationLabel || candidate.region?.name || tr("map.approximateArea", {}, "Approximate map area")));
    title.append(heading, node("p", `${typeName(candidate.type)} · ${formatCoordinates(candidate.position, number)}`));
    header.append(node("span", String(candidate.rank), "plan-rank"), title);
    const grid = node("div", undefined, "plan-card-grid");
    const mapPanel = node("div", undefined, "plan-map-panel");
    const mapContainer = node("div", undefined, "plan-map");
    mapContainer.setAttribute("role", "region");
    mapContainer.setAttribute("aria-label", tr("plans.mapLabel", { rank: candidate.rank, location: candidate.locationLabel }, `Recommended location ${candidate.rank} and its highlighted planning area`));
    const area = areaByCandidate.get(candidate.id) || makeArea(candidate);
    areaByCandidate.set(candidate.id, area);
    mapPanel.append(mapContainer);
    const legend = node("div", undefined, "plan-map-caption");
    const shade = node("span"); shade.append(node("i", undefined, "plan-area-swatch"), document.createTextNode(tr("plans.areaShading", {}, "Potential service area")));
    const reportsKey = node("span"); reportsKey.append(node("i", undefined, "plan-report-dot"), document.createTextNode(tr("plans.reportLocations", {}, "Supporting report locations")));
    legend.append(shade, reportsKey);
    mapPanel.append(legend, node("p", tr("plans.areaNote", { radius: number(candidate.serviceArea.radiusKm, 1) }, `The ${number(candidate.serviceArea.radiusKm, 1)} km radius is a NeedMap planning assumption based on supporting-report distances. It is not a verified service boundary.`), "plan-map-note"));
    const dataPanel = node("div", undefined, "plan-data-panel");
    const estimates = node("div", undefined, "plan-estimates");
    const cost = candidate.estimates.cost;
    const timeline = candidate.estimates.timeline;
    const costGeography = usesTranslatedEvidenceCopy()
      ? (cost?.specificity === "global" ? tr("plans.globalBenchmark", {}, "global") : region?.label || region?.name || tr("plans.globalBenchmark", {}, "global"))
      : cost?.scope || (cost?.specificity === "global" ? tr("plans.globalBenchmark", {}, "global") : cost?.specificity);
    estimates.append(
      estimateBox(tr("plans.estimatedCost", {}, "Estimated cost"), costText(cost), cost?.status === "estimated"
        ? tr("plans.costDetail", { year: String(cost.priceYear), geography: costGeography }, `${cost.priceYear} · ${costGeography}; assumptions below.`)
        : usesTranslatedEvidenceCopy() ? tr("plans.noSupportedEstimate", {}, "NeedMap does not have enough supporting evidence for a number.") : cost?.reason || tr("plans.noSupportedEstimate", {}, "NeedMap does not have enough supporting evidence for a number.")),
      estimateBox(tr("plans.estimatedTime", {}, "Estimated completion time"), timelineText(timeline), timeline?.status === "estimated"
        ? tr("plans.timeDetail", {}, "Preliminary planning range; local design, permits, procurement and construction can change it.")
        : usesTranslatedEvidenceCopy() ? tr("plans.noSupportedEstimate", {}, "NeedMap does not have enough supporting evidence for a number.") : timeline?.reason || tr("plans.noSupportedEstimate", {}, "NeedMap does not have enough supporting evidence for a number.")),
    );
    const population = populationByCandidate.get(candidate.id);
    dataPanel.append(estimates, populationBox(candidate), reportSection(candidate), assumptionsSection(candidate), sourceBox(candidate, population));
    grid.append(mapPanel, dataPanel); card.append(header, grid);
    if (visible) {
      try {
        const map = createLocationMap?.(mapContainer);
        if (!map) throw new Error("No map was created.");
        map.update({ candidate, geometry: area.geometry, region });
        maps.push(map);
      } catch { fallbackMap(mapContainer, area.geometry, candidate); }
    }
    return card;
  }

  function statusText() {
    if (!model) return "";
    if (model.status === "ready") return tr("plans.statusReady", { count: model.candidates.length }, `${model.candidates.length} report-supported recommended locations.`);
    if (model.reason === "reports-loading") return tr("plans.statusLoading", {}, "Loading community reports…");
    if (model.reason === "reports-unavailable") return tr("plans.statusUnavailable", {}, "Community reports are unavailable, so locations cannot be recommended.");
    if (model.reason === "no-matching-reports") return tr("plans.noMatchingReports", { type: typeName(model.type), region: region?.name }, `No ${typeName(model.type)} reports have been submitted in ${region?.name}.`);
    if (model.reason === "insufficient-reports") return tr("plans.needTwoReports", {}, "At least two usable reports are needed for a report-supported location.");
    if (model.reason === "region-boundary-unavailable") return tr("plans.boundaryLoading", {}, "The region boundary is still loading. NeedMap will update the plan when it is ready.");
    return tr("plans.noCluster", {}, "The reports do not yet support a distinct recommended location.");
  }

  function render() {
    if (destroyed) return;
    destroyMaps();
    const type = selectedType();
    byId("plans-type-icon").innerHTML = serviceIconSvg(PLAN_TYPES[type].iconKey);
    model = buildPlanModel({
      reports,
      reportsAvailable: reportsReady,
      connectionFailed,
      region,
      type,
      estimateEvidence: evidenceFor(type, region),
    });
    byId("plans-scope").textContent = tr("plans.scope", { region: region?.name || "Worldwide", type: typeName(type) }, `${region?.name || "Worldwide"} · ${typeName(type)}`);
    byId("plans-status").textContent = statusText();
    results.replaceChildren();
    if (!model.candidates.length) results.append(node("div", statusText(), "plans-empty"));
    else results.append(...model.candidates.map(candidateCard));
  }

  async function calculatePopulation() {
    if (!visible || !model?.candidates.length) return;
    cancelPopulation();
    const revision = populationRevision;
    const controller = new AbortController(); populationController = controller;
    await Promise.all(model.candidates.map(async (candidate) => {
      populationByCandidate.set(candidate.id, { status: "loading" });
      try {
        const result = await loadPopulation({
          reports: [{ id: candidate.id, ...candidate.position }],
          region,
          radiusMeters: candidate.serviceArea.radiusMeters,
        }, { signal: controller.signal });
        if (destroyed || controller.signal.aborted || revision !== populationRevision) return;
        populationByCandidate.set(candidate.id, result);
      } catch {
        if (destroyed || controller.signal.aborted || revision !== populationRevision) return;
        populationByCandidate.set(candidate.id, { status: "unavailable" });
      }
    }));
    if (!destroyed && visible && revision === populationRevision) render();
  }

  function rebuild({ resetPopulation = false } = {}) {
    if (resetPopulation) { cancelPopulation(); populationByCandidate = new Map(); areaByCandidate = new Map(); }
    render();
    if (visible) calculatePopulation();
  }

  const onType = () => rebuild({ resetPopulation: true });
  typeSelect.addEventListener("change", onType);
  refreshOptions();
  const stopLanguage = i18n?.subscribe(() => {
    refreshOptions();
    if (visible) render();
  }) || (() => {});

  return {
    update(next) {
      const nextRegion = next.region;
      const nextReports = Array.isArray(next.reports) ? next.reports : [];
      const changed = nextRegion?.id !== region?.id || JSON.stringify(nextReports.map((report) => [report.id, report.summary, report.category, report.severity, report.latitude, report.longitude])) !==
        JSON.stringify(reports.map((report) => [report.id, report.summary, report.category, report.severity, report.latitude, report.longitude]));
      region = nextRegion; reports = nextReports; reportsReady = !!next.reportsReady; connectionFailed = !!next.connectionFailed;
      rebuild({ resetPopulation: changed });
    },
    setVisible(value) {
      visible = !!value;
      if (visible) rebuild();
      else { destroyMaps(); cancelPopulation(); }
    },
    get selectedType() { return selectedType(); },
    destroy() {
      if (destroyed) return;
      destroyed = true; destroyMaps(); cancelPopulation(); stopLanguage(); typeSelect.removeEventListener("change", onType);
    },
  };
}

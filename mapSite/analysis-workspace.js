import { ANALYSIS_CATEGORIES, buildAnalysisModel, categoryForReport } from "./analysis-model.js";
import { loadAnalysisEvidence } from "./analysis-evidence.js";
import { serviceIconSvg } from "./service-icons.js";
import { getReportCoordinates } from "./report-location-map.js";
import { loadReportPopulation } from "./report-population.js";
import { createPopulationDetails } from "./population-details.js";
import { buildEvidenceReviewFallback } from "./analysis-ai.js";

/** Shared region/reports come from the map; external work starts only on Analysis. */
export function createAnalysisWorkspace({ document = globalThis.document, i18n, dynamicTranslator, loadEvidence = loadAnalysisEvidence, loadPopulation = loadReportPopulation, reviewComplaints, firebaseApp, createReportMap, createOverviewMap, createPopulationMap, onLoading, onDemonstrationReportsChange } = {}) {
  const byId = (id) => document.getElementById(id);
  const filter = byId("analysis-category");
  const demonstrationToggle = byId("analysis-demo-proposals");
  const tr = (key, values = {}, fallback = key) => i18n ? i18n.t(key, values) : Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), fallback);
  const number = (value, digits = 0) => Number.isFinite(value) ? (i18n ? i18n.number(value, { maximumFractionDigits: digits }) : value.toLocaleString(undefined, { maximumFractionDigits: digits })) : tr("common.unknown", {}, "Unknown");
  const categoryName = (value) => ANALYSIS_CATEGORIES.some((entry) => entry.id === value) ? tr(`category.${value}`, {}, ANALYSIS_CATEGORIES.find((entry) => entry.id === value).label) : value;
  const urgencyName = (value) => ["high", "medium", "low", "unknown"].includes(value) ? tr(`urgency.${value}`, {}, value) : value;
  const dateLabel = (value) => {
    if (value == null || value === "" || typeof value === "boolean") return tr("analysis.submissionUnknown", {}, "Submission date unavailable");
    const date = new Date(typeof value?.seconds === "number" ? value.seconds * 1000 : value);
    return Number.isFinite(date.getTime()) ? (i18n ? i18n.date(date) : date.toLocaleDateString()) : tr("analysis.submissionUnknown", {}, "Submission date unavailable");
  };
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  const bindDynamic = (target, text, sourceLanguage) => dynamicTranslator?.bind
    ? dynamicTranslator.bind(target, text || "", { sourceLanguage })
    : Object.assign(target, { textContent: text || "", dir: "auto" });
  function dynamicTemplate(target, template, marker, text, sourceLanguage = "en") {
    target.replaceChildren();
    const index = template.indexOf(marker);
    if (index < 0) { target.textContent = template.replace(marker, text); return target; }
    target.append(document.createTextNode(template.slice(0, index)));
    target.append(bindDynamic(node("span"), text, sourceLanguage));
    target.append(document.createTextNode(template.slice(index + marker.length)));
    return target;
  }
  const icon = (category) => { const item = node("span", undefined, "service-icon"); item.setAttribute("aria-hidden", "true"); item.innerHTML = serviceIconSvg(category); return item; };
  const evidenceKey = (fact) => fact?.category === "water" ? fact.kind === "affected_population" ? "waterAffected" : fact.kind === "access_gap_percent" ? "waterGap" : "water" : fact?.category === "healthcare" ? "health"
    : fact?.category === "broadband" ? fact.kind === "access_gap_percent" ? "internetGap" : "internet" : fact?.category === "food" ? fact.kind === "affected_population" ? "foodAffected" : "food"
      : fact?.category === "education" ? fact.kind === "affected_population" ? "educationCount" : "educationRate"
        : fact?.category === "all" || fact?.kind === "population" ? "population" : null;
  const factTitle = (fact) => { const key = evidenceKey(fact); return key ? tr(`evidence.${key}Title`, {}, fact.title || fact.label || fact.kind) : fact.title || fact.label || fact.kind; };
  const factDescription = (fact) => { const key = evidenceKey(fact); return key ? tr(`evidence.${key}Description`, {}, fact.description || "") : tr("evidence.genericDescription", {}, "Published measurement for the selected geography. Read its definition and year before using it."); };
  const unitName = (unit) => ({ people: tr("unit.people", {}, "people"), children: tr("unit.children", {}, "children"), "%": tr("unit.percent", {}, "%"), "index points": tr("unit.indexPoints", {}, "index points") })[unit] || unit || "";
  const categoryDefinition = (category) => ANALYSIS_CATEGORIES.find((entry) => entry.id === category);
  const rankingFactor = (ranking, id) => ranking.factors?.find((factor) => factor.id === id);
  function safeSource(source) {
    if (!source || typeof source !== "object") return null;
    try {
      const url = new URL(source.url);
      return url.protocol === "https:" && source.publisher ? { ...source, url: url.href } : null;
    } catch { return null; }
  }
  function appendSourceLinks(target, rawSources, { before = " (", separator = "; ", after = ")" } = {}) {
    const sources = [...new Map((Array.isArray(rawSources) ? rawSources : [])
      .map(safeSource).filter(Boolean).map((source) => [source.id || source.url, source])).values()];
    if (!sources.length) return false;
    target.append(document.createTextNode(before));
    sources.forEach((source, index) => {
      if (index) target.append(document.createTextNode(separator));
      const link = bindDynamic(node("a", undefined, "priority-source-link"), source.publisher, "en");
      link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      const use = source.usedFor || source.uses?.[0];
      if (use) {
        const language = i18n?.code;
        link.title = tr("analysis.sourceUsedFor", { use: dynamicTranslator?.cached?.(use) || use }, `Used for: ${use}`);
        void dynamicTranslator?.translate?.(use, { sourceLanguage: "en" }).then((translated) => {
          if ((!i18n || i18n.code === language) && link.isConnected !== false) {
            link.title = tr("analysis.sourceUsedFor", { use: translated }, `Used for: ${translated}`);
          }
        });
      }
      target.append(link);
    });
    target.append(document.createTextNode(after));
    return true;
  }
  function aiReviewStatus(ranking) {
    if (!reportsReady) return connectionFailed
      ? tr("analysis.aiReviewNoReportsRank", {}, "No community reports were available to check, so AI did not affect the rank.")
      : tr("analysis.aiReviewWaitingRank", {}, "Waiting for community reports; AI does not set the rank.");
    if (!ranking.reports.length && !reviewComplaints) return tr("analysis.aiReviewNoReportsRank", {}, "No community reports were available to check, so AI did not affect the rank.");
    if (aiState === "fallback") return tr("analysis.aiReviewFallbackRank", {}, "NeedMap checked the cited severity, affected-population, and report inputs with its built-in evidence review; no external AI output was used.");
    if (!reviewComplaints || aiState === "unavailable") return tr("analysis.aiReviewUnavailableRank", {}, "Unavailable, so AI did not contribute to the rank.");
    if (aiState !== "ready") return tr("analysis.aiReviewLoadingRank", {}, "Checking exact report excerpts and explicit durations; AI does not set the rank.");
    const priorityReview = reviewResult?.priorityReviews?.find((review) => review.category === ranking.category);
    if (!ranking.reports.length && !priorityReview) return tr("analysis.aiReviewNoReportsRank", {}, "No community reports were available to check, so AI did not affect the rank.");
    const reportIds = new Set(ranking.reports.map((report) => report.id));
    const excerptCount = insights.filter((insight) => reportIds.has(insight.reportId) && insight.quote).length;
    const durationCount = (rankingFactor(ranking, "duration")?.reportEvidence || [])
      .filter((entry) => /^AI-selected\b/.test(entry.provenance || "")).length;
    return tr("analysis.aiReviewReadyRank", {
      reviewed: number(reviewResult?.reviewedCount ?? insights.length), excerpts: number(excerptCount), durations: number(durationCount),
    }, `Checked ${number(reviewResult?.reviewedCount ?? insights.length)} reports overall and verified ${number(excerptCount)} exact excerpts plus ${number(durationCount)} explicit durations used in this rank; AI did not set the rank.`);
  }
  function appendPriorityExplanation(detail, ranking) {
    const reason = node("section", undefined, "priority-reason");
    reason.append(node("h4", `${tr("analysis.aiReviewTitle", {}, "AI review")}: ${tr("analysis.rankReasonTitle", {}, "Why it ranks here")}`));
    const definition = categoryDefinition(ranking.category);
    const severity = rankingFactor(ranking, "severity");
    const highUrgency = ranking.reports.filter((report) => report.severity === "high").length;
    const rationale = tr(`analysis.rationale.${ranking.category}`, {}, definition?.rationale || "The problem needs more context").trim().replace(/[.!?。؟]+$/u, "");
    const affected = [...(ranking.indicators || [])]
      .filter((indicator) => indicator.kind === "affected_population")
      .sort((left, right) => Number(right.year || 0) - Number(left.year || 0))[0];
    const explanation = node("p");
    if (ranking.rank === null) {
      explanation.textContent = tr("analysis.rankReasonUnranked", { rationale }, `Not ranked: ${rationale}, but no community report or region-specific published measurement supports this problem for the exact region.`);
      appendSourceLinks(explanation, severity?.sources);
    } else {
      const values = { rank: ranking.rank, rationale, high: number(highUrgency), reports: number(ranking.reportCount) };
      const marker = "\u0000RANK_RATIONALE\u0000";
      const markedValues = { ...values, rationale: marker };
      const lead = !reportsReady
        ? connectionFailed
          ? tr("analysis.rankReasonReportsUnavailableLead", markedValues, `Rank #${ranking.rank}: ${marker}; community-report urgency is unavailable, and`)
          : tr("analysis.rankReasonReportsLoadingLead", markedValues, `Rank #${ranking.rank}: ${marker}; community reports are still loading, and`)
        : ranking.reportCount > 0
          ? tr("analysis.rankReasonRankedLead", markedValues, `Rank #${ranking.rank}: ${marker}; ${number(highUrgency)} of ${number(ranking.reportCount)} reports were high urgency, and`)
          : tr("analysis.rankReasonNoReportsLead", markedValues, `Rank #${ranking.rank}: ${marker}; no community report added an urgency signal, and`);
      const markerIndex = lead.indexOf(marker);
      if (markerIndex < 0) {
        explanation.append(document.createTextNode(`${lead} `));
      } else {
        explanation.append(document.createTextNode(lead.slice(0, markerIndex)), document.createTextNode(rationale));
        appendSourceLinks(explanation, severity?.sources);
        explanation.append(document.createTextNode(`${lead.slice(markerIndex + marker.length)} `));
      }
      if (!affected) {
        explanation.append(document.createTextNode(evidenceState === "idle" || evidenceState === "loading"
          ? tr("analysis.rankReasonPopulationLoading", {}, "population evidence is still loading.")
          : tr("analysis.rankReasonPopulationUnavailable", {}, "no exact-region population input was available, so NeedMap did not guess; severity therefore carried more weight and the order is provisional.")));
      } else {
        const placeSource = affected.scope?.name || region.label || region.name;
        void dynamicTranslator?.translate?.(placeSource, { sourceLanguage: "en" });
        const place = dynamicTranslator?.cached?.(placeSource) || placeSource;
        explanation.append(document.createTextNode(`${tr("analysis.rankReasonPopulation", {
          title: factTitle(affected), population: number(affected.value), unit: unitName(affected.unit), place, year: affected.year,
        }, `severity weighs slightly more than ${factTitle(affected)}: ${number(affected.value)} ${unitName(affected.unit)} in ${place} (`)}`));
        appendSourceLinks(explanation, [affected.source, ...(Array.isArray(affected.sources) ? affected.sources : [])], { before: "", after: "" });
        explanation.append(document.createTextNode(tr("analysis.rankReasonPopulationLimitation", { year: affected.year }, `, ${affected.year}; published input, not a confirmed count from reports).`)));
      }
    }
    const review = node("p", undefined, "priority-ai-line");
    review.append(node("strong", `${tr("analysis.aiReviewTitle", {}, "AI review")}:`), document.createTextNode(` ${aiReviewStatus(ranking)}`));
    reason.append(explanation, review);
    detail.append(reason);
  }
  function priorityContextsForAI() {
    if (!region || !reportsReady || evidenceState === "idle" || evidenceState === "loading") return [];
    const model = buildAnalysisModel({ reports, region, evidence, category: "all", reportsAvailable: reportsReady });
    return model.rankings.filter((ranking) => Number.isInteger(ranking.rank)).map((ranking) => {
      const definition = categoryDefinition(ranking.category);
      const severity = rankingFactor(ranking, "severity");
      const populationFactor = rankingFactor(ranking, "affected_population");
      const affected = [...(ranking.indicators || [])]
        .filter((indicator) => indicator.kind === "affected_population")
        .sort((left, right) => Number(right.year || 0) - Number(left.year || 0))[0];
      return {
        category: ranking.category, rank: ranking.rank,
        severity: { rationale: definition?.rationale || "", weight: severity?.weight, sources: severity?.sources || [] },
        affectedPopulation: affected ? {
          title: affected.title || affected.kind, value: affected.value, unit: affected.unit, year: affected.year,
          weight: populationFactor?.weight, sources: populationFactor?.sources || [],
        } : { weight: populationFactor?.weight, sources: [] },
      };
    });
  }
  function refreshFilterOptions() {
    const selected = filter.value || "all";
    const option = (label, value) => { const item = node("option", label); item.setAttribute("value", value); return item; };
    const options = [option(tr("category.all", {}, "All Problems"), "all"),
      ...ANALYSIS_CATEGORIES.map((category) => option(categoryName(category.id), category.id))];
    const chosen = selected === "all" || ANALYSIS_CATEGORIES.some((item) => item.id === selected) ? selected : "all";
    options.find((item) => item.getAttribute("value") === chosen)?.setAttribute("selected", "");
    filter.replaceChildren(...options);
  }
  refreshFilterOptions();
  let region = null, reports = [], recommendations = [], reportsReady = false, connectionFailed = false, recommendationState = "ready";
  let includeDemonstrationReports = false;
  function refreshDemonstrationControl() {
    if (demonstrationToggle) demonstrationToggle.checked = includeDemonstrationReports;
    const label = byId("analysis-demo-proposals-label");
    if (label) label.textContent = tr("candidate.includeDemonstrations", {}, "Show all proposed services");
  }
  refreshDemonstrationControl();
  let overviewMap = null, overviewKey = "", populationDetails, pendingFocus;
  let visible = false, destroyed = false, evidence = null, evidenceState = "idle", evidenceRevision = 0, evidenceController;
  let insights = [], aiState = "idle", aiRevision = 0, aiController, aiTimer, reportKey = "", reviewResult = null;
  let population = null, populationState = "idle", populationKey = "", populationGeometry, populationRevision = 0, populationController;
  let releaseEvidence, releaseAI, releasePopulation;
  let reportMapGroups = [];
  const loadingTarget = (key) => ({
    "analysis-evidence": byId("analysis-status"),
    "analysis-ai": byId("analysis-ai-status"),
    "analysis-population": byId("analysis-population"),
  })[key];
  const beginLoading = (key, label) => onLoading?.({
    key,
    label,
    target: loadingTarget(key),
    appearance: "status",
  }) || (() => {});
  const release = (name) => {
    const current = name === "evidence" ? releaseEvidence : name === "ai" ? releaseAI : releasePopulation;
    if (name === "evidence") releaseEvidence = undefined;
    else if (name === "ai") releaseAI = undefined;
    else releasePopulation = undefined;
    current?.();
  };
  function clearReportMaps() {
    for (const dispose of reportMapGroups) dispose();
    reportMapGroups = [];
  }
  function attachReportMaps(row, entries) {
    if (!entries.length) return;
    const maps = new Map();
    let observer, active = false, disposed = false, generation = 0;
    function stop() {
      active = false; generation++; observer?.disconnect(); observer = null;
      for (const map of maps.values()) map.destroy();
      maps.clear();
    }
    function mount(entry) {
      if (!active || disposed || !visible || destroyed || !row.open || !row.isConnected || maps.has(entry.container)) return;
      entry.container.replaceChildren();
      try {
        maps.set(entry.container, createReportMap(entry.container, entry.report));
      } catch {
        entry.container.append(node("span", tr("analysis.mapUnavailable", {}, "Map unavailable"), "analysis-map-placeholder"));
      }
    }
    function sync() {
      if (!visible || !row.open || destroyed || disposed) { stop(); return; }
      if (active) return;
      active = true;
      const currentGeneration = ++generation;
      const Observer = document.defaultView?.IntersectionObserver;
      if (Observer) {
        const byContainer = new Map(entries.map((entry) => [entry.container, entry]));
        observer = new Observer((changes) => {
          if (currentGeneration !== generation) return;
          for (const change of changes) {
            if (!change.isIntersecting) continue;
            const entry = byContainer.get(change.target);
            if (entry) mount(entry);
            observer?.unobserve(change.target);
          }
        }, { rootMargin: "80px" });
        for (const entry of entries) observer.observe(entry.container);
      } else {
        for (const entry of entries) mount(entry);
      }
    }
    row.addEventListener("toggle", sync);
    reportMapGroups.push(() => { disposed = true; row.removeEventListener("toggle", sync); stop(); });
    sync();
  }
  function metric(label, value, detail, category, tag = "div") {
    const item = node(tag, undefined, `analysis-metric${typeof value === "string" && value.length > 9 ? " word-metric" : ""}`);
    const strong = node("strong");
    if (category) strong.append(icon(category));
    strong.append(node("span", value));
    item.append(node("span", label, "metric-label"), strong, node("span", detail, "metric-description"));
    return item;
  }
  function populationScope() {
    const selected = filter.value || "all";
    return reports.filter((report) => selected === "all" || categoryForReport(report) === selected);
  }
  function populationContext() {
    const selected = filter.value || "all";
    return {
      population: population || { status: populationState === "loading" || populationState === "idle" ? "loading" : "unavailable" },
      reports: populationScope(), region, category: selected === "all" ? tr("category.all", {}, "All Problems") : categoryName(selected),
    };
  }
  function openPopulationDetails() {
    if (!visible || destroyed) return;
    populationDetails ||= createPopulationDetails({ document, createMap: createPopulationMap, i18n, dynamicTranslator });
    populationDetails.open(populationContext());
  }
  function clearOverviewMap() {
    overviewMap?.destroy(); overviewMap = null; overviewKey = "";
  }
  function renderOverviewMap(model) {
    const container = byId("analysis-overview-map"), note = byId("analysis-map-note");
    if (!container || !createOverviewMap) return;
    const scopedReports = model.rankings.flatMap((ranking) => ranking.reports.map((report) => ({ ...report, category: ranking.category })));
    const scopedRecommendations = recommendations.map((item) => ({ ...item, category: categoryForReport(item) }))
      .filter((item) => model.category === "all" || item.category === model.category);
    const key = JSON.stringify([region.id, region.geometry, model.category, reportsReady, connectionFailed, recommendationState, includeDemonstrationReports, scopedReports, scopedRecommendations]);
    if (key === overviewKey) return;
    try {
      overviewMap ||= createOverviewMap(container);
      overviewMap.update({ region, category: model.category, reports: scopedReports, recommendations: scopedRecommendations, reportsReady });
      overviewKey = key;
      if (note) note.textContent = !reportsReady ? tr("analysis.waitingLocations", {}, "Waiting for report locations…") : tr("analysis.mapCounts", {
        reports: `${number(scopedReports.length)} ${tr(scopedReports.length === 1 ? "common.report" : "common.reports", {}, scopedReports.length === 1 ? "report" : "reports")}`,
        services: `${number(scopedRecommendations.length)} ${tr(scopedRecommendations.length === 1 ? "common.location" : "common.locations", {}, scopedRecommendations.length === 1 ? "proposed service location" : "proposed service locations")}`,
        last: connectionFailed ? tr("analysis.lastLoaded", {}, " · Last loaded reports") : "",
      }, `${number(scopedReports.length)} reports · ${number(scopedRecommendations.length)} proposed service locations. Hover for details; click to keep them open.`);
      if (note && reportsReady && recommendationState === "loading") {
        note.textContent += ` ${tr("candidate.worldLoading", {}, "Loading additional regional analyses…")}`;
      } else if (note && reportsReady && recommendationState === "partial") {
        note.textContent += ` ${tr("candidate.worldPartial", {}, "Some regional analyses could not be loaded. Available proposals are shown.")}`;
      } else if (note && reportsReady && scopedReports.length && !scopedRecommendations.length) {
        note.textContent += ` ${includeDemonstrationReports
          ? tr("plans.noCluster", {}, "The reports do not yet support a distinct recommended location.")
          : tr("candidate.needReports", {}, "Proposed services need at least two reports in the same region and category.")}`;
      }
    } catch {
      clearOverviewMap();
      if (note) note.textContent = tr("analysis.mapFailed", {}, "The map could not be loaded. Reports are still available below.");
    }
  }
  function populationMetric() {
    let value = tr("population.unavailable", {}, "Unavailable"), detail = tr("population.failed", {}, "Population data could not be loaded for these report locations.");
    if (!reportsReady) { value = tr("population.unknown", {}, "Unknown"); detail = tr("population.waiting", {}, "Waiting for reports and their locations"); }
    else if (populationState === "idle" || populationState === "loading") { value = tr("population.loading", {}, "Loading…"); detail = tr("population.loadingDetail", {}, "Estimating residents within 500 m of the selected reports"); }
    else if (population?.status === "empty") { value = tr("population.noReports", {}, "No reports"); detail = tr("population.noLocations", {}, "No report locations to estimate in this selection"); }
    else if (population?.status === "ready" && Number.isFinite(population.value) && population.value >= 0) {
      value = tr("population.about", { count: Number(population.value.toPrecision(2)) }, `About ${number(Number(population.value.toPrecision(2)))}`);
      detail = tr("population.nearDetail", { count: population.reportCount, year: population.year }, `Within 500 m of ${number(population.reportCount)} ${population.reportCount === 1 ? "report" : "reports"} · WorldPop ${population.year}. Overlapping areas counted once. This estimates nearby residents, not confirmed people affected.`);
      if (connectionFailed) detail += tr("population.lastLoaded", {}, " Based on the last loaded reports.");
    }
    const result = metric(tr("population.metric", {}, "Estimated residents near reports"), value, detail, undefined, "button");
    result.type = "button";
    result.classList.add("analysis-population-button");
    result.id = "analysis-population";
    result.setAttribute("aria-haspopup", "dialog");
    const liveValue = result.querySelector("strong");
    liveValue?.setAttribute("role", "status");
    liveValue?.setAttribute("aria-live", "polite");
    liveValue?.setAttribute("aria-atomic", "true");
    const loadingSlot = node("span", undefined, "context-loading-slot metric-loading-slot");
    loadingSlot.dataset.loadingFor = result.id;
    loadingSlot.setAttribute("aria-hidden", "true");
    result.append(loadingSlot, node("span", tr("population.how", {}, "See how this was calculated →"), "metric-detail-hint"));
    result.addEventListener("click", openPopulationDetails);
    return result;
  }
  function renderPopulation() {
    if (visible && !destroyed) {
      byId("analysis-population")?.replaceWith(populationMetric());
      populationDetails?.update(populationContext());
    }
  }
  function cancelPopulation() {
    ++populationRevision; populationController?.abort(); populationController = null;
    release("population");
    if (populationState === "loading") populationState = "idle";
  }
  function bindPopulationLoading() {
    if (populationState !== "loading" || !populationController || populationController.signal.aborted || !visible || destroyed) return;
    release("population");
    releasePopulation = beginLoading("analysis-population", tr("population.loadingDetail", {}, "Estimating residents near reports…"));
  }
  function cancelEvidence() {
    if (evidenceState !== "loading") return;
    ++evidenceRevision; evidenceController?.abort(); evidenceController = undefined;
    release("evidence"); evidenceState = "idle";
  }
  function cancelAI() {
    if (aiState !== "loading") return;
    ++aiRevision; aiController?.abort(); aiController = undefined;
    clearTimeout(aiTimer); aiTimer = undefined;
    release("ai"); aiState = "idle";
  }
  async function ensurePopulation({ deferLoadingBind = false } = {}) {
    if (!visible || !region || destroyed) return;
    const selected = filter.value || "all";
    const scoped = reports.filter((report) => selected === "all" || categoryForReport(report) === selected);
    const key = JSON.stringify([region.id, selected, reportsReady, scoped.map((report) => [report.id, report.latitude, report.longitude])]);
    if (key !== populationKey || populationGeometry !== region.geometry) {
      populationDetails?.close();
      cancelPopulation(); populationKey = key; populationGeometry = region.geometry;
      population = null; populationState = "idle";
    }
    if (!reportsReady) { renderPopulation(); return; }
    if (populationState !== "idle") return;
    if (!scoped.length) {
      population = { status: "empty" }; populationState = "ready"; renderPopulation(); return;
    }
    const revision = ++populationRevision;
    populationController = new AbortController(); populationState = "loading"; renderPopulation();
    if (!deferLoadingBind) bindPopulationLoading();
    try {
      const result = await loadPopulation({ reports: scoped, region }, { signal: populationController.signal });
      if (destroyed || revision !== populationRevision) return;
      population = result; populationState = result.status === "unavailable" ? "unavailable" : "ready";
    } catch {
      if (destroyed || revision !== populationRevision) return;
      population = null; populationState = "unavailable";
    } finally {
      if (revision === populationRevision) release("population");
    }
    renderPopulation();
  }
  function renderReportChart(model) {
    const chart = byId("analysis-report-chart"), note = byId("report-chart-note");
    chart.replaceChildren(); note.replaceChildren();
    if (!reportsReady) {
      chart.append(node("p", connectionFailed ? tr("analysis.reportsFailed", {}, "Reports could not be loaded, so a comparison is not available.") : tr("analysis.loadingReports", {}, "Loading reports…"), "analysis-note"));
      return;
    }
    const entries = model.rankings.filter((item) => Number.isFinite(item.reportCount) && item.reportCount > 0)
      .sort((first, second) => second.reportCount - first.reportCount || first.label.localeCompare(second.label));
    if (!entries.length) {
      chart.append(node("p", model.category === "all" ? tr("analysis.noRegionReports", {}, "No reports have been submitted in this region.") : tr("analysis.noProblemReports", {}, "No reports match this problem in the selected region."), "analysis-note"));
    } else {
      const maximum = entries[0].reportCount;
      const axis = node("div", undefined, "report-chart-axis"); axis.setAttribute("aria-hidden", "true");
      axis.append(node("span", "0"), node("span", tr("analysis.chartMax", { count: maximum }, `${number(maximum)} ${maximum === 1 ? "report" : "reports"}`)));
      const list = node("ul", undefined, "report-chart-list");
      for (const entry of entries) {
        const row = node("li", undefined, "report-chart-row"); row.dataset.category = entry.category;
        const name = node("span", undefined, "report-chart-label"); name.append(icon(entry.category), node("span", categoryName(entry.category)));
        const track = node("span", undefined, "report-chart-track"); track.setAttribute("aria-hidden", "true");
        const bar = node("span", undefined, "report-chart-bar"); bar.style.width = `${entry.reportCount / maximum * 100}%`; track.append(bar);
        row.append(name, track, node("span", tr("analysis.chartMax", { count: entry.reportCount }, `${number(entry.reportCount)} ${entry.reportCount === 1 ? "report" : "reports"}`), "report-chart-count"));
        list.append(row);
      }
      chart.append(axis, list);
    }
    const regionMarker = "\u0000REGION\u0000";
    dynamicTemplate(note, tr("analysis.chartNote", { region: regionMarker }, `Reports submitted in ${regionMarker}. Open a problem below to read its reports.`), regionMarker, region.label || region.name);
    if (connectionFailed) note.append(document.createTextNode(tr("analysis.lastLoaded", {}, " Showing the last loaded reports while the connection is unavailable.")));
  }
  function render() {
    if (!region || !visible || destroyed) return;
    const selectedCategory = filter.value || "all";
    const model = buildAnalysisModel({ reports, region, evidence, category: selectedCategory, complaintInsights: insights, reportsAvailable: reportsReady });
    const overview = model.overview;
    renderOverviewMap(model);
    renderReportChart(model);
    const scopeRegionMarker = "\u0000REGION\u0000";
    dynamicTemplate(byId("analysis-scope"), tr("analysis.scope", { region: scopeRegionMarker, category: selectedCategory === "all" ? tr("category.all", {}, "All Problems") : categoryName(selectedCategory) }, `${scopeRegionMarker} · ${selectedCategory === "all" ? "All Problems" : categoryName(selectedCategory)}`), scopeRegionMarker, region.label || region.name);
    byId("analysis-category-icon").innerHTML = serviceIconSvg(selectedCategory);
    byId("analysis-status").textContent = !reportsReady ? connectionFailed ? tr("analysis.statusReportsFailed", {}, "Community reports could not be loaded. Public statistics are shown where available.") : tr("analysis.statusLoading", {}, "Loading community reports…")
      : connectionFailed ? tr("analysis.statusConnection", {}, "The report connection is unavailable. Counts may be out of date.")
      : evidenceState === "loading" ? tr("analysis.statusStatsLoading", {}, "Reports loaded · looking up published statistics…")
      : evidenceState === "unavailable" ? tr("analysis.statusStatsUnavailable", {}, "Reports loaded · published statistics are currently unavailable.")
      : evidence?.status === "partial" ? tr("analysis.statusStatsPartial", {}, "Reports loaded · some published statistics are unavailable.")
      : tr("analysis.statusReady", {}, "Showing available reports and published evidence.");
    const common = overview.mostCommonProblem;
    const metrics = byId("analysis-overview");
    metrics.replaceChildren(
      metric(tr("analysis.totalReports", {}, "Total reports"), reportsReady ? number(overview.totalReports) : tr("common.unknown", {}, "Unknown"), reportsReady ? tr("analysis.totalReportsDetail", {}, "In this region and problem filter") : tr("analysis.waitingConnection", {}, "Waiting for the report connection")),
      metric(tr("analysis.mostReported", {}, "Most reported problem"), reportsReady && common ? categoryName(common.category) : reportsReady ? tr("analysis.noReports", {}, "No reports") : tr("common.unknown", {}, "Unknown"), common ? `${number(common.count)} ${tr("common.reports", {}, "reports")}${common.tied?.length > 1 ? ` · ${tr("analysis.tied", { count: common.count }, "tied for most reported")}` : ""}` : tr("analysis.basedOnReports", {}, "Based on reports in the selected filter"), common?.category),
      populationMetric()
    );
    byId("analysis-data-note").textContent = "";
    const expanded = new Set([...byId("analysis-rankings").querySelectorAll("details[open]")].map((row) => row.dataset.category));
    clearReportMaps();
    const rows = [];
    const mapGroups = [];
    for (const ranking of model.rankings) {
      const row = node("details", undefined, "priority-row"); row.dataset.category = ranking.category;
      row.open = expanded.has(ranking.category);
      const summary = node("summary");
      const name = node("span", undefined, "priority-name");
      const heading = node("strong", undefined, "service-heading"); heading.append(icon(ranking.category), node("span", categoryName(ranking.category)));
      name.append(heading, node("small", `${tr("analysis.reportCount", { count: reportsReady ? ranking.reportCount : tr("common.unknown", {}, "Unknown") }, `${reportsReady ? number(ranking.reportCount) : "Unknown"} reports`)}${ranking.rank === null ? tr("analysis.notRanked", {}, " · Not ranked: no evidence for this exact region") : ""}`));
      summary.append(node("span", ranking.rank === null ? "—" : String(ranking.rank), "priority-rank"), name);
      const detail = node("div", undefined, "priority-detail");
      appendPriorityExplanation(detail, ranking);
      const facts = [...(ranking.indicators || []), ...(ranking.contextIndicators || [])]
        .filter((fact) => !["access_index", "access_gap_index"].includes(fact.kind));
      if (facts.length) {
        detail.append(node("h4", tr("analysis.publishedData", {}, "Published data")));
        for (const fact of facts) {
          const paragraph = node("p", undefined, "evidence-fact");
          paragraph.append(node("strong", tr("analysis.fact", { title: factTitle(fact), value: number(fact.value, 2), unit: unitName(fact.unit) }, `${factTitle(fact)}: ${number(fact.value, 2)} ${unitName(fact.unit)}`)), document.createTextNode(` · ${fact.year} · ${fact.scope?.name || fact.scope?.regionId || tr("analysis.unknownGeography", {}, "Unknown geography")}. ${factDescription(fact)} ${ranking.contextIndicators.includes(fact) ? tr("analysis.contextOnly", {}, "Context only; not used in this region’s ranking.") : ""}`));
          detail.append(paragraph);
        }
      }
      detail.append(node("h4", tr("analysis.reportsBehind", { count: reportsReady ? ranking.reports.length : tr("common.unknown", {}, "unknown") }, `Reports behind this problem (${reportsReady ? ranking.reports.length : "unknown"})`)));
      if (!ranking.reports.length) detail.append(node("p", reportsReady ? tr("analysis.noCommunityReports", {}, "No community reports for this problem in the selected region.") : tr("analysis.reportsNotLoaded", {}, "Reports have not loaded."), "analysis-note"));
      const list = node("ol", undefined, "analysis-report-list");
      const mapEntries = [];
      for (const report of ranking.reports) {
        const item = node("li", undefined, "analysis-report");
        item.dataset.reportId = report.id;
        item.tabIndex = -1;
        const copy = node("div", undefined, "analysis-report-copy");
        const reportText = bindDynamic(node("p"), report.summary || tr("explore.noDescription", {}, "No description provided."), report.summary ? report.language || report.locale : i18n?.code);
        copy.append(reportText, node("small", tr("analysis.reportMeta", { urgency: urgencyName(report.severity || "unknown"), date: dateLabel(report.submittedAt), demo: "" }, `${report.severity || "Unknown"} reported urgency · ${dateLabel(report.submittedAt)}`)));
        const insight = insights.find((entry) => entry.reportId === report.id);
        if (insight?.quote) {
          const quote = node("blockquote");
          const quoteMarker = "\u0000QUOTE\u0000";
          dynamicTemplate(quote, tr("analysis.aiExcerpt", { quote: quoteMarker }, `AI-selected supporting excerpt: “${quoteMarker}”`), quoteMarker, insight.quote, report.language || report.locale);
          copy.append(quote);
        }
        item.append(copy);
        if (getReportCoordinates(report)) {
          item.classList.add("has-location-map");
          const figure = node("figure", undefined, "analysis-report-location");
          const container = node("div", undefined, "analysis-report-map");
          container.setAttribute("role", "region");
          container.setAttribute("aria-label", tr("analysis.reportMapLabel", { category: categoryName(ranking.category) }, `Map showing the approximate reported location for ${categoryName(ranking.category)}`));
          container.append(node("span", tr("analysis.loadingMap", {}, "Loading map…"), "analysis-map-placeholder"));
          figure.append(container, node("figcaption", tr("analysis.reportLocation", {}, "Approximate reported location")));
          item.append(figure); mapEntries.push({ container, report: { ...report, category: ranking.category } });
        } else {
          copy.append(node("p", tr("analysis.reportLocationUnavailable", {}, "Report location unavailable"), "analysis-map-unavailable"));
        }
        list.append(item);
      }
      detail.append(list); row.append(summary, detail); rows.push(row);
      mapGroups.push({ row, entries: mapEntries });
    }
    byId("analysis-rankings").replaceChildren(...(rows.length ? rows : [node("p", tr("analysis.noEvidence", {}, "No report or published problem evidence is available for this selection. A rank would not be supported."), "analysis-empty")]));
    for (const { row, entries } of mapGroups) attachReportMaps(row, entries);
    if (pendingFocus) {
      const row = [...byId("analysis-rankings").querySelectorAll("details[data-category]")]
        .find((item) => item.dataset.category === pendingFocus.category);
      const report = row && [...row.querySelectorAll("[data-report-id]")]
        .find((item) => item.dataset.reportId === pendingFocus.reportId);
      if (report) {
        row.open = true;
        pendingFocus = undefined;
        const schedule = document.defaultView?.requestAnimationFrame || ((callback) => callback());
        schedule(() => {
          report.scrollIntoView?.({ block: "center" });
          report.focus({ preventScroll: true });
        });
      }
    }
    byId("analysis-ai-status").textContent = aiState === "loading" ? tr("analysis.aiLoading", {}, "AI is reviewing the report text for supporting excerpts and explicitly stated duration…")
      : aiState === "ready" ? tr("analysis.aiReady", { reviewed: reviewResult?.reviewedCount ?? insights.length, total: reports.length }, `AI reviewed ${number(reviewResult?.reviewedCount ?? insights.length)} of ${number(reports.length)} reports. Excerpts are checked against the original text.`)
      : aiState === "fallback" ? tr("analysis.aiFallback", {}, "NeedMap completed the review from the cited evidence using its built-in fallback; no external AI output was used.")
      : aiState === "unavailable" ? tr("analysis.aiUnavailable", {}, "AI review is unavailable. Reports and available statistics are still shown.")
      : "";
    bindPopulationLoading();
  }
  async function ensureEvidence() {
    if (!visible || !region || evidenceState !== "idle" || destroyed) return;
    const revision = ++evidenceRevision; evidenceController = new AbortController(); evidenceState = "loading"; render();
    const stopLoading = beginLoading("analysis-evidence", tr("analysis.statusStatsLoading", {}, "Looking up published statistics…"));
    releaseEvidence = stopLoading;
    try {
      const result = await loadEvidence(region, { signal: evidenceController.signal });
      if (destroyed || revision !== evidenceRevision) return;
      evidence = result; evidenceState = result.status === "unavailable" ? "unavailable" : "ready";
    } catch { if (destroyed || revision !== evidenceRevision) return; evidenceState = "unavailable"; }
    finally {
      stopLoading();
      if (releaseEvidence === stopLoading) releaseEvidence = undefined;
    }
    render();
    ensureAI();
  }
  function ensureAI() {
    if (!visible || !reportsReady || !reviewComplaints || aiState !== "idle" || destroyed || evidenceState === "idle" || evidenceState === "loading") return;
    const priorityContexts = priorityContextsForAI();
    if (!reports.length && !priorityContexts.length) return;
    const revision = ++aiRevision; aiController = new AbortController(); const signal = aiController.signal;
    aiState = "loading"; render();
    const stopLoading = beginLoading("analysis-ai", tr("analysis.aiLoading", {}, "AI is reviewing report text…"));
    releaseAI = stopLoading;
    aiTimer = setTimeout(async () => {
      try {
        const result = await reviewComplaints(firebaseApp, reports, { signal, priorityContexts });
        if (destroyed || revision !== aiRevision) return;
        reviewResult = result; insights = Array.isArray(result) ? result : result.insights || []; aiState = "ready";
      } catch (error) {
        if (destroyed || revision !== aiRevision) return;
        if (signal.aborted || error?.name === "AbortError") return;
        reviewResult = buildEvidenceReviewFallback(reports, { priorityContexts });
        insights = [];
        aiState = "fallback";
      }
      finally {
        stopLoading();
        if (releaseAI === stopLoading) releaseAI = undefined;
      }
      render();
    }, 600);
  }
  function update(next) {
    const changedRegion = next.region.id !== region?.id;
    if (changedRegion) {
      cancelEvidence(); evidence = null; evidenceState = "idle";
      clearReportMaps();
      byId("analysis-rankings").replaceChildren();
    }
    region = next.region; reports = next.reports; recommendations = next.recommendations || []; reportsReady = next.reportsReady; connectionFailed = !!next.connectionFailed;
    recommendationState = next.recommendationState || "ready";
    includeDemonstrationReports = next.includeDemonstrationReports === true;
    refreshDemonstrationControl();
    const key = JSON.stringify(reports.map((report) => [report.id, report.summary, report.category, report.severity, report.submittedAt]));
    if (changedRegion || key !== reportKey) {
      reportKey = key; cancelAI(); insights = []; reviewResult = null; aiState = "idle";
    }
    ensurePopulation({ deferLoadingBind: true }); render(); ensureEvidence(); ensureAI();
  }
  const onFilter = () => { clearReportMaps(); byId("analysis-rankings").replaceChildren(); ensurePopulation({ deferLoadingBind: true }); render(); };
  filter.addEventListener("change", onFilter);
  const onDemonstrationChange = () => {
    includeDemonstrationReports = demonstrationToggle.checked === true;
    onDemonstrationReportsChange?.(includeDemonstrationReports);
    render();
  };
  demonstrationToggle?.addEventListener("change", onDemonstrationChange);
  const stopLanguage = i18n?.subscribe(() => {
    refreshFilterOptions(); refreshDemonstrationControl(); overviewKey = ""; clearReportMaps();
    if (visible) { render(); populationDetails?.update(populationContext()); }
  }) || (() => {});
  function focusReport(category, reportId) {
    if (!ANALYSIS_CATEGORIES.some((item) => item.id === category) ||
        typeof reportId !== "string" || !reportId || reportId.length > 200) return false;
    pendingFocus = { category, reportId };
    for (const option of filter.options) option.removeAttribute("selected");
    [...filter.options].find((option) => option.value === category)?.setAttribute("selected", "");
    onFilter();
    return true;
  }
  return { update, focusReport, setVisible(value) { visible = value; if (value) { render(); ensurePopulation(); ensureEvidence(); ensureAI(); } else { clearReportMaps(); clearOverviewMap(); populationDetails?.close(); cancelPopulation(); cancelEvidence(); cancelAI(); } }, destroy() { destroyed = true; stopLanguage(); clearReportMaps(); clearOverviewMap(); populationDetails?.destroy(); cancelPopulation(); cancelEvidence(); cancelAI(); filter.removeEventListener("change", onFilter); demonstrationToggle?.removeEventListener("change", onDemonstrationChange); } };
}

import { ANALYSIS_CATEGORIES, buildAnalysisModel, categoryForReport } from "./analysis-model.js";
import { loadAnalysisEvidence } from "./analysis-evidence.js";
import { serviceIconSvg } from "./service-icons.js";
import { getReportCoordinates } from "./report-location-map.js";
import { loadReportPopulation } from "./report-population.js";

const number = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "Unknown";
const categoryName = (value) => ANALYSIS_CATEGORIES.find((entry) => entry.id === value)?.label || value;
const dateLabel = (value) => {
  if (value == null || value === "" || typeof value === "boolean") return "Submission date unavailable";
  const date = new Date(typeof value?.seconds === "number" ? value.seconds * 1000 : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : "Submission date unavailable";
};

/** Shared region/reports come from the map; external work starts only on Analysis. */
export function createAnalysisWorkspace({ document = globalThis.document, loadEvidence = loadAnalysisEvidence, loadPopulation = loadReportPopulation, reviewComplaints, firebaseApp, createReportMap } = {}) {
  const byId = (id) => document.getElementById(id);
  const filter = byId("analysis-category");
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  const icon = (category) => { const item = node("span", undefined, "service-icon"); item.setAttribute("aria-hidden", "true"); item.innerHTML = serviceIconSvg(category); return item; };
  for (const category of ANALYSIS_CATEGORIES) { const option = node("option", category.label); option.value = category.id; filter.append(option); }
  let region = null, reports = [], reportsReady = false, connectionFailed = false;
  let visible = false, destroyed = false, evidence = null, evidenceState = "idle", evidenceRevision = 0, evidenceController;
  let insights = [], aiState = "idle", aiRevision = 0, aiController, aiTimer, reportKey = "", reviewResult = null;
  let population = null, populationState = "idle", populationKey = "", populationGeometry, populationRevision = 0, populationController;
  let reportMapGroups = [];
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
        entry.container.append(node("span", "Map unavailable", "analysis-map-placeholder"));
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
  function metric(label, value, detail, category) {
    const item = node("div", undefined, `analysis-metric${typeof value === "string" && value.length > 9 ? " word-metric" : ""}`);
    const strong = node("strong");
    if (category) strong.append(icon(category));
    strong.append(node("span", value));
    item.append(node("span", label, "metric-label"), strong, node("span", detail, "metric-description"));
    return item;
  }
  function populationMetric() {
    let value = "Unavailable", detail = "Population data could not be loaded for these report locations.";
    if (!reportsReady) { value = "Unknown"; detail = "Waiting for reports and their locations"; }
    else if (populationState === "idle" || populationState === "loading") { value = "Loading…"; detail = "Estimating residents within 500 m of the selected reports"; }
    else if (population?.status === "empty") { value = "No reports"; detail = "No report locations to estimate in this selection"; }
    else if (population?.status === "ready" && Number.isFinite(population.value) && population.value >= 0) {
      value = `About ${Number(population.value.toPrecision(2)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      detail = `Within 500 m of ${number(population.reportCount)} ${population.reportCount === 1 ? "report" : "reports"} · WorldPop ${population.year}. Overlapping areas counted once. This estimates nearby residents, not confirmed people affected.`;
      if (connectionFailed) detail += " Based on the last loaded reports.";
    } else if (population?.message) detail = population.message;
    const result = metric("Estimated residents near reports", value, detail);
    result.id = "analysis-population";
    result.setAttribute("aria-live", "polite");
    return result;
  }
  function renderPopulation() {
    if (visible && !destroyed) byId("analysis-population")?.replaceWith(populationMetric());
  }
  function cancelPopulation() {
    ++populationRevision; populationController?.abort(); populationController = null;
    if (populationState === "loading") populationState = "idle";
  }
  async function ensurePopulation() {
    if (!visible || !region || destroyed) return;
    const selected = filter.value || "all";
    const scoped = reports.filter((report) => selected === "all" || categoryForReport(report) === selected);
    const key = JSON.stringify([region.id, selected, reportsReady, scoped.map((report) => [report.id, report.latitude, report.longitude])]);
    if (key !== populationKey || populationGeometry !== region.geometry) {
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
    try {
      const result = await loadPopulation({ reports: scoped, region }, { signal: populationController.signal });
      if (destroyed || revision !== populationRevision) return;
      population = result; populationState = result.status === "unavailable" ? "unavailable" : "ready";
    } catch {
      if (destroyed || revision !== populationRevision) return;
      population = null; populationState = "unavailable";
    }
    renderPopulation();
  }
  function renderReportChart(model) {
    const chart = byId("analysis-report-chart"), note = byId("report-chart-note");
    chart.replaceChildren(); note.replaceChildren();
    if (!reportsReady) {
      chart.append(node("p", connectionFailed ? "Reports could not be loaded, so a comparison is not available." : "Loading reports…", "analysis-note"));
      return;
    }
    const entries = model.rankings.filter((item) => Number.isFinite(item.reportCount) && item.reportCount > 0)
      .sort((first, second) => second.reportCount - first.reportCount || first.label.localeCompare(second.label));
    if (!entries.length) {
      chart.append(node("p", model.category === "all" ? "No reports have been submitted in this region." : "No reports match this problem in the selected region.", "analysis-note"));
    } else {
      const maximum = entries[0].reportCount;
      const axis = node("div", undefined, "report-chart-axis"); axis.setAttribute("aria-hidden", "true");
      axis.append(node("span", "0"), node("span", `${number(maximum)} ${maximum === 1 ? "report" : "reports"}`));
      const list = node("ul", undefined, "report-chart-list");
      for (const entry of entries) {
        const row = node("li", undefined, "report-chart-row"); row.dataset.category = entry.category;
        const name = node("span", undefined, "report-chart-label"); name.append(icon(entry.category), node("span", entry.label));
        const track = node("span", undefined, "report-chart-track"); track.setAttribute("aria-hidden", "true");
        const bar = node("span", undefined, "report-chart-bar"); bar.style.width = `${entry.reportCount / maximum * 100}%`; track.append(bar);
        row.append(name, track, node("span", `${number(entry.reportCount)} ${entry.reportCount === 1 ? "report" : "reports"}`, "report-chart-count"));
        list.append(row);
      }
      chart.append(axis, list);
    }
    note.append(document.createTextNode(`Reports submitted in ${region.label || region.name}. Open a problem below to read its reports.`));
    if (model.overview.syntheticReports) note.append(document.createTextNode(` Includes ${number(model.overview.syntheticReports)} demonstration ${model.overview.syntheticReports === 1 ? "report" : "reports"}.`));
    if (connectionFailed) note.append(document.createTextNode(" Showing the last loaded reports while the connection is unavailable."));
  }
  function render() {
    if (!region || !visible || destroyed) return;
    const selectedCategory = filter.value || "all";
    const model = buildAnalysisModel({ reports, region, evidence, category: selectedCategory, complaintInsights: insights, reportsAvailable: reportsReady });
    const overview = model.overview;
    renderReportChart(model);
    byId("analysis-scope").textContent = `${region.label || region.name} · ${selectedCategory === "all" ? "All Problems" : categoryName(selectedCategory)}`;
    byId("analysis-category-icon").innerHTML = serviceIconSvg(selectedCategory);
    byId("analysis-status").textContent = !reportsReady ? connectionFailed ? "Community reports could not be loaded. Public statistics are shown where available." : "Loading community reports…"
      : connectionFailed ? "The report connection is unavailable. Counts may be out of date."
      : evidenceState === "loading" ? "Reports loaded · looking up published statistics…"
      : evidenceState === "unavailable" ? "Reports loaded · published statistics are currently unavailable."
      : evidence?.status === "partial" ? "Reports loaded · some published statistics are unavailable."
      : "Showing available reports and published evidence.";
    const common = overview.mostCommonProblem;
    const metrics = byId("analysis-overview");
    metrics.replaceChildren(
      metric("Total reports", reportsReady ? number(overview.totalReports) : "Unknown", reportsReady ? "In this region and problem filter" : "Waiting for the report connection"),
      metric("Most reported problem", reportsReady && common ? common.label : reportsReady ? "No reports" : "Unknown", common ? `${number(common.count)} reports${common.tied?.length > 1 ? " · tied for most reported" : ""}` : "Based on reports in the selected filter", common?.category),
      populationMetric()
    );
    byId("analysis-data-note").textContent = [
      overview.syntheticReports ? `${number(overview.syntheticReports)} of these reports are marked as demonstration data. They are not evidence of real local demand.` : "",
    ].filter(Boolean).join(" ");
    const expanded = new Set([...byId("analysis-rankings").querySelectorAll("details[open]")].map((row) => row.dataset.category));
    clearReportMaps();
    const rows = [];
    const mapGroups = [];
    for (const ranking of model.rankings) {
      const row = node("details", undefined, "priority-row"); row.dataset.category = ranking.category;
      row.open = expanded.has(ranking.category);
      const summary = node("summary");
      const name = node("span", undefined, "priority-name");
      const heading = node("strong", undefined, "service-heading"); heading.append(icon(ranking.category), node("span", ranking.label));
      name.append(heading, node("small", `${reportsReady ? number(ranking.reportCount) : "Unknown"} reports${ranking.rank === null ? " · Not ranked: no evidence for this exact region" : ""}`));
      summary.append(node("span", ranking.rank === null ? "—" : String(ranking.rank), "priority-rank"), name);
      const detail = node("div", undefined, "priority-detail");
      const facts = [...(ranking.indicators || []), ...(ranking.contextIndicators || [])]
        .filter((fact) => !["access_index", "access_gap_index"].includes(fact.kind));
      if (facts.length) {
        detail.append(node("h4", "Published data"));
        for (const fact of facts) {
          const paragraph = node("p", undefined, "evidence-fact");
          paragraph.append(node("strong", `${fact.title || fact.label || fact.kind}: ${number(fact.value, 2)} ${fact.unit || ""}`), document.createTextNode(` · ${fact.year} · ${fact.scope?.name || fact.scope?.regionId || "Unknown geography"}. ${fact.description || ""} ${ranking.contextIndicators.includes(fact) ? "Context only; not used in this region’s ranking." : ""}`));
          detail.append(paragraph);
        }
      }
      detail.append(node("h4", `Reports behind this problem (${reportsReady ? ranking.reports.length : "unknown"})`));
      if (!ranking.reports.length) detail.append(node("p", reportsReady ? "No community reports for this problem in the selected region." : "Reports have not loaded.", "analysis-note"));
      const list = node("ol", undefined, "analysis-report-list");
      const mapEntries = [];
      for (const report of ranking.reports) {
        const item = node("li", undefined, "analysis-report");
        const copy = node("div", undefined, "analysis-report-copy");
        copy.append(node("p", report.summary || "No description provided."), node("small", `${report.severity || "Unknown"} reported urgency · ${dateLabel(report.submittedAt)}${report.isSynthetic ? " · Demonstration report" : ""}`));
        const insight = insights.find((entry) => entry.reportId === report.id);
        if (insight?.quote) copy.append(node("blockquote", `AI-selected supporting excerpt: “${insight.quote}”`));
        item.append(copy);
        if (getReportCoordinates(report)) {
          item.classList.add("has-location-map");
          const figure = node("figure", undefined, "analysis-report-location");
          const container = node("div", undefined, "analysis-report-map");
          container.setAttribute("role", "region");
          container.setAttribute("aria-label", `Map showing the approximate reported location for ${ranking.label}`);
          container.append(node("span", "Loading map…", "analysis-map-placeholder"));
          figure.append(container, node("figcaption", "Approximate reported location"));
          item.append(figure); mapEntries.push({ container, report: { ...report, category: ranking.category } });
        } else {
          copy.append(node("p", "Report location unavailable", "analysis-map-unavailable"));
        }
        list.append(item);
      }
      detail.append(list); row.append(summary, detail); rows.push(row);
      mapGroups.push({ row, entries: mapEntries });
    }
    byId("analysis-rankings").replaceChildren(...(rows.length ? rows : [node("p", "No report or published problem evidence is available for this selection. A rank would not be supported.", "analysis-empty")]));
    for (const { row, entries } of mapGroups) attachReportMaps(row, entries);
    byId("analysis-ai-status").textContent = aiState === "loading" ? "AI is reviewing the report text for supporting excerpts and explicitly stated duration…"
      : aiState === "ready" ? `AI reviewed ${number(reviewResult?.reviewedCount ?? insights.length)} of ${number(reports.length)} reports. Excerpts are checked against the original text.`
      : aiState === "unavailable" ? "AI review is unavailable. Reports and available statistics are still shown."
      : "";
  }
  async function ensureEvidence() {
    if (!visible || !region || evidenceState !== "idle" || destroyed) return;
    const revision = ++evidenceRevision; evidenceController = new AbortController(); evidenceState = "loading"; render();
    try {
      const result = await loadEvidence(region, { signal: evidenceController.signal });
      if (destroyed || revision !== evidenceRevision) return;
      evidence = result; evidenceState = result.status === "unavailable" ? "unavailable" : "ready";
    } catch { if (destroyed || revision !== evidenceRevision) return; evidenceState = "unavailable"; }
    render();
  }
  function ensureAI() {
    if (!visible || !reportsReady || !reports.length || !reviewComplaints || aiState !== "idle" || destroyed) return;
    const revision = ++aiRevision; aiController = new AbortController(); const signal = aiController.signal;
    aiState = "loading"; render();
    aiTimer = setTimeout(async () => {
      try {
        const result = await reviewComplaints(firebaseApp, reports, { signal });
        if (destroyed || revision !== aiRevision) return;
        reviewResult = result; insights = Array.isArray(result) ? result : result.insights || []; aiState = "ready";
      } catch { if (destroyed || revision !== aiRevision) return; aiState = "unavailable"; }
      render();
    }, 600);
  }
  function update(next) {
    const changedRegion = next.region.id !== region?.id;
    if (changedRegion) {
      ++evidenceRevision; evidenceController?.abort(); evidence = null; evidenceState = "idle";
      clearReportMaps();
      byId("analysis-rankings").replaceChildren();
    }
    region = next.region; reports = next.reports; reportsReady = next.reportsReady; connectionFailed = !!next.connectionFailed;
    const key = JSON.stringify(reports.map((report) => [report.id, report.summary, report.category, report.severity, report.submittedAt]));
    if (changedRegion || key !== reportKey) {
      reportKey = key; ++aiRevision; aiController?.abort(); clearTimeout(aiTimer); insights = []; reviewResult = null; aiState = "idle";
    }
    ensurePopulation(); render(); ensureEvidence(); ensureAI();
  }
  const onFilter = () => { clearReportMaps(); byId("analysis-rankings").replaceChildren(); ensurePopulation(); render(); };
  filter.addEventListener("change", onFilter);
  return { update, setVisible(value) { visible = value; if (value) { ensurePopulation(); render(); ensureEvidence(); ensureAI(); } else { clearReportMaps(); cancelPopulation(); } }, destroy() { destroyed = true; clearReportMaps(); cancelPopulation(); ++evidenceRevision; ++aiRevision; evidenceController?.abort(); aiController?.abort(); clearTimeout(aiTimer); filter.removeEventListener("change", onFilter); } };
}

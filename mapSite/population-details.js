import { createPopulationAreaFallback } from "./population-area-fallback.js";

const safeTaskUrl = (url) => /^https:\/\/api\.worldpop\.org\/v2\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url || "");

/** Calculation details are built only when the user opens the population card. */
export function createPopulationDetails({ document, createMap, i18n } = {}) {
  let dialog = null, map = null, previousFocus = null, destroyed = false;
  const tr = (key, values = {}, fallback = key) => i18n ? i18n.t(key, values) : Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), fallback);
  const number = (value, digits = 0) => i18n ? i18n.number(value, { maximumFractionDigits: digits }) : value.toLocaleString(undefined, { maximumFractionDigits: digits });
  const rounded = (value) => number(Number(value.toPrecision(2)));
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function close() {
    if (!dialog) return;
    const current = dialog; dialog = null;
    try { map?.destroy(); } catch { /* The dialog must still close. */ }
    map = null;
    document.removeEventListener("keydown", onKeydown);
    if (typeof current.close === "function" && current.open) current.close();
    current.remove();
    const restore = previousFocus?.id ? document.getElementById(previousFocus.id) || previousFocus : previousFocus;
    restore?.focus?.(); previousFocus = null;
  }
  function onKeydown(event) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab" || !dialog) return;
    const focusable = [...dialog.querySelectorAll('button, a[href], [tabindex="0"]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  function source(title, description, links) {
    const box = node("article", undefined, "population-source");
    box.append(node("h4", title), node("p", description));
    for (const [text, href] of links) {
      const link = node("a", text); link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer";
      box.append(link);
    }
    return box;
  }
  function open({ population, reports = [], region, category = "All Problems" } = {}) {
    if (destroyed) return;
    close(); previousFocus = document.activeElement;
    dialog = node("dialog", undefined, "population-dialog");
    dialog.setAttribute("aria-labelledby", "population-details-title");
    dialog.setAttribute("aria-describedby", "population-details-explanation");
    dialog.setAttribute("aria-modal", "true");
    const shell = node("div", undefined, "population-details");
    const header = node("header", undefined, "population-details-header");
    const title = node("h2", tr("population.title", {}, "How nearby residents are estimated")); title.id = "population-details-title";
    const dismiss = node("button", tr("population.close", {}, "Close"), "population-close"); dismiss.type = "button"; dismiss.addEventListener("click", close);
    header.append(title, dismiss);
    const scope = node("p", `${region?.label || region?.name || tr("population.selectedRegion", {}, "Selected region")} · ${category}`, "population-scope");
    const explanation = node("p", tr("population.explanation", {}, "This estimates residents living near the selected reports. It does not confirm how many people experience the problem."), "population-explanation"); explanation.id = "population-details-explanation";
    shell.append(header, scope, explanation);
    const ready = population?.status === "ready" && Number.isFinite(population.value) && population.value >= 0 &&
      Number.isFinite(population.areaKm2) && population.areaKm2 > 0 && population.geometry?.type === "MultiPolygon";
    if (ready) {
      const hero = node("div", undefined, "population-result");
      hero.append(node("strong", tr("population.residents", { count: Number(population.value.toPrecision(2)) }, `About ${rounded(population.value)} residents`)), node("span", tr("population.residentsSuffix", {}, "live inside the highlighted area")));
      shell.append(hero);
      const figure = node("figure", undefined, "population-area-figure");
      const canvas = node("div", undefined, "population-area-map"); canvas.setAttribute("aria-label", tr("population.mapLabel", {}, "Report locations and the exact merged area used for the population estimate"));
      const legend = node("figcaption");
      const areaKey = node("span", undefined, "population-area-key"); areaKey.setAttribute("aria-hidden", "true");
      const pointKey = node("span", undefined, "population-point-key"); pointKey.setAttribute("aria-hidden", "true");
      legend.append(areaKey, document.createTextNode(` ${tr("population.legendArea", {}, "Blue shading: area counted")} `), pointKey, document.createTextNode(` ${tr("population.legendDots", {}, "Dots: report locations")}`));
      figure.append(canvas, legend, node("p", tr("population.boundaryNote", {}, "This map shows the calculation boundary, not population density."), "population-muted"));
      shell.append(figure);
      const metrics = node("dl", undefined, "population-data");
      for (const [label, value] of [[tr("population.selectedReports", {}, "Selected reports"), number(population.reportCount)], [tr("population.distance", {}, "Distance per report"), `${number(population.radiusMeters)} m`],
        [tr("population.mergedArea", {}, "Merged area"), `${number(population.areaKm2, 3)} km²`], [tr("population.year", {}, "Population data year"), String(population.year)]]) {
        const metric = node("div"); metric.append(node("dt", label), node("dd", value)); metrics.append(metric);
      }
      shell.append(metrics);
      const steps = node("ol", undefined, "population-steps");
      for (const [heading, text] of [
        [tr("population.stepLocate", {}, "Locate the reports"), tr("population.stepLocateText", { count: population.reportCount }, `${number(population.reportCount)} reports match your selected region and problem filter. Duplicate report IDs are counted once.`)],
        [tr("population.stepMerge", {}, "Merge nearby areas"), tr("population.stepMergeText", { distance: population.radiusMeters, area: number(population.areaKm2, 3) }, `Draw a ${number(population.radiusMeters)}-meter area around each report and merge overlaps. Where a region boundary is available, trim the area to that boundary. Total: ${number(population.areaKm2, 3)} km².`)],
        [tr("population.stepAdd", {}, "Add the estimated residents"), tr("population.stepAddText", { year: population.year, exact: number(population.value, 2), rounded: rounded(population.value) }, `WorldPop totals its ${population.year} population estimates in roughly 100-meter grid cells across that merged area. Its returned modeled total is ${number(population.value, 2)} residents; the card rounds this to about ${rounded(population.value)}.`)],
      ]) { const item = node("li"); item.append(node("strong", heading), node("p", text)); steps.append(item); }
      shell.append(node("h3", tr("population.stepsTitle", {}, "The calculation, step by step")), steps);
      const components = population.components;
      if (Array.isArray(components) && components.length > 1 && components.every((item) => Number.isFinite(item.population) && item.population >= 0)) {
        shell.append(node("h3", tr("population.pocketsTitle", {}, "Population in each separate area")), node("p", tr("population.pocketsHelp", {}, "Each bar shows WorldPop’s estimate for one separate part of the merged area. Areas crossing the date line may be split into two parts."), "population-muted"));
        const bars = node("ul", undefined, "population-pockets");
        const maximum = Math.max(...components.map((item) => item.population), 1);
        for (const item of components) {
          const row = node("li"); const track = node("span", undefined, "population-pocket-track"); track.setAttribute("aria-hidden", "true");
          const bar = node("span"); bar.style.width = `${item.population / maximum * 100}%`; track.append(bar);
          row.append(node("span", tr("population.area", { number: item.index + 1 }, `Area ${item.index + 1}`)), track, node("strong", tr("population.residentCount", { count: Number(item.population.toFixed(2)) }, `${number(item.population, 2)} residents`))); bars.append(row);
        }
        shell.append(bars);
      }
      shell.append(node("p", tr("population.limitations", {}, "The 500-meter distance is NeedMap’s assumption, not a measured impact boundary. Fractional counts come from the population model, not a literal headcount. Population estimates can be uncertain or out of date. WorldPop’s API does not specify how partial cells at the boundary are counted."), "population-limits"));
      if (reports.some((report) => report.isSynthetic === true)) shell.append(node("p", tr("population.demoLimit", {}, "This selection includes demonstration reports. The estimate describes the area around those demonstration locations."), "population-limits"));
      shell.append(node("h3", tr("population.sourcesTitle", {}, "Sources for this calculation")));
      const sources = node("div", undefined, "population-sources");
      const date = new Date(population.retrievedAt);
      const dateText = Number.isFinite(date.getTime()) ? (i18n ? i18n.date(date, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })) : "";
      const retrieved = dateText ? tr("population.retrieved", { date: dateText }, ` Retrieved ${dateText}.`) : "";
      const links = [[tr("population.apiDocs", {}, "API documentation"), "https://api.worldpop.org/v2/"]];
      if (safeTaskUrl(population.taskUrl)) links.unshift([tr("population.viewResult", {}, "View this calculation’s result"), population.taskUrl]);
      sources.append(source(tr("population.datasetTitle", { year: population.year }, `WorldPop · ${population.year} population dataset`), tr("population.datasetDescription", { dataset: population.dataset || "worldpop_R2025A_2025_100m", retrieved }, `WorldPop’s calculation service returns the population estimate and area for NeedMap’s merged boundary. Population dataset: ${population.dataset || "worldpop_R2025A_2025_100m"}.${retrieved}`), links));
      sources.append(source(tr("population.methodsTitle", {}, "WorldPop · University of Southampton"), tr("population.methodsDescription", {}, "Explains how census counts, population projections and geographic data are used to estimate residents in small grid cells."), [[tr("population.methodsLink", {}, "Read the population modeling methods"), "https://www.worldpop.org/methods/populations/"]]));
      sources.append(source(tr("population.reportsSource", {}, "NeedMap community reports"), tr("population.reportsDescription", {}, "Selected report coordinates define the areas searched. NeedMap merges the 500-meter neighborhoods before requesting population, so overlapping areas count once."), []));
      shell.append(sources);
      dialog.append(shell); document.body.append(dialog);
      show();
      try { if (typeof createMap !== "function") throw new Error("Map unavailable"); map = createMap(canvas, { geometry: population.geometry, reports }); }
      catch { map = createPopulationAreaFallback(canvas, { geometry: population.geometry, reports, i18n }); }
    } else {
      const knownMessages = new Set(["Some reports have no usable location, so their nearby population cannot be estimated.", "No reports in this selection.", "No report neighborhoods fall inside the selected region.", "Population data is unavailable for this selection. No estimate is shown."]);
      const fallback = tr("population.noEstimate", {}, "No verified population estimate is available for this selection, so there is no calculation to display.");
      const message = population?.status === "loading" ? tr("population.loadingMessage", {}, "The population estimate is still being calculated. The details will appear here when the estimate is ready.") : population?.message && !knownMessages.has(population.message) ? population.message : fallback;
      shell.append(node("p", message, "population-limits"));
      dialog.append(shell); document.body.append(dialog); show();
    }
    dismiss.focus();
  }
  function show() {
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    document.addEventListener("keydown", onKeydown);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else { dialog.setAttribute("open", ""); dialog.setAttribute("role", "dialog"); }
  }
  function update(context) {
    if (!dialog || destroyed) return;
    const focusedHref = dialog.contains(document.activeElement) ? document.activeElement?.getAttribute?.("href") : null;
    open(context);
    if (focusedHref) [...dialog.querySelectorAll("a[href]")].find((link) => link.getAttribute("href") === focusedHref)?.focus();
  }
  return { open, update, close, destroy() { close(); destroyed = true; } };
}

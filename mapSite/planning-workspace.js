import {
  PLAN_FIELDS, PLAN_INPUT_KEYS, PLAN_CURRENCIES, calculatePlan, emptyPlan, examplePlan,
  exportPlanCsv, normalizePlan, readPlans, writePlans,
} from "./planning-model.js";

let workspaceSequence = 0;
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const formatNumber = (value, suffix = "") => value === null ? "—" : `${numberFormat.format(value)}${suffix}`;

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function button(label, action, className = "plan-button") {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function deviceStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function downloadCsv(filename, content) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
  const link = element("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A government planning surface; all estimates are explicit, editable assumptions. */
export function createPlanningWorkspace({ root, onShowRecommendation, getPlanningReference } = {}) {
  if (!root?.replaceChildren) throw new TypeError("A planning root element is required.");
  const prefix = `plan-${++workspaceSequence}`;
  const storage = deviceStorage();
  const plans = readPlans(storage);
  let recommendations = [];
  let signals = [];
  let selectedId = null;
  let shownReferenceId = null;
  let destroyed = false;
  let fields = new Map();
  const current = () => recommendations.find((candidate) => candidate.id === selectedId);
  const draft = () => plans.get(selectedId) || emptyPlan();
  const referenceForCurrent = () => {
    try { return getPlanningReference?.(current()) || null; } catch { return null; }
  };
  const remember = (plan) => {
    if (!selectedId || destroyed) return;
    plans.delete(selectedId);
    plans.set(selectedId, plan);
    writePlans(storage, plans);
  };
  const editField = (key, value) => remember({ ...draft(), [key]: value,
    editedFields: [...new Set([...draft().editedFields, key])],
  });

  const shell = element("div", "planning-shell");
  const exportButton = button("Export plan (.csv)", () => {
    if (current()) downloadCsv("needmap-plan.csv", exportPlanCsv(current(), draft()));
  });

  const empty = element("div", "plan-empty");
  empty.append(element("span", "plan-empty-symbol", "+"),
    element("h3", "", "A practical next step for every candidate."),
    element("p", "", "Candidate services will appear here as community reports are loaded in Explore. Choose one to estimate its budget, timeline, and travel-time impact."));
  const content = element("div", "plan-content");
  const selection = element("section", "plan-selection");
  const selectLabel = element("label", "plan-select-label", "Service to plan");
  const candidateSelect = element("select", "plan-select");
  candidateSelect.id = `${prefix}-candidate`;
  selectLabel.htmlFor = candidateSelect.id;
  candidateSelect.addEventListener("change", () => selectRecommendation(candidateSelect.value));
  selectLabel.append(candidateSelect);
  const selectedCopy = element("div", "plan-selected-copy");
  const selectedTitle = element("h3");
  const selectedMeta = element("p");
  selectedCopy.append(selectedTitle, selectedMeta);
  const mapButton = button("View in Explore ↗", () => {
    if (current()) onShowRecommendation?.(current());
  }, "plan-button plan-button-link");
  mapButton.hidden = typeof onShowRecommendation !== "function";
  const selectionActions = element("div", "plan-selection-actions");
  selectionActions.append(exportButton, mapButton);
  selection.append(selectLabel, selectedCopy, selectionActions);

  const exampleNotice = element("p", "plan-example-notice", "Fictional example scenario. Replace these assumptions with local evidence before using this plan.");
  const layout = element("div", "plan-layout");
  const formPanel = element("section", "plan-assumptions");
  const previewPanel = element("section", "plan-preview");
  previewPanel.setAttribute("aria-label", "Estimated plan outcomes");
  const evidence = element("details", "plan-evidence");
  const references = element("details", "plan-references");
  const printAssumptions = element("section", "plan-print-assumptions");
  layout.append(formPanel, previewPanel);
  content.append(selection, references, exampleNotice, layout, printAssumptions, evidence);
  shell.append(empty, content);
  root.replaceChildren(shell);

  function inputField(key, { help, wide = false } = {}) {
    const definition = PLAN_FIELDS[key];
    const wrapper = element("div", `plan-field${wide ? " plan-field-wide" : ""}`);
    const label = element("label", "", definition?.label || ({
      populationSource: "Population source", costSource: "Cost source", travelSource: "Travel-time source",
    }[key]));
    const input = element("input");
    input.type = "text";
    input.id = `${prefix}-${key}`;
    input.name = key;
    input.value = draft()[key];
    input.autocomplete = "off";
    if (definition) input.inputMode = definition.integer ? "numeric" : "decimal";
    else input.maxLength = 600;
    input.placeholder = definition ? "Enter estimate" : "Optional: study, quote, or local data";
    label.htmlFor = input.id;
    const error = element("span", "plan-field-error");
    error.id = `${input.id}-error`;
    error.hidden = true;
    const hint = element("span", "plan-field-help", help || "");
    hint.id = `${input.id}-help`;
    hint.hidden = !help;
    input.setAttribute("aria-describedby", `${error.id} ${hint.id}`);
    input.addEventListener("input", () => {
      editField(key, input.value);
      renderPreview();
    });
    fields.set(key, { input, error, hint, baseHelp: help || "" });
    wrapper.append(label, input, hint, error);
    return wrapper;
  }

  function fieldGroup(number, title, description, nodes) {
    const group = element("fieldset", "plan-field-group");
    const legend = element("legend");
    legend.append(element("span", "plan-step", number), element("span", "", title));
    group.append(legend, element("p", "plan-group-note", description));
    const grid = element("div", "plan-field-grid");
    grid.append(...nodes);
    group.append(grid);
    return group;
  }

  function renderForm() {
    fields = new Map();
    const top = element("div", "plan-form-header");
    top.append(element("h3", "", "Your assumptions"),
      element("p", "", "Start with local estimates. The plan updates as you type."));
    const actions = element("div", "plan-assumption-actions");
    actions.append(button("Load example assumptions", () => {
      remember(examplePlan()); renderForm(); renderPreview();
    }, "plan-text-button"), button("Clear assumptions", () => {
      remember({ ...emptyPlan(), editedFields: [...PLAN_INPUT_KEYS] }); renderForm(); renderPreview();
    }, "plan-text-button"));
    const currencyField = element("div", "plan-field plan-field-wide");
    const currencyLabel = element("label", "", "Planning currency");
    const currency = element("select");
    currency.id = `${prefix}-currency`;
    currency.name = "currency";
    currencyLabel.htmlFor = currency.id;
    PLAN_CURRENCIES.forEach((code) => { const option = element("option", "", code); option.value = code; currency.append(option); });
    currency.value = draft().currency;
    currency.addEventListener("change", () => { editField("currency", currency.value); renderPreview(); });
    currencyField.append(currencyLabel, currency, element("span", "plan-field-help", "Labels all amounts; changing currency does not convert them."));
    formPanel.replaceChildren(top, actions,
      fieldGroup("01", "People & access", "Use a census or local population estimate. Report counts are not a population estimate.", [
        inputField("population"), inputField("adoption", { help: "% of the population expected to use this service." }),
        inputField("currentMinutes", { help: "Minutes, one way, before the project." }),
        inputField("proposedMinutes", { help: "Minutes, one way, after the project." }),
        inputField("tripsPerWeek", { help: "One round trip includes the outward and return journey.", wide: true }),
        inputField("populationSource", { wide: true }), inputField("travelSource", { wide: true }),
      ]),
      fieldGroup("02", "Project budget", "Enter local cost estimates. Contingency applies to capital cost only.", [
        currencyField, inputField("capitalCost"), inputField("operatingCost"), inputField("contingency", { help: "% of capital cost reserved for uncertainty.", wide: true }),
        inputField("costSource", { wide: true }),
      ]),
      fieldGroup("03", "Delivery timeline", "Duration in weeks. Stages are added sequentially, without overlap.", [
        inputField("planningWeeks"), inputField("procurementWeeks"), inputField("deliveryWeeks", { wide: true }),
      ]));
  }

  function metric(label, value, note, className = "") {
    const node = element("article", `plan-metric ${className}`.trim());
    node.append(element("span", "plan-metric-label", label), element("strong", "", value));
    if (note) node.append(element("p", "", note));
    return node;
  }

  function renderPreview() {
    if (!current() || destroyed) return;
    const plan = draft();
    const reference = referenceForCurrent();
    const result = calculatePlan(plan);
    const { impact, budget, timeline } = result;
    fields.forEach(({ input, error, hint, baseHelp }, key) => {
      const message = result.errors[key];
      input.setAttribute("aria-invalid", message ? "true" : "false");
      error.textContent = message || "";
      error.hidden = !message;
      const sourceHelp = !plan.example ? text(reference?.fieldNotes?.[key]) : "";
      hint.textContent = [baseHelp, sourceHelp].filter(Boolean).join(" ");
      hint.hidden = !hint.textContent;
    });
    exampleNotice.hidden = !plan.example;
    const money = (value) => value === null ? "—" : new Intl.NumberFormat("en-US", {
      style: "currency", currency: plan.currency, currencyDisplay: "code", maximumFractionDigits: 0,
    }).format(value);
    const overview = element("div", "plan-preview-heading");
    overview.append(element("p", "eyebrow", "Before → after"), element("h3", "", "Estimated impact"),
      element("p", "", "A scenario calculated from your assumptions, not a forecast."));
    const metrics = element("div", "plan-impact-metrics");
    metrics.append(metric("People with shorter journeys", formatNumber(impact.peopleBenefiting),
      impact.participatingPeople === null ? "Add population and expected uptake." : `${formatNumber(impact.participatingPeople)} expected service users · population × uptake, rounded.`, "plan-metric-main"),
      metric("Net time saved each week", formatNumber(impact.weeklyHoursSaved, " hours"), "Across all expected users; negative values mean more travel."));
    const chart = element("div", "plan-travel-chart");
    chart.append(element("h4", "", "One-way travel time"));
    const largest = Math.max(impact.currentMinutes || 0, impact.proposedMinutes || 0, 1);
    for (const [label, value, name] of [["Before", impact.currentMinutes, "before"], ["After", impact.proposedMinutes, "after"]]) {
      const row = element("div", "plan-travel-row");
      const track = element("div", "plan-travel-track");
      const bar = element("span", `plan-travel-fill plan-travel-${name}`);
      bar.style.width = `${value === null ? 0 : value / largest * 100}%`;
      track.setAttribute("aria-hidden", "true");
      track.append(bar);
      row.append(element("span", "", label), track, element("strong", "", formatNumber(value, " min")));
      chart.append(row);
    }
    let travelNote = "Add current and proposed travel times to compare access.";
    if (impact.minutesSavedOneWay !== null) {
      const delta = impact.minutesSavedOneWay;
      travelNote = delta > 0 ? `${formatNumber(delta)} fewer minutes each way${impact.percentReduction !== null ? ` (${formatNumber(impact.percentReduction)}% shorter)` : ""}.`
        : delta < 0 ? `${formatNumber(-delta)} more minutes each way. This scenario does not improve travel time.`
          : "No change in travel time in this scenario.";
    }
    chart.append(element("p", impact.minutesSavedOneWay < 0 ? "plan-travel-note plan-negative" : "plan-travel-note", travelNote),
      element("p", "plan-person-saving", `${formatNumber(impact.weeklyMinutesSavedPerPerson, " minutes")} saved per user each week, including return journeys.`));
    const costPanel = element("section", "plan-result-section");
    const costHeading = element("div", "plan-section-heading");
    costHeading.append(element("h4", "", "Planning cost estimate"), element("span", "", plan.currency));
    const costList = element("dl", "plan-cost-list");
    for (const [label, value] of [["Capital cost", result.values.capitalCost], ["Capital contingency", budget.contingencyAmount], ["Annual operations", budget.annualOperations]]) {
      const row = element("div"); row.append(element("dt", "", label), element("dd", "", money(value))); costList.append(row);
    }
    const total = element("div", "plan-cost-total");
    total.append(element("span", "", "Capital + first operating year"), element("strong", "", money(budget.firstYearTotal)));
    costPanel.append(costHeading);
    if (!plan.example && text(reference?.fieldNotes?.capitalCost)) {
      costPanel.append(element("p", "plan-cost-scope", reference.fieldNotes.capitalCost));
    }
    costPanel.append(costList, total, element("p", "plan-method-note", "Includes capital contingency and 12 months of operations after launch. Excludes financing, inflation, and any costs not entered above."));
    const timelinePanel = element("section", "plan-result-section");
    const timelineHeading = element("div", "plan-section-heading");
    timelineHeading.append(element("h4", "", "Path to opening"), element("strong", "", formatNumber(timeline.totalWeeks, " weeks")));
    const stageList = element("ol", "plan-timeline");
    let elapsed = 0;
    timeline.stages.forEach((stage, index) => {
      const row = element("li");
      const description = element("div");
      description.append(element("strong", "", stage.label), element("span", "", stage.weeks === null ? "Add a duration" : `${formatNumber(stage.weeks)} weeks${timeline.totalWeeks !== null ? ` · week ${formatNumber(elapsed)}–${formatNumber(elapsed + stage.weeks)}` : ""}`));
      row.append(element("span", "plan-timeline-dot", String(index + 1)), description);
      stageList.append(row);
      elapsed += stage.weeks || 0;
    });
    timelinePanel.append(timelineHeading, stageList);
    const method = element("details", "plan-method");
    method.append(element("summary", "", "How this scenario is calculated"),
      element("p", "", "Expected users = population × uptake, rounded to the nearest person. People with shorter journeys counts those users only when proposed travel time is lower and weekly trips are not zero. Weekly time saved = expected users × (current − proposed one-way minutes) × 2 × round trips per week ÷ 60."),
      element("p", "", "This model assumes the same journey times and trip frequency for every expected user. It measures travel-time change only; it does not estimate route traffic, service capacity, health outcomes, or economic gains. Population, costs, and journey times come from the assumptions shown here, never from the number of reports."));
    previewPanel.replaceChildren(overview, metrics, chart, costPanel, timelinePanel, method);
    const printTable = element("table");
    const printBody = element("tbody");
    Object.entries(PLAN_FIELDS).forEach(([key, field]) => {
      const row = element("tr");
      const unit = field.unit === "currency" || field.unit === "currency/year"
        ? `${plan.currency}${field.unit.endsWith("/year") ? "/year" : ""}` : field.unit;
      row.append(element("th", "", field.label), element("td", "", result.errors[key]
        ? `${plan[key]} — ${result.errors[key]}` : `${formatNumber(result.values[key])} ${unit}`));
      printBody.append(row);
    });
    ["populationSource", "travelSource", "costSource"].forEach((key) => {
      const row = element("tr");
      row.append(element("th", "", key.replace("Source", " source")), element("td", "", plan[key] || "Not supplied"));
      printBody.append(row);
    });
    printTable.append(printBody);
    printAssumptions.replaceChildren(element("h3", "", "Planning assumptions"),
      element("p", "", plan.example ? "Fictional example scenario" : "Editable estimates; review sources and local feasibility."), printTable,
      element("p", "", "Expected users = population × uptake, rounded. Weekly hours saved = expected users × (current − proposed one-way minutes) × 2 × round trips/week ÷ 60. Assumes identical journeys for all expected users. No population is inferred from reports."));
    if (reference) {
      printAssumptions.append(element("h4", "", "Published references"), element("p", "", text(reference.note)));
      (Array.isArray(reference.sources) ? reference.sources : []).filter(record).forEach((source) => {
        printAssumptions.append(element("p", "", `${text(source.label)}: ${text(source.note)} ${text(source.url)}`));
      });
    }
  }

  function renderEvidence() {
    const recommendation = current();
    if (!recommendation) return;
    const reports = Array.isArray(recommendation.signals) ? recommendation.signals.filter(record) : [];
    const source = text(recommendation.analysis?.source, "Community report locations and urgency");
    evidence.replaceChildren(element("summary", "", `Candidate evidence · ${reports.length} community report${reports.length === 1 ? "" : "s"}`),
      element("p", "", text(recommendation.analysis?.rationale,
        "This candidate groups nearby reports requesting a similar service. Review the location in Explore alongside the original reports.")),
      element("p", "plan-evidence-source", `Candidate source: ${source}. These reports describe demand; they do not establish the size of the population served.`));
    const samples = reports.filter((report) => text(report.summary)).slice(0, 3);
    if (samples.length) {
      const list = element("ul");
      samples.forEach((report) => list.append(element("li", "", text(report.summary).slice(0, 500))));
      evidence.append(list);
    }
    selectedTitle.textContent = text(recommendation.analysis?.facilityType, text(recommendation.category, "Proposed service").replaceAll("_", " "));
    selectedMeta.textContent = `${text(recommendation.region?.name, "Selected service area")} · ${reports.length} supporting report${reports.length === 1 ? "" : "s"}`;
    const reference = referenceForCurrent();
    references.hidden = !reference;
    references.replaceChildren();
    if (reference) {
      if (shownReferenceId !== selectedId) references.open = true;
      shownReferenceId = selectedId;
      references.append(element("summary", "", "Published planning references"),
        element("p", "", text(reference.note, "Published benchmarks provide context. Adjust estimates to match this project's scope, place, and price year.")));
      const context = reference.populationContext;
      if (record(context) && Number.isFinite(context.value)) {
        const baseline = element("div", "plan-population-context");
        const value = element("div");
        value.append(element("span", "", text(context.label, "Regional population context")),
          element("strong", "", formatNumber(context.value)), element("span", "", context.year ? `${context.year} estimate` : "Published estimate"));
        const explanation = element("div");
        explanation.append(element("p", "", text(context.note, "Geographic context, not an estimate of people served by this project.")));
        if (/^https?:\/\//i.test(text(context.sourceUrl))) {
          const link = element("a", "", text(context.sourceLabel, "Population source"));
          link.href = context.sourceUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
          explanation.append(link);
        }
        baseline.append(value, explanation);
        references.append(baseline);
      }
      const sources = element("ul", "plan-reference-sources");
      (Array.isArray(reference.sources) ? reference.sources : []).filter(record).filter((source) =>
        !record(context) || source.url !== context.sourceUrl).forEach((source) => {
        const item = element("li");
        const label = text(source.label, "Published source");
        if (/^https?:\/\//i.test(text(source.url))) {
          const link = element("a", "", label);
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          item.append(link);
        } else item.append(element("span", "", label));
        if (text(source.note)) item.append(element("span", "", ` — ${source.note}`));
        sources.append(item);
      });
      references.append(sources);
    } else shownReferenceId = null;
  }

  function refreshSelection(changed = false) {
    empty.hidden = recommendations.length > 0;
    content.hidden = recommendations.length === 0;
    exportButton.disabled = recommendations.length === 0;
    if (!current()) return;
    const reference = referenceForCurrent();
    if (record(reference?.values)) {
      const plan = draft();
      const normalized = normalizePlan(reference.values);
      let seeded = false;
      PLAN_INPUT_KEYS.forEach((key) => {
        if (!Object.hasOwn(reference.values, key) || plan.editedFields.includes(key) || normalized[key] === "") return;
        if (plan[key] !== "" && !(key === "currency" && !plans.has(selectedId))) return;
        plan[key] = normalized[key];
        // Preserve field nodes and typing focus when analysis adds a benchmark.
        if (fields.has(key)) fields.get(key).input.value = plan[key];
        seeded = true;
      });
      if (seeded) remember(plan);
    }
    candidateSelect.value = selectedId;
    renderEvidence();
    if (changed) renderForm();
    renderPreview();
  }

  function selectRecommendation(id) {
    if (destroyed || !recommendations.some((candidate) => candidate.id === String(id))) return;
    const changed = selectedId !== String(id);
    selectedId = String(id);
    refreshSelection(changed);
  }

  refreshSelection();
  return {
    updateRecommendations(next) {
      if (destroyed) return;
      const unique = new Map();
      (Array.isArray(next) ? next : []).forEach((candidate) => {
        if (record(candidate) && (typeof candidate.id === "string" || typeof candidate.id === "number") && String(candidate.id).trim()) {
          unique.set(String(candidate.id), { ...candidate, id: String(candidate.id) });
        }
      });
      recommendations = [...unique.values()];
      const oldId = selectedId;
      if (!recommendations.some((candidate) => candidate.id === selectedId)) selectedId = recommendations[0]?.id || null;
      candidateSelect.replaceChildren(...recommendations.map((candidate) => {
        const option = element("option", "", `${text(candidate.analysis?.facilityType, text(candidate.category, "Proposed service").replaceAll("_", " "))} · ${text(candidate.region?.name, "Service area")}`);
        option.value = candidate.id; return option;
      }));
      refreshSelection(selectedId !== oldId);
    },
    updateSignals(next) {
      if (destroyed) return;
      signals = (Array.isArray(next) ? next : []).filter(record);
      empty.querySelector("p").textContent = signals.length
        ? `${signals.length} community report${signals.length === 1 ? " is" : "s are"} available. Candidate services will appear here when location analysis is ready in Explore.`
        : "Candidate services will appear here as community reports are loaded in Explore. Choose one to estimate its budget, timeline, and travel-time impact.";
    },
    setActive(active) { if (!destroyed) root.hidden = !Boolean(active); },
    selectRecommendation,
    destroy() { destroyed = true; fields.clear(); root.replaceChildren(); },
  };
}

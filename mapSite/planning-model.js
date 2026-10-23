/** Deterministic planning calculations. Reports never stand in for population. */
export const PLAN_STORAGE_KEY = "needmap.plans.v1";

export const PLAN_FIELDS = Object.freeze({
  population: { label: "Population in the service area", min: 0, max: 1e10, integer: true, unit: "people" },
  adoption: { label: "Expected uptake", min: 0, max: 100, unit: "%" },
  currentMinutes: { label: "Current one-way journey", min: 0, max: 10080, unit: "minutes" },
  proposedMinutes: { label: "Proposed one-way journey", min: 0, max: 10080, unit: "minutes" },
  tripsPerWeek: { label: "Round trips per person each week", min: 0, max: 1000, unit: "round trips/week" },
  capitalCost: { label: "Capital cost", min: 0, max: 1e15, unit: "currency" },
  operatingCost: { label: "Annual operating cost", min: 0, max: 1e15, unit: "currency/year" },
  contingency: { label: "Capital contingency", min: 0, max: 100, unit: "%" },
  planningWeeks: { label: "Design & approvals", min: 0, max: 5200, unit: "weeks" },
  procurementWeeks: { label: "Procurement", min: 0, max: 5200, unit: "weeks" },
  deliveryWeeks: { label: "Build & launch", min: 0, max: 5200, unit: "weeks" },
});

export const PLAN_CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "KES", "NGN", "ZAR", "PHP"];
const TEXT_FIELDS = ["populationSource", "costSource", "travelSource"];
export const PLAN_INPUT_KEYS = [...Object.keys(PLAN_FIELDS), ...TEXT_FIELDS, "currency"];

export function emptyPlan() {
  return { currency: "USD", ...Object.fromEntries(Object.keys(PLAN_FIELDS).map((key) => [key, ""])),
    populationSource: "", costSource: "", travelSource: "", example: false, editedFields: [] };
}

export function normalizePlan(value) {
  const result = emptyPlan();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const key of Object.keys(PLAN_FIELDS)) {
    if (typeof value[key] === "string" || typeof value[key] === "number") {
      result[key] = String(value[key]).slice(0, 40);
    }
  }
  for (const key of TEXT_FIELDS) {
    result[key] = typeof value[key] === "string" ? value[key].slice(0, 600) : "";
  }
  if (PLAN_CURRENCIES.includes(value.currency)) result.currency = value.currency;
  result.example = value.example === true;
  result.editedFields = Array.isArray(value.editedFields)
    ? [...new Set(value.editedFields.filter((key) => PLAN_INPUT_KEYS.includes(key)))] : [];
  return result;
}

export function examplePlan() {
  return { ...emptyPlan(), population: "2400", adoption: "60", currentMinutes: "35",
    proposedMinutes: "15", tripsPerWeek: "2", capitalCost: "250000", operatingCost: "60000",
    contingency: "15", planningWeeks: "6", procurementWeeks: "4", deliveryWeeks: "16",
    populationSource: "Fictional example; replace with a census or local estimate.",
    costSource: "Fictional example; replace with local quotes and operating estimates.",
    travelSource: "Fictional example; replace with observed journeys or a route study.", example: true,
    editedFields: [...PLAN_INPUT_KEYS] };
}

function readValue(value, definition) {
  if (value === "" || value === null || value === undefined ||
      (typeof value === "string" && !value.trim())) return { value: null };
  if (typeof value !== "string" && typeof value !== "number") return { value: null, error: "Enter a number." };
  const number = Number(value);
  if (!Number.isFinite(number)) return { value: null, error: "Enter a finite number." };
  if (number < definition.min || number > definition.max) {
    return { value: null, error: `Enter a value from ${definition.min.toLocaleString("en-US")} to ${definition.max.toLocaleString("en-US")}.` };
  }
  if (definition.integer && !Number.isInteger(number)) return { value: null, error: "Enter a whole number of people." };
  return { value: number };
}

export function calculatePlan(plan = {}) {
  const values = {};
  const errors = {};
  for (const [key, definition] of Object.entries(PLAN_FIELDS)) {
    const parsed = readValue(plan?.[key], definition);
    values[key] = parsed.value;
    if (parsed.error) errors[key] = parsed.error;
  }
  const has = (...keys) => keys.every((key) => values[key] !== null);
  const participants = has("population", "adoption")
    ? Math.round(values.population * values.adoption / 100) : null;
  const saving = has("currentMinutes", "proposedMinutes")
    ? values.currentMinutes - values.proposedMinutes : null;
  const weeklyMinutes = saving !== null && has("tripsPerWeek") ? saving * 2 * values.tripsPerWeek : null;
  const capitalTotal = has("capitalCost", "contingency")
    ? values.capitalCost * (1 + values.contingency / 100) : null;
  const stages = [
    { key: "planningWeeks", label: "Design & approvals" },
    { key: "procurementWeeks", label: "Procurement" },
    { key: "deliveryWeeks", label: "Build & launch" },
  ].map((stage) => ({ ...stage, weeks: values[stage.key] }));
  return {
    values, errors,
    impact: {
      currentMinutes: values.currentMinutes, proposedMinutes: values.proposedMinutes,
      participatingPeople: participants,
      peopleBenefiting: participants !== null && saving !== null
        ? (saving > 0 && values.tripsPerWeek !== 0 ? participants : 0) : null,
      minutesSavedOneWay: saving,
      percentReduction: saving !== null && values.currentMinutes > 0 ? saving / values.currentMinutes * 100 : null,
      weeklyMinutesSavedPerPerson: weeklyMinutes,
      weeklyHoursSaved: participants !== null && weeklyMinutes !== null ? participants * weeklyMinutes / 60 : null,
    },
    budget: {
      capitalWithContingency: capitalTotal,
      contingencyAmount: has("capitalCost", "contingency") ? values.capitalCost * values.contingency / 100 : null,
      annualOperations: values.operatingCost,
      firstYearTotal: capitalTotal !== null && has("operatingCost") ? capitalTotal + values.operatingCost : null,
    },
    timeline: { stages, totalWeeks: has(...stages.map((stage) => stage.key))
      ? stages.reduce((sum, stage) => sum + stage.weeks, 0) : null },
  };
}

/** Persist only known fields. Keep arbitrary recommendation IDs out of object prototypes. */
export function readPlans(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PLAN_STORAGE_KEY) || "null");
    if (!Array.isArray(saved?.plans)) return new Map();
    return new Map(saved.plans.slice(-100).flatMap((entry) => Array.isArray(entry) &&
      typeof entry[0] === "string" && entry[0].length <= 900 && entry[1] && typeof entry[1] === "object"
      ? [[entry[0], normalizePlan(entry[1])]] : []));
  } catch { return new Map(); }
}

export function writePlans(storage, plans) {
  try {
    storage?.setItem(PLAN_STORAGE_KEY, JSON.stringify({ version: 1,
      plans: [...plans].slice(-100).map(([id, plan]) => [id, normalizePlan(plan)]),
    }));
  } catch { /* Planning remains available if device storage is full or unavailable. */ }
}

function csvCell(value) {
  const text = String(value ?? "");
  // Treat user-supplied formulas as text when opened in spreadsheet applications.
  const safe = typeof value !== "number" && /^(?:\s*[=+\-@]|[\t\r])/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportPlanCsv(recommendation, plan) {
  const result = calculatePlan(plan);
  const rows = [["Section", "Item", "Value", "Unit / basis"],
    ["Plan", "Candidate", recommendation?.analysis?.facilityType || recommendation?.category || "Candidate", recommendation?.region?.name || ""],
    ["Plan", "Scenario", plan.example ? "Fictional example assumptions" : "Editable planning assumptions", "Estimates, not measured outcomes"],
    ["Plan", "Currency", plan.currency, "No exchange-rate conversion"],
    ...Object.entries(PLAN_FIELDS).map(([key, field]) => ["Assumption", field.label, result.values[key], field.unit === "currency" || field.unit === "currency/year" ? `${plan.currency}${field.unit.endsWith("/year") ? "/year" : ""}` : field.unit]),
    ...TEXT_FIELDS.map((key) => ["Source", key.replace("Source", " source"), plan[key], "Planning source"]),
    ["Estimate", "People with shorter journeys", result.impact.peopleBenefiting, "Rounded population × uptake; only if travel time decreases and trips are not zero"],
    ["Estimate", "Expected service users", result.impact.participatingPeople, "Rounded population × uptake"],
    ["Estimate", "Weekly minutes saved per user", result.impact.weeklyMinutesSavedPerPerson, "(Current − proposed one-way minutes) × 2 × weekly round trips"],
    ["Estimate", "Total weekly hours saved", result.impact.weeklyHoursSaved, "Weekly minutes saved per user × expected service users ÷ 60"],
    ["Estimate", "Capital including contingency", result.budget.capitalWithContingency, plan.currency],
    ["Estimate", "Capital plus first operating year", result.budget.firstYearTotal, plan.currency],
    ["Estimate", "Sequential delivery time", result.timeline.totalWeeks, "weeks"],
    ["Method", "Scope", "Travel-time change only; assumes the same travel times and trip frequency for every expected user.", "No population inferred from reports; no routing, inflation, financing, or discounting"],
  ];
  for (const [field, error] of Object.entries(result.errors)) rows.push(["Invalid assumption", PLAN_FIELDS[field].label, plan[field], error]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

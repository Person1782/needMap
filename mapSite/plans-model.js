import { buildRecommendations } from "./analysis.js";
import { categoryForReport } from "./analysis-model.js";
import { haversineDistance } from "./decision-tools.js";
import { pointInGeometry } from "./regions.js";

const MEDICATION_TERMS = /\b(?:pharmac(?:y|ies)|medications?|medicines?|prescriptions?|drugstores?)\b/i;
const ELECTRICITY_TERMS = /\b(?:electricity|electrical|electric\s+(?:grid|service|supply|lines?|outage)|power\s+(?:grid|lines?|supply|outages?|failure)|blackouts?|electrification|transformers?)\b/i;
const FUEL_TERMS = /\b(?:fuel|petrol|gasoline|diesel|refuel(?:ing)?|gas\s+station)\b/i;

function planType(id, label, facilityLabel, iconKey, baseCategory, minRadiusKm, maxRadiusKm) {
  return Object.freeze({
    id, label, facilityLabel, iconKey, baseCategory,
    serviceRadius: Object.freeze({ minKm: minRadiusKm, maxKm: maxRadiusKm }),
  });
}

// Radius bounds are NeedMap display assumptions. They stop one tightly grouped
// cluster from disappearing and one remote report from shading an entire region;
// they are not published service standards or claims of actual coverage.
export const PLAN_TYPES = Object.freeze({
  hospital: planType("hospital", "Hospitals", "Hospital", "hospital", "healthcare", 2, 50),
  pharmacy: planType("pharmacy", "Pharmacies", "Pharmacy", "medication", "healthcare", 1, 15),
  school: planType("school", "Schools", "School", "education", "education", 1, 20),
  water_facility: planType("water_facility", "Water facilities", "Water facility", "water", "water", 0.5, 15),
  electricity: planType("electricity", "Electricity infrastructure", "Electricity infrastructure", "electricity", "other", 1, 30),
  internet: planType("internet", "Internet infrastructure", "Internet infrastructure", "broadband", "broadband", 0.5, 25),
  roads: planType("roads", "Roads", "Road improvements", "roads", "roads", 0.5, 25),
  transportation: planType("transportation", "Transportation", "Transportation service", "transit", "transportation", 1, 30),
  emergency: planType("emergency", "Emergency services", "Emergency response facility", "emergency", "emergency_response", 2, 30),
  food: planType("food", "Food access", "Food access facility", "food", "food", 1, 15),
  fuel: planType("fuel", "Fuel access", "Fuel facility", "fuel", "fuel", 2, 30),
  other: planType("other", "Other infrastructure", "Infrastructure service", "other", "other", 0.5, 20),
});

const PLAN_TYPE_IDS = Object.freeze(Object.keys(PLAN_TYPES));
const VALID_CURRENCY = /^[A-Z]{3}$/;
const VALID_ID = /^[^\u0000-\u001f\u007f]{1,200}$/;
const MAX_TEXT = 1000;

function text(value, maximum = MAX_TEXT) {
  return typeof value === "string" && value.trim() && value.trim().length <= maximum
    ? value.trim() : null;
}

function reportSummary(report) {
  return typeof report?.summary === "string" ? report.summary : "";
}

function rawCategory(report) {
  return typeof report?.category === "string" ? report.category.trim().toLowerCase() : "";
}

/** Returns one conservative planning type for a report, never `all`. */
export function planTypeForReport(report) {
  if (!report || typeof report !== "object") return null;
  const category = categoryForReport(report);
  const raw = rawCategory(report);
  const summary = reportSummary(report);
  const medication = ["medication_access", "medication", "medications", "medicine", "pharmacy"].includes(raw) ||
    (category === "healthcare" && MEDICATION_TERMS.test(summary));
  if (medication) return "pharmacy";
  if (category === "healthcare") return "hospital";
  if (category === "education") return "school";
  if (category === "water") return "water_facility";
  if (["electricity", "electric", "power", "energy"].includes(raw) ||
      (category === "other" && ELECTRICITY_TERMS.test(summary))) return "electricity";
  if (category === "broadband") return "internet";
  if (category === "roads") return "roads";
  if (category === "transportation") return "transportation";
  if (category === "emergency_response") return "emergency";
  if (category === "food") return "food";
  if (["fuel", "fuel_access"].includes(raw) || category === "fuel" ||
      (category === "other" && FUEL_TERMS.test(summary))) return "fuel";
  return category === "other" ? "other" : null;
}

export function reportsForPlanType(reports, type) {
  if (!Object.hasOwn(PLAN_TYPES, type)) throw new RangeError("Choose one supported infrastructure type.");
  return (Array.isArray(reports) ? reports : []).filter((report) => planTypeForReport(report) === type);
}

function validCoordinate(report) {
  return Number.isFinite(report?.latitude) && Number.isFinite(report?.longitude) &&
    Math.abs(report.latitude) <= 90 && Math.abs(report.longitude) <= 180;
}

function isWorldRegion(region) {
  return region?.kind === "world" || region?.id === "world";
}

function insideRegion(region, report) {
  if (!region?.geometry || !validCoordinate(report)) return false;
  try {
    return pointInGeometry(report.longitude, report.latitude, region.geometry) &&
      (!region.excludedGeometry || !pointInGeometry(report.longitude, report.latitude, region.excludedGeometry));
  } catch {
    return false;
  }
}

function normalizedCountryCode(region) {
  const explicit = typeof region?.countryCode === "string" ? region.countryCode.trim().toUpperCase() : "";
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  const id = typeof region?.id === "string" ? region.id.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(id) ? id : "";
}

function safeFormula(value, depth = 0) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return text(value, 2000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth >= 5) return null;
  if (Array.isArray(value)) {
    if (value.length > 50) return null;
    const items = value.map((item) => safeFormula(item, depth + 1));
    return items.some((item, index) => item === null && value[index] !== null) ? null : items;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const entries = Object.entries(value);
  if (entries.length > 50 || entries.some(([key]) => !text(key, 100))) return null;
  const result = {};
  for (const [key, item] of entries) {
    const normalized = safeFormula(item, depth + 1);
    if (normalized === null && item !== null) return null;
    result[key] = normalized;
  }
  return result;
}

function normalizedSources(sources, currentYear) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 12) return null;
  const result = [];
  for (const source of sources) {
    const title = text(source?.title, 300);
    const publisher = text(source?.publisher, 200);
    const usedFor = Array.isArray(source?.usedFor)
      ? source.usedFor.map((item) => text(item, 300)).filter(Boolean)
      : text(source?.usedFor, 300);
    let url;
    try { url = new URL(source?.url); } catch { return null; }
    if (!title || !publisher || url.protocol !== "https:" ||
        (Array.isArray(usedFor) ? !usedFor.length : !usedFor)) return null;
    const publishedYear = source.publishedYear;
    if (publishedYear !== undefined && (!Number.isInteger(publishedYear) ||
        publishedYear < 1900 || publishedYear > currentYear)) return null;
    result.push({
      ...(text(source.id, 200) ? { id: source.id.trim() } : {}),
      title, publisher, url: url.href, usedFor,
      ...(publishedYear === undefined ? {} : { publishedYear }),
    });
  }
  return result;
}

function normalizedAssumptions(record, component) {
  const values = [...(Array.isArray(record?.assumptions) ? record.assumptions : []),
    ...(Array.isArray(component?.assumptions) ? component.assumptions : [])];
  if (values.length > 30) return null;
  const assumptions = values.map((value) => text(value, 600));
  return assumptions.some((value) => !value) ? null : [...new Set(assumptions)];
}

function geographyMatch(geography, region) {
  if (!geography || typeof geography !== "object") return null;
  const regionId = text(geography.regionId, 300);
  const countryCode = typeof geography.countryCode === "string" ? geography.countryCode.trim().toUpperCase() : "";
  const level = typeof geography.level === "string" ? geography.level.trim().toLowerCase() : "";
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) return null;
  if (regionId) return regionId === region?.id && (!countryCode || countryCode === normalizedCountryCode(region))
    ? { score: 3, specificity: "region", geography: { regionId, ...(countryCode ? { countryCode } : {}), level: level || "region" } }
    : null;
  if (countryCode) return /^[A-Z]{2}$/.test(countryCode) && countryCode === normalizedCountryCode(region)
    ? { score: 2, specificity: "country", geography: { countryCode, level: level || "country" } }
    : null;
  if (level === "global" || geography.global === true) {
    return { score: 1, specificity: "global", geography: { level: "global" } };
  }
  return null;
}

function componentCandidate(record, componentName, type, region, currentYear) {
  const recordId = text(record?.id, 200);
  if (!record || typeof record !== "object" || record.type !== type || !recordId || !VALID_ID.test(recordId)) return null;
  const scope = text(record.scope, 600);
  const match = geographyMatch(record.geography, region);
  const evidenceYear = record.evidenceYear;
  const sources = normalizedSources(record.sources, currentYear);
  const component = record[componentName];
  const assumptions = normalizedAssumptions(record, component);
  if (!scope || !match || !Number.isInteger(evidenceYear) || evidenceYear < 1900 ||
      evidenceYear > currentYear || !sources || !component || typeof component !== "object" || !assumptions) return null;
  const formulaValue = component.formula === undefined ? record.formula : component.formula;
  const formula = safeFormula(formulaValue);
  if (formulaValue !== undefined && formulaValue !== null && formula === null) return null;
  const common = {
    status: "estimated", evidenceId: recordId, evidenceYear, scope,
    geography: match.geography, specificity: match.specificity,
    assumptions, formula, sources,
  };
  if (componentName === "cost") {
    const { low, high, currency, priceYear } = component;
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low ||
        !VALID_CURRENCY.test(currency || "") || !Number.isInteger(priceYear) ||
        priceYear < 1900 || priceYear > currentYear) return null;
    return { ...common, low, high, currency, priceYear };
  }
  const { lowMonths, highMonths } = component;
  if (!Number.isFinite(lowMonths) || !Number.isFinite(highMonths) ||
      lowMonths <= 0 || highMonths < lowMonths) return null;
  return { ...common, lowMonths, highMonths };
}

function estimateFor(componentName, evidence, type, region, currentYear) {
  const candidates = (Array.isArray(evidence) ? evidence : [])
    .map((record) => componentCandidate(record, componentName, type, region, currentYear))
    .filter(Boolean)
    .sort((first, second) => {
      const specificity = { region: 3, country: 2, global: 1 };
      return specificity[second.specificity] - specificity[first.specificity] ||
        second.evidenceYear - first.evidenceYear || first.evidenceId.localeCompare(second.evidenceId);
    });
  return candidates[0] || {
    status: "unavailable",
    reason: componentName === "cost"
      ? "No supported cost estimate is available for this infrastructure type and location."
      : "No supported completion-time estimate is available for this infrastructure type and location.",
  };
}

/** Applies only validated, matching evidence; it never creates fallback values. */
export function applyEstimateEvidence({ evidence = [], type, region, currentYear = new Date().getUTCFullYear() } = {}) {
  if (!Object.hasOwn(PLAN_TYPES, type)) throw new RangeError("Choose one supported infrastructure type.");
  if (!Number.isInteger(currentYear) || currentYear < 1900 || currentYear > 9999) {
    throw new RangeError("A valid evidence year is required.");
  }
  return {
    cost: estimateFor("cost", evidence, type, region, currentYear),
    timeline: estimateFor("timeline", evidence, type, region, currentYear),
  };
}

function urgencyBreakdown(signals) {
  const result = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const signal of signals) {
    const severity = Object.hasOwn(result, signal.severity) ? signal.severity : "unknown";
    result[severity] += 1;
  }
  return result;
}

function serviceArea(candidate, definition) {
  const distances = candidate.signals.map((signal) => haversineDistance(candidate.position, signal));
  const farthest = distances.length ? Math.max(...distances) : 0;
  const roundedUp = Math.ceil((farthest - Number.EPSILON) * 1000) / 1000;
  const { minKm, maxKm } = definition.serviceRadius;
  const radiusKm = Math.max(minKm, Math.min(maxKm, roundedUp));
  return {
    center: { latitude: candidate.position.latitude, longitude: candidate.position.longitude },
    radiusKm,
    radiusMeters: Math.round(radiusKm * 1000),
    minRadiusKm: minKm,
    maxRadiusKm: maxKm,
    farthestSupportingReportKm: Math.round(farthest * 1000) / 1000,
    allSupportingReportsInside: farthest <= maxKm + 1e-9,
    cappedAtMaximum: farthest > maxKm,
    method: "contributing-report-distance",
    formula: "clamp(roundUp(max distance from candidate to a contributing report), type minimum, type maximum)",
    assumption: "The shaded radius is a NeedMap planning visualization derived from report locations. It is not a verified service boundary or published coverage standard.",
  };
}

function analysisHref(baseCategory, reportId) {
  return `#analysis?category=${encodeURIComponent(baseCategory)}&report=${encodeURIComponent(reportId)}`;
}

function candidateId(type, rawId) {
  return `plan:${type}:${rawId}`;
}

function candidateLocation(candidate, reports) {
  const nearest = reports.filter(validCoordinate).map((report) => ({
    report,
    distanceKm: haversineDistance(candidate.position, report),
    id: typeof report.id === "string" ? report.id : "",
  })).sort((first, second) => first.distanceKm - second.distanceKm || first.id.localeCompare(second.id))[0]?.report;
  const nearestRegion = nearest?.region;
  const fallback = candidate.region?.label || candidate.region?.name || "Approximate location";
  return {
    locationLabel: text(nearestRegion?.name, 300) || fallback,
    locationHierarchy: text(nearestRegion?.hierarchy, 600) ||
      text(candidate.region?.hierarchy, 600) || candidate.region?.label || candidate.region?.name || "",
  };
}

function statusWithoutCandidates({ reportsAvailable, connectionFailed, matchedReportCount, usableReportCount, boundaryAvailable }) {
  if (!reportsAvailable) return connectionFailed
    ? { status: "unavailable", reason: "reports-unavailable" }
    : { status: "loading", reason: "reports-loading" };
  if (!boundaryAvailable) return { status: "unavailable", reason: "region-boundary-unavailable" };
  if (!matchedReportCount) return { status: "empty", reason: "no-matching-reports" };
  if (usableReportCount < 2) return { status: "empty", reason: "insufficient-reports" };
  return { status: "empty", reason: "no-supported-report-cluster" };
}

/** Builds at most three stable plans. Estimates enrich cards but never affect rank. */
export function buildPlanModel({
  reports = [], reportsAvailable = true, connectionFailed = false,
  region = null, type, estimateEvidence = [], currentYear = new Date().getUTCFullYear(),
} = {}) {
  if (!Object.hasOwn(PLAN_TYPES, type)) throw new RangeError("Choose one supported infrastructure type; All is not supported.");
  const definition = PLAN_TYPES[type];
  const source = Array.isArray(reports) ? reports : [];
  const matched = reportsForPlanType(source, type);
  const world = isWorldRegion(region);
  const boundaryAvailable = Boolean(world || region?.geometry);
  const excluded = { invalidReport: 0, missingReportId: 0, outsideRegion: 0, missingBoundary: 0 };
  const prepared = [];

  for (const original of matched) {
    if (!validCoordinate(original)) { excluded.invalidReport += 1; continue; }
    if (typeof original.id !== "string" || !original.id.trim()) { excluded.missingReportId += 1; continue; }
    const candidateRegion = world ? original.region : region;
    if (!candidateRegion?.geometry) { excluded.missingBoundary += 1; continue; }
    if (!insideRegion(candidateRegion, original)) { excluded.outsideRegion += 1; continue; }
    prepared.push({
      ...original,
      id: original.id.trim(),
      category: definition.baseCategory,
      region: candidateRegion,
      __planOriginalReport: original,
    });
  }

  const rawCandidates = reportsAvailable && boundaryAvailable
    ? buildRecommendations(prepared).filter((candidate) => candidate.category === definition.baseCategory)
    : [];
  const ordered = rawCandidates.sort((first, second) =>
    second.urgencyScore - first.urgencyScore || second.signals.length - first.signals.length ||
    first.id.localeCompare(second.id)).slice(0, 3);
  const count = ordered.length;
  const candidates = ordered.map((candidate, index) => {
    const reportsInCandidate = candidate.signals.map((signal) => signal.__planOriginalReport || signal);
    const citations = reportsInCandidate.map((report) => ({
      reportId: report.id,
      summary: typeof report.summary === "string" ? report.summary : "",
      language: typeof report.language === "string" ? report.language : undefined,
      locale: typeof report.locale === "string" ? report.locale : undefined,
      severity: typeof report.severity === "string" ? report.severity : "unknown",
      category: typeof report.category === "string" ? report.category : definition.baseCategory,
      baseCategory: definition.baseCategory,
      analysisHref: analysisHref(definition.baseCategory, report.id),
    }));
    const area = serviceArea(candidate, definition);
    const urgency = urgencyBreakdown(candidate.signals);
    const location = candidateLocation(candidate, reportsInCandidate);
    return {
      id: candidateId(type, candidate.id),
      rank: index + 1,
      candidateCount: count,
      type,
      facilityLabel: definition.facilityLabel,
      iconKey: definition.iconKey,
      baseCategory: definition.baseCategory,
      region: candidate.region,
      position: { ...candidate.position },
      ...location,
      supportingReports: reportsInCandidate,
      reportCitations: citations,
      reportCount: reportsInCandidate.length,
      urgencyScore: candidate.urgencyScore,
      urgencyBreakdown: urgency,
      placementMethod: candidate.placementMethod,
      rationaleFacts: {
        supportingReportCount: reportsInCandidate.length,
        highUrgencyReports: urgency.high,
        mediumUrgencyReports: urgency.medium,
        lowUrgencyReports: urgency.low,
        placement: "Urgency-weighted geographic median of this candidate's contributing reports, constrained to the verified region boundary.",
        ranking: "Candidates are ordered by urgency weight, then contributing report count, then a stable identifier.",
      },
      serviceArea: area,
      estimates: applyEstimateEvidence({ evidence: estimateEvidence, type, region: candidate.region, currentYear }),
    };
  });

  const state = candidates.length
    ? { status: "ready", reason: null }
    : statusWithoutCandidates({
      reportsAvailable, connectionFailed, matchedReportCount: matched.length,
      usableReportCount: prepared.length, boundaryAvailable,
    });
  return {
    ...state,
    type,
    definition,
    region,
    candidates,
    inputReportCount: source.length,
    matchedReportCount: matched.length,
    usableReportCount: prepared.length,
    contributingReportCount: candidates.reduce((sum, candidate) => sum + candidate.reportCount, 0),
    excluded,
    notices: [
      "Recommendations use submitted report locations and urgency, not parcel, ownership, engineering, permitting, or construction-feasibility data.",
      "Service radii are planning visualizations, not verified coverage boundaries.",
      ...(candidates.some((candidate) => candidate.supportingReports.some((report) => report.isSynthetic === true))
        ? ["One or more contributing reports are marked as demonstration data."] : []),
    ],
  };
}

export { PLAN_TYPE_IDS };

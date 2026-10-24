// Priority weights are NeedMap's explicit policy, not an official government rating.
// Only measurements for the selected geography enter the score. Missing evidence
// remains an interval; weights are never redistributed to the available factors.
const SEVERITY_SOURCES = Object.freeze({
  water: Object.freeze({ id: "severity-water-who", title: "Drinking-water", publisher: "World Health Organization", url: "https://www.who.int/news-room/fact-sheets/detail/drinking-water", usedFor: "Severity context about the health consequences of unsafe or unavailable drinking water; not support for NeedMap's numeric policy baseline" }),
  healthcare: Object.freeze({ id: "severity-healthcare-who", title: "Universal health coverage (UHC)", publisher: "World Health Organization", url: "https://www.who.int/news-room/fact-sheets/detail/universal-health-coverage-%28uhc%29", usedFor: "Severity context about gaps in access to essential health services; not support for NeedMap's numeric policy baseline" }),
  emergency_response: Object.freeze({ id: "severity-emergency-care-who", title: "Emergency care", publisher: "World Health Organization", url: "https://www.who.int/health-topics/emergency-care", usedFor: "Severity context about timely emergency care for acute illness and injury; not support for NeedMap's numeric policy baseline" }),
  food: Object.freeze({ id: "severity-malnutrition-who", title: "Malnutrition", publisher: "World Health Organization", url: "https://www.who.int/en/news-room/fact-sheets/detail/malnutrition", usedFor: "Severity context about the health consequences of inadequate nutrition; not support for NeedMap's numeric policy baseline" }),
  roads: Object.freeze({ id: "severity-road-injuries-who", title: "Road traffic injuries", publisher: "World Health Organization", url: "https://www.who.int/news-room/fact-sheets/detail/road-traffic-injuries", usedFor: "Severity context about the health consequences of unsafe roads; not support for NeedMap's numeric policy baseline" }),
  transportation: Object.freeze({ id: "severity-transport-world-bank", title: "Transport", publisher: "World Bank", url: "https://www.worldbank.org/ext/en/topic/transport", usedFor: "Severity context about transport access and connections to services and opportunity; not support for NeedMap's numeric policy baseline" }),
  education: Object.freeze({ id: "severity-education-unesco", title: "The right to education", publisher: "UNESCO", url: "https://www.unesco.org/en/right-education?hub=66970", usedFor: "Severity context about access to education as a human right; not support for NeedMap's numeric policy baseline" }),
  fuel: Object.freeze({ id: "severity-energy-iea", title: "SDG7: Data and Projections", publisher: "International Energy Agency", url: "https://www.iea.org/reports/sdg7-data-and-projections", usedFor: "Severity context about access to modern energy services; not support for NeedMap's numeric policy baseline" }),
  broadband: Object.freeze({ id: "severity-connectivity-itu", title: "Measuring digital development: Facts and Figures 2025", publisher: "International Telecommunication Union", url: "https://www.itu.int/dms_pub/itu-d/opb/ind/D-IND-ICT_MDD.GCR-2025-4-PDF-E.pdf", usedFor: "Severity context about global digital connectivity gaps; not support for NeedMap's numeric policy baseline" }),
});

export const ANALYSIS_CATEGORIES = Object.freeze([
  { id: "water", label: "Water supply", severity: 100, rationale: "Safe water and sanitation are essential to survival and disease prevention.", severitySource: SEVERITY_SOURCES.water },
  { id: "healthcare", label: "Healthcare", severity: 95, rationale: "Unavailable essential care or medicines can interrupt treatment and cause preventable illness, disability, or death.", severitySource: SEVERITY_SOURCES.healthcare },
  { id: "emergency_response", label: "Emergency response", severity: 95, rationale: "Delays in emergency response can immediately threaten life.", severitySource: SEVERITY_SOURCES.emergency_response },
  { id: "food", label: "Food access", severity: 90, rationale: "Inadequate food access threatens nutrition and health.", severitySource: SEVERITY_SOURCES.food },
  { id: "roads", label: "Roads", severity: 70, rationale: "Unsafe or impassable roads can prevent access to essential services.", severitySource: SEVERITY_SOURCES.roads },
  { id: "transportation", label: "Transportation", severity: 65, rationale: "Transport barriers can prevent access to care, education, and livelihoods.", severitySource: SEVERITY_SOURCES.transportation },
  { id: "education", label: "Education", severity: 65, rationale: "Education barriers have lasting effects on opportunity and well-being.", severitySource: SEVERITY_SOURCES.education },
  { id: "fuel", label: "Fuel access", severity: 60, rationale: "Fuel shortages can disrupt household needs and essential services.", severitySource: SEVERITY_SOURCES.fuel },
  { id: "broadband", label: "Internet access", severity: 45, rationale: "Connectivity barriers restrict access to information, education, and services.", severitySource: SEVERITY_SOURCES.broadband },
  { id: "other", label: "Other infrastructure", severity: 50, rationale: "More context is needed to assess the consequences of an unspecified infrastructure concern." },
].map(Object.freeze));

export const PRIORITY_WEIGHTS = Object.freeze({ severity: 30, affected_population: 25, access: 20, frequency: 15, duration: 10 });
const CATEGORY_BY_ID = new Map(ANALYSIS_CATEGORIES.map((category) => [category.id, category]));
const ALIASES = Object.freeze({ medical: "healthcare", medicine: "healthcare", medication: "healthcare", medications: "healthcare", pharmacy: "healthcare", medication_access: "healthcare", internet: "broadband", wifi: "broadband", transit: "transportation", transport: "transportation", road: "roads", school: "education", water_supply: "water", sanitation: "water", emergency: "emergency_response" });
const MEDICATION = /\b(?:pharmac(?:y|ies)|medications?|medicines?|prescriptions?)\b/i;
const EDUCATION = /\b(?:schools?|classrooms?|teachers?|education)\b/i;
const ROAD_DAMAGE = /\b(?:potholes?|road\s+(?:damage|repair|maintenance|closure)|(?:damaged|broken|unsafe|unpaved|impassable|flooded|closed)\s+(?:roads?|bridges?)|(?:roads?|bridges?)\s+(?:are\s+|is\s+)?(?:damaged|broken|unsafe|unpaved|impassable|flooded|closed)|collapsed\s+bridge)\b/i;
const URGENCY = Object.freeze({ low: 25, medium: 60, high: 100 });
const round = (number) => Math.round(number * 10) / 10;
const clamp = (number, low = 0, high = 100) => Math.max(low, Math.min(high, number));
const finite = (number) => typeof number === "number" && Number.isFinite(number);

function normalizeCategory(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.hasOwn(ALIASES, raw) ? ALIASES[raw] : CATEGORY_BY_ID.has(raw) ? raw : null;
}

export function categoryForReport(report) {
  const category = normalizeCategory(report?.category) || "other";
  const summary = typeof report?.summary === "string" ? report.summary : "";
  // Refine legacy combined categories, without treating every mention of a road
  // or a school as the report's main problem.
  if (category === "other" && MEDICATION.test(summary)) return "healthcare";
  if (["transportation", "other"].includes(category) && ROAD_DAMAGE.test(summary)) return "roads";
  if (category === "other" && EDUCATION.test(summary)) return "education";
  return category;
}

const NUMBER_WORDS = Object.freeze({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 });
const DURATION_RE = /^(?:(?:for|lasting|lasted)\s+)?(?:(at least|over|more than)\s+)?(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(hours?|days?|weeks?|months?|years?)$/i;

export function parseDurationQuote(quote) {
  if (typeof quote !== "string") return null;
  const match = quote.trim().match(DURATION_RE);
  if (!match) return null;
  const count = Object.hasOwn(NUMBER_WORDS, match[2].toLowerCase()) ? NUMBER_WORDS[match[2].toLowerCase()] : Number(match[2]);
  const unit = match[3].toLowerCase().replace(/s$/, "");
  const days = count * ({ hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 })[unit];
  if (!Number.isFinite(days) || days < 0 || days > 36500) return null;
  return { days, quote: quote.trim(), lowerBound: !!match[1], approximate: unit === "month" || unit === "year" };
}

function durationContextAllowed(summary, quote) {
  const index = summary.indexOf(quote);
  if (index < 0) return false;
  const sentenceStart = Math.max(summary.lastIndexOf(".", index), summary.lastIndexOf("!", index), summary.lastIndexOf("?", index), summary.lastIndexOf(";", index)) + 1;
  const prefix = summary.slice(sentenceStart, index);
  // Exact words alone do not establish onset. Reject obvious negations,
  // forecasts, and service/travel waiting times even when an AI selected them.
  if (/\b(?:not|never)\s+(?:for\s+)?$/i.test(prefix)) return false;
  if (/\b(?:not|never)\s+(?:broken|damaged|closed|down|unavailable|inaccessible)\b/i.test(prefix)) return false;
  return !/\b(?:will|would|could|expected|planned|scheduled|forecast|travel|travelled|traveled|walk|walked|walking|drive|driving|journey|wait|waited|waiting|queue|queued|opening hours|open daily)\b/i.test(prefix);
}

function durationForReport(report, insights, now) {
  // Creation/submission dates are deliberately not problem onset dates.
  for (const field of ["problemDurationDays", "durationDays"]) {
    if (finite(report[field]) && report[field] >= 0 && report[field] <= 36500) return { days: report[field], quote: `${report[field]} days`, provenance: `Report field: ${field}`, lowerBound: false };
  }
  if (typeof report.problemStartedAt === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(report.problemStartedAt)) {
    const started = Date.parse(report.problemStartedAt);
    const days = (now - started) / 86400000;
    if (Number.isFinite(days) && days >= 0 && days <= 36500) return { days, quote: report.problemStartedAt, provenance: "Report-stated problem start date", lowerBound: false };
  }
  const summary = typeof report.summary === "string" ? report.summary : "";
  for (const insight of insights) {
    if (insight?.reportId !== report.id || typeof insight.durationQuote !== "string" || !insight.durationQuote.trim() || !durationContextAllowed(summary, insight.durationQuote)) continue;
    const parsed = parseDurationQuote(insight.durationQuote);
    if (parsed) return { ...parsed, provenance: "AI-selected, report-stated duration" };
  }
  // Restrict automatic parsing to explicit ongoing-problem statements, avoiding
  // travel times, opening hours, and the age of the submission itself.
  const statement = summary.match(/\b(?:problem|issue|shortage|outage|closure|disruption|unavailable|inaccessible|broken|damaged|closed|down|without (?:water|power|internet|medicine|medication))\b[^.!?;]{0,45}?\b(for\s+(?:(?:at least|over|more than)\s+)?(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:hours?|days?|weeks?|months?|years?))\b/i);
  const parsed = statement && durationContextAllowed(summary, statement[1]) && parseDurationQuote(statement[1]);
  return parsed ? { ...parsed, provenance: "Explicit duration in report text" } : null;
}

function uniqueReports(reports) {
  const seen = new Set();
  return (Array.isArray(reports) ? reports : []).filter((report) => {
    if (!report || typeof report !== "object") return false;
    if (typeof report.id !== "string" || !report.id) return true;
    if (seen.has(report.id)) return false;
    seen.add(report.id);
    return true;
  });
}

function resolutionOf(report) {
  const status = String(report.resolutionStatus ?? report.status ?? "").trim().toLowerCase().replace(/[ -]/g, "_");
  const states = [];
  if (["resolved", "fixed"].includes(status)) states.push("resolved");
  if (["open", "unresolved", "in_progress", "pending"].includes(status)) states.push("unresolved");
  if (typeof report.resolved === "boolean") states.push(report.resolved ? "resolved" : "unresolved");
  return new Set(states).size === 1 ? states[0] : "unknown";
}

function validSource(source) {
  if (!source || typeof source.title !== "string" || !source.title.trim() || typeof source.publisher !== "string" || !source.publisher.trim()) return false;
  try { return new URL(source.url).protocol === "https:"; } catch { return false; }
}

function sourcesFrom(indicators) {
  const sources = new Map();
  for (const indicator of indicators) {
    for (const source of Array.isArray(indicator.sources) && indicator.sources.length ? indicator.sources : [indicator.source]) {
      if (!validSource(source)) continue;
      const key = source.id || source.url;
      const existing = sources.get(key);
      const uses = [...new Set([...(existing?.uses || []), indicator.usedFor, source.usedFor].filter((use) => typeof use === "string" && use.trim()))];
      sources.set(key, { ...source, uses });
    }
  }
  return [...sources.values()];
}

function latest(indicators, kinds) {
  return indicators.filter((indicator) => kinds.includes(indicator.kind)).sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function makeFactor(id, label, score, coverage, description, indicators = [], extra = {}, supportingSources = []) {
  const weight = PRIORITY_WEIGHTS[id];
  const share = clamp(coverage, 0, 1);
  const knownScore = score === null ? 0 : clamp(score);
  const contribution = weight * knownScore / 100 * share;
  const sourceIndicators = supportingSources.map((source) => ({ source, usedFor: source.usedFor }));
  return { id, label, weight, score: score === null ? null : round(knownScore), contribution: round(contribution), possibleContribution: round(contribution + weight * (1 - share)), coverage: round(share * 100), description, indicators, sources: sourcesFrom([...indicators, ...sourceIndicators]), ...extra };
}

function rankCategory(definition, reports, regionReportCount, indicators, contextIndicators, insights, now, reportsAvailable) {
  const urgencyReports = reportsAvailable ? reports.filter((report) => Object.hasOwn(URGENCY, report.severity)) : [];
  const urgencyMean = urgencyReports.length ? urgencyReports.reduce((sum, report) => sum + URGENCY[report.severity], 0) / urgencyReports.length : null;
  const urgencyCoverage = reports.length ? urgencyReports.length / reports.length : 0;
  const severityCoverage = 0.8 + urgencyCoverage * 0.2;
  const severitySupported = definition.severity * 0.8 + (urgencyMean ?? 0) * urgencyCoverage * 0.2;
  const affected = latest(indicators, ["affected_population"]);
  const access = latest(indicators, ["access_gap_percent", "access_percent", "access_gap_index"]);
  const accessScore = access ? access.kind === "access_percent" ? 100 - access.value : access.value : null;
  const durations = (reportsAvailable ? reports : []).flatMap((report) => {
    const duration = durationForReport(report, insights, now);
    return duration ? [{ reportId: report.id, ...duration }] : [];
  });
  const durationMean = durations.length ? durations.reduce((sum, duration) => sum + Math.min(100, duration.days / 365 * 100), 0) / durations.length : null;
  const durationCoverage = reports.length ? durations.length / reports.length : 0;
  const factors = [
    makeFactor("severity", "Severity", severitySupported / severityCoverage, severityCoverage,
      `NeedMap policy baseline ${definition.severity}/100 supplies 80% of this factor; reported urgency supplies 20% (low 25, medium 60, high 100). ${definition.rationale} These are transparent policy choices, not an official severity assessment.${definition.severitySource ? " The cited source provides consequence context only; it does not endorse NeedMap's numeric baseline." : " No category-level source is attached because more context is needed."}`, [],
      { policyBaseline: definition.severity, reportUrgencyMean: urgencyMean === null ? null : round(urgencyMean), knownUrgencyReports: urgencyReports.length },
      definition.severitySource ? [definition.severitySource] : []),
    makeFactor("affected_population", "People affected", affected ? Math.min(100, Math.log10(affected.value + 1) / 6 * 100) : null, affected ? 1 : 0,
      affected ? "Uses the latest supported affected-population estimate for this exact geography. Score = min(100, log10(people + 1) / 6 × 100); the factor reaches 100 at approximately one million people. Estimates describe the cited indicator, not people verified by these reports." : "No supported affected-population estimate for this exact geography. The region's total population is not substituted.", affected ? [affected] : []),
    makeFactor("access", "Service access", accessScore, access ? 1 : 0,
      access ? `${access.description || "Published service-access indicator"} ${access.kind === "access_gap_index" ? "Uses the published index deficit (0–100), which is not a percentage of people." : "Uses percentage lacking the measured access (0–100)."} Different indicators measure different barriers; the cited definition matters.` : "No supported service-access measurement for this exact geography.", access ? [access] : []),
    makeFactor("frequency", "Report frequency", reportsAvailable ? regionReportCount ? reports.length / regionReportCount * 100 : 0 : null, reportsAvailable ? 1 : 0,
      reportsAvailable ? `${reports.length} of ${regionReportCount} reports in the selected region. This is the share of submitted reports, not the share of residents affected. The denominator stays the same when filtering problems.` : "Community reports have not loaded. Report frequency is unknown, not zero."),
    makeFactor("duration", "Problem duration", durationMean, durationCoverage,
      durations.length ? `Mean of report-stated durations, capped at one year per report; ${durations.length} of ${reports.length} reports supply duration. A month is approximated as 30 days and a year as 365 days. Submission age is never used.` : "No explicit problem duration in these reports. Submission age is not evidence of how long a problem has existed.", [], { reportEvidence: durations }),
  ];
  // 'At least' statements only establish a floor for their duration component.
  const durationFactor = factors.find((factor) => factor.id === "duration");
  if (reports.length && durations.some((duration) => duration.lowerBound)) {
    const additional = durations.filter((duration) => duration.lowerBound).reduce((sum, duration) => sum + (1 - Math.min(1, duration.days / 365)) * PRIORITY_WEIGHTS.duration / reports.length, 0);
    durationFactor.possibleContribution = round(Math.min(PRIORITY_WEIGHTS.duration, durationFactor.possibleContribution + additional));
  }
  const score = round(factors.reduce((sum, factor) => sum + factor.contribution, 0));
  const hasLocalEvidence = (reportsAvailable && reports.length > 0) || indicators.some((indicator) => ["affected_population", "access_gap_percent", "access_percent", "access_gap_index"].includes(indicator.kind));
  return { category: definition.id, label: definition.label, rank: null, hasLocalEvidence, score: hasLocalEvidence ? score : null, scoreUpperBound: hasLocalEvidence ? round(factors.reduce((sum, factor) => sum + factor.possibleContribution, 0)) : null, coverage: round(factors.reduce((sum, factor) => sum + factor.weight * factor.coverage / 100, 0)), reportCount: reportsAvailable ? reports.length : null, syntheticReports: reports.filter((report) => report.isSynthetic === true).length, reports, factors, indicators, contextIndicators, sources: sourcesFrom([...indicators, ...contextIndicators]) };
}

export function buildAnalysisModel({ reports = [], reportsAvailable = true, region = null, evidence = {}, category = "all", now = Date.now(), complaintInsights = [] } = {}) {
  const regionReports = uniqueReports(reports);
  const selectedCategory = normalizeCategory(category) || "all";
  const selectedReports = regionReports.filter((report) => selectedCategory === "all" || categoryForReport(report) === selectedCategory);
  const currentYear = new Date(now).getUTCFullYear();
  const allIndicators = (Array.isArray(evidence?.indicators) ? evidence.indicators : []).filter((indicator) => {
    if (!indicator || !finite(indicator.value) || indicator.value < 0 || !validSource(indicator.source)) return false;
    if (["access_percent", "access_gap_percent", "access_gap_index"].includes(indicator.kind) && indicator.value > 100) return false;
    if (!Number.isInteger(Number(indicator.year)) || Number(indicator.year) < 1900 || Number(indicator.year) > currentYear) return false;
    return indicator.scope?.countryCode && indicator.scope.countryCode === region?.countryCode;
  });
  const exactIndicators = allIndicators.filter((indicator) => indicator.scope.regionId === region?.id && indicator.eligibleForScore !== false);
  const contextIndicators = allIndicators.filter((indicator) => !exactIndicators.includes(indicator));
  const allRankings = ANALYSIS_CATEGORIES.map((definition) => rankCategory(
    definition,
    regionReports.filter((report) => categoryForReport(report) === definition.id),
    regionReports.length,
    exactIndicators.filter((indicator) => indicator.category === definition.id),
    contextIndicators.filter((indicator) => indicator.category === definition.id),
    Array.isArray(complaintInsights) ? complaintInsights : [], now, reportsAvailable,
  )).filter((row) => row.reportCount || row.indicators.some((indicator) => ["affected_population", "access_gap_percent", "access_percent", "access_gap_index"].includes(indicator.kind)) || row.contextIndicators.length);
  allRankings.sort((a, b) => Number(b.hasLocalEvidence) - Number(a.hasLocalEvidence) || (b.score ?? 0) - (a.score ?? 0) || a.label.localeCompare(b.label));
  allRankings.forEach((row, index) => { if (row.hasLocalEvidence) row.rank = index && row.score === allRankings[index - 1].score ? allRankings[index - 1].rank : index + 1; });
  const rankings = allRankings.filter((row) => selectedCategory === "all" || row.category === selectedCategory);
  const counts = ANALYSIS_CATEGORIES.map(({ id, label }) => ({ category: id, label, count: selectedReports.filter((report) => categoryForReport(report) === id).length })).filter((entry) => entry.count).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const mostCommonProblem = counts.length ? { ...counts[0], tied: counts.filter((entry) => entry.count === counts[0].count).map((entry) => ({ ...entry })) } : null;
  const resolutionStates = selectedReports.map(resolutionOf);
  const unknownResolutionReports = resolutionStates.filter((state) => state === "unknown").length;
  const unresolved = resolutionStates.filter((state) => state === "unresolved").length;
  const affected = selectedCategory !== "all" ? latest(exactIndicators.filter((indicator) => indicator.category === selectedCategory), ["affected_population"]) : null;
  // Total population is only a denominator for supported derived estimates,
  // never a standalone infrastructure finding. Its citations remain attached
  // to those estimates through indicator.sources.
  const selectedIndicators = allIndicators.filter((indicator) => indicator.kind !== "population" && (selectedCategory === "all" || indicator.category === selectedCategory));
  const syntheticReports = selectedReports.filter((report) => report.isSynthetic === true).length;
  const notes = [
    "Priority scores are decision support under NeedMap's stated weights, not verified measures of need. Missing factors are not reweighted: the first number is the supported score and the second is its possible upper bound. Overlapping ranges do not establish a reliable ordering.",
    "Unresolved counts require explicit report resolution data. Reports are not independently verified or deduplicated into separate infrastructure issues.",
    "Published statistics may cover different years or definitions. Country-level measurements are context only for smaller regions.",
  ];
  if (selectedCategory === "all") notes.push("An all-problems affected-population total is unavailable: category populations can overlap and are not added together.");
  if (syntheticReports) notes.push(`${syntheticReports} of ${selectedReports.length} displayed reports are marked as synthetic/demo data. Report-based counts and priority contributions are demonstrations, not verified community findings.`);
  return {
    region, category: selectedCategory,
    overview: { totalReports: selectedReports.length, unresolvedIssues: unknownResolutionReports ? null : unresolved, knownUnresolvedReports: unresolved, resolvedReports: resolutionStates.filter((state) => state === "resolved").length, unknownResolutionReports, mostCommonProblem, estimatedPopulationAffected: affected ? { value: affected.value, year: affected.year, label: affected.title || "Estimated population affected", sources: sourcesFrom([affected]) } : null, syntheticReports },
    rankings, sources: sourcesFrom(selectedIndicators), notes,
  };
}

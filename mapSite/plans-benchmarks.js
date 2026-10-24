const WBDG_URL = "https://www.wbdg.org/dod/ufc/ufc-3-701-01";
const IRENA_URL = "https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2025/Jul/IRENA_TEC_RPGC_in_2024_2025.pdf";
const CENSUS_DURATION_URL = "https://www.census.gov/construction/c30/length.html";
const CENSUS_DURATION_METHOD_URL = "https://www.census.gov/construction/c30/lengthtimeintro.html";
const CENSUS_DEFINITIONS_URL = "https://www.census.gov/construction/c30/definitions.html";

const PRICE_YEAR = 2024;
const USD = "USD";
const SQ_YARDS_PER_SQ_METRE = 1.1959900463;

export const PLAN_ESTIMATE_TYPES = Object.freeze([
  "hospital",
  "pharmacy",
  "school",
  "water_facility",
  "electricity",
  "internet",
  "roads",
  "transportation",
  "emergency",
  "food",
  "fuel",
  "other",
]);

const WBDG = Object.freeze({
  title: "DoD Facilities Pricing Guide, UFC 3-701-01 (2025)",
  publisher: "U.S. Department of Defense / Whole Building Design Guide",
  year: 2025,
  url: WBDG_URL,
});

const IRENA = Object.freeze({
  title: "Renewable Power Generation Costs in 2024",
  publisher: "International Renewable Energy Agency",
  year: 2025,
  url: IRENA_URL,
});

const CENSUS_DURATION = Object.freeze({
  title: "Construction Length of Time Statistics, Tables 1 and 2",
  publisher: "U.S. Census Bureau",
  year: 2026,
  url: CENSUS_DURATION_URL,
});

const CENSUS_DURATION_METHOD = Object.freeze({
  title: "Construction Length of Total Time Statistics Methodology",
  publisher: "U.S. Census Bureau",
  year: 2026,
  url: CENSUS_DURATION_METHOD_URL,
});

const CENSUS_DEFINITIONS = Object.freeze({
  title: "Construction Spending Definitions",
  publisher: "U.S. Census Bureau",
  year: 2026,
  url: CENSUS_DEFINITIONS_URL,
});

const source = (base, usedFor) => Object.freeze({ ...base, usedFor });

function censusTimeline({ lowMonths, highMonths, ownership, category, valueBands }) {
  const cohorts = "2022–23, 2023–24, and 2024–25";
  const comparison = `${ownership} ${category} projects in ${valueBands}`;
  const calculation = `NeedMap takes the lowest and highest U.S. Census average construction durations reported for ${comparison} across the ${cohorts} completion cohorts: ${lowMonths}–${highMonths} months. The range covers construction start to completion only; it is not an individual-project prediction or a full planning-to-opening schedule.`;
  return Object.freeze({
    lowMonths,
    highMonths,
    basis: `Observed U.S. construction-duration benchmark for ${comparison}; full delivery may take longer because planning, land, design, procurement, approvals, and service commissioning are outside the Census measure.`,
    calculation,
    sources: Object.freeze([
      source(CENSUS_DURATION, `Supplies the ${cohorts} average months from construction start to completion by ownership, construction type, and project-value band used for this range.`),
      source(CENSUS_DURATION_METHOD, "Defines the reported figures as sample-based average months from construction start to completion and explains their statistical limits."),
      source(CENSUS_DEFINITIONS, `Supports matching this NeedMap archetype to the Census ${category} construction category.`),
    ]),
  });
}

const definition = ({ type, asset, unitCost, timeline = null, costSource, inclusions, exclusions, assumptions }) => Object.freeze({
  type,
  asset: Object.freeze(asset),
  unitCost: Object.freeze(unitCost),
  timeline,
  costSource: Object.freeze(costSource),
  inclusions: Object.freeze(inclusions),
  exclusions: Object.freeze(exclusions),
  assumptions: Object.freeze(assumptions),
});

const DEFINITIONS = Object.freeze({
  hospital: definition({
    type: "hospital",
    asset: { name: "Small community hospital", scale: "25,000–50,000 square feet of gross building area", quantityLow: 25_000, quantityHigh: 50_000, unit: "square feet" },
    unitCost: { low: 911.61, high: 911.61, unit: "USD per square foot", formula: "building area × 911.61 USD/square foot" },
    timeline: censusTimeline({
      lowMonths: 19.3, highMonths: 20.8,
      ownership: "private nonresidential", category: "health care",
      valueBands: "the $10 million–$99.999 million project-value band",
    }),
    costSource: source(WBDG, "Hospital unit cost of 911.61 USD per square foot, stated in October 2024 dollars, used as a U.S. benchmark."),
    inclusions: ["A preliminary allowance for the hospital building represented by the cited unit-cost benchmark."],
    exclusions: ["Land", "site remediation", "off-site utilities", "specialist medical equipment", "staffing and operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["A small community hospital can be represented by 25,000–50,000 square feet for this early comparison.", "The site has ordinary access and ground conditions.", "The time range is a U.S. construction-only comparison; a planning-to-opening schedule requires local project information."],
  }),
  pharmacy: definition({
    type: "pharmacy",
    asset: { name: "Community pharmacy", scale: "2,000–4,000 square feet, using a small medical clinic as a construction-cost comparator", quantityLow: 2_000, quantityHigh: 4_000, unit: "square feet" },
    unitCost: { low: 692, high: 1_114, unit: "USD per square foot", formula: "building area × (903 USD/square foot ± 211 USD/square foot)" },
    timeline: censusTimeline({
      lowMonths: 8.1, highMonths: 11.8,
      ownership: "private nonresidential", category: "commercial",
      valueBands: "the $1 million–$4.999 million project-value bands",
    }),
    costSource: source(WBDG, "Small medical clinic comparator: 903 USD per square foot with a 211 USD per square foot standard deviation, stated in October 2024 dollars. This is not a pharmacy-specific cost observation."),
    inclusions: ["A preliminary building allowance represented by the cited small-clinic comparator."],
    exclusions: ["Land", "site remediation", "off-site utilities", "pharmacy stock", "specialist dispensing systems", "licensing", "staffing and operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["A community pharmacy can be represented by 2,000–4,000 square feet for this early comparison.", "The clinic benchmark is only a cost comparator because the approved source has no pharmacy-specific unit rate.", "The Census definitions place pharmacies in commercial construction; the time range measures construction only, not licensing, stocking, staffing, or opening."],
  }),
  school: definition({
    type: "school",
    asset: { name: "Small school building", scale: "20,000–40,000 square feet of gross building area", quantityLow: 20_000, quantityHigh: 40_000, unit: "square feet" },
    unitCost: { low: 294, high: 584, unit: "USD per square foot", formula: "building area × (439 USD/square foot ± 145 USD/square foot)" },
    timeline: censusTimeline({
      lowMonths: 16, highMonths: 26.1,
      ownership: "state and local", category: "education",
      valueBands: "the $5 million–$99.999 million project-value bands",
    }),
    costSource: source(WBDG, "Dependent-school unit cost benchmark of 439 USD per square foot with a 145 USD per square foot standard deviation, stated in October 2024 dollars."),
    inclusions: ["A preliminary allowance for the school building represented by the cited unit-cost benchmark."],
    exclusions: ["Land", "site remediation", "off-site utilities", "loose furniture and teaching supplies", "staffing and operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["A small school can be represented by 20,000–40,000 square feet for this early comparison.", "The site has ordinary access and ground conditions.", "The time range is a U.S. construction-only comparison; land, design, approvals, procurement, furnishing, staffing, and opening are outside it."],
  }),
  water_facility: definition({
    type: "water_facility",
    asset: { name: "Small drinking-water treatment facility", scale: "250,000–500,000 gallons per day of design capacity", quantityLow: 250, quantityHigh: 500, unit: "thousand gallons per day" },
    unitCost: { low: 8_960.41, high: 8_960.41, unit: "USD per thousand gallons/day", formula: "design capacity in thousand gallons/day × 8,960.41 USD" },
    timeline: censusTimeline({
      lowMonths: 11.6, highMonths: 17.4,
      ownership: "state and local", category: "water supply",
      valueBands: "the $1 million–$4.999 million project-value bands",
    }),
    costSource: source(WBDG, "Water-treatment-facility unit cost of 8,960.41 USD per thousand gallons/day, stated in October 2024 dollars, used as a U.S. benchmark."),
    inclusions: ["A preliminary facility allowance represented by the cited treatment-capacity unit cost."],
    exclusions: ["Land", "raw-water source development", "long transmission mains", "distribution network", "major pumping outside the plant", "unusual treatment processes", "operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["The selected technology fits the cited generic treatment-facility benchmark.", "Source-water testing and a local engineering study have not yet been completed.", "The time range is a U.S. construction-only comparison; source development, studies, design, permits, network work, testing, and commissioning are outside it."],
  }),
  electricity: definition({
    type: "electricity",
    asset: { name: "Utility-scale solar photovoltaic installation", scale: "1 megawatt (1,000 kilowatts) of installed capacity", quantityLow: 1_000, quantityHigh: 1_000, unit: "kilowatts" },
    unitCost: { low: 489, high: 1_610, unit: "USD per kilowatt", formula: "1,000 kilowatts × IRENA's 5th–95th percentile total installed cost range" },
    costSource: source(IRENA, "Global 2024 utility-scale solar PV total installed cost: 489–1,610 USD per kilowatt (5th–95th percentile); 691 USD per kilowatt global weighted average is context only."),
    inclusions: ["The total installed solar-PV cost represented by IRENA's cited global project range."],
    exclusions: ["Land", "major transmission expansion", "distribution reinforcement", "battery storage", "backup generation", "financing", "local taxes", "price escalation after 2024"],
    assumptions: ["A 1 MW utility-scale solar installation is a useful initial archetype; it is not a local load study.", "Grid connection is feasible without major network reconstruction.", "No numeric completion time is shown because the available Census table combines power with other project types and does not support a solar-specific range."],
  }),
  internet: definition({
    type: "internet",
    asset: { name: "Local communications backbone route", scale: "5 route-miles of communications cabling", quantityLow: 5, quantityHigh: 5, unit: "route-miles" },
    unitCost: { low: 110_524.96, high: 388_321.75, unit: "USD per route-mile", formula: "5 route-miles × above-ground-to-below-ground communications-cabling unit costs" },
    costSource: source(WBDG, "Communications-cabling unit cost benchmark: 110,524.96 USD/mile above ground and 388,321.75 USD/mile below ground, stated in October 2024 dollars."),
    inclusions: ["A preliminary five-mile communications-cabling allowance represented by the cited route unit costs."],
    exclusions: ["Land and easements", "customer drops", "home or business equipment", "network electronics", "towers", "data-center capacity", "operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["A five-mile local backbone route is the planning archetype.", "The low end uses above-ground cabling and the high end uses below-ground cabling; local terrain and rights-of-way are unknown.", "No numeric completion time is shown because the available Census table combines communication with other project types and does not support a communications-specific range."],
  }),
  roads: definition({
    type: "roads",
    asset: { name: "Two-lane surfaced road segment", scale: "0.5–2.0 kilometres long and 7 metres wide", quantityLow: 500 * 7 * SQ_YARDS_PER_SQ_METRE, quantityHigh: 2_000 * 7 * SQ_YARDS_PER_SQ_METRE, unit: "square yards of surfaced road" },
    unitCost: { low: 128.33, high: 128.33, unit: "USD per square yard", formula: "road length × 7 metre width × 1.1959900463 square yards/square metre × 128.33 USD/square yard" },
    timeline: censusTimeline({
      lowMonths: 5.9, highMonths: 9.4,
      ownership: "state and local", category: "highway",
      valueBands: "the $250,000–$2.999 million project-value bands",
    }),
    costSource: source(WBDG, "Surfaced-road unit cost of 128.33 USD per square yard, stated in October 2024 dollars, used as a U.S. benchmark."),
    inclusions: ["A preliminary surfaced-road allowance represented by the cited area unit cost."],
    exclusions: ["Land and right-of-way", "major bridges or tunnels", "complex drainage", "utility relocation", "abnormal earthwork", "operations and maintenance", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["The road is 7 metres wide and 0.5–2.0 kilometres long.", "Ground conditions permit ordinary road construction without major structures.", "The time range is a U.S. construction-only comparison; survey, design, right-of-way, environmental review, procurement, and closeout are outside it."],
  }),
  transportation: definition({
    type: "transportation",
    asset: { name: "Local bus station", scale: "5,000–15,000 square feet of gross building area", quantityLow: 5_000, quantityHigh: 15_000, unit: "square feet" },
    unitCost: { low: 192.49, high: 192.49, unit: "USD per square foot", formula: "building area × 192.49 USD/square foot" },
    timeline: censusTimeline({
      lowMonths: 5.3, highMonths: 10.7,
      ownership: "state and local", category: "transportation",
      valueBands: "the $250,000–$2.999 million project-value bands",
    }),
    costSource: source(WBDG, "Bus-station unit cost of 192.49 USD per square foot, stated in October 2024 dollars, used as a U.S. benchmark."),
    inclusions: ["A preliminary station-building allowance represented by the cited unit-cost benchmark."],
    exclusions: ["Land", "bus fleet", "roads and major parking works", "fueling or charging infrastructure", "off-site utilities", "operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["A local bus station can be represented by 5,000–15,000 square feet for this early comparison.", "The service plan and fleet are outside this facility estimate.", "The Census transportation category includes bus passenger terminals but also other transportation assets; the time range measures construction only."],
  }),
  emergency: definition({
    type: "emergency",
    asset: { name: "Local fire station", scale: "9,000 square feet of gross building area", quantityLow: 9_000, quantityHigh: 9_000, unit: "square feet" },
    unitCost: { low: 928, high: 1_238, unit: "USD per square foot", formula: "9,000 square feet × (1,083 USD/square foot ± 155 USD/square foot)" },
    timeline: censusTimeline({
      lowMonths: 19.1, highMonths: 27.7,
      ownership: "state and local", category: "public safety",
      valueBands: "the $5 million–$99.999 million project-value bands",
    }),
    costSource: source(WBDG, "Fire-station unit cost benchmark of 1,083 USD per square foot with a 155 USD per square foot standard deviation for a 9,000 square foot reference facility, stated in October 2024 dollars."),
    inclusions: ["A preliminary fire-station building allowance represented by the cited unit-cost benchmark."],
    exclusions: ["Land", "fire engines and specialist response equipment", "off-site utilities", "staffing and operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["The 9,000 square foot reference fire station is the planning archetype.", "Emergency-response coverage and fleet requirements require separate local studies.", "The Census public-safety category includes fire stations but also other public-safety assets; the time range measures construction only."],
  }),
  food: definition({
    type: "food",
    asset: { name: "Community food and meal centre", scale: "5,000–10,000 square feet, using a dining facility as a construction-cost comparator", quantityLow: 5_000, quantityHigh: 10_000, unit: "square feet" },
    unitCost: { low: 813, high: 813, unit: "USD per square foot", formula: "building area × 813 USD/square foot" },
    timeline: censusTimeline({
      lowMonths: 11.5, highMonths: 13.6,
      ownership: "private nonresidential", category: "commercial",
      valueBands: "the $3 million–$9.999 million project-value bands",
    }),
    costSource: source(WBDG, "Dining-facility comparator of 813 USD per square foot, stated in October 2024 dollars. This is not a food-access-program cost observation."),
    inclusions: ["A preliminary building allowance represented by the cited dining-facility comparator."],
    exclusions: ["Land", "food inventory", "delivery vehicles", "program administration", "staffing and operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["A 5,000–10,000 square foot food and meal centre is the planning archetype.", "The dining-facility unit cost is only a building comparator; it does not measure whether this service model fits local needs.", "The Census commercial category includes food, dining, and retail assets but also other commercial buildings; the time range measures construction only."],
  }),
  fuel: definition({
    type: "fuel",
    asset: { name: "Vehicle fueling facility", scale: "4–8 fueling outlets", quantityLow: 4, quantityHigh: 8, unit: "outlets" },
    unitCost: { low: 160_781.03, high: 160_781.03, unit: "USD per outlet", formula: "number of outlets × 160,781.03 USD/outlet" },
    timeline: censusTimeline({
      lowMonths: 5.6, highMonths: 8.3,
      ownership: "private nonresidential", category: "commercial",
      valueBands: "the $250,000–$2.999 million project-value bands",
    }),
    costSource: source(WBDG, "Vehicle-fueling-facility unit cost of 160,781.03 USD per outlet, stated in October 2024 dollars, used as a U.S. benchmark."),
    inclusions: ["A preliminary fueling-facility allowance represented by the cited per-outlet unit cost."],
    exclusions: ["Land", "fuel inventory", "unusual environmental remediation", "major off-site utilities", "delivery vehicles", "operations", "financing", "local taxes", "price escalation after October 2024"],
    assumptions: ["A small local facility with 4–8 outlets is the planning archetype.", "Environmental conditions and the fuel type have not been assessed.", "The Census commercial category includes gas stations but also other commercial buildings; the time range measures construction only and excludes environmental review and opening."],
  }),
});

const roundCurrency = (value) => Math.round(value);

function validText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validHttps(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function normalizeRegionName(region) {
  if (validText(region)) return region.trim();
  for (const value of [region?.name, region?.label, region?.country]) {
    if (validText(value)) return value.trim();
  }
  return null;
}

function validateAdjustment(adjustment) {
  if (adjustment == null) return null;
  if (!adjustment || typeof adjustment !== "object" || Array.isArray(adjustment)) {
    throw new TypeError("The local cost adjustment must be an evidence-backed object.");
  }
  if (!Number.isFinite(adjustment.multiplier) || adjustment.multiplier <= 0 || adjustment.multiplier > 100) {
    throw new RangeError("The local cost multiplier must be greater than 0 and no greater than 100.");
  }
  if (!validText(adjustment.geography) || !validText(adjustment.method)) {
    throw new TypeError("A local cost adjustment requires a geography and calculation method.");
  }
  const evidence = adjustment.source;
  if (!evidence || !validText(evidence.title) || !validText(evidence.publisher) ||
      !validText(evidence.usedFor) || !validHttps(evidence.url) ||
      !Number.isInteger(evidence.year) || evidence.year < 1900 || evidence.year > 2100) {
    throw new TypeError("A local cost adjustment requires a dated HTTPS source with title, publisher, and use.");
  }
  return Object.freeze({
    multiplier: adjustment.multiplier,
    geography: adjustment.geography.trim(),
    method: adjustment.method.trim(),
    source: Object.freeze({
      title: evidence.title.trim(),
      publisher: evidence.publisher.trim(),
      year: evidence.year,
      url: evidence.url,
      usedFor: evidence.usedFor.trim(),
    }),
  });
}

function unavailable(type) {
  return Object.freeze({
    status: "unavailable",
    available: false,
    type,
    cost: null,
    timeline: null,
    asset: null,
    calculation: null,
    inclusions: Object.freeze([]),
    exclusions: Object.freeze([]),
    assumptions: Object.freeze([]),
    sources: Object.freeze([]),
    explanation: "A defined asset and an evidence-backed unit-cost benchmark are required before NeedMap can estimate this plan.",
  });
}

function calculationText(item, baseLow, baseHigh, adjustment) {
  const base = `For ${item.asset.scale}, ${item.unitCost.formula}. This gives ${baseLow.toLocaleString("en-US")}–${baseHigh.toLocaleString("en-US")} USD before local adjustment; displayed values are rounded to the nearest USD.`;
  return adjustment
    ? `${base} NeedMap then multiplies both ends by ${adjustment.multiplier} using ${adjustment.method}, producing the displayed range.`
    : `${base} No evidence-backed local cost multiplier was supplied, so the range remains an unlocalized U.S. or global benchmark.`;
}

function deepFreezeEstimate(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeEstimate(child);
  return Object.freeze(value);
}

/**
 * Returns a deterministic preliminary benchmark for one Plans infrastructure type.
 * `localCostAdjustment` is optional and is accepted only with a dated HTTPS source.
 * Currency conversion and inflation are deliberately outside this function.
 */
export function buildPlanBenchmark(type, { region = null, localCostAdjustment = null } = {}) {
  if (!PLAN_ESTIMATE_TYPES.includes(type)) throw new RangeError(`Unsupported plan type: ${String(type)}`);
  if (type === "other") return unavailable(type);

  const item = DEFINITIONS[type];
  const adjustment = validateAdjustment(localCostAdjustment);
  const baseLow = roundCurrency(item.asset.quantityLow * item.unitCost.low);
  const baseHigh = roundCurrency(item.asset.quantityHigh * item.unitCost.high);
  const multiplier = adjustment?.multiplier ?? 1;
  const target = normalizeRegionName(region);
  const geography = adjustment
    ? `${adjustment.geography}; adjusted from the cited base benchmark`
    : target ? `Cited U.S. or global benchmark; not localized for ${target}` : "Cited U.S. or global benchmark; not localized";
  const sources = [item.costSource, ...(item.timeline?.sources || []), ...(adjustment ? [adjustment.source] : [])];

  return deepFreezeEstimate({
    status: "ready",
    available: true,
    type,
    asset: { ...item.asset },
    cost: {
      low: roundCurrency(baseLow * multiplier),
      high: roundCurrency(baseHigh * multiplier),
      currency: USD,
      priceYear: PRICE_YEAR,
      geography,
      estimateType: "preliminary benchmark estimate",
      baseLow,
      baseHigh,
      baseGeography: type === "electricity" ? "Global utility-scale solar projects" : "United States facilities benchmark",
    },
    timeline: item.timeline ? {
      low: item.timeline.lowMonths,
      high: item.timeline.highMonths,
      unit: "months",
      type: "observed U.S. construction-duration benchmark",
      basis: item.timeline.basis,
    } : null,
    calculation: {
      cost: calculationText(item, baseLow, baseHigh, adjustment),
      timeline: item.timeline?.calculation || null,
    },
    inclusions: [...item.inclusions],
    exclusions: [...item.exclusions],
    assumptions: [...item.assumptions],
    localization: adjustment ? {
      status: "evidence-backed adjustment supplied",
      multiplier: adjustment.multiplier,
      geography: adjustment.geography,
      method: adjustment.method,
      source: adjustment.source,
    } : {
      status: "unlocalized",
      multiplier: null,
      geography: target,
      method: null,
      source: null,
    },
    sources,
  });
}

export const getPlanBenchmark = buildPlanBenchmark;

export function hasPlanBenchmark(type) {
  return Object.hasOwn(DEFINITIONS, type);
}

function evidenceSourceId(item, index) {
  if (item.url === WBDG_URL) return "wbdg-ufc-3-701-01-2025";
  if (item.url === IRENA_URL) return "irena-renewable-costs-2024";
  if (item.url === CENSUS_DURATION_URL) return "us-census-construction-duration-tables";
  if (item.url === CENSUS_DURATION_METHOD_URL) return "us-census-construction-duration-method";
  if (item.url === CENSUS_DEFINITIONS_URL) return "us-census-construction-definitions";
  return `local-evidence-${index + 1}`;
}

function evidenceGeography(region, adjusted) {
  if (!adjusted) return { level: "global" };
  const regionId = validText(region?.id) ? region.id.trim() : null;
  const countryCode = typeof region?.countryCode === "string" && /^[A-Za-z]{2}$/.test(region.countryCode.trim())
    ? region.countryCode.trim().toUpperCase() : null;
  if (regionId) return { regionId, ...(countryCode ? { countryCode } : {}), level: "region" };
  if (countryCode) return { countryCode, level: "country" };
  throw new TypeError("Localized estimate evidence requires a region ID or two-letter country code.");
}

/**
 * Adapts the richer benchmark record to plans-model.js's validated evidence
 * contract. The global record remains visibly an unlocalized comparator.
 */
export function buildPlanBenchmarkEvidence(type, options = {}) {
  const estimate = buildPlanBenchmark(type, options);
  if (!estimate.available) return null;
  const adjusted = estimate.localization.status !== "unlocalized";
  const sources = estimate.sources.map((item, index) => ({
    id: evidenceSourceId(item, index),
    title: item.title,
    publisher: item.publisher,
    url: item.url,
    usedFor: item.usedFor,
    ...(Number.isInteger(item.year) ? { publishedYear: item.year } : {}),
  }));
  return deepFreezeEstimate({
    id: `needmap-${type}-${PRICE_YEAR}-${adjusted ? "localized" : "base"}`,
    type,
    scope: `${estimate.asset.name}; ${estimate.asset.scale}. ${estimate.cost.geography}.`,
    geography: evidenceGeography(options.region, adjusted),
    evidenceYear: Math.max(PRICE_YEAR, ...sources.map((item) => item.publishedYear || 0)),
    cost: {
      low: estimate.cost.low,
      high: estimate.cost.high,
      currency: estimate.cost.currency,
      priceYear: estimate.cost.priceYear,
      assumptions: [
        `Included: ${estimate.inclusions.join(" ")}`,
        `Excluded: ${estimate.exclusions.join(", ")}.`,
      ],
      formula: {
        display: estimate.calculation.cost,
        explanation: estimate.calculation.cost,
        asset: { ...estimate.asset },
        estimateType: estimate.cost.estimateType,
      },
    },
    timeline: estimate.timeline ? {
      lowMonths: estimate.timeline.low,
      highMonths: estimate.timeline.high,
      assumptions: [estimate.timeline.basis],
      formula: {
        display: estimate.calculation.timeline,
        explanation: estimate.calculation.timeline,
        estimateType: estimate.timeline.type,
      },
    } : null,
    assumptions: [...estimate.assumptions],
    sources,
  });
}

export function buildPlanBenchmarkEvidenceSet(options = {}) {
  return PLAN_ESTIMATE_TYPES.map((type) => buildPlanBenchmarkEvidence(type, options)).filter(Boolean);
}

/**
 * Pure decision-support utilities for NeedMap.
 *
 * These functions do not access the DOM, Firebase, or the network. Travel times
 * are planning estimates based on straight-line distance and configurable route
 * factors; they are not a replacement for a routing service.
 */

const EARTH_RADIUS_KM = 6371.0088;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_URGENCY_WEIGHTS = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
});

export const DEFAULT_TRAVEL_PROFILES = Object.freeze({
  walk: Object.freeze({
    speedKmh: 4.8,
    routeFactor: 1.2,
    fixedMinutes: 0,
  }),
  drive: Object.freeze({
    speedKmh: 32,
    routeFactor: 1.3,
    fixedMinutes: 3,
  }),
  transit: Object.freeze({
    speedKmh: 20,
    routeFactor: 1.25,
    fixedMinutes: 10,
  }),
});

const SERVICE_TERM_GROUPS = [
  ["gas station", "fuel", "petrol", "gasoline", "service station", "refuel"],
  ["transit", "bus", "train", "rail", "shuttle", "transportation"],
  ["clinic", "healthcare", "health care", "medical", "doctor", "hospital"],
  ["pharmacy", "medicine", "prescription", "drugstore"],
  ["grocery", "supermarket", "food market", "fresh food"],
  ["food pantry", "food bank", "food distribution"],
  ["internet", "wifi", "wi-fi", "broadband"],
  ["water", "drinking water", "water station"],
  ["emergency", "fire station", "ambulance", "police"],
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinatesOf(value) {
  if (!value || typeof value !== "object") return null;
  const source = value.position && typeof value.position === "object"
    ? value.position
    : value.location && typeof value.location === "object"
      ? value.location
      : value;
  const latitude = numericValue(source.latitude ?? source.lat);
  const longitude = numericValue(source.longitude ?? source.lng ?? source.lon);

  if (
    latitude === null || longitude === null || latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function timestampOf(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value?.toDate === "function") {
    try {
      return timestampOf(value.toDate());
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && Number.isFinite(value.seconds)) {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === "number") {
    const milliseconds = Math.abs(value) < 1e11 ? value * 1000 : value;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function urgencyWeight(report, weights = DEFAULT_URGENCY_WEIGHTS) {
  const urgency = String(report?.severity ?? report?.urgency ?? "low").toLowerCase();
  const weight = numericValue(weights[urgency]);
  return weight !== null && weight > 0 ? weight : 1;
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, percentage) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const index = (sorted.length - 1) * clamp(percentage, 0, 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Returns the great-circle distance in kilometers between two coordinates.
 * Coordinates may use { latitude, longitude }, { lat, lng }, or a nested
 * { position: ... } shape. Throws when either coordinate is invalid.
 */
export function haversineDistance(origin, destination) {
  const first = coordinatesOf(origin);
  const second = coordinatesOf(destination);
  if (!first || !second) {
    throw new TypeError("haversineDistance requires two valid coordinates.");
  }

  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(
    Math.sqrt(haversine),
    Math.sqrt(Math.max(0, 1 - haversine)),
  );
}

function normalizedTravelProfiles(overrides = {}) {
  return Object.fromEntries(
    Object.entries({ ...DEFAULT_TRAVEL_PROFILES, ...overrides }).flatMap(
      ([mode, suppliedProfile]) => {
        const base = DEFAULT_TRAVEL_PROFILES[mode] || {};
        const profile = { ...base, ...(suppliedProfile || {}) };
        const speedKmh = numericValue(profile.speedKmh);
        const routeFactor = numericValue(profile.routeFactor);
        const fixedMinutes = numericValue(profile.fixedMinutes);
        if (speedKmh === null || speedKmh <= 0 || routeFactor === null || routeFactor <= 0) {
          return [];
        }
        return [[mode, {
          speedKmh,
          routeFactor,
          fixedMinutes: fixedMinutes === null ? 0 : Math.max(0, fixedMinutes),
        }]];
      },
    ),
  );
}

/**
 * Estimates travel times for a straight-line distance in kilometers.
 * `options.profiles` can override speedKmh, routeFactor, and fixedMinutes for
 * any mode. Returns an object keyed by travel mode.
 */
export function estimateTravelTimes(distanceKm, { profiles = {} } = {}) {
  const distance = numericValue(distanceKm);
  if (distance === null || distance < 0) {
    throw new TypeError("estimateTravelTimes requires a non-negative distance.");
  }

  return Object.fromEntries(
    Object.entries(normalizedTravelProfiles(profiles)).map(([mode, profile]) => {
      const routedDistanceKm = distance * profile.routeFactor;
      const minutes = distance === 0
        ? 0
        : routedDistanceKm / profile.speedKmh * 60 + profile.fixedMinutes;
      return [mode, {
        mode,
        minutes: round(minutes, 1),
        distanceKm: round(distance, 3),
        routedDistanceKm: round(routedDistanceKm, 3),
        speedKmh: profile.speedKmh,
        routeFactor: profile.routeFactor,
        fixedMinutes: profile.fixedMinutes,
        isEstimate: true,
      }];
    }),
  );
}

/** Estimates travel time between two coordinate objects. */
export function estimateTravelTimesBetween(origin, destination, options = {}) {
  return estimateTravelTimes(haversineDistance(origin, destination), options);
}

/**
 * Measures how well a candidate coordinate covers a list of reports.
 * Invalid report coordinates are excluded and counted. Thresholds are minutes.
 */
export function calculateCoverageMetrics(
  candidate,
  reports,
  {
    thresholdsMinutes = [5, 10, 20],
    travelProfiles = {},
    urgencyWeights = DEFAULT_URGENCY_WEIGHTS,
  } = {},
) {
  if (!coordinatesOf(candidate)) {
    throw new TypeError("calculateCoverageMetrics requires a valid candidate coordinate.");
  }
  const sourceReports = Array.isArray(reports) ? reports : [];
  const thresholds = [...new Set(thresholdsMinutes
    .map(numericValue)
    .filter((value) => value !== null && value >= 0))]
    .sort((first, second) => first - second);
  const profiles = normalizedTravelProfiles(travelProfiles);
  const validReports = sourceReports.flatMap((report, index) => {
    if (!coordinatesOf(report)) return [];
    const distanceKm = haversineDistance(candidate, report);
    return [{
      report,
      reportId: String(report.id ?? report.reportId ?? index + 1),
      distanceKm,
      urgencyWeight: urgencyWeight(report, urgencyWeights),
      travelTimes: estimateTravelTimes(distanceKm, { profiles }),
    }];
  });
  const totalWeight = validReports.reduce(
    (sum, report) => sum + report.urgencyWeight,
    0,
  );

  const modes = Object.fromEntries(Object.keys(profiles).map((mode) => {
    const minutes = validReports.map((item) => item.travelTimes[mode].minutes);
    const thresholdMetrics = thresholds.map((thresholdMinutes) => {
      const covered = validReports.filter(
        (item) => item.travelTimes[mode].minutes <= thresholdMinutes,
      );
      const coveredWeight = covered.reduce(
        (sum, item) => sum + item.urgencyWeight,
        0,
      );
      return {
        minutes: thresholdMinutes,
        reportCount: covered.length,
        reportPercent: validReports.length
          ? round(covered.length / validReports.length * 100, 1)
          : 0,
        urgencyWeight: round(coveredWeight, 2),
        urgencyPercent: totalWeight ? round(coveredWeight / totalWeight * 100, 1) : 0,
      };
    });

    return [mode, {
      averageMinutes: round(average(minutes), 1),
      medianMinutes: round(median(minutes), 1),
      p90Minutes: round(percentile(minutes, 0.9), 1),
      maximumMinutes: round(minutes.length ? Math.max(...minutes) : 0, 1),
      thresholds: thresholdMetrics,
    }];
  }));
  const distances = validReports.map((item) => item.distanceKm);

  return {
    candidate: coordinatesOf(candidate),
    totalReports: sourceReports.length,
    validReportCount: validReports.length,
    excludedReportCount: sourceReports.length - validReports.length,
    totalUrgencyWeight: round(totalWeight, 2),
    averageDistanceKm: round(average(distances), 2),
    medianDistanceKm: round(median(distances), 2),
    p90DistanceKm: round(percentile(distances, 0.9), 2),
    modes,
    reportMetrics: validReports.map((item) => ({
      reportId: item.reportId,
      distanceKm: round(item.distanceKm, 3),
      urgencyWeight: item.urgencyWeight,
      travelTimes: item.travelTimes,
    })),
    methodology: "Great-circle distance with configurable route factors, speeds, and fixed time allowances.",
  };
}

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function serviceText(record) {
  const tags = record?.tags && typeof record.tags === "object"
    ? Object.values(record.tags).join(" ")
    : record?.tags;
  return normalizedText([
    record?.serviceType,
    record?.facilityType,
    record?.category,
    record?.type,
    record?.name,
    tags,
  ].filter(Boolean).join(" "));
}

function serviceTerms(serviceType, aliases = []) {
  const supplied = [serviceType, ...aliases].map(normalizedText).filter(Boolean);
  const expanded = new Set(supplied);
  for (const group of SERVICE_TERM_GROUPS) {
    if (group.some((term) => supplied.some(
      (suppliedTerm) => suppliedTerm.includes(term) || term.includes(suppliedTerm),
    ))) {
      group.forEach((term) => expanded.add(normalizedText(term)));
    }
  }
  return [...expanded];
}

/**
 * Scores the lack of nearby services from 0 (well served) to 100 (large gap).
 * POIs may contain serviceType/facilityType/category/type/name/tags plus a
 * coordinate. Pass an empty serviceType when POIs are already filtered.
 */
export function scoreExistingServiceGap(
  candidate,
  pointsOfInterest,
  {
    serviceType = "",
    serviceAliases = [],
    searchRadiusKm = 10,
    idealGapKm = 5,
    saturationCount = 3,
    distanceWeight = 0.65,
    proximityBandsKm = [1, 3, 5, 10],
  } = {},
) {
  if (!coordinatesOf(candidate)) {
    throw new TypeError("scoreExistingServiceGap requires a valid candidate coordinate.");
  }
  const radius = Math.max(0.001, numericValue(searchRadiusKm) ?? 10);
  const idealGap = Math.max(0.001, numericValue(idealGapKm) ?? radius / 2);
  const saturation = Math.max(1, numericValue(saturationCount) ?? 3);
  const distanceShare = clamp(numericValue(distanceWeight) ?? 0.65, 0, 1);
  const terms = serviceTerms(serviceType, serviceAliases);
  const pois = (Array.isArray(pointsOfInterest) ? pointsOfInterest : [])
    .flatMap((poi, index) => {
      if (!coordinatesOf(poi)) return [];
      const text = serviceText(poi);
      if (terms.length && !terms.some((term) => text.includes(term))) return [];
      const distanceKm = haversineDistance(candidate, poi);
      return [{
        poi,
        poiId: String(poi.id ?? poi.osmId ?? poi.name ?? index + 1),
        name: String(poi.name ?? poi.facilityType ?? poi.category ?? "Existing service"),
        distanceKm,
      }];
    })
    .sort((first, second) => first.distanceKm - second.distanceKm);
  const nearby = pois.filter((item) => item.distanceKm <= radius);
  const nearestDistanceKm = pois[0]?.distanceKm ?? null;
  const distanceScore = nearestDistanceKm === null
    ? 100
    : clamp(nearestDistanceKm / idealGap * 100, 0, 100);
  const scarcityScore = clamp((1 - nearby.length / saturation) * 100, 0, 100);
  const gapScore = distanceScore * distanceShare +
    scarcityScore * (1 - distanceShare);
  const bands = [...new Set(proximityBandsKm
    .map(numericValue)
    .filter((value) => value !== null && value >= 0))]
    .sort((first, second) => first - second)
    .map((distanceKm) => ({
      distanceKm,
      serviceCount: pois.filter((item) => item.distanceKm <= distanceKm).length,
    }));

  return {
    serviceType: serviceType || "pre-filtered services",
    gapScore: round(gapScore, 1),
    rating: gapScore >= 75 ? "large gap" : gapScore >= 50 ? "moderate gap" :
      gapScore >= 25 ? "limited gap" : "well served",
    nearestDistanceKm: round(nearestDistanceKm, 2),
    nearbyServiceCount: nearby.length,
    matchingServiceCount: pois.length,
    searchRadiusKm: radius,
    distanceScore: round(distanceScore, 1),
    scarcityScore: round(scarcityScore, 1),
    proximityBands: bands,
    nearestServices: pois.slice(0, 5).map((item) => ({
      poiId: item.poiId,
      name: item.name,
      distanceKm: round(item.distanceKm, 2),
    })),
  };
}

function startOfBucket(timestamp, bucket) {
  const date = new Date(timestamp);
  if (bucket === "month") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  if (bucket === "day") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const mondayOffset = (new Date(dayStart).getUTCDay() + 6) % 7;
  return dayStart - mondayOffset * DAY_MS;
}

function shiftBucket(timestamp, bucket, count) {
  const date = new Date(timestamp);
  if (bucket === "month") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1);
  }
  return timestamp + count * (bucket === "day" ? DAY_MS : 7 * DAY_MS);
}

function reportRegionId(report) {
  return String(report?.region?.id ?? report?.regionId ?? report?.region ?? "");
}

/**
 * Aggregates reports into UTC day/week/month buckets and compares the latest
 * window with its preceding window. By default the series ends at the newest
 * report, making historical datasets useful; pass endDate for live monitoring.
 */
export function aggregateTimeTrends(
  reports,
  {
    bucket = "week",
    lookbackPeriods = 8,
    comparisonPeriods = 2,
    dateField = "submittedAt",
    endDate,
    category,
    regionId,
    urgencyWeights = DEFAULT_URGENCY_WEIGHTS,
    changeThresholdPercent = 15,
  } = {},
) {
  const period = ["day", "week", "month"].includes(bucket) ? bucket : "week";
  const periodCount = Math.max(2, Math.floor(numericValue(lookbackPeriods) ?? 8));
  const comparisonCount = clamp(
    Math.floor(numericValue(comparisonPeriods) ?? 2),
    1,
    Math.floor(periodCount / 2),
  );
  const sourceReports = Array.isArray(reports) ? reports : [];
  const scopedReports = sourceReports.filter((report) => {
    if (category && report?.category !== category) return false;
    if (regionId && reportRegionId(report) !== String(regionId)) return false;
    return true;
  });
  const filtered = scopedReports.flatMap((report) => {
    const timestamp = timestampOf(report?.[dateField]);
    return timestamp === null ? [] : [{ report, timestamp }];
  });
  const explicitEnd = timestampOf(endDate);
  const newestTimestamp = filtered.length
    ? Math.max(...filtered.map((item) => item.timestamp))
    : Date.now();
  const endBucket = startOfBucket(explicitEnd ?? newestTimestamp, period);
  const firstBucket = shiftBucket(endBucket, period, -(periodCount - 1));
  const series = Array.from({ length: periodCount }, (_, index) => {
    const start = shiftBucket(firstBucket, period, index);
    return {
      start,
      end: shiftBucket(start, period, 1),
      label: new Date(start).toISOString().slice(0, period === "month" ? 7 : 10),
      reportCount: 0,
      urgencyScore: 0,
      highUrgencyCount: 0,
    };
  });

  filtered.forEach(({ report, timestamp }) => {
    if (timestamp < firstBucket || timestamp >= series.at(-1).end) return;
    const bucketStart = startOfBucket(timestamp, period);
    const target = series.find((entry) => entry.start === bucketStart);
    if (!target) return;
    target.reportCount += 1;
    target.urgencyScore += urgencyWeight(report, urgencyWeights);
    if (String(report.severity ?? report.urgency).toLowerCase() === "high") {
      target.highUrgencyCount += 1;
    }
  });

  const previous = series.slice(-(comparisonCount * 2), -comparisonCount);
  const recent = series.slice(-comparisonCount);
  const sumField = (entries, field) => entries.reduce(
    (sum, entry) => sum + entry[field],
    0,
  );
  const previousCount = sumField(previous, "reportCount");
  const recentCount = sumField(recent, "reportCount");
  const previousUrgencyScore = sumField(previous, "urgencyScore");
  const recentUrgencyScore = sumField(recent, "urgencyScore");
  const changePercent = previousCount
    ? (recentCount - previousCount) / previousCount * 100
    : recentCount ? null : 0;
  const scoreChangePercent = previousUrgencyScore
    ? (recentUrgencyScore - previousUrgencyScore) / previousUrgencyScore * 100
    : recentUrgencyScore ? null : 0;
  const threshold = Math.max(0, numericValue(changeThresholdPercent) ?? 15);
  const direction = previousCount === 0 && recentCount > 0
    ? "new"
    : changePercent > threshold
      ? "rising"
      : changePercent < -threshold
        ? "falling"
        : "stable";

  return {
    bucket: period,
    dateField,
    validDatedReports: filtered.length,
    excludedUndatedReports: scopedReports.length - filtered.length,
    series: series.map((entry) => ({
      ...entry,
      start: new Date(entry.start).toISOString(),
      end: new Date(entry.end).toISOString(),
      urgencyScore: round(entry.urgencyScore, 2),
    })),
    comparison: {
      periodsPerWindow: comparisonCount,
      previousReportCount: previousCount,
      recentReportCount: recentCount,
      reportChange: recentCount - previousCount,
      reportChangePercent: round(changePercent, 1),
      previousUrgencyScore: round(previousUrgencyScore, 2),
      recentUrgencyScore: round(recentUrgencyScore, 2),
      urgencyChangePercent: round(scoreChangePercent, 1),
      direction,
    },
  };
}

function wordSet(text) {
  return new Set(normalizedText(text).split(" ").filter((word) => word.length > 1));
}

function jaccardSimilarity(firstSet, secondSet) {
  if (!firstSet.size || !secondSet.size) return 0;
  let intersection = 0;
  firstSet.forEach((value) => {
    if (secondSet.has(value)) intersection += 1;
  });
  return intersection / (firstSet.size + secondSet.size - intersection);
}

function ngrams(text, length = 3) {
  const compact = normalizedText(text).replaceAll(" ", "");
  if (!compact) return new Set();
  if (compact.length <= length) return new Set([compact]);
  return new Set(Array.from(
    { length: compact.length - length + 1 },
    (_, index) => compact.slice(index, index + length),
  ));
}

/**
 * Returns a 0..1 duplicate likelihood using summary, location, time, and
 * category evidence. Missing optional evidence is omitted from the weighting.
 */
export function calculateDuplicateSimilarity(
  firstReport,
  secondReport,
  {
    textWeight = 0.55,
    locationWeight = 0.25,
    timeWeight = 0.1,
    categoryWeight = 0.1,
    spatialDecayKm = 1,
    temporalDecayDays = 14,
    duplicateThreshold = 0.72,
  } = {},
) {
  const firstSummary = firstReport?.summary ?? firstReport?.description ?? "";
  const secondSummary = secondReport?.summary ?? secondReport?.description ?? "";
  const wordSimilarity = jaccardSimilarity(wordSet(firstSummary), wordSet(secondSummary));
  const characterSimilarity = jaccardSimilarity(ngrams(firstSummary), ngrams(secondSummary));
  const textSimilarity = wordSimilarity * 0.65 + characterSimilarity * 0.35;
  const firstCoordinates = coordinatesOf(firstReport);
  const secondCoordinates = coordinatesOf(secondReport);
  const distanceKm = firstCoordinates && secondCoordinates
    ? haversineDistance(firstCoordinates, secondCoordinates)
    : null;
  const locationSimilarity = distanceKm === null
    ? null
    : Math.exp(-distanceKm / Math.max(0.001, spatialDecayKm));
  const firstTime = timestampOf(firstReport?.submittedAt ?? firstReport?.createdAt);
  const secondTime = timestampOf(secondReport?.submittedAt ?? secondReport?.createdAt);
  const timeDifferenceDays = firstTime !== null && secondTime !== null
    ? Math.abs(firstTime - secondTime) / DAY_MS
    : null;
  const timeSimilarity = timeDifferenceDays === null
    ? null
    : Math.exp(-timeDifferenceDays / Math.max(0.001, temporalDecayDays));
  const firstCategory = normalizedText(firstReport?.category);
  const secondCategory = normalizedText(secondReport?.category);
  const categorySimilarity = firstCategory && secondCategory
    ? Number(firstCategory === secondCategory)
    : null;
  const components = [
    { name: "text", score: textSimilarity, weight: Math.max(0, textWeight) },
    { name: "location", score: locationSimilarity, weight: Math.max(0, locationWeight) },
    { name: "time", score: timeSimilarity, weight: Math.max(0, timeWeight) },
    { name: "category", score: categorySimilarity, weight: Math.max(0, categoryWeight) },
  ].filter((component) => component.score !== null && component.weight > 0);
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = totalWeight
    ? components.reduce(
      (sum, component) => sum + component.score * component.weight,
      0,
    ) / totalWeight
    : 0;
  const reasons = [];
  if (textSimilarity >= 0.75) reasons.push("very similar report text");
  if (distanceKm !== null && distanceKm <= 0.25) reasons.push("locations within 250 m");
  if (timeDifferenceDays !== null && timeDifferenceDays <= 1) reasons.push("submitted within one day");
  if (categorySimilarity === 1) reasons.push("same category");

  return {
    score: round(score, 3),
    likelyDuplicate: score >= duplicateThreshold,
    threshold: duplicateThreshold,
    textSimilarity: round(textSimilarity, 3),
    wordSimilarity: round(wordSimilarity, 3),
    characterSimilarity: round(characterSimilarity, 3),
    locationSimilarity: round(locationSimilarity, 3),
    timeSimilarity: round(timeSimilarity, 3),
    categorySimilarity,
    distanceKm: round(distanceKm, 3),
    timeDifferenceDays: round(timeDifferenceDays, 2),
    reasons,
  };
}

/** Finds likely duplicate pairs, sorted by descending similarity. */
export function findPotentialDuplicates(
  reports,
  { threshold = 0.72, maximumPairs = 250, ...similarityOptions } = {},
) {
  const source = Array.isArray(reports) ? reports : [];
  const pairs = [];
  for (let firstIndex = 0; firstIndex < source.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < source.length; secondIndex += 1) {
      const similarity = calculateDuplicateSimilarity(
        source[firstIndex],
        source[secondIndex],
        { ...similarityOptions, duplicateThreshold: threshold },
      );
      if (similarity.likelyDuplicate) {
        pairs.push({
          firstReportId: String(source[firstIndex].id ?? firstIndex + 1),
          secondReportId: String(source[secondIndex].id ?? secondIndex + 1),
          ...similarity,
        });
      }
    }
  }
  return pairs
    .sort((first, second) => second.score - first.score)
    .slice(0, Math.max(0, Math.floor(maximumPairs)));
}

/**
 * Scores report completeness and usability from 0..100. `duplicateScore` is an
 * optional 0..1 score from calculateDuplicateSimilarity/findPotentialDuplicates.
 */
export function scoreReportQuality(report, { duplicateScore = 0 } = {}) {
  const summary = String(report?.summary ?? report?.description ?? "").trim();
  const words = normalizedText(summary).split(" ").filter(Boolean);
  const uniqueWordRatio = words.length ? new Set(words).size / words.length : 0;
  const issues = [];
  let score = 0;

  if (summary.length >= 80) score += 40;
  else if (summary.length >= 30) score += 32;
  else if (summary.length >= 15) score += 22;
  else if (summary.length > 0) {
    score += 10;
    issues.push("Description is too short to explain the need clearly.");
  } else {
    issues.push("Description is missing.");
  }

  if (normalizedText(report?.category)) score += 15;
  else issues.push("Category is missing.");
  if (["low", "medium", "high"].includes(
    normalizedText(report?.severity ?? report?.urgency),
  )) score += 10;
  else issues.push("Urgency is missing or invalid.");
  if (coordinatesOf(report)) score += 20;
  else issues.push("Location is missing or invalid.");
  if (timestampOf(report?.submittedAt ?? report?.createdAt) !== null) score += 10;
  else issues.push("Submission time is missing or invalid.");
  if (words.length >= 6 && uniqueWordRatio >= 0.55) score += 5;
  else if (summary) issues.push("Description has limited specific detail.");

  if (/(.)\1{6,}/i.test(summary)) {
    score -= 15;
    issues.push("Description contains repeated-character noise.");
  }
  const urlCount = (summary.match(/https?:\/\//gi) || []).length;
  if (urlCount >= 2) {
    score -= 10;
    issues.push("Description contains multiple links and may need moderation.");
  }
  const duplicate = clamp(numericValue(duplicateScore) ?? 0, 0, 1);
  if (duplicate >= 0.72) {
    score -= duplicate * 25;
    issues.push("Report closely resembles another submission.");
  }
  const finalScore = clamp(score, 0, 100);

  return {
    score: round(finalScore, 1),
    rating: finalScore >= 80 ? "high" : finalScore >= 55 ? "medium" : "low",
    issues,
    checks: {
      descriptionLength: summary.length,
      wordCount: words.length,
      uniqueWordRatio: round(uniqueWordRatio, 2),
      hasCategory: Boolean(normalizedText(report?.category)),
      hasValidUrgency: ["low", "medium", "high"].includes(
        normalizedText(report?.severity ?? report?.urgency),
      ),
      hasValidLocation: Boolean(coordinatesOf(report)),
      hasValidTimestamp: timestampOf(report?.submittedAt ?? report?.createdAt) !== null,
      duplicateScore: duplicate,
    },
  };
}

function thresholdMetric(coverage, mode, minutes) {
  const thresholds = coverage.modes[mode]?.thresholds || [];
  return thresholds.find((item) => item.minutes === minutes) ||
    thresholds.reduce((closest, item) => (
      !closest || Math.abs(item.minutes - minutes) < Math.abs(closest.minutes - minutes)
        ? item
        : closest
    ), null);
}

function scoreLike(value, fallback = 50) {
  const number = numericValue(value);
  if (number === null) return fallback;
  return clamp(number <= 1 ? number * 100 : number, 0, 100);
}

/**
 * Ranks placement scenarios. Each scenario can contain candidate/position,
 * serviceType, existingServices, feasibilityScore, costScore, and estimatedCost.
 */
export function compareScenarios(
  scenarios,
  reports,
  {
    coverageMode = "drive",
    coverageThresholdMinutes = 15,
    travelProfiles = {},
    urgencyWeights = DEFAULT_URGENCY_WEIGHTS,
    existingServices = [],
    weights = { coverage: 0.45, serviceGap: 0.25, feasibility: 0.2, cost: 0.1 },
    serviceGapOptions = {},
  } = {},
) {
  const source = Array.isArray(scenarios) ? scenarios : [];
  const costs = source.map((scenario) => numericValue(scenario.estimatedCost))
    .filter((value) => value !== null && value >= 0);
  const minimumCost = costs.length ? Math.min(...costs) : null;
  const maximumCost = costs.length ? Math.max(...costs) : null;
  const normalizedWeights = Object.fromEntries(Object.entries(weights)
    .map(([key, value]) => [key, Math.max(0, numericValue(value) ?? 0)]));
  const weightTotal = Object.values(normalizedWeights).reduce((sum, value) => sum + value, 0) || 1;

  const evaluated = source.flatMap((scenario, index) => {
    const candidate = scenario.candidate ?? scenario.position ?? scenario;
    if (!coordinatesOf(candidate)) return [];
    const threshold = Math.max(0, numericValue(coverageThresholdMinutes) ?? 15);
    const coverage = calculateCoverageMetrics(candidate, reports, {
      thresholdsMinutes: [threshold],
      travelProfiles,
      urgencyWeights,
    });
    const selectedMode = coverage.modes[coverageMode]
      ? coverageMode
      : Object.keys(coverage.modes)[0];
    const covered = thresholdMetric(coverage, selectedMode, threshold);
    const serviceGap = scoreExistingServiceGap(
      candidate,
      scenario.existingServices ?? existingServices,
      {
        ...serviceGapOptions,
        serviceType: scenario.serviceType ?? serviceGapOptions.serviceType ?? "",
      },
    );
    const estimatedCost = numericValue(scenario.estimatedCost);
    const derivedCostScore = estimatedCost === null
      ? 50
      : minimumCost === maximumCost
        ? 75
        : 100 - (estimatedCost - minimumCost) / (maximumCost - minimumCost) * 100;
    const componentScores = {
      coverage: covered?.urgencyPercent ?? 0,
      serviceGap: serviceGap.gapScore,
      feasibility: scoreLike(scenario.feasibilityScore),
      cost: scenario.costScore === undefined
        ? derivedCostScore
        : scoreLike(scenario.costScore),
    };
    const totalScore = Object.entries(componentScores).reduce(
      (sum, [key, value]) => sum + value * (normalizedWeights[key] || 0),
      0,
    ) / weightTotal;
    const strengths = Object.entries(componentScores)
      .filter(([, value]) => value >= 70)
      .sort((first, second) => second[1] - first[1])
      .map(([key]) => key);
    const tradeoffs = Object.entries(componentScores)
      .filter(([, value]) => value < 50)
      .sort((first, second) => first[1] - second[1])
      .map(([key]) => key);

    return [{
      id: String(scenario.id ?? `scenario-${index + 1}`),
      name: String(scenario.name ?? `Scenario ${index + 1}`),
      candidate: coordinatesOf(candidate),
      score: round(totalScore, 1),
      componentScores: Object.fromEntries(
        Object.entries(componentScores).map(([key, value]) => [key, round(value, 1)]),
      ),
      coverageMode: selectedMode,
      coverageThresholdMinutes: threshold,
      coveredReportCount: covered?.reportCount ?? 0,
      coveredReportPercent: covered?.reportPercent ?? 0,
      coveredUrgencyPercent: covered?.urgencyPercent ?? 0,
      averageTravelMinutes: coverage.modes[selectedMode]?.averageMinutes ?? 0,
      medianDistanceKm: coverage.medianDistanceKm,
      serviceGap,
      feasibilityScore: componentScores.feasibility,
      costScore: round(componentScores.cost, 1),
      estimatedCost,
      strengths,
      tradeoffs,
      coverage,
    }];
  });
  const ranked = evaluated
    .sort((first, second) => second.score - first.score)
    .map((scenario, index) => ({ ...scenario, rank: index + 1 }));

  return {
    ranked,
    bestScenarioId: ranked[0]?.id ?? null,
    evaluatedScenarioCount: ranked.length,
    excludedScenarioCount: source.length - ranked.length,
    weights: normalizedWeights,
  };
}

function valueAtPath(record, path) {
  return String(path).split(".").reduce(
    (value, key) => value === null || value === undefined ? undefined : value[key],
    record,
  );
}

function csvValue(value, preventFormulaInjection) {
  let normalized = value;
  if (value instanceof Date) normalized = value.toISOString();
  else if (Array.isArray(value) || (value && typeof value === "object")) {
    normalized = JSON.stringify(value);
  }
  if (normalized === null || normalized === undefined) normalized = "";
  let text = String(normalized);
  if (
    preventFormulaInjection && typeof value === "string" &&
    /^[\t\r ]*[=+\-@]/.test(text)
  ) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Serializes object rows to RFC-4180-style CSV. Columns may be property-path
 * strings or { key, label, format(value, row) } objects.
 */
export function serializeCsv(
  rows,
  {
    columns,
    includeHeader = true,
    includeBom = false,
    lineEnding = "\r\n",
    preventFormulaInjection = true,
  } = {},
) {
  const source = Array.isArray(rows) ? rows : [];
  const inferredKeys = [...new Set(source.flatMap((row) =>
    row && typeof row === "object" ? Object.keys(row) : []))];
  const definitions = (columns || inferredKeys).map((column) => (
    typeof column === "string"
      ? { key: column, label: column }
      : { key: column.key, label: column.label ?? column.key, format: column.format }
  )).filter((column) => column.key);
  const lines = [];
  if (includeHeader && definitions.length) {
    lines.push(definitions.map((column) =>
      csvValue(column.label, preventFormulaInjection)).join(","));
  }
  source.forEach((row) => {
    lines.push(definitions.map((column) => {
      const value = valueAtPath(row, column.key);
      const formatted = typeof column.format === "function"
        ? column.format(value, row)
        : value;
      return csvValue(formatted, preventFormulaInjection);
    }).join(","));
  });
  return `${includeBom ? "\uFEFF" : ""}${lines.join(lineEnding)}`;
}

function compareThreshold(actual, operator, expected) {
  if (operator === "gt") return actual > expected;
  if (operator === "lt") return actual < expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "eq") return actual === expected;
  if (operator === "neq") return actual !== expected;
  if (operator === "between") {
    return Array.isArray(expected) && actual >= expected[0] && actual <= expected[1];
  }
  if (operator === "outside") {
    return Array.isArray(expected) && (actual < expected[0] || actual > expected[1]);
  }
  return actual >= expected;
}

/**
 * Evaluates declarative threshold rules against a metrics object. Rule shape:
 * { id, metric: "path.to.value", operator: "gte", value, severity, message }.
 */
export function evaluateAlertThresholds(metrics, rules) {
  const sourceRules = Array.isArray(rules) ? rules : [];
  const results = sourceRules.map((rule, index) => {
    const actual = valueAtPath(metrics, rule.metric);
    const operator = rule.operator || "gte";
    const triggered = actual !== undefined && actual !== null &&
      compareThreshold(actual, operator, rule.value);
    return {
      id: String(rule.id ?? `rule-${index + 1}`),
      metric: rule.metric,
      operator,
      expected: rule.value,
      actual,
      triggered,
      severity: rule.severity || "notice",
      message: rule.message || `${rule.metric} is ${actual}.`,
    };
  });
  const triggered = results.filter((result) => result.triggered);
  const severityOrder = { critical: 4, high: 3, warning: 2, notice: 1 };
  triggered.sort((first, second) =>
    (severityOrder[second.severity] || 0) - (severityOrder[first.severity] || 0));

  return {
    triggered,
    results,
    triggeredCount: triggered.length,
    evaluatedCount: results.length,
    hasAlerts: triggered.length > 0,
  };
}

/**
 * Creates region/category alerts for urgent volume or a recent trend spike.
 * Reports should contain region.id (or regionId), category, severity, and date.
 */
export function evaluateNeedAlerts(
  reports,
  {
    minimumReports = 3,
    minimumUrgencyScore = 7,
    minimumHighUrgencyReports = 2,
    spikePercent = 50,
    trendOptions = {},
    urgencyWeights = DEFAULT_URGENCY_WEIGHTS,
  } = {},
) {
  const groups = new Map();
  (Array.isArray(reports) ? reports : []).forEach((report) => {
    const regionId = reportRegionId(report) || "unassigned";
    const regionName = String(report?.region?.name ?? report?.regionName ?? regionId);
    const category = String(report?.category ?? "other");
    const key = `${regionId}\u0000${category}`;
    if (!groups.has(key)) groups.set(key, { regionId, regionName, category, reports: [] });
    groups.get(key).reports.push(report);
  });

  return [...groups.values()].flatMap((group) => {
    const urgencyScore = group.reports.reduce(
      (sum, report) => sum + urgencyWeight(report, urgencyWeights),
      0,
    );
    const highUrgencyCount = group.reports.filter((report) =>
      normalizedText(report.severity ?? report.urgency) === "high").length;
    const trend = aggregateTimeTrends(group.reports, {
      ...trendOptions,
      urgencyWeights,
    });
    const metrics = {
      reportCount: group.reports.length,
      urgencyScore,
      highUrgencyCount,
      trend,
    };
    const spikeMessage = trend.comparison.reportChangePercent === null
      ? "Recent report activity appeared after a period with no reports."
      : `Recent report volume increased by ${trend.comparison.reportChangePercent}% compared with the previous period.`;
    const thresholdResult = evaluateAlertThresholds(metrics, [
      {
        id: "report-volume",
        metric: "reportCount",
        operator: "gte",
        value: minimumReports,
        severity: "warning",
        message: `${group.reports.length} reports have accumulated in this need group.`,
      },
      {
        id: "urgency-score",
        metric: "urgencyScore",
        operator: "gte",
        value: minimumUrgencyScore,
        severity: "high",
        message: `Urgency score reached ${round(urgencyScore, 1)}.`,
      },
      {
        id: "high-urgency-volume",
        metric: "highUrgencyCount",
        operator: "gte",
        value: minimumHighUrgencyReports,
        severity: "critical",
        message: `${highUrgencyCount} reports are marked high urgency.`,
      },
      {
        id: "recent-spike",
        metric: "trend.comparison.reportChangePercent",
        operator: "gte",
        value: spikePercent,
        severity: "high",
        message: spikeMessage,
      },
    ]);
    if (!thresholdResult.hasAlerts) return [];
    const priorityOrder = { critical: 4, high: 3, warning: 2, notice: 1 };
    const priority = thresholdResult.triggered.reduce(
      (highest, alert) => priorityOrder[alert.severity] > priorityOrder[highest]
        ? alert.severity
        : highest,
      "notice",
    );
    return [{
      id: `${group.regionId}:${group.category}`,
      regionId: group.regionId,
      regionName: group.regionName,
      category: group.category,
      priority,
      reportCount: group.reports.length,
      urgencyScore: round(urgencyScore, 1),
      highUrgencyCount,
      trend,
      alerts: thresholdResult.triggered,
    }];
  }).sort((first, second) => {
    const order = { critical: 4, high: 3, warning: 2, notice: 1 };
    return (order[second.priority] - order[first.priority]) ||
      second.urgencyScore - first.urgencyScore;
  });
}

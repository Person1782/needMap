import { pointInGeometry } from "./regions.js";
import { categoryForReport } from "./analysis-model.js";

const EARTH_RADIUS_KM = 6371.0088;

export const MIN_CLUSTER_SIZE = 2;
export const MAX_SERVICE_LOCATIONS = 3;
export const MIN_LOCATION_SEPARATION_KM = 0.25;
const MIN_SPLIT_IMPROVEMENT = 0.25;

export const severityWeights = {
  low: 1,
  medium: 1.17,
  high: 2,
};

function toRadians(value) {
  return value * Math.PI / 180;
}

export function isRecommendationEvidence(signal, { includeDemonstrationReports = false } = {}) {
  return Boolean(signal && (signal.isSynthetic !== true || includeDemonstrationReports === true) &&
    Number.isFinite(signal.latitude) && Number.isFinite(signal.longitude) &&
    Math.abs(signal.latitude) <= 90 && Math.abs(signal.longitude) <= 180);
}

function signalWeight(signal) {
  return Object.hasOwn(severityWeights, signal.severity) ? severityWeights[signal.severity] : 1;
}

function longitudeDifference(longitude, reference) {
  return ((longitude - reference + 540) % 360) - 180;
}

function compareText(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function reportKey(signal) {
  return JSON.stringify([
    typeof signal.id === "string" ? signal.id : "",
    signal.latitude, signal.longitude, signal.severity || "", signal.summary || "",
  ]);
}

function geographicDistance(first, second) {
  const latitudeDifference = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(longitudeDifference(second.longitude, first.longitude));
  const haversine = Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(toRadians(first.latitude)) * Math.cos(toRadians(second.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

function positionInRegion(position, region) {
  return pointInGeometry(position.longitude, position.latitude, region.geometry) &&
    (!region.excludedGeometry || !pointInGeometry(position.longitude, position.latitude, region.excludedGeometry));
}

function groupSignalsByRegionAndCategory(signals, options) {
  const groups = new Map();

  const seenReports = new Set();
  signals.filter((signal) => isRecommendationEvidence(signal, options))
    .sort((first, second) => Number(first.isSynthetic === true) - Number(second.isSynthetic === true) ||
      compareText(reportKey(first), reportKey(second)))
    .forEach((signal) => {
    if (!signal.region?.id || !signal.region.geometry ||
        !positionInRegion(signal, signal.region)) return;
    const identity = typeof signal.id === "string" && signal.id ? `id:${signal.id}` : reportKey(signal);
    if (seenReports.has(identity)) return;
    seenReports.add(identity);
    const category = categoryForReport(signal);
    const key = `${signal.region.id}:${category}`;
    if (!groups.has(key)) {
      groups.set(key, {
        category,
        region: signal.region,
        signals: [],
      });
    }
    groups.get(key).signals.push(signal);
  });

  return [...groups.values()];
}

function clusterPosition(cluster) {
  // Grouping has already applied the caller's evidence mode. Use every accepted
  // report here so demo-mode counts, urgency weights, and coordinates agree.
  return constrainPositionToRegion(weightedGeographicCenter(cluster.signals, {
    includeDemonstrationReports: true,
  }), cluster);
}

function placementCost(cluster, position) {
  return cluster.signals.reduce((sum, signal) =>
    sum + signalWeight(signal) * geographicDistance(signal, position), 0);
}

function maxSupportingDistance(cluster, position = clusterPosition(cluster)) {
  return cluster.signals.reduce((maximum, signal) =>
    Math.max(maximum, geographicDistance(signal, position)), 0);
}

function clusterSignature(cluster) {
  return JSON.stringify(cluster.signals.map((signal) =>
    typeof signal.id === "string" && signal.id ? `id:${signal.id}` : reportKey(signal)).sort(compareText));
}

function locationId(cluster) {
  // Two independent 32-bit hashes keep IDs compact and independent of input order.
  const signature = clusterSignature(cluster);
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < signature.length; index += 1) {
    const code = signature.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function bestSupportedSplit(cluster, minimumSize) {
  if (cluster.signals.length < minimumSize * 2) return null;
  const originalCost = placementCost(cluster, clusterPosition(cluster));
  if (originalCost < 0.000001) return null;
  const referenceLongitude = cluster.signals[0].longitude;
  const axes = [
    (signal) => signal.latitude,
    (signal) => longitudeDifference(signal.longitude, referenceLongitude),
  ];
  let best;
  for (const value of axes) {
    const ordered = [...cluster.signals].sort((first, second) =>
      value(first) - value(second) || compareText(reportKey(first), reportKey(second)));
    const gaps = [];
    for (let index = minimumSize; index <= ordered.length - minimumSize; index += 1) {
      const gap = value(ordered[index]) - value(ordered[index - 1]);
      if (gap > 0) gaps.push({ index, gap });
    }
    // Bound work on older devices: evaluate the strongest gaps and a balanced cut.
    const cuts = new Set(gaps.sort((first, second) =>
      second.gap - first.gap || first.index - second.index).slice(0, 4).map(({ index }) => index));
    const midpoint = Math.floor(ordered.length / 2);
    if (value(ordered[midpoint]) > value(ordered[midpoint - 1])) cuts.add(midpoint);
    for (const index of cuts) {
      const parts = [ordered.slice(0, index), ordered.slice(index)]
        .map((signals) => ({ ...cluster, signals }));
      const positions = parts.map(clusterPosition);
      if (geographicDistance(positions[0], positions[1]) < MIN_LOCATION_SEPARATION_KM) continue;
      const cost = parts.reduce((sum, part, partIndex) => sum + placementCost(part, positions[partIndex]), 0);
      const improvement = originalCost - cost;
      if (improvement / originalCost < MIN_SPLIT_IMPROVEMENT) continue;
      const signature = parts.map(clusterSignature).sort(compareText).join("::");
      if (!best || improvement > best.improvement + 0.000001 ||
          (Math.abs(improvement - best.improvement) <= 0.000001 && signature < best.signature)) {
        best = { parts, improvement, signature };
      }
    }
  }
  return best;
}

function supportedLocations(group, minimumSize) {
  const clusters = [group];
  while (clusters.length < MAX_SERVICE_LOCATIONS) {
    let selected;
    clusters.forEach((cluster, index) => {
      const split = bestSupportedSplit(cluster, minimumSize);
      if (!split) return;
      // A new split must remain distinct from every existing location as well.
      const otherPositions = clusters.filter((_, candidateIndex) => candidateIndex !== index).map(clusterPosition);
      if (split.parts.some((part) => otherPositions.some((position) =>
        geographicDistance(clusterPosition(part), position) < MIN_LOCATION_SEPARATION_KM))) return;
      if (!selected || split.improvement > selected.improvement + 0.000001 ||
          (Math.abs(split.improvement - selected.improvement) <= 0.000001 && split.signature < selected.signature)) {
        selected = { ...split, index };
      }
    });
    if (!selected) break;
    clusters.splice(selected.index, 1, ...selected.parts);
  }
  return clusters;
}

export function weightedGeographicCenter(signals, options) {
  const reports = (Array.isArray(signals) ? signals : []).filter((signal) => isRecommendationEvidence(signal, options))
    .sort((a, b) => compareText(reportKey(a), reportKey(b)));
  if (!reports.length) throw new RangeError("At least one valid report location is required.");
  let x = 0, y = 0, z = 0;
  for (const report of reports) {
    const latitude = toRadians(report.latitude), longitude = toRadians(report.longitude);
    const weight = signalWeight(report);
    x += weight * Math.cos(latitude) * Math.cos(longitude);
    y += weight * Math.cos(latitude) * Math.sin(longitude);
    z += weight * Math.sin(latitude);
  }
  // The spherical average avoids longitude discontinuities at the date line
  // and distortion near the poles. A median would still snap to the heavier
  // member of a pair even with a modest difference in urgency weights.
  if (Math.hypot(x, y, z) < 1e-12) {
    // Antipodal points have no unique average. Keep this calculation finite;
    // the enclosing region still constrains the resulting planning point.
    return { latitude: reports[0].latitude, longitude: reports[0].longitude };
  }
  return {
    latitude: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI,
    longitude: longitudeDifference(Math.atan2(y, x) * 180 / Math.PI, 0),
  };
}

export function weightedGeometricMedian(signals, options) {
  signals = Array.isArray(signals) ? signals.filter((signal) => isRecommendationEvidence(signal, options)) : [];
  if (!signals.length) throw new RangeError("At least one valid report location is required.");
  const totalWeight = signals.reduce(
    (sum, signal) => sum + signalWeight(signal),
    0,
  );
  const referenceLatitude = signals.reduce(
    (sum, signal) => sum + signal.latitude,
    0,
  ) / signals.length;
  const referenceLongitude = signals[0].longitude;
  const longitudeScale = Math.max(1e-8, Math.cos(toRadians(referenceLatitude)));
  const points = signals.map((signal) => ({
    x: toRadians(longitudeDifference(signal.longitude, referenceLongitude)) * EARTH_RADIUS_KM * longitudeScale,
    y: toRadians(signal.latitude) * EARTH_RADIUS_KM,
    weight: signalWeight(signal),
  }));

  let x = points.reduce((sum, point) => sum + point.x * point.weight, 0) / totalWeight;
  let y = points.reduce((sum, point) => sum + point.y * point.weight, 0) / totalWeight;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    let weightedX = 0;
    let weightedY = 0;
    let weightSum = 0;
    let coincidentWeight = 0;
    let residualX = 0;
    let residualY = 0;

    for (const point of points) {
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < 0.000001) {
        coincidentWeight += point.weight;
        continue;
      }

      const adjustedWeight = point.weight / distance;
      weightedX += point.x * adjustedWeight;
      weightedY += point.y * adjustedWeight;
      weightSum += adjustedWeight;
      residualX += (point.x - x) * adjustedWeight;
      residualY += (point.y - y) * adjustedWeight;
    }

    const residualLength = Math.hypot(residualX, residualY);
    if (!weightSum || residualLength <= coincidentWeight) break;
    // Modified Weiszfeld update: a coincident report is only a solution when its
    // weight balances the remaining reports. Merely hitting it is not enough.
    const retainedWeight = coincidentWeight / residualLength;
    const nextX = (1 - retainedWeight) * weightedX / weightSum + retainedWeight * x;
    const nextY = (1 - retainedWeight) * weightedY / weightSum + retainedWeight * y;
    if (Math.hypot(nextX - x, nextY - y) < 0.00001) {
      x = nextX;
      y = nextY;
      break;
    }

    x = nextX;
    y = nextY;
  }

  return {
    latitude: y / EARTH_RADIUS_KM * 180 / Math.PI,
    longitude: longitudeDifference(
      referenceLongitude + x / (EARTH_RADIUS_KM * longitudeScale) * 180 / Math.PI, 0,
    ),
  };
}

export function inferServiceNeed(candidate) {
  const category = categoryForReport(candidate);
  const demonstrationReportCount = candidate.signals.filter((signal) => signal.isSynthetic === true).length;
  const evidenceDescription = demonstrationReportCount
    ? `${demonstrationReportCount} demonstration and ${candidate.signals.length - demonstrationReportCount} non-demo reports`
    : `${candidate.signals.length} non-demo reports`;
  const text = candidate.signals
    .map((signal) => signal.summary || "")
    .join(" ")
    .toLowerCase();
  const rules = [
    { categories: ["fuel", "other"], pattern: /\b(gas|fuel|petrol|refuel|gasoline)\b/, facilityType: "Gas station" },
    { categories: ["transportation"], pattern: /\b(bus|public transit|transit stop|no car|shuttle|ride)\b/, facilityType: "Transit stop or shuttle hub" },
    { categories: ["healthcare"], pattern: /\b(?:pharmac(?:y|ies)|medications?|medicines?|prescriptions?)\b/, facilityType: "Pharmacy" },
    { categories: ["healthcare"], pattern: /\b(doctor|clinic|hospital|medical|health care|healthcare)\b/, facilityType: "Community health clinic" },
    { categories: ["food"], pattern: /\b(grocery|groceries|fresh food|supermarket)\b/, facilityType: "Grocery store" },
    { categories: ["food"], pattern: /\b(food pantry|food bank|meals|hungry)\b/, facilityType: "Food distribution point" },
    { categories: ["broadband"], pattern: /\b(wifi|wi-fi|internet|broadband)\b/, facilityType: "Public internet access point" },
    { categories: ["water"], pattern: /\b(water|drinking water)\b/, facilityType: "Community water station" },
  ];
  const defaults = {
    transportation: "Transit access hub",
    healthcare: "Community health clinic",
    education: "School or education center",
    roads: "Road access improvements",
    food: "Food access center",
    water: "Water and sanitation service point",
    broadband: "Public internet access point",
    emergency_response: "Emergency response station",
    fuel: "Gas station",
    other: "Community service center",
  };
  const match = rules.find((rule) => rule.categories.includes(category) && rule.pattern.test(text));
  const refinedCategory = ["education", "roads"].includes(category);
  const facilityType = candidate.category === "medication_access" ? "Pharmacy"
    : (refinedCategory ? defaults[category] : match?.facilityType) ||
      (Object.hasOwn(defaults, category) ? defaults[category] : null) ||
      "Community service center";
  const severityCounts = candidate.signals.reduce(
    (counts, signal) => ({
      ...counts,
      [signal.severity]: (counts[signal.severity] || 0) + 1,
    }),
    { low: 0, medium: 0, high: 0 },
  );
  const evidence = candidate.signals
    .map((signal) => ({
      reportId: typeof signal.id === "string" ? signal.id : "",
      urgency: signal.severity || "unknown",
      summary: typeof signal.summary === "string"
        ? signal.summary.trim().replaceAll(/\s+/g, " ").slice(0, 500)
        : "",
      relevance: `This ${signal.severity || "unknown"}-urgency report contributes directly to the observed ${category.replaceAll("_", " ")} need.`,
    }))
    .filter((item) => item.reportId && item.summary)
    .sort((first, second) => first.reportId.localeCompare(second.reportId))
    .map((item, index) => ({
      ...item,
      evidenceId: `R${index + 1}`,
      citation: `R${index + 1}`,
    }));
  const priority = severityCounts.high > 0
    ? "high"
    : severityCounts.medium > 0
      ? "medium"
      : "emerging";
  const decisionSummary = demonstrationReportCount
    ? `Demonstration analysis using ${evidenceDescription} within ${candidate.region.name} illustrates a possible ${facilityType.toLowerCase()}. This is not evidence of real local demand.`
    : `${candidate.signals.length} ${category.replaceAll("_", " ")} reports within ${candidate.region.name} indicate repeated demand for a ${facilityType.toLowerCase()}.`;

  return {
    facilityType,
    rationale: decisionSummary,
    decisionSummary,
    needAnalysis: `The local fallback found ${severityCounts.high} high, ${severityCounts.medium} medium, and ${severityCounts.low} low urgency reports in the same named region and category. Repeated reports indicate a pattern worth validating through community outreach and service-capacity data.`,
    placementRationale: `This is location ${candidate.locationRank || 1} of ${candidate.locationCount || 1} supported locations for this service category in ${candidate.region.name}. Each location requires at least two unique ${demonstrationReportCount ? "" : "non-demo "}reports within the selected region; there is no distance cutoff.${demonstrationReportCount ? ` This demonstration uses ${evidenceDescription} and does not establish real local demand.` : ""} Splitting must reduce weighted straight-line distance by at least 25%. Each point is a geographic average constrained to the verified region boundary, with modest urgency weights: low 1, medium 1.17, high 2. Up to three locations, at least 250 meters apart, are ranked by the same lightly weighted report count. This does not establish a globally optimal or build-ready site or verified service coverage.`,
    priority,
    serviceComponents: [
      `Core ${facilityType.toLowerCase()} capacity sized after local demand validation`,
      "Accessible public entry and clearly published service information",
      "A way to monitor usage and collect follow-up community feedback",
    ],
    expectedImpact: [
      `Shorter aggregate travel distance from the reported ${category.replaceAll("_", " ")} needs`,
      "A measurable service response that can be compared with later reports and usage data",
    ],
    implementationSteps: [
      "Validate the report pattern with residents and existing service providers",
      "Check candidate parcels, access, cost, capacity, and regulatory constraints near the suggested point",
      "Run a pilot or feasibility study before committing to permanent construction",
    ],
    risksAndMitigations: [
      {
        risk: "Self-submitted reports may not represent every resident or the full level of demand.",
        mitigation: "Compare the reports with outreach, service usage, and official planning data.",
      },
      {
        risk: "The computed point does not include parcel availability, roads, ownership, cost, or permitting.",
        mitigation: "Treat it as a search center and complete a site feasibility review before selection.",
      },
    ],
    limitations: [
      "The recommendation reflects submitted reports, not a population-wide demand estimate.",
      "The location is an urgency-weighted planning signal, not a build-ready site.",
    ],
    evidence,
    urgencyBreakdown: {
      ...severityCounts,
      weightedScore: candidate.urgencyScore,
      totalReports: candidate.signals.length,
    },
  };
}

function constrainPositionToRegion(position, cluster) {
  if (positionInRegion(position, cluster.region)) {
    return position;
  }

  const longitudeScale = Math.cos(toRadians(position.latitude));
  const closestSignal = cluster.signals.reduce((closest, signal) => {
    const longitudeDistance = longitudeDifference(signal.longitude, position.longitude) * longitudeScale;
    const latitudeDistance = signal.latitude - position.latitude;
    const squaredDistance = longitudeDistance ** 2 + latitudeDistance ** 2;
    return !closest || squaredDistance < closest.squaredDistance
      ? { signal, squaredDistance }
      : closest;
  }, null)?.signal;

  return closestSignal
    ? { latitude: closestSignal.latitude, longitude: closestSignal.longitude }
    : position;
}

export function buildRecommendationsForRegion(signals, region, options = {}) {
  // Scope before replacing report-region metadata. A pending/missing selected
  // boundary must not accidentally fall back to reports from elsewhere.
  if (region?.kind === "world") return buildWorldwideRecommendations(signals, options);
  if (!region?.geometry) return [];
  const scoped = (Array.isArray(signals) ? signals : [])
    .filter((signal) => isRecommendationEvidence(signal, options) && positionInRegion(signal, region))
    .map((signal) => ({ ...signal, region }));
  return buildRecommendations(scoped, options);
}

/** Worldwide combines independently scoped analyses, never a worldwide report pool. */
export function buildWorldwideRecommendations(signals, { analysisRegions = [], ...options } = {}) {
  const reports = Array.isArray(signals) ? signals : [];
  const detailed = buildRecommendations(reports, options);
  const supportKey = (candidate) => JSON.stringify([candidate.category, candidate.signals.map((signal) =>
    typeof signal.id === "string" && signal.id ? `id:${signal.id}` : reportKey(signal)).sort(compareText)]);
  const unique = new Map(detailed.map((candidate) => [supportKey(candidate), candidate]));
  const specificity = (region) => ({ needmap: 0, state: 1, country: 2 })[region.kind] ?? 3;
  const scopes = (Array.isArray(analysisRegions) ? analysisRegions : [])
    .filter((region) => region?.geometry && ["needmap", "state", "country"].includes(region.kind) &&
      typeof region.id === "string" && /^[A-Z]{2}$/.test(region.countryCode || ""))
    .sort((a, b) => specificity(a) - specificity(b) || compareText(a.id, b.id));
  const seenScopes = new Set();
  for (const region of scopes) {
    if (seenScopes.has(region.id)) continue;
    seenScopes.add(region.id);
    // Extra scopes require a verified source assignment in the same country.
    // Coordinate checks still decide membership in the additional boundary.
    const scoped = reports.filter((report) => isRecommendationEvidence(report, options) && report.region?.geometry &&
      report.region.countryCode === region.countryCode && positionInRegion(report, report.region));
    for (const candidate of buildRecommendationsForRegion(scoped, region, options)) {
      const key = supportKey(candidate);
      if (!unique.has(key)) unique.set(key, candidate);
    }
  }
  return [...unique.values()].sort(compareRecommendations);
}

export function buildRecommendations(
  signals,
  { minimumSize = MIN_CLUSTER_SIZE, includeDemonstrationReports = false } = {},
) {
  const size = Number.isInteger(minimumSize) && minimumSize >= MIN_CLUSTER_SIZE ? minimumSize : MIN_CLUSTER_SIZE;
  return groupSignalsByRegionAndCategory(Array.isArray(signals) ? signals : [], { includeDemonstrationReports })
    .filter((cluster) => cluster.signals.length >= size)
    .flatMap((group) => {
      const recommendationGroupId = `${group.region.id}:${group.category}`;
      const clusters = supportedLocations(group, size);
      const candidates = clusters.map((cluster) => ({
        id: clusters.length === 1 && cluster.signals.length === group.signals.length
          ? recommendationGroupId : `${recommendationGroupId}:location-${locationId(cluster)}`,
        recommendationGroupId,
        category: cluster.category,
        region: cluster.region,
        signals: [...cluster.signals].sort((first, second) => compareText(reportKey(first), reportKey(second))),
        position: clusterPosition(cluster),
        urgencyScore: Math.round(cluster.signals.reduce((sum, signal) => sum + signalWeight(signal), 0) * 100) / 100,
        maxSupportingDistanceKm: maxSupportingDistance(cluster),
        placementMethod: "report-cluster-weighted-center",
      })).sort(compareRecommendations);
      const selected = [];
      for (const candidate of candidates) {
        if (selected.some((other) => geographicDistance(candidate.position, other.position) < MIN_LOCATION_SEPARATION_KM)) continue;
        selected.push(candidate);
        if (selected.length === MAX_SERVICE_LOCATIONS) break;
      }
      return selected.map((candidate, index) => {
        const demonstrationReportCount = candidate.signals.filter((signal) => signal.isSynthetic === true).length;
        const ranked = { ...candidate, locationRank: index + 1, locationCount: selected.length,
          demonstrationReportCount,
          nonDemonstrationReportCount: candidate.signals.length - demonstrationReportCount,
          evidenceMode: demonstrationReportCount ? "demonstration" : "community",
        };
        return { ...ranked, analysis: inferServiceNeed(ranked) };
      });
    })
    .sort(compareRecommendations);
}

function compareRecommendations(first, second) {
  return second.urgencyScore - first.urgencyScore ||
    second.signals.length - first.signals.length || compareText(first.id, second.id);
}

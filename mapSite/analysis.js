import { pointInGeometry } from "./regions.js";

const EARTH_RADIUS_KM = 6371;

export const MIN_CLUSTER_SIZE = 2;

export const severityWeights = {
  low: 1,
  medium: 2,
  high: 3,
};

function toRadians(value) {
  return value * Math.PI / 180;
}

function validSignal(signal) {
  return signal && Number.isFinite(signal.latitude) && Number.isFinite(signal.longitude) &&
    Math.abs(signal.latitude) <= 90 && Math.abs(signal.longitude) <= 180;
}

function signalWeight(signal) {
  return Object.hasOwn(severityWeights, signal.severity) ? severityWeights[signal.severity] : 1;
}

function longitudeDifference(longitude, reference) {
  return ((longitude - reference + 540) % 360) - 180;
}

function groupSignalsByRegionAndCategory(signals) {
  const groups = new Map();

  signals.forEach((signal) => {
    if (!validSignal(signal) || !signal.region?.id || !signal.region.geometry ||
        !pointInGeometry(signal.longitude, signal.latitude, signal.region.geometry)) return;
    const category = typeof signal.category === "string" && signal.category.trim()
      ? signal.category.trim() : "other";
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

export function weightedGeometricMedian(signals) {
  signals = Array.isArray(signals) ? signals.filter(validSignal) : [];
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
  const text = candidate.signals
    .map((signal) => signal.summary || "")
    .join(" ")
    .toLowerCase();
  const rules = [
    { pattern: /\b(gas|fuel|petrol|refuel|gasoline)\b/, facilityType: "Gas station" },
    { pattern: /\b(bus|public transit|transit stop|no car|shuttle|ride)\b/, facilityType: "Transit stop or shuttle hub" },
    { pattern: /\b(pharmacy|medicine|prescription)\b/, facilityType: "Pharmacy" },
    { pattern: /\b(doctor|clinic|medical|health care|healthcare)\b/, facilityType: "Community health clinic" },
    { pattern: /\b(grocery|groceries|fresh food|supermarket)\b/, facilityType: "Grocery store" },
    { pattern: /\b(food pantry|food bank|meals|hungry)\b/, facilityType: "Food distribution point" },
    { pattern: /\b(wifi|wi-fi|internet|broadband)\b/, facilityType: "Public internet access point" },
    { pattern: /\b(water|drinking water)\b/, facilityType: "Community water station" },
  ];
  const defaults = {
    transportation: "Transit access hub",
    healthcare: "Community health clinic",
    food: "Food access center",
    water: "Water and sanitation service point",
    broadband: "Public internet access point",
    emergency_response: "Emergency response station",
    other: "Community service center",
  };
  const match = rules.find((rule) => rule.pattern.test(text));
  const facilityType = match?.facilityType ||
    (Object.hasOwn(defaults, candidate.category) ? defaults[candidate.category] : null) ||
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
      relevance: `This ${signal.severity || "unknown"}-urgency report contributes directly to the observed ${candidate.category.replaceAll("_", " ")} need.`,
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
  const decisionSummary = `${candidate.signals.length} ${candidate.category.replaceAll("_", " ")} reports within ${candidate.region.name} indicate repeated demand for a ${facilityType.toLowerCase()}.`;

  return {
    facilityType,
    rationale: decisionSummary,
    decisionSummary,
    needAnalysis: `The local fallback found ${severityCounts.high} high, ${severityCounts.medium} medium, and ${severityCounts.low} low urgency reports in the same named region and category. Repeated reports indicate a pattern worth validating through community outreach and service-capacity data.`,
    placementRationale: `The suggested point is the urgency-weighted geographic median of the cited reports, constrained to the verified boundary of ${candidate.region.name}. High urgency reports receive three times the placement weight of low urgency reports, reducing aggregate distance to the strongest reported needs.`,
    priority,
    serviceComponents: [
      `Core ${facilityType.toLowerCase()} capacity sized after local demand validation`,
      "Accessible public entry and clearly published service information",
      "A way to monitor usage and collect follow-up community feedback",
    ],
    expectedImpact: [
      `Shorter aggregate travel distance from the reported ${candidate.category.replaceAll("_", " ")} needs`,
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
  if (pointInGeometry(
    position.longitude,
    position.latitude,
    cluster.region.geometry,
  )) {
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

export function buildRecommendations(
  signals,
  { minimumSize = MIN_CLUSTER_SIZE } = {},
) {
  const size = Number.isInteger(minimumSize) && minimumSize > 0 ? minimumSize : MIN_CLUSTER_SIZE;
  return groupSignalsByRegionAndCategory(Array.isArray(signals) ? signals : [])
    .filter((cluster) => cluster.signals.length >= size)
    .map((cluster) => {
      const position = constrainPositionToRegion(
        weightedGeometricMedian(cluster.signals),
        cluster,
      );
      const urgencyScore = cluster.signals.reduce(
        (sum, signal) => sum + signalWeight(signal),
        0,
      );
      const candidate = {
        id: `${cluster.region.id}:${cluster.category}`,
        category: cluster.category,
        region: cluster.region,
        signals: cluster.signals,
        position,
        urgencyScore,
      };

      return { ...candidate, analysis: inferServiceNeed(candidate) };
    })
    .sort((first, second) => second.urgencyScore - first.urgencyScore);
}

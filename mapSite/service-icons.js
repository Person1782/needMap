// Small local SVGs work offline and do not require an icon font or image request.
const svg = (paths) => `<svg class="service-type-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const SERVICE_ICONS = Object.freeze({
  hospital: svg('<path d="M4 21V7h16v14M8 7V3h8v4M2 21h20M10 21v-5h4v5M12 9v4M10 11h4M7 16h.01M17 16h.01"/>'),
  medication: svg('<path d="m8 16 8-8M6 18a5 5 0 0 1 0-7l5-5a5 5 0 0 1 7 7l-5 5a5 5 0 0 1-7 0Z"/>'),
  education: svg('<path d="m2 8 10-5 10 5-10 5-10-5ZM6 10v7c4 3 8 3 12 0v-7M22 8v8"/>'),
  roads: svg('<path d="M7 3 3 21M17 3l4 18M12 3v3M12 10v4M12 18v3"/>'),
  transit: svg('<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 11h14M9 3v8M15 3v8M7 19v2M17 19v2M8 15h.01M16 15h.01"/>'),
  water: svg('<path d="M12 2C9 6 5 10 5 14a7 7 0 0 0 14 0c0-4-4-8-7-12Z"/><path d="M8 14a4 4 0 0 0 4 4"/>'),
  broadband: svg('<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>'),
  food: svg('<path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v18M17 21V3c-3 2-4 5-4 9h4"/>'),
  fuel: svg('<path d="M3 21h12M5 21V3h8v18M5 10h8M13 12h2a2 2 0 0 1 2 2v3a2 2 0 0 0 4 0V8l-4-4M18 5v4h3"/>'),
  emergency: svg('<path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5l8-3Z"/><path d="M12 8v8M8 12h8"/>'),
  other: svg('<path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7M8 11h.01M16 11h.01"/>'),
});

const CATEGORY_ICONS = Object.freeze({
  healthcare: "hospital", medical: "hospital", medicine: "hospital", meditation: "hospital",
  medication_access: "hospital", medication: "hospital", medications: "hospital", pharmacy: "hospital",
  education: "education", roads: "roads", road: "roads",
  transportation: "transit", transit: "transit", water: "water", water_supply: "water", broadband: "broadband", internet: "broadband",
  food: "food", fuel: "fuel", emergency_response: "emergency", emergency: "emergency", other: "other",
});

const SERVICE_RULES = [
  [/(?:\b)(?:pharmacy|medicine|medication|prescription|drugstore)(?:\b)/i, "medication"],
  [/(?:\b)(?:education|school|classroom|library)(?:\b)/i, "education"],
  [/(?:\b)(?:road|roads|pothole|potholes|bridge|pavement)(?:\b)/i, "roads"],
  [/(?:\b)(?:hospital|clinic|medical|healthcare|health care|doctor|pharmacy|medicine|medication|prescription|meditation)(?:\b)/i, "hospital"],
  [/(?:\b)(?:emergency|ambulance|fire station|disaster|rescue)(?:\b)/i, "emergency"],
  [/(?:\b)(?:gas station|gasoline|fuel|petrol|refuel)(?:\b)/i, "fuel"],
  [/(?:\b)(?:transit|transportation|transport|bus|shuttle|rail|train)(?:\b)/i, "transit"],
  [/(?:\b)(?:water|sanitation|drinking)(?:\b)/i, "water"],
  [/(?:\b)(?:internet|broadband|wi-?fi|connectivity)(?:\b)/i, "broadband"],
  [/(?:\b)(?:food|grocery|groceries|pantry|supermarket|meal|meals|hungry)(?:\b)/i, "food"],
];

export function serviceIconKey(category, facilityTypeOrSummary = "") {
  const description = typeof facilityTypeOrSummary === "string" ? facilityTypeOrSummary : "";
  const inferred = SERVICE_RULES.find(([pattern]) => pattern.test(description));
  if (inferred) return inferred[1];
  const normalized = typeof category === "string" ? category.trim().toLowerCase() : "";
  return Object.hasOwn(CATEGORY_ICONS, normalized) ? CATEGORY_ICONS[normalized] : "other";
}

export function serviceIconSvg(category, facilityTypeOrSummary = "") {
  return SERVICE_ICONS[serviceIconKey(category, facilityTypeOrSummary)];
}

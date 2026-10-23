// Primary-source references checked on 2026-10-21. These are dated project
// benchmarks, never live quotes, citywide benefit estimates, or operating models.
const CHECKED_AT = "2026-10-21";
const sources = {
  census: {
    label: "U.S. Census Bureau — Fremont population, July 1, 2025",
    url: "https://www.census.gov/quickfacts/fact/table/fremontcitycalifornia/PST045225",
    note: "226,442 residents across the entire city (2025 estimate). This is geographic context; it does not measure the population served by a proposed facility or expected users.",
  },
  shuttle: {
    label: "Sonoma County — ADA vehicle purchase report, October 13, 2026",
    url: "https://sonoma-county.legistar.com/LegislationDetail.aspx?ID=8280151&GUID=8B0CCCD5-9921-4DBC-B1B2-E808A624BEF5",
    note: "Northern California comparator: $169,004 per equipped ADA cutaway vehicle, plus 10% contingency. The August 24, 2026 vendor quote estimates delivery 120–150 days after ordering; 22 weeks rounds up the upper end. This is vehicle acquisition, not a complete shuttle launch or an operating budget.",
  },
  mobilePharmacy: {
    label: "Alameda County — mobile pharmacy vehicle, September 23, 2025",
    url: "https://www.acgov.org/board/bos_calendar/documents/DocsAgendaReg_09_23_25/HEALTH%20CARE%20SERVICES/Regular%20Calendar/HCSA_GSA_392893.pdf",
    note: "The board report requests $206,905 for one 2025 Transit 350 with a mobile pharmacy package. Vehicle purchase only: no clinic building, pharmacy staffing, medicines, or launch schedule. The separate $3,643 monthly motor-pool charge includes fuel, maintenance and depreciation, so it is not used as the full annual operating cost.",
  },
  clinic: {
    label: "Rep. Ro Khanna — FY2027 Irvington Clinic funding request",
    url: "https://khanna.house.gov/helping-you/community-projects",
    note: "$3,000,000 requested for renovating the Irvington Clinic's second floor for medical and behavioral health care. This is a funding request for a specific existing building, not an awarded construction contract or a quote for a new clinic or pharmacy.",
  },
  water: {
    label: "Alameda County Water District — refill-station pilot, January 14, 2026",
    url: "https://www.acwd.org/AgendaCenter/ViewFile/Agenda/_01142026-1629#page=198",
    note: "Local pilot proposes a bottle-refill station at Thornton Middle School. The presentation identifies accessible locations and existing water supply but gives no purchase price, operating budget, or delivery duration. A refill fixture is not a water-treatment or emergency supply system.",
  },
  waterCosts: {
    label: "Menlo Park — hydration-station construction benchmark, July 14, 2020",
    url: "https://www.menlopark.gov/files/sharedassets/public/v/1/agendas-and-minutes/city-council/2020-meetings/agendas/20200714-cc-agenda-packet.pdf#page=49",
    note: "Historical Bay Area comparator: $236,673 construction plus $23,667 contingency and $48,000 construction administration for 30 replacement stations. These 2020 multi-site costs are not inflation-adjusted or used as the price of a single new station.",
  },
  broadband: {
    label: "City of Fremont — Access Fremont public Wi-Fi",
    url: "https://www.fremont.gov/government/citywide-initiatives/public-wifi",
    note: "The city describes 125 access points across six business districts and the Ohlone College area, supported by $3 million in federal/state funding. This is network funding, not a unit price or annual running cost. Existing coverage should be checked before adding a site.",
  },
};

const text = (value) => typeof value === "string" ? value.trim() : "";

function isFremontCalifornia(recommendation) {
  const region = recommendation?.region;
  const description = [text(region?.name), text(region?.hierarchy)].join(", ");
  // Avoid applying Fremont, California references to a namesake city, or using
  // approximate candidate coordinates as a substitute for verified geography.
  return /\bfremont\b/i.test(description) && /\bcalifornia\b/i.test(description);
}

export function getPlanningReference(recommendation) {
  if (!isFremontCalifornia(recommendation)) return null;

  const category = text(recommendation?.category).toLowerCase();
  const facility = text(recommendation?.analysis?.facilityType).toLowerCase();
  const selected = [sources.census];
  const values = { currency: "USD" };
  const fieldNotes = {};
  let note = "Fremont, California references checked October 21, 2026. Population, uptake, journey times, operations and unspecified delivery phases remain blank because these sources do not establish them for this service area. Published project amounts are editable benchmarks, not quotes for this recommendation.";

  const mobilePharmacy = category === "healthcare" && /\bpharmacy\b/.test(facility) && /\b(mobile|van)\b/.test(facility);
  const shuttle = ["transportation", "healthcare"].includes(category) &&
    /\b(shuttle|paratransit|medical transport|accessible van)\b/.test(facility);

  if (mobilePharmacy) {
    selected.push(sources.mobilePharmacy);
    values.capitalCost = "206905";
    fieldNotes.capitalCost = "Starting benchmark covers one mobile pharmacy van only (Alameda County, 2025). Add other capital needed for the project; staffing, medicines and launch costs are not included.";
    values.costSource = `Alameda County September 23, 2025 board report: $206,905 for one mobile pharmacy van. Vehicle capital only; staffing, medicines and launch costs require local estimates. ${sources.mobilePharmacy.url}`;
    note += " The starting capital amount covers one mobile pharmacy vehicle only.";
  } else if (shuttle) {
    selected.push(sources.shuttle);
    values.capitalCost = "169004";
    values.contingency = "10";
    values.deliveryWeeks = "22";
    fieldNotes.capitalCost = "Starting benchmark covers one ADA cutaway vehicle only (Sonoma County, 2026). Add other capital needed for the project; this is not a complete shuttle launch budget.";
    fieldNotes.deliveryWeeks = "The 22-week benchmark is vehicle delivery after ordering: the quoted upper limit of 150 days, rounded up. Add local launch preparation; this is not the full project timeline.";
    values.costSource = `Sonoma County October 13, 2026 report: one ADA cutaway vehicle $169,004 plus 10% contingency. Delivery 120–150 days after order, rounded up to 22 weeks; add local launch preparation. ${sources.shuttle.url}`;
    note += " Starting figures cover one ADA vehicle, its quoted contingency, and delivery only; add local launch work to Build & launch.";
  } else if (category === "healthcare") {
    selected.push(sources.mobilePharmacy, sources.clinic);
    note += " Mobile pharmacy acquisition and clinic renovation are different service designs, so their amounts are not prefilled for a general clinic or fixed pharmacy.";
  } else if (category === "transportation") {
    selected.push(sources.shuttle);
    note += " The vehicle benchmark is not used as the cost of a transit hub or other transport infrastructure.";
  } else if (category === "water") {
    selected.push(sources.water, sources.waterCosts);
    note += " No comparable current price was verified for the proposed water service; the local pilot and historical replacement project remain reference context.";
  } else if (category === "broadband") {
    selected.push(sources.broadband);
    note += " Network-wide grants cannot establish the cost of a single internet access point.";
  }

  return { values, fieldNotes, populationContext: {
    label: "Fremont citywide population", value: 226442, year: 2025,
    note: "Census estimate for the whole city. The population actually served by this project still needs a defined service area.",
    sourceLabel: "U.S. Census Bureau", sourceUrl: sources.census.url,
  }, sources: selected.map((source) => ({ ...source })), note, checkedAt: CHECKED_AT };
}

# Analysis evidence

`analysis-evidence.js` retrieves public statistics from the World Bank's World Development Indicators API. The API republishes measurements from WHO, UNICEF, UNESCO, ITU, FAO, the UN Population Division and national statistical offices. No API key or server is needed. The API's CORS response was checked on 22 October 2026; live US retrieval returned all seven configured series.

## Geography and missing information

The provider supports **national measurements**. A selected country can use its measurements in scoring. A state, province or NeedMap geographic area receives those measurements as clearly labeled national context, with `eligibleForScore: false`. No national population is allocated to a smaller region, and national counts must never be shown as the selected subregion's affected population. Countries or territories without provider coverage remain selectable and display unavailable statistics.

The loader does not have verified comparable measures for medication access, roads, transportation, fuel, emergency response or other problems. Those categories remain missing; neither service availability nor affected population is invented from report counts. This is a limitation of the configured evidence coverage, not a claim that no data exists anywhere.

Missing measurements, failed requests and unavailable services are distinct from a measured zero. Only observations from the most recent ten years are considered. The measurement year and source accompany every value. An All Problems overview must not add affected counts across categories because the populations may overlap.

## Measurements and permitted uses

| Category | Live series | Use and limitation |
| --- | --- | --- |
| Population | [SP.POP.TOTL](https://data.worldbank.org/indicator/SP.POP.TOTL) | National population context. Same-year denominator for supported estimates; never used as an affected count itself. |
| Water | [SH.H2O.BASW.ZS](https://data.worldbank.org/indicator/SH.H2O.BASW.ZS) | Basic drinking-water access. Gap = 100 minus access percentage. Estimated people lacking basic service = same-year population × gap / 100. Does not cover all sanitation or water-safety issues. |
| Healthcare | [SH_UHC_SCI](https://data.worldbank.org/indicator/SH_UHC_SCI) | WHO composite essential-service coverage index. Gap = 100 minus index; an index gap is not a percentage of people. No affected headcount is inferred. |
| Internet | [IT.NET.USER.ZS](https://data.worldbank.org/indicator/IT.NET.USER.ZS) | Internet use in the last three months. Non-use is a limited proxy for access, with multiple possible causes. No affected headcount is inferred. |
| Education | [SE.PRM.UNER.ZS](https://data.worldbank.org/indicator/SE.PRM.UNER.ZS), [SE.PRM.UNER](https://data.worldbank.org/indicator/SE.PRM.UNER) | Primary-school-age non-enrollment rate and reported number of children out of school. These are education-access indicators, not evidence that school infrastructure caused non-enrollment. |
| Food | [SN.ITK.MSFI.ZS](https://data.worldbank.org/indicator/SN.ITK.MSFI.ZS) | Moderate or severe food-insecurity rate. Estimated people = same-year population × rate / 100. Food insecurity does not establish a lack of grocery stores. |

Water and food estimates require a population observation from exactly the same year as their rate. They include both source citations and the arithmetic, are rounded to whole people and labeled estimates. The latest population year may differ from the year used in these estimates. These national measurements are not counts of people affected by NeedMap's individual reports.

The healthcare series `SH.UHC.SRVS.CV.XD` was retired from the current WDI source. The implementation uses its verified replacement `SH_UHC_SCI`; the [December 2025 release notes](https://datatopics.worldbank.org/world-development-indicators/release-note/dec-2025.html) describe the revised UHC methodology. It does not silently combine older and newer definitions.

## Data contract

```js
await loadAnalysisEvidence(region, { signal, fetchImpl, now, timeoutMs });
// { regionId, countryCode, status, indicators, sources, notes,
//   unavailableCategories, retrievedAt, checkedAt }
```

Each indicator includes `category`, `kind`, `value`, `unit`, `year`, `title`, `description`, `usedFor`, `scope`, `eligibleForScore`, `isEstimate`, `isProxy`, `source`, `sources` and `sourceIds`. Derived indicators also include `calculation`. Scope is `{regionId: countryCode, countryCode, level: "country", name}`. Use all of an indicator's `sources` in explanations: a derived population estimate requires both its rate and its population citation.

Each source includes a stable identifier, title, actual originating institution, human-readable URL, direct dated API URL, metadata URL, usage explanation, measurement year, country, geography level and retrieval timestamp. Values must be rendered as text, not interpreted as HTML. `ready` means all configured requests were retrieved and validated, not that every infrastructure category has data. `partial` includes subregion context and partial provider failures. `unavailable` means there are no usable measurements.

The caller aborts its active request on region changes and ignores any superseded result before rendering. An aborted call rejects with `AbortError`. Normal provider failures return missing evidence and notes rather than rejecting the entire page.

## Request behavior and validation

Seven independent requests run with at most three concurrent requests and a 20-second timeout per request. Independent requests keep an unavailable indicator from discarding valid measurements in other categories. Both fetch and streamed response reading are covered by the deadline. Response bodies are limited to 512 KiB, data arrays to 200 observations, and paginated/incomplete responses are rejected.

Responses must match the exact country ISO2/ISO3 codes and requested indicator. Duplicate years, wrong sources, invalid values, forecasts, future years, numeric strings, negative counts, and percentages/index values outside 0–100 are rejected or kept missing. No values are converted from null to zero. Only complete retrievals enter the bounded cache (12 countries, one hour, memory only). Consumer mutations cannot alter cached values. Failed requests can be retried on the next visit. No reports, report descriptions, names, coordinates, credentials or page-referrer URLs are sent to the statistics provider; requests identify a country and indicator. As with any direct browser request, the provider receives the connection's network address.

## Primary documentation

- [World Bank API authentication and overview](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392): public API access without credentials.
- [World Bank API call structure](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures): country/indicator requests, date ranges, JSON and pagination.
- [World Bank indicator metadata](https://datahelpdesk.worldbank.org/knowledgebase/articles/898599-indicator-api-queries): source definitions and originating organizations.
- [WHO UHC service coverage](https://www.who.int/data/gho/data/themes/topics/service-coverage/GHO/): interpretation and limits of the essential-service index.
- [WHO/UNICEF drinking-water metadata](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SH.H2O.BASW.ZS): basic-service definition and measurement limits.
- [ITU Internet-use metadata](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/IT.NET.USER.ZS): participation definition and limits.
- [UNESCO non-enrollment metadata](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SE.PRM.UNER.ZS): age-group definition and administrative measurement limits.

Run `node --test tests/analysis-evidence.test.js` for validation, geographic scope, derivation, missing data, failure, cancellation and cache behavior. Runtime data is fetched from the sources; it is not embedded from the test fixtures.

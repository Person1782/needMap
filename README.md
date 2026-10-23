# NeedMap — Community reporting and map

NeedMap connects anonymous service-access reports with a worldwide community map and regional Analysis page. The reporting form and map are independent websites sharing one Firebase project. The old Plan page, cost calculator, and staff planning interface remain removed.

## Adaptive reporting form

The form keeps every reporting field in both modes. Automatic mode uses available effective connection speed, latency, data-saving preferences, device memory/CPU hints, and passive load/submission timings. It does not download speed-test data or assume Wi-Fi is fast. A manual **Slow connection mode** choice is remembered on that device when storage is available.

After confirmed delivery, normal mode opens the Map page. Slow mode stays on the confirmation screen and offers an explicit map link. A report that starts in slow mode, or encounters slow conditions during submission, stays on the form even if conditions subsequently improve. Offline/reconnection events never automatically submit a report, and retries reuse the same submission reference.

The production form uses system fonts and a single classic ES5 script, without map assets or the Firebase JavaScript SDK. HTML, JavaScript, and CSS total approximately **30 KB uncompressed / 11 KB gzip**. Compression must be enabled by the host. Existing drafts last seven days; all required fields and privacy validation remain available. See [form documentation](comForm/README.md) for submission and compatibility details.

The form still requests device location only when the person selects **Use my location** for their report. A town/neighbourhood search is available as an alternative. Report coordinates are rounded before storage or submission.

## Map and regions

Map and Analysis share the same selected region. A returning visitor's saved region is restored first; otherwise NeedMap detects an approximate country/state from their IP without requesting browser location permission. It chooses a smaller NeedMap geographic area when the IP position and administrative boundaries support one; otherwise it uses a state/province or country. If detection or boundary lookup fails, the worldwide map and manual region picker remain usable. Only the catalog ID/version is saved under `needmap-selected-region-v1`; location coordinates are not saved by this preference. IP location can reflect a VPN or network gateway rather than the visitor's actual region.

**Change Region**, at the top left, uses one complete bundled directory of countries, states/provinces, and precomputed NeedMap areas. **Worldwide** appears first, followed by all countries and territories. It can also be found by searching “world” or “global.” A deliberate Worldwide choice is saved like other regions; first-time visitors still start with IP detection. Typing searches every country, state, and NeedMap region from the first load without a result cutoff. California follows the same geographic grouping rules as every other state; it has no special list or hand-assigned counties.

Large states with suitable administrative data are divided into neighboring geographic groups. Smaller states and places without sufficient subdivision data remain whole. The entire directory is generated before deployment; the browser loads only the selected place's map boundaries. Searching does not make provider requests. There are no export/download controls or separate region sections.

Selecting an area scopes reports and proposed services to its polygon. IP detection uses the same directory, and a newer manual selection always wins over a pending automatic lookup. Whole-state and whole-country entries remain in the same list. [Region data documentation](mapSite/REGION-DATA.md) explains provenance and coverage.

Regions with no reports show the selected region's full map extent in Map and Analysis. Selecting a region from Analysis also fits that region when returning to Map. American Samoa uses bundled island boundaries, including Rose Atoll and Swains Island, for both of its catalog entries instead of relying on an external boundary search.

## Proposed service locations

Map and Analysis use the same local SVG icons for healthcare, education, roads, transportation, water, internet, food, fuel, emergency response, and other services. Healthcare includes medication access: existing medication reports, counts, rankings, and population estimates use this single category. Proposed pharmacies retain their specific service icon. Other legacy combined categories are conservatively refined from report text; the reporting schema is unchanged.

For each selected region and category, the map shows **up to three** distinct proposed locations. Each requires at least two unique supporting reports. Splitting must reduce urgency-weighted straight-line travel distance by at least 25%, and resulting locations must be at least 250 metres apart. Urgency weights are 1, 2, and 3 for low, medium, and high. Locations use an approximate weighted geographic median constrained to the region boundary and are ranked by urgency score, then report count. Insufficient or colocated reports produce fewer locations.

These are report-based suggestions, not mathematically proven optimal building sites: roads, land availability, capacity, and costs are not modeled. In Worldwide view, recommendations retain the named report regions. Numbered icons and popups identify the rank and supporting report count. Hovering a marker previews its details; clicking pins them until another location is clicked. The upper-right **Center map** button fits the visible reports and proposed service locations. Nearby existing-service searches have been removed.

The main, Analysis, and population-area maps accept wheel and pinch zoom. Trackpad zoom events are captured within those maps, including over their popups and controls, so they do not zoom the page. The minimum zoom adjusts to the map frame and panning stays within the world edges, preventing empty strips around the map. Browser zoom outside maps and keyboard zoom shortcuts remain available. The small report-location snapshots remain static.

## Regional analysis

Open **Analysis** (`#analysis`) beside **Change Region** in the workspace toolbar. The shared region dropdown and **Infrastructure problem** filter update the large report/service map, overview, report-count chart, rankings, and report details. The Analysis map automatically fits the filtered locations and uses the same hover/click details as the main map. Region changes also update the map and persist for a return visit. No export, cost calculator, or separate planning tools are included.

The overview shows report counts, the most reported problem, and **Estimated residents near reports**. The population card uses WorldPop's 2025 100-meter population estimates within 500-meter neighborhoods around the selected reports, merged and clipped to the selected region. Overlaps are counted once, including under All Problems. This estimates nearby residents, not confirmed people affected. Missing population data or unusable report locations show unavailable, never a fabricated zero. The existing form does not collect a problem start date, and submission dates are never treated as problem duration. Demonstration reports remain labeled as such. See [population calculation and limits](mapSite/REPORT-POPULATION.md).

Clicking the population card opens its calculation details: a map of the exact merged counting area, report count, radius, area, dataset year, calculation steps, and separate-area population bars when supplied by WorldPop. Source boxes explain what each source supports and link to the verified calculation result and WorldPop methods. These details appear only when opened; no population-density heatmap is fabricated.

Expanding a priority shows a small, zoomed-in map beside each located report. It uses the report's stored approximate coordinates and the same category marker as the main map. Maps load only inside expanded priorities and, when supported, as the report scrolls into view. Closing a priority or leaving Analysis releases its maps. Missing or unsupported coordinates show a location-unavailable message rather than a guessed location.

Priority weights remain **severity 30%, people affected 25%, service access 20%, report frequency 15%, and reported duration 10%** internally. Severity combines an explicit NeedMap essential-service policy (80%) with reported urgency (20%). Missing scoring inputs are not filled in or reweighted. Rankings remain provisional where data is missing. National context alone cannot establish a local priority rank. The page shows the priority order without numeric scores, score ranges, scoring percentages, or a formula table. Every problem opens to available statistics, original reports, and validated report excerpts.

Public statistics are fetched on opening Analysis from the World Bank API, including WHO/UNICEF, WHO, UNESCO, ITU and FAO indicators. Current coverage is **country-level**. For a state or custom NeedMap region these figures are labeled national context and do not enter its local score or affected-population estimate. Unsupported categories remain missing. The main page omits source boxes, citation links, calculation formulas, and measurements expressed as indices out of 100; population calculation sources appear only inside the clicked breakdown. Evidence metadata and internal calculations remain available in the data model; derived water/food estimates still require a same-year population denominator. See [source definitions and limitations](mapSite/ANALYSIS-EVIDENCE.md).

AI complaint review uses the existing Firebase AI Logic connection and loads its SDK only when Analysis has reports to review. It selects exact report excerpts and explicit duration phrases; counts, public statistics, severity weights, and scores remain deterministic. Returned report IDs and quotes are validated against the input. The bounded review covers up to 100 reports per region snapshot and displays its coverage. It sends report category/text with temporary IDs, without location coordinates. Provider errors remain visible as **AI review unavailable** and never masquerade as an AI result. Firebase AI Logic and App Check must be configured for the host; no secret model API key is embedded in the browser.

## Run locally

```sh
cd comForm
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. In a separate terminal:

```sh
cd mapSite
npm install
npm run dev
```

Open `http://127.0.0.1:5174/`. The map remains designed for desktop; the form adapts to small screens. Each app has `npm test`, `npm run build`, and `npm run preview`. Production output is in each app's `dist/`. Preview ports are 4173 and 4174.

## Deployment configuration

The form maps local port 5173 to 5174 (and preview 4173 to 4174). Its production map destination defaults to `/map/`. If the apps are hosted separately, build the form with the actual map URL:

```sh
cd comForm
NEEDMAP_MAP_URL=https://your-map-host.example/ npm run build
```

Deploying `/map/` requires the host to serve the map build there. This repository does not currently define hosting for the two sites. `VITE_REGION_LOOKUP_ENDPOINT` configures the Nominatim-compatible boundary service; `VITE_IP_LOCATION_ENDPOINT` configures the browser-accessible IP-region endpoint. Do not embed secret API keys in client build variables. Production traffic needs provider capacity appropriate to the audience.

No production deployment or Firebase rule change is included in these changes.

## Privacy and Firebase

Reports in `incomingSignals` are publicly readable and immutable from browser clients. Anonymous Firebase authentication permits creation without collecting a name or email. Its UID is not stored on the public report. Client validation screens common personal-contact and street-address patterns; this does not guarantee every identifying detail is detected. The form warns against posting personal information and is not an emergency-response channel.

The report schema is unchanged: `category`, `severity`, `summary`, `latitude`, `longitude`, `locationGridId`, `locationPrecision`, `sourceType`, `isSynthetic`, and server `submittedAt`. Grid spacing is approximate, not measured accuracy. Place names and search queries are not published in reports. Existing private legacy staff collections and access rules remain unchanged; the map does not connect to them.

## Verification

Tests cover form validation, confirmed delivery, duplicate prevention, slow/fast/manual modes, condition changes during submission, denied storage, ES5 syntax, local region search, provider fallback, stale request cancellation, region boundary membership, deterministic ranking, minimum report support, date-line placement, and safe SVG icons. Browser smoke checks validate the actual form controls and region navigation. Automated tests and desktop browser checks do not replace physical old-phone testing.

# NeedMap

**Report a problem in your community, see where help is needed, and explore where new services could make a difference.**

NeedMap helps people report difficulty accessing everyday services, such as healthcare, water, transportation, food, and internet. A shared map brings those reports together. Analysis helps explain the needs in a region, and Plans suggests possible service locations with supporting reports, nearby-population estimates, and preliminary cost and construction-time estimates.

This guide describes the features wired into the current app source. Each section starts with an everyday-language explanation, followed by how the feature works.

## Contents

- [The app at a glance](#the-app-at-a-glance)
- [1. Reporting a community need](#1-reporting-a-community-need)
- [2. Bandwidth, slow connections, and older devices](#2-bandwidth-slow-connections-and-older-devices)
- [3. Languages and translation](#3-languages-and-translation)
- [4. Exploring the live map](#4-exploring-the-live-map)
- [5. Finding and changing regions](#5-finding-and-changing-regions)
- [6. How proposed locations are chosen](#6-how-proposed-locations-are-chosen)
- [7. Regional Analysis](#7-regional-analysis)
- [8. Population estimates and calculation details](#8-population-estimates-and-calculation-details)
- [9. Infrastructure Plans](#9-infrastructure-plans)
- [10. Privacy, storage, and data sources](#10-privacy-storage-and-data-sources)
- [11. Accessibility, loading, and recovery](#11-accessibility-loading-and-recovery)
- [Running and configuring NeedMap](#running-and-configuring-needmap)
- [Code and documentation guide](#code-and-documentation-guide)
- [Checks and current boundaries](#checks-and-current-boundaries)

## The app at a glance

| Part | What you can do |
| --- | --- |
| **Community form** | Submit a short anonymous report, choose its urgency, and supply an approximate location. Save a draft on your device and retry interrupted submissions. |
| **Connection handling** | Use the complete form on a slow connection. NeedMap automatically reduces visual work and avoids opening the heavier map after a slow submission. |
| **Map** | See live reports and proposed services, search and filter reports, inspect overlapping markers, and explore a selected region or the world. |
| **Regions** | Search countries, states, provinces, and NeedMap areas. Start near your approximate region and return to a saved selection. |
| **Analysis** | Compare problems, inspect priority rankings and their evidence, read original reports, and see relevant public statistics. |
| **Population details** | Estimate how many residents live near reports and inspect the exact area used in the calculation. |
| **Plans** | Compare up to three locations for a chosen infrastructure type, including supporting reports, a possible service area, cost assumptions, and construction-time evidence. |
| **Languages** | Choose from 18 interface languages. Supported browsers can also translate report text and other changing dashboard content on the device. |

The public form (`comForm/`) and dashboard (`mapSite/`) are separate websites connected to the same Firebase database. The form adapts to small screens; the dashboard is designed for desktop use. The dashboard's three views are **Map**, **Analysis**, and **Plans**.

## 1. Reporting a community need

**In everyday language:** Describe the service problem, say how urgent it is, and choose the area where it happens. You do not need to create a named account.

### The reporting steps

The form follows **Category → Problem description → Urgency → Location**. Validation follows the same visible order so corrections are easy to find.

| Field | What it does | How it works |
| --- | --- | --- |
| Category | Identifies the kind of service problem. | Seven choices: healthcare including medication, water or sanitation, transportation, emergency-response access, food access, internet or broadband, and other essential service. The stored internet category is `broadband`. |
| Problem description | Explains what is difficult to access. | Required, with a 280-character limit and a live character count. Leading and trailing whitespace is removed. |
| Urgency | Records how serious the reporter considers the issue. | Required: low for an ongoing concern, medium for regularly affected access, or high for timely review. |
| Location | Places the concern in an approximate area. | Required. Choose device location, decimal coordinates, or a nearby place from search. |

The dashboard can refine broad or older categories into more specific problems. A road-damage report under transportation can appear as **Roads**, and a school-access report under other can appear as **Education**. Medication reports appear under **Healthcare** in Map and Analysis, while Plans distinguishes pharmacies from hospitals. These rules use the original category and specific wording; a passing mention does not automatically change the report's main problem.

### Three ways to choose a location

| Method | What the person does | What NeedMap does |
| --- | --- | --- |
| **Use my location** | Select the button and respond to the browser's permission request. | Requests device location only then, using normal accuracy, a 12-second timeout, and up to a 60-second-old cached position. Rounds the result before saving or submitting it. |
| **Use coordinates** | Enter decimal latitude and longitude, then select the button or press Enter. | Checks latitude from −90 to 90 and longitude from −180 to 180. Works offline once the form is open. Pending edits are also checked when submitting. |
| **Find place** | Search for a town, neighborhood, or nearby place, then select a result. | Sends an explicit search of 3–120 characters and shows up to three choices. Typing alone does not search. The chosen place's center becomes the approximate location. |

Denied, unavailable, timed-out, malformed, and out-of-range locations show explanations. Changing either coordinate clears the previously accepted location so the form cannot silently submit an old selection. Selecting another method supersedes earlier requests. **Clear location** removes the selected area and coordinate inputs. Late responses cannot overwrite a newer choice.

Place search uses a configurable Nominatim-compatible service. It caches results in memory and spaces requests at least 1.1 seconds apart within the browser. A place center can be far from the actual concern, so the person must choose a relevant result. Search terms and result labels are not included in the public report. Empty results and connection failures have their own messages.

### Approximate location protection

**In everyday language:** The report shares a general area instead of the exact coordinates entered or returned by the device.

All three methods snap coordinates to a **0.0045-degree grid**, approximately 500 metres in the north–south direction. Longitude spacing varies with latitude. The rounded coordinate, a grid identifier, and `locationPrecision: "approximate_grid_500m"` are saved.

This describes grid spacing, not guaranteed device accuracy or a precisely measured 500-metre privacy radius. Exact typed coordinates stay in the input fields during that interaction; drafts and submissions use the rounded location. Clearing the form or choosing another method clears the precise coordinate inputs.

### Personal-information checks

The form warns against including names, contact information, home addresses, or medical information. It checks common phone-number, email-address, and English-style numbered street-address patterns in the description and explains what needs removing. These checks do not recognize every identifying detail or address format.

Errors appear beside inputs and in a linked error summary that receives focus; selecting a summary item focuses its field. Reports are public and intended for planning. They do not request a direct response, and NeedMap is not monitored as an emergency-response channel.

### Saved drafts and clearing the form

**In everyday language:** If you leave before sending, you can return to your draft on the same device.

When browser storage is available, the form saves its fields, rounded location, and pending retry reference locally for **seven days**. Reopening restores a valid draft without publishing it. Corrupt or expired drafts are discarded.

**Clear form** resets fields, location, searches, errors, retry state, and the stored draft. Confirmed submission also clears the submitted draft. If storage is blocked or full, the form continues working and tells the person to keep the page open. Drafts belong to that browser and website; they do not follow an account between devices.

### Confirmed submission and safe retries

**In everyday language:** NeedMap only says a report was received when the database confirms it. Retrying the same unfinished report is designed to avoid a second copy.

The client validates the fields, prevents simultaneous submissions, and signs in anonymously through Firebase. This creates a technical session without asking for a name, email, or password. Its user identifier is not written into the public report.

A unique retry reference is saved before sending. Each attempt checks that reference for an already-delivered matching report, then creates a document only if it does not exist. The database supplies the submission time. An existing record counts as confirmed only when its report fields match and a server timestamp is present; a conflict never overwrites another record.

If delivery succeeded but its acknowledgement was lost, retrying can recognize the existing report, including after a reload. Changed content starts a new attempt. Requests have a **30-second timeout** and an additional watchdog for older browsers. After 15 seconds, the form explains that it is still waiting. Failed or unconfirmed attempts preserve the draft for an explicit retry.

Controls are disabled during sending, and supported browsers warn before leaving mid-submission. Success shows a short reference. Reconnecting or reopening never automatically submits a draft. Offline writing and coordinate entry work after the page has loaded; submission still needs a connection.

## 2. Bandwidth, slow connections, and older devices

**In everyday language:** People with limited data or slower phones get the same reporting fields without loading the map just to submit a concern.

### Automatic connection handling

The form automatically uses available browser information to keep the experience lighter. There is **no manual connection-mode switch** or saved connection-mode preference in the current interface.

| Signal | Condition treated as slow or constrained |
| --- | --- |
| Data-saving preference | The browser reports data saving is enabled. |
| Effective connection type | Slow 2G, 2G, or 3G. |
| Estimated download speed | A positive estimate below 1.5 megabits per second. |
| Network round-trip delay | At least 500 milliseconds. |
| Device memory hint | 2 GB or less. |
| Processor hint | Two or fewer logical processors. |
| Already-loaded page resources | Document, script, or stylesheet timing reaches 2.5 seconds. |
| Current submission | Sending takes at least 8 seconds. |
| Connectivity | The browser reports it is offline. |

These are conservative rules, not a performance test. NeedMap does not download speed-test files, assume Wi-Fi is fast, identify devices by browser names, or send these capability hints to a server. Some browsers expose few or none of these signals; the complete lightweight form remains available.

Slow mode reduces decorative styling and makes loading bars static. It preserves every field, location option, validation rule, and delivery check. Connection changes can update the mode while the page is open.

### What happens after sending

- **No slow condition detected:** confirmed delivery opens the Map page.
- **Submission starts under slow conditions or detects them while sending:** the form stays on the received-report confirmation with an **Open the Map page** link.
- **Connection improves during that submission:** the earlier slow condition still keeps that submission on the confirmation screen.
- **Offline, failed, or unconfirmed submission:** the draft stays available; the app does not claim success or navigate away.

The map link carries the selected language, without report coordinates or description. It uses the configured dashboard destination described under [Running and configuring NeedMap](#running-and-configuring-needmap).

### A smaller reporting page

The form uses system fonts, small local assets, and one classic JavaScript bundle in production. It does not download the dashboard's map library, map tiles, Firebase JavaScript SDK, external fonts, or third-party scripts. Submission uses direct Firebase web requests instead.

The production build measured for this documentation contains **62,373 bytes (about 62.4 kB)** of HTML, JavaScript, and CSS, or **20,465 bytes (about 20.5 kB)** when each file is gzip-compressed. This excludes the favicon, optional language pack, and service requests. A requested language pack adds approximately **2.5–3.5 kB with gzip**. Hosting must enable compression to achieve those compressed transfer sizes.

English text is available immediately. Other language packs load when needed, so all translations do not download up front. With no saved language, automatic language selection may also make an approximate-country lookup. Place search and submission make requests when used.

The build verifies that browser scripts use **ES5**, an older JavaScript syntax. The form avoids requiring modules, `Promise`, `fetch`, Web Crypto, CSS Grid, or CSS custom properties. It still needs JavaScript, cross-origin requests, and current provider HTTPS support. This is a compatibility strategy, not a claim that every old phone has been physically tested.

### Keeping the dashboard's work focused

The dashboard is heavier than the form, but avoids unnecessary work:

- Region names are searchable locally; detailed boundaries load when needed.
- Recently used boundaries and successful data results are cached.
- Population and public-statistics requests run when the relevant view needs them.
- The AI library loads when Analysis has reports or supported priority evidence to review.
- Report mini-maps load inside expanded evidence sections and can wait until they approach the visible part of the page.
- Closing details releases their maps. Changed regions or filters cancel or supersede outdated requests.

These optimizations do not make either website a fully offline-installed application. There is no service worker providing offline page installation or background submission.

## 3. Languages and translation

**In everyday language:** Choose a language for the interface. Supported browsers can also translate changing dashboard content, including people's reports.

### Eighteen interface languages

Both websites include **English, Arabic, Bengali, Chinese (Simplified), Chinese (Traditional), French, German, Hindi, Indonesian, Japanese, Korean, Portuguese, Russian, Spanish, Swahili, Turkish, Urdu, and Vietnamese**.

The picker searches English names, native names, and language codes. It highlights the current choice and remembers it when storage is available. Arabic and Urdu use right-to-left layouts. Labels, help text, errors, loading messages, map controls, Analysis, population details, and Plans use the selected language. Dashboard numbers and dates use local formatting. Changing the form language preserves entered text and does not rewrite the person's description.

The form restores a saved choice first. Otherwise, an approximate-country lookup and browser preferences choose a supported language. Offline skips that lookup; a 3.5-second lookup timeout falls back to browser preferences. Non-English packs have an 8-second timeout and visible failure handling, with English/current-language fallback. Manual selection supersedes automatic work.

The dashboard starts from a saved preference, a supported `?lang=` parameter, or browser preferences. An automatically detected or restored region can refine the language if no explicit choice has been made. A manual choice wins over later automatic results.

The form passes its language in its dashboard link, although the form itself does not read `?lang=`. Separately hosted websites do not share browser storage; the link helps carry the choice between them.

### Translating reports and other changing content

Static language packs cannot anticipate a person's report or every place name. A separate dashboard translation path handles report descriptions, region labels, ranking explanations, AI excerpts, population text, Plans content, and source/provider labels.

It uses browser `Translator` and `LanguageDetector` capabilities when available. Translation runs on the device; this feature does not send report text to an external translation service. The browser may need to download language models. Country names can also use the browser's built-in localized region names.

Successful translations are cached in memory, repeated requests share work, and old responses cannot overwrite a newer language choice. Report search checks original and available translated text; region search can match original and localized names.

**Support is conditional:** unsupported browsers, unavailable language pairs, failed model downloads, or errors leave original changing text visible. Packaged interface translations remain separate. Translation changes presentation, not stored reports or the original wording used for calculations and evidence checks.

## 4. Exploring the live map

**In everyday language:** See what people report, narrow the view to what interests you, and inspect places where additional services might help.

### Live reports and connection status

The dashboard listens to the public `incomingSignals` collection and updates when reports change. Reports appear as map markers and cards with their category, urgency, description, and region or approximate-area label.

The connection indicator distinguishes connecting, live data, assigning regions, no reports, unavailable connections, and reports whose regions could not be identified. An initial cached result is not automatically called live: the app waits for server confirmation, an offline condition, an error, or a **45-second maximum initial wait**. A later server result can restore the live state. Previously received reports can remain during failure, with warnings that proposals may be outdated.

Invalid coordinates are excluded instead of placed at invented locations. A valid location without a verified region can still appear in Worldwide with an approximate-area label.

### Search, filters, and counts

| Control | What it changes |
| --- | --- |
| **Search reports** | Matches report text, category identifiers, region names, and available translated search text. |
| **Service** | Shows one category or all categories available in the selected region. |
| **Urgency** | Shows low, medium, high, or all urgency levels. |
| **Only reports in this map area** | Limits report cards and markers to the visible map area; moving or zooming updates the selection. |
| **Reports shown / High urgency** | Counts reports that pass the current Map filters. |
| **Scope text** | Shows the filtered count against the region's total. |

The live-connection count, regional total, filtered Map count, and Plans matching count describe different sets of reports. A large worldwide total does not mean one service has enough reports in one region.

Map search, service, urgency, and viewport filters affect **reports**. Proposed locations are calculated for the selected region independently of those Map filters. Analysis has its own problem filter; Plans has its own infrastructure-type selection.

### Markers, cards, and overlapping locations

Report markers use a service icon and urgency color: green for low, amber for medium, and red for high. Labels and the legend also identify urgency.

Hovering previews details; clicking pins the popup. Another selection, dismissal, or outside click can close it. Selecting a report card zooms to the report and opens its details.

Reports at the same coordinate share a popup containing every report there. Proposed-service markers appear above report markers. Overlapping proposals can combine into a count badge with a scrollable list. Zooming in separates icons when space permits. This visual grouping does not move calculated sites or change their evidence/rank.

Proposal popups show the service, rank, supporting-report count, region, and reason for the suggestion. Pinned proposal popups are kept within the map frame where possible.

### Layers, centering, and zoom

**Reports** and **Proposed services** can be hidden independently. **Center map** fits the enabled layers' report locations and proposals. It clears the viewport-only report filter so the map can return to the broader selection. Without locations, it fits the selected region or world.

Interactive maps support dragging, zoom controls, mouse-wheel zoom, and pinch/trackpad zoom. Gestures inside them affect the map; browser zoom remains available outside them and through keyboard shortcuts. Scrollable report popups can scroll their contents. World bounds and frame-aware minimum zoom help prevent empty map edges. Small report-location snapshots are deliberately static.

## 5. Finding and changing regions

**In everyday language:** Start near your region, search elsewhere, or inspect the world. Map, Analysis, and Plans stay on the same selected area.

### Automatic starting region and saved choices

A returning visitor's saved region is restored first. Otherwise, the dashboard estimates a country/state from the connection's IP address without requesting browser device-location permission. Where approximate coordinates and boundaries support it, it selects a smaller NeedMap area; otherwise it uses the state, province, or country.

The IP position is rounded to two decimal places and used in memory. The region preference saves a catalog ID/version, not those coordinates. VPNs and network gateways can make detection inaccurate.

If detection fails, Worldwide and manual search remain available. Newer manual selections always win over older automatic requests. Choosing Worldwide is remembered like any other selection.

### One searchable directory

**Change Region** opens countries, territories, states/provinces, and NeedMap areas in one directory. Plans provides another picker connected to that same selection.

An empty search shows Worldwide followed by countries and territories. Searching checks the complete directory immediately, including areas never opened before, without a fixed result cutoff. “World” and “global” find Worldwide. Original and available localized names can be searched.

The shipped build contains **5,422 entries**, including **250 country/territory entries** and **401 generated NeedMap areas**. These are bundled-build counts, not a claim to include every historical or administrative division.

Searching names does not contact a boundary provider. Choosing an area loads the boundary needed to determine which reports belong. Failed selections preserve the previous usable region and show a message.

### How NeedMap areas are made

States/provinces over **120,000 square kilometres** can be divided into **two to six** neighboring groups of smaller administrative areas. Groups require enough underlying areas and at least **98% verified parent coverage**. Smaller places, incomplete data, and unsupported partitions stay whole. Whole-state and country entries remain selectable.

The same rules apply worldwide, including California. These are NeedMap navigation areas, not new official administrative boundaries. Grouping runs during data preparation before deployment; the browser does not rebuild the worldwide partitions.

### Boundaries and report membership

Bundled parent/child boundary files load when needed and recently used files stay in memory. Membership uses actual polygons, including holes and excluded areas. Surrounding rectangles shortlist files; they do not establish membership by themselves.

Reports are matched to bundled regions first. Where no verified match exists, a shared queued Nominatim-compatible lookup can provide a containing administrative boundary. Successful fallback lookups are cached for 30 days. Unresolved reports are counted as unmatched instead of assigned to guessed regions.

Regions with no reports still show their full extent. American Samoa's bundled boundaries include Rose Atoll and Swains Island in both relevant catalog entries.

Sources include geoBoundaries, Countries States Cities, and the Natural Earth American Samoa supplement. Boundaries represent their source releases and may differ from current local divisions. See [region behavior](mapSite/REGION-DATA.md) and [dataset construction and attribution](mapSite/WORLD-REGIONS.md).

## 6. How proposed locations are chosen

**In everyday language:** NeedMap looks for places near groups of relevant reports. Urgent reports pull suggestions toward them, and separate groups can receive separate suggestions.

### From reports to candidate locations

1. **Choose the scope.** A region/country supplies the boundary. Reports outside it are excluded. Separate countries are not pooled into one location.
2. **Group the problem.** Map and Analysis work by category. Plans first narrows reports to one infrastructure type, such as pharmacy or hospital.
3. **Require support.** A location needs at least **two unique supporting reports** with usable coordinates and region information. There is no maximum report-to-report distance cutoff.
4. **Find a weighted center.** Low urgency has weight **1**, medium **1.17**, and high **2**. Positions are averaged on the globe. If the average falls outside the permitted region, the nearest eligible supporting report supplies an in-region point.
5. **Consider separate locations.** A split must improve weighted straight-line travel distance by at least **25%**. Locations must be at least **250 metres apart**, each retaining two unique supporting reports. A regional group can produce up to three locations.
6. **Rank consistently.** Weighted report support determines order, then report count and a stable identifier break ties.

For a nearby low/high pair, the weighted average lies about two-thirds of the way toward the high-urgency report. Colocated reports, insufficient evidence, or groups that do not benefit enough from splitting produce fewer locations.

Service wording is interpreted within the report's category. Mentioning a hospital in a water report does not turn its suggestion into a clinic. Map, Analysis, and Plans share placement rules, but their different category/type filters can produce different groups.

### What Worldwide means

For **Map and Analysis**, Worldwide combines independent proposals from local areas, parent states, and countries. There is no global three-proposal limit. Identical category-and-report evidence appears once, preferring the finer area; broader proposals with different evidence can remain. Extra boundaries load only for scopes with enough relevant reports. Existing proposals stay visible during loading or partial failure.

For **Plans**, Worldwide builds proposals within reports' assigned local regions and shows the top three for the selected infrastructure type. It does not duplicate the additional parent/country aggregation used by the Worldwide map.

### Provenance and the Analysis switch

The current form writes the existing **`isSynthetic: true`** demonstration/provenance flag. Map and Plans explicitly include those stored reports. Analysis starts with **Show all proposed services** enabled; switching it off excludes demonstration-flagged reports from its proposal calculation. It does not hide the underlying reports, alter their ranking/population scope, or change Map proposals.

Normal display labels do not certify independent verification. The provenance field remains in the data. Lower-level recommendation functions exclude demonstration reports unless inclusion is explicitly requested.

### What a proposed point establishes

It is a report-supported place to investigate. Placement uses straight-line geography and urgency. It does not establish road travel time, land ownership, available parcels, terrain suitability, capacity, permitting, or an optimal construction site. Plans adds cost and population context separately; those estimates do not select or reorder locations.

## 7. Regional Analysis

**In everyday language:** Analysis explains which problems are being reported in a place, how they compare, and what evidence supports their priority order.

### Controls, map, and overview

Open **Analysis** or the `#analysis` link. It uses the shared region and offers an **Infrastructure problem** filter: All Problems, water, healthcare, emergency response, food, roads, transportation, education, fuel, internet, and other infrastructure.

The large map shows the selected reports and proposed services together and fits their locations. It shares the Map's icons, hover/click details, overlap handling, and approximate-location notices. **Show all proposed services** controls demonstration-report inclusion in proposals as explained above.

The overview contains:

- **Total reports** for the current region/problem selection.
- **Most reported problem**, including its count and an indication of ties.
- **Estimated residents near reports**, a clickable population estimate explained in the next section.

**Reports by problem** is a horizontal bar chart with exact counts, ordered by report volume. Longer bars mean more reports, not more confirmed affected people. Loading, no matching reports, no regional reports, and unavailable connections have distinct states.

### Expandable priority rankings

Each row shows a problem's priority position, category icon, and report count. Opening it reveals the consequences of that problem, supporting evidence, and original reports.

The expanded view includes **Why it ranks here**: a consequence explanation, high-urgency report count, available population evidence or missing-evidence explanation, and source links. Links identify the publisher and describe what the source supports. Sources explain consequences and measurements; they do not endorse NeedMap's chosen numeric policy weights.

Published facts show their value, unit, year, geographic scope, and definition. National context for a smaller area is labeled accordingly. Measurements expressed as indices or index gaps are omitted from the visible facts list, although eligible ones can still be internal scoring inputs.

Each original report shows its description, urgency, submission date or unavailable-date label, any validated AI excerpt, and a small map of its approximate location. The small maps are static, use the same category/urgency markers, and load only while the priority is expanded. Where supported, they wait until near the visible page area. Closing a priority or leaving Analysis releases them. Missing or unrenderable coordinates show a location-unavailable message.

Report links from Plans open Analysis at the matching category, expand its priority, scroll to the report, and focus it. The link format is `#analysis?category=…&report=…`.

### How the priority order is calculated

**In everyday language:** NeedMap considers seriousness, people affected, service access, how often people report a problem, and how long they explicitly say it has lasted. Missing information stays missing.

The interface shows priority positions rather than numeric scores. Internally, the model uses this fixed policy:

| Factor | Weight | What contributes |
| --- | ---: | --- |
| Severity | 30% | 80% category consequence baseline and 20% reported urgency. Urgency values within this factor are low 25, medium 60, high 100. These differ from the location-placement weights. |
| People affected | 25% | A supported affected-population measurement for the selected geography. The model uses `min(100, log10(people + 1) / 6 × 100)`, reaching its maximum near one million. |
| Service access | 20% | Supported access deficits, such as 100 minus access percentage, a direct gap percentage, or a valid service-index deficit. An index deficit is not a percentage of people. |
| Report frequency | 15% | Reports in that category divided by all reports in the selected region. Selecting one problem does not shrink this denominator to that problem alone. |
| Reported duration | 10% | Explicitly stated problem durations, averaged with each contribution capped at one year. Incomplete duration coverage remains incomplete. |

The category consequence baselines are **water 100; healthcare and emergency response 95; food 90; roads 70; transportation and education 65; fuel 60; internet 45; other 50**. These numbers are NeedMap's policy choices, not official government or source ratings.

Missing inputs are not replaced with invented values, and their weights are not redistributed. The model tracks supported contributions, coverage, and possible uncertainty internally. The displayed order is provisional where evidence is missing. Equal supported scores receive equal ranks, with stable ordering for ties.

Only evidence matching the selected geography contributes to its score. National statistics alone cannot establish a local priority for a state or smaller region without local report or exact-region support. Report IDs are deduplicated, but different IDs are not proof of different real-world incidents.

The **nearby-residents map estimate is separate from the scoring input for people affected**. It is not silently treated as a confirmed affected count, and total national population is not substituted for affected population.

### Understanding problem duration

The form has no problem-start-date field. Analysis can use an explicit supported duration already present in stored data or clearly stated in the description, such as an outage lasting “for two weeks.” Validated AI-selected duration phrases can also supply this input.

The parser handles numeric quantities and a limited set of English number words. It treats months as approximately 30 days and years as 365 days; “at least” remains a lower bound. It rejects inappropriate contexts such as forecasts, negations, travel time, and queue/waiting time.

**The age of a submission is never treated as the duration of the problem.** If someone does not state a usable duration, it remains unknown.

### Public statistics and geographic context

**In everyday language:** NeedMap adds published country statistics to help readers understand the wider situation. Country data does not pretend to measure a specific neighborhood.

On opening Analysis, the browser retrieves seven configured World Bank indicator series. These republish measurements from organizations including WHO, UNICEF, UNESCO, ITU, FAO, and population/statistical agencies.

| Topic | What the configured evidence supports | Important limit |
| --- | --- | --- |
| Population | National population context and a denominator for supported estimates. | Total population is not a count of people affected by reports. |
| Water | Basic drinking-water access and, with same-year population, an estimate lacking that service. | Does not measure every sanitation or water-safety concern. |
| Healthcare | General essential-health-service coverage. | Does not establish medication availability or turn an index gap into a headcount. |
| Internet | Recent internet use as limited access context. | Not using the internet does not prove infrastructure is unavailable. |
| Education | Primary-school-age non-enrollment rate and reported count. | Does not prove missing school buildings caused non-enrollment. |
| Food | Moderate/severe food insecurity and, with same-year population, an estimated count. | Does not establish a shortage of grocery stores. |

Roads, transportation, fuel, emergency response, and other infrastructure currently lack comparable configured statistics. That is a limit of this integration, not a claim that no such evidence exists anywhere.

A country selection can use matching national evidence in scoring. State, province, and NeedMap-area selections show it as **national context only**. Worldwide does not borrow one country's measurements to represent the world. Only usable observations within the most recent ten years are considered. Water and food headcounts require a population denominator from the exact same year as the rate. All Problems does not add affected counts across categories because people can overlap.

Requests validate the country, indicator, source, year, numeric range, and completeness. Missing, null, or failed results do not become zero. Independent requests let usable facts survive another series' failure. Requests use up to three concurrent connections, 20-second per-request deadlines, and a one-hour memory cache for up to 12 complete country results.

See [Analysis evidence definitions](mapSite/ANALYSIS-EVIDENCE.md) for exact indicator codes and source metadata.

### AI-assisted complaint review

**In everyday language:** AI helps select supporting phrases and check supplied evidence. NeedMap validates the output and calculates the rankings itself.

Analysis automatically loads Firebase AI Logic when it has reports or supported priority evidence to review. There is no separate review opt-in control. The configured model is `gemini-3.8-flash`. The bounded review uses up to **100 uniquely identified reports**, with stable ordering, per-report text limits, and a total prompt-size limit. The status explains review coverage rather than implying that every report in a large region was reviewed.

The request uses temporary report IDs, categories, report text, and supplied severity/population evidence context. It does not send report coordinates or stored report IDs. It asks for exact excerpts, explicit duration phrases, and checks against source IDs already supplied by the app.

Returned IDs must match the input. Excerpts must occur exactly in the original report and stay within 280 characters. Durations face additional parsing/context checks. Source checks must match the provided evidence. Malformed or invented references are rejected. AI does not invent public statistics, report counts, site locations, or the ranking formula. A validated duration can influence the deterministic duration factor.

Normal review has a 30-second deadline and is superseded when its scope changes or Analysis closes. If the provider or validation fails, the page uses a **clearly labeled built-in evidence fallback**. That fallback checks the supplied evidence, supplies no AI excerpts, and states that no external AI output was used. Reports, statistics, and rankings remain available.

## 8. Population estimates and calculation details

**In everyday language:** NeedMap estimates how many people live near the reported locations. You can inspect exactly which area it counted and where the number came from.

### How residents near reports are counted

1. Take the usable report locations for the selected region and problem.
2. Draw a **500-metre neighborhood** around each distinct location. This radius is a NeedMap assumption.
3. Merge overlapping neighborhoods so the same area counts once. Duplicate IDs and coincident locations do not multiply it.
4. Trim the combined area to the selected region's polygon where present, including holes encoded in that polygon.
5. Send that geometry to WorldPop's v2 population service for the **2025 population dataset at approximately 100-metre resolution**, identified as `worldpop_R2025A_2025_100m`.
6. Wait for its calculation task, validate the returned dataset, year, population, area, and separate-area totals, then round the overview value to roughly two significant digits.

All Problems uses one combined area across the selected reports. It does not add category estimates and double-count overlaps. The geometry also handles areas crossing the international date line and neighborhoods near the poles.

This is **modeled residential population near reports**, not a live headcount, verified affected population, predicted service usage, or population uniformly spread across the region. The 500-metre analysis radius and the form's approximate 500-metre grid are separate mechanisms.

### Opening the calculation breakdown

Click **Estimated residents near reports** to open **How nearby residents are estimated**. The dialog includes:

- A map of the exact merged area submitted to WorldPop, with report points and a legend.
- The selected report count, neighborhood radius, merged area in square kilometres, and population-data year.
- The calculation steps, provider-returned estimate, and rounded overview value.
- Population bars for separate areas when the provider returns verified component totals.
- Assumptions, limits, and retrieval information.
- Links to the validated calculation result, API documentation, and population-modeling methods, with an explanation of what each supports.

It shows a counting area, not an invented population-density heatmap. If opened during loading, the dialog updates when the estimate arrives. Closing restores focus to the population card. Changing region/problem or leaving Analysis closes it and releases its map.

### Missing data and map fallback

The lookup uses a **60-second total deadline**, at most **30 polls**, and a one-hour memory cache of up to **12 successful geometries**. Changed selections cancel old work; stale results cannot overwrite a newer selection. Population updates preserve already-expanded report maps.

Any unusable selected location, malformed boundary, more than **200 distinct report locations**, incomplete provider result, or unsupported calculation withholds the estimate instead of silently dropping evidence. A verified numeric zero is allowed; unavailable data is not turned into zero.

Background-tile failures do not remove locally drawn boundaries and report points. If the interactive calculation map cannot initialize, a local **SVG outline**—a drawing generated directly from the geometry—shows the same area and points, including holes and date-line wrapping. It needs no extra map download.

WorldPop receives the merged area, year, and resolution, not report descriptions, IDs, urgency, or fresh device geolocation. The area still reveals the approximate neighborhoods being counted. See [population calculation details](mapSite/REPORT-POPULATION.md).

## 9. Infrastructure Plans

**In everyday language:** Pick a service and region to compare up to three possible locations, the reports behind them, the nearby population, and the rough scale of construction costs and time.

### Choosing what to plan

Open **Plans** or `#plans`. Older `#plan` and `#decisions` links route here. The page shares the current region with Map/Analysis and has its own searchable region control.

The infrastructure selector offers **Hospitals, Pharmacies, Schools, Water facilities, Electricity infrastructure, Internet infrastructure, Roads, Transportation, Emergency services, Food access, Fuel access, and Other infrastructure**. It starts with Hospitals and intentionally selects one type at a time.

Healthcare reports with medication/pharmacy wording support Pharmacies; other healthcare reports support Hospitals. Electricity and fuel wording can refine reports under Other. The original category constrains interpretation, so unrelated mentions do not automatically recategorize a report.

Plans requires at least two unique, usable, matching reports within the relevant boundary. Its status shows the actual usable matching count when there is insufficient support. A worldwide total of hundreds of reports can still yield no pharmacy plan in a region with one matching report.

The [shared placement rules](#6-how-proposed-locations-are-chosen) choose and rank locations. Costs, time ranges, and population estimates do not change that ranking. The nearest supporting report's region helps name the location; coordinates display to three decimal places.

### What each plan contains

| Part of the card | What it explains |
| --- | --- |
| Rank, service, location, coordinates | Which suggestion this is and where to investigate. |
| Location map | The proposed point, supporting reports, regional boundary, and highlighted potential service area. |
| Estimated cost | A preliminary range, currency, price year, and geographic basis, or an explicit unavailable state. |
| Estimated completion time | A supported construction-duration range, or unavailable when evidence is insufficient. |
| Potential nearby residents | Estimated residents within that candidate's highlighted planning area. |
| Why NeedMap selected this location | Supporting-report count, high-urgency count, weighted-center explanation, and original descriptions. |
| Open in Analysis links | A link for each supporting report that opens and focuses its detailed evidence in Analysis. |
| Assumptions, calculations, and sources | Example project size, calculation basis, exclusions, publisher, year, and what each source supports. |

English cards show detailed assumptions, source purposes, and stored calculation explanations; other languages show translated summaries of those details. Identical source URLs are combined while retaining their purposes in the evidence model. There is no custom-budget or project-size input: the shipped estimates use the stated example projects below.

### Potential service areas

**In everyday language:** The shading is a possible planning area around the location. It is not proof that a service would reach everyone inside it.

The radius starts at the farthest supporting report's straight-line distance from the proposed center, rounded up to the nearest metre. It is then bounded by these type-specific assumptions:

| Infrastructure | Minimum–maximum radius |
| --- | ---: |
| Hospital | 2–50 km |
| Pharmacy | 1–15 km |
| School | 1–20 km |
| Water facility | 0.5–15 km |
| Electricity | 1–30 km |
| Internet | 0.5–25 km |
| Roads | 0.5–25 km |
| Transportation | 1–30 km |
| Emergency services | 2–30 km |
| Food access | 1–15 km |
| Fuel access | 2–30 km |
| Other infrastructure | 0.5–20 km |

These are NeedMap display assumptions, not published service standards. A maximum cap can leave a distant supporting report outside the shading. The area is clipped to the selected region's polygon where present, including its encoded holes. Worldwide does not add a separate clipping boundary for each candidate's assigned local region.

Each candidate's area is sent separately to WorldPop for the same 2025 population dataset used by Analysis. This is not Analysis's fixed 500-metre-around-each-report calculation. Candidates can have overlapping planning areas, so their resident estimates must not be added as if they represent separate people. Verified values are rounded; failed or unverified estimates show unavailable while the supported location remains visible.

### How preliminary costs are calculated

**In everyday language:** NeedMap prices an example project of a stated size using published reference costs. It shows rough scale, not a quote for that exact site.

The calculation is **example building area, capacity, or route length × published unit cost**, with a low/high range where supported. Most references come from the **DoD Facilities Pricing Guide, UFC 3-701-01 (2025)** using October 2024 prices. Electricity uses **IRENA's Renewable Power Generation Costs in 2024**, published in 2025.

The following are the built-in **base estimates in 2024 US dollars**, before a supported national price adjustment. Costs are rounded here for readability; source formulas retain the underlying values.

| Type | Example project | Base cost range | Construction reference |
| --- | --- | ---: | ---: |
| Hospital | 25,000–50,000 square-foot community hospital | $22.79–45.58 million | 19.3–20.8 months |
| Pharmacy | 2,000–4,000 square feet, using a small-clinic cost comparison | $1.38–4.46 million | 8.1–11.8 months |
| School | 20,000–40,000 square-foot building | $5.88–23.36 million | 16–26.1 months |
| Water | 250,000–500,000 gallons/day treatment capacity | $2.24–4.48 million | 11.6–17.4 months |
| Electricity | 1-megawatt utility-scale solar installation | $489,000–1.61 million | Unavailable |
| Internet | 5 route-miles of communications cabling | $552,625–1.94 million | Unavailable |
| Roads | 0.5–2 km surfaced road, 7 metres wide | $537,185–2.15 million | 5.9–9.4 months |
| Transportation | 5,000–15,000 square-foot bus station | $962,450–2.89 million | 5.3–10.7 months |
| Emergency | 9,000 square-foot fire station | $8.35–11.14 million | 19.1–27.7 months |
| Food | 5,000–10,000 square-foot food/meal center | $4.07–8.13 million | 11.5–13.6 months |
| Fuel | 4–8 fueling outlets | $643,124–1.29 million | 5.6–8.3 months |
| Other | No defined example-project benchmark | Unavailable | Unavailable |

Pharmacy uses a small medical clinic as a cost comparison, not a pharmacy-specific observation. Food uses a dining-facility comparison. Electricity uses IRENA's global solar installed-cost range, from the 5th to 95th percentile. Internet spans above-ground and below-ground cabling costs.

English cards list detailed inclusions and exclusions; localized cards summarize assumptions and limits. Depending on the type, exclusions include land, unusual ground conditions, off-site utilities, specialist equipment, inventory, licensing, vehicles, staffing, operations, financing, taxes, and inflation after the reference year. Solar excludes battery storage and major network expansion; internet excludes customer connections and equipment, among other items.

Costs do not scale automatically with report count or nearby population. They are not updated to current prices or converted to local currency. The exact formulas and source definitions are in [the benchmark implementation](mapSite/plans-benchmarks.js).

### National price-level adjustment

**In everyday language:** When suitable country data exists, NeedMap adjusts the reference cost for broad national price differences. It still does not know the local builder's price.

Opening Plans requests the selected country's **2024 World Bank GDP price-level index**, `PA.NUS.GDP.PLI`. A valid matching observation supplies this multiplier:

`adjusted cost = base cost × (country price-level index / 100)`

Both ends of the range receive the same adjustment. Its source and method appear in the card. This is a national economy-wide price comparison, **not a construction-specific cost index**. It does not establish within-country differences, site costs, imported-equipment prices, or taxes.

Worldwide has no national adjustment. Electricity retains its global solar benchmark; Other has no base cost to adjust. Missing, invalid, or wrong-year data leaves the clearly unlocalized base estimate. There is no guessed multiplier, local-currency conversion, or duration adjustment.

Requests have a 15-second default timeout. Successful observations are cached for 24 hours in memory, up to 48 entries, and can be reused between regions in the same country. Changed selections and leaving Plans supersede outstanding work.

### What “Estimated completion time” means

**In everyday language:** The time range compares the construction phase with published examples. Planning the project and opening the service can take additional time.

The references come from U.S. Census **Construction Length of Time Statistics**, Tables 1 and 2, with supporting methodology and category definitions. NeedMap selects an ownership type, construction category, and project-value band, then uses the lowest/highest reported average duration across the **2022–23, 2023–24, and 2024–25 completion groups**.

These measure **construction start to construction completion**. They are not individual-project predictions or full planning-to-opening schedules. Land acquisition, design, permits, procurement, licensing, stocking, staffing, and commissioning can sit outside that measure.

Electricity and internet retain their supported cost estimates but show timing unavailable because the available combined Census categories do not support solar-specific or communications-specific timing. Other can have a report-supported location without an invented cost or time range.

### Plans maps, failures, and evidence checks

The location maps support pan/zoom, wheel/pinch, and zoom buttons. They show the actual regional boundary, planning area, report dots, and numbered candidate. A visually offset icon with a leader helps keep overlapping report points visible. Individual report navigation is in the adjacent evidence links; the Plans map dots are not separate report popups.

If background tiles fail, local overlays remain. If map initialization fails, a local SVG fallback draws the actual supplied geography and points. Maps and population work exist while Plans is visible; leaving or rebuilding releases them. Old results cannot overwrite newer region/type choices.

The page distinguishes reports still loading, connection failure, missing boundary, no matching reports, fewer than two usable reports, and no distinct supported location. Population, cost, and time can independently be unavailable without removing a valid location.

Estimate records must match the type/geography and have valid years, positive ordered ranges, currency where relevant, sources, and assumptions. The model prefers the most specific compatible evidence, then the newest evidence year. Current cards use the shipped benchmarks plus optional national adjustment; this is not an exposed custom-evidence upload feature.

## 10. Privacy, storage, and data sources

**In everyday language:** Reports are public and use approximate locations. Drafts and preferences stay in your browser, while outside services provide maps, place lookup, statistics, population calculations, and optional AI review.

### What a published report contains

| Field | Meaning |
| --- | --- |
| `category` | Submitted service category. |
| `severity` | Low, medium, or high urgency. |
| `summary` | Validated description, up to 280 characters. |
| `latitude`, `longitude` | Rounded report location. |
| `locationGridId` | Identifier for that approximate grid point. |
| `locationPrecision` | The form uses `approximate_grid_500m`. |
| `sourceType` | The form uses `community_survey`. |
| `isSynthetic` | Existing provenance flag; the current form sets it to `true`. |
| `submittedAt` | Database-generated submission timestamp. |

The public document does not include the anonymous authentication UID, exact device coordinates, original coordinate input, place-search query/name, or bandwidth/device hints.

Repository Firestore rules permit public reads and authenticated creation of correctly shaped reports. They validate allowed fields, categories, urgency, description length, coordinate ranges, and server time. Browser clients cannot update or delete a published report. Client-side personal-information checks supplement those rules; they are not a guarantee that public text contains no personal information.

### What stays in browser storage

| Information | Persistence |
| --- | --- |
| Form fields, rounded location, retry attempt | Local draft for seven days when storage works; removed on clearing or confirmed submission. |
| Explicit language choice | Saved on that website origin until changed or browser data is cleared. |
| Selected region | Saved catalog ID/version, including a deliberate Worldwide selection. |
| Successful fallback region/boundary lookups | Local cache with a 30-day validity window. |
| Place-search results, translations, recent bundled boundaries | In-memory caches; not a cross-device history. |
| Public statistics and WorldPop results | Bounded in-memory caches, generally one hour. |
| Plans national price data | Bounded in-memory cache, 24 hours. |

Storage failures do not prevent ordinary use, although preferences/drafts may no longer survive a reload. The saved starting-region preference does not retain the IP-detection coordinates; boundary/report lookup caches are separate.

### External services and their roles

| Service | Used for | Information needed by that request |
| --- | --- | --- |
| Firebase Authentication / Firestore | Anonymous submission and live public reports. | Authentication requests and the report fields above; the dashboard reads public reports. |
| GeoJS by default | Approximate country/region and automatic language selection. | The browser connection's IP-derived location; no device-location permission is requested for this. |
| Nominatim-compatible provider | User-triggered form place search and fallback administrative boundaries. | A place query, administrative lookup, or stored approximate report location, depending on the operation. |
| OpenStreetMap tiles | Background maps. | Tile requests describing the map areas being viewed. |
| World Bank | Analysis country indicators and Plans national price adjustment. | Country and indicator identifiers, not report descriptions or coordinates. |
| WorldPop | Residents in a merged reporting neighborhood or candidate planning area. | Geometry, year, and resolution, without report IDs/text/urgency. |
| Firebase AI Logic | Automatic Analysis complaint/evidence review when eligible; the rest of Analysis remains usable if it fails. | Bounded report text/categories with temporary IDs and supplied evidence context, without report coordinates. |
| Browser translation models | Translate changing dashboard text where supported. | Text is processed on the device; language-model downloads may be needed. |

Direct browser requests also reveal the connection's network address to their provider. Interface language translation and AI complaint review are separate features with different data paths.

Region data and source attributions remain available in the app and linked documentation. Provider failures are represented as missing or partial data; no provider is assumed to have universal coverage.

## 11. Accessibility, loading, and recovery

**In everyday language:** Controls work with a keyboard, status messages explain what is happening, and a failed optional feature does not have to stop the rest of the app.

### Navigation and readable feedback

- Skip links move directly to the form or current dashboard content.
- Inputs have labels, help text, visible focus, and invalid-field indicators.
- The form has a focused error summary with links to invalid fields.
- Language and region pickers support keyboard selection, arrow keys, Home/End where implemented, Escape, and focus return when closed.
- Populations' detail dialog supports close, outside click, Escape, a contained keyboard-focus cycle, and focus restoration.
- Status messages and busy/progress information are exposed to assistive technology.
- Report descriptions use automatic text direction; Arabic/Urdu interfaces use right-to-left layout.
- Urgency uses words as well as color, and service icons have accompanying text.
- The form uses large controls and adapts to narrow screens. The dashboard retains a desktop-oriented layout.
- Reduced-motion preferences suppress animation; the form's slow mode also keeps loading bars static.
- No-JavaScript notices explain that interactive use/submission requires JavaScript.

### Loading indicators tied to the work

Loading bars appear by the operation doing work: language selection, location lookup, place search, report submission, report connection, region loading, map tiles, Analysis statistics/AI/population, and Plans estimates. They indicate ongoing work rather than claiming an invented percentage complete.

Independent requests own their loading state, so finishing or cancelling one operation does not incorrectly dismiss another. Faster responses avoid unnecessary long flashes; stale operations are cleaned up when their view closes.

### Recovery behavior

The app keeps useful information when optional data fails: reports can remain readable without public statistics or AI, plan locations can remain without cost/population estimates, and local map overlays can remain without background tiles. Explicit empty, unavailable, partial, and outdated states distinguish those cases from a verified zero or successful calculation.

A late response cannot replace a newer manual region, language, location, or analysis selection. Requests and mini-maps are released when their views are no longer needed.

## Running and configuring NeedMap

### Local development

Use Node.js **20.19+ within the 20.x line, or 22.12+**, with npm, matching the Vite requirement in both lockfiles. There are two independent packages; run these commands from the repository root:

```sh
npm --prefix comForm ci
npm --prefix mapSite ci
```

Start the form:

```sh
npm --prefix comForm run dev
```

Open `http://127.0.0.1:5173/`. In a second terminal, start the dashboard:

```sh
npm --prefix mapSite run dev
```

Open `http://127.0.0.1:5174/`. The form automatically maps its development port to that dashboard port when navigating after submission.

### Build, preview, and tests

| Task | Form | Dashboard |
| --- | --- | --- |
| Tests | `npm --prefix comForm test` | `npm --prefix mapSite test` |
| Production build | `npm --prefix comForm run build` | `npm --prefix mapSite run build` |
| Preview | `npm --prefix comForm run preview` | `npm --prefix mapSite run preview` |
| Preview address | `http://127.0.0.1:4173/` | `http://127.0.0.1:4174/` |
| Output | `comForm/dist/` | `mapSite/dist/` |

The form build validates ES5 syntax and language-pack structure/placeholders, then combines/minifies the browser scripts. The dashboard uses Vite with Leaflet and polygon-clipping. It loads Firebase web modules and external data services at runtime where required.

### Hosting and provider configuration

| Setting | Purpose |
| --- | --- |
| `comForm/firebase-config.js`, `mapSite/firebase-config.js` | Public Firebase web-project configuration. Both apps must point to the intended shared project. |
| `NEEDMAP_MAP_URL` when building the form | Dashboard destination. Defaults to `/map/`; accepts an HTTPS URL or root-relative path. |
| Form HTML `data-search-url` | Nominatim-compatible place-search endpoint. |
| `IP_ENDPOINT` in `comForm/i18n.js` | Source-code setting for automatic country-based language selection; currently GeoJS. |
| Dashboard `VITE_REGION_LOOKUP_ENDPOINT` | Nominatim-compatible fallback boundary service. |
| Dashboard `VITE_IP_LOCATION_ENDPOINT` | Browser-accessible IP-region service. |
| Dashboard `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` | Optional development-only App Check debug integration; production protection needs its own host/provider configuration. |
| `firestore.rules`, `firestore.indexes.json` | Database access rules and index configuration. |

For a separately hosted dashboard, build the form with its destination:

```sh
NEEDMAP_MAP_URL=https://your-map-host.example/ npm --prefix comForm run build
```

Local previews map 4173 to 4174. Production `/map/` works only when the host serves the dashboard build at that path. The current `firebase.json` configures Firestore, **not hosting for the two websites**. Building a site does not deploy it or its rules.

Enable anonymous Firebase Authentication and provision the database/rules for report submission. AI review additionally depends on Firebase AI Logic and applicable project/host access settings. Public browser configuration is not a place for secret service credentials. Configure compatible providers and sufficient shared capacity for deployment; browser-local request spacing does not enforce a provider-wide traffic limit. Hosting compression is needed to realize gzip transfer sizes.

## Code and documentation guide

| Area | Main implementation / deeper reference |
| --- | --- |
| Form controls, drafts, location, submission flow | [comForm/app.js](comForm/app.js), [form model](comForm/form-model.js), [form documentation](comForm/README.md) |
| Automatic bandwidth rules | [adaptive-mode.js](comForm/adaptive-mode.js) |
| Confirmed database delivery | [firebase-submit.js](comForm/firebase-submit.js) |
| Place search | [place-search.js](comForm/place-search.js) |
| Form languages | [comForm/i18n.js](comForm/i18n.js) and `comForm/locales/` |
| Dashboard views, filters, live data | [mapSite/app.js](mapSite/app.js), [dashboard-state.js](mapSite/dashboard-state.js), [report-loading.js](mapSite/report-loading.js) |
| Regions and their construction | [REGION-DATA.md](mapSite/REGION-DATA.md), [WORLD-REGIONS.md](mapSite/WORLD-REGIONS.md), [region-navigation.js](mapSite/region-navigation.js) |
| Service placement and worldwide scopes | [analysis.js](mapSite/analysis.js), [worldwide-analysis-regions.js](mapSite/worldwide-analysis-regions.js) |
| Analysis UI and priority model | [analysis-workspace.js](mapSite/analysis-workspace.js), [analysis-model.js](mapSite/analysis-model.js) |
| Public statistics | [ANALYSIS-EVIDENCE.md](mapSite/ANALYSIS-EVIDENCE.md), [analysis-evidence.js](mapSite/analysis-evidence.js) |
| AI review and fallback | [analysis-ai.js](mapSite/analysis-ai.js) |
| Population geometry, requests, and dialog | [REPORT-POPULATION.md](mapSite/REPORT-POPULATION.md), [report-population-area.js](mapSite/report-population-area.js), [report-population.js](mapSite/report-population.js), [population-details.js](mapSite/population-details.js) |
| Plans behavior and candidate evidence | [plans-workspace.js](mapSite/plans-workspace.js), [plans-model.js](mapSite/plans-model.js) |
| Cost and construction-time references | [plans-benchmarks.js](mapSite/plans-benchmarks.js), [plans-local-cost.js](mapSite/plans-local-cost.js) |
| Dashboard languages and runtime translation | [i18n/index.js](mapSite/i18n/index.js), [dynamic-translation.js](mapSite/i18n/dynamic-translation.js) |
| Map interactions and fallbacks | [map-popups.js](mapSite/map-popups.js), [map-zoom.js](mapSite/map-zoom.js), [plans-location-map.js](mapSite/plans-location-map.js), [population-area-fallback.js](mapSite/population-area-fallback.js) |
| Database access | [firestore.rules](firestore.rules) |

The app uses ordinary HTML, CSS, and JavaScript. The public form is intentionally older-browser compatible; the desktop dashboard uses modern JavaScript modules. Data preparation tools under `mapSite/scripts/` rebuild region datasets; they are developer tools rather than extra user-facing pages.

## Checks and current boundaries

Automated tests cover reporting validation, privacy rounding, retries/lost acknowledgements, storage failure, automatic connection handling, localization, region membership, data integrity, placement rules, ranking, source validation, population geometry, map interactions, Plans estimates, and stale-request handling. Tests use controlled inputs; they do not establish that all live providers or hosted environments are working at a particular moment.

Physical old-phone compatibility, live Firebase integration, provider availability, browser interaction, local builds, and deployment are distinct checks. Use the package tests and builds above, plus browser/provider checks appropriate to a deployment.

The current public app includes the Plans features documented here. Older staff-oriented modules and rules still exist in the repository, but their interfaces are not mounted in the current dashboard. They should not be mistaken for available features: there is currently no staff sign-in/moderation page, report editing/deletion control, CSV export, saved scenario comparison, custom-budget calculator, alert system, outcome-feedback form, or nearby existing-service search in the public UI.

A report, nearby-population estimate, priority rank, candidate point, and cost range each answer a different question. NeedMap presents the supporting information and limitations so a reader can investigate the need and assess the next steps.

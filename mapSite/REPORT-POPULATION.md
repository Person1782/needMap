# Residents near reports

The Analysis overview estimates residential population near the reports selected by the shared region and problem filters. It does not establish that those residents experience the reported problem. Existing priority scoring is unchanged; this spatial estimate replaces the old affected-population overview card only.

## Area and population

- Each valid report coordinate receives a 500-meter geodesic buffer, approximated by 64 edges. The distance is a NeedMap assumption, not a measured service area.
- Buffers are unioned before querying population. Duplicate report IDs and coincident coordinates do not multiply the area. All Problems unions all selected reports rather than adding category estimates.
- The union is clipped to the selected region's polygon when provided. Longitude bands split neighborhoods across the antimeridian; polar buffers stay within their caps.
- WorldPop v2 sums its `worldpop_R2025A_2025_100m` population-count dataset over that geometry. These are modeled residential counts, not live headcounts or population uniformly spread over the entire region. WorldPop's boundary-cell handling is not specified in the API documentation; NeedMap does not claim exact building-level counts.
- The card rounds the returned estimate to two significant digits, displays the data year, and explains that overlapping areas count once. Demonstration reports remain included and identified by the existing demonstration-data notice.

## Requests and reliability

`report-population-area.js` constructs the geometry; `report-population.js` calls `POST https://api.worldpop.org/v2/population` with only the merged geometry, year 2025 and resolution `100m`. No report descriptions, report IDs, names, urgency, or browser geolocation are sent. The geometry necessarily describes the approximate neighborhoods around the reports, and the provider receives the browser's network address.

The returned task ID is polled at `/v2/tasks/{id}`. The service currently returns an obsolete `check_url`; the client uses the verified v2 endpoint instead. Completion requires a matching task ID, dataset/year, finite nonnegative population, positive area, and complete matching component totals for a MultiPolygon. A real measured numeric zero is retained; null, missing, inconsistent or failed results are unavailable.

The public API needs no key and documents a 1,000-request daily limit and a 50,000-square-kilometer area limit. NeedMap uses a 60-second total deadline, at most 30 polls, bounded response bodies, cancellation on filter/region changes or leaving Analysis, and an in-memory cache of 12 successful geometries for one hour. Failures are not cached. More than 200 distinct report locations, malformed region boundaries, or any unusable report coordinates withhold the estimate rather than silently truncating it. Provider rate limits, missing coverage and failures can prevent estimates; population tiles are not downloaded as a fallback.

Population requests begin only on Analysis after reports load. Their completion replaces only the population card, preserving expanded report maps. A newer region/filter selection always wins over an older response, including providers that ignore cancellation.

## Clicked calculation details

The population card opens a dialog only when clicked. It displays the exact merged geometry sent to WorldPop, report points, the returned area, report count, 500-meter radius, dataset year, returned population, and rounded card value. Component population bars appear only when the provider returns verified totals for the separate polygons. The map shows the calculation boundary, not an invented density layer.

The source boxes link to the validated v2 task result, API documentation, and WorldPop modeling methods, and identify what each was used for. NeedMap's report coordinates and 500-meter assumption are described separately from population data. An open loading dialog updates when the estimate arrives; changing region/category or leaving Analysis closes it. Closing the dialog releases its map and restores keyboard focus to the population card.

The area map establishes its view before adding Leaflet polygons. Tile failures do not remove the local boundary or report points. If the interactive renderer fails, the dialog draws the same geometry and points as a local SVG outline without network requests, preserving holes and wrapping areas across the date line.

## Verification and provider documentation

On October 22, 2026, live requests confirmed browser CORS support and 2025 results for a public San Francisco test polygon, a 500-meter buffer, multiple separate buffers, and an ocean polygon returning numeric zero. Automated tests cover overlap, duplicate locations, region clipping, dateline/poles, missing coordinates, response validation, cancellation, caching, and UI selection races.

- [WorldPop API documentation](https://api.worldpop.org/v2/)
- [Machine-readable v2 schema](https://api.worldpop.org/v2/openapi.json)
- [WorldPop population modeling](https://www.worldpop.org/methods/populations/)

# Worldwide region navigation

`world-region-catalog.js` is the complete directory used by the map. Countries,
states/provinces, and generated NeedMap areas share one searchable dropdown.
An empty search shows every country and territory alphabetically. Typing
searches the entire directory and displays all matches without a result cutoff;
no entry requires opening another region first. There is no California-specific directory or
separate area menu. The UI has no CSV or other export controls.

The directory retains the original country/state entries from the
[Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database),
commit `48f586f2d068e4d9ea0e50eafc16c3d0d7190070`, under ODbL 1.0. Additional
administrative areas and precomputed groups come from the pinned
[geoBoundaries CGAZ](https://www.geoboundaries.org/globalDownloads.html) release.
See [world data build and coverage](WORLD-REGIONS.md) and the internal
`world-region-build.json` audit for exact counts, source revisions, unmatched
entries, and whole-parent fallbacks. Catalog labels are not a statement about
political recognition or disputed borders. Boundaries represent the source
release and may differ from current administrative divisions.

## Geographic grouping

One versioned algorithm applies everywhere, including California. States larger
than 120,000 square kilometres can be divided into two to six nearby groups of
administrative units, with at least two units per group and sufficient parent
coverage. Small states, unsupported date-line shapes, and incomplete or overly
complex source data remain whole. Their directory entries remain searchable.
Countries are overview entries. Source coverage and grouping decisions are
recorded in the build audit; the directory does not claim every administrative
level or every historical region worldwide.

Only the offline build runs polygon grouping. Each supported parent and its
children are stored together in a same-origin JSON file. `world-region-boundaries.js`
validates the file against its parent/country, bounds the transfer and geometry
complexity, and reconstructs deterministic shared-boundary ownership.
`region-navigation.js` additionally verifies that the file contains exactly the
IDs listed for that file in the directory. A failure preserves the previous
manual selection. Eight recently used parent sets are cached in memory.

Original directory entries without a bundled polygon use the existing
OpenStreetMap Nominatim lookup when selected. Navigation and report enrichment
share a request queue; successful fallback boundaries are cached for 30 days.
`VITE_REGION_LOOKUP_ENDPOINT` can configure a compatible provider. Production
provider capacity must cover total application traffic; a browser-local queue
is not a global quota. See [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/).

## Automatic selection

Opening the map uses approximate IP location without a device-location prompt.
The default endpoint is [GeoJS](https://www.geojs.io/docs/v1/endpoints/geo/).
Country/state names and codes identify a directory entry. Valid approximate
coordinates are rounded to two decimal places and kept only in memory to choose
a contained precomputed NeedMap area. IP addresses and city details are discarded;
coordinates are never stored or forwarded to a boundary provider. A missing
position keeps the whole-state view. A state lookup failure can fall back to the
country; a complete failure keeps the current view, initially Worldwide.

`VITE_IP_LOCATION_ENDPOINT` can configure a compatible browser-accessible IP
provider. Server proxies must identify the visitor from trusted hosting metadata.
API secrets must stay server-side. VPNs and network gateways can make IP location
inaccurate, and providers can fail or throttle requests. The requested Change
Region search is always available for manual selection. Incoming reports and
late automatic responses cannot replace a newer manual choice.

## Verification

Tests cover the full country list, complete-directory search, direct search before navigation,
exact file/index agreement, polygon containment, same-origin file validation,
IP privacy, cancellation, denied storage, fallback providers, and manual choices
winning over pending requests. Dataset integrity tests load every shipped
boundary file through the runtime loader. Browser checks cover the production
build and the single region search.

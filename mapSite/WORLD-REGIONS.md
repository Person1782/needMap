# Precomputed worldwide regions

`world-region-catalog.js` contains the complete searchable navigation index at
first load. All 4,355 original country/state entries remain present, including
249 ISO country/territory codes and Kosovo. Verified administrative areas that
do not match an existing catalog entry are also listed, together with every
precomputed NeedMap subdivision. Subdivisions do not depend on someone first
opening their state. The `WORLD_REGION_BUILD` export records the exact current
counts and source fingerprints.

The verified build contains **5,422 entries**: 250 countries/territories, 4,771
state/province entries (4,105 original and 666 additional source entries), and
401 NeedMap subdivisions across 146 parents. There are 3,201 parent boundary
files containing 3,602 parent/child records, totaling 98,522,658 UTF-8 bytes.
All 3,201 files passed the runtime loader's validation. The index retains 1,570
original state entries without a matched CGAZ parent; they use the existing
boundary lookup on selection. Another 92 eligible large parents remain whole
where a verified partition could not be produced. Twenty-four corrupted source
names were repaired, and independent country-code verification found exactly
the 249 ISO countries/territories plus Kosovo.

NeedMap applies one geographic grouping rule worldwide, including California.
States/provinces over 120,000 square kilometers can form two to six groups of
neighboring administrative areas. The model requires sufficient local areas and
at least 98% verified parent coverage before making a subdivision. Smaller
states and unsupported/incomplete partitions remain one region. A complete
country/state entry remains selectable when detailed subdivision data is
unavailable. These are NeedMap navigation groupings, not VEX regions or official
administrative boundaries.

Each verified parent has one versioned JSON file under `public/data/regions/`.
It contains the complete parent and its precomputed children. Only the selected
parent's file is downloaded by the browser. Global source data and polygon
grouping run during the offline build. Child boundary seam ownership is
reconstructed by the runtime loader from the ordered child polygons.

## Sources and attribution

The boundaries come from [geoBoundaries CGAZ](https://www.geoboundaries.org/globalDownloads.html),
the project's simplified, gap-filled global administrative composite. CGAZ
uses United States Department of State definitions for disputed areas; the
underlying administrative data has different represented years by country.
The project requires attribution, and the source is credited in the map.
See [geoBoundaries citation information](https://www.geoboundaries.org/index.html#citation).

Build inputs are pinned to geoBoundaries repository commit
`5c25134028196d43ce97b5071934fd0cfc92f09f`:

- [CGAZ ADM1 GeoPackage](https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/5c25134028196d43ce97b5071934fd0cfc92f09f/releaseData/CGAZ/geoBoundariesCGAZ_ADM1.gpkg):
  144,470,016 bytes, 3,224 source features, SHA-256
  `d2f2f7854e887c99a23f2ad1c9e7627c05db15ecc4d9f94972c0d193d255a63d`.
- [CGAZ ADM2 GeoPackage](https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/5c25134028196d43ce97b5071934fd0cfc92f09f/releaseData/CGAZ/geoBoundariesCGAZ_ADM2.gpkg):
  240,824,320 bytes, 49,349 source features, SHA-256
  `6bc948cdd84575b733573d7983cf2503e1c71d66d2434db04502ae5fba60eec1`.

The original names/codes and ISO alpha2/alpha3 mapping come from the
[Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database),
commit `48f586f2d068e4d9ea0e50eafc16c3d0d7190070`, under ODbL 1.0; the existing
`region-catalog-LICENSE.txt` applies to those data. Country/state records remain
available in the generated JavaScript index. Source names are matched by
normalized name/native-name within the same country, using administrative-name
prefix aliases only when the match is unambiguous. Reversible source mojibake is
repaired before matching; legitimate Unicode names are preserved.

## Rebuilding and checking

The build requires Node.js with the map's installed dependencies, Python 3, and
Shapely (the verified build used Shapely 2.2.0). Download the pinned GeoPackages
above to a build cache, then run from `mapSite`:

```sh
python3 scripts/prepare-world-boundaries.py /path/ADM1.gpkg /path/ADM2.gpkg /path/prepared
node scripts/build-world-regions.mjs /path/prepared
```

The preparation step repairs invalid source polygons, simplifies them by 0.001
degrees while preserving topology, and rounds coordinates to six decimal
places. Collapsed rings are removed without promoting holes to polygon shells.
All repairs, missing names, and omitted empty source records are audited.
The build writes only the index, required boundary JSON files, and an internal
`world-region-build.json` audit. It does not add a CSV/export feature.

Use `--resume` to retain existing successful geometry by source shape ID.
Use `--resume --retry-unsplit` after a model fix to retry eligible whole states
while preserving successful partitions. A complex partition gets a 30-second
offline computation budget; if it cannot complete, the full parent is retained.
Renamed/rematched records reuse geometry under their corrected IDs, and obsolete
generated files are removed. The internal audit distinguishes whole-parent
fallbacks, matches to existing entries, extra source entries, and unassigned
country/disputed source records. Numeric disputed-area codes are never invented
as country codes. Original countries and unmatched state entries use their
existing administrative-boundary lookup when selected.

`tests/world-region-catalog.test.js` verifies index completeness, country-code
coverage, parent/child consistency, and every shipped file through the runtime
loader. Source-name/ring-cleaning tests and the pure grouping tests cover the
offline build invariants. No live boundary download is needed to search the
complete region index.

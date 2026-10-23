import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { REGION_CATALOG_ROWS } from "../region-catalog.js";
import { WORLD_REGION_BUILD, WORLD_REGION_ROWS } from "../world-region-catalog.js";
import { countRegions, searchRegions } from "../region-navigation.js";
import { loadWorldRegionSet, WORLD_REGION_BOUNDARY_LIMITS } from "../world-region-boundaries.js";

const publicRoot = new URL("../public/", import.meta.url);
const directory = new URL("data/regions/", publicRoot);
const entries = WORLD_REGION_ROWS.map(([id, name, nativeName, kind, countryCode, parentId, boundaryFile]) =>
  ({ id, name, nativeName, kind, countryCode, parentId, boundaryFile }));
const byId = new Map(entries.map((entry) => [entry.id, entry]));
const children = entries.filter((entry) => entry.kind === "needmap");
const parents = entries.filter((entry) => entry.kind !== "needmap" && entry.boundaryFile);

// Independent ISO3166-1 snapshot from pycountry26.2.16, checked2026-10-22.
// Source: https://github.com/pycountry/pycountry (Debian pkg-isocodes data).
// This reference is deliberately independent of both NeedMap source catalogs.
const isoCountryCodes = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/);

test("the country list independently includes all249 ISO3166-1 entries plus Kosovo", () => {
  assert.equal(isoCountryCodes.length, 249);
  assert.equal(new Set(isoCountryCodes).size, 249);
  const actual = entries.filter((entry) => entry.kind === "country").map((entry) => entry.id).sort();
  assert.deepEqual(actual, [...isoCountryCodes, "XK"].sort());
  assert.equal(byId.get("XK").name, "Kosovo");
});

test("the complete global catalog retains every original country and state exactly once", () => {
  assert.equal(WORLD_REGION_BUILD.status, "complete");
  assert.equal(WORLD_REGION_BUILD.version, "needmap-v2");
  assert.equal(byId.size, entries.length, "unique region IDs");
  assert.equal(entries.length, WORLD_REGION_BUILD.totalEntries);
  assert.equal(REGION_CATALOG_ROWS.length, WORLD_REGION_BUILD.originalCatalogEntries);
  for (const [id, name, nativeName] of REGION_CATALOG_ROWS) {
    const retained = byId.get(id);
    assert.ok(retained, `Original catalog entry ${id} is retained`);
    assert.equal(retained.name, name, id);
    assert.equal(retained.nativeName, nativeName, id);
    assert.equal(retained.kind, id.length === 2 ? "country" : "state", id);
    assert.equal(retained.countryCode, id.slice(0, 2), id);
  }
  assert.equal(entries.filter((entry) => entry.kind === "country").length, WORLD_REGION_BUILD.countries);
  assert.equal(parents.length, WORLD_REGION_BUILD.sourceParents);
  assert.equal(parents.length, WORLD_REGION_BUILD.files);
  assert.equal(children.length, WORLD_REGION_BUILD.generatedRegions);
  assert.equal(new Set(children.map((child) => child.parentId)).size, WORLD_REGION_BUILD.partitionedParents);
  assert.equal(entries.filter((entry) => entry.kind === "state" && !entry.boundaryFile).length,
    WORLD_REGION_BUILD.originalStateFallbacks);
});

test("every derived region uses the same versioned hierarchy and geographic naming convention", () => {
  const geographicSuffix = / — (?:Far (?:North|South|East|West)|North Central|South Central|West Central|East Central|Upper Central|Lower Central|Western Central|Eastern Central|North|South|East|West|Central)$/;
  for (const child of children) {
    const parent = byId.get(child.parentId);
    assert.ok(parent && parent.kind === "state", `${child.id}: valid state parent`);
    assert.ok(child.id.startsWith(`${parent.id}:needmap-v2:`), child.id);
    assert.ok(child.name.startsWith(`${parent.name} — `), child.id);
    assert.match(child.name, geographicSuffix, child.id);
    assert.equal(child.countryCode, parent.countryCode, child.id);
    assert.ok(child.boundaryFile, child.id);
    assert.equal(child.boundaryFile, parent.boundaryFile, child.id);
  }
  for (const entry of entries.filter((item) => !item.boundaryFile)) {
    assert.notEqual(entry.kind, "needmap", `${entry.id}: unsupported subdivision is not invented`);
  }
  // Representative countries on five inhabited continents must have their
  // derived areas in the initial catalog, not only after a parent is opened.
  for (const countryCode of ["US", "BR", "IN", "ZA", "AU"]) {
    assert.ok(children.some((entry) => entry.countryCode === countryCode), `${countryCode}: prelisted derived regions`);
  }
  // This pinned source has 36 Maharashtra districts with more than99% parent
  // coverage. A near-identical coastal intersection formerly made the final
  // overlay fail and incorrectly left the whole state unsplit.
  assert.deepEqual(children.filter((entry) => entry.parentId === "IN-MH").map((entry) => entry.id).sort(), [
    "IN-MH:needmap-v2:central", "IN-MH:needmap-v2:east", "IN-MH:needmap-v2:west",
  ]);
});

test("initial local search and pagination expose every global catalog entry exactly once", () => {
  assert.equal(countRegions(), entries.length);
  const listed = [];
  for (let offset = 0; offset < entries.length; offset += 100) {
    listed.push(...searchRegions("", { offset, limit: 100 }).map((entry) => entry.id));
  }
  assert.equal(listed.length, entries.length);
  assert.equal(new Set(listed).size, entries.length);
  assert.deepEqual([...listed].sort(), [...byId.keys()].sort());
  for (const countryCode of ["US", "BR", "IN", "ZA", "AU"]) {
    const child = children.find((entry) => entry.countryCode === countryCode);
    assert.equal(searchRegions(child.id)[0]?.id, child.id);
  }
});

test("every shipped boundary file passes the actual runtime loader and exactly matches its catalog records", async (context) => {
  const expectedFiles = new Map(parents.map((parent) => [parent.boundaryFile, parent]));
  assert.equal(expectedFiles.size, parents.length, "one file per parent without path collisions");
  const filenames = (await fs.readdir(directory)).sort();
  assert.ok(filenames.every((name) => /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name)), "only expected JSON region artifacts are shipped");
  const actualFiles = filenames.map((name) => `data/regions/${name}`);
  assert.deepEqual(actualFiles, [...expectedFiles.keys()].sort(), "no missing or orphaned boundary files");
  const byFile = new Map();
  for (const entry of entries.filter((item) => item.boundaryFile)) {
    const members = byFile.get(entry.boundaryFile) || [];
    members.push(entry); byFile.set(entry.boundaryFile, members);
  }
  let loadedFiles = 0, loadedRecords = 0, bytes = 0;
  const fetchImpl = async (url) => {
    const file = new URL(url).pathname.replace(/^\//, "");
    assert.ok(expectedFiles.has(file), `Only an indexed local file is requested: ${file}`);
    const content = await fs.readFile(new URL(file, publicRoot));
    bytes += content.byteLength;
    assert.ok(content.byteLength <= WORLD_REGION_BOUNDARY_LIMITS.maxBytes, `${file}: bounded download`);
    return new Response(content, { headers: { "content-length": String(content.byteLength) } });
  };
  const failures = [];
  for (const file of actualFiles) {
    try {
      const regions = await loadWorldRegionSet(expectedFiles.get(file), { fetchImpl });
      loadedFiles += 1; loadedRecords += regions.length;
      const expected = byFile.get(file);
      assert.equal(regions.length, expected.length, `${file}: complete record count`);
      assert.ok(regions.length <= WORLD_REGION_BOUNDARY_LIMITS.maxRegions, `${file}: bounded set`);
      assert.deepEqual(regions.map((region) => region.id).sort(), expected.map((entry) => entry.id).sort(), `${file}: exact indexed region IDs`);
      for (const region of regions) {
        const entry = byId.get(region.id);
        assert.equal(region.name, entry.name, `${file}: name ${region.id}`);
        assert.equal(region.kind, entry.kind, `${file}: kind ${region.id}`);
        assert.equal(region.countryCode, entry.countryCode, `${file}: country ${region.id}`);
        assert.equal(region.parentId, entry.parentId || null, `${file}: parent ${region.id}`);
      }
    } catch (error) { failures.push(`${file}: ${error.message}`); }
  }
  context.diagnostic(`Validated ${loadedFiles}/${actualFiles.length} boundary files, ${loadedRecords} region records, ${bytes} bytes.`);
  assert.deepEqual(failures, [], `All shipped files must load. ${failures.length} failing file(s).`);
  assert.equal(loadedFiles, WORLD_REGION_BUILD.files);
  assert.equal(loadedRecords, parents.length + children.length);
});

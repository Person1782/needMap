import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createBundledReportRegionResolver } from "../bundled-report-regions.js";
import { enrichSignalsWithRegions } from "../regions.js";
import { geometrySearchBounds, buildReportRegionIndex } from "../scripts/build-report-region-index.mjs";
import { REPORT_REGION_BOUNDS } from "../report-region-bounds.js";

const square = (west = 0, south = 0, east = 4, north = 4) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const parentId = "XX-ONE";
const file = "data/regions/xx-one.json";
const children = [`${parentId}:needmap-v2:west`, `${parentId}:needmap-v2:east`];
const rows = [
  ["XX", "Example country", "", "country", "XX", "", ""],
  [parentId, "Example state", "", "state", "XX", "", file],
  ...children.map((id, index) => [id, index ? "Eastern area" : "Western area", "", "needmap", "XX", parentId, file]),
];
const data = () => ({ version: "needmap-v2", parentId, regions: [
  { id: parentId, name: "Example state", kind: "state", countryCode: "XX", geometry: square() },
  { id: children[0], name: "Western area", kind: "needmap", countryCode: "XX", parentId, geometry: square(0, 0, 2, 4) },
  { id: children[1], name: "Eastern area", kind: "needmap", countryCode: "XX", parentId, geometry: square(2, 0, 4, 4) },
] });
const point = (longitude = 1, latitude = 1) => ({ latitude, longitude });
function fixture(value = data(), customRows = rows) {
  const calls = [];
  const resolver = createBundledReportRegionResolver({ rows: customRows, bounds: [[parentId, 0, 0, 4, 4]],
    fetchImpl: async (url) => { calls.push(url); return new Response(JSON.stringify(value)); } });
  return { resolver, calls };
}

test("bundled report lookup selects containing children, respects seam exclusions, and reuses successful files", async () => {
  const { resolver, calls } = fixture();
  assert.equal((await resolver(point(1))).id, children[0]);
  assert.equal((await resolver(point(3))).id, children[1]);
  assert.equal((await resolver(point(2))).id, children[0]);
  assert.equal((await resolver(point(3))).countryCode, "XX");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).pathname, `/${file}`);
});

test("bounds never substitute for exact polygon membership or fill boundary holes", async () => {
  const triangle = data();
  triangle.regions = [{ ...triangle.regions[0], geometry: { type: "Polygon", coordinates: [
    [[0, 0], [4, 0], [0, 4], [0, 0]],
  ] } }];
  const parentRows = rows.slice(0, 2);
  const first = fixture(triangle, parentRows);
  assert.equal(await first.resolver(point(3, 3)), null);
  const hole = data(); hole.regions = [hole.regions[0]];
  hole.regions[0].geometry.coordinates.push(square(1, 1, 2, 2).coordinates[0]);
  const second = fixture(hole, parentRows);
  assert.equal(await second.resolver(point(1.5, 1.5)), null);
  assert.equal((await second.resolver(point(3, 3))).id, parentId);
});

test("invalid and outside-index positions do not initiate downloads", async () => {
  const { resolver, calls } = fixture();
  for (const value of [null, {}, point(NaN), point(181), point(1, 91), point(20, 20)]) {
    assert.equal(await resolver(value), null);
  }
  assert.equal(calls.length, 0);
});

test("mixed-country, missing-child, and wrong-parent files cannot supply report assignments", async () => {
  const wrongCountry = data(); wrongCountry.regions[0].countryCode = "YY";
  await assert.rejects(fixture(wrongCountry).resolver(point()), /boundar/i);
  const incomplete = data(); incomplete.regions.pop();
  await assert.rejects(fixture(incomplete).resolver(point()), /incomplete/);
  const wrongParent = data(); wrongParent.parentId = "YY-ONE";
  await assert.rejects(fixture(wrongParent).resolver(point()), /different parent/);
});

test("verified overlapping polygons from different countries remain unresolved", async () => {
  const countryRows = [
    ["XX-ONE", "First state", "", "state", "XX", "", "data/regions/xx-one.json"],
    ["YY-ONE", "Second state", "", "state", "YY", "", "data/regions/yy-one.json"],
  ];
  const resolver = createBundledReportRegionResolver({ rows: countryRows,
    bounds: countryRows.map(([id]) => [id, 0, 0, 4, 4]),
    fetchImpl: async (url) => {
      const second = url.includes("yy-one");
      const id = second ? "YY-ONE" : "XX-ONE";
      return new Response(JSON.stringify({ version: "needmap-v2", parentId: id, regions: [
        { id, name: id, kind: "state", countryCode: second ? "YY" : "XX", geometry: square() },
      ] }));
    } });
  assert.equal(await resolver(point()), null);
});

test("the two verified American Samoa aliases resolve to one consistent country identity", async () => {
  const resolver = createBundledReportRegionResolver({ fetchImpl: async (url) => {
    const name = new URL(url).pathname.split("/").at(-1);
    assert.ok(["as.json", "us-as.json"].includes(name));
    return new Response(await fs.readFile(new URL(`../public/data/regions/${name}`, import.meta.url), "utf8"));
  } });
  const region = await resolver(point(-170.7, -14.275));
  assert.equal(region.id, "AS");
  assert.equal(region.countryCode, "AS");
});

test("date-line bounds include both sides while exact geometry rejects Greenwich", async () => {
  const geometry = square(179, -2, -179, 2);
  const value = data(); value.regions = [{ ...value.regions[0], geometry }];
  const resolver = createBundledReportRegionResolver({ rows: rows.slice(0, 2),
    bounds: [[parentId, ...geometrySearchBounds(geometry)]], fetchImpl: async () => new Response(JSON.stringify(value)) });
  assert.equal((await resolver(point(179.5, 0))).id, parentId);
  assert.equal((await resolver(point(-179.5, 0))).id, parentId);
  assert.equal(await resolver(point(0, 0)), null);
});

test("a failed file is retried and a cancelled lookup cannot return a late region", async () => {
  let calls = 0;
  const resolver = createBundledReportRegionResolver({ rows, bounds: [[parentId, 0, 0, 4, 4]], fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? new Response("Unavailable", { status: 503 }) : new Response(JSON.stringify(data()));
  } });
  await assert.rejects(resolver(point()), /HTTP 503/);
  assert.equal((await resolver(point())).id, children[0]);
  assert.equal(calls, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolver(point(), { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 2);
  let deliver;
  const waiting = createBundledReportRegionResolver({ rows, bounds: [[parentId, 0, 0, 4, 4]],
    fetchImpl: () => new Promise((resolve) => { deliver = resolve; }) });
  const active = new AbortController();
  const operation = waiting(point(), { signal: active.signal });
  active.abort();
  await assert.rejects(operation, { name: "AbortError" });
  deliver(new Response(JSON.stringify(data())));
});

test("verified bundled regions bypass Nominatim and preserve progress reporting", async (t) => {
  const remote = t.mock.method(globalThis, "fetch", () => { throw new Error("Remote lookup must not run"); });
  const progress = [];
  const { resolver } = fixture();
  const input = [{ id: "a", ...point(1) }, { id: "b", ...point(3) }];
  const output = await enrichSignalsWithRegions(input, { bundledResolver: resolver, onProgress: (...values) => progress.push(values) });
  assert.deepEqual(output.map(({ region }) => region.id), children);
  assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
  assert.equal(remote.mock.callCount(), 0);
  assert.equal(input[0].region, undefined);
});

test("a bundled lookup failure retains the verified remote fallback", async (t) => {
  t.mock.method(console, "warn", () => {});
  const remote = t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({
    osm_id: 98765, osm_type: "relation", name: "Remote district", geojson: square(29, 29, 31, 31),
  }) }));
  const result = await enrichSignalsWithRegions([point(30, 30)], { bundledResolver: async () => { throw new Error("Static file unavailable"); } });
  assert.equal(result[0].region.name, "Remote district");
  assert.equal(remote.mock.callCount(), 1);
});

test("the checked-in compact index reproduces every current bundled parent without downloads", async () => {
  const generated = await buildReportRegionIndex();
  assert.deepEqual(generated, REPORT_REGION_BOUNDS);
  assert.ok(generated.length > 3000);
  assert.ok(Buffer.byteLength(JSON.stringify(generated)) < 200000);
});

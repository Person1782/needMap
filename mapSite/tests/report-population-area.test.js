import test from "node:test";
import assert from "node:assert/strict";
import { buildReportPopulationArea } from "../report-population-area.js";

const report = (id, longitude = 0, latitude = 0) => ({ id, longitude, latitude });
const area = (geometry) => (geometry?.coordinates || []).reduce((total, polygon) => total + polygon.reduce((value, ring, index) => {
  const signed = ring.slice(1).reduce((sum, [x, y], i) => sum + ring[i][0] * y - x * ring[i][1], 0) / 2;
  return value + Math.abs(signed) * (index ? -1 : 1);
}, 0), 0);
const box = (left, bottom, right, top) => ({ type: "Polygon", coordinates: [[[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]]] });

test("no reports yields no area, and coordinates must be finite numbers in bounds", () => {
  assert.equal(buildReportPopulationArea([]).geometry, null);
  const result = buildReportPopulationArea([report("ok"), { id: "missing" }, { id: "string", latitude: "0", longitude: 0 }, report("nan", NaN), report("outside", 181), report("lat", 0, 91)]);
  assert.equal(result.reportCount, 1);
  assert.equal(result.missingLocationCount, 5);
  assert.equal(buildReportPopulationArea([{}]).missingLocationCount, 1);
  assert.equal(result.radiusMeters, 500);
});

test("buffers measure 500 meters at the equator and higher latitudes", () => {
  for (const latitude of [0, 60, -60]) {
    const result = buildReportPopulationArea([report("a", 10, latitude)]);
    const ring = result.geometry.coordinates[0][0];
    assert.equal(ring.length, 65);
    for (const [x, y] of ring) {
      const rad = Math.PI / 180;
      const haversine = Math.sin((y - latitude) * rad / 2) ** 2 +
        Math.cos(latitude * rad) * Math.cos(y * rad) * Math.sin((x - 10) * rad / 2) ** 2;
      const meters = 6371008.8 * 2 * Math.asin(Math.sqrt(haversine));
      assert.ok(Math.abs(meters - 500) < 0.01);
    }
  }
});

test("deduplicates IDs and coordinates without multiplying residents", () => {
  const single = buildReportPopulationArea([report("a")]);
  const duplicate = buildReportPopulationArea([report("a"), report("a", 1), report("b"), { latitude: 0, longitude: 0 }]);
  assert.equal(duplicate.reportCount, 3);
  assert.deepEqual(duplicate.geometry, single.geometry);
  const overlapping = buildReportPopulationArea([report("a"), report("b", 0.003)]);
  assert.ok(area(overlapping.geometry) > area(single.geometry));
  assert.ok(area(overlapping.geometry) < area(single.geometry) * 2);
  assert.equal(overlapping.geometry.coordinates.length, 1);
});

test("disjoint buffers stay separate and stable across report order", () => {
  const reports = [report("a"), report("b", 0.02)];
  const result = buildReportPopulationArea(reports, { id: "region" });
  assert.equal(result.geometry.coordinates.length, 2);
  assert.ok(Math.abs(area(result.geometry) / area(buildReportPopulationArea([reports[0]]).geometry) - 2) < 1e-6);
  assert.equal(result.key, buildReportPopulationArea([...reports].reverse(), { id: "region" }).key);
});

test("dateline buffers cover only a small neighborhood on both sides", () => {
  const reference = buildReportPopulationArea([report("a")]);
  const result = buildReportPopulationArea([report("a", 179.999)]);
  assert.equal(result.geometry.coordinates.length, 2);
  assert.ok(Math.abs(area(result.geometry) / area(reference.geometry) - 1) < 1e-5);
  for (const polygon of result.geometry.coordinates) for (const ring of polygon) {
    assert.ok(ring.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90));
    assert.ok(Math.max(...ring.map(([x]) => x)) - Math.min(...ring.map(([x]) => x)) < 0.02);
  }
  const both = buildReportPopulationArea([report("a", 179.999), report("b", -179.999)]);
  assert.ok(area(both.geometry) < 2 * area(result.geometry));
});

test("polar buffers stay within their polar cap", () => {
  for (const latitude of [90, -90, 89.999, -89.999]) {
    const result = buildReportPopulationArea([report("pole", 30, latitude)]);
    assert.ok(result.geometry);
    for (const polygon of result.geometry.coordinates) for (const ring of polygon) {
      assert.ok(ring.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90 && Math.abs(y) > 89.99));
      assert.deepEqual(ring[0], ring[ring.length - 1]);
    }
  }
});

test("clips to a selected region including holes and dateline boundaries", () => {
  const full = buildReportPopulationArea([report("a")]);
  const half = buildReportPopulationArea([report("a")], { id: "half", geometry: box(0, -1, 1, 1) });
  assert.ok(Math.abs(area(half.geometry) / area(full.geometry) - 0.5) < 1e-6);
  const hole = box(-1, -1, 1, 1);
  hole.coordinates.push(box(-0.001, -0.001, 0.001, 0.001).coordinates[0]);
  const holed = buildReportPopulationArea([report("a")], { geometry: hole });
  assert.ok(Math.abs(area(full.geometry) - area(holed.geometry) - 0.000004) < 1e-10);
  const dateline = buildReportPopulationArea([report("a", 179.999)], { geometry: box(179, -1, -179, 1) });
  assert.ok(Math.abs(area(dateline.geometry) / area(full.geometry) - 1) < 1e-5);
  const worldwide = buildReportPopulationArea([report("a")], { geometry: box(-180, -90, 180, 90) });
  assert.deepEqual(worldwide.geometry, full.geometry);
  assert.equal(buildReportPopulationArea([report("a")], { geometry: box(10, 10, 11, 11) }).geometry, null);
});

test("explicitly refuses too many locations or invalid boundaries", () => {
  assert.throws(() => buildReportPopulationArea(Array.from({ length: 201 }, (_, i) => report(i, i / 100))), RangeError);
  assert.throws(() => buildReportPopulationArea([report("a")], { geometry: { type: "Point", coordinates: [0, 0] } }), TypeError);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import polygonClipping from "polygon-clipping";
import { buildNeedMapRegions, NEEDMAP_REGION_VERSION, needMapRegionContains, regionAreaKm2, shouldSplitRegion } from "../needmap-regions.js";

const rectangle = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const feature = (name, geometry) => ({ type: "Feature", properties: { shapeName: name, shapeID: name }, geometry });
const collection = (features) => ({ type: "FeatureCollection", features });
const parent = (geometry = rectangle(0, 0, 6, 4), extra = {}) => ({
  id: "XX-ONE", name: "Example Province", kind: "state", country: "Example Country", countryCode: "XX", geometry, ...extra,
});
const grid = (gap = 0) => collection(Array.from({ length: 12 }, (_, index) => {
  const column = index % 6, row = Math.floor(index / 6);
  return feature(`District ${String(index + 1).padStart(2, "0")}`,
    rectangle(column + gap, row * 2 + gap, column + 1 - gap, row * 2 + 2 - gap));
}));
const area = (coordinates) => coordinates.length ? regionAreaKm2({ type: "MultiPolygon", coordinates }) : 0;

function assertPartition(regions, selectedParent) {
  assert.ok(regions.length >= 2 && regions.length <= 6);
  const combined = polygonClipping.union(...regions.map((region) => region.geometry.coordinates));
  const parentCoordinates = selectedParent.geometry.type === "Polygon"
    ? [selectedParent.geometry.coordinates] : selectedParent.geometry.coordinates;
  assert.ok(area(polygonClipping.difference(parentCoordinates, combined)) < 0.01, "parent coverage");
  assert.ok(area(polygonClipping.difference(combined, parentCoordinates)) < 0.01, "inside parent");
  regions.forEach((region, index) => {
    assert.equal(region.kind, "needmap");
    assert.equal(region.parentId, selectedParent.id);
    assert.ok(region.memberNames.length >= 2);
    for (const other of regions.slice(index + 1)) {
      assert.ok(area(polygonClipping.intersection(region.geometry.coordinates, other.geometry.coordinates)) < 0.01,
        `${region.name} and ${other.name} have no interior overlap`);
    }
  });
}

test("every country and state uses the same geographic rules without regional exceptions", () => {
  assert.equal(NEEDMAP_REGION_VERSION, "needmap-v2");
  const data = grid(), geometry = parent().geometry;
  const normalized = (regions) => regions.map((region) => ({
    slug: region.slug, geometry: region.geometry, excludedGeometry: region.excludedGeometry,
    memberNames: region.memberNames,
  }));
  const expected = normalized(buildNeedMapRegions(parent(geometry), data));
  for (const [id, name, countryCode, country] of [
    ["US-CA", "California", "US", "United States"],
    ["IN-MH", "Maharashtra", "IN", "India"],
    ["BR-PA", "Pará", "BR", "Brazil"],
  ]) {
    const regions = buildNeedMapRegions(parent(geometry, { id, name, countryCode, country }), data);
    assert.deepEqual(normalized(regions), expected);
    assert.ok(regions.every((region) => region.id.startsWith(`${id}:needmap-v2:`)));
    assert.ok(regions.every((region) => region.name.startsWith(`${name} — `)));
  }
});

test("small areas, country overviews, malformed geometry, and date-line parents stay whole", () => {
  assert.equal(shouldSplitRegion(parent()), true);
  assert.equal(shouldSplitRegion(parent(rectangle(0, 0, 1, 1))), false);
  assert.equal(shouldSplitRegion(parent(rectangle(0, 0, 10, 10), { kind: "country" })), false);
  assert.equal(shouldSplitRegion(parent(rectangle(179, 0, -179, 10))), false);
  assert.equal(shouldSplitRegion(parent(null)), false);
  assert.equal(shouldSplitRegion(parent(rectangle(0, 0, 1, 1), { id: "US-CA" })), false);
  assert.equal(regionAreaKm2({ type: "Polygon", coordinates: [] }), 0);
});

test("large provinces group neighboring districts deterministically with complete coverage", () => {
  const selectedParent = parent(), data = grid();
  const regions = buildNeedMapRegions(selectedParent, data);
  assert.equal(regions.length, 3);
  assertPartition(regions, selectedParent);
  assert.deepEqual(regions, buildNeedMapRegions(selectedParent, collection([...data.features].reverse())));
  assert.deepEqual(regions.flatMap((region) => region.memberNames).sort(), data.features.map((item) => item.properties.shapeName).sort());
  for (let longitude = 0; longitude <= 6; longitude += 0.25) {
    for (let latitude = 0; latitude <= 4; latitude += 0.25) {
      assert.equal(regions.filter((region) => needMapRegionContains(region, latitude, longitude)).length, 1,
        `Exactly one owner at ${latitude},${longitude}, including shared seams`);
    }
  }
  assert.equal(regions.some((region) => needMapRegionContains(region, -1, -1)), false);
  assert.equal(regions.some((region) => needMapRegionContains(region, NaN, 1)), false);
});

test("small source gaps are reconciled while large missing districts fail safely", () => {
  const selectedParent = parent();
  const regions = buildNeedMapRegions(selectedParent, grid(0.001));
  assertPartition(regions, selectedParent);
  assert.equal(regions.filter((region) => needMapRegionContains(region, 2, 3)).length, 1);
  assert.deepEqual(buildNeedMapRegions(selectedParent, collection(grid().features.slice(0, 6))), []);
  assert.deepEqual(buildNeedMapRegions(selectedParent, collection(grid().features.slice(0, 3))), []);
  assert.deepEqual(buildNeedMapRegions(selectedParent, { type: "FeatureCollection", features: null }), []);
});

test("holes and detached islands remain faithful to the verified parent geometry", () => {
  const main = rectangle(0, 0, 6, 4);
  main.coordinates.push(rectangle(2.25, 1.25, 2.75, 1.75).coordinates[0]);
  const island = rectangle(7, 0, 8, 2);
  const selectedParent = parent({ type: "MultiPolygon", coordinates: [main.coordinates, island.coordinates] });
  const data = collection([...grid().features,
    feature("Island North", rectangle(7, 1, 8, 2)), feature("Island South", rectangle(7, 0, 8, 1))]);
  const regions = buildNeedMapRegions(selectedParent, data);
  assertPartition(regions, selectedParent);
  assert.equal(regions.some((region) => needMapRegionContains(region, 1.5, 2.5)), false);
  assert.equal(regions.filter((region) => needMapRegionContains(region, 0.5, 7.5)).length, 1);
  assert.equal(regions.some((region) => needMapRegionContains(region, 1, 6.5)), false);
});

test("overlapping source districts do not double count shared report locations", () => {
  const selectedParent = parent();
  const data = grid();
  data.features[0].geometry = rectangle(0, 0, 1.05, 2);
  const regions = buildNeedMapRegions(selectedParent, data);
  assertPartition(regions, selectedParent);
  assert.equal(regions.filter((region) => needMapRegionContains(region, 1, 1.025)).length, 1);
});

test("region counts adapt to geographic area with at least two units in every group", () => {
  for (const [width, height, columns, rows, expectedCount] of [[6, 5.5, 4, 4, 4], [20, 20, 6, 4, 6]]) {
    const selectedParent = parent(rectangle(0, 0, width, height));
    const data = collection(Array.from({ length: columns * rows }, (_, index) => {
      const column = index % columns, row = Math.floor(index / columns);
      return feature(`Area ${index}`, rectangle(column * width / columns, row * height / rows,
        (column + 1) * width / columns, (row + 1) * height / rows));
    }));
    const regions = buildNeedMapRegions(selectedParent, data);
    assert.equal(regions.length, expectedCount);
    assertPartition(regions, selectedParent);
    for (const item of data.features) {
      const points = item.geometry.coordinates[0];
      const longitude = (points[0][0] + points[2][0]) / 2;
      const latitude = (points[0][1] + points[2][1]) / 2;
      assert.equal(regions.filter((region) => needMapRegionContains(region, latitude, longitude)).length, 1);
    }
  }
});

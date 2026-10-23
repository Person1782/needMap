import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { pointInGeometry } from "../regions.js";
import { WORLD_REGION_ROWS } from "../world-region-catalog.js";

const interiorPoints = [
  ["Western District", -14.333347263499945, -170.75812979584566],
  ["Eastern District", -14.282972914499936, -170.68364495007262],
  ["Manu'a Islands", -14.247043552499917, -169.48593087009277],
  ["Rose Atoll", -14.528293552499917, -168.16423748389929],
  ["Swains Island", -11.05641041499996, -171.0796180589739],
];

test("American Samoa country and territory entries retain all five source districts", async () => {
  const geometries = [];
  for (const [id, kind, countryCode] of [["AS", "country", "AS"], ["US-AS", "state", "US"]]) {
    const row = WORLD_REGION_ROWS.find((item) => item[0] === id);
    assert.equal(row[6], `data/regions/${id.toLowerCase()}.json`);
    const bytes = await readFile(new URL(`../public/${row[6]}`, import.meta.url));
    assert.ok(bytes.byteLength < 20000, "The complete boundary stays small enough for slow connections");
    const payload = JSON.parse(bytes), record = payload.regions[0];
    assert.equal(payload.parentId, id);
    assert.equal(payload.regions.length, 1);
    assert.equal(record.kind, kind);
    assert.equal(record.countryCode, countryCode);
    assert.equal(record.source, "Natural Earth");
    assert.equal(record.sourceVersion, "5.1.1");
    assert.equal(record.sourceAreas.length, 5);
    assert.deepEqual(record.sourceAreas.map((area) => area.name).sort(), interiorPoints.map(([name]) => name).sort());
    for (const [district, latitude, longitude] of interiorPoints) {
      assert.equal(pointInGeometry(longitude, latitude, record.geometry), true, `${id}: ${district} land remains in the region`);
      assert.ok(latitude >= record.bounds[0][0] && latitude <= record.bounds[1][0] &&
        longitude >= record.bounds[0][1] && longitude <= record.bounds[1][1], `${id}: ${district} fits in the full view`);
    }
    assert.equal(pointInGeometry(-171.751, -13.834, record.geometry), false, "Nearby independent Samoa is outside American Samoa");
    assert.equal(pointInGeometry(-170, -12, record.geometry), false, "The bounding rectangle is not used as the land polygon");
    geometries.push(record.geometry);
  }
  assert.deepEqual(geometries[0], geometries[1], "Both catalog identities show the same complete territory");
});

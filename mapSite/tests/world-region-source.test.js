import assert from "node:assert/strict";
import { test } from "node:test";
import { repairWorldRegionName } from "../scripts/world-region-names.mjs";
import { cleanWorldGeometry } from "../scripts/world-region-geometry.mjs";

test("source text repairs reversible mojibake while preserving valid Unicode", () => {
  assert.equal(repairWorldRegionName("RegiÃ³n de Antofagasta"), "Región de Antofagasta");
  assert.equal(repairWorldRegionName("SANTARÃ\u0089M"), "SANTARÉM");
  assert.equal(repairWorldRegionName("La RiviÃ¨re"), "La Rivière");
  for (const name of ["România", "Kâmpŭchéa", "Suðuroy", "Garðabær", "Maharashtra", "東京都", "São Paulo"]) {
    assert.equal(repairWorldRegionName(name), name);
  }
});

test("collapsed source rings never promote a hole into an outer polygon", () => {
  const shell = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const hole = [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1], [0.5, 0.5]];
  const collapsed = [[3, 3], [3, 3], [4, 4], [3, 3]];
  const result = cleanWorldGeometry({ type: "MultiPolygon", coordinates: [[collapsed, hole], [shell, collapsed, hole]] });
  assert.deepEqual(result.geometry.coordinates, [[shell, hole]]);
  assert.equal(result.removedRings, 3);
});

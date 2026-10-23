import assert from "node:assert/strict";
import { test } from "node:test";
import { getPlanningReference } from "../planning-references.js";

const candidate = (category, facilityType, overrides = {}) => ({
  category, analysis: { facilityType },
  region: { name: "Fremont", hierarchy: "Alameda County, California, United States" },
  ...overrides,
});

test("reference matching requires verified California geography, not a namesake or nearby coordinate", () => {
  for (const region of [{ name: "Fremont", hierarchy: "Nebraska, United States" },
    { name: "Fremont" }, { name: "Newark", hierarchy: "California, United States" }, null]) {
    assert.equal(getPlanningReference(candidate("transportation", "Medical shuttle", { region,
      position: { latitude: 37.55, longitude: -121.99 } })), null);
  }
  assert.equal(getPlanningReference(null), null);
});

test("a shuttle receives vehicle capital and dated delivery benchmarks but no fabricated population or operating budget", () => {
  const reference = getPlanningReference(candidate("transportation", "Accessible medical shuttle"));
  assert.equal(reference.values.capitalCost, "169004");
  assert.equal(reference.values.contingency, "10");
  assert.equal(reference.values.deliveryWeeks, "22");
  assert.equal(reference.values.currency, "USD");
  for (const key of ["population", "adoption", "operatingCost", "currentMinutes", "proposedMinutes", "planningWeeks", "procurementWeeks"]) {
    assert.equal(Object.hasOwn(reference.values, key), false);
  }
  assert.match(reference.sources[0].note, /entire city/);
  assert.match(reference.note, /delivery only/);
  assert.equal(reference.populationContext.value, 226442);
  assert.equal(reference.populationContext.year, 2025);
  assert.match(reference.populationContext.note, /whole city/);
  assert.match(reference.fieldNotes.capitalCost, /one ADA cutaway vehicle only/);
  assert.match(reference.fieldNotes.deliveryWeeks, /not the full project timeline/);
});

test("mobile pharmacy acquisition does not become a fixed pharmacy or general clinic construction cost", () => {
  const mobile = getPlanningReference(candidate("healthcare", "Mobile pharmacy van"));
  assert.equal(mobile.values.capitalCost, "206905");
  assert.match(mobile.fieldNotes.capitalCost, /one mobile pharmacy van only/);
  for (const name of ["Pharmacy", "Community health clinic", "Primary care and pharmacy"]) {
    const reference = getPlanningReference(candidate("healthcare", name));
    assert.equal(Object.hasOwn(reference.values, "capitalCost"), false);
    assert.equal(Object.hasOwn(reference.values, "operatingCost"), false);
    assert.ok(reference.sources.length >= 2);
  }
});

test("different infrastructure scopes keep costs blank and reference objects cannot contaminate later plans", () => {
  for (const [category, facility] of [["water", "Interim water station"],
    ["broadband", "Public internet access point"], ["transportation", "Transit access hub"]]) {
    const reference = getPlanningReference(candidate(category, facility));
    assert.deepEqual(reference.values, { currency: "USD" });
    assert.ok(reference.sources.length >= 2);
    assert.ok(reference.sources.every((source) => new URL(source.url).protocol === "https:"));
    reference.sources[0].note = "Changed";
    assert.notEqual(getPlanningReference(candidate(category, facility)).sources[0].note, "Changed");
  }
});

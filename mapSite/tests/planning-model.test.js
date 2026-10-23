import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_STORAGE_KEY, calculatePlan, emptyPlan, examplePlan, normalizePlan,
  readPlans, writePlans, exportPlanCsv,
} from "../planning-model.js";

test("blank assumptions produce unknown outcomes, never invented population or cost", () => {
  const result = calculatePlan(emptyPlan());
  assert.equal(result.impact.participatingPeople, null);
  assert.equal(result.impact.peopleBenefiting, null);
  assert.equal(result.impact.weeklyHoursSaved, null);
  assert.equal(result.budget.firstYearTotal, null);
  assert.equal(result.timeline.totalWeeks, null);
  assert.deepEqual(result.errors, {});
  assert.equal(calculatePlan({ reportCount: 2000, region: { population: 90000 } }).impact.participatingPeople, null);
});

test("time, budget, and sequential weeks calculate from explicit units", () => {
  const result = calculatePlan(examplePlan());
  assert.equal(result.impact.participatingPeople, 1440);
  assert.equal(result.impact.peopleBenefiting, 1440);
  assert.equal(result.impact.minutesSavedOneWay, 20);
  assert.equal(result.impact.weeklyMinutesSavedPerPerson, 80);
  assert.equal(result.impact.weeklyHoursSaved, 1920);
  assert.equal(result.budget.contingencyAmount, 37500);
  assert.equal(result.budget.capitalWithContingency, 287500);
  assert.equal(result.budget.firstYearTotal, 347500);
  assert.equal(result.timeline.totalWeeks, 26);
});

test("missing or invalid assumptions disable only dependent outcomes", () => {
  const result = calculatePlan({ ...examplePlan(), population: "", operatingCost: "n/a", procurementWeeks: "" });
  assert.equal(result.impact.participatingPeople, null);
  assert.equal(result.impact.weeklyHoursSaved, null);
  assert.equal(result.impact.weeklyMinutesSavedPerPerson, 80);
  assert.equal(result.budget.capitalWithContingency, 287500);
  assert.equal(result.budget.firstYearTotal, null);
  assert.equal(result.timeline.totalWeeks, null);
  assert.match(result.errors.operatingCost, /finite number/);
});

test("invalid, negative, excessive, and fractional population inputs are rejected", () => {
  for (const value of [NaN, Infinity, -1, "not a number", true, [], {}, "1e999", "3.5", 1e11]) {
    const result = calculatePlan({ ...examplePlan(), population: value });
    assert.ok(result.errors.population, `Must reject ${String(value)}`);
    assert.equal(result.impact.participatingPeople, null);
  }
  for (const key of ["adoption", "contingency"]) {
    assert.ok(calculatePlan({ ...examplePlan(), [key]: "101" }).errors[key]);
  }
  assert.ok(calculatePlan({ ...examplePlan(), currentMinutes: "-5" }).errors.currentMinutes);
  assert.ok(calculatePlan({ ...examplePlan(), capitalCost: "-5" }).errors.capitalCost);
  assert.ok(calculatePlan({ ...examplePlan(), planningWeeks: "-1" }).errors.planningWeeks);
});

test("zero uptake, population, costs and durations remain valid zero values", () => {
  const plan = Object.fromEntries(Object.keys(emptyPlan()).map((key) => [key, "0"]));
  const result = calculatePlan(plan);
  assert.deepEqual(result.errors, {});
  assert.equal(result.impact.peopleBenefiting, 0);
  assert.equal(result.impact.weeklyHoursSaved, 0);
  assert.equal(result.impact.percentReduction, null);
  assert.equal(result.budget.firstYearTotal, 0);
  assert.equal(result.timeline.totalWeeks, 0);
  assert.equal(calculatePlan({ ...examplePlan(), adoption: "0" }).impact.peopleBenefiting, 0);
  assert.equal(calculatePlan({ ...examplePlan(), tripsPerWeek: "0" }).impact.peopleBenefiting, 0);
});

test("a worse or unchanged proposal never claims people benefit from shorter journeys", () => {
  const worse = calculatePlan({ ...examplePlan(), proposedMinutes: "45" });
  assert.equal(worse.impact.peopleBenefiting, 0);
  assert.equal(worse.impact.weeklyMinutesSavedPerPerson, -40);
  assert.equal(worse.impact.weeklyHoursSaved, -960);
  assert.ok(worse.impact.percentReduction < 0);
  const same = calculatePlan({ ...examplePlan(), proposedMinutes: "35" });
  assert.equal(same.impact.peopleBenefiting, 0);
  assert.equal(same.impact.weeklyHoursSaved, 0);
});

test("draft serialization handles malformed storage and prototype-like identifiers", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key), setItem: (key, value) => store.set(key, value) };
  assert.equal(readPlans(storage).size, 0);
  store.set(PLAN_STORAGE_KEY, "{");
  assert.equal(readPlans(storage).size, 0);
  store.set(PLAN_STORAGE_KEY, JSON.stringify({ plans: [null, [null, {}], ["valid", { population: { malicious: true }, adoption: "55", currency: "bad", unrelated: 5 }]] }));
  const recovered = readPlans(storage);
  assert.equal(recovered.size, 1);
  assert.equal(recovered.get("valid").population, "");
  assert.equal(recovered.get("valid").adoption, "55");
  assert.equal(recovered.get("valid").currency, "USD");
  assert.equal(recovered.get("valid").unrelated, undefined);
  writePlans(storage, new Map([["__proto__", examplePlan()], ["constructor", emptyPlan()]]));
  assert.equal(readPlans(storage).get("__proto__").population, "2400");
  const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  assert.equal(readPlans(unavailable).size, 0);
  assert.doesNotThrow(() => writePlans(unavailable, recovered));
});

test("normalization keeps known inputs, bounds text, and labels examples explicitly", () => {
  const plan = normalizePlan({ population: 700, currency: "INR", example: true, populationSource: "a".repeat(900), unexpected: "ignored" });
  assert.equal(plan.population, "700");
  assert.equal(plan.currency, "INR");
  assert.equal(plan.example, true);
  assert.equal(plan.populationSource.length, 600);
  assert.equal(plan.unexpected, undefined);
  assert.equal(normalizePlan(null).population, "");
});

test("CSV includes assumptions, method, sources, signed outcomes, and spreadsheet-safe user text", () => {
  const output = exportPlanCsv({ analysis: { facilityType: '=HYPERLINK("bad")' }, region: { name: "Example, CA" } },
    { ...examplePlan(), proposedMinutes: "45", populationSource: "Census \"quoted\"\nsource" });
  assert.match(output, /Fictional example assumptions/);
  assert.match(output, /'=HYPERLINK/);
  assert.match(output, /Census ""quoted""/);
  assert.match(output, /"-960"/);
  assert.match(output, /No population inferred from reports/);
  assert.match(output, /Example, CA/);
  const leadingSpace = exportPlanCsv({ analysis: { facilityType: "  =HYPERLINK()" } }, emptyPlan());
  assert.match(leadingSpace, /'  =HYPERLINK/);
  assert.match(leadingSpace, /Editable planning assumptions/);
});

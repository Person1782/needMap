import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "acorn";
import { context, plain, read, valid } from "./test-helpers.js";
const model = context().NeedMapForm;
function submit(manager, report) { return new Promise((resolve, reject) => manager.submit(report, (error, id) => error ? reject(error) : resolve(id))); }

test("all browser scripts parse as ES5 without modern runtime dependencies", () => {
  for (const file of ["firebase-config.js", "form-model.js", "firebase-submit.js", "place-search.js", "adaptive-mode.js", "app.js"]) {
    parse(read(file), { ecmaVersion: 5 });
    assert.doesNotMatch(read(file), /\bfetch\(|new Promise|\.finally\(|\.randomUUID\(|\.replaceChildren\(|\bFormData\(/);
  }
});

test("requires a confirmed location and rejects blank, nonfinite and out-of-range coordinates", () => {
  for (const location of [null, {}, { latitude: "", longitude: 0 }, { latitude: 0, longitude: "" }, { latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }]) {
    assert.ok(model.validateReport({ ...valid, location }).errors.location);
  }
  for (const [latitude, longitude] of [[0, 0], [90, 180], [-90, -180]]) assert.ok(model.validateReport({ ...valid, location: { latitude, longitude } }).report);
});

test("rounds automatic locations and retains the anonymous demonstration schema", () => {
  const { report } = model.validateReport(valid);
  assert.equal(report.latitude, 37.773);
  assert.equal(report.longitude, -122.418);
  assert.equal(report.locationGridId, "grid-37.7730--122.4180");
  assert.equal(report.locationPrecision, "approximate_grid_500m");
  assert.deepEqual(Object.keys(report).sort(), ["category", "severity", "summary", "latitude", "longitude", "locationGridId", "locationPrecision", "sourceType", "isSynthetic"].sort());
  assert.equal(report.isSynthetic, true);
  for (const [lat, lon] of [[37.7749, -122.4194], [-33.8688, 151.2093], [0, 0], [90, -180]]) {
    const grid = model.createGridLocation(lat, lon);
    assert.deepEqual(plain(model.createGridLocation(grid.latitude, grid.longitude)), plain(grid));
  }
});

test("enforces required fields, summary length and common personal information", () => {
  assert.deepEqual(Object.keys(model.validateReport({ ...valid, category: "unknown", severity: "critical", summary: "  " }).errors), ["category", "severity", "summary"]);
  assert.ok(model.validateReport({ ...valid, summary: "a".repeat(281) }).errors.summary);
  assert.ok(model.validateReport({ ...valid, summary: "a".repeat(280) }).report);
  for (const summary of ["Call (415) 555-1234", "Call +1 415 555 1234", "Email person@example.com", "Visit 123 Main Street"]) assert.ok(model.validateReport({ ...valid, summary }).errors.summary);
});

test("coalesces in-flight writes and persists a stable ID before starting the network", async () => {
  let finish;
  const calls = [];
  const manager = model.createSubmissionManager({ createId: () => "report-01", onAttempt: (attempt) => calls.push(attempt.id), writeReport: (id, report, callback) => { calls.push("write"); finish = callback; } });
  const first = submit(manager, valid);
  assert.equal(manager.submit(valid, () => assert.fail("duplicate callback")), false);
  assert.deepEqual(calls, ["report-01", "write"]);
  finish(null);
  assert.equal(await first, "report-01");
});

test("lost acknowledgement and reload retry reuse the same reference", async () => {
  const first = model.createSubmissionManager({ createId: () => "report-01", writeReport: (_id, _report, done) => done(new Error("offline")) });
  await assert.rejects(submit(first, valid));
  const saved = plain(first.getAttempt());
  const writes = [];
  const reloaded = model.createSubmissionManager({ attempt: saved, createId: () => "report-02", writeReport: (id, _report, done) => { writes.push(id); done(null); } });
  assert.equal(await submit(reloaded, valid), "report-01");
  assert.equal(await submit(reloaded, valid), "report-02");
  assert.deepEqual(writes, ["report-01", "report-02"]);
});

test("changed reports and explicit clears receive a new reference", async () => {
  let count = 0;
  const ids = [];
  const manager = model.createSubmissionManager({ createId: () => "report-0" + ++count, writeReport: (id, _report, done) => { ids.push(id); done(new Error("offline")); } });
  await assert.rejects(submit(manager, valid));
  await assert.rejects(submit(manager, { ...valid, summary: "Another concern" }));
  manager.reset();
  await assert.rejects(submit(manager, valid));
  assert.deepEqual(ids, ["report-01", "report-02", "report-03"]);
});

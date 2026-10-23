import test from "node:test";
import assert from "node:assert/strict";
import { loadReportPopulation, WORLDPOP_POPULATION_API } from "../report-population.js";

const taskId = "5f4280c3-7af9-4f79-93c8-20da95313887";
const report = (id = "a", longitude = -122.42, latitude = 37.775) => ({
  id, longitude, latitude, summary: "Private report text must never be sent.",
});
const selection = { reports: [report()], region: { id: "sf" } };
const now = Date.UTC(2026, 9, 22);
const result = (extra = {}) => ({ total_population: 4445.14, area_km2: 0.78,
  data_year: 2025, data_source: "worldpop_R2025A_2025_100m", ...extra });
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const success = (extra = {}) => ({ task_id: taskId, status: "success", error: null, result: result(extra) });
function provider(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return json({ task_id: taskId, status: "pending",
      check_url: "https://untrusted.example/never-follow", ...overrides.submission });
    return json(overrides.task || success());
  };
  return { calls, fetchImpl };
}

test("submits merged geometry only, verifies a completed 2025 estimate and uses trusted task route", async () => {
  const { calls, fetchImpl } = provider();
  const answer = await loadReportPopulation(selection, { fetchImpl, now });
  assert.equal(answer.status, "ready");
  assert.equal(answer.value, 4445.14);
  assert.equal(answer.year, 2025);
  assert.equal(answer.radiusMeters, 500);
  assert.equal(answer.reportCount, 1);
  assert.equal(answer.retrievedAt, new Date(now).toISOString());
  assert.equal(calls.length, 2);
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(payload).sort(), ["geojson", "resolution", "year"]);
  assert.equal(payload.geojson.type, "MultiPolygon");
  assert.equal(payload.resolution, "100m");
  assert.equal(calls[0].options.body.includes("Private"), false);
  assert.equal(calls[1].url, `${WORLDPOP_POPULATION_API}/tasks/${taskId}`);
  assert.ok(calls.every(({ options }) => options.credentials === "omit" && options.redirect === "error"));
});

test("does not invent zero for no reports, invalid locations, invalid boundaries or empty clipped areas", async () => {
  const { calls, fetchImpl } = provider();
  const empty = await loadReportPopulation({ reports: [] }, { fetchImpl });
  assert.equal(empty.status, "empty");
  assert.equal("value" in empty, false);
  for (const input of [
    { reports: [report(), { id: "missing" }] },
    { reports: [report()], region: { geometry: { type: "Point", coordinates: [0, 0] } } },
    { reports: [report()], region: { geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } } },
  ]) {
    const answer = await loadReportPopulation(input, { fetchImpl });
    assert.equal(answer.status, "unavailable");
    assert.equal("value" in answer, false);
  }
  assert.equal(calls.length, 0);
});

test("accepts true numeric zero but rejects missing, wrong-year, wrong-dataset and malformed totals", async () => {
  const valid = provider({ task: success({ total_population: 0 }) });
  assert.equal((await loadReportPopulation(selection, { fetchImpl: valid.fetchImpl })).value, 0);
  for (const extra of [{ total_population: null }, { total_population: "42" }, { total_population: -1 },
    { total_population: 30_000_000_000 }, { data_year: 2020 }, { data_source: "unverified" }, { area_km2: 0 }]) {
    const { fetchImpl } = provider({ task: success(extra) });
    const answer = await loadReportPopulation(selection, { fetchImpl });
    assert.equal(answer.status, "unavailable", JSON.stringify(extra));
    assert.equal("value" in answer, false);
  }
});

test("requires a complete, consistent result for every disjoint report pocket", async () => {
  const input = { reports: [report(), report("b", -122.44)] };
  const polygons = [{ index: 0, population: 400, area_km2: 0.78 }, { index: 1, population: 200, area_km2: 0.78 }];
  const good = provider({ task: success({ total_population: 600, polygons }) });
  assert.equal((await loadReportPopulation(input, { fetchImpl: good.fetchImpl })).value, 600);
  for (const patch of [{ polygons: undefined }, { polygons: polygons.slice(0, 1) },
    { polygons: [polygons[0], { ...polygons[1], index: 0 }] },
    { polygons: [polygons[0], { ...polygons[1], error: "Missing raster" }] },
    { polygons, total_population: 601 }]) {
    const { fetchImpl } = provider({ task: success({ total_population: 600, ...patch }) });
    assert.equal((await loadReportPopulation(input, { fetchImpl })).status, "unavailable");
  }
});

test("polls pending work, bounds endless jobs, and rejects mismatched or failed tasks", async () => {
  let count = 0;
  const fetchImpl = async (_url, options) => {
    if (options.method === "POST") return json({ task_id: taskId, status: "pending" });
    count += 1;
    return json(count < 3 ? { task_id: taskId, status: "progress" } : success());
  };
  assert.equal((await loadReportPopulation(selection, { fetchImpl, pollDelayMs: 0 })).status, "ready");
  assert.equal(count, 3);
  const endless = provider({ task: { task_id: taskId, status: "pending" } });
  assert.equal((await loadReportPopulation(selection, { fetchImpl: endless.fetchImpl, pollDelayMs: 0 })).status, "unavailable");
  assert.equal(endless.calls.length, 31);
  for (const task of [{ ...success(), task_id: "wrong" }, { ...success(), error: "Missing raster" },
    { task_id: taskId, status: "failed" }, { task_id: taskId, status: "surprise" }]) {
    const failed = provider({ task });
    assert.equal((await loadReportPopulation(selection, { fetchImpl: failed.fetchImpl })).status, "unavailable");
  }
  const unsafe = provider({ submission: { task_id: "../../other" } });
  assert.equal((await loadReportPopulation(selection, { fetchImpl: unsafe.fetchImpl })).status, "unavailable");
  assert.equal(unsafe.calls.length, 1);
});

test("aborts an active fetch and a polling wait without emitting an estimate", async () => {
  const controller = new AbortController();
  let activeSignal;
  const pending = loadReportPopulation(selection, { signal: controller.signal, fetchImpl: (_url, options) => {
    activeSignal = options.signal;
    return new Promise(() => {});
  } });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(activeSignal.aborted, true);

  const waiting = new AbortController();
  let count = 0;
  const waitFetch = async (_url, options) => {
    count += 1;
    if (count === 2) setTimeout(() => waiting.abort(), 5);
    return json({ task_id: taskId, status: "pending" });
  };
  await assert.rejects(loadReportPopulation(selection, {
    signal: waiting.signal, fetchImpl: waitFetch, pollDelayMs: 5000,
  }), { name: "AbortError" });
  assert.equal(count, 2);
});

test("the whole deadline cancels hung fetches and provider failures do not become zero", async () => {
  let activeSignal;
  const answer = await loadReportPopulation(selection, { timeoutMs: 10, fetchImpl: (_url, options) => {
    activeSignal = options.signal;
    return new Promise(() => {});
  } });
  assert.equal(answer.status, "unavailable");
  assert.equal(activeSignal.aborted, true);
  for (const fetchImpl of [async () => json({}, 429), async () => { throw new TypeError("Network error"); },
    async () => new Response("not JSON"), async () => new Response("x", { headers: { "content-length": "999999" } })]) {
    const failed = await loadReportPopulation(selection, { fetchImpl });
    assert.equal(failed.status, "unavailable");
    assert.equal("value" in failed, false);
  }
});

test("reuses geometry estimates without multiplying duplicate reports, expires and bounds the cache", async () => {
  const { calls, fetchImpl } = provider();
  await loadReportPopulation(selection, { fetchImpl, now });
  const duplicated = await loadReportPopulation({ reports: [report(), report("b")] }, { fetchImpl, now: now + 1 });
  assert.equal(duplicated.reportCount, 2);
  assert.equal(duplicated.value, 4445.14);
  assert.equal(calls.length, 2);
  await loadReportPopulation(selection, { fetchImpl, now: now + 3_600_001 });
  assert.equal(calls.length, 4);
  for (let i = 1; i <= 12; i += 1) {
    await loadReportPopulation({ reports: [report("a", i)] }, { fetchImpl, now: now + 3_600_002 });
  }
  await loadReportPopulation(selection, { fetchImpl, now: now + 3_600_003 });
  assert.equal(calls.length, 30);
});

test("failed attempts are not cached and already-cancelled requests never use cached data", async () => {
  let healthy = false, count = 0;
  const fetchImpl = async (_url, options) => {
    count += 1;
    if (!healthy) return json({}, 503);
    return json(options.method === "POST" ? { task_id: taskId, status: "pending" } : success());
  };
  assert.equal((await loadReportPopulation(selection, { fetchImpl })).status, "unavailable");
  healthy = true;
  assert.equal((await loadReportPopulation(selection, { fetchImpl })).status, "ready");
  assert.equal(count, 3);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadReportPopulation(selection, { fetchImpl, signal: controller.signal }), { name: "AbortError" });
  assert.equal(count, 3);
});

test("exposes only validated calculation metadata and cached results cannot mutate future details", async () => {
  const { calls, fetchImpl } = provider();
  const first = await loadReportPopulation(selection, { fetchImpl, now });
  assert.equal(first.areaKm2, 0.78);
  assert.equal(first.dataset, "worldpop_R2025A_2025_100m");
  assert.equal(first.taskUrl, `${WORLDPOP_POPULATION_API}/tasks/${taskId}`);
  assert.deepEqual(first.components, [{ index: 0, population: 4445.14, areaKm2: 0.78 }]);
  assert.deepEqual(first.geometry, JSON.parse(calls[0].options.body).geojson);
  first.geometry.coordinates[0][0][0][0] = 999;
  first.components[0].population = 999;
  const second = await loadReportPopulation({ reports: [report(), report("b")] }, { fetchImpl, now: now + 1 });
  assert.equal(second.reportCount, 2);
  assert.equal(second.components[0].population, 4445.14);
  assert.notEqual(second.geometry.coordinates[0][0][0][0], 999);
  second.components[0].population = -1;
  const third = await loadReportPopulation(selection, { fetchImpl, now: now + 2 });
  assert.equal(third.components[0].population, 4445.14);
  assert.equal(third.retrievedAt, new Date(now).toISOString());
  assert.equal(calls.length, 2);
});

test("preserves matched component populations and their reported areas for the calculation breakdown", async () => {
  const polygons = [{ index: 1, population: 200, area_km2: 0.7 }, { index: 0, population: 400, area_km2: 0.8 }];
  const { fetchImpl } = provider({ task: success({ total_population: 600, area_km2: 1.5, polygons }) });
  const answer = await loadReportPopulation({ reports: [report(), report("b", -122.44)] }, { fetchImpl, now });
  assert.deepEqual(answer.components, [{ index: 0, population: 400, areaKm2: 0.8 }, { index: 1, population: 200, areaKm2: 0.7 }]);
  assert.equal(answer.areaKm2, 1.5);
});

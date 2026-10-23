import assert from "node:assert/strict";
import { test } from "node:test";
import { ANALYSIS_INDICATORS, loadAnalysisEvidence } from "../analysis-evidence.js";
import { COUNTRY_ALPHA3 } from "../country-alpha3.js";

const now = Date.UTC(2026, 9, 22);
const country = { id: "US", countryCode: "US", kind: "country", name: "United States" };
const state = { id: "US-CA", countryCode: "US", kind: "state", name: "California", country: "United States" };
const values = {
  "SP.POP.TOTL": [[2025, 1200], [2024, 1000]],
  "SH.H2O.BASW.ZS": [[2024, 75]], "SH_UHC_SCI": [[2023, 70]],
  "IT.NET.USER.ZS": [[2024, 60]], "SE.PRM.UNER.ZS": [[2023, 10]],
  "SE.PRM.UNER": [[2023, 25]], "SN.ITK.MSFI.ZS": [[2024, 20]],
};
const row = (code, year, value, codeCountry = "US", extra = {}) => ({
  indicator: { id: code }, country: { id: codeCountry }, countryiso3code: COUNTRY_ALPHA3[codeCountry],
  date: String(year), value, obs_status: "", ...extra,
});
const response = (rows, meta = {}) => ({ ok: true, json: async () => [
  { page: 1, pages: 1, sourceid: "2", ...meta }, rows,
] });
function fakeApi({ data = values, edit, inspect } = {}) {
  return async (input, options) => {
    const url = new URL(input), code = url.pathname.split("/").at(-1), codeCountry = url.pathname.split("/")[3];
    inspect?.(url, options);
    const rows = (data[code] || []).map(([year, value]) => row(code, year, value, codeCountry));
    return edit?.({ code, rows, url, options }) || response(rows);
  };
}

test("verified country indicators carry dated sources and supported same-year population estimates", async () => {
  const evidence = await loadAnalysisEvidence(country, { fetchImpl: fakeApi(), now });
  assert.equal(evidence.regionId, "US"); assert.equal(evidence.status, "ready");
  assert.equal(evidence.indicators.length, 12);
  assert.ok(evidence.indicators.every((item) => item.scope.regionId === "US" && item.eligibleForScore));
  const affected = evidence.indicators.filter((item) => item.kind === "affected_population");
  assert.equal(affected.find((item) => item.category === "water").value, 250);
  assert.equal(affected.find((item) => item.category === "food").value, 200);
  assert.equal(affected.find((item) => item.category === "education").value, 25);
  const water = affected.find((item) => item.category === "water");
  assert.equal(water.year, 2024); assert.equal(water.isEstimate, true);
  assert.equal(water.sources.length, 2);
  assert.ok(water.sources.every((item) => item.year === 2024 && item.usedFor && item.publisher && item.url.startsWith("https://data.worldbank.org/")));
  assert.ok(water.sourceIds.includes("wb:US:SP.POP.TOTL:2024"));
  assert.ok(evidence.sources.some((item) => item.id === "wb:US:SP.POP.TOTL:2025"));
  assert.ok(evidence.sources.every((item) => item.geography === "United States"));
});

test("country statistics are always context-only for a state or custom region, even from cache", async () => {
  let requests = 0;
  const fetchImpl = fakeApi({ inspect: () => { requests += 1; } });
  await loadAnalysisEvidence(country, { fetchImpl, now });
  for (const region of [state, { ...state, id: "US-CA-north", kind: "needmap" }]) {
    const evidence = await loadAnalysisEvidence(region, { fetchImpl, now });
    assert.equal(evidence.regionId, region.id); assert.equal(evidence.status, "partial");
    assert.ok(evidence.indicators.every((item) => item.eligibleForScore === false && item.scope.regionId === "US"));
    assert.match(evidence.notes[0], /national context/);
  }
  assert.equal(requests, ANALYSIS_INDICATORS.length);
});

test("missing matching-year population never borrows a different year for affected estimates", async () => {
  const evidence = await loadAnalysisEvidence(country, { now, fetchImpl: fakeApi({ data: { ...values, "SP.POP.TOTL": [[2025, 1200]] } }) });
  assert.deepEqual(evidence.indicators.filter((item) => item.kind === "affected_population").map((item) => item.category), ["education"]);
  assert.ok(evidence.indicators.some((item) => item.category === "water" && item.kind === "access_gap_percent"));
});

test("an index and Internet participation gap are never transformed into affected-population counts", async () => {
  const evidence = await loadAnalysisEvidence(country, { now, fetchImpl: fakeApi() });
  const health = evidence.indicators.find((item) => item.category === "healthcare" && item.kind === "access_gap_index");
  assert.equal(health.value, 30); assert.equal(health.unit, "index points");
  assert.match(health.description, /not a percentage/);
  assert.match(health.description, /does not measure medication-specific availability or access/);
  assert.match(health.usedFor, /not a medication-specific access measure/);
  const internet = evidence.indicators.find((item) => item.category === "broadband" && item.kind === "access_gap_percent");
  assert.equal(internet.value, 40); assert.equal(internet.isProxy, true);
  assert.ok(!evidence.indicators.some((item) => ["healthcare", "broadband"].includes(item.category) && item.kind === "affected_population"));
  for (const category of ["roads", "transportation", "fuel", "emergency_response", "other"]) {
    assert.ok(evidence.unavailableCategories.includes(category));
    assert.ok(!evidence.indicators.some((item) => item.category === category));
  }
});

test("evidence exposes one Healthcare category and never a separate medication availability claim", async () => {
  const evidence = await loadAnalysisEvidence(country, { now, fetchImpl: fakeApi() });
  assert.ok(!evidence.unavailableCategories.includes("healthcare"));
  assert.ok(!evidence.unavailableCategories.includes("medication_access"));
  assert.ok(!evidence.indicators.some((item) => item.category === "medication_access"));
  const healthcare = evidence.indicators.filter((item) => item.category === "healthcare");
  assert.deepEqual(healthcare.map((item) => item.kind), ["access_index", "access_gap_index"]);
  for (const item of healthcare) {
    assert.match(item.description, /does not measure medication-specific availability or access/);
    assert.match(item.usedFor, /not a medication-specific access measure/);
    assert.ok(item.sources.every((source) => /not a medication-specific access measure/.test(source.usedFor)));
  }
  const missing = await loadAnalysisEvidence(country, { now, fetchImpl: fakeApi({ data: {} }) });
  assert.equal(missing.unavailableCategories.filter((category) => category === "healthcare").length, 1);
  assert.ok(!missing.unavailableCategories.includes("medication_access"));
});

test("a failed series preserves other evidence and is not cached as absence", async () => {
  let broken = true, calls = 0;
  const fetchImpl = fakeApi({ inspect: () => { calls += 1; }, edit: ({ code }) => {
    if (code === "SH.H2O.BASW.ZS" && broken) return { ok: false };
  } });
  const initial = await loadAnalysisEvidence(country, { now, fetchImpl });
  assert.equal(initial.status, "partial");
  assert.ok(initial.indicators.some((item) => item.category === "healthcare"));
  assert.ok(initial.unavailableCategories.includes("water"));
  broken = false;
  const retry = await loadAnalysisEvidence(country, { now, fetchImpl });
  assert.equal(retry.status, "ready");
  assert.equal(calls, ANALYSIS_INDICATORS.length * 2);
});

test("rejects wrong country, wrong indicator, duplicate years, pagination and wrong data source", async () => {
  const edits = [
    ({ code }) => response([row(code, 2024, 50, "CA")]),
    () => response([row("NOT.THE.SERIES", 2024, 50)]),
    ({ code }) => response([row(code, 2024, 50, "US", { countryiso3code: "CAN" })]),
    ({ code }) => response([row(code, 2024, 50), row(code, 2024, 60)]),
    ({ rows }) => response(rows, { pages: 2 }),
    ({ rows }) => response(rows, { sourceid: "57" }),
  ];
  for (const edit of edits) {
    const evidence = await loadAnalysisEvidence(country, { now, fetchImpl: fakeApi({ edit }) });
    assert.equal(evidence.status, "unavailable");
    assert.equal(evidence.indicators.length, 0);
  }
});

test("null, numeric strings, out-of-range percentages, forecasts, future and old observations stay missing", async () => {
  const evidence = await loadAnalysisEvidence(country, { now, fetchImpl: fakeApi({ edit: ({ code }) => response([
    row(code, 2026, null), row(code, 2025, "25"), row(code, 2024, -1), row(code, 2023, 20, "US", { obs_status: "F" }),
    row(code, 2030, 30), row(code, 2010, 40),
    ...(code === "SH.H2O.BASW.ZS" ? [row(code, 2022, 100.5)] : []),
  ]) }) });
  assert.equal(evidence.status, "unavailable"); assert.equal(evidence.indicators.length, 0);
});

test("zero access and zero reported gaps are preserved rather than treated as missing", async () => {
  const evidence = await loadAnalysisEvidence(country, { now, fetchImpl: fakeApi({ data: {
    ...values, "SH.H2O.BASW.ZS": [[2024, 100]], "SN.ITK.MSFI.ZS": [[2024, 0]], "IT.NET.USER.ZS": [[2024, 0]],
  } }) });
  assert.equal(evidence.indicators.find((item) => item.category === "water" && item.kind === "affected_population").value, 0);
  assert.equal(evidence.indicators.find((item) => item.category === "food" && item.kind === "affected_population").value, 0);
  assert.equal(evidence.indicators.find((item) => item.category === "broadband" && item.kind === "access_gap_percent").value, 100);
});

test("cancellation rejects promptly even when a fetch implementation ignores its signal", async () => {
  const controller = new AbortController();
  const pending = loadAnalysisEvidence(country, { now, signal: controller.signal, fetchImpl: () => new Promise(() => {}), timeoutMs: 5000 });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(loadAnalysisEvidence(country, { signal: controller.signal }), { name: "AbortError" });
});

test("a bounded timeout reports missing evidence rather than hanging forever", async () => {
  const evidence = await loadAnalysisEvidence(country, { now, fetchImpl: () => new Promise(() => {}), timeoutMs: 2 });
  assert.equal(evidence.status, "unavailable"); assert.equal(evidence.sources.length, 0);
});

test("requests send only country and indicator, omit credentials/referrer, and bound concurrency", async () => {
  let active = 0, maxActive = 0;
  const fetchImpl = async (input, options) => {
    active += 1; maxActive = Math.max(maxActive, active);
    const url = new URL(input), code = url.pathname.split("/").at(-1);
    assert.equal(url.origin, "https://api.worldbank.org");
    assert.equal(url.searchParams.get("date"), "2016:2026");
    assert.equal(options.credentials, "omit"); assert.equal(options.referrerPolicy, "no-referrer");
    assert.ok(!String(input).includes("California")); assert.ok(!String(input).includes("37.5"));
    await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1;
    return response((values[code] || []).map(([year, value]) => row(code, year, value)));
  };
  await loadAnalysisEvidence({ ...state, latitude: 37.5 }, { now, fetchImpl });
  assert.ok(maxActive <= 3); assert.equal(maxActive, 3);
});

test("cached evidence expires, cannot be mutated by consumers and remains bounded", async () => {
  let calls = 0;
  const fetchImpl = fakeApi({ inspect: () => { calls += 1; } });
  const evidence = await loadAnalysisEvidence(country, { now, fetchImpl });
  evidence.indicators[0].value = -10; evidence.sources[0].title = "Modified";
  const cached = await loadAnalysisEvidence(country, { now: now + 100, fetchImpl });
  assert.equal(cached.indicators[0].value, 1200); assert.notEqual(cached.sources[0].title, "Modified");
  assert.equal(calls, ANALYSIS_INDICATORS.length);
  await loadAnalysisEvidence(country, { now: now + 3_600_001, fetchImpl });
  assert.equal(calls, ANALYSIS_INDICATORS.length * 2);
  for (const countryCode of ["CA", "IN", "GB", "FR", "DE", "ES", "IT", "NG", "KE", "BR", "AU", "JP"]) {
    await loadAnalysisEvidence({ id: countryCode, countryCode, kind: "country", name: countryCode }, { now, fetchImpl });
  }
  const before = calls;
  await loadAnalysisEvidence(country, { now: now + 3_600_100, fetchImpl });
  assert.equal(calls, before + ANALYSIS_INDICATORS.length);
});

test("world and unknown countries never send an aggregate or arbitrary provider request", async () => {
  let calls = 0;
  for (const region of [{ id: "world", kind: "world" }, { id: "all", countryCode: "ALL", kind: "country" }, null]) {
    const evidence = await loadAnalysisEvidence(region, { now, fetchImpl: async () => { calls += 1; } });
    assert.equal(evidence.status, "unavailable");
  }
  assert.equal(calls, 0);
});

test("oversized responses and API error bodies cannot enter rankings", async () => {
  for (const fetchImpl of [
    async () => ({ ok: true, headers: { get: () => "1048576" }, json: async () => { throw new Error("Should not read"); } }),
    async () => ({ ok: true, json: async () => [{ message: [{ value: "Invalid country" }] }] }),
  ]) {
    const evidence = await loadAnalysisEvidence(country, { now, fetchImpl });
    assert.equal(evidence.status, "unavailable"); assert.equal(evidence.indicators.length, 0);
  }
});

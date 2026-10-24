import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlanBenchmarkEvidence } from "../plans-benchmarks.js";
import {
  loadPlanLocalCostAdjustment,
  PLAN_COST_INDICATOR,
  PLAN_COST_PRICE_YEAR,
} from "../plans-local-cost.js";

const kenya = {
  id: "KE-30",
  name: "Nairobi County",
  country: "Kenya",
  countryCode: "KE",
  kind: "state",
};

function payload({
  countryCode = "KE",
  alpha3 = "KEN",
  year = PLAN_COST_PRICE_YEAR,
  value = 32.0836821224238,
  indicator = PLAN_COST_INDICATOR,
  rows,
} = {}) {
  const values = rows || [{
    indicator: { id: indicator, value: "Price level index (GDP)" },
    country: { id: countryCode, value: "Kenya" },
    countryiso3code: alpha3,
    date: String(year),
    value,
    obs_status: "",
  }];
  return [{ page: 1, pages: 1, per_page: 8, total: values.length, sourceid: "2" }, values];
}

function response(value) {
  return {
    ok: true,
    headers: { get: () => null },
    json: async () => value,
  };
}

test("country metadata selects the official World Bank GDP price-level observation and discloses the proxy", async () => {
  let requested;
  const result = await loadPlanLocalCostAdjustment(kenya, {
    now: Date.UTC(2026, 9, 23),
    fetchImpl: async (url, options) => {
      requested = { url: new URL(url), options };
      return response(payload());
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.countryCode, "KE");
  assert.equal(result.countryName, "Kenya");
  assert.equal(result.indicator.code, PLAN_COST_INDICATOR);
  assert.equal(result.indicator.year, 2024);
  assert.ok(Math.abs(result.adjustment.multiplier - 0.3208368212) < 1e-12);
  assert.equal(result.adjustment.geography, "Kenya national price level; no subnational adjustment");
  assert.match(result.adjustment.method, /divided by the United States reference value 100/);
  assert.match(result.adjustment.method, /not a construction cost index/);
  assert.match(result.adjustment.source.usedFor, /32\.083682.*100.*0\.320837/);
  assert.match(result.adjustment.source.usedFor, /subnational differences/);
  assert.equal(result.adjustment.source.publisher, "World Bank, World Development Indicators");
  assert.equal(result.adjustment.source.year, 2024);
  assert.equal(requested.url.pathname, "/v2/country/KE/indicator/PA.NUS.GDP.PLI");
  assert.equal(requested.url.searchParams.get("date"), "2024");
  assert.equal(requested.url.searchParams.get("source"), "2");
  assert.equal(requested.options.credentials, "omit");
});

test("the national observation is cached across regions in the same country", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(payload({ value: 25 })); };
  const options = { fetchImpl, now: Date.UTC(2026, 9, 23) };
  const first = await loadPlanLocalCostAdjustment(kenya, options);
  const second = await loadPlanLocalCostAdjustment({
    id: "KE-31", name: "Nakuru County", country: "Kenya", countryCode: "KE", kind: "state",
  }, options);

  assert.equal(calls, 1);
  assert.equal(first.adjustment.multiplier, 0.25);
  assert.equal(second.adjustment.multiplier, 0.25);
  assert.equal(second.regionId, "KE-31");
});

test("verified local adjustment flows into Plans cost evidence with its source and limitations", async () => {
  const local = await loadPlanLocalCostAdjustment(kenya, {
    now: Date.UTC(2026, 9, 23),
    fetchImpl: async () => response(payload({ value: 50 })),
  });
  const evidence = buildPlanBenchmarkEvidence("school", {
    region: kenya,
    localCostAdjustment: local.adjustment,
  });

  assert.equal(evidence.cost.low, 2_940_000);
  assert.equal(evidence.cost.high, 11_680_000);
  assert.match(evidence.scope, /Kenya national price level; no subnational adjustment/);
  assert.match(evidence.cost.formula.explanation, /multiplies both ends by 0\.5/);
  const worldBank = evidence.sources.find((source) => source.publisher.includes("World Bank"));
  assert.ok(worldBank);
  assert.equal(worldBank.publishedYear, 2024);
  assert.match(worldBank.usedFor, /not a construction cost index/);
});

test("worldwide, malformed, stale-year, and unavailable observations fail to an unlocalized result", async () => {
  let worldCalls = 0;
  const world = await loadPlanLocalCostAdjustment({ id: "world", name: "Worldwide", kind: "world" }, {
    now: Date.UTC(2026, 9, 23),
    fetchImpl: async () => { worldCalls += 1; return response(payload()); },
  });
  assert.equal(world.status, "unavailable");
  assert.equal(world.adjustment, null);
  assert.equal(worldCalls, 0);

  const cases = [
    payload({ countryCode: "UG", alpha3: "UGA" }),
    payload({ indicator: "SP.POP.TOTL" }),
    payload({ year: 2023 }),
    payload({ value: "32.1" }),
    payload({ rows: [payload()[1][0], payload()[1][0]] }),
    payload({ rows: [] }),
    [{ page: 1, pages: 2, total: 9, sourceid: "2" }, []],
    [{ page: 1, pages: 1, total: 0, sourceid: null }, []],
  ];
  for (const invalid of cases) {
    const result = await loadPlanLocalCostAdjustment(kenya, {
      now: Date.UTC(2026, 9, 23),
      fetchImpl: async () => response(invalid),
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.adjustment, null);
    assert.match(result.reason, /unlocalized|no verified/i);
  }
});

test("network failure is honest, successful values expire from the one-day cache, and abort remains abort", async () => {
  const failed = await loadPlanLocalCostAdjustment(kenya, {
    now: Date.UTC(2026, 9, 23),
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(failed.status, "unavailable");
  assert.match(failed.reason, /unlocalized/);

  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(payload({ value: 80 })); };
  await loadPlanLocalCostAdjustment(kenya, { fetchImpl, now: 1_720_000_000_000 });
  await loadPlanLocalCostAdjustment(kenya, { fetchImpl, now: 1_720_086_400_001 });
  assert.equal(calls, 2);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadPlanLocalCostAdjustment(kenya, { signal: controller.signal, fetchImpl }),
    (error) => error?.name === "AbortError",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { enrichSignalsWithRegions } from "../regions.js";

const square = (west, south, east, north) => ({ type: "Polygon", coordinates: [
  [[west, south], [east, south], [east, north], [west, north], [west, south]],
] });
const response = (value) => ({ ok: true, json: async () => value });
const cityPoint = (latitude, longitude, countryCode = "xx") => ({
  osm_id: 1234, osm_type: "node", name: "City", type: "city", address: { country_code: countryCode },
  geojson: { type: "Point", coordinates: [longitude, latitude] },
});
const boundary = (id, latitude, longitude, countryCode = "xx", extra = {}) => ({
  osm_id: id, osm_type: "relation", name: "Verified area", type: "administrative", addresstype: "county",
  address: { country_code: countryCode }, geojson: square(longitude - 0.2, latitude - 0.2, longitude + 0.2, latitude + 0.2), ...extra,
});
const options = { bundledResolver: async () => null };

test("a reverse city Point widens to a containing same-country administrative polygon", async (t) => {
  const zooms = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const zoom = Number(new URL(url).searchParams.get("zoom")); zooms.push(zoom);
    return response(zoom === 10 ? cityPoint(10, 20) : boundary(2001, 10, 20));
  });
  const [result] = await enrichSignalsWithRegions([{ latitude: 10, longitude: 20 }], options);
  assert.equal(result.region.osmId, "relation-2001");
  assert.equal(result.region.countryCode, "XX");
  assert.equal(result.region.lookupZoom, 8);
  assert.deepEqual(zooms, [10, 8], "a verified broader fallback must not immediately retry the unusable city detail");
});

test("wider Point, outside polygon, and another country's polygon cannot assign a report", async (t) => {
  const zooms = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const zoom = Number(new URL(url).searchParams.get("zoom")); zooms.push(zoom);
    return response(zoom === 10 || zoom === 8 ? cityPoint(20, 30)
      : zoom === 5 ? boundary(2002, 20, 30, "yy") : boundary(2003, 21, 31));
  });
  const [result] = await enrichSignalsWithRegions([{ latitude: 20, longitude: 30 }], options);
  assert.equal(result.region, null);
  assert.deepEqual(zooms, [10, 8, 5, 3]);
});

test("adaptive detail cannot replace a verified base boundary with another country's polygon", async (t) => {
  const zooms = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const zoom = Number(new URL(url).searchParams.get("zoom")); zooms.push(zoom);
    return response(boundary(zoom === 10 ? 2004 : 2005, 30, 40, zoom === 10 ? "xx" : "yy", { type: "village", addresstype: "village" }));
  });
  const [result] = await enrichSignalsWithRegions([{ latitude: 30, longitude: 40 }], options);
  assert.equal(result.region.osmId, "relation-2004");
  assert.equal(result.region.countryCode, "XX");
  assert.deepEqual(zooms, [10, 8]);
});

test("abort after the base Point response stops widening and propagates cancellation", async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => {
    controller.abort();
    return cityPoint(40, 50);
  } }));
  await assert.rejects(enrichSignalsWithRegions([{ latitude: 40, longitude: 50 }], { ...options, signal: controller.signal }),
    { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 1);
});

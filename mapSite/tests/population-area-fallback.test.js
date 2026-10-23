import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createPopulationAreaFallback } from "../population-area-fallback.js";

const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
function setup() {
  const { document } = parseHTML('<html><body><div id="map"></div></body></html>');
  return document.getElementById("map");
}

test("renders actual multi-polygon shells and holes without network content and cleans up", () => {
  const container = setup();
  const geometry = { type: "MultiPolygon", coordinates: [[ring(1, 1, 2, 2), ring(1.2, 1.2, 1.8, 1.8)], [ring(3, 1, 4, 2)]] };
  const before = JSON.stringify(geometry);
  const handle = createPopulationAreaFallback(container, { geometry, reports: [
    { latitude: 1.1, longitude: 1.1 }, { latitude: 1.1, longitude: 1.1 }, { latitude: null, longitude: 1 }, { latitude: 1.5, longitude: 3.5 },
  ] });
  assert.equal(container.querySelectorAll("path").length, 2);
  assert.equal(container.querySelectorAll("circle").length, 2);
  assert.equal(container.querySelector("path").getAttribute("fill-rule"), "evenodd");
  assert.equal((container.querySelector("path").getAttribute("d").match(/M/g) || []).length, 2);
  assert.match(container.textContent, /background map unavailable/);
  assert.match(container.querySelector("desc").textContent, /not a population-density map/);
  assert.equal(container.querySelector("svg").getAttribute("role"), "img");
  assert.equal(container.querySelector("image, iframe, script, img"), null);
  assert.equal(JSON.stringify(geometry), before);
  handle.destroy(); handle.destroy();
  assert.equal(container.children.length, 0);
});

test("fits neighboring dateline pieces together and keeps valid report dots inside the frame", () => {
  const container = setup();
  createPopulationAreaFallback(container, { geometry: { type: "MultiPolygon", coordinates: [[ring(179.99, 10, 180, 10.01)], [ring(-180, 10, -179.99, 10.01)]] }, reports: [
    { latitude: 10.005, longitude: 179.995 }, { latitude: 10.005, longitude: -179.995 },
  ] });
  const points = [...container.querySelectorAll("circle")].map((node) => Number(node.getAttribute("cx")));
  assert.equal(points.length, 2);
  assert.ok(points.every((point) => point > 0 && point < 900));
  assert.ok(Math.abs(points[0] - points[1]) > 100, "Nearby pieces should fill a local view, not collapse to a world-scale sliver");
  const paths = [...container.querySelectorAll("path")].map((path) => path.getAttribute("d"));
  assert.ok(paths.every((path) => !/NaN|Infinity/.test(path)));
});

test("preserves local geographic aspect at high latitude, with north up", () => {
  const container = setup();
  createPopulationAreaFallback(container, { geometry: { type: "MultiPolygon", coordinates: [[ring(10, 59.995, 10.02, 60.005)]] } });
  const values = [...container.querySelector("path").getAttribute("d").matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
  const width = Math.abs(values[1][0] - values[0][0]), height = Math.abs(values[2][1] - values[1][1]);
  assert.ok(Math.abs(width / height - 1) < 0.01, "0.02 degrees longitude at 60 N should be about 0.01 degrees latitude");
  assert.ok(values[2][1] < values[1][1]);
});

test("rejects invalid or zero-area geometry without replacing existing content", () => {
  for (const geometry of [null, { type: "Point", coordinates: [0, 0] }, { type: "MultiPolygon", coordinates: [] },
    { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [2, 2]]]] },
    { type: "MultiPolygon", coordinates: [[ring(0, 0, 0, 1)]] },
    { type: "MultiPolygon", coordinates: [[ring(0, 0, 200, 1)]] }]) {
    const container = setup(); container.textContent = "Keep current state";
    assert.throws(() => createPopulationAreaFallback(container, { geometry }));
    assert.equal(container.textContent, "Keep current state");
  }
});

test("keeps a polar cap finite and retains its full longitude span", () => {
  const container = setup();
  createPopulationAreaFallback(container, { geometry: { type: "MultiPolygon", coordinates: [[ring(-180, 89.99, 180, 90)]] }, reports: [{ latitude: 89.995, longitude: 0 }] });
  const path = container.querySelector("path").getAttribute("d");
  assert.doesNotMatch(path, /NaN|Infinity/);
  assert.equal(container.querySelectorAll("circle").length, 1);
});

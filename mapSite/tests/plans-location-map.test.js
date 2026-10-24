import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { renderPlansLocationFallback } from "../plans-location-map.js";

const candidate = {
  rank: 2,
  iconKey: "hospital",
  position: { latitude: 37.2, longitude: -122 },
  supportingReports: [
    { id: "west", latitude: 37.2, longitude: -122.15, summary: "West-side hospital report" },
    { id: "north", latitude: 37.3, longitude: -122, summary: "North-side hospital report" },
  ],
};

const serviceArea = {
  type: "MultiPolygon",
  coordinates: [[
    [[-122.2, 37], [-121.8, 37], [-121.8, 37.4], [-122.2, 37.4], [-122.2, 37]],
    [[-122.1, 37.1], [-122.1, 37.15], [-122.05, 37.15], [-122.05, 37.1], [-122.1, 37.1]],
  ]],
};

function translatedX(element) {
  return Number(element.getAttribute("transform").match(/translate\(([-.\d]+)/)?.[1]);
}

test("Plans fallback projects the supplied service-area geometry and exact candidate/report locations", () => {
  const { document } = parseHTML('<div id="map" style="background:radial-gradient(red, blue)"></div>');
  const container = document.getElementById("map");
  const svg = renderPlansLocationFallback(container, { candidate, geometry: serviceArea });

  assert.equal(container.firstElementChild, svg);
  assert.equal(svg.getAttribute("viewBox"), "0 0 800 420");
  assert.equal(container.style.background, "");
  assert.equal(container.querySelector(".analysis-map-placeholder"), null);

  const area = svg.querySelector('[data-geographic-role="service-area"]');
  assert.ok(area);
  assert.equal(area.getAttribute("fill-rule"), "evenodd");
  assert.equal((area.getAttribute("d").match(/M/g) || []).length, 2, "outer ring and hole are retained");
  assert.equal((area.getAttribute("d").match(/Z/g) || []).length, 2);

  const reports = [...svg.querySelectorAll('[data-geographic-role="report"]')];
  assert.equal(reports.length, 2);
  assert.deepEqual(reports.map((report) => report.getAttribute("data-report-id")), ["west", "north"]);
  const marker = svg.querySelector('[data-geographic-role="candidate"]');
  assert.equal(marker.getAttribute("data-latitude"), "37.2");
  assert.equal(marker.getAttribute("data-longitude"), "-122");
  assert.ok(Number(reports[0].getAttribute("cx")) < translatedX(marker), "west report stays west of candidate");
  assert.ok(Number(reports[1].getAttribute("cy")) < Number(reports[0].getAttribute("cy")), "north report stays north");
  assert.match(marker.querySelector(".plan-fallback-icon").innerHTML, /M4 21V7h16v14/,
    "hospital fallback marker uses the hospital icon");

  const firstPath = area.getAttribute("d");
  const shifted = structuredClone(serviceArea);
  shifted.coordinates[0][0][1][0] = -121.7;
  renderPlansLocationFallback(container, { candidate, geometry: shifted });
  assert.notEqual(container.querySelector(".plan-fallback-area").getAttribute("d"), firstPath,
    "changing the supplied GeoJSON changes the rendered outline");
});

test("Plans fallback unwraps service areas that cross the date line around the candidate", () => {
  const { document } = parseHTML('<div id="map"></div>');
  const geometry = {
    type: "MultiPolygon",
    coordinates: [
      [[[179.5, -1], [180, -1], [180, 1], [179.5, 1], [179.5, -1]]],
      [[[-180, -1], [-179.5, -1], [-179.5, 1], [-180, 1], [-180, -1]]],
    ],
  };
  const dateLineCandidate = {
    rank: 1,
    iconKey: "water",
    position: { latitude: 0, longitude: 179.8 },
    supportingReports: [
      { id: "east", latitude: 0, longitude: 179.7 },
      { id: "west", latitude: 0, longitude: -179.7 },
    ],
  };
  const svg = renderPlansLocationFallback(document.getElementById("map"), {
    candidate: dateLineCandidate,
    geometry,
  });
  const reportX = [...svg.querySelectorAll(".plan-fallback-report")].map((node) => Number(node.getAttribute("cx")));
  assert.ok(Math.max(...reportX) - Math.min(...reportX) < 732,
    "nearby points on opposite longitude signs are not placed a world apart");
  assert.equal((svg.querySelector(".plan-fallback-area").getAttribute("d").match(/M/g) || []).length, 2);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRegionPicker } from "../region-picker.js";
import { countRegions, searchRegions } from "../region-navigation.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
function mount({ selectedId = "country-2", liveDirectory = false } = {}) {
  const entries = [...Array.from({ length: 250 }, (_, index) => ({
    id: `country-${index}`, label: `Country ${String(index).padStart(3, "0")}`, kind: "country",
  })), ...Array.from({ length: 145 }, (_, index) => ({
    id: `region-${index}`, label: `Region ${String(index).padStart(3, "0")}`,
    kind: ["state", "needmap"][index % 2],
  }))];
  const queries = [], selections = [];
  let worldwide = 0, detections = 0;
  let document;
  class Element {
    constructor(id = "", tag = "div") { this.id = id; this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.value = ""; this.hidden = false; this.textContent = ""; this.scrollTop = 0; }
    addEventListener(type, callback) { this.listeners.set(type, [...this.listeners.get(type) || [], callback]); }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== callback)); }
    dispatch(type, details = {}) { const event = { target: this, prevented: false, preventDefault() { this.prevented = true; }, ...details }; for (const callback of this.listeners.get(type) || []) callback(event); return event; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) || null; }
    append(...nodes) { nodes.forEach((node) => { node.parentNode = this; this.children.push(node); }); }
    replaceChildren(...nodes) { this.children.forEach((node) => { node.parentNode = null; }); this.children = []; this.append(...nodes); }
    querySelectorAll(selector) { return this.children.flatMap((child) => [child.tagName === selector ? child : [], child.querySelectorAll(selector)].flat()); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(other) { return other === this || this.children.some((child) => child.contains(other)); }
    closest(selector) { if (selector === ".region-navigation" && this.id === "navigation") return this; return this.parentNode?.closest(selector) || null; }
    focus() { document.activeElement = this; }
  }
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element(id)]));
  document = new Element("document");
  document.getElementById = (id) => elements[id];
  document.createElement = (tag) => new Element("", tag);
  document.activeElement = null;
  const wrapper = new Element("navigation");
  wrapper.append(elements["change-region"], elements["region-menu"]);
  for (const id of ["region-search-form", "region-search", "region-results", "region-search-status", "region-action-status"]) elements["region-menu"].append(elements[id]);
  elements["region-menu"].hidden = true;
  const matches = (query, { kind } = {}) => entries.filter((entry) => (!kind || entry.kind === kind) && entry.label.toLowerCase().includes(query.trim().toLowerCase()));
  const navigation = {
    count: (query, options) => liveDirectory ? countRegions(query, options) : matches(query, options).length,
    search: (query, options) => { queries.push([query, options]); return liveDirectory ? searchRegions(query, options) : matches(query, options).slice(0, options.limit); },
    getSelected: () => ({ id: selectedId }),
    select: (id) => { selections.push(id); selectedId = id; },
    worldwide: () => { worldwide += 1; }, detect: () => { detections += 1; },
  };
  const picker = createRegionPicker({ navigation, document });
  return { elements, picker, document, entries, queries, selections, get worldwide() { return worldwide; }, get detections() { return detections; },
    buttons: () => elements["region-results"].querySelectorAll("button") };
}

test("the menu has one unified region list without download controls or a separate area section", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const picker = await readFile(new URL("../region-picker.js", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal((html.match(/<ul[^>]*class="region-results"/g) || []).length, 2);
  assert.doesNotMatch(html + app, /region-area-list|region-areas-title|id="region-areas"|Open a large state|region-worldwide|region-locate|needmapAreasLayer|renderRegionBoundaries/);
  assert.doesNotMatch(html + picker, /region-show-more|Show more|pageSize/);
  assert.doesNotMatch(html, /\bdownload(?:[\s=>])|world-region-catalog\.csv|Download (?:data|the complete)/);
  assert.match(html, /Search countries, states, provinces, and NeedMap regions worldwide/);
  for (const [, id] of picker.matchAll(/byId\("([^"]+)"\)/g)) assert.ok(ids.includes(id), `Missing picker DOM hook ${id}`);
});

test("opening the list puts Worldwide first followed by all 250 countries and territories", () => {
  const page = mount({ liveDirectory: true }); page.picker.open();
  const expected = searchRegions("", { kind: "country", limit: Infinity });
  assert.equal(page.buttons().length, 251);
  assert.deepEqual(page.buttons().map((button) => button.getAttribute("data-region-id")), ["world", ...expected.map((entry) => entry.id)]);
  assert.equal(page.buttons()[0].textContent, "Worldwide");
  assert.equal(page.buttons()[1].textContent, "Afghanistan");
  assert.equal(page.buttons().at(-1).textContent, "Zimbabwe");
  assert.match(page.elements["region-search-status"].textContent, /^Worldwide and 250 countries and territories\.$/);
  assert.deepEqual(page.selections, []); assert.equal(page.detections, 0);
  assert.equal(page.document.activeElement, page.elements["region-search"]);
});

test("initial country browsing preserves the current-country marker without automatically navigating", () => {
  const page = mount(); page.picker.open();
  assert.equal(page.buttons().length, 251);
  assert.deepEqual(page.queries[0], ["", { kind: "country", limit: Infinity }]);
  assert.deepEqual(page.selections, []); assert.equal(page.detections, 0);
  assert.equal(page.document.activeElement, page.elements["region-search"]);
  assert.equal(page.buttons()[3].getAttribute("aria-current"), "true");
  assert.equal(page.buttons().filter((button) => button.getAttribute("aria-current")).length, 1);
});

test("search displays all matching states and NeedMap regions beyond both 40 and 100 results", () => {
  const page = mount(); page.picker.open();
  page.elements["region-search"].value = "Region"; page.elements["region-search"].dispatch("input");
  assert.equal(page.buttons().length, 145);
  assert.equal(new Set(page.buttons().map((button) => button.getAttribute("data-region-id"))).size, 145);
  assert.equal(page.buttons().at(-1).getAttribute("data-region-id"), "region-144");
  assert.equal(page.elements["region-search-status"].textContent, "145 matching regions.");
  assert.deepEqual(page.queries.at(-1), ["Region", { kind: undefined, limit: Infinity }]);
  page.buttons().at(-1).dispatch("click"); assert.deepEqual(page.selections, ["region-144"]);
});

test("typing resets scroll without taking focus and clearing or whitespace restores every country", () => {
  const page = mount(); page.picker.open();
  page.elements["region-results"].scrollTop = 900;
  page.elements["region-search"].focus(); page.elements["region-search"].value = "Region 14";
  page.elements["region-search"].dispatch("input");
  assert.equal(page.buttons().length, 5); assert.equal(page.elements["region-results"].scrollTop, 0);
  assert.equal(page.document.activeElement, page.elements["region-search"]);
  assert.equal(page.elements["region-search-status"].textContent, "5 matching regions.");
  page.elements["region-search"].value = ""; page.elements["region-search"].dispatch("input");
  assert.equal(page.buttons().length, 251);
  assert.deepEqual(page.queries.at(-1), ["", { kind: "country", limit: Infinity }]);
  page.elements["region-search"].value = "   "; page.elements["region-search"].dispatch("input");
  assert.equal(page.buttons().length, 251);
  assert.equal(page.elements["region-search-status"].textContent, "Worldwide and 250 countries and territories.");
});

test("empty results retain independent navigation errors", () => {
  const page = mount(); page.picker.open();
  page.elements["region-action-status"].textContent = "The selected boundary could not be loaded.";
  page.elements["region-search"].value = "nowhere"; page.elements["region-search"].dispatch("input");
  assert.equal(page.buttons().length, 0);
  assert.match(page.elements["region-search-status"].textContent, /No matching regions/);
  assert.match(page.elements["region-action-status"].textContent, /could not be loaded/);
});

test("choosing a region uses its navigation ID and updates the visible current-region marker", () => {
  const page = mount(); page.picker.open();
  page.buttons()[5].dispatch("click");
  assert.deepEqual(page.selections, ["country-4"]);
  page.picker.close(); page.picker.open();
  assert.equal(page.buttons()[5].getAttribute("aria-current"), "true");
  assert.equal(page.buttons()[3].getAttribute("aria-current"), null);
  assert.equal(page.worldwide, 0); assert.equal(page.detections, 0);
});

test("keyboard navigation reaches the final country and Escape restores the Change Region button", () => {
  const page = mount(); page.picker.open();
  const submitted = page.elements["region-search-form"].dispatch("submit");
  assert.equal(submitted.prevented, true); assert.equal(page.document.activeElement, page.buttons()[0]);
  page.elements["region-results"].dispatch("keydown", { key: "End" });
  assert.equal(page.document.activeElement, page.buttons()[250]);
  page.elements["region-results"].dispatch("keydown", { key: "ArrowUp" });
  assert.equal(page.document.activeElement, page.buttons()[249]);
  page.elements["region-results"].dispatch("keydown", { key: "Home" });
  assert.equal(page.document.activeElement, page.buttons()[0]);
  page.document.dispatch("keydown", { key: "Escape" });
  assert.equal(page.elements["region-menu"].hidden, true);
  assert.equal(page.document.activeElement, page.elements["change-region"]);
  assert.equal(page.elements["change-region"].getAttribute("aria-expanded"), "false");
});

test("Worldwide is directly selectable and preserves the current selection marker", () => {
  const page = mount(); page.picker.open();
  page.buttons()[0].dispatch("click");
  assert.deepEqual(page.selections, ["world"]);
  page.picker.close(); page.picker.open();
  assert.equal(page.buttons()[0].getAttribute("aria-current"), "true");
  assert.equal(page.buttons().filter((button) => button.getAttribute("aria-current")).length, 1);
  assert.equal(page.detections, 0);
});

test("world and global search aliases find Worldwide without treating it as a country", () => {
  const page = mount({ liveDirectory: true }); page.picker.open();
  for (const query of ["world", "Worldwide", "GLOBAL", "glob", "all regions", "global regions"]) {
    page.elements["region-search"].value = query; page.elements["region-search"].dispatch("input");
    const expectedCount = countRegions(query) + 1;
    assert.equal(page.buttons().length, expectedCount, query);
    assert.equal(page.buttons()[0].getAttribute("data-region-id"), "world", query);
    assert.equal(page.buttons().filter((button) => button.getAttribute("data-region-id") === "world").length, 1);
    assert.equal(page.elements["region-search-status"].textContent, `${expectedCount} matching region${expectedCount === 1 ? "" : "s"}.`);
  }
  assert.equal(countRegions("", { kind: "country" }), 250);
  page.elements["region-search"].value = "Kenya"; page.elements["region-search"].dispatch("input");
  assert.ok(page.buttons().length > 0);
  assert.ok(page.buttons().every((button) => button.getAttribute("data-region-id") !== "world"));
});

test("destroy removes listeners and prevents stale result controls from navigating", () => {
  const page = mount(); page.picker.open();
  const button = page.buttons()[0]; page.picker.destroy();
  button.dispatch("click");
  assert.deepEqual(page.selections, []); assert.equal(page.worldwide, 0); assert.equal(page.detections, 0);
  page.picker.close(); page.elements["change-region"].dispatch("click");
  assert.equal(page.elements["region-menu"].hidden, true);
});

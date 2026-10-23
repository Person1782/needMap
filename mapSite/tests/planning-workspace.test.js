import test from "node:test";
import assert from "node:assert/strict";
import { createPlanningWorkspace } from "../planning-workspace.js";
import { PLAN_STORAGE_KEY } from "../planning-model.js";

// Exercise the real DOM-facing workspace with only browser primitives replaced.
class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase(); this.children = []; this.handlers = new Map();
    this.attributes = {}; this.style = {}; this.className = ""; this.value = "";
    this.hidden = false; this.disabled = false; this._text = "";
  }
  set textContent(text) { this.children = []; this._text = String(text ?? ""); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { children.forEach((child) => { child.parent = this; this.children.push(child); }); }
  replaceChildren(...children) { this.textContent = ""; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, listener) { this.handlers.set(type, [...(this.handlers.get(type) || []), listener]); }
  dispatch(type) { for (const listener of this.handlers.get(type) || []) listener({ target: this }); }
  querySelectorAll(selector) {
    const matches = (node) => selector.startsWith(".") ? node.className.split(" ").includes(selector.slice(1)) : node.tagName === selector.toUpperCase();
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  click() { this.dispatch("click"); }
}

function candidate(id = "clinic-a", overrides = {}) {
  return { id, category: "healthcare", region: { name: "Example area", population: 90000 },
    analysis: { facilityType: "Clinic", rationale: "Residents report long journeys to care.", source: "Report analysis" },
    signals: [{ id: "report-1", summary: "A clinic is too far away." }], ...overrides };
}

function harness({ storage = new Map(), getPlanningReference, blocked = false } = {}) {
  globalThis.document = { createElement: (tag) => new Element(tag), body: new Element("body") };
  globalThis.localStorage = {
    getItem(key) { if (blocked) throw new Error("Storage denied"); return storage.get(key) || null; },
    setItem(key, value) { if (blocked) throw new Error("Storage denied"); storage.set(key, value); },
  };
  const root = new Element("main");
  const shown = [];
  const workspace = createPlanningWorkspace({ root, onShowRecommendation: (value) => shown.push(value), getPlanningReference });
  const input = (name) => root.querySelectorAll("input").find((node) => node.name === name);
  return { workspace, root, storage, shown, input,
    edit(name, value) { const node = input(name); node.value = value; node.dispatch("input"); return node; },
    button(label) { return root.querySelectorAll("button").find((node) => node.textContent === label); },
    preview() { return root.querySelector(".plan-preview").textContent; },
  };
}

test("recommendations enable blank planning without inferring population from reports or regional census", () => {
  const h = harness();
  assert.equal(h.button("Export plan (.csv)").disabled, true);
  h.workspace.updateSignals([null, { id: "report" }]);
  assert.match(h.root.querySelector(".plan-empty").textContent, /1 community report is available/);
  h.workspace.updateRecommendations([null, {}, candidate()]);
  assert.equal(h.button("Export plan (.csv)").disabled, false);
  assert.equal(h.input("population").value, "");
  assert.equal(h.input("capitalCost").value, "");
  assert.match(h.preview(), /Add population/);
  assert.equal(h.root.querySelector(".plan-empty").hidden, true);
});

test("example assumptions drive visible results and stay explicitly fictional", () => {
  const h = harness(); h.workspace.updateRecommendations([candidate()]);
  h.button("Load example assumptions").click();
  assert.equal(h.input("population").value, "2400");
  assert.match(h.preview(), /1,440/);
  assert.match(h.preview(), /1,920 hours/);
  assert.match(h.preview(), /347,500/);
  assert.match(h.preview(), /26 weeks/);
  assert.equal(h.root.querySelector(".plan-example-notice").hidden, false);
  h.edit("population", "1000");
  assert.equal(h.root.querySelector(".plan-example-notice").hidden, false);
  assert.match(h.preview(), /800 hours/);
});

test("typing invalid input surfaces an associated error and removes dependent estimates", () => {
  const h = harness(); h.workspace.updateRecommendations([candidate()]); h.button("Load example assumptions").click();
  const field = h.edit("adoption", "120");
  assert.equal(field.attributes["aria-invalid"], "true");
  assert.match(h.root.textContent, /Enter a value from 0 to 100/);
  assert.doesNotMatch(h.preview(), /1,920 hours/);
  h.edit("adoption", "0");
  assert.equal(field.attributes["aria-invalid"], "false");
  assert.match(h.preview(), /0 hours/);
});

test("same-candidate background updates preserve current form nodes, edits, and sources", () => {
  const h = harness(); h.workspace.updateRecommendations([candidate()]);
  const populationInput = h.edit("population", "1234");
  h.edit("populationSource", "Local survey");
  h.workspace.updateRecommendations([candidate("clinic-a", { analysis: { facilityType: "Expanded clinic", rationale: "Updated evidence" } })]);
  h.workspace.updateSignals([{ id: "report-2" }]);
  assert.equal(h.input("population"), populationInput);
  assert.equal(h.input("population").value, "1234");
  assert.equal(h.input("populationSource").value, "Local survey");
  assert.match(h.root.querySelector(".plan-evidence").textContent, /Updated evidence/);
});

test("each candidate keeps a separate draft across selection, removal, and reload", () => {
  const storage = new Map();
  const h = harness({ storage }); h.workspace.updateRecommendations([candidate(), candidate("clinic-b")]);
  h.edit("population", "1234");
  h.workspace.selectRecommendation("clinic-b"); h.edit("population", "500");
  h.workspace.selectRecommendation("clinic-a"); assert.equal(h.input("population").value, "1234");
  h.workspace.updateRecommendations([]);
  assert.equal(h.root.querySelector(".plan-content").hidden, true);
  h.workspace.updateRecommendations([candidate()]); assert.equal(h.input("population").value, "1234");
  h.workspace.destroy();
  const reloaded = harness({ storage }); reloaded.workspace.updateRecommendations([candidate("clinic-b")]);
  assert.equal(reloaded.input("population").value, "500");
  assert.equal(JSON.parse(storage.get(PLAN_STORAGE_KEY)).plans.length, 2);
});

test("unavailable storage does not prevent planning, clearing, visibility or navigation", () => {
  const h = harness({ blocked: true }); h.workspace.updateRecommendations([candidate()]);
  h.button("Load example assumptions").click();
  assert.match(h.preview(), /1,920 hours/);
  h.button("View in Explore ↗").click(); assert.equal(h.shown[0].id, "clinic-a");
  h.button("Clear assumptions").click(); assert.equal(h.input("population").value, "");
  h.workspace.setActive(false); assert.equal(h.root.hidden, true);
  h.workspace.setActive(true); assert.equal(h.root.hidden, false);
  h.workspace.destroy(); h.workspace.updateRecommendations([candidate()]);
  assert.equal(h.root.children.length, 0);
});

test("worse and unchanged travel scenarios show no fabricated benefit", () => {
  const h = harness(); h.workspace.updateRecommendations([candidate()]); h.button("Load example assumptions").click();
  h.edit("proposedMinutes", "45");
  assert.match(h.preview(), /10 more minutes each way/);
  assert.match(h.preview(), /-960 hours/);
  h.edit("proposedMinutes", "35");
  assert.match(h.preview(), /No change in travel time/);
  assert.match(h.preview(), /0 hours/);
});

test("published benchmarks seed missing drafts once and never overwrite local edits", () => {
  let reference = { values: { capitalCost: 100000, costSource: "City project budget, 2025" },
    sources: [{ label: "City budget", url: "https://example.gov/budget", note: "Published capital allocation" }],
    note: "The city population is 100,000; this is not the catchment population." };
  const storage = new Map();
  const h = harness({ storage, getPlanningReference: () => reference });
  h.workspace.updateRecommendations([candidate()]);
  assert.equal(h.input("capitalCost").value, "100000");
  assert.equal(h.input("population").value, "");
  assert.match(h.root.querySelector(".plan-references").textContent, /not the catchment/);
  assert.equal(h.root.querySelector(".plan-references").open, true);
  assert.equal(h.root.querySelector(".plan-references").querySelector("a").href, "https://example.gov/budget");
  h.edit("capitalCost", "120000");
  reference = { ...reference, values: { capitalCost: 110000 } };
  h.workspace.updateRecommendations([candidate()]);
  assert.equal(h.input("capitalCost").value, "120000");
  const reloaded = harness({ storage, getPlanningReference: () => reference });
  reloaded.workspace.updateRecommendations([candidate()]);
  assert.equal(reloaded.input("capitalCost").value, "120000");
  reloaded.button("Clear assumptions").click(); reloaded.workspace.updateRecommendations([candidate()]);
  assert.equal(reloaded.input("capitalCost").value, "");
});

test("published population context and acquisition scope are visible without becoming benefit assumptions", () => {
  const h = harness({ getPlanningReference: () => ({
    values: { capitalCost: "169004", currency: "USD", deliveryWeeks: "22" },
    fieldNotes: { capitalCost: "One ADA vehicle only; not a complete service launch.", deliveryWeeks: "Vehicle delivery only; add launch preparation." },
    populationContext: { label: "Fremont citywide population", value: 226442, year: 2025,
      note: "Whole-city context, not the service-area population.", sourceLabel: "Census", sourceUrl: "https://example.gov/census" },
    sources: [{ label: "Census", url: "https://example.gov/census", note: "Whole city" }],
  }) });
  h.workspace.updateRecommendations([candidate()]);
  const references = h.root.querySelector(".plan-references");
  assert.equal(references.open, true);
  assert.match(references.textContent, /226,442/);
  assert.equal(h.input("population").value, "");
  assert.match(h.input("capitalCost").parent.textContent, /One ADA vehicle only/);
  assert.match(h.input("deliveryWeeks").parent.textContent, /Vehicle delivery only/);
  assert.match(h.preview(), /Planning cost estimate/);
  assert.match(h.root.querySelector(".plan-cost-scope").textContent, /not a complete service launch/);
  references.open = false;
  h.workspace.updateRecommendations([candidate()]);
  assert.equal(references.open, false, "Background updates respect a manually collapsed reference panel");
  h.button("Load example assumptions").click();
  assert.equal(h.root.querySelector(".plan-cost-scope"), null, "A fictional example must not appear to use the published benchmark");
  assert.doesNotMatch(h.input("capitalCost").parent.textContent, /One ADA vehicle only/);
});

test("new benchmark data fills untouched blanks after analysis updates without replacing user edits", () => {
  let reference = { values: {}, sources: [], note: "Published context" };
  const storage = new Map();
  const h = harness({ storage, getPlanningReference: () => reference });
  h.workspace.updateRecommendations([candidate()]);
  const populationInput = h.edit("population", "1200");
  h.edit("operatingCost", "500"); h.edit("operatingCost", "");
  reference = { ...reference, values: { capitalCost: "100000", operatingCost: "1000", population: "90000" } };
  h.workspace.updateRecommendations([candidate()]);
  assert.equal(h.input("population"), populationInput);
  assert.equal(h.input("population").value, "1200");
  assert.equal(h.input("capitalCost").value, "100000");
  assert.equal(h.input("operatingCost").value, "");
  const reloaded = harness({ storage, getPlanningReference: () => reference });
  reloaded.workspace.updateRecommendations([candidate()]);
  assert.equal(reloaded.input("operatingCost").value, "");
  assert.equal(reloaded.input("population").value, "1200");
});

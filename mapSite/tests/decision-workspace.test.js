import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as decisionTools from "../decision-tools.js";

// Execute the actual workspace with controlled browser and Firebase boundaries.
// This allows deterministic tests of auth/listener races without production writes.
const source = readFileSync(new URL("../decision-workspace.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace("export function createDecisionWorkspace", "function createDecisionWorkspace");

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.handlers = new Map();
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.className = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.offsetWidth = 0;
    this._text = "";
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(" "), ...names])].join(" ").trim(); },
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(" "));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" ").trim();
      },
    };
  }
  get isConnected() { return Boolean(this.root || this.parent?.isConnected); }
  set textContent(text) {
    this.children.forEach((child) => { child.parent = null; });
    this.children = [];
    this._text = String(text ?? "");
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  append(...children) {
    children.forEach((child) => { child.parent = this; this.children.push(child); });
  }
  replaceChildren(...children) { this.textContent = ""; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.handlers.get(type)?.delete(listener); }
  async dispatch(type) {
    await Promise.all([...(this.handlers.get(type) || [])].map((listener) => listener({
      preventDefault() {}, target: this,
    })));
  }
  querySelectorAll(selector) {
    const matches = (element) => selector.startsWith(".")
      ? element.className.split(" ").includes(selector.slice(1))
      : element.tagName === selector.toUpperCase();
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise; reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const candidate = (id = "candidate-a", overrides = {}) => ({
  id, category: "healthcare", position: { latitude: 37.5, longitude: -122.1 },
  region: { id: "region-a", name: "Region A" }, urgencyScore: 3,
  analysis: { facilityType: "Clinic", confidence: 0.8, priority: "high" },
  signals: [], ...overrides,
});
const report = (id, overrides = {}) => ({
  id, category: "healthcare", latitude: 37.5, longitude: -122.1,
  severity: "high", summary: "A nearby clinic would help residents access regular care.",
  region: { id: "region-a", name: "Region A" }, submittedAt: new Date().toISOString(),
  ...overrides,
});

function harness({ savedState, profile = { active: true, role: "admin" }, getProfile, loadServices, addOutcome } = {}) {
  const elements = new Map([...source.matchAll(/document\.querySelector\("#([^"]+)"\)/g)].map((match) => [match[1], new Element()]));
  elements.forEach((element) => { element.root = true; });
  elements.get("trend-range").value = "12";
  elements.get("scenario-mode").value = "transit";
  const tooltips = [];
  const removals = [];
  const layer = () => ({
    layers: [], clearLayers() { this.layers = []; return this; },
    addTo(target) { target?.layers?.push(this); return this; },
    removeFrom() { return this; }, remove() { removals.push(this); },
    bindTooltip(content) { tooltips.push(content); return this; },
  });
  const document = {
    querySelector: (selector) => elements.get(selector.slice(1)) || null,
    querySelectorAll: () => [],
    createElement: (tagName) => new Element(tagName),
    body: new Element("body"),
  };
  const storage = new Map();
  if (savedState !== undefined) storage.set("needmap.decision-workspace.v2", JSON.stringify(savedState));
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const auth = { currentUser: null };
  let authCallback;
  let profileRequests = 0;
  let writes = 0;
  const snapshots = new Map();
  const moderationChanges = [];
  const errors = [];
  const context = vm.createContext({
    ...decisionTools, document, localStorage, sessionStorage: localStorage,
    Date, URL, Blob, setTimeout, clearTimeout,
    window: { print() {} }, requestAnimationFrame() {},
    console: { error: (...values) => errors.push(values) },
    L: { layerGroup: layer, circle: layer, circleMarker: layer, marker: layer },
    getAuth: () => auth,
    onAuthStateChanged: (_auth, callback) => { authCallback = callback; return () => {}; },
    signInWithEmailAndPassword: async () => ({}), signOut: async () => authCallback(null),
    doc: (_db, collection, id) => ({ collection, id }), collection: (_db, name) => name,
    getDoc: async () => {
      profileRequests += 1;
      if (getProfile) return getProfile();
      return { exists: () => Boolean(profile), data: () => profile };
    },
    onSnapshot: (name, next, error) => {
      const record = { next, error, closed: false };
      if (!snapshots.has(name)) snapshots.set(name, []);
      snapshots.get(name).push(record);
      return () => { record.closed = true; };
    },
    setDoc: async () => { writes += 1; },
    addDoc: async (...args) => { writes += 1; return addOutcome?.(...args); },
    serverTimestamp: () => ({ serverTimestamp: true }),
    loadNearbyServices: loadServices || (async () => ({ services: [], radiusMeters: 5000 })),
    serviceInventorySource: { attribution: "OpenStreetMap", url: "https://example.invalid" },
  });
  vm.runInContext(`${source}\nglobalThis.createWorkspace = createDecisionWorkspace;`, context);
  const workspace = context.createWorkspace({ firebaseApp: {}, db: {}, map: layer(),
    onModerationChanged: (records) => moderationChanges.push(records),
  });
  return {
    workspace, elements, snapshots, moderationChanges, tooltips, storage, errors,
    get writes() { return writes; }, get profileRequests() { return profileRequests; },
    async authAs(user) { auth.currentUser = user; return authCallback(user); },
    emit(name, records, index = 0) {
      snapshots.get(name)[index].next({ docs: records.map((record, entryIndex) => ({
        id: String(entryIndex), data: () => record,
      })) });
    },
    click: (id) => elements.get(id).dispatch("click"),
    button(text) { return elements.get("decision-detail").querySelectorAll("button").find((button) => button.textContent === text); },
  };
}

test("malformed persisted local data is sanitized and invalid incoming entries do not crash the workspace", () => {
  const h = harness({ savedState: {
    mode: "local", workflows: { "candidate-a": { status: {}, owner: [], note: null }, bad: null },
    moderation: { a: { status: {} }, b: null }, outcomes: [null, 1, {}],
    settings: { highUrgencyThreshold: -20, trendRatio: "invalid" }, acknowledgedAlerts: [null, {}],
  } });
  h.workspace.updateSignals([null, report("a")]);
  h.workspace.updateRecommendations([null, { id: "invalid", position: { latitude: "", longitude: 0 } }, candidate()]);
  assert.equal(h.elements.get("alert-high-threshold").value, "1");
  assert.equal(h.elements.get("alert-trend-threshold").value, "1.5");
  assert.match(h.elements.get("decision-detail").textContent, /Clinic/);
  assert.equal(Object.keys(h.workspace.getModeration()).length, 0);
});

test("a persisted local workspace survives a signed-in staff auth callback", async () => {
  const h = harness({ savedState: { mode: "local", moderation: { local: { status: "hidden" } } } });
  await h.authAs({ uid: "staff", email: "staff@example.test" });
  assert.equal(h.elements.get("staff-role").textContent, "Local planner");
  assert.equal(h.workspace.getModeration().local.status, "hidden");
  assert.equal(h.profileRequests, 0);
  assert.equal(h.snapshots.size, 0);
});

test("selecting local planning invalidates a pending staff profile lookup", async () => {
  const pending = deferred();
  const h = harness({ getProfile: () => pending.promise });
  const resolving = h.authAs({ uid: "staff" });
  await h.click("local-demo-button");
  pending.resolve({ exists: () => true, data: () => ({ active: true, role: "admin" }) });
  await resolving;
  assert.equal(h.elements.get("staff-role").textContent, "Local planner");
  assert.equal(h.snapshots.size, 0);
});

test("a signed-in nonstaff user can leave local planning", async () => {
  const h = harness({ savedState: { mode: "local" }, profile: null });
  await h.authAs({ uid: "nonstaff" });
  await h.click("local-demo-button");
  assert.equal(h.elements.get("staff-role").textContent, "Read only");
  assert.equal(JSON.parse(h.storage.get("needmap.decision-workspace.v2")).mode, "readonly");
});

test("late shared snapshots cannot overwrite a local planning session", async () => {
  const h = harness({ savedState: { moderation: { local: { status: "hidden" } } } });
  await h.authAs({ uid: "staff" });
  await h.click("local-demo-button");
  h.emit("reportModeration", [{ reportId: "shared", status: "duplicate" }]);
  assert.equal(h.workspace.getModeration().local.status, "hidden");
  assert.equal(h.workspace.getModeration().shared, undefined);
  assert.ok(h.snapshots.get("reportModeration")[0].closed);
});

test("losing shared permissions clears private data and disables writes", async () => {
  const h = harness();
  await h.authAs({ uid: "staff" });
  h.emit("reportModeration", [{ reportId: "private", status: "hidden" }]);
  h.snapshots.get("reportModeration")[0].error({ code: "permission-denied" });
  assert.equal(h.elements.get("staff-role").textContent, "Read only");
  assert.equal(Object.keys(h.workspace.getModeration()).length, 0);
  assert.match(h.elements.get("decision-access-banner").textContent, /no longer available/);
});

test("destroy cancels event listeners and ignores late auth responses", async () => {
  const pending = deferred();
  const h = harness({ getProfile: () => pending.promise });
  const resolving = h.authAs({ uid: "staff" });
  h.workspace.destroy();
  await h.click("local-demo-button");
  pending.resolve({ exists: () => true, data: () => ({ active: true, role: "admin" }) });
  await resolving;
  assert.equal(h.snapshots.size, 0);
  assert.equal(h.elements.get("staff-role").textContent, "Read only");
  assert.equal(h.elements.get("local-demo-button").handlers.get("click").size, 0);
});

test("hidden and duplicate reports do not contribute to live trend or alert totals", () => {
  const h = harness();
  h.workspace.updateSignals([
    report("a", { moderationStatus: "hidden" }),
    report("b", { moderationStatus: "duplicate" }), report("c"),
  ]);
  assert.equal(h.elements.get("alerts-count").hidden, true);
  const bars = h.elements.get("trend-chart").querySelectorAll("strong");
  assert.equal(bars.reduce((total, bar) => total + Number(bar.textContent), 0), 1);
});

test("acknowledged alerts reappear when new evidence arrives", async () => {
  const h = harness();
  const reports = [report("a"), report("b"), report("c")];
  h.workspace.updateSignals(reports);
  await h.elements.get("alerts-list").querySelector("button").dispatch("click");
  assert.equal(h.elements.get("alerts-count").hidden, true);
  h.workspace.updateSignals([...reports, report("d")]);
  assert.equal(h.elements.get("alerts-count").hidden, false);
});

test("scenario comparison refuses to rank unrelated regions or categories", () => {
  const h = harness();
  h.workspace.updateRecommendations([
    candidate(), candidate("candidate-b", { category: "broadband", region: { id: "other", name: "Other region" } }),
  ]);
  assert.match(h.elements.get("scenario-comparison").textContent, /different regions or service needs/);
  assert.equal(h.elements.get("scenario-comparison").querySelector("table"), null);
});

test("read-only workflow and outcome controls are disabled", () => {
  const h = harness();
  h.workspace.updateRecommendations([candidate()]);
  for (const form of h.elements.get("decision-detail").querySelectorAll("form")) {
    const controls = ["select", "input", "textarea", "button"].flatMap((tag) => form.querySelectorAll(tag));
    assert.ok(controls.every((control) => control.disabled));
  }
});

test("in-progress workflow notes survive recommendation rerenders", async () => {
  const h = harness({ savedState: { mode: "local" } });
  h.workspace.updateRecommendations([candidate()]);
  const form = h.elements.get("decision-detail").querySelector(".workflow-form");
  form.querySelector("textarea").value = "Review the parcel and confirm accessibility.";
  await form.dispatch("input");
  h.workspace.updateRecommendations([candidate()]);
  assert.equal(h.elements.get("decision-detail").querySelector(".workflow-form").querySelector("textarea").value,
    "Review the parcel and confirm accessibility.");
});

test("outcome saves remain single-flight when shared listeners rerender the form", async () => {
  const pending = deferred();
  const h = harness({ addOutcome: () => pending.promise });
  await h.authAs({ uid: "staff" });
  h.workspace.updateRecommendations([candidate()]);
  const form = h.elements.get("decision-detail").querySelector(".outcome-form");
  form.querySelector("textarea").value = "Access improved after the pilot.";
  form.querySelectorAll("select")[0].value = "better";
  form.querySelectorAll("select")[1].value = "5";
  await form.dispatch("input");
  const saving = form.dispatch("submit");
  h.emit("outcomeFeedback", []);
  const replacement = h.elements.get("decision-detail").querySelector(".outcome-form");
  assert.equal(replacement.querySelector("button").disabled, true);
  await replacement.dispatch("submit");
  assert.equal(h.writes, 1);
  pending.resolve({ id: "outcome" });
  await saving;
  assert.equal(h.elements.get("decision-detail").querySelector(".outcome-form").querySelector("textarea").value, "");
});

test("new outcome notes typed during a pending save stay visible and survive rerenders", async () => {
  const pending = deferred();
  const h = harness({ addOutcome: () => pending.promise });
  await h.authAs({ uid: "staff" });
  h.workspace.updateRecommendations([candidate()]);
  const form = h.elements.get("decision-detail").querySelector(".outcome-form");
  const note = form.querySelector("textarea");
  note.value = "First observed result.";
  await form.dispatch("input");
  const saving = form.dispatch("submit");
  note.value = "A second observation entered while the first is saving.";
  await form.dispatch("input");
  pending.resolve({ id: "first-outcome" });
  await saving;
  assert.equal(note.value, "A second observation entered while the first is saving.");
  h.workspace.updateRecommendations([candidate()]);
  assert.equal(h.elements.get("decision-detail").querySelector(".outcome-form").querySelector("textarea").value,
    "A second observation entered while the first is saving.");
});

test("a failed outcome save preserves the draft and visible error after a listener rerender", async () => {
  const pending = deferred();
  const h = harness({ addOutcome: () => pending.promise });
  await h.authAs({ uid: "staff" });
  h.workspace.updateRecommendations([candidate()]);
  const form = h.elements.get("decision-detail").querySelector(".outcome-form");
  form.querySelector("textarea").value = "The draft must remain available.";
  await form.dispatch("input");
  const saving = form.dispatch("submit");
  h.emit("outcomeFeedback", []);
  pending.reject(new Error("The connection was interrupted. Try again."));
  await saving;
  const replacement = h.elements.get("decision-detail").querySelector(".outcome-form");
  assert.match(replacement.textContent, /connection was interrupted/);
  assert.equal(replacement.querySelector("textarea").value, "The draft must remain available.");
  assert.equal(replacement.querySelector("button").disabled, false);
});

test("stale service lookups do not attach to a moved candidate", async () => {
  const pending = deferred();
  const h = harness({ loadServices: () => pending.promise });
  h.workspace.updateRecommendations([candidate()]);
  const loading = h.button("Check nearby services").dispatch("click");
  h.workspace.updateRecommendations([candidate("candidate-a", { position: { latitude: 40, longitude: -74 } })]);
  pending.resolve({ services: [{ latitude: 37.5, longitude: -122.1, name: "Old service", type: "clinic" }], radiusMeters: 5000 });
  await loading;
  assert.equal(h.tooltips.some((tooltip) => tooltip.textContent?.includes("Old service")), false);
  assert.match(h.elements.get("decision-detail").textContent, /Load mapped services/);
});

test("OpenStreetMap names are passed to Leaflet as text nodes, never HTML strings", async () => {
  const payload = '<img src=x onerror="alert(1)"> clinic';
  const h = harness({ loadServices: async () => ({ services: [{
    latitude: 37.5, longitude: -122.1, name: payload, type: "clinic",
  }], radiusMeters: 5000 }) });
  h.workspace.updateRecommendations([candidate()]);
  await h.button("Check nearby services").dispatch("click");
  const tooltip = h.tooltips.find((entry) => entry.textContent?.includes(payload));
  assert.ok(tooltip instanceof Element);
  assert.equal(tooltip.children.length, 0);
  assert.ok(h.tooltips.every((entry) => typeof entry !== "string" || !entry.includes(payload)));
});

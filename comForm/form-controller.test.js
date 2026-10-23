import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { context, read, plain, valid } from './test-helpers.js';
const html = read('index.html');
function mount({ write = (_id, _report, done) => done(null), online = true, saved = null, storageFailure = false, geolocation = true, search } = {}) {
  let focused, locationSuccess, locationFailure, timerId = 0, draft = saved, writes = 0;
  const timers = new Map();
  class Element {
    value = ''; textContent = ''; disabled = false; hidden = false; attributes = {}; children = []; listeners = {};
    constructor(id = '') { this.id = id; }
    get firstChild() { return this.children[0]; }
    addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
    dispatch(name, extra = {}) { const event = { prevented: false, preventDefault() { this.prevented = true; }, ...extra }; for (const cb of this.listeners[name] || []) cb(event); return event; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] || (key === 'data-search-url' ? 'https://places.test/search' : null); }
    removeAttribute(key) { delete this.attributes[key]; }
    appendChild(child) { this.children.push(child); }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    focus() { focused = this.id; }
  }
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element(id)]));
  const form = elements['signal-form'];
  form.reset = () => { if (!form.dispatch('reset').prevented) ['category', 'severity', 'summary', 'place-query'].forEach(name => { elements[name].value = ''; }); };
  elements['form-fields'].querySelectorAll = () => ['category', 'severity', 'summary', 'location-button', 'clear-location', 'place-query', 'place-search-button', 'submit-button'].map(name => elements[name]);
  const rootEvents = new Element('window');
  const navigator = { onLine: online };
  if (geolocation) navigator.geolocation = { getCurrentPosition(success, error) { locationSuccess = success; locationFailure = error; } };
  const ctx = context({ document: { getElementById: id => elements[id], createElement: () => new Element() }, navigator, XMLHttpRequest: function () {},
    localStorage: { getItem() { if (storageFailure) throw new Error('blocked'); return draft; }, setItem(_key, value) { draft = value; }, removeItem() { draft = null; } },
    addEventListener: rootEvents.addEventListener.bind(rootEvents), setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; }, clearTimeout: id => timers.delete(id) });
  ctx.NeedMapNetwork.createClient = () => ({ writeReport: (id, report, done) => { writes++; write(id, plain(report), done); } });
  if (search) ctx.NeedMapNetwork.request = search;
  vm.runInContext(read('app.js'), ctx);
  return { elements, form, navigator, window: rootEvents,
    get focused() { return focused; }, get writes() { return writes; }, get saved() { return draft; },
    locate: () => locationSuccess({ coords: valid.location }), rejectLocation: (code = 1) => locationFailure({ code }),
    slow() { for (const timer of timers.values()) if (timer.delay === 15000) timer.callback(); },
    fill({ addLocation = true } = {}) { for (const name of ['category', 'severity', 'summary']) elements[name].value = valid[name]; if (addLocation) { elements['location-button'].dispatch('click'); locationSuccess({ coords: valid.location }); } } };
}

test('no manual coordinate fields or remote scripts; submit requires successful initialization', () => {
  assert.doesNotMatch(html, /id="(?:latitude|longitude)"|type="module"|https:[^"']+\.js/);
  assert.match(html, /id="submit-button"[^>]+disabled/);
});
test('invalid submissions focus a linked error summary without writes', () => {
  const page = mount(); page.form.dispatch('submit');
  assert.equal(page.writes, 0); assert.equal(page.focused, 'error-summary');
  assert.equal(page.elements['error-list'].children.length, 4);
});
test('device location is permission-driven, immediately rounded and clear invalidates stale callbacks', () => {
  const page = mount(); assert.equal(page.saved, null); page.fill();
  assert.equal(JSON.parse(page.saved).location.latitude, 37.773); assert.doesNotMatch(page.saved, /37\.77491234/);
  page.elements['location-button'].dispatch('click'); page.elements['clear-location'].dispatch('click'); page.locate();
  assert.equal(JSON.parse(page.saved).location, null);
});
test('denied or unavailable device location offers search next steps', () => {
  const page = mount(); page.elements['location-button'].dispatch('click'); page.rejectLocation();
  assert.match(page.elements['location-status'].textContent, /denied.*search/); assert.equal(page.elements['location-button'].disabled, false);
  const unavailable = mount({ geolocation: false }); unavailable.elements['location-button'].dispatch('click');
  assert.match(unavailable.elements['location-status'].textContent, /unavailable.*Search/);
});
test('reset invalidates outstanding location and search responses', () => {
  let done; const page = mount({ search: (_m, _u, _b, _t, cb) => { done = cb; } });
  page.elements['place-query'].value = 'Example town'; page.elements['place-search-button'].dispatch('click'); page.form.reset();
  done(null, [{ lat: '40', lon: '-70', display_name: 'Example town' }]); assert.equal(page.elements['place-results'].children.length, 0);
  page.elements['location-button'].dispatch('click'); page.form.reset(); page.locate(); assert.equal(page.saved, null);
});
test('place search requires selection and omits query and precise coordinates from draft/report', () => {
  let payload; const page = mount({ write: (_id, report, done) => { payload = report; done(null); }, search: (_m, _u, _b, _t, done) => done(null, [{ lat: '40.123456', lon: '-70.234567', display_name: 'Example town' }]) });
  page.fill({ addLocation: false }); page.elements['location-button'].dispatch('click'); page.elements['place-query'].value = 'Example town'; page.elements['place-search-button'].dispatch('click');
  page.form.dispatch('submit'); assert.equal(page.writes, 0);
  page.elements['place-results'].children[0].children[0].dispatch('click'); page.locate();
  assert.doesNotMatch(page.saved, /Example town|40\.123456/); page.form.dispatch('submit'); assert.equal(payload.latitude, 40.122);
});
test('pending submissions block resets and duplicate sends; confirmation clears draft', () => {
  let finish; const page = mount({ write: (_id, _report, cb) => { finish = cb; } });
  page.fill(); page.form.dispatch('submit'); page.form.dispatch('submit'); page.form.reset();
  assert.equal(page.elements['form-fields'].disabled, true); assert.equal(page.elements.summary.value, valid.summary); assert.equal(page.writes, 1);
  assert.ok(JSON.parse(page.saved).attempt.id); page.slow(); assert.match(page.elements['form-status'].textContent, /Still waiting/);
  finish(null); assert.equal(page.saved, null); assert.equal(page.elements.summary.value, ''); assert.match(page.elements['form-status'].textContent, /Report received/);
});
test('lost acknowledgement survives reload with same reference and never automatically sends', () => {
  let firstId; const first = mount({ write: (id, _report, done) => { firstId = id; done(new Error('timeout')); } });
  first.fill(); first.form.dispatch('submit'); assert.match(first.elements['form-status'].textContent, /could not be confirmed/);
  const second = mount({ saved: first.saved, write: (id, _report, done) => { assert.equal(id, firstId); done(null); } });
  assert.equal(second.writes, 0); assert.equal(second.elements.summary.value, valid.summary); second.form.dispatch('submit'); assert.equal(second.writes, 1); assert.equal(second.saved, null);
});
test('offline draft can be written but reconnect never auto-sends', () => {
  const page = mount({ online: false }); page.fill(); page.form.dispatch('submit');
  assert.equal(page.writes, 0); assert.match(page.elements['form-status'].textContent, /offline/); assert.ok(page.saved);
  page.navigator.onLine = true; page.window.dispatch('online'); assert.equal(page.writes, 0); assert.equal(page.elements['connection-status'].hidden, true);
});
test('restricted storage and corrupt or expired drafts do not break form use', () => {
  const blocked = mount({ storageFailure: true }); blocked.fill(); assert.match(blocked.elements['draft-status'].textContent, /Saving on this phone is unavailable/); blocked.form.dispatch('submit'); assert.equal(blocked.writes, 1);
  for (const saved of ['broken JSON', JSON.stringify({ savedAt: 1, summary: 'Expired draft' })]) { const page = mount({ saved }); assert.equal(page.elements.summary.value, ''); assert.equal(page.elements['submit-button'].disabled, false); }
});

test('failed replacement location never silently submits a previously selected area', () => {
  const page = mount(); page.fill();
  page.elements['location-button'].dispatch('click'); page.rejectLocation();
  assert.equal(JSON.parse(page.saved).location, null);
  page.form.dispatch('submit'); assert.equal(page.writes, 0);
  assert.match(page.elements['location-error'].textContent, /Add your approximate location/);
});

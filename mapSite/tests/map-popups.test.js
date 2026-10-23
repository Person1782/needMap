import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { createMapPopups } from '../map-popups.js';
import { createAnalysisOverviewMap } from '../analysis-overview-map.js';

function events(target = {}) {
  const handlers = new Map();
  return Object.assign(target, {
    on(types, fn) { for (const type of types.split(/\s+/)) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); } return this; },
    off(types, fn) { for (const type of types.split(/\s+/)) handlers.get(type)?.delete(fn); return this; },
    fire(type, event = {}) { for (const fn of [...handlers.get(type) || []]) fn(event); return this; },
    handlerCount() { return [...handlers.values()].reduce((sum, set) => sum + set.size, 0); },
  });
}
function fixture({ width = 800, height = 440 } = {}) {
  const { document, window } = parseHTML('<html><body><div id="map"></div><button id="outside">Outside</button></body></html>');
  const container = document.querySelector('#map');
  Object.defineProperties(container, {
    clientWidth: { get: () => width }, clientHeight: { get: () => height },
  });
  const calls = { markers: [], layers: [], fits: [] };
  const map = events({
    getContainer: () => container,
    getMinZoom: () => calls.minimumZoom ?? calls.mapOptions?.minZoom ?? 0,
    getMaxZoom: () => calls.mapOptions?.maxZoom ?? 19,
    getSize: () => ({ x: width, y: height }),
    project: ([latitude, longitude]) => ({ x: longitude < 0 ? 0 : 256, y: latitude > 0 ? 0 : 256 }),
    getScaleZoom: (scale) => Math.log2(scale),
    getZoom: () => calls.view?.[1],
    setMinZoom(value) { calls.minimumZoom = value; return this; },
    setZoom(value) { calls.view = [calls.view?.[0], value]; return this; },
    panInsideBounds(bounds, options) { calls.worldPan = { bounds, options }; return this; },
    attributionControl: { setPrefix() {} },
    setView(point, zoom) { calls.view = [point, zoom]; return this; },
    fitBounds(points, options) { calls.fits.push({ points, options }); return this; },
    invalidateSize() { this.fire('resize'); },
    closePopup(popup = calls.active) { if (!popup) return; if (calls.active === popup) calls.active = null; popup.element.remove(); this.fire('popupclose', { popup }); },
    remove() { calls.removed = (calls.removed || 0) + 1; },
  });
  const L = {
    map: (_container, options) => { calls.mapOptions = options; return map; },
    tileLayer: () => ({ addTo() { return this; } }),
    divIcon: (options) => options,
    DomEvent: { stopPropagation(event) { event.stopPropagation?.(); } },
    popup(options) {
      return {
        options, element: document.createElement('div'),
        setLatLng(value) { this.point = value; return this; },
        setContent(value) { this.content = value; return this; },
        openOn(map) { map.closePopup(); calls.active = this; container.append(this.element); return this; },
        getElement() { return this.element; },
      };
    },
    marker(point, options) {
      const marker = events({ point, options, getLatLng: () => point, addTo(layer) { layer.members.push(this); return this; } });
      calls.markers.push(marker); return marker;
    },
    layerGroup() {
      const layer = { members: [], addTo() { return this; }, clearLayers() { for (const member of this.members) member.fire?.('remove'); this.members = []; } };
      calls.layers.push(layer); return layer;
    },
    geoJSON(geometry) { calls.geometry = geometry; return { addTo(layer) { layer.members.push(this); return this; } }; },
  };
  return { L, map, calls, document, window, container,
    resize(nextWidth, nextHeight) { width = nextWidth; height = nextHeight; map.fire('resize'); },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

test('hover previews, popup pointer transfer keeps it open, leaving closes preview', async () => {
  const f = fixture();
  const controller = createMapPopups(f.L, f.map, { document: f.document, closeDelay: 5 });
  const marker = f.L.marker([1, 2]); controller.register(marker, () => 'First report');
  marker.fire('mouseover'); assert.equal(f.calls.active.content, 'First report');
  marker.fire('mouseout'); f.calls.active.element.dispatchEvent(new f.window.Event('mouseenter'));
  await tick(); assert.ok(f.calls.active);
  f.calls.active.element.dispatchEvent(new f.window.Event('mouseleave'));
  await tick(); assert.equal(f.calls.active, null);
  controller.destroy();
});

test('click pins until another location is clicked; hovering does not replace the pinned report', async () => {
  const f = fixture(); const controller = createMapPopups(f.L, f.map, { document: f.document, closeDelay: 5 });
  const first = f.L.marker([1, 2]), second = f.L.marker([3, 4]);
  controller.register(first, () => 'First'); controller.register(second, () => 'Second');
  first.fire('mouseover').fire('click').fire('mouseout'); second.fire('mouseover').fire('mouseout');
  await tick(); assert.equal(f.calls.active.content, 'First');
  first.fire('click'); assert.equal(f.calls.active.content, 'First', 'Repeated clicks should keep a popup pinned');
  second.fire('click'); assert.equal(f.calls.active.content, 'Second');
  f.map.fire('click'); assert.equal(f.calls.active, null);
  controller.destroy();
});

test('outside click, removed markers, close button and teardown release popup state and handlers', () => {
  const f = fixture(); const controller = createMapPopups(f.L, f.map, { document: f.document });
  const marker = f.L.marker([1, 2]); controller.register(marker, () => 'First'); marker.fire('click');
  f.document.querySelector('#outside').dispatchEvent(new f.window.Event('click', { bubbles: true }));
  assert.equal(f.calls.active, null);
  marker.fire('click'); f.map.closePopup(); marker.fire('mouseover'); assert.ok(f.calls.active, 'Close button must release pinned state');
  marker.fire('remove'); assert.equal(f.calls.active, null); assert.equal(marker.handlerCount(), 0);
  controller.openAt([4, 5], 'List report'); assert.equal(f.calls.active.content, 'List report');
  controller.destroy(); controller.destroy();
  assert.equal(f.calls.active, null); assert.equal(f.map.handlerCount(), 0);
  controller.openAt([8, 9], 'After destroy');
  controller.register(marker, () => 'After destroy');
  assert.equal(f.calls.active, null); assert.equal(marker.handlerCount(), 0);
});

test('overview shows reports, proposed locations and selected boundary, then refits when filtering', () => {
  const f = fixture(); const handle = createAnalysisOverviewMap(f.L, f.container, { reportPopup: (r) => r.summary, candidatePopup: (c) => c.analysis.facilityType });
  const region = { bounds: [[1, 2], [8, 9]], geometry: { type: 'Polygon', coordinates: [] } };
  const reports = [
    { category: 'water', latitude: 1, longitude: 2, summary: 'Water issue' },
    { category: 'healthcare', latitude: 3, longitude: 4, summary: 'Clinic issue' },
    { category: 'water', latitude: null, longitude: null },
  ];
  const recommendations = [{ category: 'water', position: { latitude: 5, longitude: 6 }, analysis: { facilityType: 'Water station' }, locationRank: 2 }];
  handle.update({ region, reports, recommendations });
  assert.deepEqual(f.calls.fits.at(-1).points, [[1, 2], [3, 4], [5, 6]]);
  assert.equal(f.calls.geometry, region.geometry);
  f.calls.markers[0].fire('mouseover'); assert.equal(f.calls.active.content, 'Water issue');
  f.calls.markers[2].fire('click'); assert.equal(f.calls.active.content, 'Water station');
  handle.update({ region, reports, recommendations, category: 'healthcare' });
  assert.equal(f.calls.active, null); assert.deepEqual(f.calls.fits.at(-1).points, [[3, 4]]);
  assert.equal(f.calls.layers[0].members.length, 1); assert.equal(f.calls.layers[1].members.length, 0);
  assert.equal(f.calls.markers[0].handlerCount(), 0);
  handle.destroy(); handle.destroy(); assert.equal(f.calls.removed, 1); assert.equal(f.map.handlerCount(), 0);
});

test('empty overview falls back to selected region then worldwide without inventing report locations', () => {
  const f = fixture(); const handle = createAnalysisOverviewMap(f.L, f.container);
  const region = { bounds: [[1, 2], [8, 9]] };
  handle.update({ region, reports: [], reportsReady: false });
  assert.equal(f.calls.fits.at(-1).points, region.bounds); assert.equal(f.calls.markers.length, 0);
  handle.update({ region: { name: 'Worldwide' }, reports: [] });
  assert.deepEqual(f.calls.view, [[20, 0], 2]);
  handle.destroy();
});


test('explicit disposal releases hidden markers without Leaflet remove events, and replacement markers remain interactive', () => {
  const f = fixture();
  const controller = createMapPopups(f.L, f.map, { document: f.document });
  let dispose = () => {};
  for (let index = 0; index < 10; index++) {
    dispose();
    const marker = f.L.marker([index, index]);
    dispose = controller.register(marker, () => `Report ${index}`);
    marker.fire('mouseover').fire('click');
    assert.equal(f.calls.active.content, `Report ${index}`);
    for (const old of f.calls.markers.slice(0, -1)) assert.equal(old.handlerCount(), 0);
  }
  dispose(); dispose();
  assert.equal(f.calls.active, null);
  assert.ok(f.calls.markers.every((marker) => marker.handlerCount() === 0));
  const replacement = f.L.marker([1, 2]);
  controller.register(replacement, () => 'Visible again');
  replacement.fire('mouseover');
  assert.equal(f.calls.active.content, 'Visible again');
  replacement.fire('remove');
  assert.equal(f.calls.active, null);
  assert.equal(replacement.handlerCount(), 0);
  controller.destroy();
});


test('overview defers hidden fits and reveals the latest empty region once without resetting later user view', () => {
  const f = fixture({ width: 0, height: 0 });
  const handle = createAnalysisOverviewMap(f.L, f.container);
  handle.update({ region: { bounds: [[1, 2], [8, 9]] }, reports: [] });
  const americanSamoa = { name: 'American Samoa', bounds: [[-14.5, -171.2], [-11.0, -168.0]] };
  handle.update({ region: americanSamoa, reports: [], reportsReady: true });
  assert.equal(f.calls.fits.length, 0, 'Zero-sized map must not fit bounds');
  f.resize(800, 440);
  assert.equal(f.calls.fits.length, 1);
  assert.equal(f.calls.fits[0].points, americanSamoa.bounds);
  assert.equal(f.calls.fits[0].options.animate, false);
  f.resize(950, 440);
  assert.equal(f.calls.fits.length, 1, 'Ordinary resize must not reset the chosen map view');
  f.resize(0, 0);
  handle.update({ region: { bounds: [[20, 20], [25, 25]] }, reports: [] });
  handle.destroy(); f.resize(800, 440);
  assert.equal(f.calls.fits.length, 1, 'Destroyed map must discard pending fits');
  assert.equal(f.map.handlerCount(), 0);
});

test('a category without reports fits the whole selected region instead of stale report locations', () => {
  const f = fixture(); const handle = createAnalysisOverviewMap(f.L, f.container);
  const region = { bounds: [[-15, -172], [-10, -168]] };
  const reports = [{ category: 'water', latitude: -14, longitude: -170, summary: 'Water unavailable' }];
  handle.update({ region, reports });
  assert.deepEqual(f.calls.fits.at(-1).points, [[-14, -170]]);
  handle.update({ region, reports, category: 'healthcare' });
  assert.equal(f.calls.fits.at(-1).points, region.bounds);
  assert.equal(f.calls.layers[0].members.length, 0);
  handle.destroy();
});

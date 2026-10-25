import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { createMapPopups } from '../map-popups.js';
import { createAnalysisOverviewMap } from '../analysis-overview-map.js';
import { serviceIconSvg } from '../service-icons.js';

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
        update() { calls.popupUpdates = (calls.popupUpdates || 0) + 1; calls.updatedAutoPan = this.options.autoPan; return this; },
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

test('opted-in proposal hover stays stationary, then pinning enables padded auto-pan exactly once', () => {
  const f = fixture(); const controller = createMapPopups(f.L, f.map, { document: f.document });
  const first = f.L.marker([1, 2]), second = f.L.marker([3, 4]);
  controller.register(first, () => 'Group with several services', { autoPanOnPin: true });
  controller.register(second, () => 'Second location', { autoPanOnPin: true });
  first.fire('mouseover');
  const preview = f.calls.active;
  assert.equal(preview.options.autoPan, false, 'Hovering must not shift the map');
  assert.deepEqual(preview.options.autoPanPadding, [16, 16]);
  first.fire('click');
  assert.equal(f.calls.active, preview, 'Pinning preserves the current content and scroll position');
  assert.equal(f.calls.updatedAutoPan, true, 'The public update call must see auto-pan already enabled');
  assert.equal(f.calls.popupUpdates, 1);
  first.fire('click');
  assert.equal(f.calls.popupUpdates, 1, 'Repeated selection must not restart map movement');
  second.fire('click');
  assert.equal(f.calls.active.options.autoPan, true, 'Direct clicks also bring clipped details into view');
  assert.deepEqual(f.calls.active.options.autoPanPadding, [16, 16]);
  controller.openAt([5, 6], 'Explicit proposal', { autoPanOnPin: true });
  assert.equal(f.calls.active.options.autoPan, true);
  controller.destroy();
});

test('default report previews, pinned markers and report cards never trigger auto-pan', () => {
  const f = fixture(); const controller = createMapPopups(f.L, f.map, { document: f.document });
  const marker = f.L.marker([1, 2]);
  controller.register(marker, () => 'Community report');
  marker.fire('mouseover');
  assert.equal(f.calls.active.options.autoPan, false);
  marker.fire('click');
  assert.equal(f.calls.active.options.autoPan, false);
  assert.equal(f.calls.popupUpdates, undefined, 'Pinning a report must not initiate a map update');
  f.map.closePopup(); marker.fire('click');
  assert.equal(f.calls.active.options.autoPan, false, 'A direct report-marker click preserves the viewport');
  controller.openAt([5, 6], 'Report card');
  assert.equal(f.calls.active.options.autoPan, false, 'Report cards retain their explicit selected view');
  controller.destroy();
});

test('a pinned proposal blocked by world bounds is constrained without moving its geographic anchor', () => {
  const f = fixture(); const controller = createMapPopups(f.L, f.map, { document: f.document });
  const marker = f.L.marker([16, 147]);
  controller.register(marker, () => 'Grouped proposals', { autoPanOnPin: true });
  const rectangle = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  f.container.getBoundingClientRect = () => rectangle(355, 200, 1085, 700);
  const oldComputedStyle = f.window.getComputedStyle;
  f.window.getComputedStyle = (element) => ({ marginLeft: element.style.marginLeft, marginBottom: element.style.marginBottom });
  try {
    marker.fire('mouseover');
    const popup = f.calls.active;
    popup.element.style.marginLeft = '3px'; popup.element.style.marginBottom = '20px';
    const content = f.document.createElement('div'); content.className = 'leaflet-popup-content'; popup.element.append(content);
    let anchorLeft = 1153, anchorTop = 100;
    popup.element.getBoundingClientRect = () => rectangle(
      anchorLeft + (parseFloat(popup.element.style.marginLeft) || 0),
      anchorTop + 20 - (parseFloat(popup.element.style.marginBottom) || 0), 347, 350);
    f.map.fire('moveend');
    assert.equal(popup.element.style.marginLeft, '3px', 'A hover preview is never visually displaced');
    marker.fire('click');
    const constrained = popup.element.getBoundingClientRect();
    assert.equal(constrained.right, 1428, 'The close button and content stay12px inside the right map edge');
    assert.equal(constrained.top, 212);
    assert.equal(popup.element.classList.contains('needmap-popup-constrained'), true);
    assert.deepEqual(popup.point, [16, 147]); assert.deepEqual(marker.point, [16, 147]);
    assert.equal(f.calls.view, undefined); assert.equal(f.calls.fits.length, 0, 'Fallback adjusts only the popup box');
    f.map.fire('moveend').fire('zoomend');
    assert.deepEqual(popup.element.getBoundingClientRect(), constrained, 'Repeated world-bound events cannot accumulate offsets');
    anchorLeft = 600; anchorTop = 400; f.map.fire('resize');
    assert.equal(popup.element.style.marginLeft, '3px'); assert.equal(popup.element.style.marginBottom, '20px');
    assert.equal(popup.element.classList.contains('needmap-popup-constrained'), false, 'The original tip returns when the anchor fits');
    f.container.getBoundingClientRect = () => rectangle(355, 200, 500, 220);
    f.map.fire('resize');
    assert.equal(content.style.maxWidth, '420px'); assert.equal(content.style.maxHeight, '148px');
    controller.close();
    assert.equal(content.style.maxWidth, ''); assert.equal(content.style.maxHeight, '');
    assert.equal(popup.element.style.marginLeft, '3px'); assert.equal(popup.element.style.marginBottom, '20px');
  } finally {
    f.window.getComputedStyle = oldComputedStyle; controller.destroy();
  }
});

test('proposal size observers and map fallback handlers are released on close and destroy', () => {
  const f = fixture(); const oldObserver = f.window.ResizeObserver; const observers = [];
  f.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  };
  const controller = createMapPopups(f.L, f.map, { document: f.document });
  try {
    const report = f.L.marker([1, 2]), proposal = f.L.marker([3, 4]);
    controller.register(report, () => 'Report'); controller.register(proposal, () => 'Proposal', { autoPanOnPin: true });
    report.fire('click'); assert.equal(observers.length, 0, 'Report popups retain their existing behavior'); controller.close();
    proposal.fire('mouseover'); assert.equal(observers.length, 1);
    controller.close(); assert.equal(observers[0].disconnected, true);
    proposal.fire('click'); assert.equal(observers.length, 2);
    controller.destroy(); assert.equal(observers[1].disconnected, true); assert.equal(f.map.handlerCount(), 0);
    observers[1].callback(); assert.equal(f.calls.active, null);
  } finally { controller.destroy(); f.window.ResizeObserver = oldObserver; }
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
  const recommendations = [{ category: 'water', position: { latitude: 5, longitude: 6 }, analysis: { facilityType: 'Water station' }, locationRank: 2,
    evidenceMode: 'demonstration', demonstrationReportCount: 2 }];
  handle.update({ region, reports, recommendations });
  assert.deepEqual(f.calls.fits.at(-1).points, [[1, 2], [3, 4], [5, 6]]);
  assert.equal(f.calls.geometry, region.geometry);
  f.calls.markers[0].fire('mouseover'); assert.equal(f.calls.active.content, 'Water issue');
  f.calls.markers[2].fire('click'); assert.equal(f.calls.active.content, 'Water station');
  assert.equal(f.calls.markers[2].options.title, 'water · suggested location 2', 'Underlying provenance does not add a marker title label');
  handle.update({ region, reports, recommendations, category: 'healthcare' });
  assert.equal(f.calls.active, null); assert.deepEqual(f.calls.fits.at(-1).points, [[3, 4]]);
  assert.equal(f.calls.layers[0].members.length, 1); assert.equal(f.calls.layers[1].members.length, 0);
  assert.equal(f.calls.markers[0].handlerCount(), 0);
  handle.destroy(); handle.destroy(); assert.equal(f.calls.removed, 1); assert.equal(f.map.handlerCount(), 0);
});

test('overview keeps a report visible when a recommendation has the same coordinate', () => {
  const f = fixture();
  const handle = createAnalysisOverviewMap(f.L, f.container);
  handle.update({
    reports: [{ category: 'water', latitude: 1, longitude: 2, summary: 'Same point' }],
    recommendations: [{ category: 'water', position: { latitude: 1, longitude: 2 }, locationRank: 1 }],
  });
  const [report, recommendation] = f.calls.markers;
  assert.ok(recommendation.options.zIndexOffset > report.options.zIndexOffset);
  assert.deepEqual(recommendation.options.icon.iconAnchor, [18, 54]);
  assert.match(recommendation.options.icon.className, /separated-candidate-icon/);
  handle.destroy();
});

test('either overlapping report opens all reports at its exact point and category filtering removes hidden content', () => {
  const f = fixture();
  const handle = createAnalysisOverviewMap(f.L, f.container, { reportPopup: (report) => report.summary });
  const reports = [
    { category: 'water', latitude: 15.9255, longitude: 80.1855, summary: 'Local water issue' },
    { category: 'food', latitude: 15.9255, longitude: 80.1855, summary: 'Local food issue' },
    { category: 'water', latitude: 16.404333, longitude: 81.806039, summary: 'Remote water issue' },
  ];
  handle.update({ reports });
  assert.deepEqual(f.calls.markers.map((marker) => marker.point), reports.map((report) => [report.latitude, report.longitude]));
  for (const marker of f.calls.markers.slice(0, 2)) {
    f.map.closePopup();
    marker.fire('mouseover');
    assert.match(f.calls.active.content.textContent, /Local water issue/);
    assert.match(f.calls.active.content.textContent, /Local food issue/);
    assert.doesNotMatch(f.calls.active.content.textContent, /Remote/);
    marker.fire('click');
    assert.deepEqual(f.calls.active.point, [15.9255, 80.1855]);
  }
  handle.update({ reports, category: 'water' });
  assert.equal(f.calls.active, null);
  f.calls.layers[0].members[0].fire('click');
  assert.equal(f.calls.active.content, 'Local water issue');
  handle.destroy();
});

test('Analysis candidate icons use the same facility-specific symbol as the main map', () => {
  const f = fixture();
  const handle = createAnalysisOverviewMap(f.L, f.container);
  handle.update({ recommendations: [{ category: 'healthcare', position: { latitude: 1, longitude: 2 }, analysis: { facilityType: 'Pharmacy' } }] });
  assert.ok(f.calls.markers[0].options.icon.html.includes(serviceIconSvg('healthcare', 'Pharmacy')));
  handle.destroy();
});

test('Analysis groups colliding proposals, splits them on zoom, and removes filtered services from group popups', () => {
  const f = fixture();
  let scale = 1;
  f.map.latLngToContainerPoint = ([latitude, longitude]) => ({ x: longitude * scale, y: latitude * scale });
  const handle = createAnalysisOverviewMap(f.L, f.container, { candidatePopup: (candidate) => candidate.id });
  const recommendations = [
    { id: 'food', category: 'food', position: { latitude: 37.8, longitude: -122.4 } },
    { id: 'pharmacy', category: 'healthcare', position: { latitude: 37.9, longitude: -122.2 } },
  ];
  handle.update({ recommendations });
  assert.deepEqual(f.calls.fits.at(-1).points, [[37.8, -122.4], [37.9, -122.2]], 'Fitting still uses every precise calculated point');
  assert.equal(f.calls.layers[1].members.length, 1);
  const group = f.calls.layers[1].members[0];
  group.fire('click');
  assert.match(f.calls.active.content.textContent, /food/);
  assert.match(f.calls.active.content.textContent, /pharmacy/);
  scale = 1000; f.map.fire('zoomend');
  assert.equal(f.calls.layers[1].members.length, 2);
  assert.equal(group.handlerCount(), 0);
  handle.update({ recommendations, category: 'healthcare' });
  assert.equal(f.calls.layers[1].members.length, 1);
  f.calls.layers[1].members[0].fire('click');
  assert.equal(f.calls.active.content, 'pharmacy');
  handle.destroy(); assert.equal(f.map.handlerCount(), 0);
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

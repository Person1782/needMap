import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { createCandidateMarkerLayer, groupCandidateMarkers } from '../candidate-marker-layer.js';
import { createMapPopups } from '../map-popups.js';
import { REPORT_MARKER_Z_INDEX } from '../map-marker-layout.js';

const proposal = (id, latitude, longitude, category = 'healthcare') => ({
  id, category, position: { latitude, longitude }, locationRank: 1,
  analysis: { facilityType: 'Pharmacy' },
});
const worldwide = () => [
  proposal('california-1', 37.75, -122.4),
  proposal('california-2', 37.83, -122.27, 'food'),
  proposal('california-3', 37.92, -122.17, 'education'),
  proposal('tasmania', -42, 147),
  proposal('andhra', 16.2, 80.6, 'water'),
  proposal('russia', 55, 37),
];
const project = (scale) => ([latitude, longitude]) => ({ x: longitude * scale, y: latitude * scale });
const ids = (groups) => groups.map((group) => group.map((candidate) => candidate.id));

test('worldwide screen collisions group nearby services without dropping or moving any proposal', () => {
  const candidates = worldwide();
  const original = structuredClone(candidates);
  const groups = groupCandidateMarkers(candidates, project(3));
  assert.deepEqual(ids(groups), [
    ['andhra'], ['california-1', 'california-2', 'california-3'], ['russia'], ['tasmania'],
  ]);
  assert.deepEqual(new Set(groups.flat()), new Set(candidates), 'Every original proposal remains accessible');
  assert.deepEqual(candidates, original, 'Clustering must not alter placement calculations or coordinates');
  assert.deepEqual(ids(groupCandidateMarkers([...candidates].reverse(), project(3))), ids(groups), 'Input order cannot change a group anchor');
  assert.equal(groupCandidateMarkers(candidates, project(1000)).length, 6, 'Zoomed-in proposals separate once their icons no longer collide');
});

test('collision components include chained and exact-coordinate proposals, but reject invalid map points', () => {
  const candidates = [proposal('a', 0, 0), proposal('b', 0, 50), proposal('c', 0, 100), proposal('d', 0, 100)];
  assert.deepEqual(ids(groupCandidateMarkers(candidates, project(1))), [['a', 'b', 'c', 'd']]);
  const invalid = [proposal('bad-latitude', 90, 0), proposal('bad-longitude', 0, 181), { id: 'missing' }];
  assert.deepEqual(ids(groupCandidateMarkers([...candidates, ...invalid])), [['a'], ['b'], ['c'], ['d']], 'Missing projection safely preserves individual valid markers');
  assert.deepEqual(ids(groupCandidateMarkers(candidates, () => ({ x: NaN, y: 0 }))), [['a'], ['b'], ['c'], ['d']]);
});

function events(target = {}) {
  const handlers = new Map();
  return Object.assign(target, {
    on(types, callback) { for (const type of types.split(/\s+/)) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(callback); } return this; },
    off(types, callback) { for (const type of types.split(/\s+/)) handlers.get(type)?.delete(callback); return this; },
    fire(type, event = {}) { for (const callback of [...handlers.get(type) || []]) callback(event); return this; },
    handlerCount() { return [...handlers.values()].reduce((count, set) => count + set.size, 0); },
  });
}

function fixture() {
  const { document, window } = parseHTML('<html><body><div id="map"></div></body></html>');
  const container = document.querySelector('#map');
  const state = { scale: 3, markers: [], active: null };
  const map = events({
    getContainer: () => container,
    latLngToContainerPoint: (point) => project(state.scale)(point),
    closePopup(popup = state.active) {
      if (!popup) return;
      if (state.active === popup) state.active = null;
      popup.element.remove(); this.fire('popupclose', { popup });
    },
  });
  // Hidden Leaflet layer groups do not fire member removal events.
  const layer = { members: [], clearLayers() { this.members = []; } };
  const L = {
    divIcon: (options) => options,
    marker(point, options) {
      const marker = events({ point, options, getLatLng: () => point, addTo(target) { target.members.push(this); return this; } });
      state.markers.push(marker); return marker;
    },
    popup(options) {
      return {
        options, element: document.createElement('div'),
        setLatLng(point) { this.point = point; return this; },
        setContent(content) { this.content = content; if (typeof content !== 'string') this.element.append(content); return this; },
        openOn(target) { target.closePopup(); state.active = this; container.append(this.element); return this; },
        getElement() { return this.element; },
      };
    },
  };
  const popups = createMapPopups(L, map, { document });
  const controller = createCandidateMarkerLayer(L, map, {
    layer, popups, document,
    titleFor: (candidate) => candidate.id,
    groupTitleFor: (count) => `${count} localized proposals`,
    renderPopup(candidate) { const detail = document.createElement('p'); detail.textContent = candidate.id; return detail; },
  });
  return { document, window, map, layer, state, controller, popups };
}

test('group markers retain a member coordinate, stack above reports, and expose every service in one localized popup', () => {
  const f = fixture(); const candidates = worldwide();
  f.controller.update(candidates);
  assert.equal(f.layer.members.length, 4);
  const group = f.layer.members.find((marker) => marker.options.title === '3 localized proposals');
  assert.deepEqual(group.point, [37.75, -122.4], 'Group anchor is an actual proposal, never a new midpoint');
  assert.ok(group.options.zIndexOffset > REPORT_MARKER_Z_INDEX);
  assert.equal(group.options.keyboard, true);
  assert.match(group.options.icon.html, /×3/);
  assert.match(group.options.icon.className, /candidate-group-icon/);
  group.fire('mouseover');
  assert.equal(f.state.active.options.autoPan, false);
  const content = f.state.active.content;
  assert.equal(content.getAttribute('aria-label'), '3 localized proposals');
  assert.equal(content.getAttribute('role'), 'region');
  assert.equal(content.getAttribute('tabindex'), '0');
  assert.deepEqual([...content.querySelectorAll('section')].map((section) => section.textContent), ['california-1', 'california-2', 'california-3']);
  group.fire('click');
  assert.equal(f.state.active.options.autoPan, true, 'Selecting a group brings every service detail into view');
  f.layer.members[0].fire('mouseover');
  assert.equal(f.state.active.content, content, 'An unrelated hover cannot replace the pinned group');
  f.controller.destroy(); f.popups.destroy();
});

test('zoom splits groups, ordinary pan preserves a pinned popup, and resize can merge them again', () => {
  const f = fixture(); f.controller.update(worldwide());
  const group = f.layer.members.find((marker) => marker.options.title === '3 localized proposals');
  group.fire('click'); const pinned = f.state.active;
  f.map.fire('moveend');
  assert.equal(f.state.active, pinned);
  assert.equal(f.state.markers.length, 4, 'Panning without membership changes must not rebuild markers');
  f.state.scale = 1000; f.map.fire('zoomend');
  assert.equal(f.layer.members.length, 6);
  assert.equal(f.state.active, null, 'The obsolete group popup is released after splitting');
  assert.equal(group.handlerCount(), 0);
  for (const marker of f.layer.members) {
    const original = worldwide().find((candidate) => candidate.id === marker.options.title);
    assert.deepEqual(marker.point, [original.position.latitude, original.position.longitude]);
    marker.fire('click'); assert.equal(f.state.active.content.textContent, original.id);
    assert.equal(f.state.active.options.autoPan, true, 'Individual proposals also opt in to readable pinned placement');
  }
  f.state.scale = 3; f.map.fire('resize');
  assert.equal(f.layer.members.length, 4);
  f.controller.destroy(); f.popups.destroy();
});

test('updates dispose hidden-layer registrations and destroy removes every viewport listener', () => {
  const f = fixture(); f.controller.update(worldwide());
  const old = [...f.layer.members]; old[0].fire('click');
  f.controller.update([worldwide()[0]]);
  assert.equal(f.state.active, null);
  assert.ok(old.every((marker) => marker.handlerCount() === 0));
  f.layer.members[0].fire('mouseover'); assert.equal(f.state.active.content.textContent, 'california-1');
  f.controller.destroy(); f.controller.destroy();
  assert.equal(f.state.active, null);
  assert.equal(f.layer.members.length, 0);
  assert.ok(f.state.markers.every((marker) => marker.handlerCount() === 0));
  assert.equal(f.map.handlerCount(), 5, 'Only the independent popup controller listeners remain');
  f.controller.update(worldwide()); f.map.fire('zoomend').fire('resize').fire('moveend');
  assert.equal(f.layer.members.length, 0);
  f.popups.destroy(); assert.equal(f.map.handlerCount(), 0);
});

test('a shared proposal popup scrolls without bubbling scroll keys or wheel events to the map', () => {
  const f = fixture(); f.controller.update(worldwide());
  f.layer.members.find((marker) => marker.options.title === '3 localized proposals').fire('click');
  const content = f.state.active.content;
  let wheel = 0, keys = 0;
  f.document.body.addEventListener('wheel', () => wheel++);
  f.document.body.addEventListener('keydown', () => keys++);
  const wheelEvent = new f.window.Event('wheel', { bubbles: true, cancelable: true });
  content.querySelector('p').dispatchEvent(wheelEvent);
  assert.equal(wheel, 0); assert.equal(wheelEvent.defaultPrevented, false);
  const key = new f.window.Event('keydown', { bubbles: true, cancelable: true }); key.key = 'PageDown';
  content.dispatchEvent(key);
  assert.equal(keys, 0); assert.equal(key.defaultPrevented, false);
  const tab = new f.window.Event('keydown', { bubbles: true }); tab.key = 'Tab'; content.dispatchEvent(tab);
  assert.equal(keys, 1, 'Keyboard navigation must still leave the popup');
  f.controller.destroy(); f.popups.destroy();
});

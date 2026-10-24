import test from 'node:test';
import assert from 'node:assert/strict';
import { context } from './test-helpers.js';
const adaptive = context().NeedMapAdaptive;

test('uses effective connection conditions, data saving and device hints rather than Wi-Fi labels', () => {
  for (const connection of [{ effectiveType: 'slow-2g' }, { effectiveType: '2g' }, { effectiveType: '3g' }, { downlink: 0.5, type: 'wifi' }, { rtt: 600 }, { saveData: true }]) {
    assert.equal(adaptive.detect({ connection }).slow, true);
  }
  for (const hints of [{ deviceMemory: 1 }, { hardwareConcurrency: 2 }, { onLine: false }]) assert.equal(adaptive.detect(hints).slow, true);
  assert.equal(adaptive.detect({ connection: { type: 'cellular', effectiveType: '4g', downlink: 10, rtt: 50 } }).slow, false);
});

test('missing, malformed or restricted optional hints do not break a complete form', () => {
  for (const hints of [{}, { connection: {} }, { connection: { downlink: 0, rtt: NaN }, deviceMemory: -1, hardwareConcurrency: '2' }]) assert.equal(adaptive.detect(hints).slow, false);
  assert.equal(adaptive.detect({}, { getEntriesByType() { throw new Error('unavailable'); } }).slow, false);
  assert.equal(adaptive.detect(null).slow, false);
  assert.equal(adaptive.detect({}, null, true).slow, true);
});

test('uses already-downloaded page and script timings with legacy fallback', () => {
  assert.equal(adaptive.detect({}, { getEntriesByType: type => type === 'navigation' ? [{ fetchStart: 5, responseEnd: 3000 }] : [] }).slow, true);
  assert.equal(adaptive.detect({}, { getEntriesByType: type => type === 'resource' ? [{ initiatorType: 'script', duration: 3500 }] : [] }).slow, true);
  assert.equal(adaptive.detect({}, { timing: { fetchStart: 1700000000000, responseEnd: 1700000004000 } }).slow, true);
  assert.equal(adaptive.detect({}, { timing: { fetchStart: 1700000000000, responseEnd: 0 } }).slow, false);
});

test('map links preserve configured deployment and only translate known local app ports', () => {
  const local = { hostname: 'localhost', host: 'localhost:5173', port: '5173', protocol: 'http:' };
  assert.equal(adaptive.mapUrl('/map/', local), 'http://localhost:5174/');
  assert.equal(adaptive.mapUrl('/map/', { ...local, port: '4173', host: 'localhost:4173' }), 'http://localhost:4174/');
  assert.equal(adaptive.mapUrl('https://map.example.org/', local), 'https://map.example.org/');
  assert.equal(adaptive.mapUrl('/map/', { ...local, hostname: 'needmap.org' }), '/map/');
});

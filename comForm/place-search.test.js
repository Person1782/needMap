import test from 'node:test';
import assert from 'node:assert/strict';
import { context } from './test-helpers.js';
const ctx = context();
test('searches encode queries, cache repeated input, throttle requests and round locations', () => {
  let now = 10000; const requests = [];
  const search = ctx.NeedMapPlaceSearch('https://places.test/search', (...args) => { const done = args.pop(); requests.push(args); done(null, [{ lat: '40.123456', lon: '-70.234567', display_name: 'Town' }]); }, () => now);
  search('Town & country', (error, places) => { assert.equal(error, null); assert.equal(places[0].location.latitude, 40.122); });
  assert.match(requests[0][1], /limit=3/); assert.match(requests[0][1], /q=Town%20%26%20country/);
  search('town & country', error => assert.equal(error, null)); assert.equal(requests.length, 1);
  search('Different place', error => assert.match(error.message, /wait/)); now += 1200;
  search('Different place', error => assert.equal(error, null)); assert.equal(requests.length, 2);
});
test('malformed results and invalid coordinates cannot be selected', () => {
  for (const response of [null, {}, [{ lat: '', lon: '', display_name: 'Missing' }], [{ lat: '91', lon: '0', display_name: 'Invalid' }]]) {
    const search = ctx.NeedMapPlaceSearch('/places', (_m, _u, _b, _t, done) => done(null, response)); search('Town', (error, places) => assert.ok(error || places.length === 0));
  }
});
test('bad input makes no network request and network failures offer device location', () => {
  let requests = 0; const search = ctx.NeedMapPlaceSearch('/places', (_m, _u, _b, _t, done) => { requests++; done(new Error('offline')); });
  search('x', error => assert.match(error.message, /at least 3/)); assert.equal(requests, 0);
  search('Town', error => assert.match(error.message, /device location/)); assert.equal(requests, 1);
});

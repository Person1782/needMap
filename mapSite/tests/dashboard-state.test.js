import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalizeReport, filterReports, reportSnapshotKey } from '../dashboard-state.js';

const report = (id, fields = {}) => ({ id, latitude: 37, longitude: -122, category: 'water', severity: 'high', summary: 'Water access needed', region: { name: 'Fremont' }, ...fields });
test('incoming invalid coordinates do not become map reports at zero', () => {
  for (const value of [null, undefined, '', ' ', [], false, NaN, 100]) assert.equal(normalizeReport('bad', { latitude: value, longitude: 1 }), null);
  assert.equal(normalizeReport('zero', { latitude: 0, longitude: '0', severity: 'bogus' }).severity, 'unknown');
});
test('search, category, urgency, and viewport filters combine without altering reports', () => {
  const reports = [report('a'), report('b', { severity: 'low' }), report('c', { region: { name: 'Nairobi' } }), report('d', { category: 'healthcare' })];
  assert.deepEqual(filterReports(reports, { query: 'fremont', category: 'water', urgency: 'high', contains: r => r.longitude < 0 }).map(r => r.id), ['a']);
  assert.equal(filterReports(reports, { query: 'no match' }).length, 0);
  assert.equal(reports.length, 4);
  assert.equal(reportSnapshotKey(reports), reportSnapshotKey([...reports].reverse()));
  assert.notEqual(reportSnapshotKey(reports), reportSnapshotKey([report('a', { summary: 'Changed need' })]));
});
test('map and analysis share region navigation without legacy planner or estimate controls', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="plan-view"/);
  assert.match(html, /id="analysis-view"/);
  assert.match(html, /id="analysis-category"/);
  assert.match(html, /id="explore-view"/);
  assert.doesNotMatch(html, /service-plans|planning-workspace|cost and impact|estimates|refresh-analysis/);
  assert.match(html, /id="change-region"/);
  assert.match(html, /id="region-search"/);
});
test('dashboard hooks resolve and removed staff/alert/confidence interfaces are absent', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of app.matchAll(/\$\("#([^"]+)"\)/g)) assert.ok(ids.includes(id), `Missing DOM hook ${id}`);
  for (const [, target] of html.matchAll(/aria-controls="([^"]+)"/g)) assert.ok(ids.includes(target));
  assert.doesNotMatch(html + app, /staff-dialog|alerts-dialog|local-demo-button|notification-button|decision-workspace\.js|% confidence/);
});

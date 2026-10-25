import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { createReportLocationPopups } from '../report-location-popups.js';

test('coincident reports share their content without merging nearby coordinates or changing reports', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const water = { latitude: 15.9255, longitude: 80.1855, summary: 'Water is unavailable' };
  const food = { ...water, summary: 'Food is unavailable' };
  const nearby = { ...water, longitude: 80.185501, summary: 'Nearby separate report' };
  const remote = { latitude: 16.404333, longitude: 81.806039, summary: 'Remote water report' };
  const reports = [water, food, nearby, remote];
  const before = structuredClone(reports);
  const render = (report) => { const node = document.createElement('section'); node.textContent = report.summary; return node; };
  const popup = createReportLocationPopups(reports, render, { document, groupLabel: (count) => `${count} reports` });
  const content = popup(food);
  assert.equal(content.getAttribute('aria-label'), '2 reports');
  assert.deepEqual([...content.querySelectorAll('section')].map((node) => node.textContent), [food.summary, water.summary]);
  assert.doesNotMatch(content.textContent, /Nearby|Remote/);
  assert.equal(popup(nearby).textContent, nearby.summary);
  assert.equal(popup(remote).textContent, remote.summary);
  assert.deepEqual(reports, before);
});

test('single-report callbacks retain their return values and filtered groups omit hidden reports', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const water = { latitude: 1, longitude: 2, summary: '<script>not HTML</script>' };
  const food = { ...water, summary: 'Food issue' };
  const render = (report) => report.summary;
  assert.equal(createReportLocationPopups([water], render, { document })(water), water.summary);
  const combined = createReportLocationPopups([water, food], render, { document })(water);
  assert.equal(combined.querySelector('script'), null);
  assert.ok(combined.textContent.includes(water.summary));
  assert.equal(createReportLocationPopups([food], render, { document })(food), food.summary);
});

test('shared report details scroll without sending wheel or navigation keys to the map', () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  const water = { latitude: 1, longitude: 2, summary: 'Water issue' };
  const food = { ...water, summary: 'Food issue' };
  const content = createReportLocationPopups([water, food], (report) => report.summary, { document })(water);
  document.body.append(content);
  let propagated = 0;
  document.body.addEventListener('wheel', () => propagated++);
  document.body.addEventListener('keydown', () => propagated++);
  content.dispatchEvent(new window.Event('wheel', { bubbles: true }));
  const down = new window.Event('keydown', { bubbles: true }); down.key = 'PageDown';
  content.dispatchEvent(down);
  assert.equal(propagated, 0);
  assert.equal(down.defaultPrevented, false, 'Native scrolling remains available');
  const escape = new window.Event('keydown', { bubbles: true }); escape.key = 'Escape';
  content.dispatchEvent(escape);
  assert.equal(propagated, 1, 'Other keys retain normal popup behavior');
  assert.equal(content.style.overflowY, 'auto');
  assert.equal(content.getAttribute('tabindex'), '0');
});

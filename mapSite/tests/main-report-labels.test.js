import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { createReportLocationPopups } from '../report-location-popups.js';
import { SUPPORTED_LANGUAGES } from '../i18n/index.js';
import en from '../i18n/locales/en.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
// Exercise the actual entry-point renderers without starting Firebase or maps.
const popupSource = app.slice(app.indexOf('function reportPopup('), app.indexOf('function selectedReports('));
const reportsSource = app.slice(app.indexOf('function renderReports('), app.indexOf('function refreshCategories('));
const demo = { id: 'demo', category: 'water', severity: 'low', summary: 'Sample water report', isSynthetic: true, latitude: 45, longitude: -75, region: { name: 'Canada' } };
const real = { ...demo, id: 'real', category: 'food', summary: 'Community food report', isSynthetic: false, longitude: -76 };

function fixture(reports, messages = en, code = 'en') {
  const { document, window } = parseHTML('<html><body><span id="report-count"></span><span id="urgent-count"></span><p id="report-scope"></p><div id="reports"></div></body></html>');
  let selected = reports;
  const calls = { markers: [], translatedKeys: [] };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const i18n = {
    code, number: (value) => new Intl.NumberFormat(code).format(value),
    t(key, values = {}) {
      calls.translatedKeys.push(key);
      return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), messages[key] || key);
    },
  };
  const layer = { clearLayers() {} };
  const context = {
    document, i18n, element,
    iconElement: () => element('span'),
    label: (value) => messages[`category.${value}`] || messages[`urgency.${value}`] || value,
    translatedText(node, text) { node.textContent = text; return node; },
    translatedTemplate(node, text, token, replacement) { node.textContent = text.replaceAll(token, replacement); },
    createReportLocationPopups,
    selectedReports: () => selected, regionReports: () => reports,
    $: (selector) => document.querySelector(selector),
    selectedRegion: { name: 'Canada' }, viewport: { checked: false }, resolving: false, reportsReady: true,
    reportList: document.querySelector('#reports'), reportPopupDisposers: [], reportsLayer: layer,
    colors: { low: '#2f8a69' }, serviceIconSvg: () => '', REPORT_MARKER_Z_INDEX: 1000,
    L: {
      divIcon: (options) => options,
      marker(point, options) { const marker = { point: [...point], options, addTo() { return this; } }; calls.markers.push(marker); return marker; },
    },
    map: { setView(point, zoom) { calls.view = [[...point], zoom]; } },
    mapPopups: {
      register(marker, content) { marker.content = content; return () => {}; },
      openAt(point, content) { calls.popup = { point: [...point], content: typeof content === 'function' ? content() : content }; },
    },
  };
  vm.runInNewContext(`${popupSource}\n${reportsSource}\nthis.render = renderReports; this.popup = reportPopup;`, context);
  return { document, window, calls, i18n, render: context.render, popup: context.popup, select(value) { selected = value; } };
}

test('main map renders ordinary report text for both flag values without changing source metadata', () => {
  const reports = [demo, real]; const before = structuredClone(reports);
  const f = fixture(reports); f.render();
  const cards = [...f.document.querySelectorAll('.report-card')];
  for (const [index, report] of reports.entries()) {
    assert.equal(cards[index].querySelector('strong').textContent, en[`category.${report.category}`]);
    assert.equal(f.calls.markers[index].options.title, f.i18n.t('map.reportTitle', { category: en[`category.${report.category}`], urgency: en[`urgency.${report.severity}`] }));
    const popup = f.popup(report);
    assert.equal(popup.querySelector('strong').textContent, en[`category.${report.category}`]);
    assert.equal(popup.querySelectorAll('p').length, 1);
    assert.equal(popup.querySelector('p').textContent, report.summary);
    assert.doesNotMatch(popup.textContent + cards[index].textContent, /demo(?:nstration)?|synthetic/i);
  }
  assert.equal(f.document.querySelector('#report-scope').textContent, `${f.i18n.t('explore.scope', { shown: 2, total: 2, region: 'Canada' })}.`);
  assert.equal(f.document.querySelector('#report-count').textContent, '2', 'All source reports remain visible and counted');
  f.select([real]); f.render();
  assert.equal(f.document.querySelector('#report-scope').textContent, `${f.i18n.t('explore.scope', { shown: 1, total: 2, region: 'Canada' })}.`);
  assert.deepEqual(reports, before, 'Rendering never rewrites isSynthetic or other source fields');
});

test('clicking a flagged report preserves coordinates and shared popups retain every coincident report without added labels', () => {
  const coincident = { ...real, longitude: demo.longitude };
  const f = fixture([demo, coincident]); f.render();
  f.document.querySelector('.report-card').dispatchEvent(new f.window.Event('click'));
  assert.deepEqual(f.calls.view, [[45, -75], 14]);
  assert.deepEqual(f.calls.popup.point, [45, -75]);
  const details = [...f.calls.popup.content.querySelectorAll('.report-popup')];
  assert.equal(details.length, 2);
  assert.ok(details[0].textContent.includes(demo.summary));
  assert.equal(details[0].querySelector('strong').textContent, en['category.water']);
  assert.ok(details[1].textContent.includes(real.summary));
  assert.equal(details[1].querySelector('strong').textContent, en['category.food']);
  assert.doesNotMatch(f.calls.popup.content.textContent, /demo(?:nstration)?|synthetic/i);
  assert.equal(f.calls.markers[0].content().querySelectorAll('.report-popup').length, 2, 'Marker hover and card clicks retain the same shared-report behavior');
});

test('all18 locales use ordinary report labels, marker titles and scope regardless of the stored flag', async () => {
  for (const { code } of SUPPORTED_LANGUAGES) {
    const { default: messages } = await import(`../i18n/locales/${code}.js`);
    const f = fixture([demo], messages, code); f.render();
    const popup = f.popup(demo);
    assert.equal(f.document.querySelector('.report-card strong').textContent, messages['category.water'], `${code} normal card label`);
    assert.equal(f.calls.markers[0].options.title, f.i18n.t('map.reportTitle', { category: messages['category.water'], urgency: messages['urgency.low'] }), `${code} normal marker title`);
    assert.equal(popup.querySelector('strong').textContent, messages['category.water'], `${code} normal popup heading`);
    assert.equal(popup.textContent, f.popup({ ...demo, isSynthetic: false }).textContent, `${code} flag does not alter visible popup text`);
    assert.equal(f.document.querySelector('#report-scope').textContent, `${f.i18n.t('explore.scope', { shown: f.i18n.number(1), total: f.i18n.number(1), region: 'Canada' })}.`, `${code} normal report scope`);
    for (const key of ['analysis.demoReport', 'analysis.demoWarning', 'analysis.demoIncluded']) {
      assert.ok(!f.calls.translatedKeys.includes(key), `${code} does not render ${key}`);
    }
    assert.doesNotMatch(f.document.body.textContent + popup.textContent, /demo(?:nstration)?|synthetic/i);
  }
});

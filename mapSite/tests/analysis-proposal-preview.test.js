import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { buildRecommendationsForRegion } from '../analysis.js';
import { SUPPORTED_LANGUAGES } from '../i18n/index.js';
import en from '../i18n/locales/en.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const entrySource = (start, end) => {
  const first = app.indexOf(start), last = app.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Expected app entry point: ${start}`);
  return app.slice(first, last);
};
const stateSource = entrySource('let recommendations =', 'let selectedRegion =');
const popupSource = entrySource('function candidatePopup(', 'function renderCandidates(');
const updateSource = entrySource('function renderCandidates(', 'async function refreshWorldwideAnalyses(');
const analysisSource = entrySource('function updateAnalysis(', 'const plansWorkspace =');
const toggleBody = app.match(/onDemonstrationReportsChange\(value\)\s*\{([^}]+)\}/)?.[1];
assert.ok(toggleBody, 'Analysis must wire its demonstration toggle to the app state');

const region = {
  id: 'CA', name: 'Canada', kind: 'country', countryCode: 'CA',
  geometry: { type: 'Polygon', coordinates: [[[-90, 40], [-60, 40], [-60, 60], [-90, 60], [-90, 40]]] },
};
const report = (id, longitude, isSynthetic) => ({
  id, category: 'water', severity: 'low', summary: 'Water is unavailable',
  latitude: 45, longitude, region, isSynthetic,
});

function fixture(reports, messages = en, code = 'en') {
  const { document } = parseHTML('<html><body><p id="candidate-status"></p></body></html>');
  const calls = { rendered: [], analyses: [], plans: 0, translatedKeys: [] };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const i18n = {
    number: (value) => Number(value).toLocaleString(code),
    t(key, values = {}) {
      calls.translatedKeys.push(key);
      return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, typeof value === 'number' ? value.toLocaleString(code) : value), messages[key] || key);
    },
  };
  const context = {
    document, element, i18n, reports, selectedRegion: region, buildRecommendationsForRegion,
    worldwideAnalysisRegions: [], worldwideAnalysisState: 'ready', resolving: false, connectionFailed: false, reportsReady: true,
    $: (selector) => document.querySelector(selector),
    candidateMarkers: { update(candidates) { calls.rendered.push(candidates); } },
    analysisWorkspace: { update(value) { calls.analyses.push(value); } },
    updatePlans() { calls.plans++; }, regionReports: () => reports,
    loadingBar: { set() {} }, iconElement: () => element('span'),
    label: (value) => messages[`category.${value}`] || value,
    facilityLabel: (value) => value,
    translatedTemplate(node, text, marker, replacement) { node.textContent = text.replaceAll(marker, replacement); },
  };
  // Execute the actual app state, entry functions, and checkbox callback while
  // keeping Firebase, map creation and unrelated startup outside this fixture.
  vm.runInNewContext(`${stateSource}\n${popupSource}\n${updateSource}\n${analysisSource}
    this.update = updateCandidates;
    this.popup = candidatePopup;
    this.toggle = function(value) { ${toggleBody} };
    this.state = () => ({ main: recommendations, analysis: analysisRecommendations, includeDemonstrations: analysisIncludesDemonstrations });`, context);
  return { document, calls, i18n, update: context.update, popup: context.popup, toggle: context.toggle, state: context.state };
}

test('two flagged reports produce the same proposal in Map and Analysis by default while preserving their metadata', () => {
  const reports = [report('demo-a', -75, true), report('demo-b', -75.1, true)];
  const before = structuredClone(reports);
  const f = fixture(reports); f.update();
  assert.equal(f.state().includeDemonstrations, true);
  assert.equal(f.state().main.length, 1);
  assert.deepEqual(f.calls.rendered.at(-1), f.state().analysis, 'The main marker layer receives the same proposals as Analysis');
  assert.equal(f.state().analysis.length, 1);
  assert.deepEqual(f.state().analysis, f.state().main);
  const candidate = f.state().analysis[0];
  assert.equal(candidate.evidenceMode, 'demonstration');
  assert.equal(candidate.demonstrationReportCount, 2);
  assert.equal(f.calls.analyses.at(-1).recommendations, f.state().analysis);
  assert.equal(f.calls.analyses.at(-1).includeDemonstrationReports, true);
  const popup = f.popup(candidate);
  assert.equal(popup.querySelector('.demonstration-proposal-label'), null);
  assert.match(popup.textContent, /Local demand and site suitability still need verification/);
  assert.doesNotMatch(popup.textContent, /demo(?:nstration)?|synthetic|indicate repeated demand/i);
  assert.ok(candidate.signals.every((item) => item.isSynthetic === true));
  assert.deepEqual(reports, before, 'Proposal generation does not change source report flags or evidence');
});

test('the existing Analysis toggle filters only Analysis while Map retains all proposals and reports remain unchanged', () => {
  const reports = [report('demo-a', -75, true), report('demo-b', -75.1, true)];
  const before = structuredClone(reports);
  const f = fixture(reports); f.update(); const mainBefore = f.state().main; f.toggle(false);
  assert.equal(f.state().includeDemonstrations, false);
  assert.deepEqual(f.state().main, mainBefore); assert.equal(f.state().analysis.length, 0);
  const analysis = f.calls.analyses.at(-1);
  assert.equal(analysis.includeDemonstrationReports, false);
  assert.equal(analysis.recommendations.length, 0);
  assert.equal(analysis.reports, reports, 'The toggle controls proposed services, not visible report data');
  assert.deepEqual(f.calls.rendered.at(-1), mainBefore);
  f.toggle(true);
  assert.equal(f.state().analysis.length, 1, 'The same proposal can be restored with the existing control');
  assert.deepEqual(f.state().analysis, f.state().main);
  assert.deepEqual(reports, before);
});

test('two real reports produce the same community proposal in both views without demonstration labels', () => {
  const f = fixture([report('real-a', -75, false), report('real-b', -75.1, false)]); f.update();
  assert.equal(f.state().main.length, 1); assert.deepEqual(f.state().analysis, f.state().main);
  assert.equal(f.state().main[0].evidenceMode, 'community');
  const popup = f.popup(f.state().analysis[0]);
  assert.equal(popup.querySelector('.demonstration-proposal-label'), null);
  assert.ok(!popup.textContent.includes(en['candidate.demonstrationTitle']));
  assert.match(popup.textContent, /are grouped for this proposed/);
  assert.match(popup.textContent, /Local demand and site suitability still need verification/);
  assert.doesNotMatch(popup.textContent, /indicate repeated demand/);
  f.toggle(false);
  assert.equal(f.state().main.length, 1); assert.deepEqual(f.state().analysis, f.state().main);
});

test('mixed evidence uses the same neutral rationale without changing its stored flags or claiming verified demand', () => {
  const f = fixture([report('real-a', -75, false), report('real-b', -75.1, false), report('demo', -75.05, true)]); f.update();
  assert.equal(f.state().main.length, 1); assert.equal(f.state().analysis.length, 1);
  assert.equal(f.state().main[0].signals.length, 3);
  assert.deepEqual(f.state().main, f.state().analysis);
  const preview = f.state().analysis[0];
  assert.equal(preview.signals.length, 3); assert.equal(preview.demonstrationReportCount, 1);
  f.calls.translatedKeys.length = 0;
  const popup = f.popup(preview);
  assert.equal(popup.querySelector('.demonstration-proposal-label'), null);
  assert.ok(f.calls.translatedKeys.includes('candidate.rationale'), 'All proposals use the neutral grouped-report rationale');
  assert.match(popup.textContent, /Local demand and site suitability still need verification/);
  assert.doesNotMatch(popup.textContent, /demo(?:nstration)?|synthetic|indicate repeated demand/i);
  f.toggle(false);
  assert.equal(f.state().main[0].signals.length, 3);
  assert.equal(f.state().analysis[0].signals.length, 2, 'The preserved Analysis filter still excludes flagged support when off');
});

test('all18 locales render neutral proposal copy without demonstration labels for flagged reports', async () => {
  for (const { code } of SUPPORTED_LANGUAGES) {
    const { default: messages } = await import(`../i18n/locales/${code}.js`);
    const f = fixture([report('demo-a', -75, true), report('demo-b', -75.1, true)], messages, code); f.update();
    const candidate = f.state().main[0];
    const popup = f.popup(candidate);
    assert.equal(popup.querySelector('.demonstration-proposal-label'), null, code);
    assert.equal(popup.querySelectorAll('p')[1].textContent, f.i18n.t('candidate.rationale', {
      count: 2, category: messages['category.water'], region: region.name, service: candidate.analysis.facilityType,
    }), `${code} neutral grouped-report rationale`);
    for (const key of ['analysis.demoWarning', 'candidate.demonstrationTitle', 'candidate.demonstrationNotice']) {
      assert.ok(!f.calls.translatedKeys.includes(key), `${code} does not render ${key}`);
    }
    assert.doesNotMatch(f.document.body.textContent + popup.textContent, /demo(?:nstration)?|synthetic/i, code);
    assert.deepEqual(f.state().analysis, f.state().main, `${code} Map and Analysis proposals agree`);
  }
});

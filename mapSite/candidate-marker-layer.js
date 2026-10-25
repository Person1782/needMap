import { serviceIconSvg } from './service-icons.js';
import { getReportCoordinates } from './report-location-map.js';
import { CANDIDATE_MARKER_Z_INDEX, separatedCandidateIconOptions } from './map-marker-layout.js';

// Include the icon, count/rank badge and stem, plus a small pointer gap. These
// are screen pixels, never a geographic support radius or a placement rule.
const FOOTPRINT_WIDTH = 56;
const FOOTPRINT_HEIGHT = 72;
const candidateKey = (candidate) => JSON.stringify([
  candidate.id || '', candidate.category || '', candidate.position?.latitude, candidate.position?.longitude,
]);

export function groupCandidateMarkers(candidates, project) {
  const entries = candidates.filter((candidate) => getReportCoordinates(candidate.position))
    .map((candidate) => ({ candidate, point: project?.(getReportCoordinates(candidate.position)) }))
    .sort((first, second) => candidateKey(first.candidate).localeCompare(candidateKey(second.candidate)));
  const parents = entries.map((_, index) => index);
  function root(index) {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  }
  const cells = new Map();
  entries.forEach(({ point }, index) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    const x = Math.floor(point.x / FOOTPRINT_WIDTH), y = Math.floor(point.y / FOOTPRINT_HEIGHT);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const neighbor of cells.get(`${x + dx}:${y + dy}`) || []) {
        const other = entries[neighbor].point;
        if (Math.abs(point.x - other.x) < FOOTPRINT_WIDTH && Math.abs(point.y - other.y) < FOOTPRINT_HEIGHT) {
          parents[root(index)] = root(neighbor);
        }
      }
    }
    const key = `${x}:${y}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(index);
  });
  const groups = new Map();
  entries.forEach(({ candidate }, index) => {
    const key = root(index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  });
  return [...groups.values()];
}

/** Visual groups retain every proposal and anchor at an actual member point. */
export function createCandidateMarkerLayer(L, map, {
  layer, popups, renderPopup, titleFor, groupTitleFor, document = map.getContainer().ownerDocument,
} = {}) {
  let candidates = [];
  let disposers = [];
  let signature = '';
  let destroyed = false;
  const groupTitle = (group) => groupTitleFor?.(group.length) || `${group.length} proposed service locations`;
  function popupFor(group) {
    if (group.length === 1) return renderPopup(group[0]);
    const content = document.createElement('div');
    // Reuse the existing popup-list wheel and keyboard behavior.
    content.className = 'report-location-popup candidate-group-popup';
    content.tabIndex = 0;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-label', groupTitle(group));
    const heading = document.createElement('strong');
    heading.className = 'candidate-group-heading';
    heading.textContent = groupTitle(group);
    content.append(heading);
    for (const candidate of group) {
      const section = document.createElement('section');
      const detail = renderPopup(candidate);
      if (typeof detail === 'string') section.textContent = detail;
      else section.append(detail);
      content.append(section);
    }
    content.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    content.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) event.stopPropagation();
    });
    return content;
  }
  function clear() {
    for (const dispose of disposers) dispose();
    disposers = [];
    layer.clearLayers();
  }
  function render(force = false) {
    if (destroyed) return;
    const groups = groupCandidateMarkers(candidates, (point) => map.latLngToContainerPoint?.(point));
    const nextSignature = JSON.stringify(groups.map((group) => group.map(candidateKey)));
    if (!force && nextSignature === signature) return;
    clear();
    signature = nextSignature;
    for (const group of groups) {
      const candidate = group[0];
      const rank = [1, 2, 3].includes(candidate.locationRank) ? candidate.locationRank : 1;
      const grouped = group.length > 1;
      const symbols = [...new Set(group.map((item) => serviceIconSvg(item.category, item.analysis?.facilityType)))].slice(0, 2).join('');
      const html = grouped
        ? `<span class="candidate-marker candidate-group-marker" aria-hidden="true">${symbols}<b>×${group.length}</b></span>`
        : `<span class="candidate-marker" aria-hidden="true">${serviceIconSvg(candidate.category, candidate.analysis?.facilityType)}<b>${rank}</b></span>`;
      const icon = L.divIcon(separatedCandidateIconOptions(html, { size: grouped ? 40 : 36, className: grouped ? 'candidate-group-icon' : '' }));
      const marker = L.marker(getReportCoordinates(candidate.position), {
        icon, zIndexOffset: CANDIDATE_MARKER_Z_INDEX,
        title: grouped ? groupTitle(group) : titleFor?.(candidate),
        keyboard: true,
      }).addTo(layer);
      disposers.push(popups.register(marker, () => popupFor(group), { autoPanOnPin: true }));
    }
  }
  const refresh = () => render();
  map.on('zoomend moveend resize', refresh);
  return {
    update(next = []) { if (!destroyed) { candidates = [...next]; render(true); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      map.off('zoomend moveend resize', refresh);
      clear(); candidates = [];
    },
  };
}

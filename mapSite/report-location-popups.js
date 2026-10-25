// Keep every report at its submitted coordinate. Coincident markers share the
// visible reports at that point, so the top marker cannot hide another report.
export function createReportLocationPopups(reports, renderReport, { document = globalThis.document, groupLabel } = {}) {
  const locations = new Map();
  const locationKey = (report) => Number.isFinite(report?.latitude) && Number.isFinite(report?.longitude)
    ? JSON.stringify([report.latitude, report.longitude]) : null;
  for (const report of reports) {
    const key = locationKey(report);
    if (key === null) continue;
    if (!locations.has(key)) locations.set(key, []);
    locations.get(key).push(report);
  }
  return (report) => {
    const neighbors = locations.get(locationKey(report)) || [report];
    if (neighbors.length < 2) return renderReport(report);
    const content = document.createElement('div');
    content.className = 'report-location-popup';
    content.tabIndex = 0;
    content.setAttribute('role', 'region');
    if (groupLabel) content.setAttribute('aria-label', groupLabel(neighbors.length));
    content.style.maxHeight = 'min(260px, 45vh)';
    content.style.overflowY = 'auto';
    content.style.overscrollBehavior = 'contain';
    content.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    content.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) event.stopPropagation();
    });
    const ordered = [report, ...neighbors.filter((neighbor) => neighbor !== report)];
    ordered.forEach((neighbor, index) => {
      if (index) content.append(document.createElement('hr'));
      const detail = renderReport(neighbor);
      if (typeof detail === 'string') {
        const text = document.createElement('p');
        text.textContent = detail;
        content.append(text);
      } else content.append(detail);
    });
    return content;
  };
}

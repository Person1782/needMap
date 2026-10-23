export function normalizeView(value) {
  return ["plan", "decisions"].includes(value) ? "plan" : "explore";
}

export function normalizeReport(id, data) {
  const coordinate = (value) => (typeof value === "number" || typeof value === "string") && String(value).trim()
    ? Number(value) : NaN;
  const latitude = coordinate(data?.latitude);
  const longitude = coordinate(data?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { ...data, id, latitude, longitude,
    category: typeof data.category === "string" && data.category.trim() ? data.category.trim() : "other",
    summary: typeof data.summary === "string" ? data.summary.trim() : "",
    severity: ["low", "medium", "high"].includes(data.severity) ? data.severity : "unknown" };
}

export function filterReports(reports, { query = "", category = "all", urgency = "all", contains } = {}) {
  const search = query.trim().toLowerCase();
  return reports.filter((report) =>
    (category === "all" || report.category === category) &&
    (urgency === "all" || report.severity === urgency) &&
    (!search || [report.summary, report.category, report.region?.name, report.region?.hierarchy].join(" ").toLowerCase().includes(search)) &&
    (!contains || contains(report)));
}

export function reportSnapshotKey(reports) {
  return JSON.stringify([...reports].sort((a, b) => a.id.localeCompare(b.id)));
}

export function bindViewTabs(tabs, onSelect) {
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => onSelect(tab.dataset.view));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      onSelect(tabs[next].dataset.view);
      tabs[next].focus();
    });
  });
}

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

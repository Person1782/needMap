export const REPORT_MARKER_Z_INDEX = 1000;
export const CANDIDATE_MARKER_Z_INDEX = 2000;

export function separatedCandidateIconOptions(html, { size = 36, stem = 18, className = "" } = {}) {
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(stem) || stem < 0) {
    throw new TypeError("Candidate marker dimensions must be positive finite numbers.");
  }
  const height = size + stem;
  return {
    className: `separated-candidate-icon ${className}`.trim(),
    html,
    iconSize: [size, height],
    iconAnchor: [size / 2, height],
    popupAnchor: [0, -height],
  };
}

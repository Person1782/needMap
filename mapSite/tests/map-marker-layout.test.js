import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANDIDATE_MARKER_Z_INDEX,
  REPORT_MARKER_Z_INDEX,
  separatedCandidateIconOptions,
} from "../map-marker-layout.js";

test("a recommendation sharing a report coordinate stays separated and cannot be concealed by nearby reports", () => {
  const icon = separatedCandidateIconOptions("<span>Recommendation</span>");
  const reportTop = -13;
  const recommendationBubbleBottom = -18;

  assert.deepEqual(icon.iconSize, [36, 54]);
  assert.deepEqual(icon.iconAnchor, [18, 54]);
  assert.ok(recommendationBubbleBottom < reportTop,
    "the recommendation bubble ends above the 26px report marker");
  assert.ok(CANDIDATE_MARKER_Z_INDEX > REPORT_MARKER_Z_INDEX,
    "proposal groups remain accessible above nearby report markers");
});

test("Plans recommendations use the same separation with their larger marker", () => {
  const icon = separatedCandidateIconOptions("<span>Plan</span>", { size: 42, className: "plans" });
  assert.deepEqual(icon.iconSize, [42, 60]);
  assert.deepEqual(icon.iconAnchor, [21, 60]);
  assert.match(icon.className, /separated-candidate-icon/);
});

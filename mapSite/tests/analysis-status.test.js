import assert from "node:assert/strict";
import { test } from "node:test";
import { analysisFailureMessage } from "../analysis-status.js";

test("provider outages explain the failure without exposing request details", () => {
  const error = new Error("Error fetching from https://provider.example?key=secret: [500 Internal Server Error] This model is currently experiencing high demand.");
  error.customErrorData = { status: 500 };
  const message = analysisFailureMessage(error);
  assert.match(message, /busy or temporarily unavailable/);
  assert.doesNotMatch(message, /secret|provider\.example|Error fetching/);
});

test("quota, configuration, timeout, connection, and validation failures have specific guidance", () => {
  const cases = [
    [{ customErrorData: { status: 429 } }, /request limit/],
    [{ code: "api-not-enabled" }, /Firebase AI Logic and App Check/],
    [{ customErrorData: { status: 403 }, message: "Error fetching" }, /authorize/],
    [new Error("Detailed analysis timed out."), /too long/],
    [new TypeError("Failed to fetch"), /connection/],
    [new Error("The analysis response was missing supported report evidence."), /could not be verified/],
    [null, /could not be completed/],
  ];
  for (const [error, expected] of cases) assert.match(analysisFailureMessage(error), expected);
});

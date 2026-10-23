import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { inferServiceNeed } from "../analysis.js";

// Replace only the browser CDN import; exercise the real stream and validation code
// against a deterministic provider, without sending report content to a service.
const source = await readFile(new URL("../gemini-analysis.js", import.meta.url), "utf8");
const requestedModels = [];
globalThis.__needmapTestAI = {
  getAI: () => ({}), GoogleAIBackend: class {},
  getGenerativeModel: (_ai, { model }) => {
    requestedModels.push(model);
    return globalThis.__needmapTestModel;
  },
};
const moduleSource = source.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/,
  "const { getAI, getGenerativeModel, GoogleAIBackend } = globalThis.__needmapTestAI;");
const { analyzeWithGemini } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

const recommendation = {
  id: "region:food", category: "food", urgencyScore: 4, region: { name: "Test region" },
  signals: [
    { id: "first", severity: "low", summary: "Food needed" },
    { id: "second", severity: "high", summary: "No nearby food" },
  ],
  analysis: { facilityType: "Food access center" },
};

function response(candidateNumber = 1, overrides = {}) {
  const evidence = [1, 2].map((index) => ({ evidenceId: `C${candidateNumber}-R${index}`, relevance: "Describes a food access need" }));
  return `NEEDMAP_SUMMARY:\nFood access needs review [C${candidateNumber}-R1].\nNEEDMAP_DATA:\n${JSON.stringify({ recommendations: [{
    candidateId: recommendation.id, facilityType: "Food access center",
    decisionSummary: "Review options for improving food access.", needAnalysis: "Repeated food access reports.",
    placementRationale: "Locations and urgency inform the placement.", evidence, ...overrides,
  }] })}`;
}

test("invalid output retries the next model instead of reporting a false success", async () => {
  let attempts = 0;
  globalThis.__needmapTestModel = {
    async generateContentStream() {
      attempts += 1;
      const text = attempts === 1 ? "Incomplete output" : response();
      return { stream: (async function* () { yield { text: () => text }; })() };
    },
  };
  const result = await analyzeWithGemini({}, [recommendation]);
  assert.equal(attempts, 2);
  assert.equal(result.recommendations[0].analysis.source, "Gemini");
});

test("an overloaded primary model retries the current Flash-Lite fallback", async () => {
  requestedModels.length = 0;
  let attempts = 0;
  globalThis.__needmapTestModel = {
    async generateContentStream() {
      attempts += 1;
      if (attempts === 1) throw new Error("500 This model is currently experiencing high demand");
      return {
        stream: (async function* () { yield { text: () => response() }; })(),
        response: Promise.resolve({ text: () => response() }),
      };
    },
  };
  const result = await analyzeWithGemini({}, [recommendation]);
  assert.deepEqual(requestedModels, ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  assert.equal(result.recommendations[0].analysis.source, "Gemini");
});

test("final validation uses the aggregate response when available", async () => {
  const updates = [];
  globalThis.__needmapTestModel = {
    async generateContentStream() {
      return {
        stream: (async function* () { yield { text: () => "Partial briefing" }; })(),
        response: Promise.resolve({ text: () => response() }),
      };
    },
  };
  const result = await analyzeWithGemini({}, [recommendation], { onText: (text) => updates.push(text) });
  assert.equal(result.recommendations[0].analysis.source, "Gemini");
  assert.deepEqual(updates, ["", "Partial briefing"]);

  globalThis.__needmapTestModel = {
    async generateContentStream() {
      return {
        stream: (async function* () { yield { text: () => response() }; })(),
        response: Promise.resolve({ text: () => response(1, { evidence: [] }) }),
      };
    },
  };
  await assert.rejects(analyzeWithGemini({}, [recommendation]), /supported report evidence/);
});

test("aggregate response rejection is handled and aborts failed requests", async () => {
  const requests = [];
  globalThis.__needmapTestModel = {
    async generateContentStream(_prompt, options) {
      requests.push(options);
      return {
        stream: (async function* () { yield { text: () => response() }; })(),
        response: Promise.reject(new Error("Aggregate stream failed")),
      };
    },
  };
  await assert.rejects(analyzeWithGemini({}, [recommendation]), /Aggregate stream failed/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ signal }) => signal.aborted));
});

test("batch citation offsets remain unique and resolve to the correct reports", async () => {
  let receivedPrompt;
  globalThis.__needmapTestModel = {
    async generateContentStream(prompt) {
      receivedPrompt = prompt;
      return { stream: (async function* () { yield { text: () => response(5) }; })() };
    },
  };
  const result = await analyzeWithGemini({}, [recommendation], { candidateOffset: 4 });
  assert.match(receivedPrompt, /"evidenceId":"C5-R2"/);
  assert.equal(result.recommendations[0].analysis.evidence[1].reportId, "second");
  assert.equal(result.recommendations[0].analysis.evidence[1].citation, "C5-R2");
});

test("insufficient or unknown report evidence fails validation", async () => {
  for (const overrides of [
    { evidence: [{ evidenceId: "C1-R1", relevance: "Only one report" }] },
    { evidence: [{ evidenceId: "C1-R1", relevance: "Known report" }, { evidenceId: "C1-R99", relevance: "Invented report" }] },
  ]) {
    globalThis.__needmapTestModel = {
      async generateContentStream() {
        return { stream: (async function* () { yield { text: () => response(1, overrides) }; })() };
      },
    };
    await assert.rejects(analyzeWithGemini({}, [recommendation]), /supported report evidence/);
  }
});

test("analysis needs no confidence score and discards unsolicited scores", async () => {
  let receivedPrompt;
  for (const overrides of [{}, { confidence: 0.98 }, { confidence: null }]) {
    globalThis.__needmapTestModel = {
      async generateContentStream(prompt) {
        receivedPrompt = prompt;
        return { stream: (async function* () { yield { text: () => response(1, overrides) }; })() };
      },
    };
    const result = await analyzeWithGemini({}, [recommendation]);
    assert.equal(Object.hasOwn(result.recommendations[0].analysis, "confidence"), false);
    assert.equal(result.recommendations[0].analysis.evidence.length, 2);
  }
  assert.doesNotMatch(receivedPrompt, /"confidence"\s*:/);
});

test("local recommendations preserve report evidence without a confidence score", () => {
  const analysis = inferServiceNeed(recommendation);
  assert.equal(Object.hasOwn(analysis, "confidence"), false);
  assert.equal(analysis.evidence.length, 2);
  assert.equal(analysis.urgencyBreakdown.totalReports, 2);
});

test("rate limits do not trigger another request against the same project quota", async () => {
  let attempts = 0;
  globalThis.__needmapTestModel = {
    async generateContentStream() { attempts += 1; throw new Error("429 Too Many Requests"); },
  };
  await assert.rejects(analyzeWithGemini({}, [recommendation]), /429/);
  assert.equal(attempts, 1);
});

test("explicit model-scoped quota failures can use the fallback model", async () => {
  requestedModels.length = 0;
  let attempts = 0;
  const error = new Error("Model request limit reached");
  error.customErrorData = {
    status: 429,
    errorDetails: [{
      "@type": "type.googleapis.com/google.rpc.QuotaFailure",
      violations: [
        { quotaMetric: "generate_content_free_tier_requests", quotaDimensions: { model: "gemini-3.8-flash", location: "global" } },
        { quotaMetric: "generate_content_free_tier_input_token_count", quotaDimensions: { model: "gemini-3.8-flash" } },
      ],
    }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "10s" }],
  };
  globalThis.__needmapTestModel = {
    async generateContentStream() {
      attempts += 1;
      if (attempts === 1) throw error;
      return { stream: (async function* () { yield { text: () => response() }; })() };
    },
  };
  const result = await analyzeWithGemini({}, [recommendation]);
  assert.deepEqual(requestedModels, ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  assert.equal(result.recommendations[0].analysis.source, "Gemini");
});

test("unknown, shared, mixed, malformed, and other-model quotas stop immediately", async () => {
  const modelViolation = { quotaDimensions: { model: "gemini-3.8-flash" } };
  const quotaFailure = (violations) => ({ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations });
  const cases = [
    undefined,
    [],
    JSON.stringify([quotaFailure([modelViolation])]),
    [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "10s" }],
    [quotaFailure([])],
    [quotaFailure(null)],
    [quotaFailure([null])],
    [quotaFailure([{ quotaDimensions: { project: "test-project" } }])],
    [quotaFailure([{ quotaDimensions: { model: "gemini-3.5-flash-lite" } }])],
    [quotaFailure([modelViolation, { quotaDimensions: { location: "global" } }])],
    [quotaFailure([modelViolation]), quotaFailure([{ quotaDimensions: {} }])],
    [quotaFailure([modelViolation]), quotaFailure([])],
  ];
  for (const errorDetails of cases) {
    let attempts = 0;
    const error = new Error("Request limit reached");
    error.customErrorData = { status: 429, errorDetails };
    globalThis.__needmapTestModel = {
      async generateContentStream() { attempts += 1; throw error; },
    };
    await assert.rejects(analyzeWithGemini({}, [recommendation]), (received) => received === error);
    assert.equal(attempts, 1);
  }
});

test("authorization failures never retry even with model-specific quota details", async () => {
  for (const status of [401, 403]) {
    let attempts = 0;
    const error = new Error("Request was not authorized");
    error.customErrorData = {
      status,
      errorDetails: [{
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaDimensions: { model: "gemini-3.8-flash" } }],
      }],
    };
    globalThis.__needmapTestModel = {
      async generateContentStream() { attempts += 1; throw error; },
    };
    await assert.rejects(analyzeWithGemini({}, [recommendation]), (received) => received === error);
    assert.equal(attempts, 1);
  }
});

test("cancellation releases a pending analysis and never starts a fallback model", async () => {
  let attempts = 0;
  let requestOptions;
  globalThis.__needmapTestModel = {
    generateContentStream(_prompt, options) {
      attempts += 1;
      requestOptions = options;
      return new Promise(() => {});
    },
  };
  const controller = new AbortController();
  const pending = analyzeWithGemini({}, [recommendation], { signal: controller.signal });
  assert.ok(requestOptions.signal instanceof AbortSignal);
  assert.equal(requestOptions.signal.aborted, false);
  assert.equal(requestOptions.timeout, 60000);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(requestOptions.signal.aborted, true);
  assert.equal(requestOptions.signal.reason, controller.signal.reason);
  assert.equal(attempts, 1);
});

test("timeouts abort the provider request before starting the fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests = [];
  globalThis.__needmapTestModel = {
    generateContentStream(_prompt, options) {
      if (requests.length) assert.equal(requests.at(-1).signal.aborted, true);
      requests.push(options);
      return new Promise(() => {});
    },
  };
  const pending = assert.rejects(analyzeWithGemini({}, [recommendation]), /timed out/);
  t.mock.timers.tick(60000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, false);
  t.mock.timers.tick(60000);
  await pending;
  assert.equal(requests[1].signal.aborted, true);
});

test("late stream content cannot update the view after cancellation", async () => {
  let release;
  let requestSignal;
  const updates = [];
  globalThis.__needmapTestModel = {
    async generateContentStream(_prompt, { signal }) {
      requestSignal = signal;
      return { stream: (async function* () {
        await new Promise((resolve) => { release = resolve; });
        yield { text: () => response() };
      })() };
    },
  };
  const controller = new AbortController();
  const pending = analyzeWithGemini({}, [recommendation], { signal: controller.signal, onText: (text) => updates.push(text) });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(requestSignal.aborted, true);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, [""]);
});

test("a late aggregate rejection after cancellation is observed without updating the view", async () => {
  let releaseResult;
  const updates = [];
  globalThis.__needmapTestModel = {
    generateContentStream() {
      return new Promise((resolve) => { releaseResult = resolve; });
    },
  };
  const controller = new AbortController();
  const pending = analyzeWithGemini({}, [recommendation], {
    signal: controller.signal, onText: (text) => updates.push(text),
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  releaseResult({
    stream: (async function* () { yield { text: () => response() }; })(),
    response: Promise.reject(new Error("Late provider failure")),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { context, plain, valid } from "./test-helpers.js";
const ctx = context();
const report = plain(ctx.NeedMapForm.validateReport(valid).report);
function stored(payload = report) {
  return { fields: { ...Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === "number" ? { doubleValue: value } : typeof value === "boolean" ? { booleanValue: value } : { stringValue: value }])), submittedAt: { timestampValue: "2026-10-21T00:00:00Z" } } };
}
const missing = Object.assign(new Error("not found"), { status: 404 });
function client(responses) {
  const calls = [];
  const api = ctx.NeedMapNetwork.createClient({ projectId: "demo-project", apiKey: "demo-key" }, (...args) => {
    const done = args.pop();
    calls.push(plain(args));
    const next = responses.shift();
    assert.ok(next, "unexpected request");
    done(...next);
  });
  return { calls, write: (id = "report-01", value = report) => new Promise((resolve, reject) => api.writeReport(id, value, (error) => error ? reject(error) : resolve())) };
}
const auth = [null, { idToken: "test-token", expiresIn: "3600" }];
const commit = [null, { commitTime: "2026-10-21T00:00:00Z", writeResults: [{}] }];

test("anonymously authenticates and creates only the exact schema with a server timestamp", async () => {
  const api = client([auth, [missing], commit]);
  await api.write();
  const [signIn, read, write] = api.calls;
  assert.match(signIn[1], /accounts:signUp/);
  assert.deepEqual(signIn[2], { returnSecureToken: true });
  assert.equal(read[0], "GET");
  assert.equal(write[3], "test-token");
  assert.match(write[1], /documents:commit$/);
  const entry = write[2].writes[0];
  assert.deepEqual(entry.currentDocument, { exists: false });
  assert.deepEqual(entry.updateTransforms, [{ fieldPath: "submittedAt", setToServerValue: "REQUEST_TIME" }]);
  assert.equal(Object.keys(entry.update.fields).length, 9);
  assert.equal("submittedBy" in entry.update.fields, false);
  assert.equal("place" in entry.update.fields, false);
});

test("retry after lost acknowledgement reads the original ID and never updates the public report", async () => {
  const api = client([auth, [missing], [new Error("ack lost")], [null, stored()]]);
  await assert.rejects(api.write());
  await api.write();
  assert.equal(api.calls.filter((call) => call[1].includes("accounts:signUp")).length, 1);
  assert.equal(api.calls.filter((call) => call[1].endsWith(":commit")).length, 1);
});

test("matching content without a submitted timestamp cannot falsely count as sent", async () => {
  const document = stored();
  delete document.fields.submittedAt;
  const api = client([auth, [null, document]]);
  await assert.rejects(api.write(), /reference-conflict/);
});

test("a mismatched reference or failed read never triggers an overwrite", async () => {
  const mismatch = client([auth, [null, stored({ ...report, summary: "Different concern" })]]);
  await assert.rejects(mismatch.write(), /reference-conflict/);
  const denied = client([auth, [Object.assign(new Error("PERMISSION_DENIED"), { status: 403 })]]);
  await assert.rejects(denied.write());
  assert.equal(denied.calls.length, 2);
});

test("authentication errors and malformed commit acknowledgements do not report success", async () => {
  const authFailure = client([[Object.assign(new Error("OPERATION_NOT_ALLOWED"), { status: 400 })]]);
  await assert.rejects(authFailure.write());
  assert.equal(authFailure.calls.length, 1);
  const badAck = client([auth, [missing], [null, {}]]);
  await assert.rejects(badAck.write(), /unconfirmed-write/);
});

test("XHR handles timeouts, network failures, bad JSON and double callbacks once", () => {
  for (const kind of ["timeout", "error", "bad-json", "http-error"]) {
    let xhr;
    let calls = 0;
    const browser = context({ XMLHttpRequest: function () { xhr = this; this.open = () => {}; this.setRequestHeader = () => {}; this.send = () => {}; } });
    browser.NeedMapNetwork.request("GET", "/test", null, null, (error) => { assert.ok(error); calls++; });
    assert.equal(xhr.timeout, 30000);
    if (kind === "bad-json") { xhr.status = 200; xhr.responseText = "<html>"; xhr.onload(); }
    else if (kind === "http-error") { xhr.status = 403; xhr.responseText = '{"error":{"status":"PERMISSION_DENIED"}}'; xhr.onload(); }
    else xhr["on" + kind]();
    xhr.onerror();
    assert.equal(calls, 1);
  }
});

test("watchdog times out older XHR implementations and cancels the request only once", () => {
  let watchdog;
  let xhr;
  let callbacks = 0;
  let aborted = false;
  const browser = context({
    setTimeout: (callback) => { watchdog = callback; return 1; }, clearTimeout() {},
    XMLHttpRequest: function () { xhr = this; this.open = () => {}; this.setRequestHeader = () => {}; this.send = () => {}; this.abort = () => { aborted = true; this.onabort(); }; },
  });
  browser.NeedMapNetwork.request("GET", "/test", null, null, (error) => { assert.equal(error.code, "timeout"); callbacks++; });
  watchdog();
  xhr.onerror();
  assert.equal(callbacks, 1);
  assert.equal(aborted, true);
});

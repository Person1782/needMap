/* Firebase REST: no SDK download, polling connection, or background writes. */
(function (root) {
  "use strict";
  function failure(code, status) { var error = new Error(code); error.code = code; error.status = status || 0; return error; }
  function request(method, url, body, token, callback) {
    var xhr;
    var done = false;
    var timer;
    function finish(error, result) { if (!done) { done = true; if (timer) root.clearTimeout(timer); callback(error, result); } }
    try {
      xhr = new root.XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = 30000;
      if (body !== null) xhr.setRequestHeader("Content-Type", "application/json");
      if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.onload = function () {
        var data;
        try { data = JSON.parse(xhr.responseText || "{}"); } catch (error) { finish(failure("invalid-response", xhr.status)); return; }
        if (xhr.status >= 200 && xhr.status < 300) finish(null, data);
        else finish(failure(data.error && (data.error.status || data.error.message) || "http-error", xhr.status));
      };
      xhr.onerror = function () { finish(failure("network-error")); };
      xhr.ontimeout = function () { finish(failure("timeout")); };
      xhr.onabort = function () { finish(failure("cancelled")); };
      // A watchdog also covers older XHR implementations without timeout events.
      timer = root.setTimeout(function () {
        finish(failure("timeout"));
        try { xhr.abort(); } catch (error) { /* Already closed. */ }
      }, 30000);
      xhr.send(body === null ? null : JSON.stringify(body));
    } catch (error) { finish(failure("network-error")); }
    return xhr;
  }
  function createClient(config, send) {
    send = send || request;
    var token = null;
    var expires = 0;
    var database = "projects/" + config.projectId + "/databases/(default)";
    var base = "https://firestore.googleapis.com/v1/" + database + "/documents";
    function signIn(callback) {
      if (token && expires > new Date().getTime()) { callback(null, token); return; }
      send("POST", "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + encodeURIComponent(config.apiKey), { returnSecureToken: true }, null, function (error, data) {
        if (error) { callback(error); return; }
        if (!data || typeof data.idToken !== "string" || !data.idToken) { callback(failure("invalid-auth-response")); return; }
        token = data.idToken;
        expires = new Date().getTime() + Math.max(0, (Number(data.expiresIn) || 3600) - 60) * 1000;
        callback(null, token);
      });
    }
    function encodeFields(report) {
      var fields = {};
      Object.keys(report).forEach(function (key) {
        var value = report[key];
        fields[key] = typeof value === "number" ? { doubleValue: value } : typeof value === "boolean" ? { booleanValue: value } : { stringValue: value };
      });
      return fields;
    }
    function matches(stored, report) {
      if (!stored || !stored.fields || !stored.fields.submittedAt || !stored.fields.submittedAt.timestampValue) return false;
      return Object.keys(report).every(function (key) {
        var field = stored.fields[key];
        if (!field) return false;
        var value = typeof report[key] === "number" ? Number(field.doubleValue !== undefined ? field.doubleValue : field.integerValue)
          : typeof report[key] === "boolean" ? field.booleanValue : field.stringValue;
        return value === report[key];
      });
    }
    function writeReport(id, report, callback) {
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) { callback(failure("invalid-reference")); return; }
      signIn(function (authError, authToken) {
        if (authError) { callback(authError); return; }
        var name = database + "/documents/incomingSignals/" + id;
        // Read this ID before every create, so a saved draft survives a lost
        // acknowledgement, reload, or a retry in another tab without duplicating.
        send("GET", base + "/incomingSignals/" + id, null, authToken, function (readError, stored) {
          if (!readError) { callback(matches(stored, report) ? null : failure("reference-conflict")); return; }
          if (readError.status !== 404) { if (readError.status === 401) token = null; callback(readError); return; }
          send("POST", base + ":commit", { writes: [{
            update: { name: name, fields: encodeFields(report) },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: "submittedAt", setToServerValue: "REQUEST_TIME" }]
          }] }, authToken, function (writeError, result) {
            if (writeError && writeError.status === 401) token = null;
            if (!writeError && (!result || !result.commitTime || !result.writeResults || result.writeResults.length !== 1)) writeError = failure("unconfirmed-write");
            callback(writeError);
          });
        });
      });
    }
    return { writeReport: writeReport };
  }
  root.NeedMapNetwork = { request: request, createClient: createClient };
}(window));

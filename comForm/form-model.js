/* ES5 on purpose: the public form must not need modules or Promise polyfills. */
(function (root) {
  "use strict";
  var CATEGORIES = ["healthcare", "water", "transportation", "emergency_response", "food", "broadband", "other"];
  var SEVERITIES = ["low", "medium", "high"];
  var SUMMARY_LIMIT = 280;
  var personalInfoPatterns = [
    { key: "errorPhone", pattern: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
    { key: "errorEmail", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
    { key: "errorAddress", pattern: /\b\d{1,5}\s+[A-Za-z0-9.\s]+\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|boulevard|blvd)\b/i }
  ];
  var defaultMessages = {
    errorCategory: "Choose a service category.", errorSeverity: "Choose an urgency level.",
    errorSummaryRequired: "Describe the service-access concern.", errorSummaryLength: "Use 280 characters or fewer.",
    errorPhone: "Remove the phone number before submitting.", errorEmail: "Remove the email address before submitting.",
    errorAddress: "Remove the street address before submitting.", errorLocation: "Add your approximate location or choose a nearby place."
  };
  function isValidLocation(latitude, longitude) {
    return typeof latitude === "number" && isFinite(latitude) && typeof longitude === "number" && isFinite(longitude)
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  }
  function createGridLocation(latitude, longitude) {
    if (!isValidLocation(latitude, longitude)) throw new RangeError("Invalid location.");
    function round(value) { return Number((Math.round(value / 0.0045) * 0.0045).toFixed(4)); }
    var lat = round(latitude);
    var lon = round(longitude);
    return { latitude: lat, longitude: lon, locationGridId: "grid-" + lat.toFixed(4) + "-" + lon.toFixed(4), locationPrecision: "approximate_grid_500m" };
  }
  function text(value) { return value === null || value === undefined ? "" : String(value); }
  function validateReport(values, translate) {
    function message(key) { return translate ? translate(key) : defaultMessages[key]; }
    var errors = {};
    var category = text(values.category);
    var severity = text(values.severity);
    var summary = text(values.summary).replace(/^\s+|\s+$/g, "");
    if (CATEGORIES.indexOf(category) === -1) errors.category = message("errorCategory");
    if (SEVERITIES.indexOf(severity) === -1) errors.severity = message("errorSeverity");
    if (!summary) errors.summary = message("errorSummaryRequired");
    else if (summary.length > SUMMARY_LIMIT) errors.summary = message("errorSummaryLength");
    else {
      for (var i = 0; i < personalInfoPatterns.length; i++) {
        if (personalInfoPatterns[i].pattern.test(summary)) {
          errors.summary = message(personalInfoPatterns[i].key);
          break;
        }
      }
    }
    var location = values.location;
    if (!location || !isValidLocation(location.latitude, location.longitude)) errors.location = message("errorLocation");
    if (Object.keys(errors).length) return { errors: errors, report: null };
    var grid = createGridLocation(location.latitude, location.longitude);
    return { errors: errors, report: {
      category: category, severity: severity, summary: summary,
      latitude: grid.latitude, longitude: grid.longitude, locationGridId: grid.locationGridId,
      locationPrecision: grid.locationPrecision, sourceType: "community_survey", isSynthetic: true
    } };
  }
  function createId() {
    var bytes;
    if (root.crypto && root.crypto.getRandomValues && root.Uint8Array) {
      bytes = new root.Uint8Array(16);
      root.crypto.getRandomValues(bytes);
      var id = "";
      for (var i = 0; i < bytes.length; i++) id += ("0" + bytes[i].toString(16)).slice(-2);
      return id;
    }
    // IDs are uniqueness keys, not credentials. Old browsers lack Web Crypto.
    return new Date().getTime().toString(36) + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function createSubmissionManager(options) {
    var pending = false;
    var attempt = options.attempt || null;
    return {
      submit: function (report, callback) {
        if (pending) return false;
        var fingerprint = JSON.stringify(report);
        if (!attempt || attempt.fingerprint !== fingerprint || !/^[a-zA-Z0-9-]{8,100}$/.test(attempt.id)) {
          attempt = { id: options.createId(), fingerprint: fingerprint, report: report };
        }
        if (options.onAttempt) options.onAttempt(attempt);
        var current = attempt;
        pending = true;
        options.writeReport(current.id, report, function (error) {
          pending = false;
          if (!error) attempt = null;
          callback(error, error ? null : current.id);
        });
        return true;
      },
      getAttempt: function () { return attempt; },
      reset: function () { if (!pending) attempt = null; }
    };
  }
  root.NeedMapForm = { createGridLocation: createGridLocation, isValidLocation: isValidLocation, validateReport: validateReport, createSubmissionManager: createSubmissionManager, createId: createId, SUMMARY_LIMIT: SUMMARY_LIMIT };
}(window));

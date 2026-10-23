/* Passive capability hints only: no speed-test downloads or device identifiers. */
(function (root) {
  "use strict";
  function positive(value) { return typeof value === "number" && isFinite(value) && value > 0; }
  function slowPage(performance) {
    if (!performance) return false;
    var entries;
    var timing;
    try {
      entries = performance.getEntriesByType && performance.getEntriesByType("navigation");
      timing = entries && entries[0] || performance.timing;
      if (timing && positive(timing.responseEnd) && timing.responseEnd - timing.fetchStart >= 2500) return true;
      entries = performance.getEntriesByType && performance.getEntriesByType("resource");
      for (var i = 0; entries && i < entries.length; i++) {
        if ((entries[i].initiatorType === "script" || entries[i].initiatorType === "link") && entries[i].duration >= 2500) return true;
      }
    } catch (error) { /* Timing hints are optional on older browsers. */ }
    return false;
  }
  function detect(navigator, performance, preference, observedSlow) {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    var reasonKey = "";
    if (preference === "slow") reasonKey = "modeReasonManual";
    else if (navigator.onLine === false) reasonKey = "modeReasonOffline";
    else if (connection.saveData === true) reasonKey = "modeReasonSaveData";
    else if (/^(slow-2g|2g|3g)$/.test(connection.effectiveType || "") || (positive(connection.downlink) && connection.downlink < 1.5) || (positive(connection.rtt) && connection.rtt >= 500)) reasonKey = "modeReasonSlow";
    else if ((positive(navigator.deviceMemory) && navigator.deviceMemory <= 2) || (positive(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 2)) reasonKey = "modeReasonDevice";
    else if (observedSlow || slowPage(performance)) reasonKey = "modeReasonPageSlow";
    return { slow: !!reasonKey, reasonKey: reasonKey };
  }
  function mapUrl(configured, location) {
    // Two independent local apps. Production uses the explicit deployment path.
    if (configured === "/map/" && location && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname || "")) {
      if (location.port === "5173" || location.port === "4173") return location.protocol + "//" + location.host.replace(/:\d+$/, ":" + (location.port === "5173" ? "5174" : "4174")) + "/";
    }
    return configured || "/map/";
  }
  root.NeedMapAdaptive = { detect: detect, mapUrl: mapUrl };
}(window));

/* Contextual, dependency-free loading state for the public ES5 form. */
(function (root, document) {
  "use strict";
  var AREAS = {
    form: { hostId: "form-loading", busyId: "loading-status", labelId: "form-loading-label", hideBusy: true },
    language: { hostId: "language-loading", busyId: "language-picker", labelId: "language-loading-label" },
    location: { hostId: "location-loading", busyId: "location-loading-area" },
    search: { hostId: "search-loading", busyId: "search-loading-area" },
    submission: { hostId: "submission-loading", busyId: "submission-loading-area" }
  };
  function createLoadingBar(document, translate) {
    var entries = {};
    var sequence = 0;
    function activeEntry(area) {
      var selected = null;
      for (var key in entries) if (Object.prototype.hasOwnProperty.call(entries, key)) {
        if (entries[key].area === area && (!selected || entries[key].order > selected.order)) selected = entries[key];
      }
      return selected;
    }
    function translated(entry) {
      var value = "";
      if (entry && translate) {
        try { value = translate(entry.labelKey, entry.fallback); } catch (error) { value = ""; }
      }
      return value && value !== entry.labelKey ? value : entry ? entry.fallback : "";
    }
    function renderArea(area) {
      var config = AREAS[area];
      var host = document && document.getElementById ? document.getElementById(config.hostId) : null;
      var busy = document && document.getElementById ? document.getElementById(config.busyId) : null;
      var entry = activeEntry(area);
      if (host) host.hidden = !entry;
      if (busy && busy.setAttribute && busy.removeAttribute) {
        if (entry) busy.setAttribute("aria-busy", "true");
        else busy.removeAttribute("aria-busy");
      }
      if (busy && config.hideBusy) busy.hidden = !entry;
      if (!entry || !config.labelId) return;
      var label = document && document.getElementById ? document.getElementById(config.labelId) : null;
      if (label) label.textContent = translated(entry);
    }
    function render() {
      for (var area in AREAS) if (Object.prototype.hasOwnProperty.call(AREAS, area)) renderArea(area);
    }
    function begin(key, labelKey, fallback, area) {
      key = String(key || "");
      if (!key) return function () {};
      if (!Object.prototype.hasOwnProperty.call(AREAS, area)) area = "form";
      var entry = {
        key: key,
        labelKey: labelKey || "loading",
        fallback: fallback || "Loading\u2026",
        area: area,
        order: ++sequence
      };
      entries[key] = entry;
      render();
      var finished = false;
      return function () {
        if (finished) return;
        finished = true;
        if (entries[key] === entry) delete entries[key];
        render();
      };
    }
    function end(key) {
      if (Object.prototype.hasOwnProperty.call(entries, key)) delete entries[key];
      render();
    }
    function isActive(key) {
      if (key) return Object.prototype.hasOwnProperty.call(entries, key);
      for (var entryKey in entries) if (Object.prototype.hasOwnProperty.call(entries, entryKey)) return true;
      return false;
    }
    return { begin: begin, end: end, refresh: render, isActive: isActive };
  }
  function translate(key, fallback) {
    var i18n = root.NeedMapI18n;
    if (!i18n || !i18n.t) return fallback;
    return i18n.t(key) || fallback;
  }
  var loading = createLoadingBar(document, translate);
  root.NeedMapLoading = loading;
  loading.begin("boot", "loading", "Loading the form\u2026", "form");
  if (root.addEventListener) root.addEventListener("needmap-languagechange", loading.refresh);
}(window, typeof document !== "undefined" ? document : null));

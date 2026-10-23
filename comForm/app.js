(function (root, document, navigator) {
  "use strict";
  var i18n = root.NeedMapI18n;
  if (!i18n || !i18n.t) return;
  function tr(key, parameters) { return i18n.t(key, parameters); }
  function byId(id) { return document.getElementById(id); }
  var form = byId("signal-form");
  var formFields = byId("form-fields");
  var submitButton = byId("submit-button");
  var statusMessage = byId("form-status");
  var errorSummary = byId("error-summary");
  var errorList = byId("error-list");
  var locationButton = byId("location-button");
  var locationStatus = byId("location-status");
  var summary = byId("summary");
  var draftStatus = byId("draft-status");
  var searchButton = byId("place-search-button");
  var placeInput = byId("place-query");
  var searchStatus = byId("place-search-status");
  var searchResults = byId("place-results");
  var modeSelect = byId("connection-mode");
  var modeStatus = byId("mode-status");
  var mapLinkContainer = byId("map-link-container");
  var formStatusState = { key: "", parameters: null, type: "" };
  var locationStatusState = { key: "noLocation", parameters: null, type: "" };
  var draftStatusState = { key: "draftInitial", parameters: null };
  var searchStatusState = { key: "", parameters: null };
  var activeErrors = false;
  var fieldNames = ["category", "severity", "summary"];
  var model = root.NeedMapForm;
  if (!root.JSON || !root.XMLHttpRequest || !root.addEventListener || !model || !root.NeedMapNetwork || !root.NeedMapAdaptive) {
    statusMessage.textContent = tr("browserUnsupported");
    return;
  }
  var storageKey = "needmap-report-draft-v2";
  var location = null;
  var submitting = false;
  var preference = "auto";
  var mode;
  var observedSlow = false;
  var submissionStay = false;
  var searchingNow = false;
  var modeStorage;
  var modeStorageKey = "needmap-connection-mode-v1";
  var baseDestination = root.NeedMapAdaptive.mapUrl(form.getAttribute("data-map-url"), root.location);
  var destination = baseDestination;
  var locationRequest = 0;
  var locating = false;
  var searchRequest = 0;
  var storage;
  var draft = null;
  try {
    storage = root.localStorage;
    draft = JSON.parse(storage.getItem(storageKey) || "null");
    if (!draft || !draft.savedAt || new Date().getTime() - draft.savedAt > 7 * 86400000) { draft = null; storage.removeItem(storageKey); }
  } catch (error) { storage = null; draft = null; }
  try {
    modeStorage = root.localStorage;
    if (modeStorage.getItem(modeStorageKey) === "slow") preference = "slow";
  } catch (error) { modeStorage = null; }
  modeSelect.value = preference;
  function localizedMapUrl(url) {
    var hashIndex = url.indexOf("#");
    var hash = hashIndex === -1 ? "" : url.slice(hashIndex);
    var base = hashIndex === -1 ? url : url.slice(0, hashIndex);
    base = base.replace(/([?&])lang=[^&#]*(&?)/, function (_match, start, tail) { return tail ? start : ""; }).replace(/[?&]$/, "");
    return base + (base.indexOf("?") === -1 ? "?" : "&") + "lang=" + encodeURIComponent(i18n.getLanguage()) + hash;
  }
  function updateDestination() {
    destination = localizedMapUrl(baseDestination);
    byId("map-link").href = destination;
  }
  updateDestination();
  mapLinkContainer.hidden = true;
  function updateMode() {
    mode = root.NeedMapAdaptive.detect(navigator, root.performance, preference, observedSlow);
    if (submitting && mode.slow) submissionStay = true;
    document.body.setAttribute("data-connection-mode", mode.slow ? "slow" : "full");
    byId("mode-label").textContent = tr(mode.slow ? "connectionSlow" : "modeLabelFull");
    modeStatus.textContent = mode.slow ? tr("modeSlowDetail", { reason: tr(mode.reasonKey) }) : tr("modeFast");
    if (submitting && submissionStay && !mode.slow) modeStatus.textContent = tr("modeImproved");
    if (!modeStorage) byId("mode-preference-note").textContent = tr("modeNoStorage");
    else byId("mode-preference-note").textContent = tr("preferenceRemembered");
  }
  modeSelect.addEventListener("change", function () {
    preference = modeSelect.value === "slow" ? "slow" : "auto";
    try { if (modeStorage) modeStorage.setItem(modeStorageKey, preference); } catch (error) { modeStorage = null; }
    updateMode();
  });
  var backend = root.NeedMapNetwork.createClient(root.NeedMapConfig);
  var submissions = model.createSubmissionManager({
    createId: model.createId,
    writeReport: backend.writeReport,
    attempt: draft && draft.attempt,
    onAttempt: function () { saveDraft(); }
  });
  var findPlace = root.NeedMapPlaceSearch(placeInput.getAttribute("data-search-url"), root.NeedMapNetwork.request, null, tr);
  function setStatus(key, parameters, type) {
    formStatusState = { key: key, parameters: parameters, type: type || "" };
    statusMessage.textContent = key ? tr(key, parameters) : "";
    statusMessage.className = "form-status " + (type || "");
  }
  function setLocationStatus(key, parameters, type) {
    locationStatusState = { key: key, parameters: parameters, type: type || "" };
    locationStatus.textContent = key ? tr(key, parameters) : "";
    locationStatus.className = "location-status " + (type || "");
  }
  function setDraftStatus(key, parameters) {
    draftStatusState = { key: key, parameters: parameters };
    draftStatus.textContent = tr(key, parameters);
  }
  function setSearchStatus(key, parameters) {
    searchStatusState = { key: key, parameters: parameters };
    searchStatus.textContent = key ? tr(key, parameters) : "";
  }
  function updateCount() { byId("summary-count").textContent = summary.value.length + " / 280"; }
  function values() { return { category: byId("category").value, severity: byId("severity").value, summary: summary.value, location: location }; }
  function saveDraft() {
    if (!storage) { setDraftStatus("draftNoStorage"); return; }
    var data = values();
    data.savedAt = new Date().getTime();
    data.attempt = submissions.getAttempt();
    try {
      storage.setItem(storageKey, JSON.stringify(data));
      setDraftStatus("draftSaved");
    } catch (error) {
      storage = null;
      setDraftStatus("draftNoStorage");
    }
  }
  function fieldTarget(name) { return byId(name === "location" ? "location-button" : name); }
  function clearErrors() {
    activeErrors = false;
    errorSummary.hidden = true;
    while (errorList.firstChild) errorList.removeChild(errorList.firstChild);
    ["category", "severity", "summary", "location"].forEach(function (name) {
      fieldTarget(name).removeAttribute("aria-invalid");
      byId(name + "-error").textContent = "";
    });
  }
  function showErrors(errors, focusSummary) {
    clearErrors();
    Object.keys(errors).forEach(function (name) {
      var target = fieldTarget(name);
      target.setAttribute("aria-invalid", "true");
      byId(name + "-error").textContent = errors[name];
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = "#" + target.id;
      link.textContent = errors[name];
      link.addEventListener("click", function (event) { event.preventDefault(); target.focus(); });
      item.appendChild(link);
      errorList.appendChild(item);
    });
    activeErrors = true;
    errorSummary.hidden = false;
    if (focusSummary !== false) errorSummary.focus();
  }
  function cancelLocationRequest() {
    locationRequest++;
    locating = false;
    locationButton.disabled = submitting;
    locationButton.textContent = tr("useLocation");
  }
  function clearSearch() {
    searchRequest++;
    searchingNow = false;
    searchButton.disabled = submitting;
    searchButton.textContent = tr("findPlace");
    while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
    setSearchStatus("");
  }
  function selectLocation(grid, messageKey, parameters) {
    cancelLocationRequest();
    clearSearch();
    location = grid;
    locationButton.removeAttribute("aria-invalid");
    byId("location-error").textContent = "";
    locationStatusState = { key: messageKey, parameters: parameters, suffix: true, type: "success" };
    locationStatus.textContent = tr(messageKey, parameters) + " " + tr("locationSharedSuffix");
    locationStatus.className = "location-status success";
    saveDraft();
  }
  function clearLocation() {
    cancelLocationRequest();
    clearSearch();
    location = null;
    setLocationStatus("noLocation");
    saveDraft();
  }
  function requestLocation() {
    if (submitting || locating) return;
    clearSearch();
    // An explicit replacement must never silently submit an older area.
    location = null;
    saveDraft();
    if (!navigator.geolocation) {
      setLocationStatus("locationUnavailableDevice", null, "error");
      return;
    }
    var request = ++locationRequest;
    locating = true;
    locationButton.disabled = true;
    locationButton.textContent = tr("locationFinding");
    setLocationStatus("locationPermissionPrompt");
    try {
      navigator.geolocation.getCurrentPosition(function (position) {
        if (request !== locationRequest || submitting) return;
        try { selectLocation(model.createGridLocation(position.coords.latitude, position.coords.longitude), "locationReady"); }
        catch (error) { cancelLocationRequest(); setLocationStatus("locationInvalid", null, "error"); }
      }, function (error) {
        if (request !== locationRequest || submitting) return;
        cancelLocationRequest();
        setLocationStatus(error.code === 1 ? "locationDenied" : "locationNotFound", null, "error");
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
    } catch (error) {
      cancelLocationRequest();
      setLocationStatus("locationUnavailable", null, "error");
    }
  }
  function searchPlace() {
    if (submitting || searchButton.disabled) return;
    cancelLocationRequest();
    clearSearch();
    if (navigator.onLine === false) { setSearchStatus("searchOffline"); return; }
    var request = ++searchRequest;
    searchingNow = true;
    searchButton.disabled = true;
    searchButton.textContent = tr("searching");
    setSearchStatus("searchLooking");
    findPlace(placeInput.value, function (error, results) {
      if (request !== searchRequest || submitting) return;
      searchingNow = false;
      searchButton.disabled = false;
      searchButton.textContent = tr("findPlace");
      if (error) { setSearchStatus(error.translationKey || "placeUnavailable"); return; }
      setSearchStatus(results.length ? "searchChoose" : "searchNone");
      results.forEach(function (result) {
        var item = document.createElement("li");
        var button = document.createElement("button");
        button.type = "button";
        button.className = "place-result";
        button.setAttribute("dir", "auto");
        button.textContent = result.label;
        button.addEventListener("click", function () {
          if (submitting) return;
          selectLocation(result.location, "selectedPlace", { place: result.label });
          locationButton.focus();
        });
        item.appendChild(button);
        searchResults.appendChild(item);
      });
    });
  }
  function lockForm(locked) {
    formFields.disabled = locked;
    // Also disable controls for older browsers with incomplete fieldset support.
    var controls = formFields.querySelectorAll("input, select, textarea, button");
    for (var i = 0; i < controls.length; i++) controls[i].disabled = locked;
  }
  locationButton.addEventListener("click", requestLocation);
  byId("clear-location").addEventListener("click", clearLocation);
  searchButton.addEventListener("click", searchPlace);
  placeInput.addEventListener("input", function () { clearSearch(); });
  placeInput.addEventListener("keydown", function (event) { if (event.keyCode === 13 || event.key === "Enter") { event.preventDefault(); searchPlace(); } });
  fieldNames.forEach(function (name) {
    byId(name).addEventListener("input", function () { updateCount(); saveDraft(); });
    byId(name).addEventListener("change", function () { updateCount(); saveDraft(); });
  });
  form.addEventListener("reset", function (event) {
    if (submitting) { event.preventDefault(); return; }
    cancelLocationRequest();
    clearSearch();
    clearErrors();
    location = null;
    submissions.reset();
    mapLinkContainer.hidden = true;
    setStatus("");
    setLocationStatus("noLocation");
    try { if (storage) storage.removeItem(storageKey); } catch (error) { storage = null; }
    setDraftStatus("draftCleared");
    root.setTimeout(updateCount, 0);
  });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submitting) return;
    mapLinkContainer.hidden = true;
    clearErrors();
    var result = model.validateReport(values(), tr);
    if (!result.report) { setStatus(""); showErrors(result.errors); return; }
    if (navigator.onLine === false) {
      saveDraft();
      setStatus("offlineSubmit", null, "error");
      statusMessage.focus();
      return;
    }
    updateMode();
    submissionStay = mode.slow;
    submitting = true;
    cancelLocationRequest();
    clearSearch();
    lockForm(true);
    form.setAttribute("aria-busy", "true");
    submitButton.textContent = tr("submitting");
    setStatus("submittingStatus");
    var startedAt = new Date().getTime();
    var modeTimer = root.setTimeout(function () { observedSlow = true; updateMode(); }, 8000);
    var slowTimer = root.setTimeout(function () { setStatus("stillWaiting"); }, 15000);
    submissions.submit(result.report, function (error, reference) {
      root.clearTimeout(slowTimer);
      root.clearTimeout(modeTimer);
      if (new Date().getTime() - startedAt >= 8000) observedSlow = true;
      updateMode();
      submitting = false;
      lockForm(false);
      form.removeAttribute("aria-busy");
      submitButton.textContent = tr("submitReport");
      if (!error) {
        form.reset();
        mapLinkContainer.hidden = false;
        setStatus(submissionStay ? "reportReceivedStay" : "reportReceivedOpening", { reference: reference.slice(0, 8).toUpperCase() }, "success");
        if (!submissionStay) {
          try { root.location.assign(destination); }
          catch (navigationError) { setStatus("reportReceivedLink", { reference: reference.slice(0, 8).toUpperCase() }, "success"); }
        }
      } else {
        saveDraft();
        var unavailable = error.status === 403 || error.code === "OPERATION_NOT_ALLOWED";
        setStatus(unavailable ? "reportingUnavailable" : "submissionUnconfirmed", null, "error");
      }
      statusMessage.focus();
    });
  });
  function updateConnectionStatus() { byId("connection-status").hidden = navigator.onLine !== false; updateMode(); }
  root.addEventListener("online", updateConnectionStatus);
  root.addEventListener("offline", updateConnectionStatus);
  root.addEventListener("load", updateMode);
  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection && connection.addEventListener) connection.addEventListener("change", updateMode);
  root.addEventListener("beforeunload", function (event) { if (submitting) { event.preventDefault(); event.returnValue = ""; } });
  root.addEventListener("needmap-languagechange", function () {
    updateDestination();
    updateMode();
    statusMessage.textContent = formStatusState.key ? tr(formStatusState.key, formStatusState.parameters) : "";
    statusMessage.className = "form-status " + formStatusState.type;
    locationStatus.textContent = locationStatusState.key ? tr(locationStatusState.key, locationStatusState.parameters) + (locationStatusState.suffix ? " " + tr("locationSharedSuffix") : "") : "";
    locationStatus.className = "location-status " + locationStatusState.type;
    draftStatus.textContent = tr(draftStatusState.key, draftStatusState.parameters);
    searchStatus.textContent = searchStatusState.key ? tr(searchStatusState.key, searchStatusState.parameters) : "";
    locationButton.textContent = tr(locating ? "locationFinding" : "useLocation");
    searchButton.textContent = tr(searchingNow ? "searching" : "findPlace");
    submitButton.textContent = tr(submitting ? "submitting" : "submitReport");
    if (activeErrors) showErrors(model.validateReport(values(), tr).errors, false);
  });
  if (draft) {
    fieldNames.forEach(function (name) { if (typeof draft[name] === "string") byId(name).value = draft[name].slice(0, name === "summary" ? 280 : 40); });
    if (draft.location && model.isValidLocation(draft.location.latitude, draft.location.longitude)) {
      location = model.createGridLocation(draft.location.latitude, draft.location.longitude);
      setLocationStatus("savedLocation", null, "success");
    }
    setDraftStatus("draftRestored");
  } else if (!storage) setDraftStatus("draftNoStorage");
  updateCount();
  updateConnectionStatus();
  byId("loading-status").hidden = true;
  submitButton.disabled = false;
}(window, document, navigator));

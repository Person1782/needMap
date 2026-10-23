(function (root, document, navigator) {
  "use strict";
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
  var fieldNames = ["category", "severity", "summary"];
  var model = root.NeedMapForm;
  if (!root.JSON || !root.XMLHttpRequest || !root.addEventListener || !model || !root.NeedMapNetwork) {
    statusMessage.textContent = "This browser cannot send the form. Please open this page in another browser.";
    return;
  }
  var storageKey = "needmap-report-draft-v2";
  var location = null;
  var submitting = false;
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
  var backend = root.NeedMapNetwork.createClient(root.NeedMapConfig);
  var submissions = model.createSubmissionManager({
    createId: model.createId,
    writeReport: backend.writeReport,
    attempt: draft && draft.attempt,
    onAttempt: function () { saveDraft(); }
  });
  var findPlace = root.NeedMapPlaceSearch(placeInput.getAttribute("data-search-url"), root.NeedMapNetwork.request);
  function setStatus(message, type) { statusMessage.textContent = message; statusMessage.className = "form-status " + (type || ""); }
  function setLocationStatus(message, type) { locationStatus.textContent = message; locationStatus.className = "location-status " + (type || ""); }
  function updateCount() { byId("summary-count").textContent = summary.value.length + " / 280"; }
  function values() { return { category: byId("category").value, severity: byId("severity").value, summary: summary.value, location: location }; }
  function saveDraft() {
    if (!storage) { draftStatus.textContent = "Keep this page open to keep your draft. Saving on this phone is unavailable."; return; }
    var data = values();
    data.savedAt = new Date().getTime();
    data.attempt = submissions.getAttempt();
    try {
      storage.setItem(storageKey, JSON.stringify(data));
      draftStatus.textContent = "Draft saved on this phone for 7 days. Clear form removes it. Nothing is sent until you submit.";
    } catch (error) {
      storage = null;
      draftStatus.textContent = "Keep this page open to keep your draft. Saving on this phone is unavailable.";
    }
  }
  function fieldTarget(name) { return byId(name === "location" ? "location-button" : name); }
  function clearErrors() {
    errorSummary.hidden = true;
    while (errorList.firstChild) errorList.removeChild(errorList.firstChild);
    ["category", "severity", "summary", "location"].forEach(function (name) {
      fieldTarget(name).removeAttribute("aria-invalid");
      byId(name + "-error").textContent = "";
    });
  }
  function showErrors(errors) {
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
    errorSummary.hidden = false;
    errorSummary.focus();
  }
  function cancelLocationRequest() {
    locationRequest++;
    locating = false;
    locationButton.disabled = submitting;
    locationButton.textContent = "Use my location";
  }
  function clearSearch() {
    searchRequest++;
    searchButton.disabled = submitting;
    searchButton.textContent = "Find place";
    while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
    searchStatus.textContent = "";
  }
  function selectLocation(grid, message) {
    cancelLocationRequest();
    clearSearch();
    location = grid;
    locationButton.removeAttribute("aria-invalid");
    byId("location-error").textContent = "";
    setLocationStatus(message + " Only the approximate map area will be shared.", "success");
    saveDraft();
  }
  function clearLocation() {
    cancelLocationRequest();
    clearSearch();
    location = null;
    setLocationStatus("No location added yet.");
    saveDraft();
  }
  function requestLocation() {
    if (submitting || locating) return;
    clearSearch();
    // An explicit replacement must never silently submit an older area.
    location = null;
    saveDraft();
    if (!navigator.geolocation) {
      setLocationStatus("Location is unavailable on this device. Search for a town or neighbourhood below.", "error");
      return;
    }
    var request = ++locationRequest;
    locating = true;
    locationButton.disabled = true;
    locationButton.textContent = "Finding location…";
    setLocationStatus("Allow location access when your browser asks. You can also search below.");
    try {
      navigator.geolocation.getCurrentPosition(function (position) {
        if (request !== locationRequest || submitting) return;
        try { selectLocation(model.createGridLocation(position.coords.latitude, position.coords.longitude), "Your approximate location is ready."); }
        catch (error) { cancelLocationRequest(); setLocationStatus("Your device returned an invalid location. Try again or search below.", "error"); }
      }, function (error) {
        if (request !== locationRequest || submitting) return;
        cancelLocationRequest();
        setLocationStatus(error.code === 1 ? "Location permission was denied. Enable it in browser settings or search for a nearby place below." : "Your location could not be found. Try again or search for a nearby place below.", "error");
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
    } catch (error) {
      cancelLocationRequest();
      setLocationStatus("Location is unavailable. Search for a town or neighbourhood below.", "error");
    }
  }
  function searchPlace() {
    if (submitting || searchButton.disabled) return;
    cancelLocationRequest();
    clearSearch();
    if (navigator.onLine === false) { searchStatus.textContent = "You are offline. Reconnect to search for a place."; return; }
    var request = ++searchRequest;
    searchButton.disabled = true;
    searchButton.textContent = "Searching…";
    searchStatus.textContent = "Looking for matching places…";
    findPlace(placeInput.value, function (error, results) {
      if (request !== searchRequest || submitting) return;
      searchButton.disabled = false;
      searchButton.textContent = "Find place";
      if (error) { searchStatus.textContent = error.message; return; }
      searchStatus.textContent = results.length ? "Choose the place nearest to the concern:" : "No matching places. Add the town, region or country and try again.";
      results.forEach(function (result) {
        var item = document.createElement("li");
        var button = document.createElement("button");
        button.type = "button";
        button.className = "place-result";
        button.textContent = result.label;
        button.addEventListener("click", function () {
          if (submitting) return;
          selectLocation(result.location, "Selected place centre: " + result.label + ", rounded for privacy.");
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
    setStatus("");
    setLocationStatus("No location added yet.");
    try { if (storage) storage.removeItem(storageKey); } catch (error) { storage = null; }
    draftStatus.textContent = "No draft saved. Your entries will stay on this phone until sent or cleared.";
    root.setTimeout(updateCount, 0);
  });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submitting) return;
    clearErrors();
    var result = model.validateReport(values());
    if (!result.report) { setStatus(""); showErrors(result.errors); return; }
    if (navigator.onLine === false) {
      saveDraft();
      setStatus("You are offline. Your entries are still here. Reconnect, then select Submit report.", "error");
      statusMessage.focus();
      return;
    }
    submitting = true;
    cancelLocationRequest();
    clearSearch();
    lockForm(true);
    form.setAttribute("aria-busy", "true");
    submitButton.textContent = "Submitting…";
    setStatus("Submitting your report. Keep this page open until confirmation appears.");
    var slowTimer = root.setTimeout(function () { setStatus("Still waiting for confirmation. Keep this page open. If the request times out, you can retry without creating a duplicate."); }, 15000);
    submissions.submit(result.report, function (error, reference) {
      root.clearTimeout(slowTimer);
      submitting = false;
      lockForm(false);
      form.removeAttribute("aria-busy");
      submitButton.textContent = "Submit report";
      if (!error) {
        form.reset();
        setStatus("Report received. Reference " + reference.slice(0, 8).toUpperCase() + ". It is available for review in the demonstration workspace.", "success");
      } else {
        saveDraft();
        var unavailable = error.status === 403 || error.code === "OPERATION_NOT_ALLOWED";
        setStatus(unavailable ? "The reporting service is temporarily unavailable. Your entries are still here. Try again later." : "Submission could not be confirmed. Your entries are still here. Check your connection and select Submit report to retry.", "error");
      }
      statusMessage.focus();
    });
  });
  function updateConnectionStatus() { byId("connection-status").hidden = navigator.onLine !== false; }
  root.addEventListener("online", updateConnectionStatus);
  root.addEventListener("offline", updateConnectionStatus);
  root.addEventListener("beforeunload", function (event) { if (submitting) { event.preventDefault(); event.returnValue = ""; } });
  if (draft) {
    fieldNames.forEach(function (name) { if (typeof draft[name] === "string") byId(name).value = draft[name].slice(0, name === "summary" ? 280 : 40); });
    if (draft.location && model.isValidLocation(draft.location.latitude, draft.location.longitude)) {
      location = model.createGridLocation(draft.location.latitude, draft.location.longitude);
      setLocationStatus("Your saved approximate area is ready. Update it if the concern is elsewhere.", "success");
    }
    draftStatus.textContent = "Draft restored from this phone. Nothing has been sent by reopening this page.";
  } else if (!storage) draftStatus.textContent = "Keep this page open to keep your draft. Saving on this phone is unavailable.";
  updateCount();
  updateConnectionStatus();
  byId("loading-status").hidden = true;
  submitButton.disabled = false;
}(window, document, navigator));

/* Small, dependency-free localization runtime for the public ES5 form. */
(function (root, document, navigator) {
  "use strict";
  var STORAGE_KEY = "needmap-language-v1";
  var IP_ENDPOINT = "https://get.geojs.io/v1/ip/country.json";
  var PACK_TIMEOUT = 8000;
  var DETECTION_TIMEOUT = 3500;
  var RTL = { ar: true, ur: true };
  var LANGUAGES = [
    { code: "en", name: "English", search: "English" },
    { code: "es", name: "Espa\u00f1ol", search: "Spanish Espanol" },
    { code: "fr", name: "Fran\u00e7ais", search: "French Francais" },
    { code: "pt", name: "Portugu\u00eas", search: "Portuguese Portugues" },
    { code: "ar", name: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", search: "Arabic Arabia" },
    { code: "zh-Hans", name: "\u7b80\u4f53\u4e2d\u6587", search: "Chinese Simplified Mandarin" },
    { code: "zh-Hant", name: "\u7e41\u9ad4\u4e2d\u6587", search: "Chinese Traditional Mandarin" },
    { code: "hi", name: "\u0939\u093f\u0928\u094d\u0926\u0940", search: "Hindi" },
    { code: "bn", name: "\u09ac\u09be\u0982\u09b2\u09be", search: "Bengali Bangla" },
    { code: "ur", name: "\u0627\u0631\u062f\u0648", search: "Urdu" },
    { code: "ru", name: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439", search: "Russian Russkiy" },
    { code: "de", name: "Deutsch", search: "German Deutsch" },
    { code: "id", name: "Bahasa Indonesia", search: "Indonesian Bahasa" },
    { code: "ja", name: "\u65e5\u672c\u8a9e", search: "Japanese Nihongo" },
    { code: "ko", name: "\ud55c\uad6d\uc5b4", search: "Korean Hanguk" },
    { code: "vi", name: "Ti\u1ebfng Vi\u1ec7t", search: "Vietnamese Tieng Viet" },
    { code: "tr", name: "T\u00fcrk\u00e7e", search: "Turkish Turkce" },
    { code: "sw", name: "Kiswahili", search: "Swahili Kiswahili" }
  ];
  var KEYS = [
    "metaDescription", "pageTitle", "skipForm", "demoBanner", "brandSubtitle", "modeLabelLight",
    "eyebrow", "mainHeading", "intro", "privacyStrong", "privacyRest", "connectionLabel",
    "connectionAuto", "connectionSlow", "modeInitial", "preferenceRemembered", "formHeading",
    "formRequired", "noScript", "loading", "offlineNotice", "errorHeading", "reportDetails",
    "concernHeading", "categoryLabel", "categoryChoose", "categoryHealthcare", "categoryWater",
    "categoryTransportation", "categoryEmergency", "categoryFood", "categoryInternet", "categoryOther",
    "severityLabel", "severityChoose", "severityLow", "severityMedium", "severityHigh", "severityHelp",
    "locationHeading", "locationHelp", "useLocation", "clearLocation", "noLocation", "placeLabel",
    "placeHelp", "placePlaceholder", "findPlace", "matchingPlaces", "placeAttribution",
    "descriptionHeading", "summaryLabel", "summaryHelp", "summaryPlaceholder", "draftInitial",
    "submitReport", "clearForm", "publicNotice", "openMap", "mapReadyRest", "emergencyStrong",
    "emergencyRest", "footer", "languageButton", "languageDialog", "languageSearch", "languageEmpty",
    "languageLoadError", "browserUnsupported", "modeReasonManual", "modeReasonOffline",
    "modeReasonSaveData", "modeReasonSlow", "modeReasonDevice", "modeReasonPageSlow", "modeSlowDetail",
    "modeFast", "modeImproved", "modeNoStorage", "draftNoStorage", "draftSaved", "draftCleared",
    "draftRestored", "locationSharedSuffix", "locationUnavailableDevice", "locationFinding",
    "locationPermissionPrompt", "locationReady", "locationInvalid", "locationDenied", "locationNotFound",
    "locationUnavailable", "searchOffline", "searching", "searchLooking", "searchChoose", "searchNone",
    "selectedPlace", "offlineSubmit", "submitting", "submittingStatus", "stillWaiting",
    "reportReceivedStay", "reportReceivedOpening", "reportReceivedLink", "reportingUnavailable",
    "submissionUnconfirmed", "savedLocation", "errorCategory", "errorSeverity", "errorSummaryRequired",
    "errorSummaryLength", "errorPhone", "errorEmail", "errorAddress", "errorLocation", "placeInputError",
    "placeWait", "placeUnavailable", "placeInvalid", "modeLabelFull"
  ];
  var ENGLISH = [
    "Share an anonymous service-access concern with NeedMap. A small, text-only form for slow connections.",
    "Report a concern | NeedMap Community", "Skip to report form", "Demonstration \u00b7 Not an official government service",
    "Community reporting", "Lightweight community form", "A concern today. Better planning tomorrow.",
    "What could be easier to reach?", "Tell us about a service your community needs. No account, photos or downloads required.",
    "Keep it anonymous.", "Reports are public. Leave out names, contact details, home addresses and medical information. Locations are rounded to an approximate map area.",
    "Connection mode", "Automatic", "Slow connection mode", "The form adapts to your connection and device. Slow connection mode keeps you here after submission.",
    "Your choice is remembered on this device.", "Your community report", "All three sections are required. This form submits demonstration data.",
    "JavaScript is needed to send a report. Enable it and reload this page. The form uses a small script without any large libraries.",
    "Loading the form. If this message remains, reload when your connection improves or try another browser.",
    "You are offline. You can keep writing. Reconnect and select Submit report when ready.", "Check the following fields", "Report details",
    "Service concern", "Service category", "Select a service", "Healthcare (including medication)", "Water or sanitation", "Transportation",
    "Emergency-response access", "Food access", "Internet or broadband", "Other essential service", "How much does this affect access?",
    "Select an urgency level", "Low \u2014 an ongoing concern", "Medium \u2014 regularly affects access", "High \u2014 needs timely review",
    "For planning only. Reports do not trigger an emergency response.", "Approximate location",
    "Near the concern? Let your phone find the area. Your precise location stays on your device. Device accuracy may vary.",
    "Use my location", "Clear location", "No location added yet.", "Or find a nearby town or neighbourhood",
    "Include the region or country. Search selects the approximate centre of a place. Search text goes to OpenStreetMap; it is not included in your report. Avoid home addresses.",
    "Town, region or country", "Find place", "Matching places", "Place search:", "Describe the concern",
    "What makes the service hard to reach?", "Use general details, without personal information. Maximum 280 characters.",
    "The nearest pharmacy is hard to reach by bus in the evening.", "Your draft is saved on this phone for 7 days. Clear form removes it. Nothing is sent until you submit.",
    "Submit report", "Clear form", "Your report will be publicly visible in the demonstration workspace. It does not request a direct response.",
    "Open the Map page", "when you are ready. The map uses more data.", "Need emergency help?",
    "Contact your local emergency service. This form is not monitored for emergencies.", "NeedMap Community \u00b7 Better-informed community planning",
    "Language: {language}", "Choose a language", "Search languages", "No matching languages.",
    "That language could not be loaded. Check your connection and try again.", "This browser cannot send the form. Please open this page in another browser.",
    "You chose slow connection mode.", "You are currently offline.", "Your browser has data saving enabled.", "Your connection appears slow.",
    "A lighter experience may work better on this device.", "This page or report has taken a while to load.",
    "{reason} All report fields are available. After confirmation, you will stay here and can open the map yourself.",
    "After your report is confirmed, the Map page will open automatically. Choose slow connection mode to stay here.",
    "Conditions have improved. This report will still keep you here after confirmation; you can open the map yourself.",
    "Your choice applies to this visit. This browser cannot save the preference.",
    "Keep this page open to keep your draft. Saving on this phone is unavailable.",
    "Draft saved on this phone for 7 days. Clear form removes it. Nothing is sent until you submit.",
    "No draft saved. Your entries will stay on this phone until sent or cleared.",
    "Draft restored from this phone. Nothing has been sent by reopening this page.",
    "Only the approximate map area will be shared.", "Location is unavailable on this device. Search for a town or neighbourhood below.",
    "Finding location\u2026", "Allow location access when your browser asks. You can also search below.", "Your approximate location is ready.",
    "Your device returned an invalid location. Try again or search below.",
    "Location permission was denied. Enable it in browser settings or search for a nearby place below.",
    "Your location could not be found. Try again or search for a nearby place below.", "Location is unavailable. Search for a town or neighbourhood below.",
    "You are offline. Reconnect to search for a place.", "Searching\u2026", "Looking for matching places\u2026",
    "Choose the place nearest to the concern:", "No matching places. Add the town, region or country and try again.",
    "Selected place centre: {place}, rounded for privacy.", "You are offline. Your entries are still here. Reconnect, then select Submit report.",
    "Submitting\u2026", "Submitting your report. Keep this page open until confirmation appears.",
    "Still waiting for confirmation. Keep this page open. If the request times out, you can retry without creating a duplicate.",
    "Report received. Reference {reference}. Your report has been submitted. You can stay here or open the Map page when you are ready.",
    "Report received. Reference {reference}. Opening the Map page\u2026", "Report received. Reference {reference}. Use the link below to open the Map page.",
    "The reporting service is temporarily unavailable. Your entries are still here. Try again later.",
    "Submission could not be confirmed. Your entries are still here. Check your connection and select Submit report to retry.",
    "Your saved approximate area is ready. Update it if the concern is elsewhere.", "Choose a service category.", "Choose an urgency level.",
    "Describe the service-access concern.", "Use 280 characters or fewer.", "Remove the phone number before submitting.",
    "Remove the email address before submitting.", "Remove the street address before submitting.",
    "Add your approximate location or choose a nearby place.", "Enter a town or neighbourhood, with at least 3 characters.",
    "Please wait a moment before searching again.", "Place search is unavailable. Check your connection or use your device location.",
    "Place search returned an invalid response. Try again later.", "Complete community form"
  ];
  var COUNTRY_GROUPS = {
    es: "AR BO CL CO CR CU DO EC ES GQ GT HN MX NI PA PE PR PY SV UY VE",
    fr: "BF BI BJ BL CD CF CG CI CM DJ DZ FR GA GF GN GP HT KM LU MC MF MG ML MQ MR MU NC NE PF PM RE RW SC SN TD TF TG TN VU WF YT",
    pt: "AO BR CV GW MZ PT ST TL",
    ar: "AE BH DJ DZ EG EH ER IQ JO KM KW LB LY MA MR OM PS QA SA SD SO SY TD TN YE",
    "zh-Hans": "CN",
    "zh-Hant": "HK MO TW",
    hi: "IN",
    bn: "BD",
    ur: "PK",
    ru: "BY KG KZ RU TJ",
    de: "AT CH DE LI",
    id: "ID",
    ja: "JP",
    ko: "KP KR",
    vi: "VN",
    tr: "TR",
    sw: "KE TZ UG"
  };
  var countryLanguages = {};
  var supported = {};
  var messages = {};
  var current = "en";
  var ready = false;
  var callbacks = [];
  var loadSerial = 0;
  var manualSelection = false;
  var picker;
  for (var languageIndex = 0; languageIndex < LANGUAGES.length; languageIndex++) supported[LANGUAGES[languageIndex].code] = LANGUAGES[languageIndex];
  for (var groupCode in COUNTRY_GROUPS) if (Object.prototype.hasOwnProperty.call(COUNTRY_GROUPS, groupCode)) {
    var groupCountries = COUNTRY_GROUPS[groupCode].split(" ");
    for (var countryIndex = 0; countryIndex < groupCountries.length; countryIndex++) {
      var groupedCountry = groupCountries[countryIndex];
      if (!countryLanguages[groupedCountry]) countryLanguages[groupedCountry] = [];
      if (countryLanguages[groupedCountry].indexOf(groupCode) === -1) countryLanguages[groupedCountry].push(groupCode);
    }
  }
  countryLanguages.DJ = ["fr", "ar"];
  countryLanguages.SO = ["ar"];
  countryLanguages.TD = ["fr", "ar"];
  countryLanguages.KM = ["fr", "ar"];
  countryLanguages.ER = ["en", "ar"];
  countryLanguages.DZ = ["ar", "fr"];
  countryLanguages.MA = ["ar", "fr"];
  countryLanguages.MR = ["ar", "fr"];
  countryLanguages.TN = ["ar", "fr"];
  countryLanguages.SG = ["en", "zh-Hans"];
  countryLanguages.CH = ["de", "fr", "en"];
  countryLanguages.BE = ["fr", "de", "en"];
  countryLanguages.CA = ["en", "fr"];
  countryLanguages.IN = ["hi", "en"];
  countryLanguages.PK = ["ur", "en"];
  countryLanguages.KE = ["sw", "en"];
  countryLanguages.TZ = ["sw", "en"];
  for (var keyIndex = 0; keyIndex < KEYS.length; keyIndex++) messages[KEYS[keyIndex]] = ENGLISH[keyIndex];
  function interpolate(value, parameters) {
    return String(value || "").replace(/\{([a-zA-Z0-9_]+)\}/g, function (_match, name) {
      return parameters && parameters[name] !== undefined ? String(parameters[name]) : "";
    });
  }
  function t(key, parameters) { return interpolate(messages[key] || key, parameters); }
  function languageByCode(code) { return supported[code] || supported.en; }
  function countryLanguage(countryCode, preferences) {
    var candidates = countryLanguages[String(countryCode || "").toUpperCase()] || ["en"];
    preferences = preferences || (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || navigator.userLanguage || ""]);
    for (var preferenceIndex = 0; preferenceIndex < preferences.length; preferenceIndex++) {
      var rawPreference = String(preferences[preferenceIndex] || "");
      var preferred = normalizeLanguage(rawPreference);
      if (preferred === "en" && !/^en(?:-|$)/i.test(rawPreference)) continue;
      if (candidates.indexOf(preferred) !== -1) return preferred;
    }
    return candidates[0];
  }
  function normalizeLanguage(code) {
    code = String(code || "").replace(/_/g, "-");
    if (supported[code]) return code;
    var lower = code.toLowerCase();
    if (lower === "pt" || lower.indexOf("pt-") === 0) return "pt";
    if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo" || lower.indexOf("zh-hant") === 0) return "zh-Hant";
    if (lower === "zh" || lower.indexOf("zh-") === 0) return "zh-Hans";
    var base = lower.split("-")[0];
    return supported[base] ? base : "en";
  }
  function navigatorLanguage() {
    var values = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || navigator.userLanguage || "en"];
    for (var index = 0; index < values.length; index++) {
      var normalized = normalizeLanguage(values[index]);
      if (normalized !== "en" || /^en(?:-|$)/i.test(values[index])) return normalized;
    }
    return "en";
  }
  function applyPage() {
    var html = document.documentElement;
    html.setAttribute("lang", current);
    html.setAttribute("dir", RTL[current] ? "rtl" : "ltr");
    document.title = t("pageTitle");
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", t("metaDescription"));
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var index = 0; index < nodes.length; index++) nodes[index].textContent = t(nodes[index].getAttribute("data-i18n"));
    nodes = document.querySelectorAll("[data-i18n-placeholder]");
    for (index = 0; index < nodes.length; index++) nodes[index].setAttribute("placeholder", t(nodes[index].getAttribute("data-i18n-placeholder")));
    nodes = document.querySelectorAll("[data-i18n-aria-label]");
    for (index = 0; index < nodes.length; index++) nodes[index].setAttribute("aria-label", t(nodes[index].getAttribute("data-i18n-aria-label")));
    updatePicker();
  }
  function dispatchChange() {
    var event;
    try { event = new root.CustomEvent("needmap-languagechange", { detail: { language: current } }); }
    catch (error) { event = document.createEvent("Event"); event.initEvent("needmap-languagechange", false, false); event.detail = { language: current }; }
    root.dispatchEvent(event);
  }
  function finishReady() {
    if (ready) return;
    ready = true;
    applyPage();
    createPicker();
    var pending = callbacks.slice(0);
    callbacks = [];
    for (var index = 0; index < pending.length; index++) pending[index]();
    dispatchChange();
  }
  function install(code, packMessages, notify) {
    var installed = {};
    for (var index = 0; index < KEYS.length; index++) installed[KEYS[index]] = packMessages[index];
    messages = installed;
    current = code;
    if (!ready) finishReady();
    else { applyPage(); if (notify) dispatchChange(); }
  }
  function loadPack(code, callback) {
    code = normalizeLanguage(code);
    if (code === "en") { callback(null, ENGLISH); return; }
    var request = new root.XMLHttpRequest();
    var completed = false;
    var timer = root.setTimeout(function () { if (!completed) { completed = true; try { request.abort(); } catch (ignore) {} callback(new Error("timeout")); } }, PACK_TIMEOUT);
    function finish(error, value) {
      if (completed) return;
      completed = true;
      root.clearTimeout(timer);
      callback(error, value);
    }
    try {
      request.open("GET", "./locales/" + code + ".json", true);
      request.setRequestHeader("Accept", "application/json");
      request.onreadystatechange = function () {
        if (request.readyState !== 4) return;
        if (request.status < 200 || request.status >= 300) { finish(new Error("status")); return; }
        try {
          var value = JSON.parse(request.responseText);
          if (!value || value.locale !== code || Object.prototype.toString.call(value.messages) !== "[object Array]" || value.messages.length !== KEYS.length) throw new Error("invalid");
          for (var index = 0; index < value.messages.length; index++) if (typeof value.messages[index] !== "string" || !value.messages[index]) throw new Error("invalid");
          finish(null, value.messages);
        } catch (error) { finish(error); }
      };
      request.onerror = function () { finish(new Error("network")); };
      request.send(null);
    } catch (error) { finish(error); }
  }
  function select(code, remember, callback) {
    if (remember) manualSelection = true;
    var serial = ++loadSerial;
    loadPack(code, function (error, pack) {
      if (serial !== loadSerial) return;
      if (error) { if (callback) callback(error); return; }
      code = normalizeLanguage(code);
      install(code, pack, ready);
      if (remember) try { root.localStorage.setItem(STORAGE_KEY, code); } catch (storageError) {}
      if (callback) callback(null);
    });
  }
  function savedLanguage() {
    try {
      var value = root.localStorage.getItem(STORAGE_KEY);
      return value && supported[value] ? value : null;
    } catch (error) { return null; }
  }
  function detectAutomatic(callback) {
    if (navigator.onLine === false || !root.XMLHttpRequest) { callback(navigatorLanguage()); return; }
    var request = new root.XMLHttpRequest();
    var completed = false;
    var timer = root.setTimeout(function () { finish(); }, DETECTION_TIMEOUT);
    function finish(countryCode) {
      if (completed) return;
      completed = true;
      root.clearTimeout(timer);
      try { request.abort(); } catch (ignore) {}
      callback(countryCode ? countryLanguage(countryCode) : navigatorLanguage());
    }
    try {
      request.open("GET", IP_ENDPOINT, true);
      request.setRequestHeader("Accept", "application/json");
      request.onreadystatechange = function () {
        if (request.readyState !== 4) return;
        if (request.status < 200 || request.status >= 300) { finish(); return; }
        try { var value = JSON.parse(request.responseText); finish(value && value.country_code); }
        catch (error) { finish(); }
      };
      request.onerror = function () { finish(); };
      request.send(null);
    } catch (error) { finish(); }
  }
  function updatePicker() {
    if (!picker) return;
    var selected = languageByCode(current);
    picker.button.textContent = t("languageButton", { language: selected.name });
    picker.panel.setAttribute("aria-label", t("languageDialog"));
    picker.search.setAttribute("placeholder", t("languageSearch"));
    picker.search.setAttribute("aria-label", t("languageSearch"));
    picker.empty.textContent = t("languageEmpty");
    for (var index = 0; index < picker.options.length; index++) {
      var option = picker.options[index];
      if (option.code === current) option.button.setAttribute("aria-current", "true");
      else option.button.removeAttribute("aria-current");
    }
  }
  function filterPicker() {
    var query = String(picker.search.value || "").toLowerCase().replace(/^\s+|\s+$/g, "");
    var visible = 0;
    for (var index = 0; index < picker.options.length; index++) {
      var option = picker.options[index];
      var matches = !query || (option.name + " " + option.search + " " + option.code).toLowerCase().indexOf(query) !== -1;
      option.item.hidden = !matches;
      if (matches) visible++;
    }
    picker.empty.hidden = visible !== 0;
  }
  function closePicker(focusButton) {
    if (!picker || picker.panel.hidden) return;
    picker.panel.hidden = true;
    picker.button.setAttribute("aria-expanded", "false");
    if (focusButton) picker.button.focus();
  }
  function createPicker() {
    if (picker) return;
    var host = document.getElementById("language-picker");
    if (!host) return;
    var button = document.getElementById("language-button");
    var panel = document.getElementById("language-panel");
    var search = document.getElementById("language-search");
    var list = document.getElementById("language-list");
    var empty = document.getElementById("language-empty");
    var error = document.getElementById("language-error");
    picker = { host: host, button: button, panel: panel, search: search, list: list, empty: empty, error: error, options: [] };
    for (var index = 0; index < LANGUAGES.length; index++) (function (language) {
      var item = document.createElement("li");
      var optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "language-option";
      optionButton.textContent = language.name;
      optionButton.setAttribute("lang", language.code);
      optionButton.setAttribute("dir", RTL[language.code] ? "rtl" : "ltr");
      optionButton.addEventListener("click", function () {
        error.textContent = "";
        optionButton.disabled = true;
        select(language.code, true, function (loadError) {
          optionButton.disabled = false;
          if (loadError) { error.textContent = t("languageLoadError"); return; }
          closePicker(true);
        });
      });
      item.appendChild(optionButton);
      list.appendChild(item);
      picker.options.push({ code: language.code, name: language.name, search: language.search, item: item, button: optionButton });
    }(LANGUAGES[index]));
    button.addEventListener("click", function () {
      var opening = panel.hidden;
      panel.hidden = !opening;
      button.setAttribute("aria-expanded", opening ? "true" : "false");
      error.textContent = "";
      if (opening) { search.value = ""; filterPicker(); search.focus(); }
    });
    search.addEventListener("input", filterPicker);
    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.keyCode === 27) { event.preventDefault(); closePicker(true); return; }
      var key = event.key || "";
      var code = event.keyCode;
      if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End" && code !== 40 && code !== 38 && code !== 36 && code !== 35) return;
      var visible = [];
      for (var optionIndex = 0; optionIndex < picker.options.length; optionIndex++) if (!picker.options[optionIndex].item.hidden) visible.push(picker.options[optionIndex].button);
      if (!visible.length) return;
      var activeIndex = -1;
      for (optionIndex = 0; optionIndex < visible.length; optionIndex++) if (visible[optionIndex] === document.activeElement) activeIndex = optionIndex;
      if (key === "Home" || code === 36) activeIndex = 0;
      else if (key === "End" || code === 35) activeIndex = visible.length - 1;
      else if (key === "ArrowUp" || code === 38) activeIndex = activeIndex <= 0 ? visible.length - 1 : activeIndex - 1;
      else activeIndex = activeIndex >= visible.length - 1 ? 0 : activeIndex + 1;
      event.preventDefault();
      visible[activeIndex].focus();
    });
    document.addEventListener("click", function (event) { if (picker && !host.contains(event.target)) closePicker(false); });
    updatePicker();
  }
  root.NeedMapI18n = {
    ready: function (callback) { if (ready) callback(); else callbacks.push(callback); },
    t: t,
    setLanguage: function (code, callback) { select(code, true, callback); },
    getLanguage: function () { return current; },
    getLanguages: function () { return LANGUAGES.slice(0); },
    normalizeLanguage: normalizeLanguage,
    countryLanguage: countryLanguage,
    keys: KEYS.slice(0),
    apply: applyPage,
    storageKey: STORAGE_KEY
  };
  // English and the picker are usable immediately. Region detection and the
  // selected compact pack load in the background without blocking the form.
  finishReady();
  var saved = savedLanguage();
  if (saved) select(saved, false, function (error) { if (error) install("en", ENGLISH, false); });
  else detectAutomatic(function (code) {
    if (manualSelection) return;
    select(code, false, function (error) { if (error && !manualSelection) install("en", ENGLISH, false); });
  });
}(window, document, navigator));

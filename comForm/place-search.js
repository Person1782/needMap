(function (root) {
  "use strict";
  function createPlaceSearch(endpoint, send, now, translate) {
    var cache = {};
    var lastRequest = 0;
    var pending = false;
    now = now || function () { return new Date().getTime(); };
    function failure(key, fallback) {
      var error = new Error(translate ? translate(key) : fallback);
      error.translationKey = key;
      return error;
    }
    return function (query, callback) {
      query = String(query || "").replace(/^\s+|\s+$/g, "");
      if (query.length < 3 || query.length > 120) { callback(failure("placeInputError", "Enter a town or neighbourhood, with at least 3 characters.")); return; }
      var key = query.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(cache, key)) { callback(null, cache[key]); return; }
      if (pending || (lastRequest && now() - lastRequest < 1100)) { callback(failure("placeWait", "Please wait a moment before searching again.")); return; }
      lastRequest = now();
      pending = true;
      send("GET", endpoint + (endpoint.indexOf("?") === -1 ? "?" : "&") + "format=jsonv2&limit=3&addressdetails=0&q=" + encodeURIComponent(query), null, null, function (error, data) {
        pending = false;
        if (error) { callback(failure("placeUnavailable", "Place search is unavailable. Check your connection or use your device location.")); return; }
        if (Object.prototype.toString.call(data) !== "[object Array]") { callback(failure("placeInvalid", "Place search returned an invalid response. Try again later.")); return; }
        var results = [];
        data.slice(0, 3).forEach(function (place) {
          if (!place || !place.display_name || place.lat === "" || place.lon === "" || place.lat === null || place.lon === null || place.lat === undefined || place.lon === undefined) return;
          var lat = Number(place.lat);
          var lon = Number(place.lon);
          if (!root.NeedMapForm.isValidLocation(lat, lon)) return;
          results.push({ label: String(place.display_name).slice(0, 300), location: root.NeedMapForm.createGridLocation(lat, lon) });
        });
        cache[key] = results;
        callback(null, results);
      });
    };
  }
  root.NeedMapPlaceSearch = createPlaceSearch;
}(window));

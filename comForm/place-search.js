(function (root) {
  "use strict";
  function createPlaceSearch(endpoint, send, now) {
    var cache = {};
    var lastRequest = 0;
    var pending = false;
    now = now || function () { return new Date().getTime(); };
    return function (query, callback) {
      query = String(query || "").replace(/^\s+|\s+$/g, "");
      if (query.length < 3 || query.length > 120) { callback(new Error("Enter a town or neighbourhood, with at least 3 characters.")); return; }
      var key = query.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(cache, key)) { callback(null, cache[key]); return; }
      if (pending || (lastRequest && now() - lastRequest < 1100)) { callback(new Error("Please wait a moment before searching again.")); return; }
      lastRequest = now();
      pending = true;
      send("GET", endpoint + (endpoint.indexOf("?") === -1 ? "?" : "&") + "format=jsonv2&limit=3&addressdetails=0&q=" + encodeURIComponent(query), null, null, function (error, data) {
        pending = false;
        if (error) { callback(new Error("Place search is unavailable. Check your connection or use your device location.")); return; }
        if (Object.prototype.toString.call(data) !== "[object Array]") { callback(new Error("Place search returned an invalid response. Try again later.")); return; }
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

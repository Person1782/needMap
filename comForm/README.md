# NeedMap community form

A small, text-first form for limited bandwidth and older browsers. The production build has one classic ES5 script, system fonts, and no map, Firebase SDK, web fonts or third-party script downloads. External requests happen only for a user-triggered place search or report submission.

```sh
npm install
npm run dev       # http://127.0.0.1:5173
npm test
npm run build     # comForm/dist
npm run preview   # http://127.0.0.1:4173
```

`build.mjs` verifies all browser source and the minified bundle parse as ES5. The HTML, JavaScript and CSS total about 30 KB uncompressed, or about 11 KB with gzip (plus the small favicon). Hosting must enable compression to achieve the compressed transfer size. Development serves separate source scripts; production combines them. No modern JavaScript polyfill bundle is required.

## Automatic connection handling and the Map page

The complete report fields always remain available. The form automatically uses available browser hints: data saving, effective 2G/3G, estimated downlink below 1.5 Mbps, round-trip time of at least 500 ms, memory of 2 GB or less, or two or fewer logical processors. Wi-Fi by itself is not evidence of a fast connection. These are conservative product heuristics, not measured device performance. The [Network Information API](https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation) is unavailable in some major browsers; no browser or operating-system sniffing is used.

The form also checks already-downloaded document/script/stylesheet timings (2.5 seconds or more) and a submission that takes at least 8 seconds. It performs no speed-test requests, downloads no map assets, and transmits none of these device hints. With no usable hints, the lightweight complete form remains available. Detection is automatic and does not read or save a connection-mode preference.

After a confirmed successful submission, a visit without a detected slow condition opens the Map page. When a slow condition is detected, the form stays on the received-report confirmation with an explicit **Open the Map page** link. Any slow condition observed while a report is sending keeps that submission on the confirmation, even if the connection improves before completion. Offline and failed requests never redirect or count as successful; reconnecting never sends a draft automatically.

For development, run the Map app separately on port 5174; the form on port 5173 automatically links there. Preview uses the matching ports 4173 and 4174. Production defaults to `/map/` on the form's origin. This repository does not configure hosting for that path: host the built Map app there or configure its actual HTTPS destination when building the form:

```sh
NEEDMAP_MAP_URL=https://map.example.org/ npm run build
```

The setting accepts an HTTPS URL or a root-relative path and applies to both automatic navigation and the explicit map link. No report coordinates or private fields are included in the navigation URL. A separately hosted form must set this value before deployment.

## Location and privacy

“Use my location” asks for device permission only after a user selects it. Coordinates are immediately rounded before local storage or submission. “Find place” is an explicit text search with at most three results and a separate selection step; its query and result labels are not saved in the public report. A search result represents a place centre, which may be far from the actual concern. The existing `approximate_grid_500m` schema value describes grid spacing, not measured location accuracy; longitude spacing varies by latitude and device accuracy varies.

Search uses the endpoint in `index.html`'s `data-search-url`, currently Nominatim. Results are cached in memory, requests are throttled in each browser, and OpenStreetMap attribution is visible. The [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) limits aggregate traffic across the whole application to one request per second; production with concurrent users needs a shared rate-limited/caching proxy or a suitable provider. Change the HTML endpoint to switch services with a compatible response format. There is no autocomplete or background search.

## Drafts and confirmed delivery

Drafts remain on the current device for seven days when local storage is available. They contain only the rounded area, form fields, and retry reference. Clear form removes the draft. Reopening the page or reconnecting never sends it automatically. The form remains usable without local storage, with an explicit message that the page must stay open to retain the draft.

Submission uses [Firebase anonymous sign-in REST](https://firebase.google.com/docs/reference/rest/auth#section-sign-in-anonymously), then an authenticated [Firestore commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit) with `currentDocument.exists: false` and a `REQUEST_TIME` server timestamp. The existing exact report schema and `isSynthetic: true` demonstration flag are preserved; no anonymous UID is written to the report.

The retry reference is saved before the network request. Every attempt reads that reference before creating a report, allowing a lost acknowledgement to be recognized after a reload. Matching report fields and a saved server timestamp are required before treating an existing record as confirmed. Requests have a 30-second timeout and an additional watchdog for older XHR implementations. Failed, offline and unconfirmed submissions preserve the draft for an explicit retry.

## Compatibility and verification limits

The client avoids ES modules, Promise, fetch, Web Crypto requirements, CSS Grid and CSS custom properties. It needs ES5 JavaScript, JSON, DOM event handling, and cross-origin XMLHttpRequest. No-JavaScript browsers can read the instructions but cannot submit. HTTPS and a browser capable of negotiating current Firebase TLS are required; some very old phones cannot meet those requirements. Device location may be unavailable or denied, in which case place search remains available.

Automated tests cover validation and private-data filters, rounded locations, denied/replaced/stale location requests, place-result selection, automatic connection handling, ignored legacy preferences, unavailable capability hints, slow/offline failures, condition changes during submission, confirmed-only navigation, retry after reload, blocked local storage, authentication/schema/timestamp payloads, lost acknowledgements, and ES5 syntax. The unit tests use mocked requests. Seven additional checks previously passed against isolated Firebase Auth and Firestore emulators with the repository rules: anonymous submission, server timestamps, duplicate prevention across reloads, lost-acknowledgement recovery, conflicting-record rejection, and rejection of unauthenticated or schema-invalid writes.

The earlier production form and place search were checked in Chrome, including a 320-pixel-wide viewport. The new adaptive behavior is covered by the automated tests above; physical old-phone compatibility and production Firebase write/rules integration remain unverified. No production reports were submitted for this change.

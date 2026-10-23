# NeedMap community form

A small, text-first form for limited bandwidth and older browsers. The production build has one classic ES5 script, system fonts, and no map, Firebase SDK, web fonts or third-party script downloads. External requests happen only for a user-triggered place search or report submission.

```sh
npm install
npm run dev       # http://127.0.0.1:5173
npm test
npm run build     # comForm/dist
npm run preview   # http://127.0.0.1:4173
```

`build.mjs` verifies all browser source and the minified bundle parse as ES5. The HTML, JavaScript and CSS total about 26 KB uncompressed, or about 10 KB with gzip (plus the small favicon). Hosting must enable compression to achieve the compressed transfer size. Development serves separate source scripts; production combines them. No modern JavaScript polyfill bundle is required.

## Location and privacy

“Use my location” asks for device permission only after a user selects it. Coordinates are immediately rounded before local storage or submission. “Find place” is an explicit text search with at most three results and a separate selection step; its query and result labels are not saved in the public report. A search result represents a place centre, which may be far from the actual concern. The existing `approximate_grid_500m` schema value describes grid spacing, not measured location accuracy; longitude spacing varies by latitude and device accuracy varies.

Search uses the endpoint in `index.html`'s `data-search-url`, currently Nominatim. Results are cached in memory, requests are throttled in each browser, and OpenStreetMap attribution is visible. The [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) limits aggregate traffic across the whole application to one request per second; production with concurrent users needs a shared rate-limited/caching proxy or a suitable provider. Change the HTML endpoint to switch services with a compatible response format. There is no autocomplete or background search.

## Drafts and confirmed delivery

Drafts remain on the current device for seven days when local storage is available. They contain only the rounded area, form fields, and retry reference. Clear form removes the draft. Reopening the page or reconnecting never sends it automatically. The form remains usable without local storage, with an explicit message that the page must stay open to retain the draft.

Submission uses [Firebase anonymous sign-in REST](https://firebase.google.com/docs/reference/rest/auth#section-sign-in-anonymously), then an authenticated [Firestore commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit) with `currentDocument.exists: false` and a `REQUEST_TIME` server timestamp. The existing exact report schema and `isSynthetic: true` demonstration flag are preserved; no anonymous UID is written to the report.

The retry reference is saved before the network request. Every attempt reads that reference before creating a report, allowing a lost acknowledgement to be recognized after a reload. Matching report fields and a saved server timestamp are required before treating an existing record as confirmed. Requests have a 30-second timeout and an additional watchdog for older XHR implementations. Failed, offline and unconfirmed submissions preserve the draft for an explicit retry.

## Compatibility and verification limits

The client avoids ES modules, Promise, fetch, Web Crypto requirements, CSS Grid and CSS custom properties. It needs ES5 JavaScript, JSON, DOM event handling, and cross-origin XMLHttpRequest. No-JavaScript browsers can read the instructions but cannot submit. HTTPS and a browser capable of negotiating current Firebase TLS are required; some very old phones cannot meet those requirements. Device location may be unavailable or denied, in which case place search remains available.

Automated tests cover validation and private-data filters, rounded locations, denied/replaced/stale location requests, place-result selection, slow/offline failures, retry after reload, blocked local storage, authentication/schema/timestamp payloads, lost acknowledgements, and ES5 syntax. The unit tests use mocked requests. Seven additional checks passed against isolated Firebase Auth and Firestore emulators with the repository rules: anonymous submission, server timestamps, duplicate prevention across reloads, lost-acknowledgement recovery, conflicting-record rejection, and rejection of unauthenticated or schema-invalid writes.

The production form and place search were also checked in Chrome, including a 320-pixel-wide viewport. No production reports were submitted. Physical old-phone compatibility and production Firebase write/rules integration remain unverified.

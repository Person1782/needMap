# NeedMap — Community service planning

NeedMap connects anonymous reports about service access with a practical planning workspace. The community form and dashboard are independent websites sharing one Firebase project.

## Explore and Plan

**Explore** combines the map and report library. Search by need or place, filter by category and urgency, and optionally limit reports to the map area. Proposed service markers link directly to a plan. Nearby existing services can be requested from a candidate's map popup.

**Plan** uses one shared set of region-based service candidates. Evidence analysis runs when Plan opens; switching tabs does not repeat it. Each candidate has editable population, uptake, travel, capital, operating-cost, contingency and delivery assumptions. A before/after preview calculates travel-time change, expected users, total weekly hours, first-year investment and sequential delivery time. Plans can be exported to CSV or printed, and drafts persist on the device when storage is available.

There are no AI confidence percentages, staff sign-in/workflow controls, alert panels or browser notifications in these two views. Existing private staff collections and their access rules are unchanged; the dashboard no longer connects to them.

## Public reporting form

The form is text-first, uses system fonts and a single classic ES5 script, and does not download a map or the Firebase JavaScript SDK. Its production HTML, JavaScript and CSS total about **26 KB uncompressed / 10 KB gzip**, plus a small icon. The server must enable compression to obtain the compressed size.

Device location is requested on the user's action. If it is unavailable or declined, the user can search for a town or neighbourhood and select its centre. Coordinates are rounded before storage or submission; no latitude/longitude entry is shown. Place search sends only the search query to the configured geocoding provider. The query and place label are not included in public reports.

Drafts last seven days on the device. Reconnection never automatically submits a report. Explicit retries reuse the same reference, and success requires confirmed delivery. See [the form documentation](comForm/README.md) for compatibility, provider capacity and retry details.

## Run locally

```sh
cd comForm
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. In a separate terminal:

```sh
cd mapSite
npm install
npm run dev
```

Open `http://127.0.0.1:5174/`. The dashboard is designed for desktop; the reporting form adapts to small screens.

Each app has `npm test`, `npm run build` and `npm run preview`. Production output lives in its own `dist/` folder. Form preview uses port 4173; dashboard preview uses port 4174. The form's custom build bundles and checks ES5 syntax; Vite's development client is not part of that production output.

## Planning evidence and limits

`mapSite/planning-references.js` contains dated primary-source references checked on October 21, 2026. The first set covers Fremont, California and relevant Northern California comparison projects: Census population, Alameda County mobile-pharmacy acquisition, Sonoma County accessible vehicles, and public clinic, water and Wi-Fi programmes. References are shown with their scope, geography and date.

Only compatible benchmark fields are prefilled. A vehicle price is not a full service-launch budget; a funding request is not a contractor quote. Citywide population is shown as context and never silently becomes the population served. Unsupported costs, operating budgets, uptake, local journey times and missing timeline stages remain empty. A separately labelled fictional example can demonstrate the calculator.

Travel savings compare entered one-way journey times, multiplied by return journeys, frequency and expected users. A worse scenario shows increased travel and zero shorter-journey beneficiaries. The calculator does not model route networks, capacity constraints, financing, inflation or causal health/economic outcomes. Currency selection labels inputs; it does not convert amounts.

## Privacy and Firebase

Reports in `incomingSignals` are publicly readable and immutable from browser clients. Anonymous Firebase authentication allows creation without collecting a name or email address. The UID is not stored on the public report. Client validation screens common personal-contact and street-address patterns; it is not a guarantee that every identifying detail is detected. The form warns against posting personal information and is not an emergency-response channel.

The report schema remains:

| Field | Meaning |
| --- | --- |
| `category`, `severity`, `summary` | Service, urgency, and a description of up to 280 characters |
| `latitude`, `longitude`, `locationGridId` | Rounded approximate location |
| `locationPrecision` | `approximate_grid_500m`: grid spacing, not measured accuracy |
| `sourceType`, `isSynthetic` | Survey source and demonstration-data label |
| `submittedAt` | Server timestamp |

A place centre may be much farther from a concern than the grid spacing. Exact device locations and geocoding labels are not published. Do not submit household details in report text.

Keep Anonymous Authentication enabled in the existing Firebase project. Firebase AI Logic supplies optional evidence analysis; local report-based candidates remain usable if it fails. Local App Check configuration remains in the ignored `mapSite/.env.local`. Production authentication/App Check and hosting are separate deployment concerns.

## Main implementation files

- `mapSite/app.js`: two-view integration, live reports, map and regions.
- `mapSite/analysis-coordinator.js`: one batched, cancellable evidence-analysis pipeline.
- `mapSite/planning-workspace.js`, `planning-model.js`, `planning-references.js`: planner UI, deterministic calculations and sourced benchmarks.
- `comForm/app.js`, `form-model.js`, `firebase-submit.js`, `place-search.js`: form, privacy validation, REST delivery and geocoding.
- `firestore.rules`: unchanged public-report and protected legacy staff access rules.

## Verification boundaries

Automated suites cover report filtering and tab navigation, stale analysis cancellation, provider fallback, planner calculations and persistence, source scope, form validation, location races, offline/retry behavior and ES5 compatibility. The REST submission path was also verified with isolated Firebase Auth and Firestore emulators, including server timestamps, duplicate prevention and rule denials. Browser rendering and provider checks do not replace physical old-phone testing. Very old devices without current HTTPS/TLS support cannot connect to Firebase.

Nominatim's public service has an application-wide rate limit; concurrent production traffic requires a shared rate-limited/cache proxy or another suitable provider. Its endpoint is configurable in the form HTML. This local implementation does not change production hosting or Firebase rules.

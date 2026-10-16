# NeedMap — Dublin HacX 2026

NeedMap helps community members anonymously report local service-access needs, and gives organizers a dashboard to view, prioritize, and respond to them — all in one place.


## The problem

Community needs — food support, supplies, transportation, emergency assistance — are hard to report and coordinate quickly. People experience access gaps every day, but those experiences are scattered, unrecorded, and invisible to the organizations that could act. The barrier was never willingness to report; it was friction and fear of being identified.

## Our solution

- A community-facing site for anonymously submitting needs
- A dashboard for organizers to track and prioritize reported needs
- Firebase-backed data handling
- A live web deployment

## How it works

1. **Report** — a community member picks a category (healthcare, water, transportation, emergency response, food, broadband, other), an urgency level (low / medium / high), and a required description of up to 280 characters.
2. **Locate** — device location is snapped to an approximate ~500 m grid cell before anything is stored. Manual demo coordinates are also accepted for testing.
3. **Scrub** — a validation layer rejects phone numbers, email addresses, and street addresses before the report is ever stored.
4. **Map it** — the signal writes to Firestore in real time as a mappable record, ready to surface on the organizer dashboard.

## Privacy by design

- **Zero-identity auth** — Firebase Anonymous Authentication issues a throwaway UID. No email, no name, no profile.
- **PII rejected at the door** — the form screens for phone numbers, emails, and street addresses at submit time and refuses identifying text.
- **Grid-rounded location** — device coordinates snap to a 0.0045° (~500 m) grid cell: enough to see the neighborhood pattern, never the household.
- The form is **not for emergencies** and says so up front.

## Repository structure

```
comForm/               # Anonymous reporting form (vanilla HTML/CSS/JS + Firebase)
  index.html           # Form UI
  app.js               # Validation, PII filter, grid geolocation, Firestore writes
  firebase-config.js   # Firebase web config (client-side by design)
  styles.css
mapSite/               # Separate live map (vanilla HTML/CSS/JS + Firebase + Leaflet)
  index.html           # Standalone map page
  app.js               # Firestore listener, Leaflet map, and analysis UI
  decision-workspace.js # Staff review, moderation, outcomes, alerts, and exports
  firebase-config.js   # Its own Firebase web config
  styles.css
firestore.rules        # Public-report and role-based staff access rules
firestore.indexes.json # Firestore index configuration
firebase.json          # Firebase CLI configuration
```

## Quick start

The form and map are independent websites. They have separate dependencies,
development servers, builds, and deployment roots. They connect to the same
Firebase project, while the form writes only to the `incomingSignals`
collection.

### comForm (the form)

```bash
cd comForm
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

### mapSite (the map view)

In a separate terminal:

```bash
cd mapSite
npm install
npm run dev
```

Open `http://127.0.0.1:5174/`.

## Data model

Reports are written to the `incomingSignals` Firestore collection:

| Field | Description |
| --- | --- |
| `category` | Service category (healthcare, water, transportation, …) |
| `severity` | Urgency: low / medium / high |
| `summary` | Required free-text description (1–280 chars, PII-screened) |
| `latitude`, `longitude` | Approximate location |
| `locationGridId` | Grid cell identifier |
| `locationPrecision` | `approximate_grid_500m` or `manual_demo_coordinate` |
| `sourceType` | `community_survey` |
| `isSynthetic` | Demo flag |
| `submittedAt` | Server timestamp |

The organizer workspace stores its shared operational state separately from
the immutable community reports:

| Collection | Purpose | Shared write access |
| --- | --- | --- |
| `staffProfiles` | Maps a Firebase user UID to an active staff role | Firebase console or Admin SDK only |
| `recommendationReviews` | Recommendation status, owner, and review note | Analyst, moderator, or admin |
| `reportModeration` | Quality review, duplicate marking, and visibility status | Moderator or admin |
| `outcomeFeedback` | Observed access change and usefulness rating | Analyst, moderator, or admin |

`incomingSignals` stays append-only from browser clients. The public dashboard
can read it, while each submission requires Firebase Anonymous Authentication,
a server timestamp, valid coordinates, and the exact form schema. Current form
submissions do not store the anonymous UID, which prevents public report reads
from linking multiple submissions to one browser identity. Because reports are publicly readable, never store names, contact
details, street addresses, or precise household locations in that collection.

## Firebase setup and staff access

Both websites use the same Firebase project but remain separate builds. In the
Firebase console, enable these Authentication sign-in providers:

1. **Anonymous** for community form submissions.
2. **Email/Password** for organizer accounts.

Create each organizer in **Authentication → Users**, copy that user's UID, then
create `staffProfiles/{uid}` in Firestore with these fields:

```text
active: true
role: "analyst"
```

Supported roles are:

| Role | Access |
| --- | --- |
| `viewer` | Read the shared staff workspace |
| `analyst` | Review recommendations and record outcomes |
| `moderator` | Analyst access plus approve, hide, or deduplicate reports |
| `admin` | All staff actions plus delete shared workflow records |

Provision and change `staffProfiles` only through the Firebase console or a
trusted Admin SDK process. The browser rules deliberately reject every client
write to that collection, so users cannot grant themselves a role.

Deploy the checked-in rules and index configuration from the repository root:

```bash
firebase login
firebase deploy --project needmap-hackathon --only firestore:rules,firestore:indexes
```

The dashboard also offers a device-local planner for demos. Its decisions stay
in that browser's local storage and are not shared or protected as staff data.

## Tech stack

- **comForm** — HTML, CSS, JavaScript, Firebase (Auth + Firestore)
- **mapSite** — HTML, CSS, JavaScript, Firebase Firestore, Leaflet, OpenStreetMap
- **Hosting** — Vercel

## Roadmap

- [x] Live map dashboard consuming `incomingSignals`
- [x] Region-aware signal clustering and placement analysis
- [x] Role-based organizer workspace with read-only access
- [x] Trend alerts, report moderation, outcome tracking, and exports

## Team

- Rishab Manas — community-site form, Firebase pipeline
- [Teammate name] — [what they built]

## Screenshots

Add 2–3 screenshots or a short demo video/GIF here.

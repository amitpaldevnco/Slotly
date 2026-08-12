# Slotly — API

An appointment booking platform. A provider publishes the services they offer and
the hours they work; a client picks an open slot and books it. The provider gets a
calendar that is always correct, and every person sees every time in their own
timezone.

This folder is the **Express / PostgreSQL API**. The React client is at
[`../../slotly-frontend/slotly`](../../slotly-frontend/slotly). The two are
genuinely separate services that happen to be versioned together: this one
renders no HTML except its own docs page.

**Start at the [repository README](../../README.md)** for the live URLs, the demo
accounts and the one-minute tour. This file is the API's own reference.

| | |
|---|---|
| **API** | <https://slotly-backend-p2r5.onrender.com/api> |
| **API reference** | <https://slotly-backend-p2r5.onrender.com/api/docs> |
| **App** | <https://slotly-navy.vercel.app> |

> Render's free tier sleeps after 15 minutes idle; the first request after a nap
> takes 20–50 seconds while the container wakes.

**Demo accounts** — password `SlotlyDemo123!` for all three. Recreate them at any
time with `npm run db:seed`.

| Role | Email | Timezone |
|---|---|---|
| Provider | `priya.provider@slotly.demo` | `Europe/London` (observes DST) |
| Provider | `arjun.provider@slotly.demo` | `Asia/Kolkata` (no DST, +05:30) |
| Client | `casey.client@slotly.demo` | `America/New_York` |

Two guarantees run through the whole build, and everything else is secondary to
them:

1. **A slot can never be double-booked.** Enforced by a PostgreSQL exclusion
   constraint, not by application code. See [No double-booking](#no-double-booking).
2. **Every time shown is the correct local time for whoever is looking.** Every
   instant is stored in UTC and converted only at the edges, for display. See
   [Time and timezones](#time-and-timezones).

---

## Contents

- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Data model](#data-model)
- [How availability is modelled](#how-availability-is-modelled)
- [No double-booking](#no-double-booking)
- [Time and timezones](#time-and-timezones)
- [Daylight saving](#daylight-saving)
- [File uploads](#file-uploads)
- [Tests](#tests)
- [API documentation](#api-documentation)
- [Decisions, and why](#decisions-and-why)
- [Known limitations](#known-limitations)

---

## Running it locally

**Prerequisites:** Node 20+, PostgreSQL 14+ (15 recommended), and a database the
app can connect to. The app creates the database itself if it does not exist.

```bash
git clone https://github.com/amitpaldevnco/Slotly.git && cd Slotly/slotly-backend/server
```

```bash
npm install && cp .env.example .env
```

Fill in `.env` (see [Environment variables](#environment-variables)), then:

```bash
npm run dev
```

The API comes up on <http://localhost:5000>. The schema is created automatically
on first boot — every statement in `config/schema.js` is `IF NOT EXISTS`, so
starting the server is the only setup step a database needs.

**Seed the demo data**

```bash
npm run db:seed
```

Creates the two providers and the demo client listed above, with services,
weekly availability, a holiday block, an extra Saturday opening and a few
existing bookings — all dated relative to today, so the demo does not go stale.
Safe to re-run: it removes only the rows it owns and recreates them.

**The frontend**

In a second terminal, `cd ../../slotly-frontend/slotly` and follow
[its README](../../slotly-frontend/slotly/README.md). It comes up on
<http://localhost:5173>, which is the origin this API's default `FRONTEND_URL`
allows.

**Run the tests**

```bash
npm test
```

115 tests, six suites. Four of them need the PostgreSQL configured above; they
namespace their own fixtures and clean up after themselves.

---

## Environment variables

Locally these live in `.env`. In production they are set in the host's dashboard
— on Render, the service's **Environment** tab. Nothing below is ever committed.

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | API port. Defaults to `5000`. A host that assigns a port (Render does) sets this itself. |
| `DATABASE_URL` | in production | Full PostgreSQL connection string. Takes precedence over the `DB_*` values below, and enables TLS automatically. |
| `DB_HOST` | locally | PostgreSQL host, e.g. `localhost`. Ignored when `DATABASE_URL` is set. |
| `DB_PORT` | no | Defaults to `5432`. |
| `DB_USER` | locally | Database user. |
| `DB_PASSWORD` | locally | Database password. |
| `DB_NAME` | locally | Database name. Created automatically if missing — only on the `DB_*` path. |
| `DB_SSL` | no | Force TLS `true`/`false`. Defaults to on with `DATABASE_URL`, off without. |
| `JWT_SECRET` | yes | Signing key for session tokens. Use a long random string, and a different one per environment. |
| `FRONTEND_URL` | yes | Allowed CORS origin(s), comma-separated, no trailing slash. The first entry is also where the GitHub OAuth callback redirects back to. |
| `GOOGLE_CLIENT_ID` | for Google login | OAuth 2.0 client ID from the Google Cloud console. |
| `GOOGLE_CLIENT_SECRET` | for Google login | Matching secret. |
| `GITHUB_CLIENT_ID` | for GitHub login | From your GitHub OAuth app. |
| `GITHUB_CLIENT_SECRET` | for GitHub login | Matching secret. |
| `GITHUB_CALLBACK_URL` | for GitHub login | Must match the OAuth app exactly. A GitHub OAuth app allows one callback URL, so development and production need separate apps. |
| `NODE_ENV` | in production | Set to `production` when deployed. It switches the session cookie to `Secure; SameSite=None`, without which the browser will not send it to an API on a different host from the frontend. |
| `CLOUDINARY_CLOUD_NAME` | **in production** | Object storage for uploaded images. All three must be set together; with any missing, uploads fall back to local disk and are lost on the next container restart. See [File uploads](#file-uploads). |
| `CLOUDINARY_API_KEY` | **in production** | |
| `CLOUDINARY_API_SECRET` | **in production** | |

No secrets are committed. `.env` is gitignored; `.env.example` lists every key
with placeholder values.

---

## Deployment

Three free services, each doing one thing:

```
Vercel (React SPA)  →  Render (this API)  →  Neon (PostgreSQL)
```

**[DEPLOYMENT.md](DEPLOYMENT.md) is the step-by-step guide.** What follows is the
summary and the reasoning.

| Setting | Value |
|---|---|
| Runtime | Node |
| Root directory | `slotly-backend/server` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |

The root directory matters: this is one repository holding both halves, so
Render has to be pointed at the folder containing *this* `package.json` rather
than at the repository root. Vercel is pointed at `slotly-frontend/slotly` for
the same reason, and neither builds the other.

The `render.yaml` blueprint in this repository declares the same thing, with
every secret as `sync: false` so no value is stored in the repo. The database is
not in it — Neon lives outside Render, so `DATABASE_URL` is an ordinary
environment variable.

**What deployment actually requires of the code**, all of it driven by
environment variables rather than build-time branching:

- **The port is taken from the environment.** `index.js` reads `process.env.PORT`
  and `app.listen` binds every interface by default, which is what a container
  platform needs.
- **The database is reached by connection string.** `config/dbConfig.js` prefers
  `DATABASE_URL` and enables TLS with it, which is what Neon requires. Managed
  Postgres certificates are not in Node's default trust store, so verification is
  relaxed — the connection is still encrypted. The auto-create-database path is
  skipped on this route, because a managed database already exists and its user
  cannot `CREATE DATABASE`.
- **The schema applies itself.** `initSchema()` runs on every boot and is written
  entirely as `IF NOT EXISTS`, so pointing the API at an empty Neon database is
  the whole migration step. `npm run db:init` does the same thing on its own if
  you would rather see it happen outside a deploy log.
- **The session cookie has to be cross-site.** A Vercel frontend and a Render API
  are different *sites*, not merely different origins, so `SameSite=Lax` would be
  set and then never sent again. `config/appConfig.js` switches to
  `Secure; SameSite=None` when `NODE_ENV=production`.
- **CORS and the OAuth redirect come from the same value.** Both are derived from
  `FRONTEND_URL` in `config/appConfig.js`, so the allow-list and the redirect
  target cannot drift apart.
- **`trust proxy` is on.** TLS terminates at the platform edge, so without it
  `req.protocol` and `req.ip` describe the proxy rather than the caller.

**Three consequences of the free tiers worth knowing.**

- **Render free web services have no persistent disk**, so uploaded images under
  `uploads/` are lost on every deploy and restart — the database rows survive, the
  files do not, and fixing it properly means object storage (see
  [Known limitations](#known-limitations)).
- **Render free services spin down after 15 minutes idle** and take about a
  minute to wake. The first request after a quiet period is slow; combined with
  the schema check on boot, allow for that before concluding something is broken.
- **Neon scales its compute to zero when idle too**, so the first query after a
  pause takes a few seconds. That is why `/api/health` deliberately does not
  touch the database: a health check on a timer would hold the database awake
  permanently and spend the free compute allowance on nothing. `/api/health/db`
  exists for when you actually want to test connectivity.

---

## Architecture

```
slotly-backend/                     Express API — no views, no templates
├── config/
│   ├── dbConfig.js                 pg Pool, query/exec/transaction helpers
│   ├── schema.js                   all DDL, including the exclusion constraints
│   └── appConfig.js                CORS origins, cookie flags, OAuth redirect base
├── controller/                     one file per resource; HTTP in, HTTP out
├── services/
│   ├── slotEngine.js               slot generation + timezone maths (pure)
│   ├── bookingRules.js             cancellation cutoff, status transitions (pure)
│   ├── availabilityResolver.js     which rules apply to a service
│   └── accountLinking.js           resolving a social login to one user row
├── middleware/                     auth, upload
├── utils/fileValidation.js         magic-byte upload validation
├── docs/openapi.js                 the OpenAPI document and the docs page
├── tests/                          Vitest
├── scripts/initDb.js               applies the schema on its own (npm run db:init)
├── scripts/seed.js                 demo providers, services, availability (npm run db:seed)
├── index.js                        boot: connect, apply schema, listen
├── server.js                       the Express app, exported without listening
├── render.yaml                     deployment blueprint (no secrets)
└── DEPLOYMENT.md                   Neon + Render + Vercel walkthrough
```

The React SPA is a separate repository:
[slotly-frontend](https://github.com/amitpaldevnco/slotly-frontend).

The frontend and backend are genuinely separate: React talks to a documented HTTP
API over CORS with a cookie-based session, and the API renders no HTML except its
own docs page.

**The layering that matters.** All slot and time logic lives in
`services/slotEngine.js` and `services/bookingRules.js` as pure functions — no
database, no request object, no ambient clock (`now` is always a parameter). That
is what makes the awkward cases directly testable: a DST boundary is one function
call with a fixed date, not an integration test with a seeded database and a
mocked system clock.

**Auth.** Email/password with bcrypt, plus Google and GitHub OAuth 2.0. The
session is a JWT in an `httpOnly` cookie — not `localStorage`, which any injected
script can read. Roles are re-read from the database on every privileged request
rather than trusted from the token, because a role can change after a token is
issued.

**Account linking.** If someone signs in with a social account whose email already
matches an existing account, the two resolve to a single user: the social ID is
attached to the existing row. Going the other way is refused — registering with a
password on an email that already has a Google or GitHub account returns `409`
naming the provider to use, rather than silently attaching a password to someone
else's social identity.

Both providers share one implementation, `services/accountLinking.js`, rather
than each handler doing its own lookup. That is not tidiness for its own sake:
written twice, the two copies drifted, and the Google handler went straight from
a `google_id` miss to an `INSERT`. Because `users.email` is `UNIQUE`, that path
raised `23505` for anyone who had already registered with a password, and
reported it to them as "Google authentication failed" — locking them out of
Google sign-in permanently. Linking is one function now, and
`tests/accountLinking.test.js` pins every route through it.

---

## Data model

```
users ──┬─< services ──< bookings >── users (client)
        ├─< availability_rules
        └─< availability_exceptions

bookings ──< booking_events
```

| Table | Holds |
|---|---|
| `users` | Both roles. `role` is `NULL` until profile setup completes, which is how the app knows to route someone there. Carries `timezone` and the provider's `cancellation_cutoff_hours`. |
| `services` | Name, price, duration, buffers, `slot_interval`. Retired with `is_active = false` rather than deleted when it has booking history. |
| `availability_rules` | The recurring weekly pattern. `weekday` (0 = Sunday) plus minutes-from-midnight. |
| `availability_exceptions` | One-off `block` and `open` overrides, over an inclusive date range. |
| `bookings` | The appointment. `starts_at`/`ends_at` bound the appointment; `blocked_from`/`blocked_to` add the buffers and are what the double-booking constraint compares. |
| `booking_events` | Append-only audit trail. Never updated, never deleted. |

**Two deliberate choices.**

*Wall-clock times are stored as integers, not as `TIME` or `TIMESTAMP`.* A
provider's "09:00 on Mondays" is not an instant — it has no date and no zone until
it is paired with a real calendar date. Storing it as `540` makes that
impossible to misread, and makes duration arithmetic plain integer maths. Every
actual instant is `TIMESTAMPTZ`.

*Bookings snapshot what they need.* `service_name_snapshot`, `price_snapshot`,
`duration_snapshot`, both timezones and the cancellation cutoff are copied onto
the booking at creation. Without them, a provider renaming a service, changing
its price, moving city, or tightening their cancellation policy would silently
rewrite the history of appointments already made under the old terms.

---

## How availability is modelled

**Rules, computed on demand. Not pre-generated slot rows.**

A provider stores a weekly pattern (`availability_rules`) plus one-off exceptions
(`availability_exceptions`). Bookable slots do not exist as rows anywhere; they
are computed per request by `services/slotEngine.js`:

```
weekly rules  ──┐
                ├─► expand onto local dates ─► union ─► subtract blocks
'open' excs   ──┘                                         ▲
                                                          │
'block' excs ─────────────────────────────────────────────┘

─► clip to the requested range ─► step through each window on the service's
   slot_interval grid ─► drop candidates that collide with an existing booking
   or fall in the past
```

**What each choice costs.** Generating slot rows in advance would make reads a
plain indexed `SELECT`, but every change would have to fan out: editing a
service's duration, narrowing availability, or adding a holiday would each mean
rewriting thousands of rows, and you would have to pick a horizon and keep
extending it. Worse, the rows would be a *derived cache* that can silently drift
out of step with the rules they came from.

Computing on demand means the rules are the single source of truth and a change
takes effect instantly, at the cost of doing work per request. That cost is
bounded three ways:

- the requested range is capped at **62 days**, so nobody can ask for a year;
- the bookings query filters on a range overlap (`&&`), which is served by the
  GiST index the exclusion constraint already maintains — a provider with a
  thousand bookings across six months returns only the handful that touch the
  requested week;
- the expansion iterates only the dates in the requested range, one day of
  padding either side.

A test pins this: six months of availability, a thousand bookings, one week
requested, asserted under 100 ms.

**Buffers.** A slot is offered only when the appointment *and both buffers* fit
entirely inside one open window. Within a window `[W0, W1]`, the earliest legal
start is `W0 + bufferBefore` and the latest is `W1 - bufferAfter - duration`.

**The candidate grid.** Start times sit on a grid of the service's
`slot_interval`, anchored at the window's own start — not spaced by the
appointment's length. A 60-minute service on a 30-minute interval offers 09:00,
09:30, 10:00 and so on. Those candidates overlap each other by design; booking one
removes its neighbours automatically through the collision filter. Spacing them by
length would be tidier arithmetic and worse for the client, who would be shown
09:05, 10:15, 11:25 the moment the service had a five-minute buffer. The trade-off
is that a candidate that does not land on the grid is not offered at all.

---

## No double-booking

**The guarantee lives in PostgreSQL, in one constraint:**

```sql
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap_per_provider
  EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(blocked_from, blocked_to) WITH &&
  ) WHERE (status <> 'cancelled');
```

**Why this and not application code.** The obvious approach — read the slot, check
it is free, insert — has a window between the read and the write in which another
transaction can insert the same slot. No amount of care in JavaScript closes that
window, because the two requests are not talking to each other. An exclusion
constraint moves the check inside the database, where PostgreSQL evaluates it
while holding a lock on the GiST index entry. Two transactions inserting
overlapping spans for the same provider are serialised: the first commits, the
second is rejected with `SQLSTATE 23P01` (`exclusion_violation`).

There is deliberately **no read-then-check-then-insert path anywhere in
`bookingController.js`.** `createBooking` does check availability first, but that
answers a different question — "is this a time the provider is even open for?" —
and its result is never relied on for exclusivity. The `INSERT` is what decides.

**Why an exclusion constraint rather than a unique index.** A unique index on
`(provider_id, starts_at)` would only catch bookings with the *identical* start
time. It would happily allow a 10:00–11:00 appointment alongside a 10:30–11:30
one. Appointments occupy ranges, and overlap is the property that actually
matters, so the constraint has to be over ranges.

**Details worth knowing.**

- `tstzrange` is half-open, so a booking ending at 10:00 and one starting at 10:00
  do not overlap — back-to-back appointments are legal.
- The comparison uses `blocked_from`/`blocked_to`, which include the buffers, so
  the buffer is genuinely protected, not merely displayed.
- `WHERE (status <> 'cancelled')` makes it partial: cancelling frees the slot
  immediately, while `completed` and `no_show` keep occupying it, because that
  time really was used.
- The same constraint applies to `UPDATE`, so **rescheduling onto an occupied slot
  loses the same race in the same way**, and returns the same error.

**How the error surfaces.** `23P01` is mapped to `409` with code `SLOT_TAKEN` — a
specific, distinguishable error, never a generic 500. The UI catches it, names the
time that was lost, and refreshes the slot list in the same moment.

**How you can prove it holds.** `tests/booking.concurrency.test.js` runs against a
real PostgreSQL database — mocking here would prove nothing, since the guarantee
*is* the constraint. It fires two inserts for the same slot on separate pooled
connections in separate transactions with no `await` between them, and asserts
exactly one succeeds and the other fails with `23P01`. It then does the same with
ten simultaneous attempts, and separately covers partial overlap, buffer-only
overlap, legal back-to-back booking, release on cancellation, retention on
completion, provider isolation, and the reschedule path.

---

## Time and timezones

**Every instant is stored in UTC**, as `TIMESTAMPTZ`. Conversion happens only at
the edges, for display. No wall-clock time is ever stored without the zone it
belongs to — and where a value genuinely *is* a wall clock with no zone (a
recurring weekly rule), it is stored as a minutes-from-midnight integer precisely
so it cannot be mistaken for an instant.

**Conversion is done by Luxon**, on both sides. No timezone or DST arithmetic is
hand-rolled anywhere in the codebase.

**The one subtle bit.** Pairing a rule with a date uses
`DateTime.fromObject({ year, month, day, hour, minute }, { zone })` rather than
adding a duration to local midnight. That distinction matters: adding "9 hours" to
midnight gives the wrong instant on a day when the clock jumps, whereas
constructing the wall-clock reading directly asks Luxon "what instant was 09:00 in
this zone on this date?" — which is the question the provider actually means.

**Where each conversion happens.**

| Boundary | What crosses it |
|---|---|
| Slot list | UTC instants, plus each slot pre-rendered in both the client's and the provider's local time. |
| Booking creation | The client sends back the exact `startsAt` it received. The two sides never have to agree on a timezone to agree on a moment. |
| Booking payloads | Every instant carries a `LocalisedInstant` with both parties' readings, so no client does zone maths itself. |
| The React app | `src/lib/time.js` wraps every conversion. The frontend never builds a date from parts and hopes. |
| The calendar | See below. |

**The calendar's special case.** `react-big-calendar` positions events using a
JavaScript `Date`, which always renders in the *browser's* zone. A provider
checking their calendar from an airport in another country would otherwise see
every appointment shift. `ProviderCalendar.jsx` therefore hands the library Dates
that have been shifted so their browser-local reading equals the correct
provider-local reading. Those shifted Dates are display-only: they never leave the
component, are never sent to the API, and the untouched booking travels alongside
on the event object, so everything the user clicks acts on real data.

**A user's saved timezone beats the browser's guess.**
`Intl.DateTimeFormat().resolvedOptions().timeZone` is used only to pre-fill the
picker at signup. Someone travelling should not see their appointments jump
around because their laptop changed zone.

---

## Daylight saving

**Policy: a recurring window keeps its wall-clock boundaries across a DST
change.** A provider available Mondays 09:00–17:00 is available 09:00–17:00 local
before and after the clocks move — never 08:00, never 10:00.

**What follows from that, and is not special-cased:**

- Because the boundaries are wall-clock, the window's *absolute* length changes on
  a transition day. On a spring-forward day whose gap falls inside the window it
  holds one hour less real time and yields fewer slots; on a fall-back day it
  holds one hour more and yields one more. That is the correct reading of "I work
  9 to 5".
- **If a boundary lands in a spring-forward gap** — a 02:30 start in a zone that
  jumps 02:00 → 03:00 — Luxon resolves it *forward* to the first instant that
  exists. The window is nudged later, never earlier, and never silently vanishes.
- **If a boundary is ambiguous on a fall-back day** — a 01:30 start that happens
  twice — Luxon resolves it to the *first* occurrence.

Both are Luxon's documented defaults, both fail safe, and both are covered by
tests.

**Existing bookings are unaffected by a DST change**, because they are stored as
absolute instants. The clocks moving does not move an appointment.

Tested with a London provider (observes DST) against a Kolkata client (never does,
and sits on a `+05:30` offset — which catches the class of bug that assumes
whole-hour offsets), in both directions, either side of both the March and October
transitions.

---

## File uploads

**Accepted formats and size cap:**

| Upload | Formats | Maximum size |
|---|---|---|
| Profile photo | JPEG, PNG | 5 MB |
| Service cover image | JPEG, PNG, WebP | 5 MB |

**Neither the extension nor the client-reported size is trusted.**

- **Type** is decided by sniffing the file's magic bytes with `file-type`, which
  reads the actual header. A script renamed to `avatar.jpg` has an extension and a
  declared MIME type that say JPEG and a header that does not, and only the header
  is consulted.
- **Size** is read with `fs.stat` on the file as it landed on disk. `file.size`
  from multer and the browser's `Content-Length` are both attacker-controlled; the
  bytes on disk are not.

multer's own `fileFilter` and `limits` still run first, but purely as a cheap early
reject while the request streams — they check the client's *claims*, so they
cannot be the last word.

**The stored filename is generated, never derived from the original.** Uploads
land under a random temporary name with no extension and are renamed only after
validation passes, using an extension taken from the sniffed type. Nothing the
client sent reaches the filesystem, which rules out path traversal and null-byte
tricks by construction. Deletions are additionally confined to the uploads
directory by resolving and comparing the path first.

### Where the bytes end up

Validation decides whether a file is *acceptable*; `services/imageStorage.js`
decides where an acceptable file *lives*. The two are separate modules so the
storage backend can change without touching the security-critical half — which
is exactly what happened.

**With `CLOUDINARY_*` set, images go to Cloudinary** and the database stores the
returned `https` URL. **Without them, they go to local disk** under `uploads/`,
served read-only from `/api/uploads` with directory listing disabled. Either
way the file is outside the database. The choice is made by whether the
credentials exist, never by `NODE_ENV` — a missing credential is the honest
signal that object storage was not configured — and the process prints which
backend it picked on every boot.

**Why not just disk, which the brief permits.** It was disk, and on the deployed
host that was wrong in a way that is easy to miss. Render's free tier rebuilds a
container's filesystem from the image whenever the service restarts, and a free
service restarts every time it wakes from its idle sleep — not only when it is
redeployed. An avatar uploaded at 10:00 was genuinely gone by 10:30. The bytes
were never corrupted; the disk they were on stopped existing. Disk remains the
local-development path, because it needs no account, no network and no
credentials.

`deleteImage` understands both forms, so rows written before the switch — which
still hold `/uploads/...` paths — remain deletable. An absolute URL that is
neither, such as an OAuth provider's avatar on `googleusercontent.com`, is left
alone: the app did not put it there and has no business removing it. Remote
deletes are additionally restricted to objects under this app's own `slotly/`
folder prefix.

---

## Tests

```bash
npm test
```

**115 tests across 6 suites, Vitest.** `npm run test:watch` for watch mode.

Four of the six suites talk to a real PostgreSQL — the same one the app uses,
read from `.env`, or any database named by `DATABASE_URL`. That is deliberate rather than lazy: the double-booking
guarantee *is* a database constraint and the account-linking guarantee *is* a
unique index, so mocking either would leave the actual mechanism untested. Both
suites create their own fixtures under a namespaced email prefix
(`slotly_test_…@test.invalid`) and remove them afterwards, so neither depends on
nor disturbs whatever else is in the database.

| File | Covers |
|---|---|
| `tests/slotEngine.test.js` | Slot generation from rules and buffers; **the appointment *and both buffers* fitting inside the window**, including the exactly-fits and one-minute-short cases; the candidate grid; exceptions (full-day, partial, multi-day, extra opening, block-beats-open); collision with existing bookings including the half-open boundary and buffer-only collisions; timezone conversion in both directions; **DST across both transitions**, including the shortened and lengthened window, gap and ambiguous boundaries, and a non-observing zone; the minimum-notice date floor; the range cap; the performance guard. |
| `tests/bookingRules.test.js` | The **cancellation cutoff at its exact boundary** — one second before, exactly on, one second after; the snapshot rule in both directions; a zero-hour cutoff; provider transitions; two-zone rendering including a date-line crossing and a DST offset change. |
| `tests/booking.concurrency.test.js` | The **double-booking guard against a real database**: two simultaneous attempts, ten simultaneous attempts, partial overlap, buffer-only overlap, legal back-to-back, release on cancellation, retention on completion and no-show, provider isolation, and the reschedule path — including two reschedules racing for one slot. |
| `tests/accountLinking.test.js` | **One user per email address**, against a real database: a password account signing in with Google for the first time, both social providers on one address in either order, and the profile, role and password surviving the link. |

Every time-dependent test injects `now` explicitly, so the suite cannot start
failing in six months.

---

## API documentation

With the server running: **<http://localhost:5000/api/docs>**

The raw OpenAPI 3.1 document is at `/api/docs/openapi.json`, and its source is
`docs/openapi.js`. Every endpoint is listed with its method, path, auth
requirement, request body, response shape and error cases.

**The error contract.** Every failure returns:

```json
{ "success": false, "error": "human-readable prose", "code": "MACHINE_READABLE", "details": [] }
```

Branch on `code`, never on `error`. `details` is present on validation failures
and carries one `{ field, message }` entry per rejected field.

Codes worth calling out:

| Code | Status | Means |
|---|---|---|
| `SLOT_TAKEN` | 409 | You lost the race for a slot. Someone else booked it. |
| `SLOT_UNAVAILABLE` | 409 | The time is outside the provider's available hours. |
| `CANCELLATION_WINDOW_CLOSED` | 409 | Past the cutoff. `details.deadline` gives the instant it closed. |
| `BOOKING_NOT_ACTIVE` | 409 | Already cancelled, completed or marked no-show. |
| `APPOINTMENT_NOT_STARTED` | 409 | Cannot mark completed or no-show before it has begun. |
| `RANGE_TOO_WIDE` | 400 | More than 62 days of slots requested. |

---

## Decisions, and why

**Do you store availability as rules, or generate slot rows in advance?**
Rules, computed on demand — see [How availability is modelled](#how-availability-is-modelled)
for what each choice costs.

**Where exactly does the no-double-booking guarantee live, and how would you prove
it holds?** In a PostgreSQL exclusion constraint, and by racing two real
transactions against a real database — see [No double-booking](#no-double-booking).

**What happens to existing bookings when a provider deletes a service?**
A service nobody has ever booked is deleted properly. One with booking history is
**retired** (`is_active = false`): it disappears from the public page and the slot
picker immediately, so nobody can book it again, but every existing appointment
keeps working. The client still sees it, the provider still sees it, and the name
and price shown come from the booking's own snapshot rather than the live row.
Deleting outright would either orphan those bookings or cascade them away, and
silently erasing an appointment somebody is planning to attend is the worse
failure. The API says which happened, so the UI can word its confirmation
honestly rather than claim a deletion that did not occur.

**What happens when a provider narrows their availability?**
Existing bookings are untouched and still go ahead; only *future slot generation*
changes. Availability describes what can be booked from now on, not a claim about
what was already agreed. Cancelling a real appointment is a decision with a person
on the other end of it, so the app makes the provider do it deliberately, with a
reason, rather than doing it silently as a side effect of an edit.

**A provider moves city and changes their timezone. What happens?**
*Recurring availability moves with them.* "Mondays 09:00" now means 09:00 in the
new city, because the rule is a wall-clock time interpreted in the provider's
current zone. That is what a provider who has actually moved wants.
*Appointments already booked do not move at all* — they are stored as absolute
instants, and the client already has that instant in their diary. The UI notes
this on the availability page, since a provider who only meant to fix a typo
should re-check their weekly hours.

**A client is looking at a slot list and someone else books one of them. What
should they see, and when?**
Not a live-updating list. Silently removing a slot from under the cursor is worse
than letting the click fail — the user is left wondering whether they misread it.
Instead: the list carries a visible "as of" timestamp so it never claims to be
live; a `409 SLOT_TAKEN` is caught and explained in plain words, naming the time
that went; and the list refreshes in that same moment, so the taken slot
disappears exactly when the user is looking for an explanation. That turns a lost
race into an ordinary, legible outcome rather than an error.

**Should a cancelled booking be deleted, or kept with a cancelled status?**
Kept. The client needs it in their history, the provider needs it in their
records, and the audit trail is meaningless if rows can vanish. Keeping it costs
nothing operationally, because the exclusion constraint is partial — a cancelled
booking stops occupying the calendar the moment its status changes, so the slot
returns to the pool without deleting anything.

**Why is the cancellation cutoff snapshotted onto each booking?**
Because a provider tightening their policy from 12 to 48 hours should not
retroactively trap clients who booked under the old one. The cutoff is read from
the booking, never from the provider's current setting.

**Why is `slot_interval` separate from duration?**
So a 60-minute service can offer starts every 30 minutes, and so buffers do not
push start times onto ragged numbers. See
[the candidate grid](#how-availability-is-modelled).

---

## Known limitations

- **No pagination.** Booking lists are capped at 500 rows and the provider
  directory at 100. Fine at this scale; a real deployment would need cursors.
- **Notifications are in-UI only.** Real email and SMS delivery are out of scope
  per the brief. Confirmations and cancellations surface as toasts, not messages.
- **The slot list is not live.** It refreshes on navigation and after a lost race,
  but does not poll or hold a socket open — a deliberate choice, explained above.
- **No rate limiting.** The login and registration endpoints would need it before
  facing the public internet.
- **Uploads go to local disk.** Fine for a single instance; multiple instances
  behind a load balancer would need object storage. The storage layer is confined
  to `utils/fileValidation.js` and the upload middleware, so swapping it is
  contained. On a host without a persistent disk — including Render's free tier —
  the consequence is sharper: the files are gone after every deploy or restart,
  while the rows that point at them remain, so avatars and cover images fall back
  to their placeholders.
- **Images are stored as uploaded** — no resizing or re-encoding, so a 5 MB photo
  is served at 5 MB.
- **Cancellation, not deletion, for services** means a provider cannot fully
  remove a service that has history. That is the intended behaviour, but there is
  no "archive" view separating retired services from active ones beyond a badge.
- **Single provider per account.** Multi-provider businesses and staff assignment
  are explicitly out of scope.
- **The frontend bundle is not code-split** (~890 KB, ~284 KB gzipped), largely
  the calendar library. Route-level lazy loading would be the first fix.
- **No end-to-end browser tests.** The suite covers the logic that is hard to get
  right; the UI was verified manually.

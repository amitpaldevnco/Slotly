# Slotly

**An appointment booking platform.** Live, deployed, and seeded — you can book a
real appointment across three timezones in under a minute.

| | |
|---|---|
| **App** | <https://slotly-navy.vercel.app> |
| **API** | <https://slotly-backend-p2r5.onrender.com/api> |
| **API reference** | <https://slotly-backend-p2r5.onrender.com/api/docs> |

> The API is on Render's free tier and sleeps after 15 minutes of inactivity.
> **The first request after a nap takes 20–50 seconds** while the container wakes
> — open the API link above first and let it answer, then use the app normally.

### Demo accounts

Password for all three: **`SlotlyDemo123!`**

| Role | Email | Timezone | Why this one |
|---|---|---|---|
| Provider | `priya.provider@slotly.demo` | `Europe/London` | **Observes DST** — her 09:00–17:00 stays 09:00–17:00 across the clock change while the UTC instant moves |
| Provider | `arjun.provider@slotly.demo` | `Asia/Kolkata` | **Never observes DST**, and sits on a **+05:30** half-hour offset |
| Client | `casey.client@slotly.demo` | `America/New_York` | A third zone, behind both providers, so every screen does a real conversion |

**A one-minute tour:** sign in as Casey, open *Find providers* → *Priya Raman* →
*Initial Assessment*. Every slot is labelled in New York time with Priya's London
time beside it. Book one; the confirmation shows both zones. Now sign in as Priya
and the same appointment appears on her calendar at the correct London time.

---

An appointment booking platform. A provider publishes the services they offer and
the hours they work; a client picks an open slot and books it. The provider gets a
calendar that is always correct, and every person sees every time in their own
timezone.

Two guarantees run through the whole build, and everything else is secondary to
them:

1. **A slot can never be double-booked.** Enforced by a PostgreSQL exclusion
   constraint, not by application code. See [No double-booking](#no-double-booking).
2. **Every time shown is the correct local time for whoever is looking.** Every
   instant is stored in UTC and converted only at the edges, for display. See
   [Time and timezones](#time-and-timezones).

---

## Contents

- [Repository layout](#repository-layout)
- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Data model](#data-model)
- [How availability is modelled](#how-availability-is-modelled)
- [No double-booking](#no-double-booking)
- [Time and timezones](#time-and-timezones)
- [Daylight saving](#daylight-saving)
- [Who can change a booking](#who-can-change-a-booking)
- [File uploads](#file-uploads)
- [Rate limiting](#rate-limiting)
- [Frontend conventions](#frontend-conventions)
- [Tests](#tests)
- [API documentation](#api-documentation)
- [Decisions, and why](#decisions-and-why)
- [Known limitations](#known-limitations)

---

## Repository layout

One repository, two folders. The frontend and backend are genuinely separate
services that happen to be versioned together — React talks to the API over
HTTP and CORS, and the API renders no HTML except its own docs page.

```
Slotly/
├── slotly-backend/server/     Express + PostgreSQL API   → deployed to Render
├── slotly-frontend/slotly/    React SPA (Vite)           → deployed to Vercel
├── .gitignore
└── README.md                  ← you are here
```

Each folder has its own `package.json` and its own README covering the detail
specific to it. Both deployment targets are pointed at their subfolder as a root
directory, so neither builds the other.

---

## Running it locally

**Prerequisites:** Node 20+, PostgreSQL 14+ (15 recommended), and a database the
app can connect to. The app creates the database itself if it does not exist.

```bash
git clone https://github.com/amitpaldevnco/Slotly.git && cd Slotly
```

**1. Backend**

```bash
cd slotly-backend/server && npm install && cp .env.example .env
```

Fill in `.env` (see [Environment variables](#environment-variables)), then:

```bash
npm run dev
```

The API comes up on <http://localhost:5000>. The schema is created automatically
on first boot — every statement in `config/schema.js` is `IF NOT EXISTS`, so
starting the server is the only setup step a database needs.

**2. Seed the demo data**

```bash
npm run db:seed
```

This creates the two providers and the demo client listed at the top of this
file, with services, weekly availability, a holiday block, an extra Saturday
opening, and a few existing bookings. It is safe to re-run: it removes only the
rows it owns (matched by the three `@slotly.demo` addresses) and recreates them,
so it resets the demo without touching any other account.

Availability is generated relative to *today* rather than hardcoded, so the demo
does not go stale.

**3. Frontend**

In a second terminal:

```bash
cd slotly-frontend/slotly && npm install && cp .env.example .env && npm run dev
```

The app comes up on <http://localhost:5173>.

> The backend's CORS allow-list is `FRONTEND_URL`, which defaults to
> `http://localhost:5173`. If Vite falls back to another port because 5173 is
> busy, sign-in will fail — free the port or add the new one to `FRONTEND_URL`.

**4. Run the tests**

```bash
cd slotly-backend/server && npm test
```

---

## Environment variables

### `slotly-backend/server/.env`

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | API port. Defaults to `5000`. |
| `DB_HOST` | yes | PostgreSQL host, e.g. `localhost`. |
| `DB_PORT` | no | Defaults to `5432`. |
| `DB_USER` | yes | Database user. |
| `DB_PASSWORD` | yes | Database password. |
| `DB_NAME` | yes | Database name. Created automatically if missing. |
| `JWT_SECRET` | yes | Signing key for session tokens. Use a long random string. |
| `FRONTEND_URL` | yes | Allowed CORS origin(s), comma-separated. `http://localhost:5173` in development. |
| `GOOGLE_CLIENT_ID` | for Google login | OAuth 2.0 client ID from the Google Cloud console. |
| `GOOGLE_CLIENT_SECRET` | for Google login | Matching secret. |
| `GITHUB_CLIENT_ID` | for GitHub login | From your GitHub OAuth app. |
| `GITHUB_CLIENT_SECRET` | for GitHub login | Matching secret. |
| `GITHUB_CALLBACK_URL` | for GitHub login | e.g. `http://localhost:5000/api/auth/github/callback`. |
| `NODE_ENV` | no | Set to `production` in a deployed environment. Enables `Secure` cookies. |
| `DATABASE_URL` | in production | Managed-Postgres connection string. Overrides the `DB_*` values when set. |
| `CLOUDINARY_CLOUD_NAME` | **in production** | Object storage for uploaded images. Without all three, uploads fall back to local disk — see [File uploads](#file-uploads). |
| `CLOUDINARY_API_KEY` | **in production** | |
| `CLOUDINARY_API_SECRET` | **in production** | |

### `slotly-frontend/slotly/.env`

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | yes | e.g. `http://localhost:5000/api`. |
| `VITE_GOOGLE_CLIENT_ID` | for Google login | Same client ID as the backend. |

No secrets are committed. `.env` is gitignored in both projects; `.env.example`
lists every key with placeholder values.

---

## Architecture

```
Slotly/
├── slotly-backend/server/          Express API — no views, no templates
│   ├── config/
│   │   ├── dbConfig.js             pg Pool, query/exec/transaction helpers
│   │   └── schema.js               all DDL, including the exclusion constraints
│   ├── controller/                 one file per resource; HTTP in, HTTP out
│   ├── services/
│   │   ├── slotEngine.js           slot generation + timezone maths (pure)
│   │   ├── bookingRules.js         cancellation cutoff, status transitions (pure)
│   │   ├── availabilityResolver.js which rules apply to a service
│   │   └── accountLinking.js       resolving a social login to one user row
│   ├── middleware/                 auth, upload
│   ├── utils/fileValidation.js     magic-byte upload validation
│   ├── docs/openapi.js             the OpenAPI document and the docs page
│   └── tests/                      Vitest
└── slotly-frontend/slotly/         React SPA (Vite + Tailwind)
    ├── src/lib/                    api client, time helpers, shared styles
    ├── src/context/                auth session, toasts
    ├── src/components/             UI, grouped by feature
    └── src/pages/                  one per route
```

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
| `users` | Both roles. `role` is `NULL` until profile setup completes, which is how the app knows to route someone there. Carries `timezone`, the provider's `cancellation_cutoff_hours`, and `currency` — the ISO 4217 code every price of theirs is read in. Currency sits on the provider, not the service, because a provider bills in one currency; putting it per-service would allow a profile whose own services disagree. |
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

**Windows are merged per calendar date, never across midnight.** This is the one
piece of the grid that is not obvious, and it exists because anchoring on "the
window's own start" only works if that start is a property of the provider's
schedule rather than of the question being asked about it.

Two windows meeting at 12:00 on the same day *are* merged, so a 90-minute
appointment can straddle noon. Two windows meeting at midnight on consecutive
days are not. Without that rule, a provider available round the clock had every
date fused into a single window beginning wherever the expansion started — one
day before whatever range the client happened to browse — and the write path,
which pads around the appointment rather than around a browsing range, anchored
the same grid somewhere else. Whenever the step did not divide the gap between
the two anchors (25, 50 and 100 minutes all fail; 30, 45 and 60 divide 1440 and
survived by luck) **every slot the list offered was rejected on POST as "not one
of the provider's available times".**

The cost is stated in [Known limitations](#known-limitations): on a
round-the-clock schedule an appointment can no longer straddle local midnight.
Offering a slot that cannot be booked is the worse failure of the two, and
`tests/slotEngine.test.js` now asserts the invariant directly — every start
`generateSlots` offers must be accepted by `isOfferedSlotStart`, at six different
intervals and across a fall-back day.

**Booking is real time.** The only reason a generated slot is withheld for being
too soon is that it has already started. A client can take an appointment later
today, and one inside the next hour, exactly as the list offers it.

This replaced a minimum-notice rule that measured notice in whole *calendar
days*: the provider's entire current date was off the table however much of it
remained, so at 08:00 nobody could book 17:00 the same day. That is not a
scheduling constraint so much as an artefact of counting in dates, and it cost
providers the last-minute bookings that fill a gap left by a cancellation.

`MIN_BOOKING_LEAD_MINUTES` in `services/slotEngine.js` is the single knob, it is
zero, and `earliestBookableInstant()` is the only place it is read. It is a
rolling instant (`now + lead`) rather than a date boundary, so the answer moves
continuously with the clock instead of jumping at midnight. Both the slot list
and `POST /bookings` go through the same two gates — "has it started?" and "does
it clear the lead time?" — so a client cannot POST past a rule the list applied.

Two consequences worth knowing:

- **The slot list goes stale while it is on screen.** The booking page drops a
  time once it passes, on a one-minute clock tick. That is a local comparison and
  not a poll: no request is made, and the server still decides what is bookable.
- **A provider's cancellation cutoff can already have passed at the moment of
  booking.** A client who books 40 minutes ahead under a 24-hour cutoff cannot
  cancel it themselves. That is the provider's policy applying as written, and it
  is reported through the usual `CANCELLATION_WINDOW_CLOSED` refusal rather than
  being special-cased.

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

**Changing a *provider's* timezone is checked first.** For a client the timezone
is a lens and nothing more. For a provider it is load-bearing: their weekly hours
are a weekday plus a wall-clock time, read in whatever zone their account
currently says, so changing the zone slides every working window along the real
timeline. The appointments do not move — they are fixed instants — which is
exactly the problem. A 9 AM appointment can land at 4 AM inside the new working
day, outside the hours the provider has just declared, and
`POST /bookings/:id/reschedule` validates against the *current* zone, so it is
then an appointment they cannot move without widening their hours first.

So the change is assessed before it is written, by
`services/timezoneChange.js`:

- Every active appointment that has not finished is judged **twice** — under the
  zone in force now, and under the candidate zone — and reported only when it
  fits today and would not fit afterwards. An appointment already outside the
  provider's hours (because they trimmed their own day after it was booked) is
  left out: that is not this change's doing, and no choice of zone fixes it.
- `GET /availability/timezone-impact` answers the question with no write, so the
  Settings page can name the affected appointments — with both clock readings of
  the same unmoved instant — **before** Save is pressed.
- `PATCH /auth/profile` runs the same assessment next to the write and refuses
  with **409 `TIMEZONE_CONFLICT`**, carrying that report in `details`. Nothing at
  all is written on a refusal, including any other field in the same request.
- **There is no override.** The provider cancels or reschedules what the report
  names, or keeps their current zone. A forced change would silently misalign a
  live calendar, which is the outcome the whole check exists to prevent.

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

## Who can change a booking

Both parties can move or cancel an appointment, on deliberately different terms.

| | Client | Provider |
|---|---|---|
| **Cancel** | Up to the cutoff | Any time |
| **Reschedule** | Up to the same cutoff | Any time |
| **Reason required** | No | Yes, for both |
| **Record the outcome** (completed / no-show) | Never | Yes, within the outcome window |

The asymmetry is the point. A provider acting on someone else's appointment is
imposing a change they did not ask for, so an explanation is mandatory and the
client's cutoff does not bind the person who owns the calendar. A client moving
their own appointment owes nobody an explanation, but is bound by the notice the
provider asked for.

**Reschedule shares one deadline with cancel**, rather than having its own. A
reschedule frees the original slot exactly as a cancellation does, so it costs
the provider the same late notice — and if the reschedule window were any wider,
the cutoff would be trivially avoidable: move the appointment to a distant date,
then cancel it from there. A client past the deadline gets `409
RESCHEDULE_WINDOW_CLOSED`, carrying the deadline so the UI can explain itself.

Before this existed, reschedule was provider-only and a client who needed a
different time had to cancel and rebook. That released their slot to the pool in
between — so they could lose it to somebody else mid-flow — and split one
appointment's history across two unrelated rows. Both are exactly the outcomes
the product exists to prevent.

### The list a reschedule is chosen from

`GET /providers/:id/slots?bookingId=…` answers a different question from the same
endpoint without it: **"where could *this* appointment move to?"** rather than
"where could a new one go?". Only the client or provider on the booking may ask;
everyone else gets 404, so booking ids stay unprobeable on an otherwise public
endpoint.

Three things change, and each of them was a way for the picker to offer a button
the write path then refused:

- **Duration comes from the booking**, not the service. `rescheduleBooking` moves
  an appointment at its snapshotted length, so a provider who shortened a
  60-minute service to 30 made the plain list publish 16:30 on a day ending at
  17:00 — times a 60-minute appointment cannot use.
- **The booking stops blocking its own move.** It occupies the calendar, so the
  plain list hid every time overlapping it, and a 60-minute 09:00 appointment
  could not be nudged to 09:30. The write path always allowed that: PostgreSQL
  does not compare an updated row against its own previous version.
- **A retired service is still answered.** Retiring keeps upcoming bookings, and
  they are still movable; the plain list requires `is_active` and 404'd, which
  left exactly those bookings stranded.

This is the same rule as everywhere else in the app — the read path and the write
path must derive the answer from identical inputs — applied to the one read that
had been quietly using the wrong ones.

### Changed price or duration, and who gets asked

A booking freezes the service's price and duration onto itself, and no edit a
provider makes ever rewrites those columns. But a **reschedule is not an edit** —
the client is choosing to enter a new arrangement, and the provider's current
price is what that arrangement costs. Honouring a price the provider abandoned
months ago is not protecting the client; it is quoting them a number nobody is
offering.

So a client's move re-reads the service, and because that can change what they
pay it cannot happen silently:

1. The first attempt is refused with `409 SERVICE_TERMS_CHANGED`, carrying both
   sets of figures. **Nothing is written** — the appointment is exactly where and
   what it was, which is what lets the question be asked without the answer
   having already been committed.
2. `RescheduleDialog` opens on the comparison rather than the picker: what you
   booked, what it is now, and a plain sentence per thing that moved.
3. Accepting repeats the call with `acceptChanges: true`. The move goes through,
   `price_snapshot` and `duration_snapshot` are updated to the accepted pair, and
   the timeline records the numbers — *"Accepted the provider's updated service
   terms: price INR 30 → INR 40, duration 60 → 30 min."*
4. Cancelling leaves the booking untouched.

**A provider's move keeps the snapshotted terms** and is never asked. It is the
same asymmetry that governs cancellation reasons and the cutoff: the party
imposing a change on somebody else does not get to impose new terms along with
it. Letting a provider reprice a booking by dragging it an hour later would be a
repricing with no consent step anywhere in it.

The rule itself is one pure function, `describeRescheduleTerms()`, and both the
slots endpoint and the reschedule endpoint read it — so the length a client is
offered slots at is by construction the length their move will land at.

### The outcome window

An appointment that has finished is not settled immediately. For
`OUTCOME_GRACE_MINUTES` — **one hour** — after it ends, the provider can still
record what actually happened: completed, no-show, or cancelled. Once that hour
passes, a booking nobody recorded is automatically marked `completed`, attributed
in the timeline to a `system` actor.

The grace period is not cosmetic. Auto-completion runs *lazily on read*, and it
used to fire the moment `ends_at` passed — which meant the provider opening their
dashboard settled every finished appointment as `completed` before they could
click anything. `no_show` existed in the schema, the API and the UI, and was
unreachable in practice: the only window to set it was *during* the appointment.
`tests/api.lifecycle.test.js` guards that exact sequence — open the dashboard,
then mark a no-show.

## Reading the calendar by status

The provider calendar's status legend is also its filter, and it sits in a
`Filters` row **above** the grid rather than under it — a control a provider has
to scroll a full day of hours past is a control they will not know is there.

**Clicking a status shows only that status.** Click `Completed` and the grid holds
the completed appointments and nothing else. `All` brings everything back, and so
does clicking the status that is already the only one showing, so the chip is its
own undo. Ctrl/cmd-click combines statuses — Booked *and* Rescheduled — which is
the rarer intent and so is the one that takes the modifier.

It exists because a week with three cancellations and a no-show in it is mostly
noise for a provider trying to read what they are actually doing on Thursday, and
colour alone does not help — a cancelled block occupies the same space on the
grid as a live one.

Three choices worth naming. **Everything is on by default**, because a calendar
that hides appointments before being asked to is a calendar nobody can trust.
**Deselecting the last status returns everything** rather than emptying the grid,
since a calendar showing nothing at all is never what was meant. And **what is on
screen is named out loud** underneath the row — *"Showing Completed only · 7
appointments hidden"* — because a filter with no visible consequence is how
somebody concludes their Thursday is free. The state is local to the grid rather
than part of the query: it is a way of looking at the range, not part of what the
range is.

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
decides where an acceptable file *lives*. The two are separate so the storage
backend can change without touching the security-critical half — which is
exactly what happened.

**With `CLOUDINARY_*` set, images go to Cloudinary** and the database stores the
returned `https` URL. **Without them, they go to local disk** under
`server/uploads/`, served read-only from `/api/uploads` with directory listing
disabled. The choice is made by whether the credentials exist, never by
`NODE_ENV`, and the backend prints which one it picked on every boot.

**Why this is not just disk, which the brief permits.** It was disk, and on the
deployed host that was wrong in a way that is easy to miss. Render's free tier
rebuilds a container's filesystem from the image whenever the service restarts —
and a free service restarts every time it wakes from its idle sleep, not only
when it is redeployed. An avatar uploaded at 10:00 was genuinely gone by 10:30.
The bytes were never corrupted; the disk they were on stopped existing. Disk
remains the local-development path because it needs no account, no network and
no credentials.

`deleteImage` understands both forms, so rows written before the switch — which
still hold `/uploads/...` paths — stay deletable. An absolute URL that is neither
(an OAuth provider's avatar on `googleusercontent.com`) is left alone: the app
did not put it there and has no business removing it.

---

## Rate limiting

`express-rate-limit`, in three tiers, because the endpoints have genuinely
different threat profiles. All of it lives in `middleware/rateLimit.js`.

| Tier | Applies to | Limit | Counts |
|---|---|---|---|
| `credentialsLimiter` | `POST /auth/login`, `POST /auth/google`, the GitHub callback | 20 per 15 min | **failures only** |
| `signupLimiter` | `POST /auth/register` | 10 per hour | every request |
| `apiLimiter` | everything under `/api` | 300 per minute | every request |

**Only the credential tier is really the point.** `/auth/login` answers a yes/no
question about a secret, and without a limit an attacker can ask it as fast as
the network allows — which no password policy survives.

**Failures are counted, successes are not.** `skipSuccessfulRequests` on the
credentials tier is what keeps the limit invisible to the people it is not aimed
at: a shared office NAT can sign in all day without touching the counter, while
twenty consecutive wrong passwords from that same address still stops. Signup is
the opposite — it counts everything, because there the abuse *is* the successful
case, and counting successes also blunts the address enumeration that "this email
is already registered" would otherwise allow.

Throttled requests get the same envelope as every other error — `429` with code
`RATE_LIMITED` and `details.retryAfterSeconds`, so the UI can say when to try
again rather than just that something went wrong. Standard `RateLimit` headers
are sent; the legacy `X-RateLimit-*` ones are not.

**Keying depends on `trust proxy`.** The limiter keys on client IP, which is only
correct because `server.js` sets `app.set("trust proxy", 1)` — Render terminates
TLS at its edge and forwards over HTTP, so without it every request would look
like it came from the load balancer and the whole world would share one bucket.
The two settings are a pair.

**In tests the limits are inert.** The API suites drive the real app through
supertest from one address and create dozens of fixture accounts per run, which is
indistinguishable from the abuse `signupLimiter` exists to stop. They are disabled
when `NODE_ENV === "test"` and switched back on by the one suite that asserts they
work (`tests/api.rateLimit.test.js`) via `setRateLimitingEnabledForTests()`. The
gate is `NODE_ENV` and nothing else, so no request header or environment variable
can turn them off in a deployed process.

---

## Frontend conventions

Two things the UI is consistent about on purpose, because both were inconsistent
by accident first and the inconsistency was the bug.

### Loading states

Everything that reads data goes through `useApiResource`, which returns
`{ data, loading, refreshing, error, reload }`. The distinction between the two
flags is the whole rule: `loading` means *there is nothing on screen yet*, and
`refreshing` means *what is on screen is being replaced*. Passing `keepPreviousData: true`
is what makes `refreshing` fire at all — without it, every re-fetch reports itself
as `loading` and the screen empties.

Three situations, one answer each. The primitives are in
`components/ui/Feedback.jsx`, which carries this same list:

| Situation | What to draw |
|---|---|
| A whole route, first load | `PageLoader`, with a `label` naming what is being fetched |
| A panel inside a page that is already drawn | `SkeletonRows`, with the `variant` matching the shape of what will land there, and a `label` |
| Content on screen, being re-fetched | `Refreshing` — the content stays and dims, and the region is marked `aria-busy` |

And one prohibition: **never render an empty state while a request is in flight.**
"No providers listed yet" and "You are all caught up" are answers; a screen that
gives the wrong answer confidently is worse than one that admits it does not know
yet. Three panels used to do this and then contradict themselves a moment later.

`SkeletonRows` puts `role="status"` on its container and leaves the bars
`aria-hidden`, so a skeleton announces itself once. It was wholly `aria-hidden`
before, which made every skeleton in the app silent — a screen reader heard
nothing at all between navigating to a page and its content arriving.

Never hand-roll any of this. Three screens had each written their own dim-on-refetch
and they did not agree on the opacity; one of them was wired to a flag that could
never become true, so a control that looked like it reported activity reported
nothing for the life of the feature. One screen had reimplemented `SkeletonBlock`
class for class, which would have silently escaped any change to the skeleton
colour or its reduced-motion behaviour.

### Cards in a grid

A grid of cards should be one grid: same width, same height, and the same rows at
the same heights across every card. Getting there needs both halves.

**On the grid**, `md:auto-rows-fr`. CSS grid rows size to their own content, so two
rows of cards end up as tall as their own tallest member and nothing lines up
between them — one long description is enough to leave a page visibly ragged. Not
below `md`, where a single column would only mean padding every short card out to
match the tallest on the page.

**On the card, `w-full`** — and this one is easy to miss, because the grid looks
like it has already handled width. It has not. Tailwind's `grid-cols-3` emits
`repeat(3, minmax(0, 1fr))`, so the *columns* are equal, but the card is a flex
item inside its grid cell and a flex item's `flex-grow` defaults to `0`. Without
`w-full` the card never grows into its column: `flex-basis: auto` sizes it to its
own content, so a service with a one-line description renders a visibly narrower
card with the leftover column width showing as a gap beside it.

Reserving the inner zones cannot fix that, and neither can anything on the grid.
**Equal columns are not equal cards unless something tells the card to fill its
column.** Check the rendered card width, not just `grid-template-columns`.

**On the card**, reserve every zone whose height depends on its content, instead
of letting one of them float. `ServiceCard` is the worked example — top to bottom
it is:

| Zone | How its height is fixed |
|---|---|
| Cover + status chip + icons | `h-12` on the cover; one row, so the tallest child sets it |
| Name | `line-clamp-2` and a floor of two lines |
| Description | `line-clamp-3` and a floor of three lines |
| Duration, price, buffer | Always two rows — the buffer row is drawn either way |
| Stats (owner only) | One line of caption text |
| Actions | `mt-auto`, so they sit on the bottom edge |

The failure mode this fixes was visible on the services page: with `flex-1` on the
description, a service with no description absorbed every spare pixel in the card
into one gap under "No description yet.", pushing its duration, price and stats
tens of pixels below the same rows on the card beside it. Reserving the zones
moves that slack to `mt-auto` at the bottom, where it reads as padding.

Fixing the description alone is not enough, and this is the part worth
remembering: **anything above the description can reintroduce the same
misalignment.** An unclamped name did — a three-line service name shifted
everything under it — and so did the buffer row, which used to appear only when a
service had buffer time. That row is now always drawn and says "No buffer time"
when there is none, because a true statement fills the space better than a blank
spacer, which looks like something failed to load.

The reservations are written as `calc()` over the theme's own type-scale
variables, e.g.

```
min-h-[calc(3*var(--text-small)*var(--text-small--line-height))]
```

so three lines stays three lines if `--text-small` or its line-height moves. This
was briefly `min-h-[3lh]`, which reads far better — but `lh` needs Chrome 109 /
Safari 16.4 / Firefox 120, and on anything older the declaration is dropped in
silence and the card goes back to being sized by its text, which is the one
failure this exists to prevent. A `calc()` over a custom property has no such
floor.

Two differences `auto-rows-fr` is left to absorb rather than reserve: a retired
service carries an extra `Reactivate` button, and the stats line can wrap at very
narrow widths. Reserving a whole button row on every active card to pre-empt the
first would waste more space than it saves.

### Retired services offer one action

A retired service's header shows `Reactivate` and nothing else. `Edit` is out
because the API refuses it with `SERVICE_RETIRED` — a live booking renders its own
snapshotted name and price, so editing the row would rewrite only history.

`Remove` is out for a subtler reason worth knowing before anyone adds it back.
`DELETE /services/:id` does one of two entirely different things depending on a
number that is not on the card: with **no** bookings it deletes the row, and with
**any** bookings it sets `is_active = FALSE`. On a service that is already
inactive, the second branch is a no-op that still reports success — and since a
service is usually retired *because* it has history, that was the common case. One
icon, two outcomes, no way to tell which you were about to get.

Permanently removing a retired service with genuinely no history is still
reachable: reactivate it, then remove it. That path says what it is doing at each
step.

---

## Tests

```bash
cd slotly-backend/server && npm test
```

**392 tests across 15 suites, Vitest.** `npm run test:watch` for watch mode.

Eleven of the fifteen suites talk to a real PostgreSQL — the same one the app
uses, read from `.env`, or any database named by `DATABASE_URL`. That is
deliberate rather than lazy: the double-booking guarantee *is* a database
constraint and the one-review-per-booking and one-user-per-email guarantees *are*
unique indexes, so mocking any of them would leave the actual mechanism untested.
Those suites create their own fixtures under a namespaced email prefix
(`slotly_test_…@test.invalid`) and remove them afterwards, so they neither
depend on nor disturb whatever else is in the database.

The table below is the load-bearing coverage rather than a full inventory; the
remaining `tests/api.*.test.js` suites exercise the HTTP layer — auth, service
CRUD, parameter validation — and `tests/api.docs.test.js` fails the build if the
OpenAPI document drifts from the routes and error codes the app actually serves.

| File | Covers |
|---|---|
| `tests/slotEngine.test.js` | Slot generation from rules and buffers; **the appointment *and both buffers* fitting inside the window**, including the exactly-fits and one-minute-short cases; the candidate grid; exceptions (full-day, partial, multi-day, extra opening, block-beats-open); collision with existing bookings including the half-open boundary and buffer-only collisions; timezone conversion in both directions; **DST across both transitions**, including the shortened and lengthened window, gap and ambiguous boundaries, and a non-observing zone; **real-time booking** — the rest of today offered, a slot inside the next hour offered, a slot dropped the moment it starts, and the lead-time gate still honoured when a lead is asked for; the range cap; the performance guard. |
| `tests/bookingRules.test.js` | The **cancellation cutoff at its exact boundary** — one second before, exactly on, one second after; the snapshot rule in both directions; a zero-hour cutoff; provider transitions; two-zone rendering including a date-line crossing and a DST offset change. Plus the **reschedule-terms rule**: which party is asked, all four combinations of changed/accepted, and that a NUMERIC price arriving as the string `"30.00"` is not read as different from `30`. |
| `tests/booking.concurrency.test.js` | The **double-booking guard against a real database**: two simultaneous attempts, ten simultaneous attempts, partial overlap, buffer-only overlap, legal back-to-back, release on cancellation, retention on completion and no-show, provider isolation, and the reschedule path — including two reschedules racing for one slot. |
| `tests/accountLinking.test.js` | **One user per email address**, against a real database: a password account signing in with Google for the first time, both social providers on one address in either order, and the profile, role and password surviving the link. |
| `tests/bookingTimezone.test.js` | A **stored instant never moves**: changing a user's timezone rewrites nothing in `bookings`, the appointment re-reads correctly in the new zone, can land on a different calendar date for the viewer, and the booking-time snapshot survives untouched as history. |
| `tests/messagesAndReviews.test.js` | **One review per booking** under two racing submissions, rating bounds at the database level, whitespace-only messages rejected by a CHECK constraint, unread counting, and cascade behaviour when a booking is deleted. |
| `tests/api.booking.test.js` | The double-booking guard **one layer up**, as ten clients racing over HTTP: exactly one 201, the rest a distinguishable 409 `SLOT_TAKEN`. Plus the off-grid guard, and **real-time booking through the API** — every un-started slot left today is offered and no others, and one inside the next hour books successfully. |
| `tests/api.lifecycle.test.js` | Cancellation and its cutoff, rescheduling, status transitions and the audit timeline, all request-shaped. Plus **the timezone-change guard**: the refusal and the report it carries, that nothing is written when it refuses (not even another field in the same request), that cancelling the stranded appointment unblocks it, that a harmless move and a re-save of the current zone both go through, that a pre-existing conflict is not blamed on the change, and that a client is never blocked. Plus **the reschedule slot list**: that `?bookingId=` sizes slots from the booking's own duration rather than the service's current one, that a booking does not block its own move, that a retired service still answers, and that only a party to the booking may ask. Plus **changed service terms**: that a client's move is refused until they accept and that the refusal writes nothing, that accepting applies the new price and resizes the appointment both ways, that the provider is never asked and cannot reprice by moving it, and that a non-boolean `acceptChanges` is not read as consent. |

Every time-dependent test injects `now` explicitly, so the suite cannot start
failing in six months.

---

## API documentation

**Live: <https://slotly-backend-p2r5.onrender.com/api/docs>** — or with the
server running locally, <http://localhost:5000/api/docs>.

Every one of the 43 paths the app serves is documented with its method, auth
requirement, request body, response shape and error cases.

The raw OpenAPI 3.1 document is at `/api/docs/openapi.json`, and its source is
`server/docs/openapi.js`. Every endpoint is listed with its method, path, auth
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

**Why can a provider be blocked from changing their own timezone?**
Because their timezone is not a display preference — it is the zone their weekly
hours are interpreted in, so moving it moves their whole working day relative to
appointments that cannot move. The alternatives were both worse: allow it
silently and a provider discovers, later, that an appointment sits outside hours
they can no longer reschedule it into; or warn and allow anyway, which is the
same outcome with a dismissed dialog in front of it. Refusing is the only option
that keeps the calendar and the hours in agreement, and it costs the provider
nothing they cannot undo — the affected appointments are named, linked, and
either cancelled or rescheduled in a couple of clicks.

Two details make the refusal fair rather than obstructive. It reports only
conflicts the *change* causes, never appointments already outside the hours; and
it never fires when the posted zone is the one already saved, which is what the
settings form sends on every unrelated save.

**Why report the affected appointments rather than a count?**
"3 appointments conflict" is a dead end. Each conflict carries the client, the
service, and both clock readings of the one unmoved instant — "Tue 9 Jun, 9:00 AM
→ 4:00 AM" — because that is the sentence that makes the problem legible, and a
link straight to the booking is the shortest path to fixing it.

---

## Known limitations

- **No pagination.** Booking lists are capped at 500 rows and the provider
  directory at 100. Fine at this scale; a real deployment would need cursors.
- **Notifications are in-UI only.** Real email and SMS delivery are out of scope
  per the brief. Confirmations and cancellations surface as toasts, not messages.
- **The slot list is not live.** It refreshes on navigation and after a lost race,
  but does not poll or hold a socket open — a deliberate choice, explained above.
  Real-time booking sharpens the trade: today's remaining times are on the list,
  so a page left open drifts further from the truth than it used to. The booking
  screen drops a time once it passes, on a local clock tick, which handles the
  common case; a slot someone else takes still only surfaces on the next
  interaction.
- **Rate limits are per-process.** The limiter keeps its counters in memory, which
  is correct for a single instance and wrong the moment the API runs on more than
  one: each process would enforce its own share of the limit. Scaling out means
  moving the store to Redis. See [Rate limiting](#rate-limiting).
- **Currency is a label, not a conversion.** A provider picks the currency they
  charge in, and every price of theirs is read in it. Changing it re-denominates
  the existing numbers rather than converting them — there is no exchange rate
  anywhere in the app, because there are no payments in it either.
- **Roles cannot be changed after signup.** Choosing provider or client is a
  one-way decision, enforced server-side — see `completeProfile`. Deliberate,
  but it means a genuine change of mind needs a new account rather than a
  setting.
- **An appointment cannot straddle local midnight.** Availability windows are
  merged per calendar date, so a provider open 00:00–24:00 every day is treated
  as seven windows rather than one continuous block, and a 60-minute service is
  not offered a 23:30 start. This is the deliberate cost of anchoring the
  candidate grid somewhere range-independent — see
  [The candidate grid](#how-availability-is-modelled). It affects only
  round-the-clock or midnight-adjacent schedules; ordinary working hours never
  reach it.
- **Images are stored as uploaded** — no resizing or re-encoding, so a 5 MB photo
  is served at 5 MB.
- **Cancellation, not deletion, for services** means a provider cannot fully
  remove a service that has history. That is the intended behaviour, but there is
  no "archive" view separating retired services from active ones beyond a badge.
- **Single provider per account.** Multi-provider businesses and staff assignment
  are explicitly out of scope.
- **The frontend bundle is not code-split** (~1,081 KB, ~335 KB gzipped), largely
  the calendar library. Route-level lazy loading would be the first fix.
- **No end-to-end browser tests.** The suite covers the logic that is hard to get
  right; the UI was verified manually.

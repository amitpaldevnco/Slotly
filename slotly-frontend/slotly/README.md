# Slotly — web client

The React front end of Slotly, an appointment booking platform. A provider
publishes the services they offer and the hours they work; a client picks an open
slot and books it. Every time on screen is rendered in the local time of whoever
is looking at it.

This folder is the **SPA only**. It talks to the Slotly API over HTTP with a
cookie-based session and holds no business logic of its own — the
[API](../../slotly-backend/server) owns the data model, the slot engine, and the
full design write-up.

**Start at the [repository README](../../README.md)** for the live URLs, the demo
accounts and the one-minute tour.

**Built with** React 19, Vite, React Router, Tailwind CSS, Luxon,
`react-big-calendar`.

| | |
|---|---|
| App | <https://slotly-navy.vercel.app> |
| API | <https://slotly-backend-p2r5.onrender.com/api> |
| API reference | <https://slotly-backend-p2r5.onrender.com/api/docs> |

---

## Running it locally

**Prerequisites:** Node 20+, and the API running on <http://localhost:5000>
(see [its README](../../slotly-backend/server/README.md)).

```bash
git clone https://github.com/amitpaldevnco/Slotly.git && cd Slotly/slotly-frontend/slotly
```

```bash
npm install && cp .env.example .env && npm run dev
```

The app comes up on <http://localhost:5173>.

The port is pinned (`strictPort` in `vite.config.js`). That is deliberate: the
API's CORS allow-list names this origin exactly, and Vite's default behaviour of
quietly moving to 5174 when 5173 is busy produces an origin the API rejects —
which shows up as a login that fails for no visible reason rather than as a port
message.

```bash
npm run build      # production bundle into dist/
npm run preview    # serve the built bundle locally
npm run lint       # oxlint
```

---

## Environment variables

Locally these live in `.env`. In production they are set in **Vercel → Project
Settings → Environment Variables**.

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | yes | Base URL of the API **including the `/api` prefix** and no trailing slash. `http://localhost:5000/api` locally; your Render URL in production. |
| `VITE_GOOGLE_CLIENT_ID` | for Google login | OAuth 2.0 client ID. Must be the same value the API verifies against. |

**Everything here is public.** Vite inlines `VITE_*` variables into the bundle at
build time, so anyone can read them in the shipped JavaScript. Only the OAuth
*client ID* belongs here — it is designed to be public. The matching client
secret lives on the backend and must stay there. `.env` is gitignored;
`.env.example` lists every key with placeholder values.

Because the values are baked in at build time rather than read at run time,
changing one requires a rebuild and redeploy to take effect.

---

## Deployment

Deployed on **Vercel** as a static build; the API is a separate service on
Render. `npm run build` produces `dist/`, which Vercel serves from its CDN.

| Setting | Value |
|---|---|
| Framework preset | Vite (auto-detected) |
| **Root directory** | **`slotly-frontend/slotly`** |
| Build command | `npm run build` (auto-detected) |
| Output directory | `dist` (auto-detected) |

The root directory has to be set explicitly. This is one repository holding both
halves of the app, so left at the repository root Vercel finds no `package.json`
and the build fails before it starts. Render is pointed at
`slotly-backend/server` for the same reason, and neither builds the other.

Everything else except the environment variables is detected automatically. The
full walkthrough, including Neon, Render and Cloudinary, is in
[DEPLOYMENT.md](../../slotly-backend/server/DEPLOYMENT.md).

**[vercel.json](vercel.json) is not optional.** The app uses `BrowserRouter`, so
every route is a real URL with no file behind it. Vercel does not add an SPA
fallback for Vite projects, so without the rewrite `/dashboard` works when
reached by a click — React Router handles that in the browser — and returns 404
on a direct visit, a page reload, or the redirect back from GitHub sign-in. The
rewrite hands every path with no file behind it to `index.html`; real assets
under `/assets/` still match the filesystem first and are served normally.

**Nothing depends on `localhost`.** The API base URL is read from
`VITE_API_BASE_URL` in `src/api/client.js`; the one other place a URL is built —
`imageUrl`, for uploaded avatars and cover images — derives it from the same
value, and `githubRedirectUrl` in `src/api/auth.js` from the same again. The
localhost default in `client.js` exists so a fresh clone runs without a `.env`;
in a deployed build a missing variable surfaces as "Cannot reach the server" on
every call, which is the intended loud failure.

**Three things must agree** or authentication breaks in ways that look like CORS
faults:

1. `VITE_API_BASE_URL` here points at the deployed API, with the `/api` suffix.
2. The API's `FRONTEND_URL` names this site's origin, exactly, with no trailing
   slash — it is both the CORS allow-list and the OAuth redirect target.
3. The API runs with `NODE_ENV=production`, so its session cookie is
   `Secure; SameSite=None`. A Vercel frontend and a Render API are different
   sites, and a `Lax` cookie is never sent cross-site: sign-in would appear to
   succeed and every subsequent request would come back unauthenticated.

The Google OAuth client also needs this site's origin under **Authorized
JavaScript origins**, or the sign-in button will not render.

**On Vercel preview deployments.** Every branch and pull request gets its own
generated `*.vercel.app` hostname, and none of them will be in the API's
`FRONTEND_URL`, so API calls from a preview are blocked by CORS. Either add the
specific preview origin to `FRONTEND_URL` when you need one, or treat previews as
build checks only and test against production.

---

## Structure

```
slotly-frontend/
├── src/
│   ├── api/                axios client + one module per resource
│   ├── context/            auth session, toasts
│   ├── components/         UI, grouped by feature
│   ├── pages/              one per route
│   ├── hooks/              useApiResource, useDebouncedValue
│   └── lib/                time helpers, timezone list, shared class names
├── public/
├── index.html
├── vite.config.js
└── vercel.json             SPA rewrite for client-side routing
```

**The session is an httpOnly cookie**, set by the API. No token is ever held in
`localStorage`, so no injected script can read it — which also means the client
cannot inspect its own session and instead asks `GET /api/auth/me` who it is.
Every request goes through the axios instance in `src/api/client.js` with
`withCredentials: true`.

**Every date conversion goes through `src/lib/time.js`.** The app never builds a
date from parts and hopes; Luxon does the arithmetic, and the API sends each
instant already rendered in both parties' zones. The one place this gets involved
is `ProviderCalendar.jsx`, where `react-big-calendar` insists on positioning
events by browser-local `Date` — see the timezone section of the backend README
for why the shifted, display-only Dates there are correct.

---

## Known limitations

- **The bundle is not code-split** (~950 KB, ~300 KB gzipped), largely the
  calendar library. Route-level lazy loading would be the first fix.
- **The slot list is not live.** It carries a visible "as of" timestamp and
  refreshes after a lost race, rather than polling or holding a socket open.
- **No end-to-end browser tests.** The logic that is hard to get right lives in
  the API and is covered there; the UI was verified manually.

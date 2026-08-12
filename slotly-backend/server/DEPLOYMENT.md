# Deploying Slotly

The live deployment:

| | |
|---|---|
| App | <https://slotly-navy.vercel.app> |
| API | <https://slotly-backend-p2r5.onrender.com/api> |
| API reference | <https://slotly-backend-p2r5.onrender.com/api/docs> |

Four free services, each doing one thing:

```
Vercel (React SPA)  →  Render (Express API)  →  Neon (PostgreSQL)
                              ↓
                       Cloudinary (uploaded images)
```

This is the runbook for reproducing that from scratch. Everything here is free
tier and needs no card.

> **One repository, two build roots.** The frontend and backend live in one Git
> repository as sibling folders. Vercel and Render are each pointed at their own
> subfolder, so a push builds both without either seeing the other's
> `package.json`. That "root directory" setting is the single most common thing
> to get wrong — if a build fails complaining it cannot find a `package.json` or
> a build script, check it first.

## Contents

- [Step 1 — GitHub](#step-1--github)
- [Step 2 — Neon (database)](#step-2--neon-database)
- [Step 3 — Cloudinary (image storage)](#step-3--cloudinary-image-storage)
- [Step 4 — Render (API)](#step-4--render-api)
- [Step 5 — Vercel (frontend)](#step-5--vercel-frontend)
- [Step 6 — CORS and cookies](#step-6--cors-and-cookies)
- [Step 7 — OAuth](#step-7--oauth)
- [Step 8 — Seed and verify](#step-8--seed-and-verify)
- [Troubleshooting](#troubleshooting)
- [Checklist](#checklist)

---

## Step 1 — GitHub

Push the whole project as one repository:

```
Slotly/
├── slotly-backend/server/     ← Render builds this
├── slotly-frontend/slotly/    ← Vercel builds this
├── .gitignore
└── README.md
```

Before the first push, confirm nothing sensitive is staged:

```bash
git status --short
```

If you see `.env`, `node_modules`, `dist` or `uploads`, stop and check
`.gitignore` — the root one covers all four. `.env.example` is the one file of
that family that **is** tracked, and it carries only placeholders.

---

## Step 2 — Neon (database)

1. Create a project at <https://neon.tech>. Pick the region closest to your
   Render region — every query pays that round trip.
2. Copy the connection string from the dashboard. It looks like:

   ```
   postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
   ```

3. That whole string becomes `DATABASE_URL` in Render. Do not put it in a file.

**No migration step is needed.** `initSchema()` runs on every boot and is written
entirely as `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so pointing
the API at an empty Neon database is the entire setup. If you would rather watch
it happen outside a deploy log, run `npm run db:init` locally with `DATABASE_URL`
set to the Neon string.

---

## Step 3 — Cloudinary (image storage)

**Required in production.** Skipping this is not a cosmetic compromise — it is
why uploaded images used to disappear.

Render's free tier gives the container an ephemeral filesystem: it is rebuilt
from the image every time the service restarts, and a free service restarts
whenever it wakes from its idle sleep, not only when you redeploy. Anything
written to `uploads/` is therefore gone within the hour.

1. Sign up at <https://cloudinary.com> (free tier, no card).
2. **Dashboard → API Keys.** Copy three values:
   - Cloud name
   - API key
   - API secret
3. They become `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and
   `CLOUDINARY_API_SECRET` in Render.

All three must be set together. With any of them missing the app silently falls
back to disk — deliberately, so local development needs no account — and the
boot log says which backend it chose:

```
Image storage: Cloudinary (cloud "your-cloud") — uploads persist across restarts.
```

Nothing about upload *validation* changes. The magic-byte type check and the
`fs.stat` size check still run first, on the bytes as they landed; only a file
that passes is ever sent onward.

---

## Step 4 — Render (API)

**New → Web Service**, connect the `Slotly` repository, then:

| Setting | Value |
|---|---|
| Name | `slotly-backend` |
| Runtime | Node |
| **Root directory** | **`slotly-backend/server`** |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Plan | Free |

The root directory is the part that is specific to this being a monorepo. Left
at the repository root, Render finds no `package.json` and the build fails
immediately.

Then set these under **Environment**:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the Neon string from step 2 |
| `JWT_SECRET` | a long random string — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `FRONTEND_URL` | your Vercel URL, no trailing slash (step 5) |
| `CLOUDINARY_CLOUD_NAME` | from step 3 |
| `CLOUDINARY_API_KEY` | from step 3 |
| `CLOUDINARY_API_SECRET` | from step 3 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | step 7 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_CALLBACK_URL` | step 7 |

**Do not set `PORT`.** Render assigns one and the app must use what it is given.

`render.yaml` in this folder declares the same configuration, with every secret
as `sync: false` so no value is ever stored in the repository.

Verify:

```bash
curl https://<your-service>.onrender.com/api/health
curl https://<your-service>.onrender.com/api/health/db
```

The second one proves the pool can reach Neon. The first request after a period
of inactivity takes 20–50 seconds while the free instance wakes.

---

## Step 5 — Vercel (frontend)

**Add New → Project**, import the same `Slotly` repository, then:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| **Root directory** | **`slotly-frontend/slotly`** |
| Build command | `npm run build` (default) |
| Output directory | `dist` (default) |

Environment variables:

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<your-service>.onrender.com/api` — **including `/api`, no trailing slash** |
| `VITE_GOOGLE_CLIENT_ID` | the same client ID the backend uses |

Both are baked into the bundle at build time, so **changing either requires a
redeploy** — the built files are already compiled.

`vercel.json` rewrites every path to `index.html`, which is what makes a deep
link like `/bookings/12` work on a client-side router instead of 404-ing.

---

## Step 6 — CORS and cookies

These two travel together and cause the same symptom when either is wrong: you
sign in, it appears to work, and the next request is a 401.

**CORS.** Set `FRONTEND_URL` on Render to the exact Vercel origin:

```
https://slotly-navy.vercel.app
```

- **No trailing slash.** `https://x.vercel.app/` never matches the browser's
  `Origin` header, which has none.
- Several origins are allowed, comma-separated — useful for keeping
  `http://localhost:5173` working against the deployed API. The **first** entry
  is also where the GitHub OAuth callback redirects back to, so put the real
  frontend first.
- A wildcard is not an option: the API sends credentials, and browsers forbid
  `Access-Control-Allow-Origin: *` on a credentialed request.

**Cookies.** `NODE_ENV=production` switches the session cookie to
`Secure; SameSite=None`. This is mandatory, not a hardening nicety: Vercel and
Render are different *sites*, not merely different origins — `onrender.com` is
on the Public Suffix List — so a `SameSite=Lax` cookie would be set once and
then never sent again. Browsers only accept `SameSite=None` together with
`Secure`, which is why the two move as a pair.

---

## Step 7 — OAuth

### Google

<https://console.cloud.google.com> → **APIs & Services → Credentials → OAuth
client ID → Web application**.

| Field | Value |
|---|---|
| Authorized JavaScript origins | `https://slotly-navy.vercel.app` |
| Authorized redirect URIs | not needed — this app uses the ID-token flow, not a redirect |

The client ID must be identical in `GOOGLE_CLIENT_ID` (Render) and
`VITE_GOOGLE_CLIENT_ID` (Vercel): the frontend requests a token for that client,
and the backend verifies the token was issued for it. If the deployed origin is
missing from the origins list, the button silently fails to load.

### GitHub

<https://github.com/settings/developers> → **New OAuth App**.

| Field | Value |
|---|---|
| Homepage URL | `https://slotly-navy.vercel.app` |
| Authorization callback URL | `https://<your-service>.onrender.com/api/auth/github/callback` |

The callback points at the **API**, not the frontend — GitHub returns the code
to the server, which exchanges it using the client secret and then redirects the
browser onward. Set `GITHUB_CALLBACK_URL` to that exact string; it is sent in
the authorize request and GitHub rejects any mismatch.

A GitHub OAuth app accepts only one callback URL, so **local development needs a
second app**.

---

## Step 8 — Seed and verify

Seed the deployed database from your machine, pointing at Neon:

```bash
cd slotly-backend/server
DATABASE_URL="postgresql://…your neon string…" npm run db:seed
```

That creates two providers in different timezones, their services and
availability, and a demo client — so a reviewer can book something within a
minute of arriving. It is safe to re-run; it resets only its own rows.

Then walk the app:

| # | Check | Expect |
|---|---|---|
| 1 | `GET /api/health` | 200 |
| 2 | `GET /api/health/db` | `database: connected` |
| 3 | Open the Vercel URL | Landing page, no console errors |
| 4 | Sign in as `casey.client@slotly.demo` / `SlotlyDemo123!` | Dashboard |
| 5 | Reload the page | **Still signed in** — this is the cookie test |
| 6 | Browse a London provider's slots | Times in New York, provider's time beside them |
| 7 | Book one | Confirmation shows both timezones |
| 8 | Sign in as the provider | Same appointment, correct London time |
| 9 | Upload a profile photo | Appears |
| 10 | Wait for the instance to sleep, reload | **Photo still there** — this is the Cloudinary test |
| 11 | Cancel a booking as the client | Slot returns to the list |
| 12 | Google and GitHub sign-in | Land on the dashboard |

Steps 5 and 10 are the two that catch the failures which look fine on first
glance.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Build fails: no `package.json` | Root directory not set to the subfolder. See steps 4 and 5. |
| Every API call fails with a CORS error | `FRONTEND_URL` missing, wrong, or has a trailing slash. |
| Sign-in works, next request is 401 | `NODE_ENV` is not `production`, so the cookie is `SameSite=Lax` and never sent cross-site. |
| API calls go to `localhost` | `VITE_API_BASE_URL` was not set at **build** time. Set it and redeploy. |
| First request takes ~30s | Free instance waking. Expected. |
| Profile photos vanish after a while | Cloudinary variables not set, so the app fell back to disk. Check the boot log line. |
| GitHub login returns `redirect_uri_mismatch` | `GITHUB_CALLBACK_URL` differs from the OAuth app, including scheme and port. |
| Google button does not render | Deployed origin missing from Authorized JavaScript origins. |
| `SELF_SIGNED_CERT_IN_CHAIN` | TLS disabled for a managed host. `DATABASE_URL` enables it automatically; do not set `DB_SSL=false`. |

---

## Checklist

- [ ] One repository pushed, `.env` not in it
- [ ] Neon project created, connection string copied
- [ ] Cloudinary account created, three values copied
- [ ] Render root directory is `slotly-backend/server`
- [ ] `NODE_ENV=production` on Render
- [ ] `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` set
- [ ] All three `CLOUDINARY_*` set
- [ ] Vercel root directory is `slotly-frontend/slotly`
- [ ] `VITE_API_BASE_URL` ends in `/api`, no trailing slash
- [ ] `FRONTEND_URL` matches the Vercel origin exactly, no trailing slash
- [ ] Google origins and GitHub callback registered
- [ ] Database seeded
- [ ] Session survives a page reload
- [ ] An uploaded image survives a restart

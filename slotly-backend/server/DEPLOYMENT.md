# Deploying Slotly

The whole stack runs on free tiers, at ₹0:

```
Vercel (React SPA)  →  Render (Express API)  →  Neon (PostgreSQL)
```

Two repositories, deployed independently:

- [slotly-frontend](https://github.com/amitpaldevnco/slotly-frontend) → Vercel
- [slotly-backend](https://github.com/amitpaldevnco/slotly-backend) → Render

**Do the steps in this order.** Each one produces a URL or a credential the next
one needs, and the two that people usually get wrong — CORS and OAuth — can only
be finished once the first two URLs exist.

---

## Contents

- [Step 1 — GitHub](#step-1--github)
- [Step 2 — Neon](#step-2--neon)
- [Step 3 — Render](#step-3--render)
- [Step 4 — Vercel](#step-4--vercel)
- [Step 5 — CORS](#step-5--cors)
- [Step 6 — OAuth](#step-6--oauth)
- [Step 7 — Testing](#step-7--testing)
- [Troubleshooting](#troubleshooting)
- [Checklist](#checklist)

---

## Step 1 — GitHub

Each app folder is its own repository root, so Render and Vercel both need no
"root directory" setting.

**Before the first push,** confirm what is about to be committed:

```bash
git status
```

You should see `.env.example` and **not** `.env`. If you see `.env`,
`node_modules`, `dist`, or `uploads`, stop and check `.gitignore` before
committing.

**Frontend** — from the frontend project folder:

```bash
git init -b main
```
```bash
git add -A
```
```bash
git commit -m "Slotly frontend: React SPA with deployment configuration"
```
```bash
git remote add origin https://github.com/amitpaldevnco/slotly-frontend.git
```
```bash
git pull --rebase origin main
```
If that reports a conflict in `.gitignore`, keep your own version — during a
rebase, `--theirs` means the commit being replayed, which is yours:
```bash
git checkout --theirs .gitignore
```
```bash
git add .gitignore
```
```bash
git rebase --continue
```
```bash
git push -u origin main
```

**Backend** — from the backend project folder, the same sequence with the other
remote:

```bash
git init -b main
```
```bash
git add -A
```
```bash
git commit -m "Slotly API: Express/PostgreSQL backend with deployment configuration"
```
```bash
git remote add origin https://github.com/amitpaldevnco/slotly-backend.git
```
```bash
git pull --rebase origin main
```
```bash
git push -u origin main
```

---

## Step 2 — Neon

Neon hosts the PostgreSQL database. Nothing about the schema is manual — the API
applies it itself.

1. Sign up at [neon.tech](https://neon.tech) with GitHub. The free plan needs no
   card.
2. **Create a project.** Name it `slotly`. Pick the region closest to where you
   will run Render — keeping the API and the database in the same part of the
   world removes a round trip from every query.
3. **PostgreSQL version:** 15 or later. The schema needs `TIMESTAMPTZ`, range
   types, and the `btree_gist` extension, all of which have been standard for
   years — any version Neon offers today is fine.
4. **Copy the connection string.** Dashboard → **Connect** → *Connection string*.
   It looks like:

   ```
   postgresql://user:password@ep-something-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

   This is a **secret** — it contains the database password. Paste it only into
   Render's environment settings. Do not put it in any file in either repository.

5. **Create the schema.** You do not need to run any SQL by hand, and you do not
   need to create tables one at a time. There are two ways:

   **Either** let Render do it — the API calls `initSchema()` on every boot, so
   the first successful deploy in Step 3 creates every table, index, and
   constraint. This is the simplest path; skip ahead.

   **Or** do it now from your machine, which is useful if you want to see the
   result before deploying anything:

   ```bash
   DATABASE_URL="paste-your-neon-connection-string" npm run db:init
   ```

   It prints `Connected.` then `Schema applied.` and exits. Running it a second
   time is harmless.

6. **Verify** in the Neon console → **Tables**. You should see seven:
   `users`, `services`, `availability_rules`, `availability_exceptions`,
   `bookings`, `booking_events`, `booking_messages`, and `reviews`.

**Why this needs no migration tool.** `config/schema.js` is written entirely as
`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and
`ADD COLUMN IF NOT EXISTS`, with the two exclusion constraints wrapped in
`DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL` blocks. It is therefore
idempotent: safe on an empty database, safe on a populated one, and safe to run
repeatedly. Nothing in it drops a table or deletes a row.

**What it creates**, and why each piece matters:

| Object | Purpose |
|---|---|
| Extension `btree_gist` | Required by both exclusion constraints — it lets an equality column and a range column sit in the same GiST index. |
| `bookings_no_overlap_per_provider` | **The double-booking guarantee.** An `EXCLUDE USING gist` constraint over `provider_id` and `tstzrange(blocked_from, blocked_to)`, partial on `status <> 'cancelled'`. This is the mechanism, not a backup for application code. |
| `availability_rules_no_overlap` | Stops a provider defining two overlapping windows on the same weekday for the same service. |
| Check constraints | Wall-clock minutes stay in `0–1440`, windows are ordered, ratings are 1–5, message bodies are not pure whitespace, exception date ranges are ordered. |
| Foreign keys | `ON DELETE CASCADE` throughout, except `bookings.service_id`, which is `RESTRICT` — a service with booking history is retired (`is_active = false`), never deleted out from under an appointment. |
| Partial indexes | Provider discovery, unread message badges, and active services each get an index that skips the rows they can never match. |

There are no triggers and no stored functions; `updated_at` is set explicitly by
the queries that change a row. Nothing here is timezone-dependent — every instant
is `TIMESTAMPTZ` in UTC and Luxon converts at the edges, so the schema behaves
identically whatever Neon's server timezone is.

**Free-tier limits to know:** 0.5 GB storage, one project, and compute that
scales to zero when idle — so the first query after a quiet spell takes a few
seconds. There is no fixed expiry date.

---

## Step 3 — Render

1. [render.com](https://render.com) → sign up with GitHub → **New +** →
   **Web Service** → connect `amitpaldevnco/slotly-backend`.
2. Settings:

   | Field | Value |
   |---|---|
   | Name | `slotly-backend` |
   | Language / Runtime | **Node** |
   | Region | the one nearest your Neon region |
   | Branch | `main` |
   | **Root Directory** | *leave empty* |
   | **Build Command** | `npm ci` |
   | **Start Command** | `npm start` |
   | Instance Type | **Free** |
   | **Health Check Path** | `/api/health` |

   Node version is pinned by `"engines": { "node": ">=20" }` in `package.json`,
   so there is nothing to set. If you want an exact version, add a `NODE_VERSION`
   environment variable.

3. **Environment variables.** Add these under *Environment*:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | your Neon connection string from Step 2 |
   | `JWT_SECRET` | a fresh long random string — see below |
   | `FRONTEND_URL` | leave as `http://localhost:5173` for now; corrected in Step 5 |
   | `GOOGLE_CLIENT_ID` | from Google Cloud console |
   | `GOOGLE_CLIENT_SECRET` | from Google Cloud console |
   | `GITHUB_CLIENT_ID` | from your production GitHub OAuth app (Step 6) |
   | `GITHUB_CLIENT_SECRET` | from the same app |
   | `GITHUB_CALLBACK_URL` | `https://<your-render-url>/api/auth/github/callback` |

   **Do not set `PORT`.** Render assigns it and the code already reads
   `process.env.PORT`. Setting it yourself will stop the service from being
   reachable.

   Generate the JWT secret locally — use a different value from your local one:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   `NODE_ENV=production` is not optional. It is what switches the session cookie
   to `Secure; SameSite=None`, and without it nobody can stay signed in.

4. **Deploy**, then read the log. A healthy first boot prints:

   ```
   Connected to Database via DATABASE_URL
   Database connected successfully.
   Schema initialized.
   Server running on port 10000
   ```

5. **Verify.** Replace the host with your own:

   ```bash
   curl https://slotly-backend-xxxx.onrender.com/api/health
   ```

   Expect `{"status":"ok","success":true,...}`. Then check the database link:

   ```bash
   curl https://slotly-backend-xxxx.onrender.com/api/health/db
   ```

   Expect `{"status":"ok","database":"connected"}`. A `503` means the API is
   running but cannot reach Neon — check `DATABASE_URL`.

6. **Write down the Render URL.** Steps 4, 5, and 6 all need it.

**Free-tier behaviour:** the service spins down after 15 minutes without traffic
and takes about a minute to wake. The first request after a quiet period will feel
slow, and so will the first one after that if Neon also has to wake. This is
normal, not a fault.

---

## Step 4 — Vercel

1. [vercel.com](https://vercel.com) → sign up with GitHub → **Add New** →
   **Project** → import `amitpaldevnco/slotly-frontend`.
2. Settings — Vercel detects almost all of it:

   | Field | Value |
   |---|---|
   | **Framework Preset** | **Vite** (auto-detected) |
   | **Root Directory** | *leave as the repository root* |
   | **Build Command** | `npm run build` (auto-detected) |
   | **Output Directory** | `dist` (auto-detected) |
   | Install Command | `npm install` (auto-detected) |

3. **Environment variables**, before the first deploy:

   | Key | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://<your-render-url>/api` |
   | `VITE_GOOGLE_CLIENT_ID` | the same client ID the backend uses |

   Two things to get right. **Include the `/api` suffix** — the frontend appends
   paths like `/auth/me` to this value, and omitting it makes every call 404.
   **No trailing slash.** And note that Vite inlines these at *build* time, so
   changing one later requires a redeploy, not just a restart.

4. **Deploy.** `vercel.json` in the repository supplies the SPA rewrite, so deep
   links work with no extra configuration.
5. **Write down the Vercel URL** — something like `https://slotly-frontend.vercel.app`.

At this point the site loads but nothing works: the API is still rejecting it.
That is Step 5.

---

## Step 5 — CORS

The API allows only the origins named in `FRONTEND_URL`. It has to be told about
Vercel.

1. Render → your service → **Environment** → edit `FRONTEND_URL`:

   ```
   https://slotly-frontend.vercel.app
   ```

2. Save. Render redeploys automatically.

**Three rules for this value:**

- **No trailing slash.** `https://x.vercel.app/` will not match the browser's
  `Origin` header. (The code strips one defensively, but do not rely on it.)
- **Scheme included**, and it must be `https`.
- **The first entry is special.** `FRONTEND_URL` accepts a comma-separated list,
  and the first entry is also where the GitHub OAuth callback sends the browser
  when it finishes. Put production first.

To keep local development working against the deployed API as well:

```
https://slotly-frontend.vercel.app,http://localhost:5173
```

Never use `origin: "*"`. The session is a cookie, so the API sends credentials,
and browsers reject a wildcard origin on a credentialed response outright — it
would break authentication rather than loosen it.

**Vercel preview deployments** get their own generated hostnames, none of which
are in this list, so API calls from a preview URL will be blocked. Add a specific
preview origin when you need one, or treat previews as build checks only.

---

## Step 6 — OAuth

Both providers need their production URLs registered. Do this after Steps 3 and 4,
because both need the real domains.

### Google

Google Cloud console → **APIs & Services** → **Credentials** → your OAuth 2.0
Client ID.

**Authorized JavaScript origins** — add your Vercel origin:

```
https://slotly-frontend.vercel.app
```

**Authorized redirect URIs** — nothing to add. Slotly's Google flow uses Google
Identity Services in the browser: the frontend receives an ID token and POSTs it
to `/api/auth/google`, where the backend verifies it against `GOOGLE_CLIENT_ID`.
There is no browser redirect back to Google, so no redirect URI is involved.

Keep the existing `http://localhost:5173` origin so local development keeps
working. Changes can take a few minutes to propagate.

The **client ID** is public and is deliberately in the frontend bundle. The
**client secret** stays on Render and must never appear in the frontend, in
either repository, or in `.env.example`.

### GitHub

GitHub's OAuth flow *is* a redirect, and **a GitHub OAuth app accepts only one
callback URL**. You therefore need a second app for production rather than
editing the one you use locally.

GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**:

| Field | Value |
|---|---|
| Application name | `Slotly (production)` |
| Homepage URL | `https://slotly-frontend.vercel.app` |
| **Authorization callback URL** | `https://<your-render-url>/api/auth/github/callback` |

The callback points at **Render, not Vercel** — the backend owns this route,
because completing the exchange requires the client secret. Copy the new app's
client ID, generate a client secret, and put all three values into Render:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL` — must match the registered URL character for character

The flow, so the URLs make sense: the frontend navigates to
`GET /api/auth/github` on Render → Render redirects to GitHub → GitHub returns to
`GITHUB_CALLBACK_URL` with a code → Render exchanges it for a token using the
secret, sets the session cookie, and redirects the browser to the first entry of
`FRONTEND_URL`. If that last value is wrong, sign-in succeeds and then dumps the
user on the wrong domain with no session visible.

---

## Step 7 — Testing

Test in this order — each step depends on the one before.

**Before deploying anything**, locally:

```bash
npm test
```
```bash
npm start
```
And in the frontend project:
```bash
npm run build
```

**After deploying:**

| # | Test | What proves it worked |
|---|---|---|
| 1 | `GET /api/health` | The service is up. |
| 2 | `GET /api/health/db` | Neon is reachable. |
| 3 | Open the Vercel URL | The landing page renders and the browser console shows no CORS error. |
| 4 | **Register** with email and password | You land on profile completion. A CORS failure here means Step 5 is wrong. |
| 5 | Complete the profile as a **provider** | Timezone and business fields save. |
| 6 | **Reload the page** | You are still signed in. **This is the cross-site cookie test** — if you are signed out, `NODE_ENV` is not `production` on Render. |
| 7 | **Log out**, then log back in | The cookie is cleared and re-set correctly. |
| 8 | **Google sign-in** | The button renders (origin registered) and sign-in completes. |
| 9 | **GitHub sign-in** | You return to the app signed in, on the right domain. |
| 10 | Create a **service** | Price, duration, buffers, slot interval all save. |
| 11 | Set **weekly availability** | Hours save; add a blocked date exception too. |
| 12 | Register a second account as a **client**, in a different timezone | Use a private window so both sessions coexist. |
| 13 | Open the provider's public page as the client | Services listed, slots generated. |
| 14 | **Check the times** | Slots show in the client's timezone, and the provider's local time is also shown. This is the timezone test. |
| 15 | **Book a slot** | Confirmation appears; the slot disappears from the list. |
| 16 | Try to book the **same slot** again | Rejected with a "slot taken" message — the exclusion constraint is live on Neon. |
| 17 | **Message** on the booking, from both sides | Thread renders; unread badge clears. |
| 18 | **Reschedule** the booking | New time takes; timeline records it. |
| 19 | **Cancel** it | Status changes with a reason; the slot returns to the pool. |
| 20 | Mark a past booking **completed**, then **review** it | Rating and comment save; the provider can reply. |
| 21 | Check both **dashboards** | Provider calendar and client list both render in the right timezone. |
| 22 | Upload a **profile photo** | It appears — then see the caveat below. |

**About uploads.** Images are written to `uploads/` on the Render container's
local disk, and Render's free tier has no persistent disk. Uploaded avatars and
cover images will disappear on every deploy and restart, while the database rows
pointing at them survive, so images fall back to placeholders. Nothing else
breaks.

This is a hosting limitation, not a bug, and fixing it properly means moving file
storage off the container to something like Cloudinary's or Supabase Storage's
free tier. That is a contained change — the storage layer is confined to
`utils/fileValidation.js` and `middleware/uploadMiddleware.js` — but it is a real
change, so it has deliberately not been made. Decide whether you need it. For a
portfolio deployment, re-uploading a photo after a redeploy is usually acceptable.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Login succeeds, next request is 401; reload signs you out | `NODE_ENV` is not `production` on Render, so the cookie is `SameSite=Lax` and never sent cross-site. |
| CORS error in the console | `FRONTEND_URL` does not match the Vercel origin exactly — usually a trailing slash, `http` instead of `https`, or a preview URL. |
| Every API call 404s | `VITE_API_BASE_URL` is missing the `/api` suffix. |
| "Cannot reach the server" on every call | `VITE_API_BASE_URL` was not set in Vercel, so the build fell back to `localhost`. Set it and redeploy. |
| Reloading `/dashboard` gives 404 | `vercel.json` is missing from the deployed commit. |
| GitHub sign-in ends on the wrong domain | The first entry of `FRONTEND_URL` is not the Vercel URL. |
| GitHub returns a redirect-URI mismatch | `GITHUB_CALLBACK_URL` and the registered callback differ. |
| Google button does not render | The Vercel origin is not in *Authorized JavaScript origins*. |
| First request takes ~60s | Render free-tier cold start. Expected. |
| Deploy log: `Failed to start server` | `DATABASE_URL` is wrong or the Neon project is paused. Check `/api/health/db`. |
| Profile photos vanished after a deploy | Ephemeral disk. See *About uploads* above. |

---

## Checklist

- [ ] GitHub repository ready
- [ ] Neon database created
- [ ] Database schema migrated
- [ ] Backend deployed to Render
- [ ] Render environment variables configured
- [ ] `/api/health` working
- [ ] Frontend deployed to Vercel
- [ ] `VITE_API_BASE_URL` configured
- [ ] CORS configured
- [ ] JWT authentication tested
- [ ] Cookies tested
- [ ] Google OAuth configured
- [ ] GitHub OAuth configured
- [ ] Booking tested
- [ ] Availability tested
- [ ] Timezone conversion tested
- [ ] Messaging tested
- [ ] Reviews tested
- [ ] No secrets committed to GitHub

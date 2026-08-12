/**
 * Deployment-dependent configuration, in one place.
 *
 * Three things have to agree with each other once the API and the SPA live on
 * different hosts, and getting any one of them wrong breaks sign-in in a way
 * that looks like a CORS problem: the CORS allow-list, the base URL the OAuth
 * callback redirects back to, and the session cookie's cross-site attributes.
 * They are derived from the same environment here so they cannot drift.
 */

/** True on Render (or any host that sets NODE_ENV=production). */
export const isProduction = process.env.NODE_ENV === "production";

/**
 * Allowed browser origins, comma-separated in FRONTEND_URL.
 *
 * Auth is cookie-based, so the API sends credentials and a wildcard origin is
 * not permitted — every deployed frontend origin has to be named here.
 */
export const allowedOrigins = (
  process.env.FRONTEND_URL || "http://localhost:5173"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

/**
 * Where the GitHub OAuth callback sends the browser when it is finished.
 *
 * FRONTEND_URL may legitimately hold several origins, but a redirect can only
 * go to one, so the first entry is the canonical frontend. Read through this
 * rather than `process.env.FRONTEND_URL` directly: interpolating the raw value
 * into a redirect produces a broken URL the moment a second origin is added.
 */
export const frontendBaseUrl = allowedOrigins[0];

/**
 * Options for the session cookie.
 *
 * `sameSite` is the part that matters in production. On Render the SPA and the
 * API sit on different subdomains of `onrender.com`, which is on the Public
 * Suffix List — so the browser treats them as different *sites*, not merely
 * different origins, and a `SameSite=Lax` cookie is never sent with the SPA's
 * requests. The session would be set and then silently ignored on every
 * subsequent call. `SameSite=None` is therefore required, and browsers only
 * accept it together with `Secure`, which is why the two move as a pair.
 *
 * In development both halves run on localhost — different ports are the same
 * site — so `Lax` is correct there, and `Secure` would stop the cookie working
 * over plain HTTP.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * The same options without `maxAge`, for `res.clearCookie`.
 *
 * A cookie is only cleared when the attributes match the ones it was set with.
 * `maxAge` has to be left out: Express derives `expires` from it and would
 * overwrite the expiry-in-the-past that does the clearing, leaving the session
 * cookie in place.
 */
export const sessionCookieClearOptions = {
  httpOnly: sessionCookieOptions.httpOnly,
  secure: sessionCookieOptions.secure,
  sameSite: sessionCookieOptions.sameSite,
};

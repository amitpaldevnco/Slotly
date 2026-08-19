/**
 * Request rate limits.
 *
 * These exist for one reason above all others: the credential endpoints. Nothing
 * else in the API is worth grinding against, but `/auth/login` answers a yes/no
 * question about a secret, and without a limit an attacker can ask it as many
 * times a second as the network allows. A password policy that only requires
 * eight characters does not survive that; neither does any policy, given long
 * enough.
 *
 * ## Why the limits are shaped the way they are
 *
 * Three tiers, because the endpoints have genuinely different threat profiles:
 *
 *   - **`credentialsLimiter`** guards login and the OAuth exchanges — the
 *     endpoints that *verify* a secret. Tight, and it counts only failures
 *     (`skipSuccessfulRequests`), so a person legitimately signing in and out
 *     all day is never affected while someone guessing is stopped after twenty
 *     wrong answers.
 *   - **`signupLimiter`** guards registration. The risk here is bulk account
 *     creation and address enumeration rather than secret-guessing, so it counts
 *     every request, successful or not, over a longer window.
 *   - **`apiLimiter`** is a broad backstop for everything else. Deliberately
 *     loose: it should never fire for a real session, and exists only so a
 *     single caller cannot monopolise the process.
 *
 * ## Keying, and the proxy
 *
 * The default key is the client IP, which is only correct because `server.js`
 * sets `trust proxy` to 1 — Render terminates TLS at its edge and forwards over
 * HTTP, so without that every request would appear to come from the load
 * balancer and the whole world would share one bucket. The two settings are a
 * pair; changing one without the other silently breaks this file.
 *
 * ## What this is not
 *
 * The store is in-memory, so limits are per-process. That is correct for a
 * single instance and wrong the moment the API is scaled horizontally, at which
 * point this needs a shared store (Redis) — noted in the README's limitations
 * rather than pretended away here.
 */
import { rateLimit } from "express-rate-limit";
import { errorResponse, ERROR_CODES } from "../responseController/responseHandler.js";

/**
 * Whether the limits are inert.
 *
 * The API suites drive the real app through supertest, from a single address, and
 * create dozens of fixture accounts per run — which is indistinguishable from
 * exactly the abuse `signupLimiter` exists to stop. Left enabled, the limits would
 * fail the suite for being correct.
 *
 * So they are off under test *by default* and can be switched on for the one
 * suite that asserts they work, via `setRateLimitingEnabledForTests()`. The
 * alternative — an env var read at import time — cannot be toggled once the app
 * module is loaded, which is precisely when a test needs to change it.
 *
 * This is gated on NODE_ENV === "test" and nothing else, so there is no
 * combination of request headers or environment that turns the limits off in a
 * deployed process.
 */
const UNDER_TEST = process.env.NODE_ENV === "test";
let enabledInTests = false;

/**
 * Turns the limits on or off for the duration of a test.
 *
 * No effect outside NODE_ENV === "test" — in any other environment the limits are
 * always on and this function cannot disable them.
 *
 * @param {boolean} enabled
 */
export function setRateLimitingEnabledForTests(enabled) {
  enabledInTests = Boolean(enabled);
}

/** True when this request should bypass the limiter entirely. */
function inert() {
  return UNDER_TEST && !enabledInTests;
}

/**
 * Shared rejection handler, so a throttled caller gets the same machine-readable
 * envelope as every other error in the API rather than express-rate-limit's own
 * plain-text default.
 *
 * `retryAfterSeconds` is surfaced in the body as well as the `Retry-After`
 * header because the frontend reads JSON, not headers, and a countdown is the
 * one thing that makes this error actionable.
 */
function reject(req, res) {
  const resetAt = req.rateLimit?.resetTime;
  const retryAfterSeconds = resetAt
    ? Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
    : undefined;

  return errorResponse(
    res,
    "Too many attempts. Please wait a moment and try again.",
    429,
    ERROR_CODES.RATE_LIMITED,
    retryAfterSeconds ? { retryAfterSeconds } : undefined
  );
}

/** Options every tier shares. */
const shared = {
  // `standardHeaders: "draft-7"` emits RateLimit / RateLimit-Policy. Legacy
  // X-RateLimit-* headers are off: nothing consumes them and they leak the
  // policy more loudly than is useful.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: reject,
  skip: inert,
};

/**
 * Login and OAuth token exchange: 20 *failed* attempts per IP per 15 minutes.
 *
 * Counting only failures is what keeps this invisible to real users. A shared
 * office NAT can sign in all day without ever incrementing the counter; twenty
 * consecutive wrong passwords from that same address still stops.
 */
export const credentialsLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
});

/**
 * Registration: 10 accounts per IP per hour, counting every attempt.
 *
 * Successes are counted here — unlike the credentials tier — because the abuse
 * being prevented *is* the successful case. It also blunts the address
 * enumeration that "this email is already registered" would otherwise permit.
 */
export const signupLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

/**
 * Everything else: 300 requests per IP per minute.
 *
 * Sized so it never fires during ordinary use — a booking page loads a handful
 * of resources — while still bounding what one caller can extract.
 */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
  // Health checks are what an uptime monitor hits every thirty seconds from one
  // address; throttling those would make the API look down when it is not.
  skip: (req) => inert() || req.path === "/health" || req.path === "/health/db",
});

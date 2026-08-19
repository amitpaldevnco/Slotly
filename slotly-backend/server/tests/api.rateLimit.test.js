/**
 * Rate limiting on the credential endpoints.
 *
 * The limits are inert under test by default — the other API suites create
 * dozens of fixture accounts from one address per run, which is exactly the
 * shape of the abuse `signupLimiter` exists to stop, so leaving them on would
 * fail the suite for being correct. This file switches them on deliberately, for
 * its own duration only, via `setRateLimitingEnabledForTests()`.
 *
 * What is worth asserting here is narrow but real:
 *
 *   - that a burst of wrong passwords is eventually refused at all, since the
 *     whole point is that an unbounded guesser is stopped;
 *   - that the refusal is a 429 carrying the same machine-readable envelope as
 *     every other error, not express-rate-limit's plain-text default, because
 *     the frontend branches on `code`;
 *   - that a *correct* password is not counted, so the limit is invisible to the
 *     people it is not aimed at. That is the property most likely to be broken
 *     by a later edit, and the one users would feel first.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { guest, createUser, cleanupApiTestData, closeTestPool, TEST_PASSWORD } from "./apiHarness.js";
import { setRateLimitingEnabledForTests } from "../middleware/rateLimit.js";

/** Matches `credentialsLimiter`'s ceiling in middleware/rateLimit.js. */
const LOGIN_ATTEMPT_LIMIT = 20;

let account;

beforeAll(async () => {
  await cleanupApiTestData();
  // Created while the limits are still inert: this fixture is setup, not the
  // thing under test.
  account = await createUser({ role: "client", timezone: "Europe/London", label: "ratelimit" });
  setRateLimitingEnabledForTests(true);
});

afterAll(async () => {
  // Left on, this would leak into whichever suite ran next and fail it for
  // reasons that have nothing to do with its own subject.
  setRateLimitingEnabledForTests(false);
  await cleanupApiTestData();
  await closeTestPool();
});

describe("credential rate limiting", () => {
  // Runs first, and deliberately so: it needs a window this address has not yet
  // exhausted. `skipSuccessfulRequests` stops a success *incrementing* the
  // counter — it does not exempt a request once the ceiling is already reached,
  // because the limiter rejects before the handler ever runs. So the property
  // can only be observed from a clean window, and the burst test below has to
  // come after it.
  it("does not count successful logins against the limit", async () => {
    // Comfortably more sign-ins than the ceiling. If successes were counted,
    // this would start returning 429 partway through.
    for (let attempt = 0; attempt < LOGIN_ATTEMPT_LIMIT + 5; attempt += 1) {
      const response = await guest()
        .post("/api/auth/login")
        .send({ email: account.email, password: TEST_PASSWORD });

      expect(response.status, `sign-in ${attempt + 1}`).toBe(200);
    }
  });

  it("stops a burst of wrong passwords with a 429 the client can branch on", async () => {
    let throttled = null;

    // One past the ceiling. Sequential rather than concurrent so the counter is
    // incremented deterministically — a Promise.all here could all pass the
    // check before any of them recorded an attempt.
    for (let attempt = 0; attempt <= LOGIN_ATTEMPT_LIMIT; attempt += 1) {
      const response = await guest()
        .post("/api/auth/login")
        .send({ email: account.email, password: `wrong-${attempt}` });

      if (response.status === 429) {
        throttled = response;
        break;
      }
      // Everything before the limit is an ordinary rejection, not a throttle.
      expect(response.status).toBe(401);
    }

    expect(throttled, "expected a 429 within the attempt ceiling").not.toBeNull();
    expect(throttled.body.success).toBe(false);
    expect(throttled.body.code).toBe("RATE_LIMITED");
    // Without this the UI can say "try again" but never "try again when".
    expect(throttled.body.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("leaves reads alone", async () => {
    // The broad `apiLimiter` is sized so ordinary browsing never trips it, and
    // health checks are skipped outright so an uptime monitor cannot throttle
    // itself into reporting the API as down.
    const health = await guest().get("/api/health");
    expect(health.status).toBe(200);

    const providers = await guest().get("/api/providers");
    expect(providers.status).toBe(200);
  });
});

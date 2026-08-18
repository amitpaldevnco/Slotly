/**
 * Shared setup for the HTTP-level API suites.
 *
 * ## Why these suites exist alongside the unit tests
 *
 * The unit suites prove the *logic* is right: the slot engine, the cancellation
 * cutoff, the exclusion constraint. None of them go through Express, so none of
 * them can see routing, middleware ordering, authorization, request parsing or
 * status codes — and that is precisely the layer two real defects were found in
 * (a 500 for a malformed id, and a booking accepted for a time that was never
 * offered). A guard that lives in middleware is only proven by a request.
 *
 * `server.js` exports the app without calling `listen`, so supertest binds an
 * ephemeral port per request and nothing has to be running for `npm test`.
 *
 * ## Isolation
 *
 * Every account these suites create carries the `apitest+` local-part prefix,
 * and `cleanupApiTestData()` deletes exactly those rows and everything hanging
 * off them. That is what makes the suites safe to run against a database that
 * also holds the demo seed and a developer's own account: nothing outside the
 * prefix is ever touched. Emails also carry a per-run random suffix, so two runs
 * overlapping — a watch mode and a terminal, say — cannot collide on a UNIQUE
 * email.
 */
import request from "supertest";
import app from "../server.js";
import { createTestPool } from "./testDatabase.js";

/** Local-part prefix owned by these suites. Nothing else may be deleted. */
export const TEST_EMAIL_PREFIX = "apitest+";

/** Shared password. Long enough to clear the 8-character minimum. */
export const TEST_PASSWORD = "Str0ngPassw0rd!";

let pool;

/** The pool used for fixture setup and teardown only — never by the app itself. */
export function testPool() {
  if (!pool) pool = createTestPool({ max: 15 });
  return pool;
}

export async function closeTestPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** A supertest agent, which persists the session cookie across requests. */
export function client() {
  return request.agent(app);
}

/** An agent that has never authenticated — used for the public-surface checks. */
export function guest() {
  return request(app);
}

let counter = 0;
const runId = Math.random().toString(36).slice(2, 8);

/** A unique address inside the prefix this harness is allowed to delete. */
export function testEmail(label = "user") {
  counter += 1;
  return `${TEST_EMAIL_PREFIX}${label}.${runId}.${counter}@slotly.test`;
}

/**
 * Registers an account and completes its profile, returning a logged-in agent.
 *
 * Registration and profile completion are two calls in this API by design —
 * `role` is written exactly once, by `complete-profile` — so a fixture that
 * needs a usable provider or client has to make both.
 *
 * @param {object} args
 * @param {"client"|"provider"} args.role
 * @param {string} [args.timezone] IANA zone. Defaults differ per role so the
 *   fixtures are cross-timezone by default rather than by remembering to ask.
 * @param {string} [args.label] Appears in the email address, for debugging.
 * @returns {Promise<{agent: object, id: number, email: string, timezone: string}>}
 */
export async function createUser({ role, timezone, label = role }) {
  const zone = timezone || (role === "provider" ? "Europe/London" : "America/New_York");
  const agent = client();
  const email = testEmail(label);

  const registered = await agent
    .post("/api/auth/register")
    .send({ name: `Test ${label}`, email, password: TEST_PASSWORD });

  if (registered.status !== 201) {
    throw new Error(`fixture: register failed (${registered.status}) ${JSON.stringify(registered.body)}`);
  }

  const completed = await agent.patch("/api/auth/complete-profile").send({
    role,
    phoneNumber: "+441234567890",
    timezone: zone,
    ...(role === "provider" ? { businessName: `Test Biz ${runId}${counter}`, businessType: "Physio" } : {}),
  });

  if (completed.status !== 200) {
    throw new Error(`fixture: complete-profile failed (${completed.status}) ${JSON.stringify(completed.body)}`);
  }

  return { agent, id: completed.body.data.user.id, email, timezone: zone };
}

/**
 * Creates a service owned by `provider`.
 *
 * Defaults are chosen so the arithmetic in the tests is easy to read: a
 * 60-minute service on a 60-minute grid with no buffers publishes 09:00, 10:00,
 * 11:00 …, which makes an off-grid time obvious at a glance.
 */
export async function createService(provider, overrides = {}) {
  const response = await provider.agent.post("/api/services").send({
    service_name: "Test Service",
    price: 50,
    duration: 60,
    buffer_before: 0,
    buffer_after: 0,
    slot_interval: 60,
    ...overrides,
  });

  if (response.status !== 201) {
    throw new Error(`fixture: createService failed (${response.status}) ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

/** Replaces a provider's weekly hours. Defaults to Monday–Friday, 09:00–17:00. */
export async function setWeeklyHours(provider, rules) {
  const weekly = rules || [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }));
  const response = await provider.agent.put("/api/availability/rules").send({ rules: weekly });

  if (response.status !== 200) {
    throw new Error(`fixture: setWeeklyHours failed (${response.status}) ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

/**
 * A date range that starts comfortably clear of the minimum-notice floor.
 *
 * Slots are never offered on the provider's current local day, so a range
 * beginning "tomorrow" can legitimately come back empty depending on what time
 * the suite runs. Starting three days out removes that from the tests entirely.
 *
 * @param {number} [startOffsetDays]
 * @param {number} [lengthDays]
 * @returns {{from: string, to: string}} Inclusive "YYYY-MM-DD" bounds.
 */
export function futureRange(startOffsetDays = 3, lengthDays = 10) {
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  return { from: day(startOffsetDays), to: day(startOffsetDays + lengthDays) };
}

/**
 * Fetches a provider's bookable slots, flattened out of the day grouping.
 *
 * The endpoint groups by the viewer's local date because that is how the picker
 * renders it; assertions almost always want the flat list.
 *
 * @returns {Promise<Array<{startsAt: string, endsAt: string, clientTime: string, providerTime: string, date: string}>>}
 */
export async function fetchSlots(agent, providerId, serviceId, range = futureRange()) {
  const response = await agent.get(
    `/api/providers/${providerId}/slots?serviceId=${serviceId}&from=${range.from}&to=${range.to}`
  );

  if (response.status !== 200) {
    throw new Error(`fixture: fetchSlots failed (${response.status}) ${JSON.stringify(response.body)}`);
  }

  return (response.body.data.days || []).flatMap((d) => d.slots.map((s) => ({ ...s, date: d.date })));
}

/**
 * Removes every row these suites created.
 *
 * Ordering is deliberate. `bookings.service_id` is `ON DELETE RESTRICT`, so
 * services cannot go while a booking still points at one — the bookings have to
 * be cleared first, and only then the services and the users. Everything else
 * (booking_events, booking_messages, reviews, availability rows) cascades.
 *
 * Scoped by the email prefix throughout, so a database shared with the demo seed
 * or a developer's own account comes out untouched.
 */
export async function cleanupApiTestData() {
  const db = testPool();
  const owned = `SELECT id FROM users WHERE email LIKE '${TEST_EMAIL_PREFIX}%'`;

  await db.query(`DELETE FROM bookings WHERE client_id IN (${owned}) OR provider_id IN (${owned})`);
  await db.query(`DELETE FROM services WHERE provider_id IN (${owned})`);
  await db.query(`DELETE FROM users WHERE email LIKE '${TEST_EMAIL_PREFIX}%'`);
}

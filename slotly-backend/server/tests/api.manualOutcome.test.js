/**
 * The provider decides every appointment's outcome. Nothing settles on its own.
 *
 * This suite is the contract for that rule, end to end: a finished appointment
 * keeps its active status indefinitely, contributes nothing to earnings while it
 * waits, is surfaced to the provider as something to act on, and only becomes
 * 'completed' or 'no_show' when the provider says so.
 *
 * The money assertions are the reason this file exists separately from
 * `api.lifecycle.test.js`, which covers transitions generally. Earnings are
 * summed over `price_snapshot WHERE status = 'completed'`, so *anything* that
 * reaches 'completed' without a person deciding it is revenue the app invented.
 * The app used to do exactly that, twice — first on `ends_at`, then after a
 * one-hour grace period — so "reading the dashboard did not bank the money" is
 * worth asserting directly rather than inferring from a status check.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createUser,
  createService,
  setWeeklyHours,
  fetchSlots,
  futureRange,
  cleanupApiTestData,
  closeTestPool,
  testPool,
} from "./apiHarness.js";

let provider;
let clientUser;
let service;
const range = futureRange();

/** The price every fixture booking is worth, so earnings maths stays legible. */
const PRICE = 120;

async function bookFirstFreeSlot() {
  const slots = await fetchSlots(clientUser.agent, provider.id, service.id, range);
  const response = await clientUser.agent
    .post("/api/bookings")
    .send({ serviceId: service.id, startsAt: slots[0].startsAt });

  if (response.status !== 201) {
    throw new Error(`fixture: booking failed (${response.status}) ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

/**
 * Drops a booking into the past by rewriting its times directly.
 *
 * The API refuses to create a booking in the past, so a finished appointment
 * cannot be produced through it. Appointment span and blocked span move together
 * or the exclusion constraint would be comparing a range the row no longer has.
 *
 * Every call must use a **distinct** `endedMinutesAgo`, at least one appointment
 * length apart: an unsettled booking still occupies the provider's calendar, so
 * two fixtures parked on the same past window collide on the constraint.
 */
async function endBookingMinutesAgo(id, endedMinutesAgo) {
  await testPool().query(
    `UPDATE bookings
     SET starts_at    = NOW() - ($2 || ' minutes')::interval - INTERVAL '30 minutes',
         ends_at      = NOW() - ($2 || ' minutes')::interval,
         blocked_from = NOW() - ($2 || ' minutes')::interval - INTERVAL '30 minutes',
         blocked_to   = NOW() - ($2 || ' minutes')::interval
     WHERE id = $1`,
    [id, String(endedMinutesAgo)]
  );
}

const summaryFor = async () => (await provider.agent.get("/api/bookings/summary")).body.data;

beforeAll(async () => {
  await cleanupApiTestData();
  provider = await createUser({ role: "provider", timezone: "Europe/London", label: "outprov" });
  clientUser = await createUser({ role: "client", timezone: "Asia/Kolkata", label: "outcli" });
  service = await createService(provider, { price: PRICE, duration: 30, slot_interval: 30 });
  await setWeeklyHours(
    provider,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }))
  );
});

afterAll(async () => {
  await cleanupApiTestData();
  await closeTestPool();
});

// ---------------------------------------------------------------------------
describe("a finished appointment is never completed automatically", () => {
  it("keeps its active status after its end time passes", async () => {
    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 10);

    const detail = await provider.agent.get(`/api/bookings/${booking.id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("booked");
  });

  it("is still not completed hours later, no matter how often it is read", async () => {
    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 600);

    // Every endpoint that used to run auto-completion lazily on read.
    await provider.agent.get("/api/bookings");
    await provider.agent.get("/api/bookings/summary");
    await provider.agent.get(`/api/bookings/${booking.id}`);
    await clientUser.agent.get("/api/bookings");

    const detail = await provider.agent.get(`/api/bookings/${booking.id}`);
    expect(detail.body.data.status).toBe("booked");
  });

  it("records no automatic earnings while it waits to be settled", async () => {
    const before = await summaryFor();

    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 1000);

    const after = await summaryFor();

    // The appointment is over and worth PRICE, and none of it has been banked.
    expect(after.totalEarnings).toBe(before.totalEarnings);
    expect(after.completedBookings).toBe(before.completedBookings);

    // It is instead reported as outstanding, at its full value.
    expect(after.awaitingOutcome).toBe(before.awaitingOutcome + 1);
    expect(after.awaitingOutcomeValue).toBe(before.awaitingOutcomeValue + PRICE);
  });
});

// ---------------------------------------------------------------------------
describe("the provider is reminded that a result is needed", () => {
  it("flags the booking itself as awaiting an outcome", async () => {
    const booking = await bookFirstFreeSlot();

    const upcoming = await provider.agent.get(`/api/bookings/${booking.id}`);
    expect(upcoming.body.data.awaitingOutcome).toBe(false);

    await endBookingMinutesAgo(booking.id, 1400);

    const finished = await provider.agent.get(`/api/bookings/${booking.id}`);
    expect(finished.body.data.awaitingOutcome).toBe(true);
  });

  it("lists them under scope=awaiting_outcome, oldest first", async () => {
    const older = await bookFirstFreeSlot();
    await endBookingMinutesAgo(older.id, 1800);
    const newer = await bookFirstFreeSlot();
    await endBookingMinutesAgo(newer.id, 1700);

    const response = await provider.agent.get("/api/bookings?scope=awaiting_outcome");
    expect(response.status).toBe(200);

    const ids = response.body.data.bookings.map((b) => b.id);
    expect(ids).toContain(older.id);
    expect(ids).toContain(newer.id);
    // Oldest-first: the one that ended longer ago comes first.
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));

    // Nothing in the queue has been settled, and every entry really is finished.
    for (const b of response.body.data.bookings) {
      expect(["booked", "rescheduled"]).toContain(b.status);
      expect(b.awaitingOutcome).toBe(true);
    }
  });

  it("excludes appointments that have not finished yet", async () => {
    const future = await bookFirstFreeSlot();

    const response = await provider.agent.get("/api/bookings?scope=awaiting_outcome");
    const ids = response.body.data.bookings.map((b) => b.id);

    expect(ids).not.toContain(future.id);
  });

  it("does not change the booking by merely reporting it", async () => {
    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 2000);

    const before = await provider.agent.get(`/api/bookings/${booking.id}`);
    const timelineBefore = before.body.data.timeline.length;

    // Read the reminder surfaces repeatedly.
    await provider.agent.get("/api/bookings?scope=awaiting_outcome");
    await provider.agent.get("/api/bookings/summary");
    await provider.agent.get("/api/bookings?scope=awaiting_outcome");

    const after = await provider.agent.get(`/api/bookings/${booking.id}`);

    expect(after.body.data.status).toBe(before.body.data.status);
    // No event was appended — the reminder is a read, not a write.
    expect(after.body.data.timeline.length).toBe(timelineBefore);
  });
});

// ---------------------------------------------------------------------------
describe("the provider settles it by hand", () => {
  it("marks it completed and counts the earnings", async () => {
    const before = await summaryFor();

    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 2400);

    const response = await provider.agent
      .patch(`/api/bookings/${booking.id}/status`)
      .send({ status: "completed" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("completed");

    const after = await summaryFor();
    expect(after.totalEarnings).toBe(before.totalEarnings + PRICE);
    expect(after.completedBookings).toBe(before.completedBookings + 1);
    // It has left the queue.
    expect(after.awaitingOutcome).toBe(before.awaitingOutcome);

    // Attributed to the provider who clicked it, not to 'system'.
    const detail = await provider.agent.get(`/api/bookings/${booking.id}`);
    const entry = detail.body.data.timeline.find((e) => e.toStatus === "completed");
    expect(entry.actor.role).toBe("provider");
    expect(entry.actor.id).toBe(provider.id);
    expect(detail.body.data.awaitingOutcome).toBe(false);
  });

  it("marks it no-show and counts no earnings", async () => {
    const before = await summaryFor();

    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 2800);

    const response = await provider.agent
      .patch(`/api/bookings/${booking.id}/status`)
      .send({ status: "no_show" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("no_show");

    const after = await summaryFor();
    // The appointment was worth PRICE and none of it is banked.
    expect(after.totalEarnings).toBe(before.totalEarnings);
    expect(after.completedBookings).toBe(before.completedBookings);
    expect(after.awaitingOutcome).toBe(before.awaitingOutcome);

    const detail = await provider.agent.get(`/api/bookings/${booking.id}`);
    expect(detail.body.data.awaitingOutcome).toBe(false);
  });

  it("still refuses an outcome before the appointment has started", async () => {
    const booking = await bookFirstFreeSlot();

    for (const status of ["completed", "no_show"]) {
      const response = await provider.agent
        .patch(`/api/bookings/${booking.id}/status`)
        .send({ status });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("APPOINTMENT_NOT_STARTED");
    }
  });

  it("lets only the provider record the outcome", async () => {
    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 3200);

    const response = await clientUser.agent
      .patch(`/api/bookings/${booking.id}/status`)
      .send({ status: "completed" });

    expect(response.status).toBe(403);

    const detail = await provider.agent.get(`/api/bookings/${booking.id}`);
    expect(detail.body.data.status).toBe("booked");
  });
});

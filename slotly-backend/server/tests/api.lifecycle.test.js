/**
 * HTTP-level tests for the booking lifecycle: cancellation, rescheduling,
 * status transitions and the audit timeline.
 *
 * `tests/bookingRules.test.js` pins the cutoff arithmetic to the second as a
 * pure function. What it cannot show is whether the controller consults that
 * function, whether the refusal carries a code the UI can branch on, and
 * whether the row actually stops occupying the calendar afterwards. Those are
 * request-shaped questions, so they live here.
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
let bystander;
let service;
const range = futureRange();

/** Books the first slot still on offer and returns the created booking. */
async function bookFirstFreeSlot(as = clientUser, svc = service, prov = provider) {
  const slots = await fetchSlots(as.agent, prov.id, svc.id, range);
  const response = await as.agent.post("/api/bookings").send({ serviceId: svc.id, startsAt: slots[0].startsAt });

  if (response.status !== 201) {
    throw new Error(`fixture: booking failed (${response.status}) ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

beforeAll(async () => {
  await cleanupApiTestData();
  provider = await createUser({ role: "provider", timezone: "Europe/London", label: "lifeprov" });
  clientUser = await createUser({ role: "client", timezone: "America/New_York", label: "lifecli" });
  bystander = await createUser({ role: "client", timezone: "Asia/Kolkata", label: "lifebys" });
  service = await createService(provider);
  await setWeeklyHours(provider, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));
});

afterAll(async () => {
  await cleanupApiTestData();
  await closeTestPool();
});

// ---------------------------------------------------------------------------
describe("client cancellation and the cutoff", () => {
  it("lets a client cancel while the window is open", async () => {
    const booking = await bookFirstFreeSlot();

    const response = await clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("cancelled");
    expect(response.body.data.cancelledAt).toBeTruthy();
  });

  it("refuses once the cutoff has passed, and says when the deadline was", async () => {
    // A 720-hour (30-day) cutoff puts every bookable slot past the deadline, so
    // the boundary can be exercised without waiting or faking a clock.
    const strict = await createUser({ role: "provider", timezone: "Europe/London", label: "strictprov" });
    const strictService = await createService(strict);
    await setWeeklyHours(strict, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));
    await strict.agent.patch("/api/availability/settings").send({ cancellationCutoffHours: 720 });

    const booking = await bookFirstFreeSlot(clientUser, strictService, strict);
    const response = await clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({});

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("CANCELLATION_WINDOW_CLOSED");
    // The refusal has to explain itself, or the UI cannot tell the client why.
    expect(response.body.details.deadline).toBeTruthy();
    expect(response.body.details.cutoffHours).toBe(720);

    // The provider is not bound by their own client-facing cutoff.
    const byProvider = await strict.agent
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ reason: "Clinic closed" });
    expect(byProvider.status).toBe(200);
  });

  it("uses the cutoff snapshotted at booking time, not the current setting", async () => {
    // Tightening a policy must not retroactively strand someone who booked
    // under the old one.
    const lenient = await createUser({ role: "provider", timezone: "Europe/London", label: "snapprov" });
    const lenientService = await createService(lenient);
    await setWeeklyHours(lenient, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));
    await lenient.agent.patch("/api/availability/settings").send({ cancellationCutoffHours: 1 });

    const booking = await bookFirstFreeSlot(clientUser, lenientService, lenient);
    expect(booking.cancellationCutoffHours).toBe(1);

    // Provider tightens the policy *after* the booking exists.
    await lenient.agent.patch("/api/availability/settings").send({ cancellationCutoffHours: 720 });

    const response = await clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({});
    expect(response.status).toBe(200);
  });

  it("refuses a second cancellation of the same booking", async () => {
    const booking = await bookFirstFreeSlot();
    await clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({});

    const again = await clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({});

    expect(again.status).toBe(409);
    expect(again.body.code).toBe("BOOKING_NOT_ACTIVE");
  });

  it("resolves two simultaneous cancellations to a single timeline entry", async () => {
    const booking = await bookFirstFreeSlot();

    const [a, b] = await Promise.all([
      clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({}),
      clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({}),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const detail = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    const cancellations = detail.body.data.timeline.filter((e) => e.toStatus === "cancelled");
    expect(cancellations).toHaveLength(1);
  });

  it("keeps a cancelled booking in history rather than deleting it", async () => {
    const booking = await bookFirstFreeSlot();
    await clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({});

    const detail = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("cancelled");

    const past = await clientUser.agent.get("/api/bookings?scope=past");
    expect(past.body.data.bookings.some((b) => b.id === booking.id)).toBe(true);

    // …and it no longer counts as upcoming.
    const upcoming = await clientUser.agent.get("/api/bookings?scope=upcoming");
    expect(upcoming.body.data.bookings.some((b) => b.id === booking.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("provider cancellation", () => {
  it("insists on a reason", async () => {
    const booking = await bookFirstFreeSlot();

    const response = await provider.agent.post(`/api/bookings/${booking.id}/cancel`).send({});

    expect(response.status).toBe(400);
    expect(response.body.details[0].field).toBe("reason");
  });

  it("stores the reason on the booking and in the timeline", async () => {
    const booking = await bookFirstFreeSlot();
    const reason = "Clinic flooded, rebooking everyone";

    const response = await provider.agent.post(`/api/bookings/${booking.id}/cancel`).send({ reason });
    expect(response.status).toBe(200);
    expect(response.body.data.cancellationReason).toBe(reason);

    const detail = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    const entry = detail.body.data.timeline.find((e) => e.toStatus === "cancelled");
    expect(entry.reason).toBe(reason);
    expect(entry.actor.role).toBe("provider");
  });

  it("rejects an over-long reason", async () => {
    const booking = await bookFirstFreeSlot();

    const response = await provider.agent
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ reason: "x".repeat(501) });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("rescheduling", () => {
  it("insists on both a new time and a reason", async () => {
    const booking = await bookFirstFreeSlot();
    const slots = await fetchSlots(clientUser.agent, provider.id, service.id, range);

    const noReason = await provider.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: slots[0].startsAt });
    const noTime = await provider.agent.post(`/api/bookings/${booking.id}/reschedule`).send({ reason: "moving" });

    expect(noReason.status).toBe(400);
    expect(noReason.body.details.some((d) => d.field === "reason")).toBe(true);
    expect(noTime.status).toBe(400);
  });

  it("moves the booking and records both the old and new time", async () => {
    const booking = await bookFirstFreeSlot();
    const slots = await fetchSlots(clientUser.agent, provider.id, service.id, range);
    const destination = slots.find((s) => s.startsAt !== booking.startsAt);

    const response = await provider.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: destination.startsAt, reason: "Double-booked the room" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("rescheduled");
    expect(response.body.data.startsAt).toBe(destination.startsAt);

    const detail = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    const entry = detail.body.data.timeline.find((e) => e.toStatus === "rescheduled");
    expect(entry.fromStartsAt).toBe(booking.startsAt);
    expect(entry.toStartsAt).toBe(destination.startsAt);
    expect(entry.reason).toBe("Double-booked the room");
  });

  it("frees the old slot and occupies the new one", async () => {
    const booking = await bookFirstFreeSlot();
    const slots = await fetchSlots(bystander.agent, provider.id, service.id, range);
    const destination = slots[0];

    await provider.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: destination.startsAt, reason: "Moving" });

    const after = await fetchSlots(bystander.agent, provider.id, service.id, range);
    expect(after.some((s) => s.startsAt === booking.startsAt)).toBe(true);
    expect(after.some((s) => s.startsAt === destination.startsAt)).toBe(false);
  });

  it("loses the same race as an insert when the destination is taken", async () => {
    // A reschedule is an UPDATE, but it is governed by the same exclusion
    // constraint — so it must fail the same way, with the same code.
    const mine = await bookFirstFreeSlot(clientUser);
    const theirs = await bookFirstFreeSlot(bystander);

    const response = await provider.agent
      .post(`/api/bookings/${mine.id}/reschedule`)
      .send({ startsAt: theirs.startsAt, reason: "Onto an occupied slot" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SLOT_TAKEN");
  });

  // The client-facing half of rescheduling. A client moving their own
  // appointment is the ordinary case — before this existed they had to cancel
  // and rebook, which released the slot to the pool in between and split one
  // appointment's history across two unrelated rows.
  it("lets a client move their own booking without giving a reason", async () => {
    const booking = await bookFirstFreeSlot();
    const slots = await fetchSlots(clientUser.agent, provider.id, service.id, range);
    const destination = slots.find((s) => s.startsAt !== booking.startsAt);

    const response = await clientUser.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: destination.startsAt });

    expect(response.status).toBe(200);
    expect(response.body.data.startsAt).toBe(destination.startsAt);
    expect(response.body.data.status).toBe("rescheduled");

    // Attributed to the client, not silently logged as a provider action.
    const detail = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    const entry = detail.body.data.timeline.find((e) => e.toStatus === "rescheduled");
    expect(entry.actor.role).toBe("client");
    expect(entry.actor.id).toBe(clientUser.id);
    expect(entry.fromStartsAt).toBe(booking.startsAt);
  });

  it("frees the client's old slot when they move it themselves", async () => {
    const booking = await bookFirstFreeSlot();
    const before = await fetchSlots(bystander.agent, provider.id, service.id, range);
    const destination = before.find((s) => s.startsAt !== booking.startsAt);

    await clientUser.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: destination.startsAt });

    const after = await fetchSlots(bystander.agent, provider.id, service.id, range);
    const offered = after.map((s) => s.startsAt);

    expect(offered).toContain(booking.startsAt);
    expect(offered).not.toContain(destination.startsAt);
  });

  it("holds a client to the same cutoff that governs cancelling", async () => {
    // Same 30-day-cutoff trick as the cancellation test: it puts every bookable
    // slot past the deadline without faking a clock. If reschedule were exempt,
    // a client could dodge the cutoff by moving the appointment and cancelling
    // it from its new date.
    const strict = await createUser({ role: "provider", timezone: "Europe/London", label: "rstrictprov" });
    const strictService = await createService(strict);
    await setWeeklyHours(
      strict,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }))
    );
    await strict.agent.patch("/api/availability/settings").send({ cancellationCutoffHours: 720 });

    const booking = await bookFirstFreeSlot(clientUser, strictService, strict);
    const slots = await fetchSlots(clientUser.agent, strict.id, strictService.id, range);
    const destination = slots.find((s) => s.startsAt !== booking.startsAt);

    const response = await clientUser.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: destination.startsAt });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("RESCHEDULE_WINDOW_CLOSED");
    expect(response.body.details.deadline).toBeTruthy();

    // The provider is not bound by the cutoff they set for clients.
    const byProvider = await strict.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: destination.startsAt, reason: "Moving it myself" });
    expect(byProvider.status).toBe(200);
  });

  it("still requires a reason from the provider, but not from the client", async () => {
    const booking = await bookFirstFreeSlot();
    const slots = await fetchSlots(clientUser.agent, provider.id, service.id, range);
    const destination = slots.find((s) => s.startsAt !== booking.startsAt);

    // The provider is imposing the change on someone else, so they must say why.
    const byProvider = await provider.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: destination.startsAt });
    expect(byProvider.status).toBe(400);
    expect(byProvider.body.details.some((d) => d.field === "reason")).toBe(true);

    // The client is moving their own appointment, so no explanation is owed.
    const byClient = await clientUser.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: destination.startsAt });
    expect(byClient.status).toBe(200);
  });

  it("refuses to reschedule a cancelled booking", async () => {
    const booking = await bookFirstFreeSlot();
    await clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({});

    const slots = await fetchSlots(clientUser.agent, provider.id, service.id, range);
    const response = await provider.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: slots[0].startsAt, reason: "Too late" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("BOOKING_NOT_ACTIVE");
  });

  it("refuses to move a booking into the past", async () => {
    const booking = await bookFirstFreeSlot();

    const response = await provider.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: "2020-01-01T09:00:00.000Z", reason: "Backwards" });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("status transitions", () => {
  it("refuses completed or no-show before the appointment has started", async () => {
    const booking = await bookFirstFreeSlot();

    for (const status of ["completed", "no_show"]) {
      const response = await provider.agent.patch(`/api/bookings/${booking.id}/status`).send({ status });
      expect(response.status, status).toBe(409);
      expect(response.body.code).toBe("APPOINTMENT_NOT_STARTED");
    }
  });

  // 400, not 409, and the distinction is the point rather than a detail. A 409
  // says "the request is fine but conflicts with the current state of the
  // resource" — which is true of the two refusals above this one, and would stop
  // being true if the appointment simply started. "banana" is not a status at
  // any point in any booking's life, so no state of the resource could make the
  // request succeed. That is a malformed request, and it is a 400.
  it("refuses a status that is not in the schema, as malformed input", async () => {
    const booking = await bookFirstFreeSlot();

    const response = await provider.agent.patch(`/api/bookings/${booking.id}/status`).send({ status: "banana" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_STATUS");
  });

  it("sends cancellation to its own endpoint rather than accepting it here", async () => {
    const booking = await bookFirstFreeSlot();

    const response = await provider.agent
      .patch(`/api/bookings/${booking.id}/status`)
      .send({ status: "cancelled" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_TRANSITION");
  });

  it("refuses any transition out of a terminal status", async () => {
    const booking = await bookFirstFreeSlot();
    await clientUser.agent.post(`/api/bookings/${booking.id}/cancel`).send({});

    const response = await provider.agent.patch(`/api/bookings/${booking.id}/status`).send({ status: "completed" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("BOOKING_NOT_ACTIVE");
  });
});

// ---------------------------------------------------------------------------
/**
 * The window in which a finished appointment's outcome is still the provider's
 * to record.
 *
 * These exist because of a real defect. Auto-completion used to fire the moment
 * `ends_at` passed, and it runs lazily on *read* — so the provider opening their
 * dashboard settled every finished appointment as 'completed' before they could
 * click anything. 'no_show' was in the schema, the API and the UI, and could not
 * be reached: the only window was *during* the appointment. The first test below
 * is the regression guard for exactly that sequence.
 */
describe("the outcome window after an appointment ends", () => {
  /**
   * Drops a booking into the past by rewriting its times directly.
   *
   * The API refuses to create a booking in the past — correctly — so a finished
   * appointment cannot be produced through it. Both the appointment span and the
   * blocked span move together, or the exclusion constraint would be comparing a
   * range that no longer matches the row.
   *
   * Every test here must pass a *distinct* `endedMinutesAgo`, at least one
   * appointment-length apart. A settled booking still occupies the provider's
   * calendar — the exclusion constraint only ignores cancelled rows — so two
   * tests parking their bookings on the same past window collide on it.
   *
   * @param {number} id
   * @param {number} endedMinutesAgo How long ago the appointment finished.
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

  it("still accepts no-show after the provider has opened their dashboard", async () => {
    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 5);

    // The step that used to destroy the outcome: a plain list read.
    const list = await provider.agent.get("/api/bookings");
    expect(list.status).toBe(200);

    const response = await provider.agent
      .patch(`/api/bookings/${booking.id}/status`)
      .send({ status: "no_show" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("no_show");
  });

  it("leaves a just-finished appointment active rather than settling it on read", async () => {
    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 45);

    const detail = await provider.agent.get(`/api/bookings/${booking.id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("booked");
  });

  it("completes it once the window has closed, and says the system did it", async () => {
    const booking = await bookFirstFreeSlot();
    // Comfortably past the one-hour grace.
    await endBookingMinutesAgo(booking.id, 180);

    const detail = await provider.agent.get(`/api/bookings/${booking.id}`);
    expect(detail.body.data.status).toBe("completed");

    // Attributed to 'system', not to whichever party happened to load the page,
    // and with no user behind it.
    const entry = detail.body.data.timeline.find((e) => e.toStatus === "completed");
    expect(entry.actor.role).toBe("system");
    expect(entry.actor.id).toBeNull();
  });

  it("will not accept no-show once the window has closed", async () => {
    const booking = await bookFirstFreeSlot();
    await endBookingMinutesAgo(booking.id, 400);

    await provider.agent.get(`/api/bookings/${booking.id}`);

    const response = await provider.agent
      .patch(`/api/bookings/${booking.id}/status`)
      .send({ status: "no_show" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("BOOKING_NOT_ACTIVE");
  });
});

// ---------------------------------------------------------------------------
describe("the audit timeline", () => {
  it("records every move, in order, with who made it", async () => {
    const booking = await bookFirstFreeSlot();
    const slots = await fetchSlots(bystander.agent, provider.id, service.id, range);

    await provider.agent
      .post(`/api/bookings/${booking.id}/reschedule`)
      .send({ startsAt: slots[0].startsAt, reason: "Moved once" });
    await provider.agent.post(`/api/bookings/${booking.id}/cancel`).send({ reason: "Then cancelled" });

    const detail = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    const timeline = detail.body.data.timeline;

    expect(timeline.map((e) => e.toStatus)).toEqual(["booked", "rescheduled", "cancelled"]);
    expect(timeline.map((e) => e.actor.role)).toEqual(["client", "provider", "provider"]);
    expect(timeline.every((e) => Boolean(e.at))).toBe(true);

    // Each entry is rendered in both parties' zones, like the appointment itself.
    expect(timeline[0].atLocal.client.timezone).toBe(clientUser.timezone);
    expect(timeline[0].atLocal.provider.timezone).toBe(provider.timezone);
  });

  it("is visible to the provider as well as the client", async () => {
    const booking = await bookFirstFreeSlot();

    const asProvider = await provider.agent.get(`/api/bookings/${booking.id}`);

    expect(asProvider.status).toBe(200);
    expect(asProvider.body.data.viewerRole).toBe("provider");
    expect(asProvider.body.data.timeline.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("timezone changes never move an appointment", () => {
  it("keeps the instant fixed and follows the reader's current zone", async () => {
    const traveller = await createUser({ role: "client", timezone: "Asia/Kolkata", label: "travelcli" });
    const booking = await bookFirstFreeSlot(traveller);

    expect(booking.time.client.timezone).toBe("Asia/Kolkata");

    await traveller.agent.patch("/api/auth/profile").send({ timezone: "Pacific/Auckland" });

    const after = await traveller.agent.get(`/api/bookings/${booking.id}`);

    // The appointment did not move — only the reader did.
    expect(after.body.data.startsAt).toBe(booking.startsAt);
    expect(after.body.data.time.client.timezone).toBe("Pacific/Auckland");
    expect(after.body.data.time.client.formatted).not.toBe(booking.time.client.formatted);
    // …and the zone in force at booking time is kept as history.
    expect(after.body.data.client.timezoneAtBooking).toBe("Asia/Kolkata");
  });

  it("leaves an existing booking alone when the provider moves city", async () => {
    const mover = await createUser({ role: "provider", timezone: "Europe/London", label: "moverprov" });
    const moverService = await createService(mover);
    await setWeeklyHours(mover, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));

    const booking = await bookFirstFreeSlot(clientUser, moverService, mover);

    // Paris rather than Tokyo: the first free slot is 09:00 London, which reads
    // 10:00 in Paris and is still inside a 09:00-17:00 day, so this move strands
    // nothing and goes through. The describe below covers the move that would.
    const changed = await mover.agent.patch("/api/auth/profile").send({ timezone: "Europe/Paris" });
    expect(changed.status).toBe(200);

    const after = await clientUser.agent.get(`/api/bookings/${booking.id}`);

    expect(after.body.data.startsAt).toBe(booking.startsAt);
    expect(after.body.data.time.provider.timezone).toBe("Europe/Paris");
    expect(after.body.data.provider.timezoneAtBooking).toBe("Europe/London");
  });
});

// ---------------------------------------------------------------------------
describe("a provider's timezone change is checked against their calendar first", () => {
  /**
   * A provider open 09:00-17:00 every day, with one appointment booked at the
   * first free slot - which is 09:00 in their own zone.
   *
   * Each test builds its own rather than sharing one, because half of them
   * deliberately change the provider's zone and the other half assert it did not
   * move; a shared fixture would leak that between them.
   */
  async function providerWithOneBooking(label) {
    const prov = await createUser({ role: "provider", timezone: "Europe/London", label });
    const svc = await createService(prov);
    await setWeeklyHours(
      prov,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }))
    );
    const booking = await bookFirstFreeSlot(clientUser, svc, prov);
    return { prov, svc, booking };
  }

  it("refuses the change and names the appointments it would strand", async () => {
    const { prov, booking } = await providerWithOneBooking("tzconflict");

    // London 09:00 is 17:00 in Tokyo, and a 60-minute appointment starting at
    // 17:00 runs past the end of a 09:00-17:00 day. The same instant as always,
    // now outside the hours the provider would be declaring.
    const response = await prov.agent.patch("/api/auth/profile").send({ timezone: "Asia/Tokyo" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("TIMEZONE_CONFLICT");
    expect(response.body.details.safe).toBe(false);
    expect(response.body.details.conflictCount).toBe(1);

    const [conflict] = response.body.details.conflicts;
    expect(conflict.bookingId).toBe(booking.id);
    expect(conflict.reason).toBe("OUTSIDE_AVAILABILITY");
    // Both clock readings of the one unmoved instant, so the provider can see
    // exactly what the move does to it.
    expect(conflict.startsAt).toBe(booking.startsAt);
    expect(conflict.current.timezone).toBe("Europe/London");
    expect(conflict.proposed.timezone).toBe("Asia/Tokyo");
    expect(conflict.current.startsAt).not.toBe(conflict.proposed.startsAt);
    // Enough to act on: who it is with, and what it is.
    expect(conflict.client.name).toBeTruthy();
    expect(conflict.service.name).toBeTruthy();
  });

  it("writes nothing when it refuses", async () => {
    const { prov, booking } = await providerWithOneBooking("tzrollback");

    await prov.agent.patch("/api/auth/profile").send({ timezone: "Asia/Tokyo" });

    const me = await prov.agent.get("/api/auth/me");
    expect(me.body.data.timezone).toBe("Europe/London");

    const after = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    expect(after.body.data.startsAt).toBe(booking.startsAt);
    expect(after.body.data.time.provider.timezone).toBe("Europe/London");
  });

  it("does not half-apply the request it refuses", async () => {
    const { prov } = await providerWithOneBooking("tzatomic");

    // A conflicting zone posted alongside a perfectly good bio. Refusing the
    // request has to mean refusing all of it - saving the bio and dropping the
    // timezone would leave the provider believing the whole form saved.
    const response = await prov.agent
      .patch("/api/auth/profile")
      .send({ timezone: "Asia/Tokyo", bio: "Moving to Tokyo next month." });

    expect(response.status).toBe(409);

    const me = await prov.agent.get("/api/auth/me");
    expect(me.body.data.timezone).toBe("Europe/London");
    expect(me.body.data.bio).not.toBe("Moving to Tokyo next month.");
  });

  it("allows the change once the stranded appointment is cancelled", async () => {
    const { prov, booking } = await providerWithOneBooking("tzcleared");

    expect((await prov.agent.patch("/api/auth/profile").send({ timezone: "Asia/Tokyo" })).status).toBe(409);

    // One of the two remedies the refusal asks for. A cancelled booking no longer
    // occupies the calendar, so there is nothing left for the move to strand.
    const cancelled = await prov.agent
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ reason: "Relocating - I will be in a different timezone." });
    expect(cancelled.status).toBe(200);

    const retry = await prov.agent.patch("/api/auth/profile").send({ timezone: "Asia/Tokyo" });
    expect(retry.status).toBe(200);
    expect(retry.body.data.timezone).toBe("Asia/Tokyo");
  });

  it("allows the change when it strands nothing", async () => {
    const { prov } = await providerWithOneBooking("tzsafe");

    const response = await prov.agent.patch("/api/auth/profile").send({ timezone: "Europe/Paris" });

    expect(response.status).toBe(200);
    expect(response.body.data.timezone).toBe("Europe/Paris");
  });

  it("previews the same verdict before anything is saved", async () => {
    const { prov, booking } = await providerWithOneBooking("tzpreview");

    const bad = await prov.agent.get("/api/availability/timezone-impact?timezone=Asia/Tokyo");
    // A conflict is the answer to the question asked here, not an error.
    expect(bad.status).toBe(200);
    expect(bad.body.data.safe).toBe(false);
    expect(bad.body.data.conflicts.map((c) => c.bookingId)).toEqual([booking.id]);
    expect(bad.body.data.upcomingCount).toBeGreaterThanOrEqual(1);

    const good = await prov.agent.get("/api/availability/timezone-impact?timezone=Europe/Paris");
    expect(good.body.data.safe).toBe(true);
    expect(good.body.data.conflicts).toEqual([]);

    // Looking changed nothing.
    const me = await prov.agent.get("/api/auth/me");
    expect(me.body.data.timezone).toBe("Europe/London");
  });

  it("treats re-saving the current zone as nothing to check", async () => {
    const { prov } = await providerWithOneBooking("tznoop");

    const impact = await prov.agent.get("/api/availability/timezone-impact?timezone=Europe/London");
    expect(impact.body.data.changed).toBe(false);
    expect(impact.body.data.safe).toBe(true);

    // The settings form posts the zone with every save, so a provider editing an
    // unrelated field sends their unchanged zone too. That must never be refused.
    const saved = await prov.agent
      .patch("/api/auth/profile")
      .send({ timezone: "Europe/London", bio: "Still in London." });
    expect(saved.status).toBe(200);
  });

  it("ignores appointments already outside the provider's hours", async () => {
    // Not every appointment outside the hours is this change's doing. Here the
    // provider trims their own day after the booking was made, so the appointment
    // is already stranded - and an unrelated zone change must not be blamed for
    // it, nor blocked by it, since no choice of zone would fix it.
    const { prov } = await providerWithOneBooking("tzpreexisting");

    await setWeeklyHours(
      prov,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "13:00", endTime: "17:00" }))
    );

    const response = await prov.agent.patch("/api/auth/profile").send({ timezone: "Asia/Tokyo" });

    expect(response.status).toBe(200);
    expect(response.body.data.timezone).toBe("Asia/Tokyo");
  });

  it("rejects a zone it could never have stored", async () => {
    const { prov } = await providerWithOneBooking("tzbogus");

    const response = await prov.agent.get("/api/availability/timezone-impact?timezone=Mars/Olympus_Mons");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
  });

  it("does not stand in a client's way", async () => {
    // A client's timezone drives display only. Nothing is interpreted in it, so
    // there is nothing it can strand.
    const traveller = await createUser({ role: "client", timezone: "Europe/London", label: "tzclient" });
    await bookFirstFreeSlot(traveller);

    const response = await traveller.agent.patch("/api/auth/profile").send({ timezone: "Asia/Tokyo" });

    expect(response.status).toBe(200);
    expect(response.body.data.timezone).toBe("Asia/Tokyo");
  });
});

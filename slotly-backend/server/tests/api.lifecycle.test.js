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

  it("refuses a status that is not in the schema", async () => {
    const booking = await bookFirstFreeSlot();

    const response = await provider.agent.patch(`/api/bookings/${booking.id}/status`).send({ status: "banana" });

    expect(response.status).toBe(409);
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

    await mover.agent.patch("/api/auth/profile").send({ timezone: "Asia/Tokyo" });

    const after = await clientUser.agent.get(`/api/bookings/${booking.id}`);

    expect(after.body.data.startsAt).toBe(booking.startsAt);
    expect(after.body.data.time.provider.timezone).toBe("Asia/Tokyo");
    expect(after.body.data.provider.timezoneAtBooking).toBe("Europe/London");
  });
});

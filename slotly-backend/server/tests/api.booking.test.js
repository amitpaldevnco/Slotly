/**
 * HTTP-level tests for booking, the concurrency guard, and the slot grid.
 *
 * `tests/booking.concurrency.test.js` already proves the exclusion constraint
 * holds when two transactions race at the database. This file asks the question
 * one layer up, which is the one the brief actually poses: when two *clients*
 * submit a booking for the same slot at the same moment, does exactly one
 * succeed and does the other get a clear, distinguishable "no longer available"
 * response? A constraint that holds but is reported as a 500 fails the brief.
 *
 * It also pins down the off-grid hole: a booking is only legal on a start the
 * slot list actually published. That guard lives in the controller, so only a
 * request can prove it is wired up.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createUser,
  createService,
  setWeeklyHours,
  fetchSlots,
  futureRange,
  guest,
  cleanupApiTestData,
  closeTestPool,
} from "./apiHarness.js";

let provider;
let clients;
let service;
const range = futureRange();

beforeAll(async () => {
  await cleanupApiTestData();
  provider = await createUser({ role: "provider", timezone: "Europe/London", label: "bookprov" });
  service = await createService(provider);
  await setWeeklyHours(provider);

  // Ten separate accounts, because the race below has to be ten different
  // people rather than one person clicking ten times.
  clients = [];
  for (let i = 0; i < 10; i += 1) {
    clients.push(await createUser({ role: "client", timezone: "America/New_York", label: `bookcli${i}` }));
  }
});

afterAll(async () => {
  await cleanupApiTestData();
  await closeTestPool();
});

// ---------------------------------------------------------------------------
describe("the double-booking guarantee, through the API", () => {
  it("admits exactly one of ten simultaneous requests for the same slot", async () => {
    const [slot] = await fetchSlots(clients[0].agent, provider.id, service.id, range);

    // Fired together on purpose. The requests are built first and awaited as a
    // batch so they reach the INSERT at genuinely the same moment.
    const responses = await Promise.all(
      clients.map((c) => c.agent.post("/api/bookings").send({ serviceId: service.id, startsAt: slot.startsAt }))
    );

    const created = responses.filter((r) => r.status === 201);
    const lost = responses.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(lost).toHaveLength(9);

    // The brief is explicit that a lost race must be distinguishable, not a
    // generic failure — so the code matters as much as the count.
    expect(lost.every((r) => r.body.code === "SLOT_TAKEN")).toBe(true);
    expect(responses.some((r) => r.status >= 500)).toBe(false);
  });

  it("stops offering a slot the moment it is taken", async () => {
    const before = await fetchSlots(clients[0].agent, provider.id, service.id, range);
    const target = before[0];

    const created = await clients[0].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: target.startsAt });
    expect(created.status).toBe(201);

    const after = await fetchSlots(clients[1].agent, provider.id, service.id, range);
    expect(after.some((s) => s.startsAt === target.startsAt)).toBe(false);
  });

  it("returns the slot to the pool when the booking is cancelled", async () => {
    const before = await fetchSlots(clients[2].agent, provider.id, service.id, range);
    const target = before[0];

    const created = await clients[2].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: target.startsAt });

    const cancelled = await clients[2].agent.post(`/api/bookings/${created.body.data.id}/cancel`).send({});
    expect(cancelled.status).toBe(200);

    const after = await fetchSlots(clients[2].agent, provider.id, service.id, range);
    expect(after.some((s) => s.startsAt === target.startsAt)).toBe(true);
  });

  it("keeps one provider's bookings out of another's calendar", async () => {
    const otherProvider = await createUser({ role: "provider", timezone: "Europe/London", label: "bookprov2" });
    const otherService = await createService(otherProvider);
    await setWeeklyHours(otherProvider);

    const mine = await fetchSlots(clients[3].agent, provider.id, service.id, range);
    const theirs = await fetchSlots(clients[3].agent, otherProvider.id, otherService.id, range);

    // The same instant is free on both calendars — the constraint is scoped per
    // provider, so booking it with one must not remove it from the other.
    const shared = mine.find((m) => theirs.some((t) => t.startsAt === m.startsAt));
    expect(shared).toBeDefined();

    const first = await clients[3].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: shared.startsAt });
    const second = await clients[4].agent
      .post("/api/bookings")
      .send({ serviceId: otherService.id, startsAt: shared.startsAt });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe("a booking must land on a start the slot list published", () => {
  // The regression suite for the off-grid hole. `isWithinAvailability` was the
  // only write-path guard, and it is satisfied by any span that fits inside an
  // open window — so 09:17 on a 09:00/10:00 grid was accepted. Worse, because
  // such an appointment straddles two grid positions, one of them removed two
  // bookable slots rather than one.
  let offeredStart;

  beforeAll(async () => {
    const slots = await fetchSlots(clients[5].agent, provider.id, service.id, range);
    offeredStart = new Date(slots.find((s) => !s.taken).startsAt).getTime();
  });

  it.each([7, 17, 30, 59])("refuses a start %i minutes off the grid", async (offset) => {
    const response = await clients[5].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: new Date(offeredStart + offset * 60_000).toISOString() });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SLOT_UNAVAILABLE");
  });

  it("refuses a start before the first offered one, even inside the window", async () => {
    const response = await clients[5].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: new Date(offeredStart - 30 * 60_000).toISOString() });

    expect(response.status).toBe(409);
  });

  it("refuses a time the provider is closed for", async () => {
    // 03:00 on a Sunday — the case the brief names.
    const sunday = new Date(offeredStart);
    sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7 || 7));
    sunday.setUTCHours(3, 0, 0, 0);

    const response = await clients[5].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: sunday.toISOString() });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SLOT_UNAVAILABLE");
  });

  it("refuses an instant in the past", async () => {
    const response = await clients[5].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: "2020-01-01T09:00:00.000Z" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("SLOT_UNAVAILABLE");
  });

  it("never offers a slot on the provider's current local day", async () => {
    // The minimum-notice rule is a calendar-date floor in the *provider's* zone:
    // today is off the table however much of it remains. Asserting on the
    // listing rather than on a crafted POST keeps this independent of what time
    // the suite happens to run at.
    const { DateTime } = await import("luxon");
    const providerToday = DateTime.now().setZone("Europe/London").toFormat("yyyy-MM-dd");

    const slots = await fetchSlots(clients[5].agent, provider.id, service.id, {
      from: DateTime.now().setZone("Europe/London").toFormat("yyyy-MM-dd"),
      to: DateTime.now().setZone("Europe/London").plus({ days: 7 }).toFormat("yyyy-MM-dd"),
    });

    const onToday = slots.filter(
      (s) => DateTime.fromISO(s.startsAt).setZone("Europe/London").toFormat("yyyy-MM-dd") === providerToday
    );
    expect(onToday).toEqual([]);
  });

  it("enforces the notice rule on the write path, not only in the listing", async () => {
    // A client could otherwise skip the picker and POST a same-day time
    // directly. Which guard answers first depends on the clock — a time already
    // past for the provider is SLOT_UNAVAILABLE, one still to come today is
    // MINIMUM_NOTICE_REQUIRED, and one outside 09:00–17:00 is off the grid — so
    // the assertion is that it is refused, with a code that says why.
    const { DateTime } = await import("luxon");
    const noonToday = DateTime.now().setZone("Europe/London").set({ hour: 12, minute: 0, second: 0, millisecond: 0 });

    const response = await clients[5].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: noonToday.toUTC().toISO() });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(["MINIMUM_NOTICE_REQUIRED", "SLOT_UNAVAILABLE"]).toContain(response.body.code);
  });

  it("accepts every start the list offers, and consumes exactly one per booking", async () => {
    // The other half of the contract: the guard must not have become so strict
    // that it rejects legitimate slots. Booking three offered starts must remove
    // three — the collateral loss an off-grid booking used to cause is the bug.
    const isolated = await createUser({ role: "provider", timezone: "Europe/London", label: "gridprov" });
    const isolatedService = await createService(isolated);
    await setWeeklyHours(isolated);

    const before = await fetchSlots(clients[6].agent, isolated.id, isolatedService.id, range);
    expect(before.length).toBeGreaterThan(3);

    for (const slot of before.slice(0, 3)) {
      const response = await clients[6].agent
        .post("/api/bookings")
        .send({ serviceId: isolatedService.id, startsAt: slot.startsAt });
      expect(response.status, `offered slot ${slot.startsAt} should be bookable`).toBe(201);
    }

    const after = await fetchSlots(clients[6].agent, isolated.id, isolatedService.id, range);
    expect(before.length - after.length).toBe(3);
  });

  it("respects a service's own slot_interval", async () => {
    const halfHour = await createService(provider, {
      service_name: "Half Hour Grid",
      duration: 30,
      slot_interval: 30,
    });

    const slots = await fetchSlots(clients[7].agent, provider.id, halfHour.id, range);
    const onGrid = new Date(slots[0].startsAt).getTime();

    const good = await clients[7].agent
      .post("/api/bookings")
      .send({ serviceId: halfHour.id, startsAt: new Date(onGrid + 30 * 60_000).toISOString() });
    const bad = await clients[8].agent
      .post("/api/bookings")
      .send({ serviceId: halfHour.id, startsAt: new Date(onGrid + 15 * 60_000).toISOString() });

    expect(good.status).toBe(201);
    expect(bad.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe("the booking confirmation", () => {
  it("reports the appointment in both parties' timezones", async () => {
    // A requirement of the brief in its own right: the confirmation screen shows
    // the time in the client's zone and the provider's.
    const kolkata = await createUser({ role: "client", timezone: "Asia/Kolkata", label: "tzcli" });
    const slots = await fetchSlots(kolkata.agent, provider.id, service.id, range);

    const response = await kolkata.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: slots[0].startsAt });

    expect(response.status).toBe(201);

    const { time } = response.body.data;
    expect(time.client.timezone).toBe("Asia/Kolkata");
    expect(time.provider.timezone).toBe("Europe/London");
    expect(time.client.formatted).toBeTruthy();
    expect(time.provider.formatted).toBeTruthy();
    // The same instant, read two ways — the offsets must actually differ.
    expect(time.client.offset).not.toBe(time.provider.offset);
    expect(time.utc).toBe(response.body.data.startsAt);
  });

  it("records who made the booking in the timeline", async () => {
    const slots = await fetchSlots(clients[9].agent, provider.id, service.id, range);
    const created = await clients[9].agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: slots[0].startsAt });

    const detail = await clients[9].agent.get(`/api/bookings/${created.body.data.id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data.timeline).toHaveLength(1);
    expect(detail.body.data.timeline[0]).toMatchObject({
      fromStatus: null,
      toStatus: "booked",
      actor: { id: clients[9].id, role: "client" },
    });
  });
});

// ---------------------------------------------------------------------------
describe("slot listing", () => {
  it("renders the same instants differently for two viewers", async () => {
    const newYork = await createUser({ role: "client", timezone: "America/New_York", label: "nycli" });
    const kolkata = await createUser({ role: "client", timezone: "Asia/Kolkata", label: "inclil" });

    const fromNy = await fetchSlots(newYork.agent, provider.id, service.id, range);
    const fromIn = await fetchSlots(kolkata.agent, provider.id, service.id, range);

    // Same underlying moments…
    expect(fromNy.map((s) => s.startsAt)).toEqual(fromIn.map((s) => s.startsAt));
    // …read on two different clocks.
    expect(fromNy[0].clientTime).not.toBe(fromIn[0].clientTime);
    // …and the provider's own reading is the same on both.
    expect(fromNy[0].providerTime).toBe(fromIn[0].providerTime);
  });

  it("refuses a range wider than the cap with its own code", async () => {
    const response = await guest().get(
      `/api/providers/${provider.id}/slots?serviceId=${service.id}&from=2099-01-01&to=2099-12-31`
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("RANGE_TOO_WIDE");
  });

  it("refuses an unparseable date rather than guessing", async () => {
    const response = await guest().get(
      `/api/providers/${provider.id}/slots?serviceId=${service.id}&from=garbage&to=2099-01-02`
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
  });

  it("requires a serviceId", async () => {
    const response = await guest().get(`/api/providers/${provider.id}/slots?from=2099-01-01&to=2099-01-02`);
    expect(response.status).toBe(400);
  });

  it("404s for a service that belongs to a different provider", async () => {
    const other = await createUser({ role: "provider", label: "slotprov" });

    const response = await guest().get(
      `/api/providers/${other.id}/slots?serviceId=${service.id}&from=2099-01-01&to=2099-01-02`
    );

    expect(response.status).toBe(404);
  });
});

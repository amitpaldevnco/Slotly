/**
 * HTTP-level tests for the service lifecycle and the recent-conversations feed.
 *
 * Two behaviours here were reported as defects and are pinned down below.
 *
 * **Retiring was a one-way door.** `is_active` is a boolean and nothing is
 * destroyed, so retiring was always reversible in the data — but the app had no
 * way to reverse it. A provider who retired something by mistake, or who paused
 * a service for a season, had to recreate it, and a recreated service is a
 * *different row*: it loses its own booking history and its reviews.
 *
 * **A retired service was still editable.** Live bookings display the name and
 * price snapshotted onto them, so editing a retired service changed a row that
 * only history reads — a form that appeared to work and affected nothing.
 *
 * The conversations feed replaces a dashboard panel headed "Recent Messages"
 * that listed *upcoming bookings*, ordered by appointment date and timestamped
 * with `startsAt` — so it routinely showed a future time for a message nobody
 * had sent.
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

let clientUser;
let otherClient;
const range = futureRange();

/** A provider with one service and seven-day hours, isolated per test. */
async function providerWithService(label) {
  const owner = await createUser({ role: "provider", timezone: "Europe/London", label });
  const service = await createService(owner, { service_name: `Svc ${label}` });
  await setWeeklyHours(
    owner,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }))
  );
  return { owner, service };
}

/** Books the first slot still on offer, so a service has history to protect. */
async function book(as, service, owner) {
  const slots = await fetchSlots(as.agent, owner.id, service.id, range);
  const response = await as.agent
    .post("/api/bookings")
    .send({ serviceId: service.id, startsAt: slots[0].startsAt });

  if (response.status !== 201) {
    throw new Error(`fixture: booking failed (${response.status}) ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

beforeAll(async () => {
  await cleanupApiTestData();
  clientUser = await createUser({ role: "client", timezone: "America/New_York", label: "svccli" });
  otherClient = await createUser({ role: "client", timezone: "Asia/Kolkata", label: "svccli2" });
});

afterAll(async () => {
  await cleanupApiTestData();
  await closeTestPool();
});

// ---------------------------------------------------------------------------
describe("retiring a service", () => {
  it("deletes it outright when it has never been booked", async () => {
    const { owner, service } = await providerWithService("delprov");

    const response = await owner.agent.delete(`/api/services/${service.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ deleted: true, retired: false });

    const services = await owner.agent.get(`/api/providers/${owner.id}/services`);
    expect(services.body.data.some((s) => s.id === service.id)).toBe(false);
  });

  it("retires rather than deletes once it has history, and the booking stands", async () => {
    const { owner, service } = await providerWithService("retprov");
    const booking = await book(clientUser, service, owner);

    const response = await owner.agent.delete(`/api/services/${service.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ deleted: false, retired: true });
    expect(response.body.data.upcomingBookings).toBe(1);

    // Silently erasing an appointment somebody plans to attend is the worse
    // failure, so the booking must survive its service being retired.
    const detail = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    expect(detail.body.data.status).toBe("booked");
  });

  it("hides it from the public page but keeps it visible to its owner", async () => {
    const { owner, service } = await providerWithService("hideprov");
    await book(clientUser, service, owner);
    await owner.agent.delete(`/api/services/${service.id}`);

    const asOwner = await owner.agent.get(`/api/providers/${owner.id}/services`);
    const asStranger = await guest().get(`/api/providers/${owner.id}/services`);

    expect(asOwner.body.data.find((s) => s.id === service.id).isActive).toBe(false);
    expect(asStranger.body.data.some((s) => s.id === service.id)).toBe(false);
  });

  it("stops offering slots for it", async () => {
    const { owner, service } = await providerWithService("noslotprov");
    await book(clientUser, service, owner);
    await owner.agent.delete(`/api/services/${service.id}`);

    const response = await guest().get(
      `/api/providers/${owner.id}/slots?serviceId=${service.id}&from=${range.from}&to=${range.to}`
    );

    expect(response.status).toBe(404);
  });

  it("refuses a new booking for it", async () => {
    const { owner, service } = await providerWithService("nobookprov");
    const slots = await fetchSlots(clientUser.agent, owner.id, service.id, range);
    await owner.agent.delete(`/api/services/${service.id}`);

    const response = await otherClient.agent
      .post("/api/bookings")
      .send({ serviceId: service.id, startsAt: slots[0].startsAt });

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("a retired service is frozen", () => {
  it("refuses an edit, and names the way out", async () => {
    const { owner, service } = await providerWithService("frozenprov");
    await book(clientUser, service, owner);
    await owner.agent.delete(`/api/services/${service.id}`);

    const response = await owner.agent.put(`/api/services/${service.id}`).send({ price: 999 });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SERVICE_RETIRED");
    // The message has to point at the fix, or the client can only show a dead end.
    expect(response.body.error).toMatch(/reactivate/i);
  });

  it("really does not apply the edit", async () => {
    const { owner, service } = await providerWithService("frozen2prov");
    await book(clientUser, service, owner);
    await owner.agent.delete(`/api/services/${service.id}`);

    await owner.agent.put(`/api/services/${service.id}`).send({ price: 999, serviceName: "Renamed" });

    const services = await owner.agent.get(`/api/providers/${owner.id}/services`);
    const row = services.body.data.find((s) => s.id === service.id);

    expect(Number(row.price)).not.toBe(999);
    expect(row.name).not.toBe("Renamed");
  });
});

// ---------------------------------------------------------------------------
describe("reactivating a service", () => {
  it("brings the same row back, bookable and editable", async () => {
    const { owner, service } = await providerWithService("backprov");
    await book(clientUser, service, owner);
    await owner.agent.delete(`/api/services/${service.id}`);

    const response = await owner.agent.post(`/api/services/${service.id}/reactivate`);

    expect(response.status).toBe(200);
    expect(response.body.data.isActive).toBe(true);
    // The same row is the whole point: recreating would detach the service from
    // its own booking history and reviews.
    expect(response.body.data.id).toBe(service.id);

    const asStranger = await guest().get(`/api/providers/${owner.id}/services`);
    expect(asStranger.body.data.some((s) => s.id === service.id)).toBe(true);

    const slots = await fetchSlots(clientUser.agent, owner.id, service.id, range);
    expect(slots.length).toBeGreaterThan(0);

    const edit = await owner.agent.put(`/api/services/${service.id}`).send({ price: 77 });
    expect(edit.status).toBe(200);
    expect(Number(edit.body.data.price)).toBe(77);
  });

  it("keeps the service's booking history across the round trip", async () => {
    const { owner, service } = await providerWithService("histprov");
    const booking = await book(clientUser, service, owner);

    await owner.agent.delete(`/api/services/${service.id}`);
    await owner.agent.post(`/api/services/${service.id}/reactivate`);

    const services = await owner.agent.get(`/api/providers/${owner.id}/services`);
    const row = services.body.data.find((s) => s.id === service.id);

    expect(row.stats.totalBookings).toBe(1);

    const detail = await clientUser.agent.get(`/api/bookings/${booking.id}`);
    expect(detail.body.data.service.id).toBe(service.id);
  });

  it("refuses when the service was never retired", async () => {
    const { owner, service } = await providerWithService("activeprov");

    const response = await owner.agent.post(`/api/services/${service.id}/reactivate`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ALREADY_ACTIVE");
  });

  it("admits only one of two simultaneous reactivations", async () => {
    const { owner, service } = await providerWithService("raceprov");
    await book(clientUser, service, owner);
    await owner.agent.delete(`/api/services/${service.id}`);

    const [a, b] = await Promise.all([
      owner.agent.post(`/api/services/${service.id}/reactivate`),
      owner.agent.post(`/api/services/${service.id}/reactivate`),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("stops a provider reactivating a service that is not theirs", async () => {
    const { owner, service } = await providerWithService("ownerprov");
    await book(clientUser, service, owner);
    await owner.agent.delete(`/api/services/${service.id}`);

    const stranger = await createUser({ role: "provider", label: "thiefprov" });
    const response = await stranger.agent.post(`/api/services/${service.id}/reactivate`);

    expect(response.status).toBe(403);
  });

  it("stops a client reactivating anything at all", async () => {
    const { owner, service } = await providerWithService("roleprov");
    await book(clientUser, service, owner);
    await owner.agent.delete(`/api/services/${service.id}`);

    const response = await clientUser.agent.post(`/api/services/${service.id}/reactivate`);

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("recent conversations", () => {
  it("orders threads by last message, not by appointment date", async () => {
    const { owner, service } = await providerWithService("convprov");
    const first = await book(clientUser, service, owner);
    const second = await book(otherClient, service, owner);

    // Messaged in the opposite order to how they were booked, so ordering by
    // appointment date and ordering by message time disagree — which is exactly
    // the bug the old panel had.
    await otherClient.agent.post(`/api/bookings/${second.id}/messages`).send({ body: "second" });
    await clientUser.agent.post(`/api/bookings/${first.id}/messages`).send({ body: "first" });

    const response = await owner.agent.get("/api/bookings/recent-messages");

    expect(response.status).toBe(200);
    expect(response.body.data.conversations.map((c) => c.bookingId)).toEqual([first.id, second.id]);
    // A message time is always in the past. The old panel used `startsAt` and so
    // showed future times under a "Recent Messages" heading.
    for (const conversation of response.body.data.conversations) {
      expect(new Date(conversation.lastMessage.at).getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it("returns one entry per thread, carrying the newest message", async () => {
    const { owner, service } = await providerWithService("oneperprov");
    const booking = await book(clientUser, service, owner);

    await clientUser.agent.post(`/api/bookings/${booking.id}/messages`).send({ body: "one" });
    await clientUser.agent.post(`/api/bookings/${booking.id}/messages`).send({ body: "two" });

    const response = await owner.agent.get("/api/bookings/recent-messages");
    const mine = response.body.data.conversations.filter((c) => c.bookingId === booking.id);

    expect(mine).toHaveLength(1);
    expect(mine[0].lastMessage.preview).toBe("two");
  });

  it("names the other party, whichever side is asking", async () => {
    const { owner, service } = await providerWithService("partyprov");
    const booking = await book(clientUser, service, owner);
    await owner.agent.post(`/api/bookings/${booking.id}/messages`).send({ body: "from the provider" });

    const asProvider = await owner.agent.get("/api/bookings/recent-messages");
    const asClient = await clientUser.agent.get("/api/bookings/recent-messages");

    const p = asProvider.body.data.conversations.find((c) => c.bookingId === booking.id);
    const c = asClient.body.data.conversations.find((c) => c.bookingId === booking.id);

    expect(p.withUser.id).toBe(clientUser.id);
    expect(c.withUser.id).toBe(owner.id);
    // `fromMe` is what lets the UI write "You: …" — without it a thread list
    // cannot say whether you are waiting on a reply or owe one.
    expect(p.lastMessage.fromMe).toBe(true);
    expect(c.lastMessage.fromMe).toBe(false);
  });

  it("reports each thread's unread count without marking anything read", async () => {
    // A dashboard rendering must not clear someone's unread badge.
    const { owner, service } = await providerWithService("unreadprov");
    const booking = await book(clientUser, service, owner);
    await clientUser.agent.post(`/api/bookings/${booking.id}/messages`).send({ body: "unread" });

    const before = await owner.agent.get("/api/bookings/unread-count");
    const feed = await owner.agent.get("/api/bookings/recent-messages");
    const after = await owner.agent.get("/api/bookings/unread-count");

    expect(feed.body.data.conversations.find((c) => c.bookingId === booking.id).unread).toBe(1);
    expect(after.body.data.unread).toBe(before.body.data.unread);
    expect(after.body.data.unread).toBeGreaterThan(0);
  });

  it("never leaks a thread the viewer is not party to", async () => {
    const { owner, service } = await providerWithService("privprov");
    const booking = await book(clientUser, service, owner);
    await clientUser.agent.post(`/api/bookings/${booking.id}/messages`).send({ body: "private" });

    const outsider = await createUser({ role: "client", label: "nosycli" });
    const response = await outsider.agent.get("/api/bookings/recent-messages");

    expect(response.body.data.conversations).toEqual([]);
  });

  it("truncates a long message instead of sending the whole body", async () => {
    const { owner, service } = await providerWithService("truncprov");
    const booking = await book(clientUser, service, owner);
    await clientUser.agent.post(`/api/bookings/${booking.id}/messages`).send({ body: "x".repeat(500) });

    const response = await owner.agent.get("/api/bookings/recent-messages");
    const preview = response.body.data.conversations[0].lastMessage.preview;

    expect(preview.length).toBeLessThanOrEqual(120);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("returns an empty list for someone with no messages at all", async () => {
    const quiet = await createUser({ role: "client", label: "quietcli" });

    const response = await quiet.agent.get("/api/bookings/recent-messages");

    expect(response.status).toBe(200);
    expect(response.body.data.conversations).toEqual([]);
  });

  it("clamps the limit rather than trusting it", async () => {
    const response = await clientUser.agent.get("/api/bookings/recent-messages?limit=9999");
    expect(response.status).toBe(200);
    expect(response.body.data.conversations.length).toBeLessThanOrEqual(20);
  });

  it("requires a session", async () => {
    expect((await guest().get("/api/bookings/recent-messages")).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("slot preview for a draft service", () => {
  it("reports how many slots the saved hours would yield", async () => {
    // 09:00-17:00 is 480 minutes. A 60-minute service on a 60-minute grid with
    // no buffers fits eight times a day, seven days a week.
    const { owner } = await providerWithService("prevprov");

    const response = await owner.agent.post("/api/availability/preview").send({
      duration: 60,
      bufferBefore: 0,
      bufferAfter: 0,
      slotInterval: 60,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.bookable).toBe(true);
    expect(response.body.data.totalSlotsPerWeek).toBe(56);
    expect(response.body.data.days).toHaveLength(7);
    expect(response.body.data.days[0].slotCount).toBe(8);
    expect(response.body.data.days[0].weekdayName).toBe("Sunday");
  });

  it("shows buffers eating into the count", async () => {
    const { owner } = await providerWithService("bufprov");

    const plain = await owner.agent
      .post("/api/availability/preview")
      .send({ duration: 60, slotInterval: 60 });
    const buffered = await owner.agent
      .post("/api/availability/preview")
      .send({ duration: 60, bufferBefore: 15, bufferAfter: 15, slotInterval: 60 });

    expect(buffered.body.data.totalSlotsPerWeek).toBeLessThan(plain.body.data.totalSlotsPerWeek);
  });

  it("catches the configuration that silently yields nothing", async () => {
    // The engine's documented Case B, and the whole reason this preview exists.
    // A 09:00-10:00 window looks like it fits a 30-minute service twice over.
    // With 10-minute buffers on both sides the legal band of starts is
    // 09:10-09:20, while the 30-minute grid only offers 09:00 and 09:30 — the
    // two never intersect and the day silently yields nothing. No arithmetic a
    // provider does in their head produces that answer.
    const owner = await createUser({ role: "provider", timezone: "Europe/London", label: "tightprov" });
    await setWeeklyHours(owner, [{ weekday: 1, startTime: "09:00", endTime: "10:00" }]);

    const response = await owner.agent.post("/api/availability/preview").send({
      duration: 30,
      bufferBefore: 10,
      bufferAfter: 10,
      slotInterval: 30,
    });

    expect(response.body.data.bookable).toBe(false);
    expect(response.body.data.totalSlotsPerWeek).toBe(0);
    expect(response.body.data.problemDays).toHaveLength(1);
    // Every suggestion is verified against the same arithmetic before being
    // offered, so the form never tells a provider to try something that would
    // not help.
    expect(response.body.data.remedies.length).toBeGreaterThan(0);

    // One minute of extra buffer either way is the difference. Dropping the
    // trailing buffer makes the very same window yield a slot, which is what
    // makes the failing case so easy to walk into unknowingly.
    const relaxed = await owner.agent.post("/api/availability/preview").send({
      duration: 30,
      bufferBefore: 10,
      bufferAfter: 0,
      slotInterval: 30,
    });
    expect(relaxed.body.data.bookable).toBe(true);
    expect(relaxed.body.data.totalSlotsPerWeek).toBe(1);
  });

  it("agrees exactly with the slots the booking page then offers", async () => {
    // The property that matters: the number previewed is the number offered.
    // Both walk candidateStartsInWindow, so they cannot drift.
    const owner = await createUser({ role: "provider", timezone: "Europe/London", label: "agreeprov" });
    const service = await createService(owner, {
      service_name: "Agree",
      duration: 45,
      buffer_before: 10,
      buffer_after: 5,
      slot_interval: 30,
    });
    await setWeeklyHours(
      owner,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }))
    );

    const preview = await owner.agent.post("/api/availability/preview").send({
      serviceId: service.id,
      duration: 45,
      bufferBefore: 10,
      bufferAfter: 5,
      slotInterval: 30,
    });

    const slots = await fetchSlots(clientUser.agent, owner.id, service.id, range);
    const perDay = preview.body.data.days[0].slotCount;

    // Group the real slots by the provider's local date and compare a full day.
    const counts = {};
    for (const slot of slots) counts[slot.date] = (counts[slot.date] || 0) + 1;
    const fullDays = Object.values(counts).filter((n) => n === perDay);

    expect(perDay).toBeGreaterThan(0);
    expect(fullDays.length).toBeGreaterThan(0);
  });

  it("tells 'no hours at all' apart from 'hours that cannot fit this'", async () => {
    // Two different problems with two different fixes: go and set your hours,
    // versus change these numbers.
    const owner = await createUser({ role: "provider", timezone: "Europe/London", label: "nohoursprov" });

    const response = await owner.agent
      .post("/api/availability/preview")
      .send({ duration: 60, slotInterval: 60 });

    expect(response.status).toBe(200);
    expect(response.body.data.hasRules).toBe(false);
    expect(response.body.data.totalSlotsPerWeek).toBe(0);
  });

  it("judges a service with its own hours against those hours", async () => {
    const { owner, service } = await providerWithService("scopeprov");
    // Give this one service a much shorter week than the provider default.
    await owner.agent
      .put("/api/availability/rules")
      .send({ serviceId: service.id, rules: [{ weekday: 1, startTime: "09:00", endTime: "11:00" }] });

    const scoped = await owner.agent
      .post("/api/availability/preview")
      .send({ serviceId: service.id, duration: 60, slotInterval: 60 });
    const defaults = await owner.agent
      .post("/api/availability/preview")
      .send({ duration: 60, slotInterval: 60 });

    expect(scoped.body.data.scope).toBe("service");
    expect(scoped.body.data.totalSlotsPerWeek).toBe(2);
    expect(defaults.body.data.totalSlotsPerWeek).toBeGreaterThan(2);
  });

  it("accepts snake_case as well as camelCase, like the service endpoints", async () => {
    const { owner } = await providerWithService("caseprov");

    const camel = await owner.agent
      .post("/api/availability/preview")
      .send({ duration: 60, bufferBefore: 15, slotInterval: 60 });
    const snake = await owner.agent
      .post("/api/availability/preview")
      .send({ duration: 60, buffer_before: 15, slot_interval: 60 });

    expect(snake.body.data.totalSlotsPerWeek).toBe(camel.body.data.totalSlotsPerWeek);
  });

  it("rejects a duration that is not a positive number of minutes", async () => {
    const { owner } = await providerWithService("badprov");

    for (const duration of [0, -5, "abc", undefined, 99999]) {
      const response = await owner.agent.post("/api/availability/preview").send({ duration });
      expect(response.status, String(duration)).toBe(400);
      expect(response.body.details[0].field).toBe("duration");
    }
  });

  it("refuses to preview against another provider's service", async () => {
    const { service } = await providerWithService("victimprov");
    const stranger = await createUser({ role: "provider", label: "peekprov" });

    const response = await stranger.agent
      .post("/api/availability/preview")
      .send({ serviceId: service.id, duration: 60 });

    expect(response.status).toBe(404);
  });

  it("is closed to clients", async () => {
    const response = await clientUser.agent
      .post("/api/availability/preview")
      .send({ duration: 60 });

    expect(response.status).toBe(403);
  });
});

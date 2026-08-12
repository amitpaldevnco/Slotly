/**
 * Tests for the slot-generation engine.
 *
 * These are the tests the whole project stands on: slot generation is where
 * availability rules, service durations, buffers, existing bookings and — above
 * all — timezones and DST all meet. Everything here runs against the real
 * `services/slotEngine.js` with no mocks, because the engine is already pure:
 * it takes rows and a `now` and returns slots, so there is nothing to stub.
 *
 * Two conventions run through the file:
 *
 *   - **`now` is always injected**, never taken from the system clock, so the
 *     suite cannot start failing in six months when the fixture dates fall into
 *     the past.
 *   - **Expected instants are written as UTC**, because that is what the engine
 *     returns. A test that asserted on a local wall-clock string would be
 *     re-implementing the bug the engine exists to prevent.
 */
import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  generateSlots,
  computeAvailableWindows,
  wallClockToInstant,
  computeBookingSpan,
  isWithinAvailability,
  hasInstantPassed,
  earliestBookableInstant,
  mergeIntervals,
  subtractIntervals,
  MAX_RANGE_DAYS,
} from "../services/slotEngine.js";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** A `now` far enough before every fixture date that the "past" gates all pass. */
const NOW = new Date("2025-01-01T00:00:00Z");

/** Weekday numbers as the schema stores them: 0 = Sunday. */
const SUNDAY = 0;
const MONDAY = 1;

/** 09:00–17:00 as minutes from midnight. */
const NINE_TO_FIVE = { start_minute: 540, end_minute: 1020 };

function rule(weekday, startMinute, endMinute) {
  return { weekday, start_minute: startMinute, end_minute: endMinute };
}

function service(overrides = {}) {
  return {
    duration: 60,
    buffer_before: 0,
    buffer_after: 0,
    slot_interval: 60,
    ...overrides,
  };
}

/**
 * The UTC range covering one local calendar day in `zone`.
 *
 * Written this way rather than as hard-coded UTC strings so a fixture stays
 * readable as "the provider's Monday" — which is what the rules are expressed
 * in — while still handing the engine real instants.
 */
function localDay(isoDate, zone) {
  const start = DateTime.fromISO(isoDate, { zone }).startOf("day");
  return { rangeStart: start.toJSDate(), rangeEnd: start.plus({ days: 1 }).toJSDate() };
}

/** Local day range spanning `days` days from `isoDate`. */
function localDays(isoDate, zone, days) {
  const start = DateTime.fromISO(isoDate, { zone }).startOf("day");
  return { rangeStart: start.toJSDate(), rangeEnd: start.plus({ days }).toJSDate() };
}

/** The `startsAt` values of a slot list, as UTC ISO strings — what we assert on. */
const startsAtOf = (slots) => slots.map((s) => s.startsAt);

/** Reads a UTC instant back in a zone as "HH:mm", for readability assertions. */
const clockIn = (iso, zone) => DateTime.fromISO(iso, { zone: "utc" }).setZone(zone).toFormat("HH:mm");

// 2025-06-02 is a Monday. 2025-01-06 is a Monday. Both are used throughout.

// ---------------------------------------------------------------------------
describe("wallClockToInstant — pairing a rule with a date", () => {
  it("resolves a wall-clock reading to the instant it means in that zone", () => {
    // 09:00 in New York on a summer date is 13:00 UTC (EDT, UTC-4).
    const instant = wallClockToInstant({ year: 2025, month: 6, day: 2 }, 540, "America/New_York");
    expect(instant.toUTC().toISO()).toBe("2025-06-02T13:00:00.000Z");
  });

  it("gives a different UTC instant for the same wall clock in winter", () => {
    // Same 09:00, but EST (UTC-5) — 14:00 UTC. This single pair of assertions is
    // the whole reason rules are stored as wall-clock minutes rather than as
    // instants: "09:00" is not one moment, it is a different moment each half
    // of the year.
    const instant = wallClockToInstant({ year: 2025, month: 1, day: 6 }, 540, "America/New_York");
    expect(instant.toUTC().toISO()).toBe("2025-01-06T14:00:00.000Z");
  });

  it("expresses minute 1440 as midnight ending the day, not an invalid hour", () => {
    const endOfDay = wallClockToInstant({ year: 2025, month: 6, day: 2 }, 1440, "Europe/London");
    expect(endOfDay.toUTC().toISO()).toBe("2025-06-02T23:00:00.000Z"); // 00:00 on the 3rd, BST
  });

  it("throws on a timezone the runtime does not know", () => {
    expect(() => wallClockToInstant({ year: 2025, month: 6, day: 2 }, 540, "Mars/Olympus")).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("generateSlots — availability boundaries and duration", () => {
  const zone = "Europe/London";

  it("fills a 09:00–17:00 window with hour-long appointments and stops at the edge", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, NINE_TO_FIVE.start_minute, NINE_TO_FIVE.end_minute)],
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    // 09:00 through 16:00 — eight starts. 17:00 is not offered, because a
    // 60-minute appointment starting then would end at 18:00, outside the window.
    expect(slots).toHaveLength(8);
    expect(clockIn(slots[0].startsAt, zone)).toBe("09:00");
    expect(clockIn(slots.at(-1).startsAt, zone)).toBe("16:00");
    expect(clockIn(slots.at(-1).endsAt, zone)).toBe("17:00");
  });

  it("offers nothing on a weekday with no rule", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, NINE_TO_FIVE.start_minute, NINE_TO_FIVE.end_minute)],
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-03", zone), // Tuesday
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots).toEqual([]);
  });

  it("offers nothing when the service is longer than the window", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 600)], // 09:00–10:00, one hour
      exceptions: [],
      timezone: zone,
      service: service({ duration: 90 }),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots).toEqual([]);
  });

  it("merges two touching windows so a service can span the join", () => {
    // 09:00–12:00 and 12:00–17:00 must behave as one 09:00–17:00 window,
    // otherwise a 90-minute service could never straddle noon.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 720), rule(MONDAY, 720, 1020)],
      exceptions: [],
      timezone: zone,
      service: service({ duration: 90, slot_interval: 30 }),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(clockIn(slots[0].startsAt, zone)).toBe("09:00");
    // A slot starting 11:30 runs to 13:00, straddling the 12:00 join. It exists
    // only because the two windows merged into one; treated separately, neither
    // could contain it.
    const times = slots.map((s) => clockIn(s.startsAt, zone));
    expect(times).toContain("11:30");
    expect(clockIn(slots[times.indexOf("11:30")].endsAt, zone)).toBe("13:00");
  });
});

// ---------------------------------------------------------------------------
describe("generateSlots — buffers must fit inside the window, not just the appointment", () => {
  const zone = "Europe/London";

  /**
   * The brief's worked example: availability 09:00–17:00, a 60-minute service
   * with a 15-minute buffer either side. The first bookable appointment is
   * 09:15, not 09:00, because 09:00 would put the leading buffer at 08:45 —
   * outside the window. The occupied span of that first slot is exactly
   * 09:00–10:30.
   */
  it("refuses a start whose leading buffer would fall outside the window", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, NINE_TO_FIVE.start_minute, NINE_TO_FIVE.end_minute)],
      exceptions: [],
      timezone: zone,
      service: service({ duration: 60, buffer_before: 15, buffer_after: 15, slot_interval: 15 }),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(clockIn(slots[0].startsAt, zone)).toBe("09:15");
    expect(clockIn(slots[0].blockedFrom, zone)).toBe("09:00");
    expect(clockIn(slots[0].blockedTo, zone)).toBe("10:30");
  });

  it("refuses a start whose trailing buffer would fall outside the window", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, NINE_TO_FIVE.start_minute, NINE_TO_FIVE.end_minute)],
      exceptions: [],
      timezone: zone,
      service: service({ duration: 60, buffer_before: 15, buffer_after: 15, slot_interval: 15 }),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    // 15:45 + 60 + 15 lands exactly on 17:00. 16:00 would overrun it.
    expect(clockIn(slots.at(-1).startsAt, zone)).toBe("15:45");
    expect(clockIn(slots.at(-1).blockedTo, zone)).toBe("17:00");
  });

  it("offers exactly one slot when the window fits the appointment and both buffers precisely", () => {
    // 09:00–10:30 is 90 minutes; 15 + 60 + 15 is 90 minutes.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 630)],
      exceptions: [],
      timezone: zone,
      service: service({ duration: 60, buffer_before: 15, buffer_after: 15, slot_interval: 15 }),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots).toHaveLength(1);
    expect(clockIn(slots[0].startsAt, zone)).toBe("09:15");
  });

  it("offers nothing when the appointment fits but the buffers do not", () => {
    // 09:00–10:29 is 89 minutes — one minute short of the 90 the buffers need.
    // The appointment alone (60 minutes) would fit easily, which is exactly the
    // case the brief says must be rejected.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 629)],
      exceptions: [],
      timezone: zone,
      service: service({ duration: 60, buffer_before: 15, buffer_after: 15, slot_interval: 15 }),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots).toEqual([]);
  });

  it("keeps candidate starts on the interval grid rather than offsetting them by the buffer", () => {
    // With a 5-minute leading buffer and a 30-minute grid, the first start is
    // 09:30 — not 09:05. Clients get round times.
    const slots = generateSlots({
      rules: [rule(MONDAY, NINE_TO_FIVE.start_minute, NINE_TO_FIVE.end_minute)],
      exceptions: [],
      timezone: zone,
      service: service({ duration: 60, buffer_before: 5, buffer_after: 0, slot_interval: 30 }),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(clockIn(slots[0].startsAt, zone)).toBe("09:30");
    expect(slots.map((s) => clockIn(s.startsAt, zone))).not.toContain("09:05");
  });
});

// ---------------------------------------------------------------------------
describe("generateSlots — exceptions", () => {
  const zone = "Europe/London";
  const weekdayRules = [0, 1, 2, 3, 4, 5, 6].map((d) => rule(d, 540, 1020));

  it("removes a whole day for an all-day block", () => {
    const slots = generateSlots({
      rules: weekdayRules,
      exceptions: [
        { kind: "block", start_date: "2025-06-02", end_date: "2025-06-02", start_minute: null, end_minute: null },
      ],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots).toEqual([]);
  });

  it("splits a day in two for a partial block, rather than clearing it", () => {
    // A 12:00–13:00 lunch block turns 09:00–17:00 into 09:00–12:00 and 13:00–17:00.
    const slots = generateSlots({
      rules: weekdayRules,
      exceptions: [
        { kind: "block", start_date: "2025-06-02", end_date: "2025-06-02", start_minute: 720, end_minute: 780 },
      ],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    const times = slots.map((s) => clockIn(s.startsAt, zone));
    expect(times).toEqual(["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"]);
    expect(times).not.toContain("12:00");
  });

  it("blocks every day in a multi-day range", () => {
    const slots = generateSlots({
      rules: weekdayRules,
      exceptions: [
        { kind: "block", start_date: "2025-06-02", end_date: "2025-06-04", start_minute: null, end_minute: null },
      ],
      timezone: zone,
      service: service(),
      ...localDays("2025-06-02", zone, 4),
      now: NOW,
      minNoticeDays: 0,
    });

    // The 2nd, 3rd and 4th are blocked; only the 5th survives.
    const dates = new Set(slots.map((s) => DateTime.fromISO(s.startsAt).setZone(zone).toISODate()));
    expect([...dates]).toEqual(["2025-06-05"]);
  });

  it("adds hours on a day that has no weekly rule at all", () => {
    // An 'open' exception is how a provider works a one-off Sunday.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [
        { kind: "open", start_date: "2025-06-01", end_date: "2025-06-01", start_minute: 600, end_minute: 720 },
      ],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-01", zone), // Sunday
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots.map((s) => clockIn(s.startsAt, zone))).toEqual(["10:00", "11:00"]);
  });

  it("lets a block beat an overlapping open exception", () => {
    // Both apply to the same hour. Blocks are subtracted after opens are unioned,
    // so the block wins — the safe direction, since the provider said "not then".
    const slots = generateSlots({
      rules: [],
      exceptions: [
        { kind: "open", start_date: "2025-06-01", end_date: "2025-06-01", start_minute: 600, end_minute: 720 },
        { kind: "block", start_date: "2025-06-01", end_date: "2025-06-01", start_minute: 600, end_minute: 720 },
      ],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-01", zone),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("generateSlots — collision with existing bookings", () => {
  const zone = "Europe/London";

  it("drops a slot whose occupied span overlaps a booking", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      busy: [
        // 11:00–12:00 London (BST = UTC+1).
        { blocked_from: new Date("2025-06-02T10:00:00Z"), blocked_to: new Date("2025-06-02T11:00:00Z") },
      ],
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots.map((s) => clockIn(s.startsAt, zone))).not.toContain("11:00");
    expect(slots.map((s) => clockIn(s.startsAt, zone))).toContain("10:00");
  });

  it("treats spans as half-open, so back-to-back appointments are both offered", () => {
    // A booking ending exactly at 11:00 does not block a slot starting at 11:00.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      busy: [
        // 10:00–11:00 London.
        { blocked_from: new Date("2025-06-02T09:00:00Z"), blocked_to: new Date("2025-06-02T10:00:00Z") },
      ],
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots.map((s) => clockIn(s.startsAt, zone))).toContain("11:00");
    expect(slots.map((s) => clockIn(s.startsAt, zone))).not.toContain("10:00");
  });

  it("drops a slot that collides only through its buffer", () => {
    // The appointment itself would not overlap, but its trailing buffer does.
    // This is what makes the buffer a real reservation rather than decoration.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: zone,
      service: service({ duration: 60, buffer_before: 0, buffer_after: 30, slot_interval: 60 }),
      ...localDay("2025-06-02", zone),
      busy: [
        // 11:00–11:15 London — after a 10:00–11:00 appointment ends, but inside
        // the 30-minute buffer that follows it.
        { blocked_from: new Date("2025-06-02T10:00:00Z"), blocked_to: new Date("2025-06-02T10:15:00Z") },
      ],
      now: NOW,
      minNoticeDays: 0,
    });

    expect(slots.map((s) => clockIn(s.startsAt, zone))).not.toContain("10:00");
  });
});

// ---------------------------------------------------------------------------
describe("timezone conversion, in both directions", () => {
  /**
   * The scenario from the brief: a New York provider, a Kolkata client.
   *
   * The engine never sees the client's zone at all — it works entirely in the
   * provider's zone and returns UTC. The client's reading is derived from that
   * UTC instant at the display edge, which is what these tests assert.
   */
  const providerZone = "America/New_York";
  const clientZone = "Asia/Kolkata";

  it("converts provider local time to the correct UTC instant (provider → UTC)", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)], // Mondays 09:00–17:00 New York
      exceptions: [],
      timezone: providerZone,
      service: service(),
      ...localDay("2025-06-02", providerZone),
      now: NOW,
      minNoticeDays: 0,
    });

    // 09:00 EDT is 13:00 UTC.
    expect(slots[0].startsAt).toBe("2025-06-02T13:00:00.000Z");
  });

  it("renders that same instant correctly for the client (UTC → client)", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: providerZone,
      service: service(),
      ...localDay("2025-06-02", providerZone),
      now: NOW,
      minNoticeDays: 0,
    });

    // 13:00 UTC is 18:30 in Kolkata — the +05:30 offset, which is the case that
    // catches any code assuming whole-hour offsets.
    expect(clockIn(slots[0].startsAt, clientZone)).toBe("18:30");
    expect(clockIn(slots[0].startsAt, providerZone)).toBe("09:00");
  });

  it("puts a late provider slot on the client's *next* calendar date", () => {
    // 16:00 in New York is 01:30 the following morning in Kolkata. A client
    // browsing by their own date must see it under Tuesday, not Monday.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: providerZone,
      service: service(),
      ...localDay("2025-06-02", providerZone),
      now: NOW,
      minNoticeDays: 0,
    });

    const last = slots.at(-1);
    expect(clockIn(last.startsAt, providerZone)).toBe("16:00");
    expect(DateTime.fromISO(last.startsAt).setZone(providerZone).toISODate()).toBe("2025-06-02");
    expect(DateTime.fromISO(last.startsAt).setZone(clientZone).toISODate()).toBe("2025-06-03");
    expect(clockIn(last.startsAt, clientZone)).toBe("01:30");
  });

  it("keeps a client-side round trip lossless (client → UTC → client)", () => {
    // What the booking flow actually does: the client sends back the exact
    // instant it was given, so the two sides never negotiate a timezone.
    const original = "2025-06-02T13:00:00.000Z";
    const shownToClient = DateTime.fromISO(original, { zone: "utc" }).setZone(clientZone);
    expect(shownToClient.toUTC().toISO()).toBe(original);
  });
});

// ---------------------------------------------------------------------------
describe("daylight saving", () => {
  const london = "Europe/London";
  const kolkata = "Asia/Kolkata";

  it("keeps a recurring window at the same wall-clock time across the spring change", () => {
    // The policy: "Mondays 09:00" stays 09:00 local before and after the clocks
    // move. What changes is the UTC instant behind it.
    const before = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 540, end_minute: 1020 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-03-23", london), // Sunday before the change, GMT
      now: NOW,
      minNoticeDays: 0,
    });

    const after = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 540, end_minute: 1020 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-04-06", london), // Sunday after the change, BST
      now: NOW,
      minNoticeDays: 0,
    });

    // Same local reading …
    expect(clockIn(before[0].startsAt, london)).toBe("09:00");
    expect(clockIn(after[0].startsAt, london)).toBe("09:00");
    // … different UTC instant. GMT is UTC+0, BST is UTC+1.
    expect(before[0].startsAt).toBe("2025-03-23T09:00:00.000Z");
    expect(after[0].startsAt).toBe("2025-04-06T08:00:00.000Z");
  });

  it("yields one fewer slot on a spring-forward day whose gap falls in the window", () => {
    // 00:00–06:00 on 30 March in London holds five real hours, not six, because
    // 01:00 jumps straight to 02:00. The engine does not special-case this — it
    // falls out of treating the boundaries as wall-clock.
    const transitionDay = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 0, end_minute: 360 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-03-30", london),
      now: NOW,
      minNoticeDays: 0,
    });

    const ordinaryDay = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 0, end_minute: 360 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-03-23", london),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(ordinaryDay).toHaveLength(6);
    expect(transitionDay).toHaveLength(5);
  });

  it("yields one more slot on a fall-back day whose repeated hour falls in the window", () => {
    // 00:00–06:00 on 26 October in London holds seven real hours: 01:00–02:00
    // happens twice.
    const transitionDay = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 0, end_minute: 360 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-10-26", london),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(transitionDay).toHaveLength(7);
  });

  it("resolves a boundary landing in the spring-forward gap forward, never backward", () => {
    // 02:30 does not exist in New York on 9 March 2025 — the clock goes
    // 02:00 → 03:00. Luxon moves it forward to 03:30 EDT (07:30 UTC). The window
    // is nudged later; it never silently disappears and never moves earlier.
    const resolved = wallClockToInstant({ year: 2025, month: 3, day: 9 }, 150, "America/New_York");
    expect(resolved.toUTC().toISO()).toBe("2025-03-09T07:30:00.000Z");
    expect(resolved.toFormat("HH:mm")).toBe("03:30");
  });

  it("resolves an ambiguous fall-back boundary to the first occurrence", () => {
    // 01:30 happens twice in London on 26 October 2025. The first is BST
    // (UTC+1) at 00:30 UTC; the second is GMT at 01:30 UTC. Luxon picks the first.
    const resolved = wallClockToInstant({ year: 2025, month: 10, day: 26 }, 90, london);
    expect(resolved.toUTC().toISO()).toBe("2025-10-26T00:30:00.000Z");
  });

  it("leaves a non-observing client's offset fixed across a provider's DST change", () => {
    // Kolkata is UTC+05:30 all year. The provider's slot moves in UTC across the
    // transition, so the client's local reading moves by exactly one hour —
    // which is correct, and is what a client in a non-DST zone actually sees.
    const before = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 540, end_minute: 1020 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-03-23", london),
      now: NOW,
      minNoticeDays: 0,
    });
    const after = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 540, end_minute: 1020 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-04-06", london),
      now: NOW,
      minNoticeDays: 0,
    });

    expect(clockIn(before[0].startsAt, kolkata)).toBe("14:30"); // 09:00 GMT
    expect(clockIn(after[0].startsAt, kolkata)).toBe("13:30"); // 09:00 BST
  });

  it("does not move an existing booking when the clocks change", () => {
    // Bookings are stored as absolute instants, so a DST transition is a no-op
    // for them. Reading the same instant before and after gives the same moment.
    const booked = "2025-04-06T08:00:00.000Z";
    expect(clockIn(booked, london)).toBe("09:00");
    expect(DateTime.fromISO(booked, { zone: "utc" }).toMillis()).toBe(Date.parse(booked));
  });
});

// ---------------------------------------------------------------------------
describe("the past, and the minimum booking notice", () => {
  const zone = "Europe/London";

  it("compares real instants, not wall-clock readings", () => {
    // The same instant, expressed in two zones, must compare identically. This
    // is the property that stops a provider's already-passed morning showing as
    // bookable to a client on the other side of the world.
    const instant = "2025-06-02T13:00:00.000Z";
    const now = new Date("2025-06-02T14:00:00.000Z");

    expect(hasInstantPassed(instant, "America/New_York", now)).toBe(true);
    expect(hasInstantPassed(instant, "Asia/Kolkata", now)).toBe(true);
    expect(hasInstantPassed(instant, "UTC", now)).toBe(true);
  });

  it("drops slots earlier than now on the current day", () => {
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      // 12:30 London on the day itself.
      now: new Date("2025-06-02T11:30:00Z"),
      minNoticeDays: 0,
    });

    const times = slots.map((s) => clockIn(s.startsAt, zone));
    expect(times).not.toContain("09:00");
    expect(times).not.toContain("12:00");
    expect(times).toContain("13:00");
  });

  it("treats the notice period as a calendar-date floor, not a rolling 24 hours", () => {
    // Late in the evening, the floor is still the *start* of the next local day
    // — only minutes away — rather than the same time tomorrow.
    const lateEvening = new Date("2025-06-02T22:55:00Z"); // 23:55 London
    const floor = earliestBookableInstant(lateEvening, zone, 1);
    expect(floor.toISO()).toBe(DateTime.fromISO("2025-06-03T00:00:00", { zone }).toISO());
  });

  it("excludes the provider's current day entirely at the default notice", () => {
    const slots = generateSlots({
      rules: [0, 1, 2].map((d) => rule(d, 540, 1020)),
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDays("2025-06-02", zone, 2),
      now: new Date("2025-06-02T07:00:00Z"), // 08:00 London, before the day's slots
      // minNoticeDays left at its default of 1.
    });

    const dates = new Set(slots.map((s) => DateTime.fromISO(s.startsAt).setZone(zone).toISODate()));
    expect(dates.has("2025-06-02")).toBe(false);
    expect(dates.has("2025-06-03")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("isWithinAvailability — the write-path guard", () => {
  const zone = "Europe/London";
  const rules = [rule(MONDAY, 540, 1020)];

  it("accepts an instant whose whole occupied span sits inside a window", () => {
    expect(
      isWithinAvailability({
        rules,
        exceptions: [],
        timezone: zone,
        service: service({ duration: 60, buffer_before: 15, buffer_after: 15 }),
        startsAt: new Date("2025-06-02T08:15:00Z"), // 09:15 London
      })
    ).toBe(true);
  });

  it("rejects a hand-crafted request for a time the provider is closed", () => {
    // 03:00 on a Sunday — the case the brief names. The database guarantees the
    // slot is not double-booked; this guarantees it was a legal slot at all.
    expect(
      isWithinAvailability({
        rules,
        exceptions: [],
        timezone: zone,
        service: service(),
        startsAt: new Date("2025-06-01T02:00:00Z"),
      })
    ).toBe(false);
  });

  it("rejects a start whose buffer pushes it outside the window", () => {
    // 09:00 London exactly: the appointment fits, the leading buffer does not.
    expect(
      isWithinAvailability({
        rules,
        exceptions: [],
        timezone: zone,
        service: service({ duration: 60, buffer_before: 15, buffer_after: 15 }),
        startsAt: new Date("2025-06-02T08:00:00Z"),
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("computeBookingSpan", () => {
  it("wraps the appointment in its buffers", () => {
    const span = computeBookingSpan("2025-06-02T13:00:00.000Z", {
      duration: 60,
      buffer_before: 15,
      buffer_after: 30,
    });

    expect(span.startsAt.toISOString()).toBe("2025-06-02T13:00:00.000Z");
    expect(span.endsAt.toISOString()).toBe("2025-06-02T14:00:00.000Z");
    expect(span.blockedFrom.toISOString()).toBe("2025-06-02T12:45:00.000Z");
    expect(span.blockedTo.toISOString()).toBe("2025-06-02T14:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------
describe("interval helpers", () => {
  it("merges overlapping and merely touching intervals", () => {
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toEqual([{ start: 0, end: 20 }]);
    expect(mergeIntervals([{ start: 0, end: 15 }, { start: 10, end: 20 }])).toEqual([{ start: 0, end: 20 }]);
    expect(mergeIntervals([{ start: 0, end: 5 }, { start: 10, end: 20 }])).toHaveLength(2);
  });

  it("splits a window when a block lands in the middle of it", () => {
    expect(subtractIntervals([{ start: 0, end: 100 }], [{ start: 40, end: 60 }])).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
  });

  it("removes a window entirely when a block covers it", () => {
    expect(subtractIntervals([{ start: 10, end: 20 }], [{ start: 0, end: 100 }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("guards", () => {
  const zone = "Europe/London";

  it("refuses a range wider than the cap", () => {
    const start = DateTime.fromISO("2025-06-02", { zone }).startOf("day");
    expect(() =>
      generateSlots({
        rules: [rule(MONDAY, 540, 1020)],
        exceptions: [],
        timezone: zone,
        service: service(),
        rangeStart: start.toJSDate(),
        rangeEnd: start.plus({ days: MAX_RANGE_DAYS + 1 }).toJSDate(),
        now: NOW,
      })
    ).toThrow(/62-day maximum/);
  });

  it("returns nothing for an inverted range instead of throwing", () => {
    const start = DateTime.fromISO("2025-06-02", { zone }).startOf("day");
    expect(
      generateSlots({
        rules: [rule(MONDAY, 540, 1020)],
        exceptions: [],
        timezone: zone,
        service: service(),
        rangeStart: start.toJSDate(),
        rangeEnd: start.minus({ days: 1 }).toJSDate(),
        now: NOW,
      })
    ).toEqual([]);
  });

  it("clips windows to the requested range", () => {
    // Asking for one day must not return the neighbouring days the expansion
    // pads with internally.
    const windows = computeAvailableWindows({
      rules: [0, 1, 2, 3, 4, 5, 6].map((d) => rule(d, 540, 1020)),
      exceptions: [],
      timezone: zone,
      ...localDay("2025-06-02", zone),
    });

    expect(windows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("performance", () => {
  it("returns one week fast with six months of availability and 1000 bookings", () => {
    const zone = "Europe/London";

    // Availability every day for six months, expressed as seven weekly rules.
    const rules = [0, 1, 2, 3, 4, 5, 6].map((d) => rule(d, 540, 1020));

    // A thousand bookings spread across six months. Only the handful touching
    // the requested week can possibly matter, but the engine is handed all of
    // them here so the test measures the worst case the controller could pass.
    const busy = Array.from({ length: 1000 }, (_, i) => {
      const start = DateTime.fromISO("2025-01-01T09:00:00Z").plus({ hours: i * 4 });
      return { blocked_from: start.toJSDate(), blocked_to: start.plus({ minutes: 60 }).toJSDate() };
    });

    const started = performance.now();
    const slots = generateSlots({
      rules,
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDays("2025-06-02", zone, 7),
      busy,
      now: NOW,
      minNoticeDays: 0,
    });
    const elapsed = performance.now() - started;

    expect(slots.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});

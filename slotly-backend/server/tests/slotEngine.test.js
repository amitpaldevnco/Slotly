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
  isOfferedSlotStart,
  hasInstantPassed,
  earliestBookableInstant,
  mergeIntervals,
  subtractIntervals,
  diagnoseSlotFeasibility,
  minimumWindowMinutes,
  MAX_RANGE_DAYS,
  MIN_BOOKING_LEAD_MINUTES,
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
// The read path and the write path must agree, whatever range was browsed.
//
// This is the regression suite for a bug where they did not. `mergeIntervals`
// used to run across the *whole* expansion, so a provider open round the clock
// had every date fused into one window whose start was wherever the expansion
// began — one day before whatever range the caller happened to ask about. The
// candidate grid is anchored at a window's start, so:
//
//   - the slot list anchored the grid relative to the range the client browsed;
//   - `isOfferedSlotStart` anchored it relative to the appointment being booked;
//   - the two anchors were a day apart, and whenever the step did not divide
//     that gap (25, 50 and 100 minutes all fail; 30, 45 and 60 divide 1440 and
//     happened to survive) every start the list offered was rejected on POST.
//
// The fix is per-date merging in `expandOpenWindows`, so a window's start is
// always a real rule boundary on a real calendar date. These tests assert the
// invariant rather than the fix: **every start the list offers must be accepted
// by the write path.** They would have caught the original bug and they will
// catch any future change that reintroduces a range-dependent anchor.
// ---------------------------------------------------------------------------
describe("generateSlots and isOfferedSlotStart agree on a round-the-clock schedule", () => {
  const zone = "Europe/London";
  const allDay = [0, 1, 2, 3, 4, 5, 6].map((d) => rule(d, 0, 1440));

  /** Every start `generateSlots` offers over `days` from `isoDate`. */
  const offeredOver = (svc, isoDate, days) =>
    generateSlots({
      rules: allDay,
      exceptions: [],
      timezone: zone,
      service: svc,
      ...localDays(isoDate, zone, days),
      now: NOW,
    }).map((s) => s.startsAt);

  const accepts = (svc, startsAt) =>
    isOfferedSlotStart({
      rules: allDay,
      exceptions: [],
      timezone: zone,
      service: svc,
      startsAt: new Date(startsAt),
    });

  // 25, 50 and 100 do not divide 1440; 30, 45 and 60 do. Before the fix the
  // first three failed every assertion here and the last three passed, which is
  // exactly why the bug survived: every interval the demo data used divided 1440.
  for (const slotInterval of [25, 30, 45, 50, 60, 100]) {
    it(`offers only bookable starts at a ${slotInterval}-minute interval`, () => {
      const svc = service({ duration: 60, slot_interval: slotInterval });
      const offered = offeredOver(svc, "2025-06-02", 3);

      expect(offered.length).toBeGreaterThan(0);
      expect(offered.filter((startsAt) => !accepts(svc, startsAt))).toEqual([]);
    });
  }

  it("offers the same starts for a day whether one day or a month was requested", () => {
    // The list must describe the provider's schedule, not the question asked
    // about it. A client browsing a week and a client browsing a day must be
    // shown the same times for the day they have in common.
    const svc = service({ duration: 60, slot_interval: 25 });
    const dayOnly = offeredOver(svc, "2025-06-04", 1);
    expect(dayOnly.length).toBeGreaterThan(0);

    // The comparison window is the *local* day in the provider's zone, which in
    // BST runs 23:00Z to 23:00Z and so does not line up with a UTC date. Slicing
    // the wider result by an ISO string prefix would compare two different days
    // and fail for a reason that has nothing to do with what is under test.
    const dayStart = DateTime.fromISO("2025-06-04", { zone }).startOf("day");
    const dayEnd = dayStart.plus({ days: 1 });
    const withinTheDay = (iso) => {
      const t = DateTime.fromISO(iso, { zone: "utc" });
      return t >= dayStart && t < dayEnd;
    };

    for (const [from, days] of [["2025-06-03", 3], ["2025-06-01", 10], ["2025-05-20", 31]]) {
      expect(offeredOver(svc, from, days).filter(withinTheDay)).toEqual(dayOnly);
    }
  });

  it("still merges touching windows within one day", () => {
    // The fix must not have thrown out the behaviour merging was there for: two
    // windows meeting at 12:00 on the same day are one window, so a 90-minute
    // appointment can still straddle the join.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 720), rule(MONDAY, 720, 1020)],
      exceptions: [],
      timezone: zone,
      service: service({ duration: 90, slot_interval: 30 }),
      ...localDay("2025-06-02", zone),
      now: NOW,
    });

    expect(slots.map((s) => clockIn(s.startsAt, zone))).toContain("11:30");
  });

  it("agrees across a fall-back day, where the local day is 25 hours long", () => {
    // 26 October 2025 is when London leaves BST. The day holds an extra real
    // hour, so a midnight-to-midnight window is 25 hours and the absolute
    // distance between grid positions no longer matches the calendar. Both paths
    // have to reach the same answer anyway.
    const svc = service({ duration: 60, slot_interval: 45 });
    const offered = offeredOver(svc, "2025-10-25", 3);

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((startsAt) => !accepts(svc, startsAt))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("generateSlots — the range guard counts days, not fixed-length days", () => {
  const zone = "Europe/London";

  it("accepts the maximum range even when it contains a fall-back transition", () => {
    // MAX_RANGE_DAYS calendar days spanning a day the clocks go back is
    // MAX_RANGE_DAYS days *and an hour* of real time. The controller had already
    // accepted the range on a calendar-day count; this guard measured
    // milliseconds and threw, which surfaced to the client as a 500 on a
    // perfectly valid request.
    const start = DateTime.fromISO("2025-09-01", { zone }).startOf("day");
    const end = start.plus({ days: MAX_RANGE_DAYS });

    // Confirm the fixture really does straddle a transition, otherwise this
    // test would pass for the wrong reason if the dates were ever edited.
    expect(end.toMillis() - start.toMillis()).toBeGreaterThan(MAX_RANGE_DAYS * 86_400_000);

    expect(() =>
      generateSlots({
        rules: [rule(MONDAY, NINE_TO_FIVE.start_minute, NINE_TO_FIVE.end_minute)],
        exceptions: [],
        timezone: zone,
        service: service(),
        rangeStart: start.toJSDate(),
        rangeEnd: end.toJSDate(),
        now: NOW,
      })
    ).not.toThrow();
  });

  it("still refuses a range a whole day too wide", () => {
    const start = DateTime.fromISO("2025-09-01", { zone }).startOf("day");

    expect(() =>
      generateSlots({
        rules: [rule(MONDAY, NINE_TO_FIVE.start_minute, NINE_TO_FIVE.end_minute)],
        exceptions: [],
        timezone: zone,
        service: service(),
        rangeStart: start.toJSDate(),
        rangeEnd: start.plus({ days: MAX_RANGE_DAYS + 1 }).toJSDate(),
        now: NOW,
      })
    ).toThrow(/exceeds the/);
  });
});

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
    });

    const after = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 540, end_minute: 1020 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-04-06", london), // Sunday after the change, BST
      now: NOW,
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
    });

    const ordinaryDay = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 0, end_minute: 360 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-03-23", london),
      now: NOW,
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
    });
    const after = generateSlots({
      rules: [{ weekday: SUNDAY, start_minute: 540, end_minute: 1020 }],
      exceptions: [],
      timezone: london,
      service: service(),
      ...localDay("2025-04-06", london),
      now: NOW,
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
describe("the past, and real-time booking", () => {
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
    });

    const times = slots.map((s) => clockIn(s.startsAt, zone));
    expect(times).not.toContain("09:00");
    expect(times).not.toContain("12:00");
    expect(times).toContain("13:00");
  });

  it("requires no lead time at all", () => {
    // Pinned rather than assumed: this constant is the whole of Slotly's booking
    // notice policy, and a non-zero value here would quietly put same-hour
    // appointments back out of reach.
    expect(MIN_BOOKING_LEAD_MINUTES).toBe(0);
  });

  it("puts the booking floor at `now`, not at the start of some later day", () => {
    // The floor is a rolling instant. Late in the evening it is 23:55, five
    // minutes ago's slots are gone and tonight's remaining ones are not — where
    // the old calendar-date floor would have jumped to 00:00 tomorrow and taken
    // the rest of the evening with it.
    const lateEvening = new Date("2025-06-02T22:55:00Z"); // 23:55 London
    expect(earliestBookableInstant(lateEvening, zone).toMillis()).toBe(lateEvening.getTime());

    // And it stays a rolling instant when a lead time is asked for, rather than
    // rounding out to a date boundary.
    expect(earliestBookableInstant(lateEvening, zone, 90).toMillis()).toBe(
      lateEvening.getTime() + 90 * 60_000
    );
  });

  it("offers the rest of the provider's current day", () => {
    // The rule this replaced took the provider's whole current date off the
    // table however early in it "now" was: at 08:00 nothing that day could be
    // booked, not even 4 PM. Real-time booking offers all of it.
    const slots = generateSlots({
      rules: [0, 1, 2].map((d) => rule(d, 540, 1020)),
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDays("2025-06-02", zone, 2),
      now: new Date("2025-06-02T07:00:00Z"), // 08:00 London, before the day's slots
    });

    const dates = new Set(slots.map((s) => DateTime.fromISO(s.startsAt).setZone(zone).toISODate()));
    expect(dates.has("2025-06-02")).toBe(true);
    expect(dates.has("2025-06-03")).toBe(true);

    const today = slots
      .filter((s) => DateTime.fromISO(s.startsAt).setZone(zone).toISODate() === "2025-06-02")
      .map((s) => clockIn(s.startsAt, zone));
    expect(today[0]).toBe("09:00");
  });

  it("offers a slot inside the next hour", () => {
    // The headline case: it is 09:20 and the 10:00 appointment is bookable now.
    const slots = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      now: new Date("2025-06-02T08:20:00Z"), // 09:20 London
    });

    expect(slots.map((s) => clockIn(s.startsAt, zone))[0]).toBe("10:00");
  });

  it("still drops a slot the moment it starts, and honours a lead time when one is set", () => {
    // The one floor that remains. A slot starting exactly now has started, so it
    // is not on offer; the next one is.
    const onTheHour = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      now: new Date("2025-06-02T09:00:00Z"), // exactly 10:00 London
    });
    expect(onTheHour.map((s) => clockIn(s.startsAt, zone))[0]).toBe("11:00");

    // MIN_BOOKING_LEAD_MINUTES is zero, but the gate it feeds is still wired up:
    // asking for two hours' lead at 09:20 pushes the first offer from 10:00 to
    // 12:00. Kept as a test so reintroducing a lead time stays a one-line change.
    const withLead = generateSlots({
      rules: [rule(MONDAY, 540, 1020)],
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-02", zone),
      now: new Date("2025-06-02T08:20:00Z"), // 09:20 London
      minLeadMinutes: 120,
    });
    expect(withLead.map((s) => clockIn(s.startsAt, zone))[0]).toBe("12:00");
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
// Regression suite for the off-grid booking hole.
//
// `isWithinAvailability` answers "does the span fit inside an open window?",
// which a 09:17 start satisfies perfectly well on a 09:00–17:00 day. It was the
// only write-path guard, so a hand-written request could book a time that was
// never offered — and because such an appointment straddles two grid positions,
// accepting one removed *two* bookable slots from the provider's day.
//
// `isOfferedSlotStart` closes that by re-deriving the grid from the same
// `candidateStartsInWindow()` the slot list walks. The contract these tests pin
// down is the important one: **the write path accepts exactly the set of starts
// the read path offers — no more, no fewer.**
// ---------------------------------------------------------------------------
describe("isOfferedSlotStart — the booking must land on an offered start", () => {
  const zone = "Europe/London";
  const rules = [rule(MONDAY, 540, 1020)]; // Monday 09:00–17:00
  const monday = "2025-06-02";

  /** The instant of a London wall-clock reading on the fixture Monday. */
  const at = (hhmm) => DateTime.fromISO(`${monday}T${hhmm}`, { zone }).toJSDate();

  it("accepts a start that is on the grid", () => {
    expect(
      isOfferedSlotStart({
        rules,
        exceptions: [],
        timezone: zone,
        service: service({ duration: 60, slot_interval: 60 }),
        startsAt: at("09:00"),
      })
    ).toBe(true);
  });

  it("rejects a start that fits the window but is off the grid", () => {
    // The exact hole: 09:17 sits comfortably inside 09:00–17:00 and its span
    // fits, so the old guard said yes.
    const args = {
      rules,
      exceptions: [],
      timezone: zone,
      service: service({ duration: 60, slot_interval: 60 }),
      startsAt: at("09:17"),
    };

    expect(isWithinAvailability(args)).toBe(true); // the weaker guard is fooled
    expect(isOfferedSlotStart(args)).toBe(false); // the real one is not
  });

  it("rejects every off-grid minute across a whole hour", () => {
    const offGrid = [1, 7, 13, 17, 29, 30, 31, 45, 59].map((m) =>
      isOfferedSlotStart({
        rules,
        exceptions: [],
        timezone: zone,
        service: service({ duration: 60, slot_interval: 60 }),
        startsAt: at(`09:${String(m).padStart(2, "0")}`),
      })
    );

    expect(offGrid).toEqual(offGrid.map(() => false));
  });

  it("agrees with generateSlots on every start it offers, and on nothing else", () => {
    // The property that matters, asserted directly rather than by example: walk
    // a whole day of one-minute candidates and require the two functions to
    // return the same verdict for every single one.
    const svc = service({ duration: 60, buffer_before: 10, buffer_after: 5, slot_interval: 30 });

    const offered = new Set(
      generateSlots({
        rules,
        exceptions: [],
        timezone: zone,
        service: svc,
        ...localDay(monday, zone),
        now: NOW,
      }).map((s) => s.startsAt)
    );

    expect(offered.size).toBeGreaterThan(0);

    const disagreements = [];
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const instant = DateTime.fromISO(`${monday}T00:00`, { zone }).plus({ minutes: minute });
      const iso = instant.toUTC().toISO({ suppressMilliseconds: false });

      const readPathOffersIt = offered.has(instant.toJSDate().toISOString());
      const writePathAcceptsIt = isOfferedSlotStart({
        rules,
        exceptions: [],
        timezone: zone,
        service: svc,
        startsAt: instant.toJSDate(),
      });

      if (readPathOffersIt !== writePathAcceptsIt) {
        disagreements.push({ iso, readPathOffersIt, writePathAcceptsIt });
      }
    }

    expect(disagreements).toEqual([]);
  });

  it("honours the service's own slot_interval", () => {
    const args = (slotInterval) => ({
      rules,
      exceptions: [],
      timezone: zone,
      service: service({ duration: 30, slot_interval: slotInterval }),
      startsAt: at("09:30"),
    });

    expect(isOfferedSlotStart(args(30))).toBe(true); // 09:00, 09:30, 10:00 …
    expect(isOfferedSlotStart(args(60))).toBe(false); // 09:00, 10:00 …
  });

  it("anchors the grid on the buffer, exactly as the slot list does", () => {
    // A 10-minute leading buffer on a 30-minute grid pushes the first offered
    // start to 09:30, not 09:10 — the window's first grid position that leaves
    // room for the buffer. The write path must agree, or the very first slot in
    // the list would be unbookable.
    const svc = service({ duration: 30, buffer_before: 10, buffer_after: 0, slot_interval: 30 });
    const common = { rules, exceptions: [], timezone: zone, service: svc };

    expect(isOfferedSlotStart({ ...common, startsAt: at("09:00") })).toBe(false);
    expect(isOfferedSlotStart({ ...common, startsAt: at("09:10") })).toBe(false);
    expect(isOfferedSlotStart({ ...common, startsAt: at("09:30") })).toBe(true);
  });

  it("rejects a time the provider is closed for outright", () => {
    expect(
      isOfferedSlotStart({
        rules,
        exceptions: [],
        timezone: zone,
        service: service(),
        startsAt: DateTime.fromISO("2025-06-01T03:00", { zone }).toJSDate(), // Sunday
      })
    ).toBe(false);
  });

  it("rejects the last grid position when the trailing buffer would overrun", () => {
    // 16:00 + 60m + 30m buffer runs to 17:30, past the 17:00 close.
    const svc = service({ duration: 60, buffer_after: 30, slot_interval: 60 });
    const common = { rules, exceptions: [], timezone: zone, service: svc };

    expect(isOfferedSlotStart({ ...common, startsAt: at("15:00") })).toBe(true);
    expect(isOfferedSlotStart({ ...common, startsAt: at("16:00") })).toBe(false);
  });

  it("keeps the grid anchored across a DST boundary", () => {
    // Britain springs forward on 30 March 2025. The Monday after is a normal
    // day at a different UTC offset, and 09:00 local must still be offered.
    const marchRules = [rule(MONDAY, 540, 1020)];
    const common = { rules: marchRules, exceptions: [], timezone: zone, service: service() };

    const before = DateTime.fromISO("2025-03-24T09:00", { zone }); // GMT
    const after = DateTime.fromISO("2025-03-31T09:00", { zone }); // BST

    expect(before.offset).not.toBe(after.offset); // the fixture is doing its job
    expect(isOfferedSlotStart({ ...common, startsAt: before.toJSDate() })).toBe(true);
    expect(isOfferedSlotStart({ ...common, startsAt: after.toJSDate() })).toBe(true);
  });

  it("is not fooled by an 'open' exception on an otherwise closed day", () => {
    // Extra hours opened on a Sunday: 14:00–16:00. The grid anchors at 14:00.
    const exceptions = [
      {
        kind: "open",
        start_date: "2025-06-01",
        end_date: "2025-06-01",
        start_minute: 840,
        end_minute: 960,
      },
    ];
    const common = { rules, exceptions, timezone: zone, service: service({ slot_interval: 60 }) };
    const sundayAt = (hhmm) => DateTime.fromISO(`2025-06-01T${hhmm}`, { zone }).toJSDate();

    expect(isOfferedSlotStart({ ...common, startsAt: sundayAt("14:00") })).toBe(true);
    expect(isOfferedSlotStart({ ...common, startsAt: sundayAt("14:30") })).toBe(false);
    expect(isOfferedSlotStart({ ...common, startsAt: sundayAt("16:00") })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("the offered grid does not depend on the range being browsed", () => {
  // Before the fix, generateSlots anchored the grid on windows that had already
  // been clipped to the requested range. For a provider whose open window
  // crosses the edge of that range, asking for one day and asking for a week
  // could therefore publish different start times for the same day — and the
  // write path, which knows nothing about what range the client browsed, had no
  // way to agree with either.
  const zone = "Europe/London";

  it("offers the same starts for a day whether asked alone or inside a week", () => {
    const rules = [0, 1, 2, 3, 4, 5, 6].map((d) => rule(d, 540, 1020));
    const svc = service({ duration: 60, slot_interval: 60 });
    const common = { rules, exceptions: [], timezone: zone, service: svc, now: NOW };

    const alone = generateSlots({ ...common, ...localDay("2025-06-04", zone) });

    const weekStart = DateTime.fromISO("2025-06-02", { zone }).startOf("day");
    const week = generateSlots({
      ...common,
      rangeStart: weekStart.toJSDate(),
      rangeEnd: weekStart.plus({ days: 7 }).toJSDate(),
    }).filter((s) => DateTime.fromISO(s.startsAt).setZone(zone).toFormat("yyyy-MM-dd") === "2025-06-04");

    expect(alone.map((s) => s.startsAt)).toEqual(week.map((s) => s.startsAt));
    expect(alone.length).toBeGreaterThan(0);
  });

  it("still returns nothing outside the requested range", () => {
    // The clipping the range used to do is now a filter on the slots instead,
    // so this guarantee has to be re-asserted directly.
    const rules = [0, 1, 2, 3, 4, 5, 6].map((d) => rule(d, 540, 1020));
    const slots = generateSlots({
      rules,
      exceptions: [],
      timezone: zone,
      service: service(),
      ...localDay("2025-06-04", zone),
      now: NOW,
    });

    const dates = new Set(
      slots.map((s) => DateTime.fromISO(s.startsAt).setZone(zone).toFormat("yyyy-MM-dd"))
    );
    expect([...dates]).toEqual(["2025-06-04"]);
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
    });
    const elapsed = performance.now() - started;

    expect(slots.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// Configuration feasibility — the provider-facing "these settings produce no
// slots" warning.
//
// The point of these tests is not just that the diagnosis returns the right
// booleans, but that it returns *the same* answer generateSlots() does. Several
// of them assert both together on purpose: the warning exists to predict the
// engine, so a test that only checked the warning could pass while the two
// drifted apart, which is the exact failure the shared helper prevents.
// ---------------------------------------------------------------------------
describe("diagnoseSlotFeasibility", () => {
  const zone = "Asia/Qatar";

  /** Runs the real engine over one week so a diagnosis can be checked against it. */
  function actualWeeklySlotCount(rules, svc) {
    return generateSlots({
      rules,
      exceptions: [],
      timezone: zone,
      service: svc,
      ...localDays("2025-06-02", zone, 7), // Monday-to-Sunday, no DST in this zone.
      busy: [],
      now: NOW,
    }).length;
  }

  it("Case A: a two-hour window with 30m duration, 30m grid and 10m buffers is bookable", () => {
    const rules = [rule(MONDAY, 540, 660)]; // 09:00–11:00
    const svc = service({ duration: 30, buffer_before: 10, buffer_after: 10, slot_interval: 30 });

    const report = diagnoseSlotFeasibility({ rules, service: svc });

    expect(report.bookable).toBe(true);
    expect(report.problemDays).toHaveLength(0);
    expect(report.remedies).toHaveLength(0);
    // 09:30 and 10:00 fit; 09:00 loses to the leading buffer and 10:30 would
    // overrun the trailing one.
    expect(report.totalSlotsPerWeek).toBe(2);
    expect(report.days[0].windows[0].firstSlotTime).toBe("9:30 AM");
    expect(actualWeeklySlotCount(rules, svc)).toBe(report.totalSlotsPerWeek);
  });

  it("Case B: the reported edge case — 09:00–10:00, 30m, 30m grid, 10m buffers — yields nothing", () => {
    const rules = [rule(MONDAY, 540, 600)]; // 09:00–10:00
    const svc = service({ duration: 30, buffer_before: 10, buffer_after: 10, slot_interval: 30 });

    const report = diagnoseSlotFeasibility({ rules, service: svc });

    expect(report.bookable).toBe(false);
    expect(report.totalSlotsPerWeek).toBe(0);
    // The engine really does produce nothing — the warning is not a false alarm.
    expect(actualWeeklySlotCount(rules, svc)).toBe(0);

    expect(report.problemDays).toHaveLength(1);
    expect(report.problemDays[0].weekday).toBe(MONDAY);

    // ceil(10/30)*30 + 30 + 10 = 70 minutes of open time needed, so the day has
    // to run to 10:10 rather than 10:00.
    expect(report.minimumWindowMinutes).toBe(70);
    expect(report.problemDays[0].windows[0].suggestedEndTime).toBe("10:10 AM");
  });

  it("recommends extending the day first, and only offers remedies that actually work", () => {
    const rules = [rule(MONDAY, 540, 600)];
    const svc = service({ duration: 30, buffer_before: 10, buffer_after: 10, slot_interval: 30 });

    const { remedies } = diagnoseSlotFeasibility({ rules, service: svc });

    // Buffers protect the provider's real calendar, so the recommendation that
    // leads is the one that keeps them.
    expect(remedies[0].kind).toBe("extend-availability");
    expect(remedies[0].value).toBe(10);

    // Every alternative is verified rather than guessed: applying it must make
    // the very same diagnosis come back clean.
    for (const remedy of remedies) {
      const patched = { ...svc };
      const patchedRules = [...rules];

      if (remedy.kind === "slot-interval") patched.slot_interval = remedy.value;
      if (remedy.kind === "buffer-before") patched.buffer_before = remedy.value;
      if (remedy.kind === "duration") patched.duration = remedy.value;
      if (remedy.kind === "extend-availability") {
        patchedRules[0] = rule(MONDAY, 540, 600 + remedy.value);
      }

      const after = diagnoseSlotFeasibility({ rules: patchedRules, service: patched });
      expect(after.bookable, `remedy "${remedy.kind}" should fix the day`).toBe(true);
      expect(actualWeeklySlotCount(patchedRules, patched)).toBeGreaterThan(0);
    }
  });

  it("merges adjacent windows on one day before judging them", () => {
    // 09:00–09:40 and 09:40–10:20 are each too short on their own, but together
    // they are one continuous 80-minute window that comfortably fits.
    const rules = [rule(MONDAY, 540, 580), rule(MONDAY, 580, 620)];
    const svc = service({ duration: 30, buffer_before: 10, buffer_after: 10, slot_interval: 30 });

    const report = diagnoseSlotFeasibility({ rules, service: svc });

    expect(report.days[0].windows).toHaveLength(1);
    expect(report.days[0].windows[0].lengthMinutes).toBe(80);
    expect(report.bookable).toBe(true);
    expect(report.totalSlotsPerWeek).toBe(actualWeeklySlotCount(rules, svc));
  });

  it("flags only the days that cannot yield a slot, not the whole week", () => {
    const rules = [rule(MONDAY, 540, 600), rule(2, 540, 720)]; // short Monday, roomy Tuesday
    const svc = service({ duration: 30, buffer_before: 10, buffer_after: 10, slot_interval: 30 });

    const report = diagnoseSlotFeasibility({ rules, service: svc });

    expect(report.bookable).toBe(true); // the week as a whole still works
    expect(report.problemDays).toHaveLength(1);
    expect(report.problemDays[0].weekday).toBe(MONDAY);
  });

  it("reports an empty week as unbookable without inventing a remedy", () => {
    const report = diagnoseSlotFeasibility({ rules: [], service: service() });

    expect(report.bookable).toBe(false);
    expect(report.days).toHaveLength(0);
    expect(report.problemDays).toHaveLength(0);
    expect(report.remedies).toHaveLength(0);
  });

  it("does not blame the configuration for a day that is merely fully booked", () => {
    // Case D's shape: the settings are fine, the calendar is just full. A
    // provider must never be told to change their hours because of this.
    const rules = [rule(MONDAY, 540, 600)];
    const svc = service({ duration: 30, buffer_before: 0, buffer_after: 0, slot_interval: 30 });

    expect(diagnoseSlotFeasibility({ rules, service: svc }).bookable).toBe(true);

    const busy = [
      {
        blocked_from: DateTime.fromISO("2025-06-02T09:00", { zone }).toJSDate(),
        blocked_to: DateTime.fromISO("2025-06-02T10:00", { zone }).toJSDate(),
      },
    ];
    const slots = generateSlots({
      rules,
      exceptions: [],
      timezone: zone,
      service: svc,
      ...localDay("2025-06-02", zone),
      busy,
      now: NOW,
    });

    expect(slots).toHaveLength(0);
    // Still reported as a sound configuration, because it is one.
    expect(diagnoseSlotFeasibility({ rules, service: svc }).bookable).toBe(true);
  });

  it("Case D: booking one slot removes its neighbour through the buffer", () => {
    // A window with genuine room for two adjacent appointments, so the only
    // thing under test is the buffer collision — not the grid.
    const rules = [rule(MONDAY, 540, 660)]; // 09:00–11:00
    const svc = service({ duration: 30, buffer_before: 10, buffer_after: 10, slot_interval: 30 });
    const day = localDay("2025-06-02", zone);

    const before = generateSlots({
      rules,
      exceptions: [],
      timezone: zone,
      service: svc,
      ...day,
      busy: [],
      now: NOW,
    });
    expect(before.map((s) => clockIn(s.startsAt, zone))).toEqual(["09:30", "10:00"]);

    // Book 09:30. Its occupied span carries the buffers: 09:20–10:10.
    const booked = computeBookingSpan(before[0].startsAt, svc);
    expect(clockIn(booked.blockedFrom.toISOString(), zone)).toBe("09:20");
    expect(clockIn(booked.blockedTo.toISOString(), zone)).toBe("10:10");

    const after = generateSlots({
      rules,
      exceptions: [],
      timezone: zone,
      service: svc,
      ...day,
      busy: [{ blocked_from: booked.blockedFrom, blocked_to: booked.blockedTo }],
      now: NOW,
    });

    // 10:00 would need 09:50–10:40, which runs into the booked span's trailing
    // buffer, so it disappears — buffers doing exactly the job they exist for.
    expect(after).toHaveLength(0);
  });

  it("minimumWindowMinutes rounds the leading buffer up to a whole grid step", () => {
    // The surprising part for providers: a 10-minute leading buffer on a
    // 30-minute grid costs 30 minutes of the window, not 10, because no grid
    // position lands in the other 20.
    expect(minimumWindowMinutes({ duration: 30, bufferBefore: 10, bufferAfter: 10, step: 30 })).toBe(70);
    expect(minimumWindowMinutes({ duration: 30, bufferBefore: 0, bufferAfter: 10, step: 30 })).toBe(40);
    expect(minimumWindowMinutes({ duration: 30, bufferBefore: 10, bufferAfter: 10, step: 10 })).toBe(50);
  });
});

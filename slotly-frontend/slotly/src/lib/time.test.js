/**
 * Tests for the UI's timezone and formatting helpers.
 *
 * The backend suite proves the *server* gets time right. This file exists
 * because the browser is the second place the same mistakes can be made, and
 * until now it had no coverage at all — despite `src/lib/time.js` holding the
 * two functions in the whole client that are genuinely easy to get wrong.
 *
 * Those two are `toDisplayDate` and `fromDisplayDate`. They deliberately build a
 * `Date` whose *absolute value is wrong* so that `react-big-calendar`, which
 * always renders in the browser's own zone, draws the provider's local clock
 * instead. Anything that subtle needs a test that states the intent, or the next
 * reader will "fix" it.
 *
 * The suite runs with TZ=UTC (see vitest.config.js), so nothing here can pass by
 * accident because the machine happened to be in the right zone.
 */
import { describe, it, expect } from "vitest";
import { DateTime, Settings } from "luxon";
import {
  TIME_FORMAT,
  isValidTimezone,
  inZone,
  formatDateTime,
  formatTime,
  formatClockTime,
  countdownTo,
  formatLongDate,
  formatShortDate,
  zoneLabel,
  toDisplayDate,
  fromDisplayDate,
  relativeTime,
  greeting,
  isPast,
  todayIn,
  addDaysToDate,
  weekFrom,
  friendlyDateHeading,
  timeToMinutes,
  timezoneLabel,
} from "./time.js";

/** 13 January 2025, 09:00 UTC — a winter date, so London is on GMT. */
const WINTER = "2025-01-13T09:00:00.000Z";
/** 2 June 2025, 09:00 UTC — a summer date, so London is on BST (+01:00). */
const SUMMER = "2025-06-02T09:00:00.000Z";

// ---------------------------------------------------------------------------
describe("inZone", () => {
  it("reads one instant on two different clocks", () => {
    expect(inZone(WINTER, "Europe/London").toFormat("HH:mm")).toBe("09:00");
    expect(inZone(WINTER, "America/New_York").toFormat("HH:mm")).toBe("04:00");
    expect(inZone(WINTER, "Asia/Kolkata").toFormat("HH:mm")).toBe("14:30");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(inZone(new Date(WINTER), "Asia/Kolkata").toFormat("HH:mm")).toBe("14:30");
  });

  it("falls back to UTC rather than producing an invalid DateTime", () => {
    // A corrupted saved zone must not render as "Invalid DateTime" across the UI.
    const result = inZone(WINTER, "Mars/Phobos");
    expect(result.isValid).toBe(true);
    expect(result.toFormat("HH:mm")).toBe("09:00");
  });

  it("follows the zone's own DST rules, not a fixed offset", () => {
    // London is +00:00 in January and +01:00 in June. Code that cached an offset
    // would get one of these wrong.
    expect(inZone(WINTER, "Europe/London").toFormat("HH:mm")).toBe("09:00");
    expect(inZone(SUMMER, "Europe/London").toFormat("HH:mm")).toBe("10:00");
  });

  it("puts an instant on a different calendar date for a distant reader", () => {
    // 23:30 UTC is already tomorrow in Auckland and still today in New York.
    const late = "2025-01-13T23:30:00.000Z";
    expect(inZone(late, "Pacific/Auckland").toFormat("yyyy-MM-dd")).toBe("2025-01-14");
    expect(inZone(late, "America/New_York").toFormat("yyyy-MM-dd")).toBe("2025-01-13");
  });
});

// ---------------------------------------------------------------------------
describe("formatting", () => {
  it("uses the same clock format the API does", () => {
    // The backend renders times with this exact token, and the two must agree or
    // the same appointment reads differently on two screens.
    expect(TIME_FORMAT).toBe("h:mm a");
  });

  it("formats a date and time in the given zone", () => {
    expect(formatDateTime(WINTER, "Europe/London")).toBe("Mon 13 Jan, 9:00 AM");
    expect(formatDateTime(WINTER, "America/New_York")).toBe("Mon 13 Jan, 4:00 AM");
  });

  it("crosses the date line in the label, not just the clock", () => {
    expect(formatDateTime("2025-01-13T23:30:00.000Z", "Pacific/Auckland")).toBe("Tue 14 Jan, 12:30 PM");
  });

  it("formats time, long date and short date", () => {
    expect(formatTime(WINTER, "Asia/Kolkata")).toBe("2:30 PM");
    expect(formatLongDate(WINTER, "Europe/London")).toBe("Monday 13 January 2025");
    expect(formatShortDate(WINTER, "Europe/London")).toBe("Mon 13 Jan");
  });

  it("labels the zone, including a half-hour offset", () => {
    expect(zoneLabel(WINTER, "Asia/Kolkata")).toBe("GMT+5:30");
    // The same zone is labelled differently either side of its DST change.
    expect(zoneLabel(WINTER, "Europe/London")).not.toBe(zoneLabel(SUMMER, "Europe/London"));
  });

  it("renders '24:00' as midnight rather than echoing it back", () => {
    // The API says "24:00" for "open until midnight"; Luxon will not parse it,
    // and printing it raw would show a clock time that does not exist.
    expect(formatClockTime("24:00")).toBe("12:00 AM");
    expect(formatClockTime("9:00")).toBe("9:00 AM");
    expect(formatClockTime("17:30")).toBe("5:30 PM");
  });

  it("returns unparseable input unchanged instead of throwing", () => {
    expect(formatClockTime("later")).toBe("later");
    expect(formatClockTime(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("toDisplayDate / fromDisplayDate — the calendar's deliberate lie", () => {
  // react-big-calendar renders a JS Date in the *browser's* zone, with no way to
  // tell it otherwise. To draw a provider's 09:00 London appointment at 09:00 on
  // the grid for a viewer sitting in New York, it must be handed a Date whose
  // browser-local reading is 09:00 — which means an instant five hours away from
  // the real one. These two functions build that lie and undo it, and they are
  // only ever correct as a pair.

  it("produces a Date whose local clock face matches the target zone", () => {
    // 09:00 UTC is 04:00 in New York. The display Date must read 04:00 on the
    // machine's own clock, whatever the machine's zone is.
    const display = toDisplayDate(WINTER, "America/New_York");

    expect(display.getHours()).toBe(4);
    expect(display.getMinutes()).toBe(0);
    expect(display.getDate()).toBe(13);
  });

  it("is not the same instant as the input — that is the point", () => {
    const display = toDisplayDate(WINTER, "America/New_York");
    expect(display.toISOString()).not.toBe(WINTER);
  });

  it("round-trips back to the original instant", () => {
    // The property that keeps a drag-to-reschedule honest: whatever the calendar
    // hands back must resolve to a real moment in the provider's zone.
    for (const zone of ["America/New_York", "Asia/Kolkata", "Pacific/Auckland", "Europe/London"]) {
      const restored = fromDisplayDate(toDisplayDate(WINTER, zone), zone);
      expect(restored.toUTC().toISO(), zone).toBe(DateTime.fromISO(WINTER).toUTC().toISO());
    }
  });

  it("round-trips across a DST boundary in both directions", () => {
    // The dangerous case: a summer instant in a DST zone, where a naive
    // fixed-offset implementation drifts by an hour.
    for (const instant of [WINTER, SUMMER]) {
      const restored = fromDisplayDate(toDisplayDate(instant, "Europe/London"), "Europe/London");
      expect(restored.toUTC().toISO(), instant).toBe(DateTime.fromISO(instant).toUTC().toISO());
    }
  });

  it("keeps a half-hour offset intact through the round trip", () => {
    // +05:30 is where whole-hour assumptions break.
    const restored = fromDisplayDate(toDisplayDate(WINTER, "Asia/Kolkata"), "Asia/Kolkata");
    expect(restored.toUTC().toISO()).toBe(DateTime.fromISO(WINTER).toUTC().toISO());
  });

  it("falls back to UTC when the zone is unknown, rather than going invalid", () => {
    const restored = fromDisplayDate(new Date(WINTER), "Mars/Phobos");
    expect(restored.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("calendar-date helpers", () => {
  it("reports today in the reader's zone, not the machine's", () => {
    // Frozen at 23:30 UTC on the 13th: already the 14th in Auckland, still the
    // 13th in New York. A helper that used the machine's clock would give one
    // answer to both.
    Settings.now = () => Date.parse("2025-01-13T23:30:00.000Z");
    try {
      expect(todayIn("Pacific/Auckland")).toBe("2025-01-14");
      expect(todayIn("America/New_York")).toBe("2025-01-13");
      expect(todayIn("UTC")).toBe("2025-01-13");
    } finally {
      Settings.now = () => Date.now();
    }
  });

  it("adds days in calendar space, so a DST day is still one day", () => {
    // 30 March 2025 is 23 hours long in London. Adding "24 hours" would land on
    // the wrong date; adding a calendar day does not.
    expect(addDaysToDate("2025-03-29", 1)).toBe("2025-03-30");
    expect(addDaysToDate("2025-03-30", 1)).toBe("2025-03-31");
    expect(addDaysToDate("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDaysToDate("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });

  it("builds seven consecutive dates across a month boundary", () => {
    const week = weekFrom("2025-01-29");

    expect(week).toHaveLength(7);
    expect(week.map((d) => d.iso)).toEqual([
      "2025-01-29",
      "2025-01-30",
      "2025-01-31",
      "2025-02-01",
      "2025-02-02",
      "2025-02-03",
      "2025-02-04",
    ]);
    expect(week[0]).toMatchObject({ weekday: "Wed", dayOfMonth: "29", month: "Jan" });
  });

  it("says Today and Tomorrow relative to the reader's zone", () => {
    Settings.now = () => Date.parse("2025-01-13T12:00:00.000Z");
    try {
      expect(friendlyDateHeading("2025-01-13", "UTC")).toBe("Today");
      expect(friendlyDateHeading("2025-01-14", "UTC")).toBe("Tomorrow");
      expect(friendlyDateHeading("2025-01-20", "UTC")).toBe("Monday 20 January");
    } finally {
      Settings.now = () => Date.now();
    }
  });
});

// ---------------------------------------------------------------------------
describe("timeToMinutes", () => {
  it("converts a wall-clock reading to minutes from midnight", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("9:00")).toBe(540);
    expect(timeToMinutes("17:30")).toBe(1050);
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("accepts 24:00 as the end of the day", () => {
    // The one reading that is legal in an availability window but is not a real
    // clock time.
    expect(timeToMinutes("24:00")).toBe(1440);
  });

  it("rejects everything that is not a time", () => {
    for (const bad of ["24:01", "25:00", "09:60", "9", "09:0", "abc", "", null, undefined, "-1:00"]) {
      expect(timeToMinutes(bad), String(bad)).toBeNull();
    }
  });

  it("agrees with the backend's parser on the awkward values", () => {
    // The server's parseTimeToMinutes accepts exactly these; a disagreement here
    // would mean the UI let a provider save hours the API then rejected.
    expect(timeToMinutes("24:00")).toBe(1440);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("24:01")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("isValidTimezone", () => {
  it("accepts real IANA names", () => {
    for (const zone of ["UTC", "Europe/London", "Asia/Kolkata", "America/New_York", "Pacific/Auckland"]) {
      expect(isValidTimezone(zone), zone).toBe(true);
    }
  });

  it("rejects anything the runtime cannot resolve", () => {
    for (const zone of ["Mars/Phobos", "GMT+5", "", null, undefined, "Not/AZone"]) {
      expect(isValidTimezone(zone), String(zone)).toBe(false);
    }
  });

  it("agrees with the check the API applies before saving", () => {
    // Both sides ask Luxon rather than consulting a hardcoded list, so the form
    // cannot accept a zone the server will refuse.
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("Asia/Calcutta")).toBe(true); // legacy alias, still valid
  });
});

// ---------------------------------------------------------------------------
describe("greeting and isPast", () => {
  it("greets by the reader's clock, not the browser's", () => {
    // 20:00 UTC is evening in London and afternoon in New York. A provider who
    // set their timezone should get the greeting matching the clock the rest of
    // their dashboard is drawn in.
    Settings.now = () => Date.parse("2025-01-13T20:00:00.000Z");
    try {
      expect(greeting("Europe/London")).toBe("Good evening");
      expect(greeting("America/New_York")).toBe("Good afternoon");
      expect(greeting("Asia/Kolkata")).toBe("Good morning"); // 01:30 next day
    } finally {
      Settings.now = () => Date.now();
    }
  });

  it("judges the past by the instant, so the answer is zone-independent", () => {
    Settings.now = () => Date.parse("2025-01-13T12:00:00.000Z");
    try {
      expect(isPast("2025-01-13T11:59:00.000Z")).toBe(true);
      expect(isPast("2025-01-13T12:01:00.000Z")).toBe(false);
    } finally {
      Settings.now = () => Date.now();
    }
  });

  it("counts down in minutes, hours and days", () => {
    const now = DateTime.fromISO("2025-01-13T09:00:00.000Z");
    const at = (iso) => countdownTo(iso, now);

    expect(at("2025-01-13T09:45:00.000Z")).toBe("in 45 min");
    expect(at("2025-01-13T12:00:00.000Z")).toBe("in 3 hours");
    expect(at("2025-01-15T09:00:00.000Z")).toBe("in 2 days");
  });

  it("uses the singular for exactly one hour and one day", () => {
    const now = DateTime.fromISO("2025-01-13T09:00:00.000Z");

    expect(countdownTo("2025-01-13T10:00:00.000Z", now)).toBe("in 1 hour");
    expect(countdownTo("2025-01-14T09:00:00.000Z", now)).toBe("in 1 day");
  });

  it("rounds hours down, never up", () => {
    // Telling someone they have four hours when they have three and a half is
    // the one error worth ruling out.
    const now = DateTime.fromISO("2025-01-13T09:00:00.000Z");
    expect(countdownTo("2025-01-13T12:50:00.000Z", now)).toBe("in 3 hours");
  });

  it("tops out at days rather than escalating to months", () => {
    // The difference from relativeTime(), which would say "in 1 month" — not a
    // useful answer to "when is my next appointment?".
    const now = DateTime.fromISO("2025-01-13T09:00:00.000Z");

    expect(countdownTo("2025-02-17T09:00:00.000Z", now)).toBe("in 35 days");
    expect(relativeTime("2025-02-17T09:00:00.000Z", now)).toBe("in 1 month");
  });

  it("says 'now' rather than counting into the negative", () => {
    const now = DateTime.fromISO("2025-01-13T09:00:00.000Z");

    expect(countdownTo("2025-01-13T09:00:30.000Z", now)).toBe("now");
    expect(countdownTo("2025-01-13T08:00:00.000Z", now)).toBe("now");
  });

  it("gives the same countdown to two people in different zones", () => {
    // It measures instants, so the answer cannot depend on where you are.
    const now = DateTime.fromISO("2025-01-13T09:00:00.000Z");

    expect(countdownTo("2025-01-13T14:00:00.000Z", now.setZone("Asia/Kolkata"))).toBe("in 5 hours");
    expect(countdownTo("2025-01-13T14:00:00.000Z", now.setZone("America/New_York"))).toBe(
      "in 5 hours"
    );
  });

  it("describes a relative time from an injected base", () => {
    const base = DateTime.fromISO("2025-01-13T09:00:00.000Z");
    expect(relativeTime("2025-01-16T09:00:00.000Z", base)).toBe("in 3 days");
    expect(relativeTime("2025-01-13T07:00:00.000Z", base)).toBe("2 hours ago");
  });
});

// ---------------------------------------------------------------------------
describe("timezoneLabel", () => {
  it("renders a zone for a dropdown, underscores removed", () => {
    // Frozen, because the label is offset-dependent: New York reads EST in
    // January and EDT in June, so an unfrozen assertion would pass for half the
    // year. Luxon prints a named abbreviation where the zone has one and falls
    // back to a GMT offset where it does not — Kolkata has no abbreviation in
    // CLDR, which is why the two lines below look different.
    Settings.now = () => Date.parse("2025-01-13T12:00:00.000Z");
    try {
      expect(timezoneLabel("America/New_York")).toBe("America/New York (EST)");
      expect(timezoneLabel("Asia/Kolkata")).toBe("Asia/Kolkata (GMT+5:30)");
      expect(timezoneLabel("Europe/London")).toBe("Europe/London (GMT)");
    } finally {
      Settings.now = () => Date.now();
    }
  });

  it("returns an unknown zone unchanged rather than mislabelling it", () => {
    expect(timezoneLabel("Mars/Phobos")).toBe("Mars/Phobos");
  });
});

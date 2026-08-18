/**
 * Timezone and formatting helpers for the UI.
 *
 * Every instant the API returns is a UTC ISO string, and every one of them is
 * rendered here in somebody's zone — the signed-in user's, or a provider's.
 * Nothing in this file does offset arithmetic by hand; Luxon is asked, because
 * the whole point of the exercise is that "add five and a half hours" is wrong
 * twice a year.
 *
 * Two functions in here are genuinely counter-intuitive and are commented at
 * length where they are defined: `toDisplayDate` and `fromDisplayDate`, which
 * deliberately construct a `Date` holding the *wrong* instant so that
 * react-big-calendar draws the right clock face. They are covered by
 * `time.test.js`, which runs pinned to TZ=UTC.
 */

import { DateTime } from "luxon";

/**
 * The one clock format the whole app uses, e.g. "9:00 AM".
 *
 * Deliberately identical to the backend's `TIME_FORMAT`. If the two drifted, the
 * same appointment would read differently on the booking confirmation (rendered
 * by the server) and on the dashboard (rendered here).
 */
export const TIME_FORMAT = "h:mm a";

/** The browser's best guess at the user's zone. A suggestion, not a source of truth. */
export function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** True when Luxon can resolve the name. Used to validate before saving. */
export function isValidTimezone(zone) {
  return Boolean(zone) && DateTime.local().setZone(zone).isValid;
}


/**
 * Reads an instant in a given zone. The base of every formatter below.
 *
 * @param {string|Date} instant A UTC ISO string from the API, or a Date.
 * @param {string} zone IANA zone name.
 * @returns {DateTime} The same moment, expressed in `zone`. An unresolvable
 *   zone falls back to UTC rather than returning an invalid DateTime, because
 *   an invalid one formats as the literal string "Invalid DateTime" and would
 *   spray that across every screen instead of failing in one place.
 */
export function inZone(instant, zone) {
  const utc = instant instanceof Date ? DateTime.fromJSDate(instant) : DateTime.fromISO(instant);
  const local = utc.setZone(zone);
  return local.isValid ? local : utc.setZone("UTC");
}

/** "Mon 13 Jan, 9:00 AM" — the default way an appointment is written in the UI. */
export function formatDateTime(instant, zone) {
  return inZone(instant, zone).toFormat(`ccc d LLL, ${TIME_FORMAT}`);
}

/** "9:00 AM" */
export function formatTime(instant, zone) {
  return inZone(instant, zone).toFormat(TIME_FORMAT);
}


/**
 * Formats a bare wall-clock string — "09:00" — for display.
 *
 * Distinct from `formatTime` because the input is *not an instant*: a
 * provider's availability window is a clock reading with no date and no zone
 * attached, and converting it would be meaningless. Only the presentation
 * changes here, never the value.
 *
 * @param {string} wallClock "H:MM" or "HH:MM", or "24:00".
 * @returns {string} e.g. "9:00 AM". Unparseable input is returned unchanged
 *   rather than throwing, so a malformed value shows as itself instead of
 *   blanking the row it appears in.
 */
export function formatClockTime(wallClock) {
  const parsed = DateTime.fromFormat(String(wallClock ?? "").trim(), "H:mm");
  if (!parsed.isValid) {
    // "24:00" is how the API says "until midnight"; Luxon will not parse it.
    return String(wallClock ?? "") === "24:00" ? "12:00 AM" : String(wallClock ?? "");
  }
  return parsed.toFormat(TIME_FORMAT);
}

/** "Monday 13 January 2026" */
export function formatLongDate(instant, zone) {
  return inZone(instant, zone).toFormat("cccc d LLLL yyyy");
}

/** "Mon 13 Jan" */
export function formatShortDate(instant, zone) {
  return inZone(instant, zone).toFormat("ccc d LLL");
}

/**
 * The short zone label to print next to a time, e.g. "GMT+1" or "IST".
 *
 * Always shown alongside a time in this app. A time without its zone is exactly
 * the ambiguity the whole project is about.
 */
export function zoneLabel(instant, zone) {
  return inZone(instant, zone).toFormat("ZZZZ");
}


/**
 * Builds a `Date` that *deliberately holds the wrong instant*, so that
 * react-big-calendar draws the right clock face.
 *
 * ## Why this is necessary, and why it looks like a bug
 *
 * react-big-calendar positions an event by reading a JS `Date` with
 * `getHours()`, which is always the *browser's* local zone. There is no zone
 * option. So a provider in London looking at their calendar from a laptop still
 * set to New York would see every appointment drawn five hours early — the
 * times would be correct instants and the grid would be useless.
 *
 * The only way to place an event at 09:00 on the grid is to hand the calendar a
 * Date whose browser-local reading *is* 09:00. That means taking the real
 * instant, reading its wall-clock fields in the target zone, and rebuilding a
 * Date from those numbers in the browser's zone — producing a value that is
 * hours away from the true moment and is correct for exactly one purpose:
 * drawing.
 *
 * The rules that follow from that:
 *
 *   - The result is **for rendering only**. It must never be sent to the API,
 *     compared against another instant, or stored. `fromDisplayDate()` is the
 *     only legitimate thing to do with it afterwards.
 *   - The two functions are only correct as a pair, and the round trip is
 *     asserted in `time.test.js` across DST boundaries and a half-hour offset.
 *
 * @param {string|Date} instant The real UTC instant from the API.
 * @param {string} zone The zone whose clock face should be shown.
 * @returns {Date} A Date whose browser-local reading matches `zone`'s wall clock.
 */
export function toDisplayDate(instant, zone) {
  const local = inZone(instant, zone);

  // Rebuilt with no `zone` option, so these numbers are interpreted in the
  // browser's zone — which is precisely the substitution that makes the grid
  // draw them where we want.
  return DateTime.fromObject({
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    minute: local.minute,
  }).toJSDate();
}

/**
 * Turns a calendar-grid `Date` back into the real instant it represents.
 *
 * The exact inverse of `toDisplayDate()`, and the reason a provider can drag an
 * event to a new slot and have the reschedule land on the right moment. The
 * calendar hands back a Date whose browser-local fields are the wall-clock time
 * the user dropped it on; those fields are re-read in the provider's zone to
 * recover a genuine instant.
 *
 * Reading the fields off the Date and reconstructing them in `zone` — rather
 * than adding an offset — is what keeps this correct across a DST boundary,
 * where the offset on either side of the drag is not the same.
 *
 * @param {Date} displayDate A Date from the calendar, as produced by
 *   `toDisplayDate()`.
 * @param {string} zone The zone its clock face should be interpreted in.
 * @returns {DateTime} The real instant. Falls back to reading the face as UTC
 *   if `zone` cannot be resolved, so a corrupted profile zone degrades rather
 *   than producing an invalid value.
 */
export function fromDisplayDate(displayDate, zone) {
  const face = DateTime.fromJSDate(displayDate);

  const real = DateTime.fromObject(
    {
      year: face.year,
      month: face.month,
      day: face.day,
      hour: face.hour,
      minute: face.minute,
      second: face.second,
    },
    { zone }
  );

  return real.isValid ? real : face.setZone("UTC");
}

/**
 * "in 3 days", "2 hours ago".
 */
export function relativeTime(instant, now = DateTime.now()) {
  return DateTime.fromISO(typeof instant === "string" ? instant : instant.toISOString()).toRelative({
    base: now,
  });
}

/**
 * "Good morning", "Good afternoon", "Good evening" — in the reader's own zone,
 * not the browser's, so a provider who has set their timezone gets the greeting
 * that matches the clock the rest of their dashboard is drawn in.
 */
export function greeting(zone) {
  const hour = DateTime.now().setZone(zone || "UTC").hour;
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * How long until an appointment starts, as "in 45 min", "in 3 hours", "in 2 days".
 *
 * Distinct from `relativeTime()`, which is Luxon's general-purpose formatter and
 * escalates past days — an appointment five weeks out reads "in 1 month", which
 * is not a useful answer to "when is my next appointment?". This tops out at
 * days, because days are the unit someone plans around.
 *
 * Measured between instants, never wall clocks, so the answer does not depend on
 * which timezone either party is in — "in 3 hours" is three hours for everyone.
 * That is also why it takes no zone argument.
 *
 * The thresholds are chosen to avoid two readings that are technically correct
 * and unhelpful:
 *
 *   - Under a minute is "starting now" rather than "in 34 seconds"; nobody acts
 *     on seconds, and a ticking number implies a precision the page does not have
 *     (it is not re-rendered every second).
 *   - Hours round *down*, not to nearest. Something 3h50m away reads "in 3 hours",
 *     never "in 4 hours" — telling someone they have more time than they do is
 *     the one error worth ruling out here.
 *
 * @param {string|Date} instant The appointment start, as a UTC instant.
 * @param {DateTime} [now] Injectable, so tests do not depend on the wall clock.
 * @returns {string} A short phrase. Returns "now" for an instant already passed,
 *   rather than a negative countdown — callers showing upcoming appointments
 *   should not be handed "in -2 hours" if one slips past while the page is open.
 */
export function countdownTo(instant, now = DateTime.now()) {
  const start = instant instanceof Date ? DateTime.fromJSDate(instant) : DateTime.fromISO(instant);
  if (!start.isValid) return "";

  const minutes = start.diff(now, "minutes").minutes;

  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${Math.floor(minutes)} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** True when the instant is in the past. */
export function isPast(instant) {
  return DateTime.fromISO(typeof instant === "string" ? instant : instant.toISOString()) < DateTime.now();
}


/**
 * Today's calendar date in a given zone, as "YYYY-MM-DD".
 *
 * Not the same as the machine's date, and the difference is load-bearing: at
 * 23:30 UTC it is already tomorrow in Auckland and still today in New York. The
 * date pickers and the "Today" heading both key off this, so a client browsing
 * a provider's slots sees their own day boundary rather than the server's.
 *
 * @param {string} zone IANA zone name.
 * @returns {string} "YYYY-MM-DD".
 */
export function todayIn(zone) {
  return DateTime.now().setZone(zone).toFormat("yyyy-MM-dd");
}

/** Adds days to a "YYYY-MM-DD" string, staying in calendar-date space. */
export function addDaysToDate(isoDate, days) {
  return DateTime.fromISO(isoDate).plus({ days }).toFormat("yyyy-MM-dd");
}

/**
 * The seven consecutive dates starting at `isoDate`.
 */
export function weekFrom(isoDate) {
  const start = DateTime.fromISO(isoDate);
  return Array.from({ length: 7 }, (_, i) => {
    const day = start.plus({ days: i });
    return {
      iso: day.toFormat("yyyy-MM-dd"),
      weekday: day.toFormat("ccc"),
      dayOfMonth: day.toFormat("d"),
      month: day.toFormat("LLL"),
    };
  });
}

/**
 * Formats a date heading the way people actually read one.
 */
export function friendlyDateHeading(isoDate, zone) {
  const today = todayIn(zone);
  if (isoDate === today) return "Today";
  if (isoDate === addDaysToDate(today, 1)) return "Tomorrow";
  return DateTime.fromISO(isoDate).toFormat("cccc d LLLL");
}

/** Converts "HH:MM" to minutes from midnight; null when it is not a time. */
export function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (hours === 24 && minutes === 0) return 1440; // "until midnight"
  if (hours > 23) return null;

  return hours * 60 + minutes;
}

/**
 * A list of IANA zone names for the timezone pickers.
 */
export function allTimezones() {
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      // Fall through to the static list below.
    }
  }

  return [
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Asia/Kolkata",
    "Asia/Dubai",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
}

/**
 * Renders a zone for a dropdown: "Asia/Kolkata (GMT+5:30)".
 */
export function timezoneLabel(zone) {
  const now = DateTime.now().setZone(zone);
  if (!now.isValid) return zone;
  return `${zone.replace(/_/g, " ")} (${now.toFormat("ZZZZ")})`;
}

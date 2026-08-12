//Timezone and formatting helpers for the UI.

import { DateTime } from "luxon";

export const TIME_FORMAT = "h:mm a";

/** The browser's best guess at the user's zone. A suggestion, not a source of truth. */
export function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** True when Luxon can resolve the name. Used to validate before saving. */
export function isValidTimezone(zone) {
  return Boolean(zone) && DateTime.local().setZone(zone).isValid;
}


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


export function toDisplayDate(instant, zone) {
  const local = inZone(instant, zone);

  return DateTime.fromObject({
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    minute: local.minute,
  }).toJSDate();
}


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

/** True when the instant is in the past. */
export function isPast(instant) {
  return DateTime.fromISO(typeof instant === "string" ? instant : instant.toISOString()) < DateTime.now();
}


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

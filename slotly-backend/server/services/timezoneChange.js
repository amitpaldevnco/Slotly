/**
 * What changing a provider's timezone would do to appointments already on their
 * calendar.
 *
 * ## Why a timezone change can conflict at all
 *
 * A booking is an absolute instant. `bookings.starts_at` is one fixed point on
 * the universal timeline, and no profile edit moves it — a 2 PM appointment is
 * the same moment whether the provider reads it as 2 PM in London or 9 AM in New
 * York. So the appointments themselves never collide with each other because of
 * a zone change, and there is no double-booking risk here.
 *
 * What *does* move is the provider's **availability**. Weekly rules are stored
 * as a weekday plus a wall-clock minute ("Monday, 09:00–17:00") and only become
 * real instants when paired with the provider's current IANA zone — see
 * `services/slotEngine.js`. Change the zone and every window slides along the
 * timeline by the offset difference, while the appointments stay put. An
 * appointment booked at 09:00 London can therefore end up at 04:00 inside a
 * provider's new New York hours: the same instant as always, now well outside
 * the working day they have just told us they keep.
 *
 * That is the conflict this module finds, and it is a real one rather than a
 * cosmetic one. `POST /bookings/:id/reschedule` validates against the provider's
 * *current* zone, so a stranded appointment is one the provider can no longer
 * move without first widening their hours, and one their own calendar will draw
 * outside the shaded working day.
 *
 * ## Only conflicts the change actually causes
 *
 * Every booking is judged twice: once under the zone in force now, once under
 * the candidate zone. A booking is reported only when it fits today and would
 * not fit afterwards.
 *
 * That asymmetry is deliberate. A provider who trimmed their Monday hours after
 * a Monday appointment was booked already has an appointment outside their
 * availability; so does one who cleared their weekly rules entirely. Reporting
 * those would block an unrelated timezone change over a pre-existing state the
 * provider did not create here and cannot fix by picking a different zone — and
 * the honest answer to "does this change cause conflicts?" for them is no.
 *
 * ## No override
 *
 * There is deliberately no `force` flag in this module or its callers. The
 * provider's choices are to cancel or reschedule the appointments named in the
 * report, or to leave their timezone as it is. A "change it anyway" path would
 * produce exactly the silent calendar corruption the check exists to prevent.
 */
import { DateTime } from "luxon";
import { query } from "../config/dbConfig.js";
import { getEffectiveAvailability } from "./availabilityResolver.js";
import { isWithinAvailability } from "./slotEngine.js";
import { ACTIVE_STATUSES, TIME_FORMAT } from "./bookingRules.js";

/** How a conflicting booking's date and time are rendered for the provider. */
const DISPLAY_FORMAT = "ccc d LLL yyyy, " + TIME_FORMAT;

/**
 * True when Luxon can resolve `zone` as an IANA timezone name.
 *
 * The same test `authController` applies before storing a zone, exported here so
 * the impact endpoint can reject nonsense with a 400 rather than cheerfully
 * reporting "no conflicts" for a zone that could never have been saved. Asking
 * Luxon rather than matching a pattern is what keeps the answer identical to the
 * arithmetic that follows.
 *
 * @param {unknown} zone
 * @returns {boolean}
 */
export function isResolvableTimezone(zone) {
  return typeof zone === "string" && zone.length > 0 && DateTime.local().setZone(zone).isValid;
}

/**
 * Assesses a candidate timezone against a provider's upcoming appointments.
 *
 * Read-only. Nothing here writes, so the same call can both preview a change the
 * provider is considering and guard the write that commits it, with no risk that
 * looking has changed anything.
 *
 * @param {object} args
 * @param {number} args.providerId
 * @param {string} args.timezone The candidate IANA zone.
 * @param {Date} [args.now] Instant to treat as "the present". Injectable so
 *   tests are not at the mercy of the wall clock.
 * @returns {Promise<{
 *   currentTimezone: string,
 *   timezone: string,
 *   changed: boolean,
 *   safe: boolean,
 *   upcomingCount: number,
 *   conflictCount: number,
 *   conflicts: Array<object>
 * }>} `safe` is the one field a caller needs to branch on: true means the change
 *   may proceed. `changed` is false when the candidate zone is the one already
 *   stored, in which case there was nothing to check.
 * @throws {Error} If `providerId` names no provider.
 */
export async function assessTimezoneChange({ providerId, timezone, now = new Date() }) {
  const provider = await query("SELECT timezone FROM users WHERE id = $1 AND role = 'provider'", [
    providerId,
  ]);

  if (provider.rows.length === 0) {
    throw new Error(`No provider with id ${providerId}`);
  }

  const currentTimezone = provider.rows[0].timezone;

  // Re-saving the zone already in force is a no-op, and comparing a schedule
  // with itself can only ever return "safe". Answering early also means the
  // common case — a provider saving some unrelated profile field, with the
  // timezone posted back unchanged — never touches the bookings table.
  if (currentTimezone === timezone) {
    return safely({ currentTimezone, timezone, changed: false, upcomingCount: 0 });
  }

  // Buffers come from the service as it stands today, the duration from the
  // booking's own snapshot — the same pairing `rescheduleBooking` uses, so the
  // question asked is about the exact span the calendar is holding rather than
  // about a service the provider may have resized since.
  //
  // "Upcoming" is `ends_at > now` rather than `starts_at > now`: an appointment
  // already under way has not finished, and a provider deciding whether to move
  // their whole schedule should see it rather than have it quietly excluded.
  const upcoming = await query(
    `SELECT b.id, b.status, b.starts_at, b.ends_at, b.duration_snapshot,
            b.service_id, b.service_name_snapshot,
            s.buffer_before, s.buffer_after, s.slot_interval,
            c.id AS client_id, c.name AS client_name, c.email AS client_email
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN users c ON c.id = b.client_id
     WHERE b.provider_id = $1
       AND b.status = ANY($2)
       AND b.ends_at > $3
     ORDER BY b.starts_at ASC`,
    [providerId, ACTIVE_STATUSES, now]
  );

  if (upcoming.rows.length === 0) {
    return safely({ currentTimezone, timezone, changed: true, upcomingCount: 0 });
  }

  const availabilityByService = await loadAvailabilityForBookings(providerId, upcoming.rows);
  const conflicts = [];

  for (const booking of upcoming.rows) {
    const { rules, exceptions } = availabilityByService.get(booking.service_id);

    // A provider with no availability at all has nothing for the zone change to
    // move. Skipping is not strictly required — the "fits now" test below would
    // reject these anyway — but it says the reason out loud.
    if (rules.length === 0 && exceptions.length === 0) continue;

    const span = {
      duration: booking.duration_snapshot,
      buffer_before: booking.buffer_before,
      buffer_after: booking.buffer_after,
      slot_interval: booking.slot_interval,
    };

    const fitsNow = isWithinAvailability({
      rules,
      exceptions,
      timezone: currentTimezone,
      service: span,
      startsAt: booking.starts_at,
    });

    // Already outside the provider's hours before anyone touched the timezone,
    // so not this change's doing. See the module note above.
    if (!fitsNow) continue;

    const fitsAfter = isWithinAvailability({
      rules,
      exceptions,
      timezone,
      service: span,
      startsAt: booking.starts_at,
    });

    if (fitsAfter) continue;

    conflicts.push(describeConflict(booking, currentTimezone, timezone));
  }

  return {
    currentTimezone,
    timezone,
    changed: true,
    safe: conflicts.length === 0,
    upcomingCount: upcoming.rows.length,
    conflictCount: conflicts.length,
    conflicts,
  };
}

/** The shape returned by every early exit, so the three agree on every field. */
function safely({ currentTimezone, timezone, changed, upcomingCount }) {
  return {
    currentTimezone,
    timezone,
    changed,
    safe: true,
    upcomingCount,
    conflictCount: 0,
    conflicts: [],
  };
}

/**
 * Loads the effective availability for every service the given bookings touch.
 *
 * Keyed by service id and fetched once per *distinct* service rather than once
 * per booking: a provider with forty appointments across three services costs
 * three lookups, not forty. Each service has to resolve separately because a
 * service may carry its own hours or inherit the provider's — see
 * `availabilityResolver`.
 *
 * The exception window spans the bookings themselves with a day of padding, so a
 * provider with years of one-off blocks does not drag all of them into memory to
 * answer a question about next week. A day either side is enough: an exception
 * can only affect a booking whose local date it covers, and the padding absorbs
 * the case where the provider's local date differs from the UTC one.
 *
 * @param {number} providerId
 * @param {Array<{service_id:number, starts_at:Date, ends_at:Date}>} bookings
 *   Must be non-empty; the date window is derived from it.
 * @returns {Promise<Map<number, {rules: Array, exceptions: Array}>>}
 */
async function loadAvailabilityForBookings(providerId, bookings) {
  const starts = bookings.map((b) => new Date(b.starts_at).getTime());
  const ends = bookings.map((b) => new Date(b.ends_at).getTime());

  const fromDate = isoDate(new Date(Math.min(...starts) - 86_400_000));
  const toDate = isoDate(new Date(Math.max(...ends) + 86_400_000));

  const byService = new Map();

  for (const serviceId of new Set(bookings.map((b) => b.service_id))) {
    byService.set(
      serviceId,
      await getEffectiveAvailability({ providerId, serviceId, fromDate, toDate })
    );
  }

  return byService;
}

/**
 * Turns a stranded booking into something the provider can act on.
 *
 * Both readings of the same instant are included, because the decision in front
 * of the provider is about a clock face: "Mon 9 Jun, 9:00 AM becomes 4:00 AM" is
 * the sentence that makes the problem obvious, and neither half of it is enough
 * alone. `startsAt` stays the UTC instant so the UI can link straight to the
 * booking without re-deriving anything.
 */
function describeConflict(booking, currentTimezone, newTimezone) {
  const start = DateTime.fromJSDate(new Date(booking.starts_at), { zone: "utc" });
  const end = DateTime.fromJSDate(new Date(booking.ends_at), { zone: "utc" });
  const proposedTime = start.setZone(newTimezone).toFormat(TIME_FORMAT);

  return {
    bookingId: booking.id,
    status: booking.status,
    startsAt: start.toISO(),
    endsAt: end.toISO(),
    service: {
      id: booking.service_id,
      name: booking.service_name_snapshot,
      duration: booking.duration_snapshot,
    },
    client: {
      id: booking.client_id,
      name: booking.client_name,
      email: booking.client_email,
    },
    current: {
      timezone: currentTimezone,
      startsAt: start.setZone(currentTimezone).toFormat(DISPLAY_FORMAT),
      endsAt: end.setZone(currentTimezone).toFormat(TIME_FORMAT),
    },
    proposed: {
      timezone: newTimezone,
      startsAt: start.setZone(newTimezone).toFormat(DISPLAY_FORMAT),
      endsAt: end.setZone(newTimezone).toFormat(TIME_FORMAT),
    },
    reason: "OUTSIDE_AVAILABILITY",
    detail:
      "This appointment is inside your working hours in " +
      currentTimezone +
      ", but in " +
      newTimezone +
      " it falls at " +
      proposedTime +
      ", outside them.",
  };
}

/** Formats an instant as a UTC calendar date, for a ::date comparison. */
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

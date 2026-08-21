/**
 * Bookable-slot endpoint.
 *
 * This is a thin shell around `services/slotEngine.js`: it loads exactly the
 * rows the engine needs for the requested range, hands them over, and formats
 * the result in both the client's and the provider's timezone.
 *
 * The "must stay fast" requirement is met here, not in the engine. Two things do
 * the work:
 *
 *   - the range is capped (MAX_RANGE_DAYS), so a caller cannot ask for a year;
 *   - the bookings query filters on a range overlap, which is served by the GiST
 *     index the double-booking exclusion constraint already maintains. A
 *     provider with a thousand bookings across six months returns only the
 *     handful that touch the requested week.
 */
import { DateTime } from "luxon";
import { query } from "../config/dbConfig.js";
import { successResponse, errorResponse, ERROR_CODES } from "../responseController/responseHandler.js";
import { generateSlots, MAX_RANGE_DAYS } from "../services/slotEngine.js";
import { getEffectiveAvailability } from "../services/availabilityResolver.js";
import { TIME_FORMAT, ACTIVE_STATUSES } from "../services/bookingRules.js";
import { parseId } from "../middleware/validateParams.js";

/**
 * GET /api/providers/:providerId/slots — public.
 *
 * Query: serviceId (required), from & to (YYYY-MM-DD, the *client's* local
 * dates), timezone (IANA, defaults to the signed-in user's or UTC).
 *
 * `from`/`to` are read as calendar dates in the caller's timezone and are
 * inclusive of `to`. A client in Auckland asking for "2025-06-02 to 2025-06-02"
 * means their Monday, which is a different UTC span than a client in Los Angeles
 * asking the same thing — so the dates are resolved against the caller's zone
 * before anything else happens.
 *
 * ## `bookingId` — asking "where could *this* appointment move to?"
 *
 * Without it, this endpoint answers "where could a *new* appointment go?", and
 * that is the wrong question for a reschedule. Three things differ, and all
 * three used to make the picker disagree with `POST /bookings/:id/reschedule`:
 *
 *   1. **Duration.** A reschedule keeps the booking's `duration_snapshot`, not
 *      the service's current length (see `rescheduleBooking`). A provider who
 *      shortened a 60-minute service to 30 made this endpoint publish late-window
 *      starts — 16:30 on a day ending at 17:00 — that the write path then refused
 *      because the appointment is still 60 minutes long. Every one of those
 *      buttons was unbookable.
 *   2. **Its own span.** A booking occupies the calendar, so the plain query
 *      counted the appointment being moved as busy and hid every time overlapping
 *      it. Nudging a 60-minute 09:00 appointment to 09:30 was impossible from the
 *      UI, even though the write path accepts it — PostgreSQL never compares an
 *      updated row against its own previous version.
 *   3. **A retired service.** Retiring a service keeps its bookings ("N upcoming
 *      bookings will still go ahead"), and `rescheduleBooking` still moves them.
 *      The plain query requires `is_active`, so the picker 404'd and those
 *      bookings could not be moved at all.
 *
 * Only a party to the booking may pass it, and an unknown id, someone else's
 * booking and a booking on another service all answer 404 alike — booking ids
 * are not probeable here any more than they are on `/bookings/:id`.
 */
export const getAvailableSlots = async (req, res) => {
  try {
    // Mounted at /api/providers/:id/slots, so the path parameter is `id`.
    const providerId = req.params.id;
    const { serviceId, from, to, bookingId } = req.query;

    if (!serviceId) {
      return errorResponse(res, "serviceId is required", 400, ERROR_CODES.VALIDATION_FAILED);
    }

    // `serviceId` arrives from the query string, so it is arbitrary text until
    // proven otherwise. Passing "abc" straight into the integer comparison below
    // raises SQLSTATE 22P02 and would be reported as a 500 — the caller's
    // mistake blamed on the server. The path parameter is already guarded by
    // router.param; this is the query-string half of the same rule.
    if (parseId(serviceId) === null) {
      return errorResponse(res, "serviceId must be a positive whole number", 400, ERROR_CODES.VALIDATION_FAILED, [
        { field: "serviceId", message: "serviceId must be a positive whole number" },
      ]);
    }

    if (bookingId !== undefined && parseId(bookingId) === null) {
      return errorResponse(res, "bookingId must be a positive whole number", 400, ERROR_CODES.VALIDATION_FAILED, [
        { field: "bookingId", message: "bookingId must be a positive whole number" },
      ]);
    }

    // Resolved before the service is loaded, because whether a retired service
    // is allowed depends on the answer.
    let moving = null;
    if (bookingId !== undefined) {
      const resolved = await resolveBookingBeingMoved({
        bookingId,
        providerId,
        serviceId,
        userId: req.user?.userId,
      });

      if (resolved.error) {
        return errorResponse(res, resolved.error.message, resolved.error.status, resolved.error.code);
      }
      moving = resolved.booking;
    }

    const service = await query(
      // `u.currency` is selected for the response, not for the slot maths. It is
      // the provider's ISO 4217 code, and the booking page prices the service
      // from this payload — without it the client had no currency to render and
      // fell back to a default, so a London provider's £75 service was shown to
      // clients as ₹75 at the exact moment they were deciding to book it.
      //
      // `$3` relaxes the `is_active` requirement for a reschedule only. A
      // retired service is unbookable, but an appointment already on it is still
      // going ahead and still movable — see the note on `bookingId` above.
      `SELECT s.*, u.timezone AS provider_timezone, u.id AS provider_id,
              u.currency AS provider_currency
       FROM services s
       JOIN users u ON u.id = s.provider_id
       WHERE s.id = $1 AND s.provider_id = $2 AND (s.is_active OR $3) AND u.role = 'provider'`,
      [serviceId, providerId, Boolean(moving)]
    );

    if (service.rows.length === 0) {
      return errorResponse(res, "Service not found for this provider", 404, ERROR_CODES.NOT_FOUND);
    }

    // The service as the *write path* will read it. `rescheduleBooking` sizes the
    // moved appointment with the booking's snapshotted duration and the service's
    // current buffers and grid; generating slots any other way publishes times
    // that endpoint rejects. Everything else on the row is untouched.
    const row = moving
      ? { ...service.rows[0], duration: moving.duration_snapshot }
      : service.rows[0];
    const viewerTimezone = await resolveViewerTimezone(req.query.timezone, req.user?.userId);

    const rangeStart = DateTime.fromISO(String(from || ""), { zone: viewerTimezone }).startOf("day");
    // `to` is inclusive, so the exclusive end of the range is the start of the
    // following day. Using plus({ days: 1 }) rather than +24h keeps that correct
    // on a day the clocks move.
    const rangeEnd = DateTime.fromISO(String(to || from || ""), { zone: viewerTimezone })
      .startOf("day")
      .plus({ days: 1 });

    if (!rangeStart.isValid || !rangeEnd.isValid) {
      return errorResponse(
        res,
        "from and to must be dates in YYYY-MM-DD form",
        400,
        ERROR_CODES.VALIDATION_FAILED
      );
    }
    if (rangeEnd <= rangeStart) {
      return errorResponse(res, "`to` must not be before `from`", 400, ERROR_CODES.VALIDATION_FAILED);
    }
    if (rangeEnd.diff(rangeStart, "days").days > MAX_RANGE_DAYS) {
      return errorResponse(
        res,
        `Ask for at most ${MAX_RANGE_DAYS} days at a time`,
        400,
        ERROR_CODES.RANGE_TOO_WIDE
      );
    }

    const rangeStartDate = rangeStart.toJSDate();
    const rangeEndDate = rangeEnd.toJSDate();

    // The engine needs a little slack around the range: a booking or an
    // availability window can start just before it and reach into it.
    const lookbackStart = new Date(rangeStartDate.getTime() - 86_400_000);
    const lookaheadEnd = new Date(rangeEndDate.getTime() + 86_400_000);

    const [{ rules, exceptions }, busy] = await Promise.all([
      getEffectiveAvailability({
        providerId,
        serviceId: row.id,
        fromDate: isoDate(lookbackStart),
        toDate: isoDate(lookaheadEnd),
      }),
      // The && range-overlap operator is what makes this use the GiST index that
      // the bookings exclusion constraint already maintains, so this stays cheap
      // no matter how much history the provider has accumulated.
      //
      // `$4` drops the booking being moved out of its own busy list. It has to
      // go, and not merely for tidiness: PostgreSQL does not compare an updated
      // row against its own previous version, so the write path happily moves a
      // 60-minute appointment from 09:00 to 09:30 while leaving it here made the
      // picker hide every time that overlapped it. NULL for an ordinary read, so
      // the predicate collapses and the plan is unchanged.
      query(
        `SELECT blocked_from, blocked_to
         FROM bookings
         WHERE provider_id = $1
           AND status <> 'cancelled'
           AND ($4::int IS NULL OR id <> $4)
           AND tstzrange(blocked_from, blocked_to) && tstzrange($2, $3)`,
        [providerId, lookbackStart, lookaheadEnd, moving ? moving.id : null]
      ),
    ]);

    const slots = generateSlots({
      rules,
      exceptions,
      timezone: row.provider_timezone,
      service: row,
      rangeStart: rangeStartDate,
      rangeEnd: rangeEndDate,
      busy: busy.rows,
      now: new Date(),
    });

    // Slots are grouped by the *client's* local date because that is how the
    // picker renders them. Grouping by the provider's date would put a slot
    // under the wrong heading for anyone far enough east or west.
    const byDate = new Map();
    for (const slot of slots) {
      const local = DateTime.fromISO(slot.startsAt).setZone(viewerTimezone);
      const key = local.toFormat("yyyy-MM-dd");

      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        clientTime: local.toFormat(TIME_FORMAT),
        providerTime: DateTime.fromISO(slot.startsAt)
          .setZone(row.provider_timezone)
          .toFormat(TIME_FORMAT),
      });
    }

    return successResponse(res, "Slots fetched", {
      service: {
        id: row.id,
        name: row.service_name,
        duration: row.duration,
        price: row.price,
        // The code alone, never a symbol — the client turns it into one with
        // Intl in the reader's own locale. Sent alongside every price so no
        // consumer has to guess, or default to the wrong one.
        currency: row.provider_currency,
        bufferBefore: row.buffer_before,
        bufferAfter: row.buffer_after,
      },
      clientTimezone: viewerTimezone,
      providerTimezone: row.provider_timezone,
      from: rangeStart.toFormat("yyyy-MM-dd"),
      to: rangeEnd.minus({ days: 1 }).toFormat("yyyy-MM-dd"),
      totalSlots: slots.length,
      days: [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, daySlots]) => ({ date, slots: daySlots })),
    });
  } catch (err) {
    console.error("getAvailableSlots error:", err.message);
    return errorResponse(res, "Could not fetch slots", 500);
  }
};

/**
 * Loads the booking a `?bookingId=` reschedule query refers to, or explains why not.
 *
 * Authorization is the same shape the booking endpoints use: only the client or
 * the provider on the booking may ask, and every failure that would reveal
 * whether an id exists — no such booking, someone else's booking, a booking on a
 * different provider or service — answers 404 with the same wording. The one
 * distinguishable refusal is a booking that is no longer active, which the caller
 * already knows about because they are looking at it.
 *
 * @param {object} args
 * @param {string|number} args.bookingId Already checked to be a positive integer.
 * @param {string|number} args.providerId From the path.
 * @param {string|number} args.serviceId From the query string.
 * @param {number|undefined} args.userId Signed-in user, if any.
 * @returns {Promise<{booking?: object, error?: {message: string, status: number, code: string}}>}
 */
async function resolveBookingBeingMoved({ bookingId, providerId, serviceId, userId }) {
  const notFound = {
    error: { message: "Booking not found", status: 404, code: ERROR_CODES.NOT_FOUND },
  };

  // A guest cannot be a party to a booking, so there is nothing to authorize
  // against — answered as "not found" rather than 401 so the two cases are
  // indistinguishable from outside.
  if (!userId) return notFound;

  const result = await query(
    `SELECT id, provider_id, client_id, service_id, status, duration_snapshot
     FROM bookings WHERE id = $1`,
    [bookingId]
  );

  if (result.rows.length === 0) return notFound;
  const booking = result.rows[0];

  const isParty =
    Number(booking.client_id) === Number(userId) || Number(booking.provider_id) === Number(userId);

  if (!isParty) return notFound;

  // The booking has to be the one this request is actually about. Mismatched ids
  // are a client bug, but answering them with slots sized from an unrelated
  // booking's snapshot would be a silent wrong answer.
  if (
    Number(booking.provider_id) !== Number(providerId) ||
    Number(booking.service_id) !== Number(serviceId)
  ) {
    return notFound;
  }

  if (!ACTIVE_STATUSES.includes(booking.status)) {
    return {
      error: {
        message: `This booking is already ${booking.status.replace("_", "-")}.`,
        status: 409,
        code: ERROR_CODES.BOOKING_NOT_ACTIVE,
      },
    };
  }

  return { booking };
}

/**
 * Picks the timezone to render slots in.
 *
 * Preference order: **the signed-in user's saved timezone first, unconditionally
 * — never overridden by anything else.** A `?timezone=` query parameter is only
 * ever consulted for a guest, who has no account row to read a preference from.
 * A resolvable-but-wrong zone falls back to UTC rather than 400-ing.
 *
 * This is not merely a default; it is a hard rule for every calendar-like view
 * in the app: what a logged-in user sees is always driven by the timezone
 * stored on their own `users` row, and by nothing else — not a query string,
 * not the browser's guess, not anything derived from the service or the
 * provider being viewed. The saved zone is read fresh from the database on
 * every call rather than taken from the JWT, because a user can change it
 * after the token was issued, and the calendar must reflect the current value,
 * not the one in effect when they logged in.
 *
 * Letting a query parameter outrank the stored value would mean the same
 * signed-in person could see two different timezones on two different screens
 * depending on what a URL happened to carry — exactly the inconsistency this
 * whole project exists to rule out.
 *
 * @param {string|undefined} requested The ?timezone= query parameter. Only
 *   consulted when there is no signed-in user.
 * @param {number|undefined} userId Signed-in user id, if any.
 * @returns {Promise<string>} A zone name Luxon can resolve.
 */
async function resolveViewerTimezone(requested, userId) {
  if (userId) {
    const user = await query("SELECT timezone FROM users WHERE id = $1", [userId]);
    const saved = user.rows[0]?.timezone;
    if (isResolvableZone(saved)) return String(saved);
    // A signed-in user with no resolvable saved zone (a corrupted or missing
    // value) still does not fall through to a client-supplied override —
    // that would reopen the exact inconsistency this function exists to
    // prevent. UTC is the honest fallback, not a guess from the request.
    return "UTC";
  }

  if (isResolvableZone(requested)) return String(requested);

  return "UTC";
}

function isResolvableZone(zone) {
  return Boolean(zone) && DateTime.local().setZone(String(zone)).isValid;
}

/** Formats a Date as a UTC calendar date for a ::date comparison. */
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

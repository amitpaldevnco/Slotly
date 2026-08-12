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
import { TIME_FORMAT } from "../services/bookingRules.js";

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
 */
export const getAvailableSlots = async (req, res) => {
  try {
    // Mounted at /api/providers/:id/slots, so the path parameter is `id`.
    const providerId = req.params.id;
    const { serviceId, from, to } = req.query;

    if (!serviceId) {
      return errorResponse(res, "serviceId is required", 400, ERROR_CODES.VALIDATION_FAILED);
    }

    const service = await query(
      `SELECT s.*, u.timezone AS provider_timezone, u.id AS provider_id
       FROM services s
       JOIN users u ON u.id = s.provider_id
       WHERE s.id = $1 AND s.provider_id = $2 AND s.is_active AND u.role = 'provider'`,
      [serviceId, providerId]
    );

    if (service.rows.length === 0) {
      return errorResponse(res, "Service not found for this provider", 404, ERROR_CODES.NOT_FOUND);
    }

    const row = service.rows[0];
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
      query(
        `SELECT blocked_from, blocked_to
         FROM bookings
         WHERE provider_id = $1
           AND status <> 'cancelled'
           AND tstzrange(blocked_from, blocked_to) && tstzrange($2, $3)`,
        [providerId, lookbackStart, lookaheadEnd]
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

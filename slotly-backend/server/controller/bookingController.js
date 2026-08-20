/**
 * Booking endpoints: create, list, read, cancel, reschedule, and status changes.
 *
 * ## Where the no-double-booking guarantee lives
 *
 * In PostgreSQL, in the `bookings_no_overlap_per_provider` exclusion constraint
 * — nowhere else. There is deliberately no "check if the slot is free, then
 * insert" sequence anywhere in this file, because that pattern has a window
 * between the read and the write in which another transaction can insert the
 * same slot, and no amount of application-level care closes it.
 *
 * `createBooking` does check availability first, but that check answers a
 * different question — "is this a time the provider is even open for?" — and its
 * result is never relied on for exclusivity. The INSERT is what decides. If two
 * requests reach it at the same instant for overlapping spans, PostgreSQL
 * serialises them on the GiST index entry: one commits, the other raises
 * SQLSTATE 23P01, which becomes 409 + code SLOT_TAKEN. Proving it holds is a
 * matter of firing two concurrent inserts and asserting exactly one survives,
 * which `tests/booking.concurrency.test.js` does against a real database.
 */
import { query, transaction } from "../config/dbConfig.js";
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
  ERROR_CODES,
} from "../responseController/responseHandler.js";
import {
  computeBookingSpan,
  isOfferedSlotStart,
  hasInstantPassed,
  earliestBookableInstant,
} from "../services/slotEngine.js";
import { getEffectiveAvailability } from "../services/availabilityResolver.js";
import { parseId } from "../middleware/validateParams.js";
import {
  evaluateClientCancellation,
  evaluateClientReschedule,
  evaluateProviderTransition,
  describeInstant,
  ACTIVE_STATUSES,
  OUTCOME_GRACE_MINUTES,
} from "../services/bookingRules.js";

/** SQLSTATE raised by PostgreSQL when an exclusion constraint rejects a row. */
const EXCLUSION_VIOLATION = "23P01";

/**
 * Shapes a booking row for the API, rendering every instant in both parties'
 * timezones so no client ever has to do zone arithmetic itself.
 *
 * ## Which timezone a booking is *displayed* in
 *
 * The **current** one on each party's user row — never the snapshot taken when
 * the booking was made.
 *
 * A booking is an instant, not a wall-clock reading. `starts_at` is one fixed
 * point on the universal timeline and never moves; what changes is the label a
 * zone puts on it. So someone who books at 09:00 in Asia/Kolkata and then
 * travels, updating their profile to America/Mazatlan, must see that same
 * appointment expressed in Mazatlan time from then on. The appointment did not
 * move — only the reader did.
 *
 * Rendering from `client_timezone_snapshot` instead is what this used to do, and
 * it froze the display at whatever zone the user happened to have on the day
 * they booked. The clock face stayed on Kolkata forever even after they had
 * changed their profile, which reads as "the app has the wrong time" rather than
 * as a deliberate historical record.
 *
 * The snapshots are still stored and still returned — as `timezoneAtBooking` —
 * because "what zone was this booked under?" is a genuine audit question. They
 * are just not the answer to "what time is this appointment for me now?".
 *
 * Nothing here writes to the database; changing a profile timezone never
 * rewrites `starts_at`.
 *
 * @param {object} row A row from BOOKING_SELECT, which joins both users so the
 *   live `client_timezone_now` / `provider_timezone_now` are available. The
 *   snapshot columns are used only as a fallback, for the theoretical case of a
 *   row reaching here without the join.
 */
function serialiseBooking(row, { viewerRole } = {}) {
  const clientZone = row.client_timezone_now || row.client_timezone_snapshot;
  const providerZone = row.provider_timezone_now || row.provider_timezone_snapshot;

  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    time: describeInstant(row.starts_at, clientZone, providerZone),
    endTime: describeInstant(row.ends_at, clientZone, providerZone),
    service: {
      id: row.service_id,
      name: row.service_name_snapshot,
      price: row.price_snapshot,
      // Read live from the provider rather than snapshotted alongside
      // `price_snapshot`. A provider setting this correctly after already taking
      // bookings is fixing a label, not repricing anything: the amount charged
      // never changed, only the currency it was always in. Snapshotting it would
      // freeze the wrong answer onto every historic booking.
      currency: row.provider_currency ?? "INR",
      duration: row.duration_snapshot,
      coverImage: row.cover_image ?? null,
      isActive: row.service_is_active ?? null,
    },
    client: {
      id: row.client_id,
      name: row.client_name,
      email: row.client_email,
      phoneNumber: row.client_phone_number,
      avatarUrl: row.client_avatar,
      // Current — what the appointment should be read in today.
      timezone: clientZone,
      // Historical — the zone in force when the booking was made. Present so the
      // UI can note "originally booked while using …" when the two differ.
      timezoneAtBooking: row.client_timezone_snapshot,
    },
    provider: {
      id: row.provider_id,
      name: row.provider_name,
      businessName: row.provider_business_name,
      avatarUrl: row.provider_avatar,
      timezone: providerZone,
      timezoneAtBooking: row.provider_timezone_snapshot,
    },
    clientNote: row.client_note,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at,
    cancellationCutoffHours: row.cancellation_cutoff_hours_snapshot,
    // Precomputed so the UI never has to re-implement the cutoff rule to decide
    // whether to show a Cancel or Reschedule button. The server still re-checks
    // on the call — these are affordances, not the enforcement.
    canClientCancel:
      viewerRole === "client" ? evaluateClientCancellation(row, new Date()).allowed : undefined,
    canClientReschedule:
      viewerRole === "client" ? evaluateClientReschedule(row, new Date()).allowed : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Flips any booking that is still 'booked'/'rescheduled' over to 'completed'
 * once its outcome window has closed — that is, once it ended more than
 * `OUTCOME_GRACE_MINUTES` ago. The provider owns the outcome inside that window
 * and can still record completed, no-show or cancelled; after it, a booking
 * nobody recorded is taken to have happened.
 *
 * The grace period is the whole point of this function's timing. Settling on
 * `ends_at` exactly meant any read — including the dashboard list the provider
 * opens in order to record the outcome — closed the window before they could
 * act, which made 'no_show' unreachable. See OUTCOME_GRACE_MINUTES.
 *
 * Runs lazily on read, scoped to whichever rows a given request needs, and logs
 * the transition as a 'system' actor in the audit trail.
 */
async function autoCompleteExpired(whereClause, params) {
  // Interval arithmetic in SQL rather than a JS cutoff instant, so the
  // comparison uses the database's clock — the same one NOW() and every
  // timestamp default already use.
  //
  // The grace is interpolated rather than bound because callers supply their own
  // `$2`, `$3`… in `whereClause`, and inserting a placeholder here would silently
  // renumber every one of them. Number() on our own module constant makes the
  // interpolation inert: it is never request-derived, and a non-numeric value
  // could not survive the coercion.
  const graceMinutes = Number(OUTCOME_GRACE_MINUTES);
  const expired = await query(
    `SELECT id, status FROM bookings
     WHERE status = ANY($1)
       AND ends_at <= NOW() - INTERVAL '${graceMinutes} minutes'
       AND ${whereClause}`,
    [ACTIVE_STATUSES, ...params]
  );
  if (expired.rows.length === 0) return;

  const ids = expired.rows.map((r) => r.id);
  await transaction(async (tx) => {
    await tx.query(`UPDATE bookings SET status = 'completed', updated_at = NOW() WHERE id = ANY($1)`, [ids]);
    for (const row of expired.rows) {
      await recordEvent(tx, {
        bookingId: row.id,
        fromStatus: row.status,
        toStatus: "completed",
        actorId: null,
        actorRole: "system",
        reason: `Automatically completed — ${OUTCOME_GRACE_MINUTES} minutes passed after the appointment ended without the provider recording an outcome.`,
      });
    }
  });
}

/**
 * The SELECT every read in this file shares, so the shapes never drift apart.
 *
 * `client_timezone_now` / `provider_timezone_now` are read live from the joined
 * user rows on every request, which is what makes a booking follow its owner
 * when they change their profile timezone. The `*_snapshot` columns on `bookings`
 * still come through via `b.*`, but they are history, not the display zone —
 * see serialiseBooking().
 */
const BOOKING_SELECT = `
  SELECT b.*,
         c.name AS client_name, c.email AS client_email, c.avatar_url AS client_avatar, c.phone_number AS client_phone_number,
         c.timezone AS client_timezone_now,
         p.name AS provider_name, p.business_name AS provider_business_name,
         p.avatar_url AS provider_avatar,
         p.timezone AS provider_timezone_now,
         p.currency AS provider_currency,
         s.cover_image, s.is_active AS service_is_active
  FROM bookings b
  JOIN users c ON c.id = b.client_id
  JOIN users p ON p.id = b.provider_id
  JOIN services s ON s.id = b.service_id
`;

/**
 * Appends a row to the audit trail.
 *
 * Always called with the same transaction handle as the change it describes, so
 * a booking can never move status without the timeline recording it.
 *
 * @param {{query: Function}} tx Transaction handle from `transaction()`.
 */
async function recordEvent(tx, { bookingId, fromStatus, toStatus, fromStartsAt, toStartsAt, actorId, actorRole, reason }) {
  await tx.query(
    `INSERT INTO booking_events
       (booking_id, from_status, to_status, from_starts_at, to_starts_at, actor_id, actor_role, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [bookingId, fromStatus || null, toStatus, fromStartsAt || null, toStartsAt || null, actorId, actorRole, reason || null]
  );
}

/**
 * POST /api/bookings — client only.
 *
 * Body: { serviceId, startsAt (ISO-8601 instant), note? }
 *
 * `startsAt` is an absolute instant, not a wall-clock string. The client sends
 * exactly the `startsAt` value it received from the slots endpoint, so the two
 * sides never have to agree on a timezone to agree on a moment.
 */
export const createBooking = async (req, res) => {
  try {
    const { serviceId, startsAt, note } = req.body;
    const errors = [];

    // Not just "is it present": an id from a JSON body is arbitrary text, and
    // "abc" reaching the integer comparison below raises SQLSTATE 22P02, which
    // would surface as a 500 rather than the 400 this plainly is.
    if (!serviceId) {
      errors.push({ field: "serviceId", message: "Service is required" });
    } else if (parseId(serviceId) === null) {
      errors.push({ field: "serviceId", message: "serviceId must be a positive whole number" });
    }

    // The type check is not redundant with the NaN check below it. `new Date()`
    // coerces its argument first, and a single-element array stringifies to its
    // one member — so `["2026-08-26T08:30:00Z"]` parsed as a valid instant and
    // was accepted. Requiring a string keeps the accepted shape the same as the
    // documented one instead of whatever JavaScript can be talked into.
    const start = typeof startsAt === "string" ? new Date(startsAt) : new Date(NaN);
    if (typeof startsAt !== "string" || !startsAt || Number.isNaN(start.getTime())) {
      errors.push({ field: "startsAt", message: "startsAt must be an ISO-8601 instant" });
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      errors.push({ field: "note", message: "Note must be text" });
    }
    if (typeof note === "string" && note.length > 500) {
      errors.push({ field: "note", message: "Note must be 500 characters or less" });
    }
    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    // A client can only book for themselves. There is no client_id in the body
    // by design — it comes from the session, so "acting for another user" is not
    // expressible in the request at all.
    const client = await query(
      "SELECT id, role, timezone FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (client.rows.length === 0) {
      return errorResponse(res, "User not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (client.rows[0].role !== "client") {
      return errorResponse(
        res,
        "Only client accounts can book appointments",
        403,
        ERROR_CODES.FORBIDDEN
      );
    }

    const service = await query(
      `SELECT s.*, u.timezone AS provider_timezone, u.cancellation_cutoff_hours, u.id AS provider_id
       FROM services s
       JOIN users u ON u.id = s.provider_id
       WHERE s.id = $1 AND s.is_active AND u.role = 'provider'`,
      [serviceId]
    );
    if (service.rows.length === 0) {
      return errorResponse(res, "Service not found or no longer offered", 404, ERROR_CODES.NOT_FOUND);
    }
    const svc = service.rows[0];

    // The only time-based floor on a booking: has this instant already gone?
    //
    // Slotly books in real time. There is no minimum notice — no "a day ahead",
    // no rolling 24-hour window — so a client can take a slot later today, or
    // one inside the next hour, exactly as the slot list offers it. What remains
    // is that the appointment must still be ahead of the provider.
    //
    // The provider owns the calendar, so "has this already happened?" is
    // always answered in the provider's timezone, never the caller's — a
    // client 16 hours ahead of the provider can see a slot as tomorrow while
    // it is already this afternoon, and past, for the provider.
    //
    // Checked here and not only in the slot list, because a client could
    // otherwise POST a time the list would never have shown them.
    if (hasInstantPassed(start, svc.provider_timezone)) {
      return errorResponse(
        res,
        "That appointment time has already passed",
        400,
        ERROR_CODES.SLOT_UNAVAILABLE
      );
    }

    // The second of the two gates the slot list applies, mirrored here so the
    // write path cannot be talked past a rule the read path enforced.
    //
    // At the shipped MIN_BOOKING_LEAD_MINUTES of zero this never rejects
    // anything the check above accepted — the two questions coincide. It is
    // here for the day that constant stops being zero: without it, raising the
    // lead time would quietly withhold slots from the list while still
    // accepting them by direct POST, which is the exact class of hole the
    // "both paths, same gates" rule exists to close.
    if (start.getTime() < earliestBookableInstant(new Date(), svc.provider_timezone).toMillis()) {
      return errorResponse(
        res,
        "That appointment time is too soon to book",
        400,
        ERROR_CODES.SLOT_UNAVAILABLE
      );
    }

    // Is this a start the provider actually offered? This rejects hand-crafted
    // requests for 03:00 on a Sunday *and* requests for a time that fits inside
    // the provider's hours but was never on the menu — 09:17 when the grid
    // publishes 09:00 and 10:00. The second case matters because an off-grid
    // appointment straddles two grid positions and would consume two bookable
    // slots instead of one; see isOfferedSlotStart().
    //
    // It says nothing about whether the slot is still free — that is the
    // exclusion constraint's job, below.
    const { rules, exceptions } = await getEffectiveAvailability({
      providerId: svc.provider_id,
      serviceId: svc.id,
    });

    const offered = isOfferedSlotStart({
      rules,
      exceptions,
      timezone: svc.provider_timezone,
      service: svc,
      startsAt: start,
    });

    if (!offered) {
      return errorResponse(
        res,
        "That time is not one of the provider's available appointment times",
        409,
        ERROR_CODES.SLOT_UNAVAILABLE
      );
    }


    const span = computeBookingSpan(start, svc);

    const created = await transaction(async (tx) => {
      // The single write that decides the race. No SELECT precedes it.
      const inserted = await tx.query(
        `INSERT INTO bookings (
           provider_id, client_id, service_id,
           starts_at, ends_at, blocked_from, blocked_to,
           status,
           service_name_snapshot, price_snapshot, duration_snapshot,
           client_timezone_snapshot, provider_timezone_snapshot,
           cancellation_cutoff_hours_snapshot, client_note
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'booked',$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          svc.provider_id,
          req.user.userId,
          svc.id,
          span.startsAt,
          span.endsAt,
          span.blockedFrom,
          span.blockedTo,
          svc.service_name,
          svc.price,
          svc.duration,
          client.rows[0].timezone,
          svc.provider_timezone,
          svc.cancellation_cutoff_hours,
          note || null,
        ]
      );

      const bookingId = inserted.rows[0].id;

      await recordEvent(tx, {
        bookingId,
        fromStatus: null,
        toStatus: "booked",
        toStartsAt: span.startsAt,
        actorId: req.user.userId,
        actorRole: "client",
        reason: null,
      });

      const full = await tx.query(`${BOOKING_SELECT} WHERE b.id = $1`, [bookingId]);
      return full.rows[0];
    });

    return successResponse(
      res,
      "Booking confirmed",
      serialiseBooking(created, { viewerRole: "client" }),
      201
    );
  } catch (err) {
    // The lost race. This is the specific, distinguishable error the brief asks
    // for: a 409 with its own code, never a generic 500.
    if (err.code === EXCLUSION_VIOLATION) {
      return errorResponse(
        res,
        "Sorry — someone just booked that slot. Please pick another time.",
        409,
        ERROR_CODES.SLOT_TAKEN
      );
    }
    console.error("createBooking error:", err.message);
    return errorResponse(res, "Could not create booking", 500);
  }
};

/**
 * GET /api/bookings/summary — provider only.
 *
 * The headline numbers for the dashboard: lifetime earnings and a few booking
 * counts. Computed in SQL rather than by summing a fetched list, so the figures
 * stay correct no matter how much history the provider has — `listBookings`
 * caps at 500 rows, which is fine for a page of cards but wrong for a total.
 */
export const getBookingSummary = async (req, res) => {
  try {
    const user = await query("SELECT role FROM users WHERE id = $1", [req.user.userId]);
    if (user.rows.length === 0) {
      return errorResponse(res, "User not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (user.rows[0].role !== "provider") {
      return errorResponse(res, "Only providers have a booking summary", 403, ERROR_CODES.FORBIDDEN);
    }

    await autoCompleteExpired("provider_id = $2", [req.user.userId]);

    // Earnings count only completed appointments — a booked-but-not-yet-happened
    // appointment has not been rendered, and a cancelled one was never paid for.
    const result = await query(
      `SELECT
         COALESCE(SUM(price_snapshot) FILTER (WHERE status = 'completed'), 0) AS total_earnings,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_bookings,
         COUNT(*) FILTER (WHERE status = ANY($2) AND starts_at >= NOW()) AS upcoming_bookings,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_bookings,
         COUNT(*) AS total_bookings
       FROM bookings
       WHERE provider_id = $1`,
      [req.user.userId, ACTIVE_STATUSES]
    );

    const row = result.rows[0];
    return successResponse(res, "Summary fetched", {
      totalEarnings: Number(row.total_earnings),
      completedBookings: Number(row.completed_bookings),
      upcomingBookings: Number(row.upcoming_bookings),
      cancelledBookings: Number(row.cancelled_bookings),
      totalBookings: Number(row.total_bookings),
    });
  } catch (err) {
    console.error("getBookingSummary error:", err.message);
    return errorResponse(res, "Could not fetch summary", 500);
  }
};

/**
 * GET /api/bookings — any signed-in user.
 *
 * Query: scope (upcoming|past|all), status, serviceId, from, to.
 *
 * Role-aware rather than role-specific: a client sees the bookings they made, a
 * provider sees the bookings on their calendar. The filter is applied in SQL, so
 * there is no request shape that returns someone else's bookings.
 */
export const listBookings = async (req, res) => {
  try {
    const user = await query("SELECT id, role FROM users WHERE id = $1", [req.user.userId]);
    if (user.rows.length === 0) {
      return errorResponse(res, "User not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const role = user.rows[0].role;

    await autoCompleteExpired(
      role === "provider" ? "provider_id = $2" : "client_id = $2",
      [req.user.userId]
    );

    const conditions = [role === "provider" ? "b.provider_id = $1" : "b.client_id = $1"];
    const params = [req.user.userId];

    const { scope = "all", status, serviceId, from, to } = req.query;

    if (scope === "upcoming") {
      // "Upcoming" means still going to happen *and* still live — a cancelled
      // appointment next Tuesday belongs in history, not on the agenda.
      conditions.push(`b.starts_at >= NOW() AND b.status = ANY($${params.length + 1})`);
      params.push(ACTIVE_STATUSES);
    } else if (scope === "past") {
      conditions.push(`(b.starts_at < NOW() OR b.status NOT IN ('booked','rescheduled'))`);
    }

    if (status) {
      const wanted = String(status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (wanted.length > 0) {
        conditions.push(`b.status = ANY($${params.length + 1})`);
        params.push(wanted);
      }
    }

    if (serviceId) {
      const filterServiceId = parseId(serviceId);
      if (filterServiceId === null) {
        return errorResponse(res, "`serviceId` must be a positive whole number", 400, ERROR_CODES.VALIDATION_FAILED);
      }
      conditions.push(`b.service_id = $${params.length + 1}`);
      params.push(filterServiceId);
    }

    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        return errorResponse(res, "`from` must be a valid date", 400, ERROR_CODES.VALIDATION_FAILED);
      }
      conditions.push(`b.starts_at >= $${params.length + 1}`);
      params.push(fromDate);
    }

    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) {
        return errorResponse(res, "`to` must be a valid date", 400, ERROR_CODES.VALIDATION_FAILED);
      }
      conditions.push(`b.starts_at < $${params.length + 1}`);
      params.push(toDate);
    }

    // Upcoming reads best oldest-first (what is next?); history reads best
    // newest-first (what happened most recently?).
    const order = scope === "upcoming" ? "ASC" : "DESC";

    const result = await query(
      `${BOOKING_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY b.starts_at ${order} LIMIT 500`,
      params
    );

    return successResponse(res, "Bookings fetched", {
      role,
      count: result.rows.length,
      bookings: result.rows.map((row) => serialiseBooking(row, { viewerRole: role })),
    });
  } catch (err) {
    console.error("listBookings error:", err.message);
    return errorResponse(res, "Could not fetch bookings", 500);
  }
};

/**
 * GET /api/bookings/:id — the two people involved only.
 *
 * Returns the booking plus its full event timeline: how it moved between
 * statuses, when, and who made each change.
 */
export const getBooking = async (req, res) => {
  try {
    await autoCompleteExpired("id = $2", [req.params.id]);

    const result = await query(`${BOOKING_SELECT} WHERE b.id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const booking = result.rows[0];
    const viewerRole = viewerRoleFor(booking, req.user.userId);

    if (!viewerRole) {
      // 404 rather than 403: confirming a booking exists to someone unrelated to
      // it leaks that the provider had an appointment at that id.
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const events = await query(
      `SELECT e.*, u.name AS actor_name
       FROM booking_events e
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.booking_id = $1
       ORDER BY e.created_at ASC, e.id ASC`,
      [req.params.id]
    );

    return successResponse(res, "Booking fetched", {
      ...serialiseBooking(booking, { viewerRole }),
      viewerRole,
      timeline: events.rows.map((e) => ({
        id: e.id,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        fromStartsAt: e.from_starts_at,
        toStartsAt: e.to_starts_at,
        actor: { id: e.actor_id, name: e.actor_name, role: e.actor_role},
        reason: e.reason,
        at: e.created_at,
        // History timestamps follow the same rule as the appointment itself:
        // `created_at` is an instant, so it is rendered in whatever zone each
        // party is in *now*, not the one they were in when the event happened.
        // The page promises "every change to this booking, in your timezone" —
        // using the snapshot here would quietly break that promise for anyone
        // who has since moved.
        atLocal: describeInstant(
          e.created_at,
          booking.client_timezone_now,
          booking.provider_timezone_now
        ),
      })),
    });
  } catch (err) {
    console.error("getBooking error:", err.message);
    return errorResponse(res, "Could not fetch booking", 500);
  }
};

/**
 * POST /api/bookings/:id/cancel — either party.
 *
 * A client is bound by the provider's cutoff. A provider can cancel at any time
 * but must give a reason, which is stored on the booking and in the timeline so
 * the client can see why.
 *
 * The row is kept with status 'cancelled' rather than deleted: the client needs
 * to see it in their history, and the partial exclusion constraint already
 * excludes cancelled rows, so the slot returns to the pool automatically.
 */
export const cancelBooking = async (req, res) => {
  try {
    const { reason } = req.body;

    const existing = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const booking = existing.rows[0];
    const viewerRole = viewerRoleFor(booking, req.user.userId);
    if (!viewerRole) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (viewerRole === "client") {
      const verdict = evaluateClientCancellation(booking, new Date());
      if (!verdict.allowed) {
        return errorResponse(res, verdict.reason, 409, verdict.code, {
          deadline: verdict.deadline,
          cutoffHours: booking.cancellation_cutoff_hours_snapshot,
        });
      }
    } else {
      const verdict = evaluateProviderTransition(booking, "cancelled", new Date());
      if (!verdict.allowed) {
        return errorResponse(res, verdict.reason, 409, verdict.code);
      }
      if (!reason || !String(reason).trim()) {
        return validationErrorResponse(res, "Please fix the errors below", [
          { field: "reason", message: "Tell the client why you are cancelling" },
        ]);
      }
    }

    if (typeof reason === "string" && reason.length > 500) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "reason", message: "Reason must be 500 characters or less" },
      ]);
    }

    const updated = await transaction(async (tx) => {
      // `AND status = ANY(...)` in the UPDATE, not a prior read: if two cancels
      // arrive together, the second matches no rows instead of double-writing
      // the timeline.
      const result = await tx.query(
        `UPDATE bookings
         SET status = 'cancelled', cancellation_reason = $1, cancelled_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND status = ANY($3)
         RETURNING *`,
        [reason ? String(reason).trim() : null, req.params.id, ACTIVE_STATUSES]
      );

      if (result.rows.length === 0) return null;

      await recordEvent(tx, {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "cancelled",
        actorId: req.user.userId,
        actorRole: viewerRole,
        reason: reason ? String(reason).trim() : null,
      });

      const full = await tx.query(`${BOOKING_SELECT} WHERE b.id = $1`, [booking.id]);
      return full.rows[0];
    });

    if (!updated) {
      return errorResponse(res, "This booking is no longer active", 409, ERROR_CODES.BOOKING_NOT_ACTIVE);
    }

    return successResponse(res, "Booking cancelled", serialiseBooking(updated, { viewerRole }));
  } catch (err) {
    console.error("cancelBooking error:", err.message);
    return errorResponse(res, "Could not cancel booking", 500);
  }
};

/**
 * POST /api/bookings/:id/reschedule — either party.
 *
 * Body: { startsAt, reason }
 *
 * Moves an existing booking to a new instant. The UPDATE is subject to the same
 * exclusion constraint as an INSERT, so moving a booking onto an occupied slot
 * loses the same race, the same way, with the same 409 SLOT_TAKEN.
 *
 * The booking's own row is excluded from the conflict by definition — it is the
 * row being updated, so its old span disappears in the same statement.
 *
 * ## Who may move an appointment, and on what terms
 *
 * Both parties, on deliberately different terms:
 *
 *   - **The provider** owns the calendar, so they may move any booking on it at
 *     any time, and `reason` is mandatory — the client is being told their
 *     appointment changed without asking for it, and deserves to know why.
 *   - **The client** may move their own booking up to the same deadline that
 *     governs cancelling it, and `reason` is optional. Without this a client
 *     wanting a different time had to cancel and rebook, which released their
 *     slot to the pool — so they could lose it to someone else between the two
 *     requests — and split one appointment's history across two unrelated rows.
 *     See `evaluateClientReschedule`.
 *
 * Authorization is resolved before the body is validated, so a stranger poking
 * at someone else's booking gets "not found" rather than a field-level critique
 * of a request they were never entitled to make.
 */
export const rescheduleBooking = async (req, res) => {
  try {
    // `provider_timezone_now` is joined in because availability is interpreted in
    // the provider's *current* zone — a weekly "Mondays 09:00" rule means 09:00
    // wherever the provider is today. The slot list already works that way, so
    // validating a reschedule against the booking's snapshot instead would make
    // the two disagree the moment a provider moved city: the picker would offer
    // times the write path then rejected as outside availability.
    const existing = await query(
      `SELECT b.*, s.duration, s.buffer_before, s.buffer_after, s.slot_interval,
              p.timezone AS provider_timezone_now
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN users p ON p.id = b.provider_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const booking = existing.rows[0];

    // Neither party — indistinguishable from "no such booking", on purpose, so
    // booking ids cannot be probed for existence.
    const viewerRole = viewerRoleFor(booking, req.user.userId);
    if (!viewerRole) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (viewerRole === "client") {
      const verdict = evaluateClientReschedule(booking, new Date());
      if (!verdict.allowed) {
        return errorResponse(res, verdict.reason, 409, verdict.code, {
          deadline: verdict.deadline,
          cutoffHours: booking.cancellation_cutoff_hours_snapshot,
        });
      }
    } else if (!ACTIVE_STATUSES.includes(booking.status)) {
      return errorResponse(
        res,
        `This booking is already ${booking.status.replace("_", "-")}.`,
        409,
        ERROR_CODES.BOOKING_NOT_ACTIVE
      );
    }

    const { startsAt, reason } = req.body;
    const errors = [];

    const start = new Date(startsAt);
    if (!startsAt || Number.isNaN(start.getTime())) {
      errors.push({ field: "startsAt", message: "startsAt must be an ISO-8601 instant" });
    }
    // Mandatory from the provider, optional from the client: see the note above.
    if (viewerRole === "provider" && (!reason || !String(reason).trim())) {
      errors.push({ field: "reason", message: "Tell the client why you are moving the appointment" });
    }
    if (typeof reason === "string" && reason.length > 500) {
      errors.push({ field: "reason", message: "Reason must be 500 characters or less" });
    }
    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }
    if (hasInstantPassed(start, booking.provider_timezone_now)) {
      return errorResponse(res, "Pick a time in the future", 400, ERROR_CODES.SLOT_UNAVAILABLE);
    }

    // "Not in the past" is the only time-based floor here, checked above — the
    // same one the create path applies now that Slotly books in real time. A
    // provider moving an appointment onto later this afternoon is ordinary
    // schedule management, and so is a client booking that same slot directly.

    // Keep the booking's own snapshotted duration rather than the service's
    // current one: rescheduling should move an appointment, not silently resize
    // it because the provider edited the service in the meantime.
    const spanService = {
      duration: booking.duration_snapshot,
      buffer_before: booking.buffer_before,
      buffer_after: booking.buffer_after,
      slot_interval: booking.slot_interval,
    };

    const { rules, exceptions } = await getEffectiveAvailability({
      providerId: booking.provider_id,
      serviceId: booking.service_id,
    });

    // The same grid check the create path applies. A reschedule is still an
    // appointment landing on the provider's calendar, so it has to land on one
    // of the times that calendar publishes — otherwise a provider could move a
    // booking to 09:17 and lose two slots to it, exactly as a client could.
    if (
      !isOfferedSlotStart({
        rules,
        exceptions,
        timezone: booking.provider_timezone_now,
        service: spanService,
        startsAt: start,
      })
    ) {
      return errorResponse(
        res,
        viewerRole === "provider"
          ? "That time is not one of your available appointment times"
          : "That time is not one of the provider's available appointment times",
        409,
        ERROR_CODES.SLOT_UNAVAILABLE
      );
    }

    const span = computeBookingSpan(start, spanService);

    const updated = await transaction(async (tx) => {
      const result = await tx.query(
        `UPDATE bookings
         SET starts_at = $1, ends_at = $2, blocked_from = $3, blocked_to = $4,
             status = 'rescheduled', updated_at = NOW()
         WHERE id = $5 AND status = ANY($6)
         RETURNING *`,
        [span.startsAt, span.endsAt, span.blockedFrom, span.blockedTo, booking.id, ACTIVE_STATUSES]
      );

      if (result.rows.length === 0) return null;

      await recordEvent(tx, {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "rescheduled",
        fromStartsAt: booking.starts_at,
        toStartsAt: span.startsAt,
        actorId: req.user.userId,
        actorRole: viewerRole,
        reason: reason ? String(reason).trim() : null,
      });

      const full = await tx.query(`${BOOKING_SELECT} WHERE b.id = $1`, [booking.id]);
      return full.rows[0];
    });

    if (!updated) {
      return errorResponse(res, "This booking is no longer active", 409, ERROR_CODES.BOOKING_NOT_ACTIVE);
    }

    return successResponse(res, "Booking rescheduled", serialiseBooking(updated, { viewerRole }));
  } catch (err) {
    if (err.code === EXCLUSION_VIOLATION) {
      return errorResponse(
        res,
        "That slot is already taken. Please pick another time.",
        409,
        ERROR_CODES.SLOT_TAKEN
      );
    }
    console.error("rescheduleBooking error:", err.message);
    return errorResponse(res, "Could not reschedule booking", 500);
  }
};

/**
 * PATCH /api/bookings/:id/status — provider only.
 *
 * Body: { status: "completed" | "no_show" }
 *
 * Cancellation is deliberately not routed here; it has its own endpoint because
 * it has its own rules (the client cutoff, the mandatory reason) and its own
 * side effect (freeing the slot).
 */
export const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const existing = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const booking = existing.rows[0];
    if (booking.provider_id !== req.user.userId) {
      return errorResponse(res, "Only the provider can change this", 403, ERROR_CODES.FORBIDDEN);
    }

    if (status === "cancelled") {
      return errorResponse(
        res,
        "Use POST /api/bookings/:id/cancel to cancel a booking",
        400,
        ERROR_CODES.INVALID_TRANSITION
      );
    }

    const verdict = evaluateProviderTransition(booking, status, new Date());
    if (!verdict.allowed) {
      return errorResponse(res, verdict.reason, 409, verdict.code);
    }

    const updated = await transaction(async (tx) => {
      const result = await tx.query(
        `UPDATE bookings SET status = $1, updated_at = NOW()
         WHERE id = $2 AND status = ANY($3) RETURNING *`,
        [status, booking.id, ACTIVE_STATUSES]
      );

      if (result.rows.length === 0) return null;

      await recordEvent(tx, {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: status,
        actorId: req.user.userId,
        actorRole: "provider",
        reason: req.body.reason ? String(req.body.reason).trim().slice(0, 500) : null,
      });

      const full = await tx.query(`${BOOKING_SELECT} WHERE b.id = $1`, [booking.id]);
      return full.rows[0];
    });

    if (!updated) {
      return errorResponse(res, "This booking is no longer active", 409, ERROR_CODES.BOOKING_NOT_ACTIVE);
    }

    return successResponse(
      res,
      `Booking marked ${status.replace("_", "-")}`,
      serialiseBooking(updated, { viewerRole: "provider" })
    );
  } catch (err) {
    console.error("updateBookingStatus error:", err.message);
    return errorResponse(res, "Could not update booking", 500);
  }
};

/**
 * Works out how a user relates to a booking.
 *
 * @returns {"client"|"provider"|null} null when they are neither party, which
 *   every caller treats as "not found".
 */
function viewerRoleFor(booking, userId) {
  if (booking.client_id === userId) return "client";
  if (booking.provider_id === userId) return "provider";
  return null;
}

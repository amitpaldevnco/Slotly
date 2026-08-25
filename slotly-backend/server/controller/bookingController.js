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
  describeRescheduleTerms,
  summariseAcceptedTerms,
  ACTIVE_STATUSES,
  awaitsOutcome,
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
    // "This appointment is over and nobody has said how it went." Sent to both
    // parties because the client's own history should not show a finished
    // appointment as merely 'booked' with no explanation, but only the provider
    // is offered the two buttons — see `evaluateProviderTransition`. Nothing
    // about this flag changes the status; it is the prompt, not the decision.
    awaitingOutcome: awaitsOutcome(row, new Date()),
    // Precomputed so the UI never has to re-implement the cutoff rule to decide
    // whether to show a Cancel or Reschedule button. The server still re-checks
    // on the call — these are affordances, not the enforcement.
    canClientCancel:
      viewerRole === "client" ? evaluateClientCancellation(row, new Date()).allowed : undefined,
    canClientReschedule:
      viewerRole === "client" ? evaluateClientReschedule(row, new Date()).allowed : undefined,
    // What a reschedule would cost, and how long it would run for, if the
    // provider has edited the service since. Sent to both parties — the provider
    // is entitled to see that their own edit has consequences for this booking —
    // but only ever `requiresAcceptance` for the client, who is the only one who
    // can agree to new terms. See `describeRescheduleTerms`.
    serviceChanges: describeServiceChangesFor(row, viewerRole),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The `serviceChanges` block on a serialised booking, or null when there is
 * nothing to report.
 *
 * Null rather than a block full of `changed: false` flags, so the UI's test is
 * `if (booking.serviceChanges)` and no screen has to reason about a shape that
 * means "no news". Also null when the service row was not joined, and for a
 * booking that is no longer active — a cancelled or completed appointment is not
 * going to be moved, so what it *would* now cost is noise.
 *
 * @param {object} row A row from BOOKING_SELECT.
 * @param {"client"|"provider"|undefined} viewerRole
 */
function describeServiceChangesFor(row, viewerRole) {
  if (row.service_price_now === undefined || row.service_price_now === null) return null;
  if (!ACTIVE_STATUSES.includes(row.status)) return null;

  const terms = describeRescheduleTerms({
    booking: row,
    service: { price: row.service_price_now, duration: row.service_duration_now },
    actorRole: viewerRole,
  });

  if (!terms.changed) return null;

  return {
    price: terms.price,
    duration: terms.duration,
    // The currency both figures are in. Always the same one — a provider's
    // currency is on their user row, not on the service, so a price change
    // cannot also be a currency change.
    currency: row.provider_currency ?? "INR",
    // True only for the client, who is the only party a reschedule asks. For the
    // provider this block is information, not a gate.
    requiresAcceptance: terms.requiresAcceptance,
  };
}

/* ---------------------------------------------------------------------------
 * Nothing settles a finished appointment automatically. This is deliberate, and
 * this note is here because its absence is the surprising part.
 *
 * There used to be an `autoCompleteExpired()` here, run lazily on every read,
 * which flipped any finished-but-unrecorded booking to 'completed' — first on
 * `ends_at`, later after a one-hour grace period. It is gone. Whether a client
 * turned up is not something the clock knows, and 'completed' is both terminal
 * and the status lifetime earnings are summed over, so guessing it turned every
 * no-show the provider was slow to record into permanent phantom revenue.
 *
 * A finished appointment now keeps its active status until the provider records
 * 'completed' or 'no_show'. `awaitsOutcome()` in services/bookingRules.js is the
 * predicate for "over, and still unrecorded"; it is surfaced on every serialised
 * booking as `awaitingOutcome`, counted on the dashboard summary, and listable
 * via `GET /bookings?scope=awaiting_outcome`, which together are what prompt the
 * provider instead of deciding for them.
 * ------------------------------------------------------------------------- */

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
         s.cover_image, s.is_active AS service_is_active,
         -- The service as it stands *now*, alongside the snapshots. Only the
         -- reschedule question needs these: a client moving their appointment
         -- enters the current arrangement, so the UI has to be able to show them
         -- both sets of numbers before they agree. Nothing else reads them, and
         -- the snapshots remain what the booking itself is priced and sized at.
         s.price AS service_price_now, s.duration AS service_duration_now
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

    // Earnings count only completed appointments — a booked-but-not-yet-happened
    // appointment has not been rendered, and a cancelled one was never paid for.
    //
    // Nothing reaches 'completed' without the provider saying so, so a finished
    // appointment they have not recorded yet contributes nothing here. That is
    // the point: `awaiting_outcome` counts exactly those, and it is money the
    // provider may well have earned but has not confirmed. Reporting the two
    // separately is what stops the dashboard quietly banking the difference.
    const result = await query(
      `SELECT
         COALESCE(SUM(price_snapshot) FILTER (WHERE status = 'completed'), 0) AS total_earnings,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_bookings,
         COUNT(*) FILTER (WHERE status = ANY($2) AND starts_at >= NOW()) AS upcoming_bookings,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_bookings,
         COUNT(*) FILTER (WHERE status = ANY($2) AND ends_at <= NOW()) AS awaiting_outcome,
         COALESCE(SUM(price_snapshot) FILTER (WHERE status = ANY($2) AND ends_at <= NOW()), 0)
           AS awaiting_outcome_value,
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
      // How many finished appointments still need a result recorded, and what
      // they are worth if every one of them is marked completed. The value is
      // explicitly *not* folded into `totalEarnings`.
      awaitingOutcome: Number(row.awaiting_outcome),
      awaitingOutcomeValue: Number(row.awaiting_outcome_value),
      totalBookings: Number(row.total_bookings),
    });
  } catch (err) {
    console.error("getBookingSummary error:", err.message);
    return errorResponse(res, "Could not fetch summary", 500);
  }
};

/**
 * GET /api/bookings/counts — any signed-in user.
 *
 * How many bookings fall in each of the three tabs the appointments screen
 * offers. Role-aware, unlike `getBookingSummary`, which is a provider's earnings
 * report and refuses a client outright.
 *
 * ## Why this exists rather than counting the fetched list
 *
 * The screen fetches one tab at a time, so it could only ever label the tab it
 * was looking at — "Upcoming (2) · Past · Cancelled", then "Upcoming · Past ·
 * Cancelled (1)" once you moved. A count that appears only on the tab you are
 * already reading is the one place it tells you nothing; the whole point of the
 * number is to decide whether the *other* tabs are worth opening.
 *
 * Counted in SQL for the same reason the summary is: `listBookings` caps at 500
 * rows, which is right for a page of cards and wrong for a total.
 *
 * The three conditions are deliberately the same expressions `listBookings` uses
 * for `scope=upcoming`, `scope=past` and `status=cancelled`, so a count can never
 * disagree with the list it labels.
 *
 * @returns 200 `{ upcoming, past, cancelled }`.
 */
export const getBookingCounts = async (req, res) => {
  try {
    const user = await query("SELECT id, role FROM users WHERE id = $1", [req.user.userId]);
    if (user.rows.length === 0) {
      return errorResponse(res, "User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const column = user.rows[0].role === "provider" ? "provider_id" : "client_id";

    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE starts_at >= NOW() AND status = ANY($2)) AS upcoming,
         COUNT(*) FILTER (WHERE starts_at < NOW())                      AS past,
         COUNT(*) FILTER (WHERE status = 'cancelled')                    AS cancelled
       FROM bookings
       WHERE ${column} = $1`,
      [req.user.userId, ACTIVE_STATUSES]
    );

    const row = result.rows[0];
    return successResponse(res, "Counts fetched", {
      upcoming: Number(row.upcoming),
      past: Number(row.past),
      cancelled: Number(row.cancelled),
    });
  } catch (err) {
    console.error("getBookingCounts error:", err.message);
    return errorResponse(res, "Could not fetch counts", 500);
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

    const conditions = [role === "provider" ? "b.provider_id = $1" : "b.client_id = $1"];
    const params = [req.user.userId];

    const { scope = "all", status, serviceId, from, to } = req.query;

    if (scope === "upcoming") {
      // "Upcoming" means still going to happen *and* still live — a cancelled
      // appointment next Tuesday belongs in history, not on the agenda.
      conditions.push(`b.starts_at >= NOW() AND b.status = ANY($${params.length + 1})`);
      params.push(ACTIVE_STATUSES);
    } else if (scope === "awaiting_outcome") {
      // Finished, still active: the provider has not recorded completed or
      // no-show yet. The mirror of the `awaitingOutcome` count on the summary,
      // and what the dashboard's reminder panel lists. Ordered oldest-first
      // below, because the appointment that has been waiting longest is the one
      // whose details the provider is most at risk of forgetting.
      conditions.push(`b.ends_at <= NOW() AND b.status = ANY($${params.length + 1})`);
      params.push(ACTIVE_STATUSES);
    } else if (scope === "past") {
      // "Past" means the appointment time has actually gone by.
      //
      // It used to mean "not upcoming" -- `starts_at < NOW() OR status NOT IN
      // (active)` -- which put a cancelled appointment *next Friday* under a tab
      // labelled Past, dated in the future, while it also sat under Cancelled.
      // One booking in two tabs, one of them contradicting its own heading.
      //
      // Cancelled work that has not happened yet is reachable under Cancelled,
      // which is where someone looking for it would go. Cancellations whose slot
      // has since passed stay here, so history remains complete: the filter is
      // on the clock alone, exactly as the label says.
      conditions.push(`b.starts_at < NOW()`);
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
    // newest-first (what happened most recently?). An outcome queue is a to-do
    // list rather than history, so it reads oldest-first too — clear the
    // backlog from the far end.
    const order = scope === "upcoming" || scope === "awaiting_outcome" ? "ASC" : "DESC";

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
    // Read, then authorize, and only then settle anything. Auto-completion is a
    // write, and running it first meant a stranger probing ids could change the
    // status of appointments they had no business seeing. Harmless in effect —
    // the row was already past its grace period and the next legitimate read
    // would have completed it anyway — but "authorize before you write" is not
    // a rule worth having an exception to.
    const first = await query(`SELECT client_id, provider_id FROM bookings WHERE id = $1`, [
      req.params.id,
    ]);
    if (first.rows.length === 0 || !viewerRoleFor(first.rows[0], req.user.userId)) {
      // 404 rather than 403: confirming a booking exists to someone unrelated to
      // it leaks that the provider had an appointment at that id.
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const result = await query(`${BOOKING_SELECT} WHERE b.id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const booking = result.rows[0];
    const viewerRole = viewerRoleFor(booking, req.user.userId);

    if (!viewerRole) {
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
      `SELECT b.*, s.price, s.duration, s.buffer_before, s.buffer_after, s.slot_interval,
              p.timezone AS provider_timezone_now, p.currency AS provider_currency
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

    const { startsAt, reason, acceptChanges } = req.body;
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
    // Typed rather than merely truthy: `acceptChanges: "no"` is truthy, and
    // reading it as consent to a price increase is not a mistake worth being
    // relaxed about.
    if (acceptChanges !== undefined && typeof acceptChanges !== "boolean") {
      errors.push({ field: "acceptChanges", message: "acceptChanges must be true or false" });
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

    // Which price and duration the moved appointment runs under. A client moving
    // their own booking enters the service's current terms — and is asked first,
    // because that can change what they pay. A provider moving someone else's
    // keeps the snapshotted terms: imposing a change *and* new terms in one
    // action is the thing the acceptance gate exists to prevent. All of that
    // reasoning lives in `describeRescheduleTerms`; this is only the branch.
    const terms = describeRescheduleTerms({
      booking,
      service: booking,
      actorRole: viewerRole,
      accepted: acceptChanges === true,
    });

    if (terms.requiresAcceptance) {
      return errorResponse(
        res,
        "This service has changed since you booked. Review the new details before moving your appointment.",
        409,
        ERROR_CODES.SERVICE_TERMS_CHANGED,
        {
          price: terms.price,
          duration: terms.duration,
          currency: booking.provider_currency ?? "INR",
          // Named so a client reading the docs knows the way forward without
          // having to infer it from the code.
          resendWith: { acceptChanges: true },
        }
      );
    }

    // The buffers and the grid always come from the service *as it stands now*,
    // whichever terms apply above. The duration is what the client is committed
    // to; the buffers are the provider's own turnaround time and the grid is the
    // provider's own publishing choice, neither of which the client bought.
    // Honouring a buffer the provider has since abandoned would block time
    // nobody wants blocked, and checking the new time against a retired grid
    // would refuse slots the provider is currently offering.
    const spanService = {
      duration: terms.applied.duration,
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
      // The snapshots move only when the client accepted new terms — `terms
      // .applied` is the booking's existing pair in every other case, so this
      // rewrites them to the values they already hold and no history is
      // disturbed. Writing them unconditionally, rather than behind a second
      // branch, keeps one statement doing one thing and makes it impossible for
      // the span above and the price below to be derived from different terms.
      const result = await tx.query(
        `UPDATE bookings
         SET starts_at = $1, ends_at = $2, blocked_from = $3, blocked_to = $4,
             price_snapshot = $7, duration_snapshot = $8,
             status = 'rescheduled', updated_at = NOW()
         WHERE id = $5 AND status = ANY($6)
         RETURNING *`,
        [
          span.startsAt,
          span.endsAt,
          span.blockedFrom,
          span.blockedTo,
          booking.id,
          ACTIVE_STATUSES,
          terms.applied.price,
          terms.applied.duration,
        ]
      );

      if (result.rows.length === 0) return null;

      // What was agreed, not merely that something was. A client's own note comes
      // first when they left one; the terms sentence is appended so the timeline
      // can never show an accepted repricing with no record of the numbers.
      const note = reason ? String(reason).trim() : "";
      const agreed = summariseAcceptedTerms(terms, booking.provider_currency);
      const trail = [note, agreed].filter(Boolean).join(" ").slice(0, 500) || null;

      await recordEvent(tx, {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "rescheduled",
        fromStartsAt: booking.starts_at,
        toStartsAt: span.startsAt,
        actorId: req.user.userId,
        actorRole: viewerRole,
        reason: trail,
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

    const owner = await query("SELECT provider_id FROM bookings WHERE id = $1", [req.params.id]);
    if (owner.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (owner.rows[0].provider_id !== req.user.userId) {
      return errorResponse(res, "Only the provider can change this", 403, ERROR_CODES.FORBIDDEN);
    }

    // Settle the grace period *before* reading the row this decision is made on.
    const existing = await query("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const booking = existing.rows[0];

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
      // A status that is not one of the five is malformed input, not a conflict
      // with the booking's current state — the request would be wrong whatever
      // the row said, so it is a 400. The other refusals really are conflicts:
      // the booking is already settled, or the appointment has not started yet.
      // Both are true of *this* row at *this* moment and could be false later,
      // which is what 409 means.
      const malformed = verdict.code === ERROR_CODES.INVALID_STATUS;
      return errorResponse(res, verdict.reason, malformed ? 400 : 409, verdict.code);
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

/**
 * Booking policy rules — cancellation cutoff and legal status transitions.
 *
 * Pure functions, no database and no ambient clock: `now` is always passed in.
 * That is what lets the cutoff tests pin down the boundary exactly instead of
 * approximating it, and it is why these rules live here rather than inline in
 * the controller.
 */
import { DateTime } from "luxon";

/** Statuses a booking can hold. Mirrors the CHECK constraint on bookings.status. */
export const BOOKING_STATUSES = ["booked", "rescheduled", "cancelled", "completed", "no_show"];

/** Statuses that still occupy the provider's calendar. */
export const ACTIVE_STATUSES = ["booked", "rescheduled"];

/**
 * How long after an appointment ends the provider still owns its outcome.
 *
 * Nothing is settled automatically inside this window. Once it closes, a booking
 * nobody recorded an outcome for is taken to have happened — see
 * `autoCompleteExpired()` in the booking controller.
 *
 * The window exists because the alternative has no window at all: settling on
 * `ends_at` meant the first read after an appointment finished flipped it to
 * 'completed', and since opening the dashboard *is* a read, a provider could
 * never mark a no-show for an appointment that had already ended. The status
 * existed in the schema, the API and the UI, and was unreachable in practice.
 *
 * An hour is long enough to cover the realistic case — the client never turned
 * up, the provider waits, finishes the session slot, then records it — without
 * leaving yesterday's calendar ambiguous.
 */
export const OUTCOME_GRACE_MINUTES = 60;

/**
 * Decides whether a client may still cancel their own booking.
 *
 * The cutoff is measured from the appointment's start, using the cutoff value
 * snapshotted onto the booking when it was made — not the provider's current
 * setting. A provider who tightens their policy from 12 to 48 hours should not
 * retroactively trap clients who booked under the old one.
 *
 * @param {{starts_at: Date|string, status: string, cancellation_cutoff_hours_snapshot: number}} booking
 * @param {Date} now Instant to judge against.
 * @returns {{allowed: boolean, code: string|null, deadline: Date, reason: string|null}}
 *   `deadline` is the last instant at which cancellation was possible; it is
 *   returned even when `allowed` is false so the UI can explain the refusal.
 */
export function evaluateClientCancellation(booking, now = new Date()) {
  return evaluateClientCutoff(booking, now, "cancel");
}

/**
 * Decides whether a client may move their own booking.
 *
 * Deliberately the *same* deadline as cancellation rather than a separate
 * setting. A reschedule frees the original slot exactly as a cancellation does,
 * so it costs the provider the same late notice; letting a client reschedule
 * after the cancellation window shut would make the cutoff trivially avoidable
 * by moving the appointment to a distant date and cancelling it there.
 *
 * @param {{starts_at: Date|string, status: string, cancellation_cutoff_hours_snapshot: number}} booking
 * @param {Date} now Instant to judge against.
 * @returns {{allowed: boolean, code: string|null, deadline: Date, reason: string|null}}
 */
export function evaluateClientReschedule(booking, now = new Date()) {
  return evaluateClientCutoff(booking, now, "reschedule");
}

/**
 * The cutoff test shared by client cancellation and client reschedule.
 *
 * @param {object} booking
 * @param {Date} now
 * @param {"cancel"|"reschedule"} action Chooses the wording only; the deadline
 *   itself is identical for both, by design.
 */
function evaluateClientCutoff(booking, now, action) {
  const startsAt = toDate(booking.starts_at);
  const cutoffHours = Number(booking.cancellation_cutoff_hours_snapshot) || 0;
  const deadline = new Date(startsAt.getTime() - cutoffHours * 3_600_000);

  if (!ACTIVE_STATUSES.includes(booking.status)) {
    return {
      allowed: false,
      code: "BOOKING_NOT_ACTIVE",
      deadline,
      reason: `This booking is already ${booking.status.replace("_", "-")}.`,
    };
  }

  if (now.getTime() > deadline.getTime()) {
    // Both codes are spelled out as literals rather than built from `action`,
    // because `tests/api.docs.test.js` greps this file for the bare strings to
    // check every code the server can emit is in the published OpenAPI enum. A
    // computed code would be invisible to it and silently drop out of the docs.
    const closed =
      action === "cancel"
        ? { noun: "Cancellations", code: "CANCELLATION_WINDOW_CLOSED" }
        : { noun: "Changes", code: "RESCHEDULE_WINDOW_CLOSED" };

    return {
      allowed: false,
      code: closed.code,
      deadline,
      reason:
        cutoffHours > 0
          ? `${closed.noun} close ${cutoffHours} hour${cutoffHours === 1 ? "" : "s"} before the appointment.`
          : "This appointment has already started.",
    };
  }

  return { allowed: true, code: null, deadline, reason: null };
}

/**
 * What moving a booking would do to its price and duration.
 *
 * ## The problem this exists to solve
 *
 * A booking freezes the service's price and duration onto itself when it is
 * made, and nothing a provider does afterwards rewrites those columns — that is
 * the whole point of the `*_snapshot` design, and it stays true here. But a
 * *reschedule* is not the same event as an edit: the client is choosing to enter
 * a new arrangement, and the provider's current price is what that arrangement
 * costs. Silently honouring a price the provider abandoned months ago is not
 * "protecting the client", it is quoting them a number nobody is offering.
 *
 * So a reschedule re-reads the service — and because that can change what the
 * client pays, it cannot happen behind their back. Hence `requiresAcceptance`:
 * the write is refused until the client has been shown both sets of numbers and
 * said yes. The original booking is untouched by the refusal, which is what lets
 * the UI ask the question without having already committed to the answer.
 *
 * ## Why only the client
 *
 * A provider moving someone else's appointment keeps the snapshotted terms, and
 * that asymmetry is the same one that governs cancellation reasons and the
 * cutoff: the party imposing a change on somebody else does not get to impose
 * new terms along with it. Letting a provider reprice a booking by dragging it
 * an hour later would be a repricing with no consent step anywhere in it, which
 * is precisely the outcome the acceptance gate exists to rule out. A provider who
 * wants the new price applied can move it, and the client can accept the terms
 * the next time they move it themselves.
 *
 * @param {object} args
 * @param {{price_snapshot: string|number, duration_snapshot: number}} args.booking
 * @param {{price: string|number, duration: number}} args.service The service as
 *   it stands *now*.
 * @param {"client"|"provider"} args.actorRole Who is doing the moving.
 * @param {boolean} [args.accepted] Whether the client has confirmed the new terms.
 * @returns {{
 *   changed: boolean,
 *   price: {booked: number, current: number, changed: boolean},
 *   duration: {booked: number, current: number, changed: boolean},
 *   requiresAcceptance: boolean,
 *   applied: {price: number, duration: number},
 *   repriced: boolean
 * }} `applied` is the pair the moved appointment must actually be written with;
 *   `repriced` says whether that differs from what the booking held before.
 */
export function describeRescheduleTerms({ booking, service, actorRole, accepted = false }) {
  const booked = {
    price: Number(booking.price_snapshot),
    duration: Number(booking.duration_snapshot),
  };
  const current = {
    price: Number(service.price),
    duration: Number(service.duration),
  };

  // A non-finite current value means the service row was not joined, or carried
  // something unusable. Treated as "unchanged" rather than as a change, because
  // the alternative is demanding the client accept terms nobody can name.
  const priceChanged = Number.isFinite(current.price) && current.price !== booked.price;
  const durationChanged = Number.isFinite(current.duration) && current.duration !== booked.duration;
  const changed = priceChanged || durationChanged;

  const clientMoving = actorRole === "client";
  const applyCurrent = clientMoving && changed && accepted;

  return {
    changed,
    price: { booked: booked.price, current: current.price, changed: priceChanged },
    duration: { booked: booked.duration, current: current.duration, changed: durationChanged },
    requiresAcceptance: clientMoving && changed && !accepted,
    applied: applyCurrent ? current : booked,
    repriced: applyCurrent,
  };
}

/**
 * The audit-trail sentence for a client who accepted new terms.
 *
 * Written into the `booking_events` reason so the timeline records *what* was
 * agreed, not merely that something was. The currency is the ISO code rather
 * than a symbol, the same rule the rest of the server follows — the reader's
 * client turns codes into symbols, and a stored symbol is ambiguous.
 *
 * @param {ReturnType<typeof describeRescheduleTerms>} terms
 * @param {string} [currency] ISO 4217 code.
 * @returns {string|null} Null when nothing changed, so a caller can `||` it away.
 */
export function summariseAcceptedTerms(terms, currency = "") {
  if (!terms.repriced) return null;

  const parts = [];
  if (terms.price.changed) {
    const code = currency ? `${currency} ` : "";
    parts.push(`price ${code}${terms.price.booked} → ${code}${terms.price.current}`);
  }
  if (terms.duration.changed) {
    parts.push(`duration ${terms.duration.booked} → ${terms.duration.current} min`);
  }

  return `Accepted the provider's updated service terms: ${parts.join(", ")}.`;
}

/**
 * Validates a status transition a provider is trying to make.
 *
 * Providers may cancel any active booking, and may mark a booking completed or
 * no-show — but only once it has actually started, since neither judgement is
 * meaningful about a future appointment.
 *
 * @param {{status:string, starts_at: Date|string}} booking
 * @param {string} nextStatus Target status.
 * @param {Date} now Instant to judge against.
 * @returns {{allowed: boolean, code: string|null, reason: string|null}}
 */
export function evaluateProviderTransition(booking, nextStatus, now = new Date()) {
  if (!BOOKING_STATUSES.includes(nextStatus)) {
    return { allowed: false, code: "INVALID_STATUS", reason: `Unknown status "${nextStatus}".` };
  }

  if (!ACTIVE_STATUSES.includes(booking.status)) {
    return {
      allowed: false,
      code: "BOOKING_NOT_ACTIVE",
      reason: `This booking is already ${booking.status.replace("_", "-")}.`,
    };
  }

  if (nextStatus === "cancelled") {
    return { allowed: true, code: null, reason: null };
  }

  if (nextStatus === "completed" || nextStatus === "no_show") {
    if (toDate(booking.starts_at).getTime() > now.getTime()) {
      return {
        allowed: false,
        code: "APPOINTMENT_NOT_STARTED",
        reason: "An appointment can only be marked completed or no-show once it has started.",
      };
    }
    return { allowed: true, code: null, reason: null };
  }

  return {
    allowed: false,
    code: "INVALID_TRANSITION",
    reason: `Cannot move a booking from ${booking.status} to ${nextStatus}.`,
  };
}

/**
 * The clock format every time the API renders as a human string uses: "9:00 AM".
 *
 * Shared with the slot endpoint so a slot button and the booking it becomes read
 * identically, and matched by `TIME_FORMAT` in the frontend's `lib/time.js`. The
 * machine-readable value is always the UTC ISO string alongside it; these
 * strings are for display only.
 */
export const TIME_FORMAT = "h:mm a";

/**
 * Renders one instant in two zones at once, which is what the confirmation
 * screen and every booking payload need.
 *
 * @param {Date|string} instant
 * @param {string} clientZone IANA zone.
 * @param {string} providerZone IANA zone.
 * @returns {{utc:string, client:{timezone:string,formatted:string,offset:string},
 *            provider:{timezone:string,formatted:string,offset:string}}}
 */
export function describeInstant(instant, clientZone, providerZone) {
  const dt = DateTime.fromJSDate(toDate(instant), { zone: "utc" });

  return {
    utc: dt.toISO(),
    client: describeIn(dt, clientZone),
    provider: describeIn(dt, providerZone),
  };
}

function describeIn(dt, zone) {
  // An unknown zone name would otherwise produce the string "Invalid DateTime"
  // in the API response. Falling back to UTC and saying so is more honest.
  const local = dt.setZone(zone);
  if (!local.isValid) {
    return { timezone: "UTC", formatted: dt.toFormat(`d LLL yyyy, ${TIME_FORMAT}`), offset: "UTC" };
  }

  return {
    timezone: zone,
    formatted: local.toFormat(`d LLL yyyy, ${TIME_FORMAT}`),
    offset: local.toFormat("ZZZZ"),
  };
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

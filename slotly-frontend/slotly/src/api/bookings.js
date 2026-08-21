/**
 * Bookings — the app's central record.
 *
 * Every call requires a session and is scoped to the caller by the server: there
 * is no `clientId` or `providerId` parameter anywhere below, because who you are
 * comes from the cookie. Acting on a booking you are not party to returns 404,
 * not 403, so an id's existence is never confirmed to a stranger.
 *
 * ## The error codes worth branching on
 *
 * Callers should read `code` from `parseApiError()`, not the prose:
 *
 * - `SLOT_TAKEN` (409) — someone else booked it first. The booking page shows
 *   "that slot just went" and refreshes the list rather than a generic error.
 * - `SLOT_UNAVAILABLE` (409/400) — the time is outside the provider's hours, is
 *   not one of the start times they publish, or has already started. There is no
 *   minimum-notice code to branch on: booking is real time, so a slot later today
 *   or inside the next hour is bookable, and the only time-based refusal left is
 *   that the moment has gone. Since it can go while the client is looking at it,
 *   this is a code the booking screen should refresh on rather than treat as a
 *   dead end.
 * - `CANCELLATION_WINDOW_CLOSED` (409) — past the provider's cutoff;
 *   `details.deadline` says when it was.
 * - `BOOKING_NOT_ACTIVE` (409) — already cancelled or completed.
 *
 * As elsewhere, `options` carries `{ signal }` and each function resolves with
 * the unwrapped payload.
 */
import { api, unwrap } from "./client";

/**
 * The caller's bookings — the ones they made as a client, or the ones on their
 * calendar as a provider. Which of the two is decided by the server from the
 * session, and reported back as `role`.
 *
 * `params` accepts `scope` ("upcoming" | "past" | "all"), `status`, `serviceId`,
 * `from` and `to`.
 */
export const list = (params = {}, options = {}) =>
  api.get("/bookings", { params, ...options }).then(unwrap);

/** One booking plus its full status timeline. 404 for a non-party. */
export const get = (bookingId, options = {}) =>
  api.get(`/bookings/${bookingId}`, options).then(unwrap);

/**
 * Books a slot. Client accounts only.
 *
 * @param {{serviceId: number, startsAt: string, note?: string}} payload
 *   `startsAt` must be the exact ISO instant the slots endpoint returned —
 *   passing a nearby time is rejected, because it is not a start the provider
 *   publishes. Sending the value through unchanged is also what lets the two
 *   sides agree on a moment without agreeing on a timezone.
 * @returns The created booking, with the time rendered in both parties' zones.
 */
export const create = (payload) => api.post("/bookings", payload).then(unwrap);

/**
 * Cancels a booking. Open to either party, under different rules.
 *
 * A client is bound by the provider's cutoff and needs no reason. A provider can
 * cancel at any time but **must** give one — omitting it rejects with a
 * field-level error on `reason`.
 */
export const cancel = (bookingId, reason) =>
  api.post(`/bookings/${bookingId}/cancel`, reason ? { reason } : {}).then(unwrap);

/**
 * Marks a booking completed or no-show. Provider only, and only once the
 * appointment has actually started — neither judgement means anything about a
 * future one, so both reject with `APPOINTMENT_NOT_STARTED` before then.
 * Cancellation is not routed here; it has its own endpoint and its own rules.
 */
export const setStatus = (bookingId, status) =>
  api.patch(`/bookings/${bookingId}/status`, { status }).then(unwrap);

/**
 * Moves a booking to a new time. `payload` is `{ startsAt, reason?, acceptChanges? }`
 * — `reason` is required from a provider and optional from a client.
 *
 * Subject to the same exclusion constraint as a new booking, so moving onto an
 * occupied slot loses the race the same way, with `SLOT_TAKEN`.
 *
 * A client's move enters the service's *current* price and duration, so if the
 * provider has edited either since, the first attempt is refused with
 * `SERVICE_TERMS_CHANGED` and nothing is written. Show the client both sets of
 * figures — `booking.serviceChanges`, or the same shape on the error's `details`
 * — and repeat the call with `acceptChanges: true` once they agree.
 */
export const reschedule = (bookingId, payload) =>
  api.post(`/bookings/${bookingId}/reschedule`, payload).then(unwrap);

/** One cheap aggregate for the dashboard badge, across every booking. */
export const unreadCount = (options = {}) =>
  api.get("/bookings/unread-count", options).then(unwrap);

/** Earnings and per-status counts for the provider's overview panel. */
export const summary = (options = {}) => api.get("/bookings/summary", options).then(unwrap);

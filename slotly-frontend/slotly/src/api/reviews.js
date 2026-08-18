/**
 * Reviews — a client's feedback on one completed appointment.
 *
 * The split in the URLs is deliberate and worth knowing: **creating** a review
 * hangs off the booking, because the booking is what authorises and validates
 * it (only its client may write one, and only once it is completed). **Editing**
 * and **replying** address the review by its own id, because by then it exists
 * as a thing in its own right.
 *
 * One booking has at most one review, enforced by a UNIQUE constraint rather
 * than a check in application code — so changing your mind is an update of your
 * own row, never a second one, and a double submission cannot race past it.
 */
import { api, unwrap } from "./client";

/** The review on a booking, if any. Readable by both parties. */
export const getForBooking = (bookingId, options = {}) =>
  api.get(`/bookings/${bookingId}/review`, options).then(unwrap);

/**
 * Leaves a review. The booking's client only, and only once it is `completed` —
 * an earlier attempt rejects rather than being stored for later.
 *
 * @param {{rating: number, comment?: string}} payload `rating` is 1–5.
 */
export const createForBooking = (bookingId, payload) =>
  api.post(`/bookings/${bookingId}/review`, payload).then(unwrap);

/** Edits your own review. Anyone else gets 403. */
export const update = (reviewId, payload) =>
  api.patch(`/reviews/${reviewId}`, payload).then(unwrap);

/**
 * The provider's public response. Restricted to the provider being reviewed —
 * being *a* provider is not enough, so this is checked against the row rather
 * than by a role guard.
 */
export const reply = (reviewId, replyText) =>
  api.post(`/reviews/${reviewId}/reply`, { reply: replyText }).then(unwrap);

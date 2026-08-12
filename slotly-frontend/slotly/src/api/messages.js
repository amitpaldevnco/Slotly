//The message thread attached to a booking.

import { api, unwrap } from "./client";

/** Resolves to the thread — the messages plus who the other party is. */
export const listForBooking = (bookingId, options = {}) =>
  api.get(`/bookings/${bookingId}/messages`, options).then(unwrap);

/**
 * Resolves to the created message in its final server-side shape, so the caller
 * can append it to the thread instead of refetching.
 */
export const sendToBooking = (bookingId, body) =>
  api.post(`/bookings/${bookingId}/messages`, { body }).then(unwrap);

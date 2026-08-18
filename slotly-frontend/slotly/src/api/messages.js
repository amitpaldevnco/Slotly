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

/**
 * The viewer's most recently active conversations — one entry per thread,
 * newest first, each with the last message and that thread's unread count.
 *
 * A summary, not a thread view: unlike `listForBooking`, this does **not** mark
 * anything as read. A dashboard rendering must not clear someone's unread badge.
 *
 * @param {number} [limit] Threads to return, 1–20. The server clamps it.
 * @returns {Promise<{conversations: Array}>}
 */
export const recent = (limit = 5, options = {}) =>
  api.get("/bookings/recent-messages", { params: { limit }, ...options }).then(unwrap);


import { api, unwrap } from "./client";


export const getForBooking = (bookingId, options = {}) =>
  api.get(`/bookings/${bookingId}/review`, options).then(unwrap);

export const createForBooking = (bookingId, payload) =>
  api.post(`/bookings/${bookingId}/review`, payload).then(unwrap);

export const update = (reviewId, payload) =>
  api.patch(`/reviews/${reviewId}`, payload).then(unwrap);

export const reply = (reviewId, replyText) =>
  api.post(`/reviews/${reviewId}/reply`, { reply: replyText }).then(unwrap);

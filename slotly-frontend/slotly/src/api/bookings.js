// Bookings — the app's central record.

import { api, unwrap } from "./client";


export const list = (params = {}, options = {}) =>
  api.get("/bookings", { params, ...options }).then(unwrap);

export const get = (bookingId, options = {}) =>
  api.get(`/bookings/${bookingId}`, options).then(unwrap);

export const create = (payload) => api.post("/bookings", payload).then(unwrap);

export const cancel = (bookingId, reason) =>
  api.post(`/bookings/${bookingId}/cancel`, reason ? { reason } : {}).then(unwrap);

export const setStatus = (bookingId, status) =>
  api.patch(`/bookings/${bookingId}/status`, { status }).then(unwrap);

export const reschedule = (bookingId, payload) =>
  api.post(`/bookings/${bookingId}/reschedule`, payload).then(unwrap);

/** One cheap aggregate for the dashboard badge, across every booking. */
export const unreadCount = (options = {}) =>
  api.get("/bookings/unread-count", options).then(unwrap);

/** Earnings and per-status counts for the provider's overview panel. */
export const summary = (options = {}) => api.get("/bookings/summary", options).then(unwrap);

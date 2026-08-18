/**
 * The provider's own services — the write side. Reading them is public and
 * lives in `providers.js`.
 *
 * All three calls require a provider session and are scoped to the caller's own
 * rows; touching another provider's service returns 403.
 *
 * Create and update send **FormData**, not JSON, because both can carry a cover
 * image in the same request. Field names are camelCase (`serviceName`,
 * `bufferBefore`, `slotInterval`), matching the rest of the API; the server also
 * still accepts the older snake_case spellings.
 */
import { api, unwrap } from "./client";

/**
 * @param {FormData} formData Requires `serviceName`, `price` and `duration`.
 *   Optional: `description`, `bufferBefore`, `bufferAfter`, `slotInterval`, and
 *   a `coverImage` file (JPG/PNG/WebP, 5 MB, validated by header on the server).
 * @returns The created service. Rejects 400 with per-field messages keyed by the
 *   same camelCase names, so a form can attach each to its own input.
 */
export const create = (formData) => api.post("/services", formData).then(unwrap);

/** Partial update — omitted fields are left alone rather than cleared. */
export const update = (serviceId, formData) =>
  api.put(`/services/${serviceId}`, formData).then(unwrap);

/**
 * Brings a retired service back: bookable, publicly visible and editable again.
 *
 * The same row, deliberately — recreating a service instead would detach it from
 * its own booking history and its reviews.
 *
 * Its own endpoint rather than `update(id, { isActive: true })`, because editing
 * a retired service is refused with `SERVICE_RETIRED`.
 *
 * @returns {Promise<object>} The reactivated service. Rejects 409
 *   `ALREADY_ACTIVE` if it was not retired, 403 if it is not yours.
 */
export const reactivate = (serviceId) =>
  api.post(`/services/${serviceId}/reactivate`).then(unwrap);

/**
 * Removes a service — or retires it, which is not the same thing.
 *
 * A service nobody has ever booked is deleted outright. One with booking history
 * is retired instead (`isActive: false`): it vanishes from the public page and
 * the slot picker, but existing appointments still go ahead and still appear in
 * both parties' history. Silently erasing an appointment somebody plans to
 * attend would be the worse failure.
 *
 * This is the one call that keeps the server's `message` alongside the payload,
 * because the UI has to say which of the two happened rather than claiming a
 * deletion that did not occur.
 *
 * @returns {Promise<{id: number, deleted: boolean, retired: boolean,
 *   upcomingBookings?: number, message: string}>}
 */
export const remove = (serviceId) =>
  api.delete(`/services/${serviceId}`).then((res) => ({
    ...unwrap(res),
    message: res.data.message,
  }));

/**
 * A provider's working hours: the weekly pattern, the exceptions to it, and the
 * booking policy that applies on top.
 */
import { api, unwrap } from "./client";


/**
 * Replaces the whole weekly pattern in one call.
 *
 * A whole-week replace rather than per-row CRUD, because the UI edits the week
 * as a single grid and the server applies it in one transaction — so a failed
 * save can never leave a provider with Monday deleted and Tuesday not yet
 * written.
 *
 * @param {Array<{weekday: number, startTime: string, endTime: string}>} rules
 *   `weekday` is 0 (Sunday) to 6. Times are `HH:MM` wall-clock in the provider's
 *   own timezone; "24:00" is accepted for "until midnight".
 * @param {number} [serviceId] Scope these hours to one service instead of the
 *   provider's defaults.
 * @returns The saved rules. Rejects 400 with per-rule field errors keyed like
 *   `rules[2].startTime`, including when two windows overlap on one weekday.
 */
export const saveRules = (rules, serviceId) =>
  api.put("/availability/rules", { rules, ...(serviceId ? { serviceId } : {}) }).then(unwrap);

/**
 * Asks the server whether a weekly pattern would actually produce bookable
 * slots. Writes nothing — this is the same validation and the same slot
 * arithmetic `saveRules` would apply, run against a draft.
 *
 * Deliberately a request rather than a calculation in the browser: whether a
 * given window yields a slot depends on how the engine anchors its grid and how
 * both buffers narrow the legal band, and a second implementation here would be
 * a second thing to keep in step with the engine.
 */
export const validateRules = (rules, serviceId, options = {}) =>
  api
    .post("/availability/validate", { rules, ...(serviceId ? { serviceId } : {}) }, options)
    .then(unwrap);

/**
 * How many slots a *draft service* would yield against the provider's already
 * saved hours.
 *
 * The mirror of `validateRules`, which judges a draft *pattern* against saved
 * *services*. This is what the service form needs: someone typing a duration
 * and buffers has no way to know what those numbers do to their day, and the
 * interaction is genuinely unobvious — a 09:00–10:00 window with a 30-minute
 * service, 10-minute buffers and a 30-minute grid offers nothing at all.
 *
 * Computed server-side for the same reason `validateRules` is: the answer
 * depends on how the engine anchors its candidate grid, and a second
 * implementation in the browser would be a second thing to keep in step.
 *
 * @param {{duration: number, bufferBefore?: number, bufferAfter?: number,
 *   slotInterval?: number, serviceId?: number}} draft `serviceId` selects which
 *   hours apply, for a service that has its own; omit it for a new service.
 * @returns {Promise<{hasRules: boolean, bookable: boolean, totalSlotsPerWeek: number,
 *   days: Array, problemDays: Array, remedies: Array}>} `hasRules` is false when
 *   there are no hours at all — a different problem, with a different fix, from
 *   hours that cannot fit this service.
 */
export const previewSlots = (draft, options = {}) =>
  api.post("/availability/preview", draft, options).then(unwrap);

/**
 * Whether the provider's *saved* hours currently produce bookable times, per
 * active service. Read-only; the dashboard's "needs attention" panel uses it.
 */
export const getHealth = (options = {}) => api.get("/availability/health", options).then(unwrap);

/** Drops a service's custom hours so it falls back to the provider's default. */
export const resetServiceRules = (serviceId) =>
  api.delete(`/availability/rules/service/${serviceId}`).then(unwrap);

/** A one-off closure or a one-off opening on a specific date. */
export const createException = (payload) =>
  api.post("/availability/exceptions", payload).then(unwrap);

/**
 * Removes a one-off exception, restoring the weekly pattern for those dates.
 *
 * Bookings already made on a date this exception blocked are unaffected —
 * availability governs what is offered next, never what has been agreed.
 */
export const deleteException = (exceptionId) =>
  api.delete(`/availability/exceptions/${exceptionId}`).then(unwrap);

/** Booking policy — currently how late a client may still cancel. */
export const updateSettings = (payload) =>
  api.patch("/availability/settings", payload).then(unwrap);

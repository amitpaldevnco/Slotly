/**
 * A provider's working hours: the weekly pattern, the exceptions to it, and the
 * booking policy that applies on top.
 */
import { api, unwrap } from "./client";


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

export const deleteException = (exceptionId) =>
  api.delete(`/availability/exceptions/${exceptionId}`).then(unwrap);

/** Booking policy — currently how late a client may still cancel. */
export const updateSettings = (payload) =>
  api.patch("/availability/settings", payload).then(unwrap);

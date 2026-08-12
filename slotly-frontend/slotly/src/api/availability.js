/**
 * A provider's working hours: the weekly pattern, the exceptions to it, and the
 * booking policy that applies on top.
 */
import { api, unwrap } from "./client";


export const saveRules = (rules, serviceId) =>
  api.put("/availability/rules", { rules, ...(serviceId ? { serviceId } : {}) }).then(unwrap);

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

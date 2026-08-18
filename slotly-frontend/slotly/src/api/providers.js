/**
 * The public read side: the provider directory, one provider's page, and
 * everything hanging off it.
 *
 * Every call here works signed-out — this is what a visitor sees before they
 * have an account. A session changes the *response* rather than the permission:
 * the server recognises the owner and adds editing affordances, and renders
 * slots in a signed-in viewer's saved timezone instead of UTC.
 *
 * ## Conventions shared by every function below
 *
 * - `options` is passed through to axios; in practice it carries `{ signal }`
 *   from an AbortController, because components cancel in-flight reads on
 *   unmount and when their inputs change. A cancelled request rejects — use
 *   `isCanceled()` from ./client to tell that apart from a real failure.
 * - Each returns the unwrapped `data` payload, not the axios response.
 * - Each rejects with an axios error on any non-2xx; callers run it through
 *   `parseApiError()`.
 */
import { api, unwrap } from "./client";

/** The directory. `params` accepts `search`, `category`, `sort`, `page`. */
export const list = (params = {}, options = {}) =>
  api.get("/providers", { params, ...options }).then(unwrap);

/** One provider's public profile. Rejects 404 if the id matches no provider. */
export const get = (providerId, options = {}) =>
  api.get(`/providers/${providerId}`, options).then(unwrap);

/**
 * A provider's services.
 *
 * Retired services (`isActive: false`) are included only when the caller is the
 * owning provider — a visitor sees just the bookable ones. The owner's copy also
 * carries a `stats` object; nobody else's does.
 */
export const listServices = (providerId, options = {}) =>
  api.get(`/providers/${providerId}/services`, options).then(unwrap);

/**
 * The published weekly hours and exceptions.
 *
 * Times come back as `HH:MM` wall-clock strings in the *provider's* timezone,
 * not as instants — they describe a recurring pattern, which has no single
 * moment to convert. Pass `{ serviceId }` in `params` for a service that has
 * hours of its own.
 */
export const getAvailability = (providerId, params = {}, options = {}) =>
  api.get(`/providers/${providerId}/availability`, { params, ...options }).then(unwrap);

/**
 * Bookable slots for one service over a date range.
 *
 * @param {number} providerId
 * @param {{serviceId: number, from: string, to: string, timezone?: string}} params
 *   `from` and `to` are "YYYY-MM-DD" and are read as calendar dates in the
 *   viewer's zone, with `to` inclusive. `timezone` is honoured only for a
 *   signed-out visitor; a signed-in user always gets their saved zone, so the
 *   same person cannot see two different clocks on two screens.
 * @returns Slots grouped by the viewer's local date, each carrying both
 *   `clientTime` and `providerTime`. Ranges wider than 62 days reject with
 *   `RANGE_TOO_WIDE`.
 */
export const getSlots = (providerId, params, options = {}) =>
  api.get(`/providers/${providerId}/slots`, { params, ...options }).then(unwrap);

/** Published reviews. A signed-in client's own review comes back flagged. */
export const listReviews = (providerId, options = {}) =>
  api.get(`/providers/${providerId}/reviews`, options).then(unwrap);

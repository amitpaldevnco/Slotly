/**
 * The shared axios instance and the two things every caller does with a
 * response: unwrap the success envelope, or turn a failure into something the UI
 * can render.
 *
 * Every `src/api/*` module builds on this, so the API's location, the cookie
 * policy and the error shape are each decided in exactly one place.
 */
import axios from "axios";

// The one place the API's location is decided. Everything else — every resource
// module, and `imageUrl` below — builds on this, so there is a single value to
// change per environment and no hardcoded host anywhere in `src/`.
//
// The fallback covers a fresh clone with no `.env` yet. It is not a safety net in
// production: if the variable is missing from a deployed build, requests go to
// localhost, the browser cannot reach it, and every call reports
// "Cannot reach the server". That is a louder failure than defaulting to a
// relative path, which would return the SPA's own HTML for every API call and
// look like a parsing bug instead of a configuration one.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";


/**
 * The shared client.
 *
 * `withCredentials: true` is what makes authentication work at all: the session
 * is an httpOnly cookie, which the browser will not attach to a cross-origin
 * request unless asked. It is also why the API cannot use a wildcard CORS
 * origin, and why the frontend's URL has to be on the server's allow-list.
 */
export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

/**
 * Pulls the payload out of the API's success envelope.
 *
 * Every successful response is `{ success, message, data }`, so callers want
 * `data` and nothing else. Kept as one function rather than inlined so the
 * envelope is understood in a single place.
 *
 * @param {{data: {data: *}}} res An axios response.
 * @returns {*} The payload. Never throws — a non-2xx never reaches here,
 *   because axios rejects it first.
 */
export const unwrap = (res) => res.data.data;

/**
 * True when a request was aborted rather than failed.
 *
 * Components abort in-flight requests on unmount and when their inputs change,
 * so a cancellation is the normal course of events, not an error. Without this
 * check a user typing in the provider search would see an error toast for every
 * keystroke that superseded the previous request.
 *
 * @param {unknown} err The value an axios call rejected with.
 * @returns {boolean}
 */
export function isCanceled(err) {
  return axios.isCancel(err);
}

/**
 * Normalises anything a failed request can produce into one shape the UI can
 * render without further branching.
 *
 * Three quite different failures arrive here and have to come out looking the
 * same: an API error with a structured body, a network failure with no response
 * at all, and an unexpected server error.
 *
 * `code` is what callers should branch on — `SLOT_TAKEN` drives the "someone
 * just booked that" message on the booking page, `CANCELLATION_WINDOW_CLOSED`
 * explains a refused cancellation. `message` is prose and may be reworded by the
 * server at any time, so branching on it would be fragile.
 *
 * `NETWORK_ERROR` is synthesised here rather than coming from the server, for
 * the obvious reason that there was no server to send it: it means the request
 * never arrived, which is a different problem for the user (check your
 * connection) than a request that arrived and was refused.
 *
 * @param {unknown} err The rejection from an axios call.
 * @param {string} [fallback] Message to use when the server returned an error
 *   with no readable body.
 * @returns {{message: string, code: string, fieldErrors: Record<string,string>,
 *   status: number|null, details: *}} `fieldErrors` is keyed by field name so a
 *   form can attach each message to its own input; it is `{}` when the failure
 *   was not a validation error.
 */
export function parseApiError(err, fallback = "Something went wrong. Please try again.") {
  const response = err?.response;
  const data = response?.data;

  const fieldErrors = {};
  if (Array.isArray(data?.details)) {
    for (const detail of data.details) {
      if (detail?.field) fieldErrors[detail.field] = detail.message;
    }
  }

  return {
    message: data?.error || data?.message || (response ? fallback : "Cannot reach the server."),
    code: data?.code || (response ? "SERVER_ERROR" : "NETWORK_ERROR"),
    fieldErrors,
    status: response?.status ?? null,
    details: data?.details,
  };
}


/**
 * Resolves a stored image reference to something an `<img src>` can load.
 *
 * Uploads land in one of two places depending on how the server is configured,
 * and the database stores whichever it used: Cloudinary returns an absolute
 * https URL, while the local-disk fallback stores a path like
 * `/uploads/avatars/7_1717.jpg`. A component should not have to know which
 * backend produced the value it is rendering.
 *
 * `data:` and `blob:` pass through untouched so the same function can render a
 * just-picked file preview before it has been uploaded.
 *
 * @param {string|null|undefined} path Stored reference, absolute URL, or a
 *   local object/data URL.
 * @returns {string|null} A loadable URL, or null when there is no image — which
 *   callers use to fall back to an initials avatar rather than a broken image.
 */
export function imageUrl(path) {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

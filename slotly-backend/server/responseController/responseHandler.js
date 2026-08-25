/**
 * Standard API response envelope.
 *
 * Every response the API sends passes through one of these three helpers, so a
 * client only ever has to understand one shape:
 *
 *   success  { success: true,  message, data }
 *   error    { success: false, error, code, details? }
 *
 * `code` is the machine-readable half of an error and is the field clients
 * should branch on — `error` is prose for humans and may be reworded at any
 * time. The brief calls out one case specifically: losing the race for a slot
 * must be distinguishable from a generic failure, and it is, as
 * 409 + code "SLOT_TAKEN".
 */

/**
 * Canonical error codes. Kept in one place so the API docs and the React client
 * can be checked against the same list rather than against scattered strings.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  SLOT_TAKEN: "SLOT_TAKEN",
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  TIMEZONE_CONFLICT: "TIMEZONE_CONFLICT",
  // Too many requests from one address in the current window. Carries
  // `details.retryAfterSeconds` so the UI can say when to try again.
  RATE_LIMITED: "RATE_LIMITED",
  CANCELLATION_WINDOW_CLOSED: "CANCELLATION_WINDOW_CLOSED",
  // A client tried to move a booking after the cutoff. Distinct from
  // CANCELLATION_WINDOW_CLOSED so the UI can word the refusal correctly, even
  // though both share one deadline — see evaluateClientReschedule.
  RESCHEDULE_WINDOW_CLOSED: "RESCHEDULE_WINDOW_CLOSED",
  BOOKING_NOT_ACTIVE: "BOOKING_NOT_ACTIVE",
  // A client tried to move a booking whose service has been repriced or resized
  // since. Carries the old and new terms in `details` so the UI can show both
  // and ask; the move goes through once the request repeats with
  // `acceptChanges: true`. Nothing is written by the refusal — see
  // `describeRescheduleTerms`.
  SERVICE_TERMS_CHANGED: "SERVICE_TERMS_CHANGED",
  APPOINTMENT_NOT_STARTED: "APPOINTMENT_NOT_STARTED",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  INVALID_STATUS: "INVALID_STATUS",
  ACCOUNT_EXISTS: "ACCOUNT_EXISTS",
  WRONG_AUTH_METHOD: "WRONG_AUTH_METHOD",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",

  UPLOAD_REJECTED: "UPLOAD_REJECTED",
  RANGE_TOO_WIDE: "RANGE_TOO_WIDE",
  SERVICE_RETIRED: "SERVICE_RETIRED",
  ALREADY_ACTIVE: "ALREADY_ACTIVE",
  SERVER_ERROR: "SERVER_ERROR",
};

// MINIMUM_NOTICE_REQUIRED was removed for the same reason set out below: Slotly
// books in real time, so there is no notice rule left for any controller to
// refuse a booking under. The only remaining time floor is "that time has
// already passed", which is SLOT_UNAVAILABLE. See services/slotEngine.js.
//
// There was a SERVICE_IN_USE here, and the OpenAPI document advertised it, but
// nothing ever emitted it — deleting a service that has bookings is not an
// error, it retires the service and returns 200 with `retired: true`. A code
// that cannot occur is worse than no code: a client written against the
// published list branches on it and the branch is silently dead. Removed rather
// than implemented, because the success path is the correct behaviour.
// `tests/api.docs.test.js` now fails the build if this happens again.

/**
 * @param {import('express').Response} res
 * @param {string} message Human-readable summary.
 * @param {*} data Payload; defaults to an empty object rather than undefined so
 *   clients can always read `data` without a guard.
 * @param {number} statusCode
 */
export function successResponse(res, message = "Success", data = {}, statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

/**
 * @param {import('express').Response} res
 * @param {string} message Human-readable explanation.
 * @param {number} statusCode
 * @param {string} [code] One of ERROR_CODES. When omitted, a sensible default is
 *   derived from the status code so a call site that predates `code` still
 *   returns something a client can branch on.
 * @param {*} [details] Structured extra context (e.g. the conflicting booking).
 */
export function errorResponse(res, message = "Internal Server Error", statusCode = 500, code, details) {
  return res.status(statusCode).json({
    success: false,
    error: message,
    code: code || defaultCodeFor(statusCode),
    ...(details !== undefined && details !== null ? { details } : {}),
  });
}

/**
 * Field-level validation failure. Always 400.
 *
 * @param {Array<{field: string, message: string}>} details One entry per bad
 *   field, so the UI can attach each message to its own input rather than
 *   dumping a single string above the form.
 */
export function validationErrorResponse(res, message = "Validation failed", details = []) {
  return res.status(400).json({
    success: false,
    error: message,
    message,
    code: ERROR_CODES.VALIDATION_FAILED,
    details,
  });
}

function defaultCodeFor(statusCode) {
  switch (statusCode) {
    case 400:
      return ERROR_CODES.VALIDATION_FAILED;
    case 401:
      return ERROR_CODES.UNAUTHENTICATED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 409:
      return ERROR_CODES.CONFLICT;
    default:
      return ERROR_CODES.SERVER_ERROR;
  }
}

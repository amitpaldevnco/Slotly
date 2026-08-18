/**
 * Route-parameter validation.
 *
 * Every id in this API is a PostgreSQL `SERIAL`, so the only values that can
 * ever match a row are positive integers. Anything else is a malformed request,
 * and it has to be rejected *before* it reaches a query.
 *
 * ## Why this exists rather than letting the database complain
 *
 * `WHERE id = $1` with `'abc'` does not return zero rows — PostgreSQL raises
 * `invalid input syntax for type integer` (SQLSTATE 22P02). That is an
 * exception, not an empty result, so it unwinds into the controller's catch
 * block and is reported as `500 SERVER_ERROR`: the API blames itself for the
 * caller's typo, and a stack trace lands in the logs for every crawler that
 * requests `/api/bookings/index.php`.
 *
 * It is worth being precise about what this is *not*. The queries were never
 * injectable — every one of them is parameterised, so `1;DROP TABLE users`
 * travels as a value and is inert. This is a status-code and input-validation
 * fix, not a security patch.
 *
 * Registered with `router.param()` so it runs only when a route actually
 * captures that name, which keeps literal paths registered ahead of `/:id`
 * (`/bookings/summary`, `/bookings/unread-count`) out of its way.
 */
import { errorResponse, ERROR_CODES } from "../responseController/responseHandler.js";

/**
 * Parses a value that is supposed to be a database id.
 *
 * Deliberately stricter than `Number()`, which accepts a pile of things that
 * are not ids: `Number("")` is 0, `Number(" 12 ")` is 12, `Number("1e999")` is
 * Infinity, and `Number("12.5")` is a non-integer that PostgreSQL would then
 * refuse. Requiring the whole string to be digits rules all of that out in one
 * test, and the upper bound is `int4`'s ceiling, past which the column itself
 * would overflow.
 *
 * @param {unknown} value Raw path segment or query-string value.
 * @returns {number|null} The id, or null when `value` is not one.
 */
export function parseId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const text = String(value);
  if (!/^\d+$/.test(text)) return null;

  const id = Number(text);
  // 0 is never a SERIAL value, and 2147483647 is the largest int4.
  if (id < 1 || id > 2_147_483_647) return null;

  return id;
}

/**
 * Builds a `router.param` handler that rejects a non-numeric id with 400.
 *
 * The rejected value is not echoed back. It is attacker-controlled text and
 * reflecting it into a response body invites the usual games; the field name is
 * enough for a client to fix its own request.
 *
 * @param {string} name The parameter name, used in the field-level error.
 * @returns {import('express').RequestParamHandler}
 */
export function numericParam(name) {
  return (req, res, next, value) => {
    const id = parseId(value);

    if (id === null) {
      return errorResponse(res, `${name} must be a positive whole number`, 400, ERROR_CODES.VALIDATION_FAILED, [
        { field: name, message: `${name} must be a positive whole number` },
      ]);
    }

    // Hand the parsed number on so controllers compare a number to a number.
    // `req.params` values are always strings, and `booking.client_id === id`
    // against a string is silently false — the kind of bug that turns an
    // ownership check into an accidental 404.
    req.params[name] = id;
    next();
  };
}

/**
 * Applies `numericParam` to several parameter names on one router.
 *
 * @param {import('express').Router} router
 * @param {...string} names Parameter names, e.g. "id", "serviceId".
 */
export function registerNumericParams(router, ...names) {
  for (const name of names) router.param(name, numericParam(name));
}

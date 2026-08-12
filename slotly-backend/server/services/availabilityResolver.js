/**
 * Resolves which availability rows apply to a given service.
 *
 * A service either has its own dedicated weekly hours/exceptions
 * (`services.has_custom_availability = true`) or inherits the provider's
 * default ones (`service_id IS NULL` rows). Every caller that needs to know
 * "what hours apply here" — the slot engine's data layer, booking creation,
 * rescheduling, and the public availability endpoint — goes through this
 * module so the fallback rule lives in exactly one place.
 */
import { query } from "../config/dbConfig.js";

/**
 * @param {number} providerId
 * @param {number|null|undefined} serviceId
 * @returns {Promise<boolean>} True when `serviceId` has its own schedule.
 */
export async function serviceHasCustomAvailability(providerId, serviceId) {
  if (!serviceId) return false;

  const result = await query(
    "SELECT 1 FROM services WHERE id = $1 AND provider_id = $2 AND has_custom_availability",
    [serviceId, providerId]
  );
  return result.rows.length > 0;
}

/**
 * Loads the effective weekly rules and exceptions for a provider, optionally
 * scoped to one of their services.
 *
 * @param {object} args
 * @param {number} args.providerId
 * @param {number|null} [args.serviceId] Omit for the provider's own hours.
 * @param {string} [args.fromDate] "YYYY-MM-DD" — exceptions ending before this are skipped.
 * @param {string} [args.toDate] "YYYY-MM-DD" — exceptions starting after this are skipped.
 * @returns {Promise<{rules: Array, exceptions: Array, scope: "service"|"provider"}>}
 */
export async function getEffectiveAvailability({ providerId, serviceId, fromDate, toDate }) {
  const useServiceScope = await serviceHasCustomAvailability(providerId, serviceId);
  const scopeServiceId = useServiceScope ? serviceId : null;

  const ruleParams = scopeServiceId ? [providerId, scopeServiceId] : [providerId];
  const rulesResult = await query(
    `SELECT id, weekday, start_minute, end_minute FROM availability_rules
     WHERE provider_id = $1 AND service_id ${scopeServiceId ? "= $2" : "IS NULL"}
     ORDER BY weekday, start_minute`,
    ruleParams
  );

  const exceptionConditions = [`service_id ${scopeServiceId ? "= $2" : "IS NULL"}`];
  const exceptionParams = scopeServiceId ? [providerId, scopeServiceId] : [providerId];

  if (fromDate) {
    exceptionParams.push(fromDate);
    exceptionConditions.push(`end_date >= $${exceptionParams.length}::date`);
  }
  if (toDate) {
    exceptionParams.push(toDate);
    exceptionConditions.push(`start_date <= $${exceptionParams.length}::date`);
  }

  const exceptionsResult = await query(
    `SELECT id, kind, start_date, end_date, start_minute, end_minute, note
     FROM availability_exceptions
     WHERE provider_id = $1 AND ${exceptionConditions.join(" AND ")}
     ORDER BY start_date, start_minute NULLS FIRST`,
    exceptionParams
  );

  return {
    rules: rulesResult.rows,
    exceptions: exceptionsResult.rows,
    scope: scopeServiceId ? "service" : "provider",
  };
}

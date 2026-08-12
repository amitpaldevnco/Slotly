/**
 * Availability endpoints: a provider's recurring weekly hours and their one-off
 * exceptions.
 */
import { query, transaction } from "../config/dbConfig.js";
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
  ERROR_CODES,
} from "../responseController/responseHandler.js";
import { getEffectiveAvailability } from "../services/availabilityResolver.js";

/**
 * Confirms a service belongs to this provider before letting them scope a
 * write to it — otherwise a provider could set hours on someone else's
 * service by guessing its id.
 */
async function ownsService(serviceId, providerId) {
  const result = await query("SELECT 1 FROM services WHERE id = $1 AND provider_id = $2", [
    serviceId,
    providerId,
  ]);
  return result.rows.length > 0;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Parses "HH:MM" into minutes from midnight.
 *
 * Accepts "24:00" as 1440 so a provider can be available until midnight — the
 * one wall-clock reading that is legal here but not a real clock time.
 */
function parseTimeToMinutes(value) {
  if (typeof value !== "string") return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (minutes > 59) return null;
  if (hours === 24 && minutes === 0) return 1440;
  if (hours > 23) return null;

  return hours * 60 + minutes;
}

/** Renders minutes from midnight back as "HH:MM" for the API. */
function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** True for a "YYYY-MM-DD" string that names a date that actually exists. */
function isValidIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  // Round-tripping catches inputs that match the shape but are not real dates,
  // e.g. "2025-02-30", which Date happily rolls forward to 2 March.
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function serialiseRule(row) {
  return {
    id: row.id,
    weekday: row.weekday,
    weekdayName: WEEKDAY_NAMES[row.weekday],
    startTime: formatMinutes(row.start_minute),
    endTime: formatMinutes(row.end_minute),
  };
}

function serialiseException(row) {
  return {
    id: row.id,
    kind: row.kind,
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
    startTime: formatMinutes(row.start_minute),
    endTime: formatMinutes(row.end_minute),
    isAllDay: row.start_minute === null,
    note: row.note,
  };
}

/**
 * node-postgres parses DATE into a Date at *local* midnight. Calling
 * toISOString() on that would shift the calendar date by a day for anyone west
 * of UTC, so read the local fields instead.
 */
function toIsoDate(value) {
  if (typeof value === "string") return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * GET /api/providers/:id/availability — public.
 *
 * Public because the booking UI shows "this provider works Mon–Fri, 9 to 5"
 * before anyone signs in. It exposes hours, never bookings.
 */
export const getProviderAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const serviceId = req.query.serviceId ? Number(req.query.serviceId) : null;

    const provider = await query(
      "SELECT id, timezone, cancellation_cutoff_hours FROM users WHERE id = $1 AND role = 'provider'",
      [id]
    );
    if (provider.rows.length === 0) {
      return errorResponse(res, "Provider not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (serviceId && !(await ownsService(serviceId, id))) {
      return errorResponse(res, "Service not found for this provider", 404, ERROR_CODES.NOT_FOUND);
    }

    // Past exceptions are noise for every consumer of this endpoint, and left
    // unfiltered they would grow without bound. Anything that ended before
    // today is dropped.
    const { rules, exceptions, scope } = await getEffectiveAvailability({
      providerId: id,
      serviceId,
      fromDate: todayIso(),
    });

    return successResponse(res, "Availability fetched", {
      timezone: provider.rows[0].timezone,
      cancellationCutoffHours: provider.rows[0].cancellation_cutoff_hours,
      scope,
      rules: rules.map(serialiseRule),
      exceptions: exceptions.map(serialiseException),
    });
  } catch (err) {
    console.error("getProviderAvailability error:", err.message);
    return errorResponse(res, "Could not fetch availability", 500);
  }
};

/** Today's date as "YYYY-MM-DD" in UTC — good enough to drop obviously-past exceptions. */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * PUT /api/availability/rules — provider only.
 *
 * Body: { rules: [{ weekday, startTime, endTime }] }
 *
 * Replaces the entire weekly pattern in one transaction rather than exposing
 * per-row CRUD. The UI edits the week as a single grid, and a whole-week replace
 * means a half-applied save can never leave a provider with, say, Monday deleted
 * and Tuesday not yet written.
 *
 * Overlapping windows on one weekday are rejected in application code so the
 * client gets a field-level message; the database's exclusion constraint is
 * still there underneath as the real guarantee.
 */
export const replaceAvailabilityRules = async (req, res) => {
  try {
    const { rules } = req.body;
    const serviceId = req.body.serviceId ? Number(req.body.serviceId) : null;

    if (serviceId && !(await ownsService(serviceId, req.user.userId))) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "serviceId", message: "This is not your service" },
      ]);
    }

    if (!Array.isArray(rules)) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "rules", message: "rules must be an array" },
      ]);
    }
    if (rules.length > 50) {
      return validationErrorResponse(res, "Too many availability windows", [
        { field: "rules", message: "A week cannot have more than 50 windows" },
      ]);
    }

    const errors = [];
    const parsed = [];

    rules.forEach((rule, index) => {
      const weekday = Number(rule.weekday);
      const startMinute = parseTimeToMinutes(rule.startTime);
      const endMinute = parseTimeToMinutes(rule.endTime);

      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        errors.push({ field: `rules[${index}].weekday`, message: "Weekday must be 0 (Sunday) to 6 (Saturday)" });
        return;
      }
      if (startMinute === null) {
        errors.push({ field: `rules[${index}].startTime`, message: "Start time must be HH:MM" });
        return;
      }
      if (endMinute === null) {
        errors.push({ field: `rules[${index}].endTime`, message: "End time must be HH:MM" });
        return;
      }
      if (endMinute <= startMinute) {
        errors.push({
          field: `rules[${index}].endTime`,
          message: `${WEEKDAY_NAMES[weekday]}: end time must be after start time`,
        });
        return;
      }

      parsed.push({ weekday, startMinute, endMinute, index });
    });

    // Overlap check, per weekday. Sorting by start makes it a single linear pass
    // instead of comparing every pair.
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      const day = parsed.filter((r) => r.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < day.length; i += 1) {
        if (day[i].startMinute < day[i - 1].endMinute) {
          errors.push({
            field: `rules[${day[i].index}].startTime`,
            message: `${WEEKDAY_NAMES[weekday]}: this window overlaps another one`,
          });
        }
      }
    }

    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    const saved = await transaction(async (tx) => {
      await tx.query(
        `DELETE FROM availability_rules WHERE provider_id = $1 AND service_id ${serviceId ? "= $2" : "IS NULL"}`,
        serviceId ? [req.user.userId, serviceId] : [req.user.userId]
      );

      for (const rule of parsed) {
        await tx.query(
          `INSERT INTO availability_rules (provider_id, service_id, weekday, start_minute, end_minute)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.user.userId, serviceId, rule.weekday, rule.startMinute, rule.endMinute]
        );
      }

      // Saving rules for a service is what turns its custom schedule on — even
      // an empty list, which means "this service is deliberately closed" rather
      // than "no override configured".
      if (serviceId) {
        await tx.query("UPDATE services SET has_custom_availability = TRUE WHERE id = $1", [serviceId]);
      }

      const result = await tx.query(
        `SELECT * FROM availability_rules WHERE provider_id = $1 AND service_id ${serviceId ? "= $2" : "IS NULL"}
         ORDER BY weekday, start_minute`,
        serviceId ? [req.user.userId, serviceId] : [req.user.userId]
      );
      return result.rows;
    });

    return successResponse(res, "Weekly availability saved", { rules: saved.map(serialiseRule) });
  } catch (err) {
    // The exclusion constraint firing here means the overlap check above missed
    // something; surface it as a conflict rather than a 500.
    if (err.code === "23P01") {
      return errorResponse(
        res,
        "Two availability windows on the same day overlap",
        409,
        ERROR_CODES.CONFLICT
      );
    }
    console.error("replaceAvailabilityRules error:", err.message);
    return errorResponse(res, "Could not save availability", 500);
  }
};

/**
 * POST /api/availability/exceptions — provider only.
 *
 * Body: { kind, startDate, endDate?, startTime?, endTime?, note? }
 *
 * `kind: "block"` with no times blocks the whole day (or range). `kind: "open"`
 * requires an explicit window — see the schema comment for why.
 */
export const createAvailabilityException = async (req, res) => {
  try {
    const { kind, startDate, endDate, startTime, endTime, note } = req.body;
    const serviceId = req.body.serviceId ? Number(req.body.serviceId) : null;
    const errors = [];

    if (serviceId && !(await ownsService(serviceId, req.user.userId))) {
      errors.push({ field: "serviceId", message: "This is not your service" });
    }

    if (kind !== "block" && kind !== "open") {
      errors.push({ field: "kind", message: 'kind must be "block" or "open"' });
    }
    if (!isValidIsoDate(startDate)) {
      errors.push({ field: "startDate", message: "Start date must be a real date in YYYY-MM-DD form" });
    }

    // A single-day exception may omit endDate entirely.
    const resolvedEndDate = endDate || startDate;
    if (!isValidIsoDate(resolvedEndDate)) {
      errors.push({ field: "endDate", message: "End date must be a real date in YYYY-MM-DD form" });
    } else if (isValidIsoDate(startDate) && resolvedEndDate < startDate) {
      errors.push({ field: "endDate", message: "End date cannot be before the start date" });
    }

    // A range is bounded so one request cannot write a decade of blocked days.
    if (isValidIsoDate(startDate) && isValidIsoDate(resolvedEndDate)) {
      const spanDays =
        (Date.parse(`${resolvedEndDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
      if (spanDays > 365) {
        errors.push({ field: "endDate", message: "A single exception cannot span more than a year" });
      }
    }

    const hasWindow = startTime !== undefined && startTime !== null && startTime !== "";
    let startMinute = null;
    let endMinute = null;

    if (hasWindow) {
      startMinute = parseTimeToMinutes(startTime);
      endMinute = parseTimeToMinutes(endTime);

      if (startMinute === null) errors.push({ field: "startTime", message: "Start time must be HH:MM" });
      if (endMinute === null) errors.push({ field: "endTime", message: "End time must be HH:MM" });
      if (startMinute !== null && endMinute !== null && endMinute <= startMinute) {
        errors.push({ field: "endTime", message: "End time must be after start time" });
      }
    } else if (kind === "open") {
      errors.push({ field: "startTime", message: "Extra opening hours need a start and end time" });
    }

    if (typeof note === "string" && note.length > 255) {
      errors.push({ field: "note", message: "Note must be 255 characters or less" });
    }

    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    const inserted = await transaction(async (tx) => {
      const result = await tx.query(
        `INSERT INTO availability_exceptions
           (provider_id, service_id, kind, start_date, end_date, start_minute, end_minute, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [req.user.userId, serviceId, kind, startDate, resolvedEndDate, startMinute, endMinute, note || null]
      );

      // Adding a service-scoped exception is also a form of customizing that
      // service's schedule — see the note in replaceAvailabilityRules.
      if (serviceId) {
        await tx.query("UPDATE services SET has_custom_availability = TRUE WHERE id = $1", [serviceId]);
      }

      return result.rows[0];
    });

    return successResponse(res, "Exception added", serialiseException(inserted), 201);
  } catch (err) {
    console.error("createAvailabilityException error:", err.message);
    return errorResponse(res, "Could not add exception", 500);
  }
};

/**
 * DELETE /api/availability/rules/service/:serviceId — provider only.
 *
 * Removes a service's dedicated schedule entirely — its own weekly rules and
 * its own exceptions — and turns `has_custom_availability` back off, so the
 * service goes back to inheriting the provider's default hours.
 */
export const clearServiceAvailabilityOverride = async (req, res) => {
  try {
    const serviceId = Number(req.params.serviceId);

    if (!(await ownsService(serviceId, req.user.userId))) {
      return errorResponse(res, "Service not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await transaction(async (tx) => {
      await tx.query("DELETE FROM availability_rules WHERE service_id = $1", [serviceId]);
      await tx.query("DELETE FROM availability_exceptions WHERE service_id = $1", [serviceId]);
      await tx.query("UPDATE services SET has_custom_availability = FALSE WHERE id = $1", [serviceId]);
    });

    return successResponse(res, "This service now follows your default hours", { serviceId });
  } catch (err) {
    console.error("clearServiceAvailabilityOverride error:", err.message);
    return errorResponse(res, "Could not reset this service's hours", 500);
  }
};

/**
 * DELETE /api/availability/exceptions/:id — provider only.
 *
 * Ownership is checked in the WHERE clause rather than with a separate SELECT,
 * so there is no window between the check and the delete, and a provider cannot
 * delete another provider's exception by guessing an id.
 */
export const deleteAvailabilityException = async (req, res) => {
  try {
    const deleted = await query(
      "DELETE FROM availability_exceptions WHERE id = $1 AND provider_id = $2 RETURNING id",
      [req.params.id, req.user.userId]
    );

    if (deleted.rows.length === 0) {
      return errorResponse(res, "Exception not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return successResponse(res, "Exception removed", { id: Number(req.params.id) });
  } catch (err) {
    console.error("deleteAvailabilityException error:", err.message);
    return errorResponse(res, "Could not remove exception", 500);
  }
};

/**
 * PATCH /api/availability/settings — provider only.
 *
 * Body: { cancellationCutoffHours }
 *
 * Changing this only affects bookings made from now on: existing bookings carry
 * their own snapshot of the value.
 */
export const updateAvailabilitySettings = async (req, res) => {
  try {
    const hours = Number(req.body.cancellationCutoffHours);

    if (!Number.isInteger(hours) || hours < 0 || hours > 720) {
      return validationErrorResponse(res, "Please fix the errors below", [
        {
          field: "cancellationCutoffHours",
          message: "Cutoff must be a whole number of hours between 0 and 720",
        },
      ]);
    }

    const updated = await query(
      `UPDATE users SET cancellation_cutoff_hours = $1, updated_at = NOW()
       WHERE id = $2 RETURNING cancellation_cutoff_hours`,
      [hours, req.user.userId]
    );

    return successResponse(res, "Booking settings saved", {
      cancellationCutoffHours: updated.rows[0].cancellation_cutoff_hours,
    });
  } catch (err) {
    console.error("updateAvailabilitySettings error:", err.message);
    return errorResponse(res, "Could not save booking settings", 500);
  }
};

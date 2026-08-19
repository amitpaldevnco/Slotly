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
import { diagnoseSlotFeasibility } from "../services/slotEngine.js";
import { assessTimezoneChange, isResolvableTimezone } from "../services/timezoneChange.js";
import { parseId } from "../middleware/validateParams.js";

/**
 * Reads the optional `serviceId` from a request body.
 *
 * Absent means "scope this to my default hours", which is a legitimate and
 * common request — so absence is not an error. A value that is present but not
 * an id *is* an error, and has to be reported as one.
 *
 * The previous form, `req.body.serviceId ? Number(req.body.serviceId) : null`,
 * silently conflated the two: `Number("abc")` is `NaN`, `NaN` is falsy, and the
 * request went on to rewrite the provider's *default* weekly hours while the
 * caller believed it was editing one service's override. Failing loudly is the
 * only safe reading of an id nobody can parse.
 *
 * @param {object} body The request body.
 * @returns {{ok: true, serviceId: number|null} | {ok: false, error: {field: string, message: string}}}
 */
function readOptionalServiceId(body) {
  const raw = body?.serviceId;
  if (raw === undefined || raw === null || raw === "") return { ok: true, serviceId: null };

  const serviceId = parseId(raw);
  if (serviceId === null) {
    return {
      ok: false,
      error: { field: "serviceId", message: "serviceId must be a positive whole number" },
    };
  }
  return { ok: true, serviceId };
}

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

    // Same rule as the write paths: absent is fine, unparseable is a 400 rather
    // than a silent fall back to the provider's default hours.
    const scoped = readOptionalServiceId(req.query);
    if (!scoped.ok) return validationErrorResponse(res, "Please fix the errors below", [scoped.error]);
    const serviceId = scoped.serviceId;

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
 * Validates and normalises a submitted weekly pattern.
 *
 * Shared by the save endpoint and the dry-run validation endpoint so a draft the
 * provider is still editing is judged by exactly the same rules as the one they
 * eventually commit — a warning that appeared while typing can never turn out to
 * be wrong at save time, or vice versa.
 *
 * @param {Array<{weekday:*,startTime:*,endTime:*}>} rules Raw request rows.
 * @returns {{parsed: Array<{weekday:number,startMinute:number,endMinute:number,index:number}>,
 *            errors: Array<{field:string,message:string}>}}
 */
function parseWeeklyRules(rules) {
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

  return { parsed, errors };
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
    const scoped = readOptionalServiceId(req.body);
    if (!scoped.ok) return validationErrorResponse(res, "Please fix the errors below", [scoped.error]);
    const serviceId = scoped.serviceId;

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

    const { parsed, errors } = parseWeeklyRules(rules);

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

      // Saving rules for a service is what turns its own schedule on — but only
      // if there are actually rules. Clearing every day is how a provider says
      // "stop treating this service specially", so it hands the service back to
      // the default hours instead of leaving it with a schedule of no hours.
      //
      // The alternative reading — an empty week meaning "this service is
      // deliberately closed" — is what this used to do, and it is the worse of
      // the two. It is indistinguishable on screen from inheriting (both render
      // as an empty grid), it silently makes the service unbookable forever,
      // and it leaves no way back except the separate "Reset to default"
      // button. Deactivating the service is the clear way to close it.
      //
      // Service-scoped exceptions are left in place rather than deleted: they
      // are ignored while the service inherits, and come back if the provider
      // gives it hours again. Losing them to a save that says nothing about
      // exceptions would be a surprise. "Reset to default" still removes both.
      if (serviceId) {
        await tx.query("UPDATE services SET has_custom_availability = $2 WHERE id = $1", [
          serviceId,
          parsed.length > 0,
        ]);
      }

      const result = await tx.query(
        `SELECT * FROM availability_rules WHERE provider_id = $1 AND service_id ${serviceId ? "= $2" : "IS NULL"}
         ORDER BY weekday, start_minute`,
        serviceId ? [req.user.userId, serviceId] : [req.user.userId]
      );
      return result.rows;
    });

    const inheritsDefault = Boolean(serviceId) && parsed.length === 0;

    return successResponse(
      res,
      inheritsDefault ? "This service now follows your default hours" : "Weekly availability saved",
      {
        rules: saved.map(serialiseRule),
        // Lets the client tell "saved a schedule" from "handed this service back
        // to the default hours" without re-deriving it from an empty array.
        scope: serviceId && !inheritsDefault ? "service" : "provider",
        inheritsDefault,
      }
    );
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
 * POST /api/availability/validate — provider only.
 *
 * Body: { rules: [{ weekday, startTime, endTime }], serviceId? }
 *
 * A dry run: works out whether a weekly pattern would actually produce bookable
 * slots, and writes nothing. The provider UI calls this as the grid is edited so
 * a configuration that can only ever yield an empty calendar is caught *before*
 * it is saved, rather than being discovered later by a client who finds no times
 * to pick from.
 *
 * The reason this lives on the server rather than in the editor is that the
 * answer has to be the same answer. Slot generation is a real calculation —
 * a grid anchored at the window start, a legal band narrowed by both buffers,
 * and the interaction between them — and a second implementation in the browser
 * would be a second thing to keep in step. Here it delegates to
 * `diagnoseSlotFeasibility()`, which shares `candidateStartsInWindow()` with
 * `generateSlots()` itself, so "the provider was warned" and "the client sees
 * nothing" are guaranteed to agree.
 *
 * Which services are checked depends on scope, because that is what the saved
 * rules would govern:
 *   - `serviceId` given → just that service, which is getting its own hours.
 *   - omitted → every active service that inherits the default hours. A service
 *     with `has_custom_availability` is unaffected by the default pattern and
 *     reporting it here would be a false alarm.
 */
export const validateAvailabilityConfiguration = async (req, res) => {
  try {
    const { rules } = req.body;
    const scoped = readOptionalServiceId(req.body);
    if (!scoped.ok) return validationErrorResponse(res, "Please fix the errors below", [scoped.error]);
    const serviceId = scoped.serviceId;

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
    if (serviceId && !(await ownsService(serviceId, req.user.userId))) {
      return errorResponse(res, "Service not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const { parsed, errors } = parseWeeklyRules(rules);

    // A pattern that does not even parse cannot be diagnosed for slot yield, and
    // saying "these hours produce no slots" about times that are simply typed
    // wrong would be misleading. Report it as not-yet-checkable and let the
    // field-level errors the save endpoint returns do that job.
    if (errors.length > 0) {
      return successResponse(res, "Availability could not be checked yet", {
        checked: false,
        services: [],
      });
    }

    const engineRules = parsed.map((r) => ({
      weekday: r.weekday,
      start_minute: r.startMinute,
      end_minute: r.endMinute,
    }));

    const services = await query(
      `SELECT id, service_name, duration, buffer_before, buffer_after, slot_interval
       FROM services
       WHERE provider_id = $1 AND is_active
         ${serviceId ? "AND id = $2" : "AND NOT has_custom_availability"}
       ORDER BY service_name`,
      serviceId ? [req.user.userId, serviceId] : [req.user.userId]
    );

    const diagnosed = services.rows.map((service) => {
      const report = diagnoseSlotFeasibility({ rules: engineRules, service });
      return {
        serviceId: service.id,
        serviceName: service.service_name,
        ...report,
        problemDays: report.problemDays.map((day) => ({
          ...day,
          weekdayName: WEEKDAY_NAMES[day.weekday],
        })),
      };
    });

    return successResponse(res, "Availability checked", {
      checked: true,
      hasRules: engineRules.length > 0,
      services: diagnosed,
    });
  } catch (err) {
    console.error("validateAvailabilityConfiguration error:", err.message);
    return errorResponse(res, "Could not check this availability", 500);
  }
};

/**
 * GET /api/availability/health — provider only.
 *
 * The saved-state counterpart to `/validate`. That endpoint answers "would this
 * draft work?" while the provider is editing; this one answers "is what I have
 * saved right now actually working?", which is the question a dashboard needs.
 *
 * The difference that matters is scope resolution. `/validate` judges one
 * submitted weekly pattern, so every service it reports on is being measured
 * against the same rules. Here each service is measured against the rules that
 * genuinely apply to *it* — its own, if it has them, otherwise the provider's
 * default — because a provider whose default hours are fine can still have one
 * service quietly bookable-by-nobody, and that is exactly the case worth
 * surfacing.
 *
 * Only active services are considered. A retired service producing no slots is
 * not a problem to solve.
 */
/**
 * POST /api/availability/preview — provider only.
 *
 * Answers the question the service form cannot: *given the hours I already have
 * saved, how many appointments would these settings actually offer?*
 *
 * The mirror image of `/availability/validate`. That endpoint takes a draft
 * **pattern** and judges it against saved **services**; this takes a draft
 * **service** and judges it against saved **hours**. A provider setting a
 * duration and buffers has no way to know what those numbers do to their day
 * until they save and go and look at the booking page, and the interaction is
 * genuinely unobvious — a 09:00–17:00 day with a 90-minute service, 15-minute
 * buffers and a 30-minute grid does not yield the eight slots the arithmetic
 * suggests.
 *
 * Both endpoints route through `diagnoseSlotFeasibility()`, which walks the same
 * `candidateStartsInWindow()` the real slot list does, so the number previewed
 * here is the number that will be offered — not a second estimate that can
 * disagree with the first.
 *
 * ## What it deliberately ignores
 *
 * Bookings, one-off exceptions and the booking lead time. None of those are
 * things the provider can change from the form in front of them, and a day that
 * is empty only because it is fully booked is not a misconfiguration. The
 * question being answered is about the recurring weekly shape.
 *
 * Body: `{ duration, bufferBefore?, bufferAfter?, slotInterval?, serviceId? }`.
 * `serviceId` selects which hours apply — a service with its own schedule is
 * judged against that, everything else against the provider's default. Omit it
 * when previewing a service that does not exist yet.
 *
 * @returns 200 with the weekly shape: total slots, a per-weekday breakdown, and
 *   verified remedies when a day cannot yield anything. 400 for a duration that
 *   is not a positive number of minutes.
 */
export const previewServiceSlots = async (req, res) => {
  try {
    const scoped = readOptionalServiceId(req.body);
    if (!scoped.ok) return validationErrorResponse(res, "Please fix the errors below", [scoped.error]);
    const serviceId = scoped.serviceId;

    if (serviceId && !(await ownsService(serviceId, req.user.userId))) {
      return errorResponse(res, "Service not found", 404, ERROR_CODES.NOT_FOUND);
    }

    // Read with the same names the service endpoints accept, both spellings, so
    // the form can send exactly what it would send to save.
    const pick = (camel, snake) =>
      req.body[camel] !== undefined ? req.body[camel] : req.body[snake];

    const duration = Number.parseInt(pick("duration", "duration"), 10);
    if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "duration", message: "Duration must be a positive number of minutes" },
      ]);
    }

    const nonNegative = (value, fallback) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
    };

    const draft = {
      duration,
      buffer_before: nonNegative(pick("bufferBefore", "buffer_before"), 0),
      buffer_after: nonNegative(pick("bufferAfter", "buffer_after"), 0),
      slot_interval: nonNegative(pick("slotInterval", "slot_interval"), 30) || 30,
    };

    // The hours this service would actually be booked against. `serviceId` is
    // passed through so a service with its own schedule is judged against that
    // one rather than the provider's default.
    const { rules, scope } = await getEffectiveAvailability({
      providerId: req.user.userId,
      serviceId,
    });

    const engineRules = rules.map((rule) => ({
      weekday: rule.weekday,
      start_minute: rule.start_minute,
      end_minute: rule.end_minute,
    }));

    const report = diagnoseSlotFeasibility({ rules: engineRules, service: draft });

    return successResponse(res, "Slot preview computed", {
      scope,
      // False when the provider has no hours at all. The form needs to tell that
      // apart from "your hours cannot fit this service" — the first is answered
      // by going to the availability page, the second by changing these numbers.
      hasRules: engineRules.length > 0,
      config: report.config,
      minimumWindowMinutes: report.minimumWindowMinutes,
      bookable: report.bookable,
      totalSlotsPerWeek: report.totalSlotsPerWeek,
      days: report.days.map((day) => ({ ...day, weekdayName: WEEKDAY_NAMES[day.weekday] })),
      problemDays: report.problemDays.map((day) => ({
        ...day,
        weekdayName: WEEKDAY_NAMES[day.weekday],
      })),
      remedies: report.remedies,
    });
  } catch (err) {
    console.error("previewServiceSlots error:", err.message);
    return errorResponse(res, "Could not preview slots for this service", 500);
  }
};

export const getAvailabilityHealth = async (req, res) => {
  try {
    const providerId = req.user.userId;

    const services = await query(
      `SELECT id, service_name, duration, buffer_before, buffer_after, slot_interval
       FROM services
       WHERE provider_id = $1 AND is_active
       ORDER BY service_name`,
      [providerId]
    );

    // Sequential rather than parallel: this runs on a dashboard load, the row
    // count is a provider's service list rather than anything unbounded, and
    // each iteration is two indexed reads. Fanning out would add pool pressure
    // for no gain a provider could perceive.
    const reports = [];
    for (const service of services.rows) {
      const { rules, scope } = await getEffectiveAvailability({ providerId, serviceId: service.id });
      const report = diagnoseSlotFeasibility({ rules, service });

      reports.push({
        serviceId: service.id,
        serviceName: service.service_name,
        scope,
        hasRules: rules.length > 0,
        bookable: report.bookable,
        totalSlotsPerWeek: report.totalSlotsPerWeek,
        config: report.config,
        minimumWindowMinutes: report.minimumWindowMinutes,
        problemDays: report.problemDays.map((day) => ({
          ...day,
          weekdayName: WEEKDAY_NAMES[day.weekday],
        })),
        remedies: report.remedies,
      });
    }

    return successResponse(res, "Availability health checked", {
      services: reports,
      // Split apart because the two need different words. A service with no
      // hours anywhere needs "set your hours"; one with hours that cannot yield
      // a slot needs "your day is too short for this service".
      servicesWithoutHours: reports.filter((r) => !r.hasRules).map((r) => r.serviceName),
      misconfiguredServices: reports.filter((r) => r.hasRules && !r.bookable),
    });
  } catch (err) {
    console.error("getAvailabilityHealth error:", err.message);
    return errorResponse(res, "Could not check your availability", 500);
  }
};

/**
 * GET /api/availability/timezone-impact — provider only.
 *
 * Query: `timezone` (IANA).
 *
 * Answers "what would happen to my calendar if I moved to this zone?" without
 * changing anything. This is the *preview*: the UI calls it as soon as the
 * provider picks a zone from the list, so the affected appointments are on
 * screen before they press Save rather than after.
 *
 * It is not the guard. `PATCH /auth/profile` runs the same assessment again on
 * the write path, because a preview is advice — the provider's calendar can gain
 * a booking between looking and saving, and only the check next to the UPDATE
 * decides. Sharing one service means the two can never disagree about what
 * counts as a conflict.
 *
 * @returns 200 always when the zone is valid, with `safe` saying whether the
 *   change may go ahead. A conflict is not an error here — it is the answer to
 *   the question that was asked. 400 for a zone Luxon cannot resolve.
 */
export const getTimezoneChangeImpact = async (req, res) => {
  try {
    const timezone = req.query.timezone;

    if (!timezone) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "timezone", message: "Tell us which timezone you are considering" },
      ]);
    }
    if (!isResolvableTimezone(timezone)) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "timezone", message: "That is not a timezone we recognise" },
      ]);
    }

    const impact = await assessTimezoneChange({
      providerId: req.user.userId,
      timezone: String(timezone),
    });

    return successResponse(
      res,
      impact.safe ? "This timezone change is clear" : "This timezone change would strand appointments",
      impact
    );
  } catch (err) {
    console.error("getTimezoneChangeImpact error:", err.message);
    return errorResponse(res, "Could not check that timezone change", 500);
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
    const scoped = readOptionalServiceId(req.body);
    if (!scoped.ok) return validationErrorResponse(res, "Please fix the errors below", [scoped.error]);
    const serviceId = scoped.serviceId;
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

/**
 * Service endpoints: what a provider offers, and at what price and duration.
 *
 * ## What happens to bookings when a provider removes a service
 *
 * A service with bookings is never deleted, only retired (`is_active = false`).
 * It disappears from the public page and the slot picker immediately, so nobody
 * can book it again, but every existing appointment keeps working: the client
 * still sees it in their history, the provider still sees it on their calendar,
 * and the name and price shown are the ones snapshotted onto the booking rather
 * than read from the live row.
 *
 * Deleting outright would either orphan those bookings or cascade them away, and
 * silently erasing an appointment somebody is planning to attend is the worse
 * failure. A service nobody has ever booked is deleted properly — there is no
 * history to protect.
 */
import { query } from "../config/dbConfig.js";
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
  ERROR_CODES,
} from "../responseController/responseHandler.js";
import { validateUploadedImage, discardUpload } from "../utils/fileValidation.js";
import { storeImage, deleteImage } from "../services/imageStorage.js";
import { ACTIVE_STATUSES } from "../services/bookingRules.js";

/** Longest appointment the app accepts, in minutes. A day is plenty. */
const MAX_DURATION_MINUTES = 1440;
const MAX_BUFFER_MINUTES = 240;

/**
 * Validates the service fields on a create or update request.
 *
 * @param {object} body Raw request body. These requests are multipart/form-data,
 *   so every value arrives as a string and is coerced here rather than trusted.
 * @param {{partial: boolean}} options `partial: true` for PUT, where an absent
 *   field means "leave it alone" rather than "it is missing".
 * @returns {{errors: Array<{field:string,message:string}>, values: object}}
 *   `values` holds only the fields that were present and valid, keyed by column
 *   name so it can be spread straight into the UPDATE.
 */
function validateServiceFields(body, { partial }) {
  const errors = [];
  const values = {};
  const { service_name, description, price, duration, buffer_before, buffer_after } = body;

  if (!partial || service_name !== undefined) {
    if (!service_name || !String(service_name).trim()) {
      errors.push({ field: "service_name", message: "Service name is required" });
    } else if (String(service_name).trim().length > 255) {
      errors.push({ field: "service_name", message: "Service name must be 255 characters or less" });
    } else {
      values.service_name = String(service_name).trim();
    }
  }

  // 2000 rather than 1000: the details view renders this as a formatted
  // "what's included" list with line breaks preserved, and a genuine list of
  // inclusions plus a paragraph of context runs past a thousand characters
  // easily. The column is TEXT, so the cap is purely a sanity bound on input.
  if (description !== undefined) {
    if (String(description).length > 2000) {
      errors.push({ field: "description", message: "Description must be 2000 characters or less" });
    } else {
      values.description = String(description).trim() || null;
    }
  }

  if (!partial || price !== undefined) {
    const parsed = Number.parseFloat(price);
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.push({ field: "price", message: "Price must be zero or a positive number" });
    } else if (parsed > 1_000_000) {
      errors.push({ field: "price", message: "Price looks unreasonably high" });
    } else {
      values.price = parsed;
    }
  }

  if (!partial || duration !== undefined) {
    const parsed = Number.parseInt(duration, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push({ field: "duration", message: "Duration must be a positive number of minutes" });
    } else if (parsed > MAX_DURATION_MINUTES) {
      errors.push({ field: "duration", message: "Duration cannot exceed 24 hours" });
    } else {
      values.duration = parsed;
    }
  }

  // How far apart the offered start times are. Independent of duration — see
  // the slot engine's comment on the candidate grid for why.
  if (body.slot_interval !== undefined && body.slot_interval !== "") {
    const parsed = Number.parseInt(body.slot_interval, 10);
    if (!Number.isInteger(parsed) || parsed < 5 || parsed > 240) {
      errors.push({
        field: "slot_interval",
        message: "Slot interval must be between 5 and 240 minutes",
      });
    } else {
      values.slot_interval = parsed;
    }
  }

  for (const [column, raw] of [
    ["buffer_before", buffer_before],
    ["buffer_after", buffer_after],
  ]) {
    if (raw === undefined || raw === "") continue;

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.push({ field: column, message: "Buffer must be zero or a positive number of minutes" });
    } else if (parsed > MAX_BUFFER_MINUTES) {
      errors.push({ field: column, message: "Buffer cannot exceed 4 hours" });
    } else {
      values[column] = parsed;
    }
  }

  return { errors, values };
}

/**
 * Validates an uploaded cover image and hands it to the storage layer.
 *
 * Validation and storage are two steps on purpose: the file's real type is
 * decided here by sniffing its header, and only a file that passed reaches
 * `storeImage`, which is the only thing that knows whether it ends up in object
 * storage or on disk.
 *
 * @param {{path: string}} file The multer file.
 * @param {number} providerId Owner, used to name the stored object.
 * @returns {Promise<{ok: true, storedPath: string}|{ok: false, message: string}>}
 *   On failure the temporary file has already been removed.
 */
async function storeCoverImage(file, providerId) {
  const check = await validateUploadedImage(file, "service");
  if (!check.valid) {
    await discardUpload(file);
    return { ok: false, message: check.error };
  }

  const storedPath = await storeImage({
    file,
    kind: "service",
    extension: check.extension,
    ownerId: providerId,
  });

  return { ok: true, storedPath };
}

/** POST /api/services — verifyToken, requireProviderRole, uploadServiceImage. */
export const createService = async (req, res) => {
  try {
    const { errors, values } = validateServiceFields(req.body, { partial: false });

    if (errors.length > 0) {
      await discardUpload(req.file);
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    let coverImage = null;
    if (req.file) {
      const stored = await storeCoverImage(req.file, req.user.userId);
      if (!stored.ok) {
        return validationErrorResponse(res, stored.message, [
          { field: "coverImage", message: stored.message },
        ]);
      }
      coverImage = stored.storedPath;
    }

    const inserted = await query(
      `INSERT INTO services
         (provider_id, service_name, description, price, duration,
          buffer_before, buffer_after, slot_interval, cover_image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.user.userId,
        values.service_name,
        values.description ?? null,
        values.price,
        values.duration,
        values.buffer_before ?? 0,
        values.buffer_after ?? 0,
        values.slot_interval ?? 30,
        coverImage,
      ]
    );

    return successResponse(res, "Service created", inserted.rows[0], 201);
  } catch (err) {
    await discardUpload(req.file);
    console.error("createService error:", err.message);
    return errorResponse(res, "Could not create service", 500);
  }
};

/** PUT /api/services/:id — verifyToken, requireProviderRole, uploadServiceImage. */
export const updateService = async (req, res) => {
  try {
    const existing = await query("SELECT * FROM services WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      await discardUpload(req.file);
      return errorResponse(res, "Service not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const service = existing.rows[0];
    if (service.provider_id !== req.user.userId) {
      await discardUpload(req.file);
      return errorResponse(res, "This is not your service", 403, ERROR_CODES.FORBIDDEN);
    }

    const { errors, values } = validateServiceFields(req.body, { partial: true });
    if (errors.length > 0) {
      await discardUpload(req.file);
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    const updateData = { ...values };

    if (req.file) {
      const stored = await storeCoverImage(req.file, req.user.userId);
      if (!stored.ok) {
        return validationErrorResponse(res, stored.message, [
          { field: "coverImage", message: stored.message },
        ]);
      }
      // The old file is removed only once the new one is safely in place, so a
      // failure part-way through leaves the service with an image, not none.
      await deleteImage(service.cover_image);
      updateData.cover_image = stored.storedPath;
    }

    const columns = Object.keys(updateData);
    if (columns.length === 0) {
      return errorResponse(res, "Nothing to update", 400, ERROR_CODES.VALIDATION_FAILED);
    }

    const setClause = columns.map((col, idx) => `${col} = $${idx + 1}`).join(", ");
    const updated = await query(
      `UPDATE services SET ${setClause}, updated_at = NOW()
       WHERE id = $${columns.length + 1} RETURNING *`,
      [...Object.values(updateData), req.params.id]
    );

    // Editing duration or buffers changes future slots only. Existing bookings
    // keep the duration snapshotted onto them, so nobody's appointment silently
    // grows or shrinks under them.
    return successResponse(res, "Service updated", updated.rows[0]);
  } catch (err) {
    await discardUpload(req.file);
    console.error("updateService error:", err.message);
    return errorResponse(res, "Could not update service", 500);
  }
};

/**
 * DELETE /api/services/:id — verifyToken, requireProviderRole.
 *
 * Hard-deletes a service nobody has ever booked; retires one that has history.
 * The response says which happened so the UI can word its confirmation honestly
 * rather than claiming a deletion that did not occur.
 */
export const deleteService = async (req, res) => {
  try {
    const existing = await query("SELECT * FROM services WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return errorResponse(res, "Service not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const service = existing.rows[0];
    if (service.provider_id !== req.user.userId) {
      return errorResponse(res, "This is not your service", 403, ERROR_CODES.FORBIDDEN);
    }

    const bookings = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('booked','rescheduled') AND starts_at >= NOW())::int AS upcoming
       FROM bookings WHERE service_id = $1`,
      [service.id]
    );
    const { total, upcoming } = bookings.rows[0];

    if (total === 0) {
      await query("DELETE FROM services WHERE id = $1", [service.id]);
      await deleteImage(service.cover_image);
      return successResponse(res, "Service deleted", { id: service.id, deleted: true, retired: false });
    }

    await query("UPDATE services SET is_active = FALSE, updated_at = NOW() WHERE id = $1", [service.id]);

    return successResponse(
      res,
      upcoming > 0
        ? `Service retired. ${upcoming} upcoming booking${upcoming === 1 ? "" : "s"} will still go ahead.`
        : "Service retired. It is hidden from your page but kept for your booking history.",
      { id: service.id, deleted: false, retired: true, upcomingBookings: upcoming }
    );
  } catch (err) {
    console.error("deleteService error:", err.message);
    return errorResponse(res, "Could not remove service", 500);
  }
};

/**
 * GET /api/providers/:id/services — public.
 *
 * Retired services are hidden from everyone except the owning provider, who
 * needs to see them to make sense of their own booking history.
 *
 * The owner additionally gets each service's booking counts and earnings —
 * what they'd otherwise have to work out by filtering the bookings list one
 * service at a time. A stranger never sees another provider's earnings, so
 * these columns are left out of the public query entirely rather than hidden
 * client-side.
 */
export const getServicesByProvider = async (req, res) => {
  try {
    const isOwner = Boolean(req.user && Number(req.user.userId) === Number(req.params.id));

    const result = isOwner
      ? await query(
          `SELECT s.*,
                  COALESCE(b.total_bookings, 0)::int AS total_bookings,
                  COALESCE(b.completed_bookings, 0)::int AS completed_bookings,
                  COALESCE(b.upcoming_bookings, 0)::int AS upcoming_bookings,
                  COALESCE(b.total_earnings, 0) AS total_earnings
           FROM services s
           LEFT JOIN (
             SELECT service_id,
                    COUNT(*) AS total_bookings,
                    COUNT(*) FILTER (WHERE status = 'completed') AS completed_bookings,
                    COUNT(*) FILTER (WHERE status = ANY($2) AND starts_at >= NOW()) AS upcoming_bookings,
                    SUM(price_snapshot) FILTER (WHERE status = 'completed') AS total_earnings
             FROM bookings
             GROUP BY service_id
           ) b ON b.service_id = s.id
           WHERE s.provider_id = $1
           ORDER BY s.is_active DESC, s.created_at DESC`,
          [req.params.id, ACTIVE_STATUSES]
        )
      : await query(
          `SELECT * FROM services WHERE provider_id = $1 AND is_active
           ORDER BY created_at DESC`,
          [req.params.id]
        );

    return successResponse(res, "Services fetched", result.rows);
  } catch (err) {
    console.error("getServicesByProvider error:", err.message);
    return errorResponse(res, "Could not fetch services", 500);
  }
};

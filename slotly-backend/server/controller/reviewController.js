/**
 * Reviews: a client's feedback on one completed appointment, and the provider's
 * reply to it.
 *
 * ## The four rules, and where each is enforced
 *
 * 1. **Only the client of the booking may review it.** Checked against
 *    `bookings.client_id`, from the session — a provider cannot review their own
 *    work and a stranger cannot review at all.
 * 2. **Only a `completed` booking may be reviewed.** Not `cancelled` (it never
 *    happened), not `booked`/`rescheduled` (it has not happened yet), and
 *    notably **not `no_show`** — a client who did not attend has nothing to
 *    report. Checked here, because it depends on the booking's current status.
 * 3. **One review per booking.** Enforced by `UNIQUE (booking_id)` in the
 *    database, not by a read-then-insert in application code, so two concurrent
 *    submissions cannot both land. The unique violation is caught and reported
 *    as a specific 409 rather than a generic failure.
 * 4. **Only the provider being reviewed may reply**, and only once — a reply is
 *    a column on the review, so a second reply overwrites rather than accumulates.
 *
 * ## What is public
 *
 * The rating, the comment, the reply, the date, and the reviewer's **first name
 * only**. Never their email, phone number, or which other appointments they have
 * had. A review is published feedback; it is not a licence to enumerate a
 * provider's clients.
 */
import { query } from "../config/dbConfig.js";
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
  ERROR_CODES,
} from "../responseController/responseHandler.js";

const MAX_COMMENT_LENGTH = 1000;
const MAX_REPLY_LENGTH = 1000;

/**
 * The one status a booking must hold to be reviewable.
 *
 * Kept as a named constant next to the reasoning rather than inlined, because
 * "why isn't no_show in here?" is the question a reader will have.
 */
const REVIEWABLE_STATUS = "completed";

/**
 * Shows only the part of a name that is safe to publish.
 *
 * "Alex Mercer" becomes "Alex". A full name plus a date plus a service is enough
 * to identify someone to an acquaintance; a first name carries the human warmth
 * of a signed review without that.
 */
function publicFirstName(fullName) {
  const first = String(fullName || "").trim().split(/\s+/)[0];
  return first || "A client";
}

function serialiseReview(row, { viewerId } = {}) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    rating: row.rating,
    comment: row.comment,
    providerReply: row.provider_reply,
    repliedAt: row.replied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    serviceName: row.service_name_snapshot ?? null,
    author: { firstName: publicFirstName(row.client_name) },
    // Lets the UI offer "edit your review" without comparing ids itself.
    isMine: viewerId != null && row.client_id === viewerId,
  };
}

/**
 * POST /api/bookings/:id/review — the booking's client only.
 *
 * Body: { rating (1–5), comment? }
 */
export const createReview = async (req, res) => {
  try {
    const booking = await query(
      "SELECT id, client_id, provider_id, status FROM bookings WHERE id = $1",
      [req.params.id]
    );
    if (booking.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const row = booking.rows[0];

    // 404 rather than 403 for a non-party, matching every other booking
    // endpoint: confirming the booking exists would leak it.
    if (row.client_id !== req.user.userId) {
      if (row.provider_id === req.user.userId) {
        return errorResponse(
          res,
          "Only the client can review an appointment",
          403,
          ERROR_CODES.FORBIDDEN
        );
      }
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (row.status !== REVIEWABLE_STATUS) {
      return errorResponse(
        res,
        row.status === "no_show"
          ? "This appointment is marked as a no-show, so it cannot be reviewed."
          : "You can review an appointment once it has been completed.",
        409,
        ERROR_CODES.BOOKING_NOT_ACTIVE
      );
    }

    const errors = [];
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      errors.push({ field: "rating", message: "Choose a rating from 1 to 5 stars" });
    }

    const comment = typeof req.body.comment === "string" ? req.body.comment.trim() : "";
    if (comment.length > MAX_COMMENT_LENGTH) {
      errors.push({
        field: "comment",
        message: `Review must be ${MAX_COMMENT_LENGTH} characters or less`,
      });
    }
    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    const inserted = await query(
      `INSERT INTO reviews (booking_id, provider_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [row.id, row.provider_id, rating, comment || null]
    );

    return successResponse(
      res,
      "Thanks for the feedback",
      serialiseReview({ ...inserted.rows[0], client_id: row.client_id }, { viewerId: req.user.userId }),
      201
    );
  } catch (err) {
    // 23505 is the UNIQUE(booking_id) constraint: this appointment already has a
    // review. A specific, actionable 409 — the UI switches to editing the
    // existing one — rather than a generic 500.
    if (err.code === "23505") {
      return errorResponse(
        res,
        "You have already reviewed this appointment. You can edit your review instead.",
        409,
        ERROR_CODES.CONFLICT
      );
    }
    console.error("createReview error:", err.message);
    return errorResponse(res, "Could not save your review", 500);
  }
};

/**
 * PATCH /api/reviews/:id — the review's author only.
 *
 * Changing your mind edits your one review rather than adding a second, which is
 * what keeps `UNIQUE (booking_id)` honest and the provider's average meaningful.
 */
export const updateReview = async (req, res) => {
  try {
    const existing = await query(
      `SELECT r.*, b.client_id
       FROM reviews r JOIN bookings b ON b.id = r.booking_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return errorResponse(res, "Review not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (existing.rows[0].client_id !== req.user.userId) {
      return errorResponse(res, "Review not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const errors = [];
    const updates = {};

    if (req.body.rating !== undefined) {
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        errors.push({ field: "rating", message: "Choose a rating from 1 to 5 stars" });
      } else {
        updates.rating = rating;
      }
    }

    if (req.body.comment !== undefined) {
      const comment = String(req.body.comment).trim();
      if (comment.length > MAX_COMMENT_LENGTH) {
        errors.push({
          field: "comment",
          message: `Review must be ${MAX_COMMENT_LENGTH} characters or less`,
        });
      } else {
        updates.comment = comment || null;
      }
    }

    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    const columns = Object.keys(updates);
    if (columns.length === 0) {
      return errorResponse(res, "Nothing to update", 400, ERROR_CODES.VALIDATION_FAILED);
    }

    // Column names come from the fixed allow-list above, never from request keys;
    // every value is still a bound parameter.
    const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(", ");
    const updated = await query(
      `UPDATE reviews SET ${setClause}, updated_at = NOW()
       WHERE id = $${columns.length + 1} RETURNING *`,
      [...Object.values(updates), req.params.id]
    );

    return successResponse(
      res,
      "Review updated",
      serialiseReview({ ...updated.rows[0], client_id: req.user.userId }, { viewerId: req.user.userId })
    );
  } catch (err) {
    console.error("updateReview error:", err.message);
    return errorResponse(res, "Could not update your review", 500);
  }
};

/**
 * POST /api/reviews/:id/reply — the reviewed provider only.
 *
 * Body: { reply }
 *
 * Ownership is checked against `reviews.provider_id`, so a provider cannot reply
 * to a review of somebody else's work.
 */
export const replyToReview = async (req, res) => {
  try {
    const existing = await query("SELECT id, provider_id FROM reviews WHERE id = $1", [
      req.params.id,
    ]);
    if (existing.rows.length === 0) {
      return errorResponse(res, "Review not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (existing.rows[0].provider_id !== req.user.userId) {
      return errorResponse(
        res,
        "Only the provider being reviewed can reply",
        403,
        ERROR_CODES.FORBIDDEN
      );
    }

    const reply = typeof req.body.reply === "string" ? req.body.reply.trim() : "";
    if (!reply) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "reply", message: "Write a reply first" },
      ]);
    }
    if (reply.length > MAX_REPLY_LENGTH) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "reply", message: `Reply must be ${MAX_REPLY_LENGTH} characters or less` },
      ]);
    }

    // `updated_at` is deliberately NOT touched here. It means "the review text was
    // changed by its author", and the UI prints "(edited)" from it — so bumping it
    // when the *provider* replies would tell every reader that the client had
    // revised their review, which is untrue. `replied_at` is the reply's own
    // timestamp and is the only thing that should move.
    const updated = await query(
      `UPDATE reviews SET provider_reply = $1, replied_at = NOW()
       WHERE id = $2 RETURNING *`,
      [reply, req.params.id]
    );

    return successResponse(res, "Reply posted", serialiseReview(updated.rows[0]));
  } catch (err) {
    console.error("replyToReview error:", err.message);
    return errorResponse(res, "Could not post your reply", 500);
  }
};

/**
 * GET /api/providers/:id/reviews — public.
 *
 * Returns the aggregate and the most recent reviews. `attachUserIfPresent` runs
 * first, so a signed-in client's own review is flagged `isMine` and the UI can
 * offer to edit it, without the page comparing ids.
 *
 * Capped at 50 rather than paginated: consistent with the rest of the app's
 * read endpoints, and honest about the limitation in the README.
 */
export const listProviderReviews = async (req, res) => {
  try {
    const provider = await query("SELECT id FROM users WHERE id = $1 AND role = 'provider'", [
      req.params.id,
    ]);
    if (provider.rows.length === 0) {
      return errorResponse(res, "Provider not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const rows = await query(
      `SELECT r.*, b.client_id, b.service_name_snapshot, c.name AS client_name
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       JOIN users c ON c.id = b.client_id
       WHERE r.provider_id = $1
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [req.params.id]
    );

    const summary = await query(
      `SELECT COUNT(*)::int AS count,
              ROUND(AVG(rating)::numeric, 1) AS average
       FROM reviews WHERE provider_id = $1`,
      [req.params.id]
    );

    return successResponse(res, "Reviews fetched", {
      // `average` is null with no reviews rather than 0, so the UI shows nothing
      // instead of "0.0 stars", which reads as a terrible score rather than as
      // an absence of data.
      summary: {
        count: summary.rows[0].count,
        average: summary.rows[0].average === null ? null : Number(summary.rows[0].average),
      },
      reviews: rows.rows.map((row) => serialiseReview(row, { viewerId: req.user?.userId })),
    });
  } catch (err) {
    console.error("listProviderReviews error:", err.message);
    return errorResponse(res, "Could not fetch reviews", 500);
  }
};

/**
 * GET /api/bookings/:id/review — the two parties only.
 *
 * Whether this appointment has been reviewed, and by whom, so the booking page
 * can show either the review or the prompt to leave one.
 */
export const getBookingReview = async (req, res) => {
  try {
    const booking = await query(
      "SELECT id, client_id, provider_id, status FROM bookings WHERE id = $1",
      [req.params.id]
    );
    if (booking.rows.length === 0) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const row = booking.rows[0];
    const isParty = row.client_id === req.user.userId || row.provider_id === req.user.userId;
    if (!isParty) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const review = await query(
      `SELECT r.*, b.client_id, b.service_name_snapshot, c.name AS client_name
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       JOIN users c ON c.id = b.client_id
       WHERE r.booking_id = $1`,
      [row.id]
    );

    return successResponse(res, "Review fetched", {
      // Drives which of the three states the UI shows: leave one, view yours, or
      // "not reviewable yet".
      canReview: row.client_id === req.user.userId && row.status === REVIEWABLE_STATUS,
      bookingStatus: row.status,
      review:
        review.rows.length > 0
          ? serialiseReview(review.rows[0], { viewerId: req.user.userId })
          : null,
    });
  } catch (err) {
    console.error("getBookingReview error:", err.message);
    return errorResponse(res, "Could not fetch review", 500);
  }
};

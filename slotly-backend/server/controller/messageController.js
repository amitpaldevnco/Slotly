/**
 * The conversation attached to one booking.
 *
 * ## Authorization is the whole story here
 *
 * A booking thread must be reachable by exactly two people — the client who
 * booked and the provider who is delivering — and by nobody else, ever. That is
 * enforced by `assertParticipant()` below, which loads the booking and compares
 * the caller against its own `client_id` and `provider_id`. There is no notion of
 * "conversation membership" to get out of step with the booking, because the
 * booking's two foreign keys *are* the membership list.
 *
 * A stranger gets **404, not 403**, matching the convention already used by
 * `getBooking`: replying "forbidden" would confirm that a booking exists at that
 * id, which is itself a leak about a provider's calendar.
 *
 * Nothing here is hidden only in the UI. Every read and every write re-derives
 * the caller's relationship to the row it is about to touch.
 *
 * ## What this deliberately is not
 *
 * Not a general messaging system. There is no user-to-user thread, no contact
 * list, and no way to start a conversation without a booking — the appointment is
 * the reason the two people are talking, and it is also what makes the
 * permission question answerable.
 */
import { query } from "../config/dbConfig.js";
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
  ERROR_CODES,
} from "../responseController/responseHandler.js";
import { describeInstant } from "../services/bookingRules.js";

/** Longest single message. Matches the column's VARCHAR(2000). */
const MAX_BODY_LENGTH = 2000;

/**
 * Loads a booking and works out how the caller relates to it.
 *
 *   null when the booking does not exist *or* the caller is not one of its two
 *   parties. Both cases are reported identically to the caller on purpose.
 */
async function assertParticipant(bookingId, userId) {
  const result = await query(
    `SELECT b.id, b.client_id, b.provider_id, b.status, b.starts_at,
            b.service_name_snapshot,
            c.name AS client_name, c.avatar_url AS client_avatar, c.timezone AS client_timezone,
            p.name AS provider_name, p.business_name AS provider_business_name,
            p.avatar_url AS provider_avatar, p.timezone AS provider_timezone
     FROM bookings b
     JOIN users c ON c.id = b.client_id
     JOIN users p ON p.id = b.provider_id
     WHERE b.id = $1`,
    [bookingId]
  );

  if (result.rows.length === 0) return null;

  const booking = result.rows[0];
  if (booking.client_id === userId) return { booking, viewerRole: "client" };
  if (booking.provider_id === userId) return { booking, viewerRole: "provider" };
  return null;
}

/**
 * Shapes one message for the API.
 *
 * `senderRole` is derived from the booking rather than stored, and `isMine` is
 * computed per request so the UI can align a bubble without comparing ids
 * itself.
 */
function serialiseMessage(row, { booking, viewerId }) {
  const senderRole = row.sender_id === booking.client_id ? "client" : "provider";

  return {
    id: row.id,
    body: row.body,
    senderId: row.sender_id,
    senderRole,
    senderName: senderRole === "client" ? booking.client_name : booking.provider_name,
    senderAvatarUrl: senderRole === "client" ? booking.client_avatar : booking.provider_avatar,
    isMine: row.sender_id === viewerId,
    createdAt: row.created_at,
    // Both parties' readings of the same instant, exactly as booking payloads do
    // it, so no client has to convert a timezone itself. These use each party's
    // *current* zone, read live from their user row — a message shown at 10:12 AM
    // must follow its reader when they change timezone, for the same reason an
    // appointment does.
    createdAtLocal: describeInstant(row.created_at, booking.client_timezone, booking.provider_timezone),
    readAt: row.read_at,
  };
}

/**
 * GET /api/bookings/:id/messages — the two parties only.
 *
 * Also marks every message the caller did *not* send as read, which is what
 * clears their unread badge. Opening the thread is the only thing that counts as
 * reading it; there is no separate "mark read" call to forget to make.
 */
export const listMessages = async (req, res) => {
  try {
    const access = await assertParticipant(req.params.id, req.user.userId);
    if (!access) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const { booking, viewerRole } = access;

    // Marked before the SELECT so the response already reflects the new state —
    // otherwise the client would render an unread badge it has just cleared.
    await query(
      `UPDATE booking_messages
       SET read_at = NOW()
       WHERE booking_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [booking.id, req.user.userId]
    );

    const messages = await query(
      `SELECT id, sender_id, body, created_at, read_at
       FROM booking_messages
       WHERE booking_id = $1
       ORDER BY created_at ASC, id ASC`,
      [booking.id]
    );

    const other =
      viewerRole === "client"
        ? {
            name: booking.provider_business_name || booking.provider_name,
            personName: booking.provider_name,
            avatarUrl: booking.provider_avatar,
            timezone: booking.provider_timezone,
            role: "provider",
          }
        : {
            name: booking.client_name,
            personName: booking.client_name,
            avatarUrl: booking.client_avatar,
            timezone: booking.client_timezone,
            role: "client",
          };

    return successResponse(res, "Messages fetched", {
      viewerRole,
      // Enough booking context that the conversation can be shown standalone,
      // without the caller needing a second request to say what it is about.
      booking: {
        id: booking.id,
        status: booking.status,
        startsAt: booking.starts_at,
        serviceName: booking.service_name_snapshot,
      },
      otherParty: other,
      count: messages.rows.length,
      messages: messages.rows.map((row) =>
        serialiseMessage(row, { booking, viewerId: req.user.userId })
      ),
    });
  } catch (err) {
    console.error("listMessages error:", err.message);
    return errorResponse(res, "Could not load messages", 500);
  }
};

/**
 * POST /api/bookings/:id/messages — the two parties only.
 *
 * Body: { body }
 *
 * Deliberately allowed on a booking of *any* status, including cancelled: a
 * client whose appointment was called off is exactly the person most likely to
 * have a question about it, and locking the thread at that moment would be
 * unkind for no security benefit.
 */
export const sendMessage = async (req, res) => {
  try {
    const access = await assertParticipant(req.params.id, req.user.userId);
    if (!access) {
      return errorResponse(res, "Booking not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const { booking } = access;
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";

    if (!body) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "body", message: "Write a message first" },
      ]);
    }
    if (body.length > MAX_BODY_LENGTH) {
      return validationErrorResponse(res, "Please fix the errors below", [
        { field: "body", message: `Messages must be ${MAX_BODY_LENGTH} characters or less` },
      ]);
    }

    // `sender_id` comes from the session, never from the body, so writing a
    // message as somebody else is not expressible in the request at all.
    const inserted = await query(
      `INSERT INTO booking_messages (booking_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, body, created_at, read_at`,
      [booking.id, req.user.userId, body]
    );

    return successResponse(
      res,
      "Message sent",
      serialiseMessage(inserted.rows[0], { booking, viewerId: req.user.userId }),
      201
    );
  } catch (err) {
    console.error("sendMessage error:", err.message);
    return errorResponse(res, "Could not send message", 500);
  }
};

/**
 * GET /api/bookings/unread-count — any signed-in user.
 *
 * Drives the badge in the navigation and the per-conversation dot in the inbox.
 * Scoped in SQL to bookings the caller is a party to, so there is no request
 * shape that counts somebody else's messages.
 *
 * Grouped by booking rather than counted flat: the totals are then summed from
 * the groups, which keeps one query serving both readings and makes the
 * per-thread figure impossible to disagree with the badge. This is the exact
 * shape `idx_booking_messages_unread` — partial on `(booking_id, sender_id)
 * WHERE read_at IS NULL` — was built for, so grouping costs nothing over the
 * flat count it replaces.
 *
 * Must be registered before `GET /:id/messages` style routes that could match
 * "unread-count" as an id — the same ordering `/bookings/summary` already needs.
 */
/**
 * GET /api/bookings/recent-messages — any signed-in user.
 *
 * The most recently active conversations this person is part of: one row per
 * thread, carrying the latest message in it, newest thread first.
 *
 * ## Why this endpoint exists
 *
 * The provider dashboard has a "Recent Messages" panel which, until this was
 * added, had no message data to draw. It listed *upcoming bookings* instead and
 * timestamped each row with the appointment's `startsAt` — so a panel headed
 * "Recent Messages" showed rows reading "in 2 days", describing a message that
 * had not been sent, at a time in the future. The ordering was by appointment
 * date too, which has nothing to do with which conversation was last active.
 *
 * A cross-booking aggregate rather than a per-thread read, so it sits beside
 * `/bookings/unread-count` rather than under `/bookings/:id`, matching the
 * convention already in the routes.
 *
 * ## Reading this must not mark anything read
 *
 * Deliberately a preview, not a thread view. `listMessages` marks the other
 * party's messages read as a side effect of opening a thread, which is right
 * there and would be wrong here: glancing at a dashboard is not reading your
 * messages, and clearing someone's unread badge because a summary rendered
 * would lose them the only signal they had.
 *
 * @returns 200 with `{ conversations }`. Each carries the other party, a
 *   truncated preview, who sent it, when, and the thread's unread count.
 */
export const getRecentConversations = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);

    // `DISTINCT ON (booking_id)` with a matching ORDER BY is Postgres's way of
    // saying "one row per thread, the newest one" without a window function or a
    // correlated subquery. The outer query then re-sorts those winners by time,
    // because DISTINCT ON forces the inner sort to lead with booking_id.
    //
    // The `id DESC` tiebreak matters: two messages can share a created_at at
    // millisecond precision, and without it the "latest" would be arbitrary.
    const result = await query(
      `WITH latest AS (
         SELECT DISTINCT ON (m.booking_id)
                m.booking_id, m.body, m.created_at, m.sender_id
         FROM booking_messages m
         JOIN bookings b ON b.id = m.booking_id
         WHERE b.client_id = $1 OR b.provider_id = $1
         ORDER BY m.booking_id, m.created_at DESC, m.id DESC
       )
       SELECT l.booking_id, l.body, l.created_at, l.sender_id,
              b.client_id, b.provider_id, b.service_name_snapshot, b.starts_at, b.status,
              c.name AS client_name, c.avatar_url AS client_avatar,
              p.name AS provider_name, p.business_name AS provider_business_name,
              p.avatar_url AS provider_avatar,
              (SELECT COUNT(*)::int
                 FROM booking_messages u
                WHERE u.booking_id = l.booking_id
                  AND u.sender_id <> $1
                  AND u.read_at IS NULL) AS unread
       FROM latest l
       JOIN bookings b ON b.id = l.booking_id
       JOIN users c ON c.id = b.client_id
       JOIN users p ON p.id = b.provider_id
       ORDER BY l.created_at DESC
       LIMIT $2`,
      [req.user.userId, limit]
    );

    const conversations = result.rows.map((row) => {
      const viewerIsClient = row.client_id === req.user.userId;

      return {
        bookingId: row.booking_id,
        serviceName: row.service_name_snapshot,
        bookingStartsAt: row.starts_at,
        bookingStatus: row.status,
        // Whoever the viewer is talking *to*. A thread has exactly two parties,
        // so "the other one" is fully determined.
        withUser: viewerIsClient
          ? {
              id: row.provider_id,
              name: row.provider_business_name || row.provider_name,
              avatarUrl: row.provider_avatar,
            }
          : { id: row.client_id, name: row.client_name, avatarUrl: row.client_avatar },
        lastMessage: {
          // Truncated server-side: the panel shows one line, and sending the
          // full 2000 characters so the browser can hide them is waste on every
          // dashboard load.
          preview: row.body.length > 120 ? `${row.body.slice(0, 119)}…` : row.body,
          at: row.created_at,
          // Lets the UI write "You: …", which is what makes a thread list
          // readable at a glance.
          fromMe: row.sender_id === req.user.userId,
        },
        unread: row.unread,
      };
    });

    return successResponse(res, "Recent conversations fetched", { conversations });
  } catch (err) {
    console.error("getRecentConversations error:", err.message);
    return errorResponse(res, "Could not fetch recent conversations", 500);
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const result = await query(
      `SELECT m.booking_id, COUNT(*)::int AS unread
       FROM booking_messages m
       JOIN bookings b ON b.id = m.booking_id
       WHERE (b.client_id = $1 OR b.provider_id = $1)
         AND m.sender_id <> $1
         AND m.read_at IS NULL
       GROUP BY m.booking_id`,
      [req.user.userId]
    );

    // Keys are booking ids. JSON object keys are strings whatever is put in
    // them, so the client has to look these up by String(id) — stated here
    // because the alternative is a silently empty lookup on the other side.
    const byBooking = {};
    let unread = 0;

    for (const row of result.rows) {
      byBooking[row.booking_id] = row.unread;
      unread += row.unread;
    }

    return successResponse(res, "Unread count fetched", {
      unread,
      threads: result.rows.length,
      byBooking,
    });
  } catch (err) {
    console.error("getUnreadCount error:", err.message);
    return errorResponse(res, "Could not fetch unread count", 500);
  }
};

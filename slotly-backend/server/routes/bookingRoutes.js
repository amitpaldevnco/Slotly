/**
 * Booking routes. Every one requires a session.
 *
 * Role checks are deliberately *not* done with middleware here, because they are
 * not uniform: creating requires a client, rescheduling requires the provider,
 * and cancelling is open to either party under different rules. Each handler
 * therefore derives the caller's relationship to the specific booking row it is
 * about to touch, which is the only check that is actually correct.
 */
import express from "express";
import {
  createBooking,
  listBookings,
  getBookingSummary,
  getBooking,
  cancelBooking,
  rescheduleBooking,
  updateBookingStatus,
  getBookingCounts,
} from "../controller/bookingController.js";
import {
  listMessages,
  sendMessage,
  getUnreadCount,
  getRecentConversations,
} from "../controller/messageController.js";
import { createReview, getBookingReview } from "../controller/reviewController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { registerNumericParams } from "../middleware/validateParams.js";

const router = express.Router();

router.use(verifyToken);

// Rejects "/api/bookings/abc" with 400 instead of letting it reach a query and
// surface as a 500. Only fires for routes that actually capture `:id`, so the
// literal paths registered below are unaffected.
registerNumericParams(router, "id");

router.post("/", createBooking);
router.get("/", listBookings);

// Both literal paths must be registered before GET /:id, or Express would match
// "summary" and "unread-count" as booking ids and hand them to getBooking.
router.get("/summary", getBookingSummary);
// Above the `/:bookingId` route for the same reason as /summary: otherwise
// "counts" is read as a booking id.
router.get("/counts", getBookingCounts);
router.get("/unread-count", getUnreadCount);
// Cross-booking, so it belongs beside unread-count rather than under /:id.
router.get("/recent-messages", getRecentConversations);

router.get("/:id", getBooking);
router.post("/:id/cancel", cancelBooking);
router.post("/:id/reschedule", rescheduleBooking);
router.patch("/:id/status", updateBookingStatus);

// The conversation about one appointment. Both handlers re-derive the caller's
// relationship to the booking; a non-party gets 404, not 403.
router.get("/:id/messages", listMessages);
router.post("/:id/messages", sendMessage);

// Feedback on one completed appointment. Reading is open to both parties;
// writing is the client's alone, and only once the booking is completed.
router.get("/:id/review", getBookingReview);
router.post("/:id/review", createReview);

export default router;

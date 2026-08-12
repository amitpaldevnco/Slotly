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
} from "../controller/bookingController.js";
import {
  listMessages,
  sendMessage,
  getUnreadCount,
} from "../controller/messageController.js";
import { createReview, getBookingReview } from "../controller/reviewController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(verifyToken);

router.post("/", createBooking);
router.get("/", listBookings);

// Both literal paths must be registered before GET /:id, or Express would match
// "summary" and "unread-count" as booking ids and hand them to getBooking.
router.get("/summary", getBookingSummary);
router.get("/unread-count", getUnreadCount);

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

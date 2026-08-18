/**
 * Routes acting on an existing review by its own id.
 *
 * Creating a review lives on the booking (`POST /api/bookings/:id/review`),
 * because a review is *about* an appointment and the booking is what authorises
 * and validates it. Only editing and replying need the review's own id, so only
 * those live here.
 *
 * Both handlers check ownership against the row they are about to touch — the
 * author for an edit, the reviewed provider for a reply. `requireProviderRole` is
 * deliberately not used on the reply route: being *a* provider is not the
 * question, being *this* review's provider is, and only the handler can answer
 * that.
 */
import express from "express";
import { updateReview, replyToReview } from "../controller/reviewController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { registerNumericParams } from "../middleware/validateParams.js";

const router = express.Router();

router.use(verifyToken);

registerNumericParams(router, "id");

router.patch("/:id", updateReview);
router.post("/:id/reply", replyToReview);

export default router;

/**
 * Public provider routes: the directory, one provider's page, their services,
 * their published hours, and their bookable slots.
 *
 * Everything here is readable without a session. `attachUserIfPresent` is used
 * instead of `verifyToken` so a signed-in visitor is recognised — which is what
 * lets the page show "Edit" to the owner and render slots in the viewer's own
 * timezone — without ever blocking a logged-out one.
 */
import express from "express";
import { listProviders, getProviderProfile } from "../controller/providerController.js";
import { getServicesByProvider } from "../controller/serviceController.js";
import { getProviderAvailability } from "../controller/availabilityController.js";
import { getAvailableSlots } from "../controller/slotController.js";
import { listProviderReviews } from "../controller/reviewController.js";
import { attachUserIfPresent } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", listProviders);
router.get("/:id", attachUserIfPresent, getProviderProfile);
router.get("/:id/services", attachUserIfPresent, getServicesByProvider);
router.get("/:id/availability", getProviderAvailability);
router.get("/:id/slots", attachUserIfPresent, getAvailableSlots);
// Public: reviews are published feedback. `attachUserIfPresent` lets a signed-in
// client's own review come back flagged so the UI can offer to edit it.
router.get("/:id/reviews", attachUserIfPresent, listProviderReviews);

export default router;

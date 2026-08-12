/**
 * Availability management routes — a provider editing their own hours.
 *
 * Every route is gated by `requireProviderRole`, which re-reads the role from
 * the database rather than trusting the JWT, and every handler scopes its writes
 * to `req.user.userId`. There is no route here that takes a provider id, so
 * editing another provider's availability is not expressible.
 *
 * Reading availability is public and lives in providerRoutes.
 */
import express from "express";
import {
  replaceAvailabilityRules,
  createAvailabilityException,
  deleteAvailabilityException,
  clearServiceAvailabilityOverride,
  updateAvailabilitySettings,
} from "../controller/availabilityController.js";
import { verifyToken, requireProviderRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(verifyToken, requireProviderRole);

router.put("/rules", replaceAvailabilityRules);
router.delete("/rules/service/:serviceId", clearServiceAvailabilityOverride);
router.post("/exceptions", createAvailabilityException);
router.delete("/exceptions/:id", deleteAvailabilityException);
router.patch("/settings", updateAvailabilitySettings);

export default router;

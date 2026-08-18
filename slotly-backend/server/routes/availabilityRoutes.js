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
  validateAvailabilityConfiguration,
  previewServiceSlots,
  getAvailabilityHealth,
} from "../controller/availabilityController.js";
import { verifyToken, requireProviderRole } from "../middleware/authMiddleware.js";
import { registerNumericParams } from "../middleware/validateParams.js";

const router = express.Router();

router.use(verifyToken, requireProviderRole);

registerNumericParams(router, "id", "serviceId");

router.put("/rules", replaceAvailabilityRules);
// A dry run of /rules: same validation, same slot arithmetic, no write. POST
// rather than GET because the thing being checked is a draft in the request
// body, not something already stored.
router.post("/validate", validateAvailabilityConfiguration);
// The same diagnosis against what is already saved, per service, for dashboards.
// The mirror of /validate: a draft *service* judged against saved *hours*,
// which is what the service form needs while someone types a duration.
router.post("/preview", previewServiceSlots);
router.get("/health", getAvailabilityHealth);
router.delete("/rules/service/:serviceId", clearServiceAvailabilityOverride);
router.post("/exceptions", createAvailabilityException);
router.delete("/exceptions/:id", deleteAvailabilityException);
router.patch("/settings", updateAvailabilitySettings);

export default router;

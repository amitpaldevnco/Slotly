/**
 * Provider-owned service routes, mounted at /api/services.
 *
 * Everything here writes, and everything here is provider-only: `verifyToken`
 * then `requireProviderRole` on every route, applied per-route rather than with
 * `router.use` so that adding a public route later cannot inherit the guard by
 * accident and then quietly lose it in a refactor.
 *
 * **Reading services is not here.** `GET /api/providers/:id/services` lives on
 * the provider router because it is public — a shopfront needs no session. This
 * file is only the owner's side of the same resource, which is why it has no GET.
 *
 * `uploadServiceImage.single("coverImage")` sits after the guards and before the
 * handler on purpose: multer writes a temporary file to disk, so a request that
 * was never going to be allowed is rejected before any bytes are stored.
 *
 * DELETE retires rather than deletes when a service has booking history; see the
 * controller for why.
 */
import express from "express";
import {
  createService,
  updateService,
  deleteService,
  reactivateService,
} from "../controller/serviceController.js";
import { verifyToken, requireProviderRole } from "../middleware/authMiddleware.js";
import { uploadServiceImage } from "../middleware/uploadMiddleware.js";
import { registerNumericParams } from "../middleware/validateParams.js";

const router = express.Router();

registerNumericParams(router, "id");

router.post("/", verifyToken, requireProviderRole, uploadServiceImage.single("coverImage"), createService);
router.put("/:id", verifyToken, requireProviderRole, uploadServiceImage.single("coverImage"), updateService);
router.delete("/:id", verifyToken, requireProviderRole, deleteService);

// Undoes a retirement. Its own verb rather than a field on PUT, because editing
// a retired service is refused — see updateService.
router.post("/:id/reactivate", verifyToken, requireProviderRole, reactivateService);

export default router;

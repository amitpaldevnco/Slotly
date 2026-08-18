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

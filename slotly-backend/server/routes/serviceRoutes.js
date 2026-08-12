import express from "express";
import { createService, updateService, deleteService } from "../controller/serviceController.js";
import { verifyToken, requireProviderRole } from "../middleware/authMiddleware.js";
import { uploadServiceImage } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.post("/", verifyToken, requireProviderRole, uploadServiceImage.single("coverImage"), createService);
router.put("/:id", verifyToken, requireProviderRole, uploadServiceImage.single("coverImage"), updateService);
router.delete("/:id", verifyToken, requireProviderRole, deleteService);

export default router;

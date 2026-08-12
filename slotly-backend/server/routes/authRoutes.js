import express from "express";
import {
    googleAuth,
    completeProfile,
    getCurrentUser,
    logout,
    githubAuthRedirect,
    githubAuthCallback,
    registerUser,
    loginUser,
    updateProfile,  
} from "../controller/authController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js"; 

const router = express.Router();

router.post("/google", googleAuth);
router.get("/github", githubAuthRedirect);
router.get("/github/callback", githubAuthCallback);
router.patch("/complete-profile", verifyToken, completeProfile);
router.patch("/profile", verifyToken, upload.single("profilePicture"), updateProfile);
router.get("/me", verifyToken, getCurrentUser);
router.post("/logout", logout);
router.post("/register", registerUser);
router.post("/login", loginUser);

export default router;
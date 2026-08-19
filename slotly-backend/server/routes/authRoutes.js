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
import { credentialsLimiter, signupLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

// The throttled endpoints are exactly the ones that verify or mint an identity.
// Everything below them is already behind `verifyToken`, where the session cookie
// is the limit: you cannot grind at them without a valid one.
router.post("/google", credentialsLimiter, googleAuth);
router.get("/github", githubAuthRedirect);
router.get("/github/callback", credentialsLimiter, githubAuthCallback);
router.patch("/complete-profile", verifyToken, completeProfile);
router.patch("/profile", verifyToken, upload.single("profilePicture"), updateProfile);
router.get("/me", verifyToken, getCurrentUser);
router.post("/logout", logout);
router.post("/register", signupLimiter, registerUser);
router.post("/login", credentialsLimiter, loginUser);

export default router;
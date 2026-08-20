/**
 * Authentication and account routes, mounted at /api/auth.
 *
 * Three groups, and the difference between them is the whole story of this file:
 *
 *   - **Unauthenticated, rate limited.** Register, log in, and both social
 *     callbacks. These are the only endpoints reachable with no session, so they
 *     are the only ones that can be attacked by guessing. `credentialsLimiter`
 *     counts failures only; `signupLimiter` counts everything. See
 *     middleware/rateLimit.js for why those two differ.
 *   - **Authenticated.** Reading the current user, completing a profile,
 *     updating one. `verifyToken` proves who is asking; the controllers re-read
 *     the role from the database rather than trusting the token, because a role
 *     can change after a token is issued.
 *   - **Neither.** Logout deliberately has no `verifyToken`: clearing a cookie
 *     that is already invalid should succeed quietly, not fail with a 401 and
 *     leave the browser holding it.
 *
 * `upload.single("profilePicture")` runs before `updateProfile` because multer
 * has to parse the multipart body before any field of it exists to validate.
 */
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
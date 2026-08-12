import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { query } from "../config/dbConfig.js";
import { successResponse, errorResponse, validationErrorResponse } from "../responseController/responseHandler.js"; 
import axios from "axios";
import bcrypt from "bcrypt";
import {
  validateUploadedImage,
  buildStoredFileName,
  deleteStoredFile,
  discardUpload,
} from "../utils/fileValidation.js";
import { resolveSocialAccount } from "../services/accountLinking.js";
import {
  frontendBaseUrl,
  sessionCookieOptions,
  sessionCookieClearOptions,
} from "../config/appConfig.js";
import { DateTime } from "luxon";
import fs from "fs/promises";
import path from "path";

function isValidTimezone(zone) {
  return typeof zone === "string" && zone.length > 0 && DateTime.local().setZone(zone).isValid;
}

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// POST /api/auth/google
// Body: { credential: "<Google ID token from the frontend button>" }
export const googleAuth = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return validationErrorResponse(res, "Google credential is required", [
        { field: "credential", message: "Missing credential" },
      ]);
    }

    // Verify the ID token directly with Google's servers
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Find the existing account, link this identity to it, or create one — see
    // services/accountLinking.js. Looking up google_id alone and inserting on a
    // miss is what this replaces: `users.email` is UNIQUE, so that path raised
    // 23505 for anyone who had already registered with a password or GitHub,
    // and reported it as "Google authentication failed".
    const { user, isNewUser } = await resolveSocialAccount({
      provider: "google",
      providerUserId: googleId,
      email,
      name,
      avatarUrl: picture,
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, sessionCookieOptions);

    // role is NULL until the user finishes the profile-completion form
    const profileComplete = Boolean(user.role);

    return successResponse(res, isNewUser ? "Account created" : "Login successful", {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar_url,
        role: user.role,
        phoneNumber: user.phone_number,
        timezone: user.timezone,
        businessName: user.business_name,
        businessType: user.business_type,
      },
      isNewUser,
      profileComplete,
    });
  } catch (err) {
    console.error("Google auth error:", err.message);
    return errorResponse(res, "Google authentication failed", 401);
  }
};

// PATCH /api/auth/profile (protected by verifyToken)
// Body: { role, phoneNumber, timezone, businessName?, serviceCategory? }
export const completeProfile = async (req, res) => {
  try {
    const { role, phoneNumber, timezone, businessName, businessType } = req.body;

    const errors = [];
    if (!role || !["client", "provider"].includes(role)) {
      errors.push({ field: "role", message: "role must be 'client' or 'provider'" });
    }
    if (!phoneNumber) errors.push({ field: "phoneNumber", message: "Phone number is required" });
    if (!timezone) {
      errors.push({ field: "timezone", message: "Timezone is required" });
    } else if (!isValidTimezone(timezone)) {
      errors.push({ field: "timezone", message: "That is not a timezone we recognise" });
    }
    if (role === "provider") {
      if (!businessName) errors.push({ field: "businessName", message: "Business name is required for providers" });
      if (!businessType)
    errors.push({
        field: "businessType",
        message: "Business type is required",
    });
    }

    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    const updated = await query(
      `UPDATE users
       SET role = $1,
           phone_number = $2,
           timezone = $3,
           business_name = $4,
           business_type = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        role,
        phoneNumber,
        timezone,
        role === "provider" ? businessName : null,
        role === "provider" ? businessType : null,
        req.user.userId,
      ]
    );

    if (updated.rows.length === 0) {
      return errorResponse(res, "User not found", 404);
    }

    const user = updated.rows[0];
    return successResponse(res, "Profile completed", {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar_url,
        role: user.role,
        phoneNumber: user.phone_number,
        timezone: user.timezone,
        businessName: user.business_name,
        businessType: user.business_type,
      },
    });
  } catch (err) {
    console.error("completeProfile error:", err.message);
    return errorResponse(res, "Could not update profile", 500);
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT id, name, email, avatar_url, role, phone_number, timezone,
              business_name, business_type, bio, qualifications,
              cancellation_cutoff_hours
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, "User not found", 404);
    }

    const user = result.rows[0];

    return successResponse(res, "User fetched", {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      role: user.role,
      phone_number: user.phone_number,
      timezone: user.timezone,
      business_name: user.business_name,
      business_type: user.business_type,
      bio: user.bio,
      qualifications: user.qualifications,
      cancellation_cutoff_hours: user.cancellation_cutoff_hours,
    });

  } catch (err) {
    return errorResponse(res, "Server error", 500);
  }
};



// GET /api/auth/github
// Step 1: redirect the browser to GitHub's authorize screen
export const githubAuthRedirect = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_CALLBACK_URL,
    scope: "read:user user:email",
    allow_signup: "true",
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
};

// GET /api/auth/github/callback
// Step 2: GitHub redirects here with a one-time ?code=
export const githubAuthCallback = async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(`${frontendBaseUrl}/login?error=github_cancelled`);
  }

  try {
    // Exchange the code for an access token
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
      },
      { headers: { Accept: "application/json" } }
    );

    const { access_token } = tokenRes.data;
    if (!access_token) {
      return res.redirect(`${frontendBaseUrl}/login?error=github_token_failed`);
    }

    // Fetch the GitHub profile
    const profileRes = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = profileRes.data;

    // Email can be null on the profile if it's private — fetch it separately
    let email = profile.email;
    if (!email) {
      const emailsRes = await axios.get("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const primary = emailsRes.data.find((e) => e.primary && e.verified);
      email = primary?.email || emailsRes.data[0]?.email;
    }

    if (!email) {
      return res.redirect(`${frontendBaseUrl}/login?error=github_no_email`);
    }

    const githubId = String(profile.id);
    const name = profile.name || profile.login;
    const avatarUrl = profile.avatar_url;

    // Same resolution as the Google handler, by construction — see
    // services/accountLinking.js. Signing in with GitHub on an address that
    // already has a password or Google account attaches the identity to that
    // account rather than creating a second one.
    const { user } = await resolveSocialAccount({
      provider: "github",
      providerUserId: githubId,
      email,
      name,
      avatarUrl,
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, sessionCookieOptions);

    const profileComplete = Boolean(user.role);
    res.redirect(
      `${frontendBaseUrl}/${profileComplete ? "dashboard" : "complete-profile"}`
    );
  } catch (err) {
    console.error("GitHub auth error:", err.response?.data || err.message);
    return res.redirect(`${frontendBaseUrl}/login?error=github_failed`);
  }
};




// POST /api/auth/register
// Body: { name, email, password }
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const errors = [];
    if (!name) errors.push({ field: "name", message: "Name is required" });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ field: "email", message: "Valid email is required" });
    }
    if (!password || password.length < 8) {
      errors.push({ field: "password", message: "Password must be at least 8 characters" });
    }
    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    const existing = await query(`SELECT * FROM users WHERE email = $1`, [email]);

    // Case 1 — email not present: brand new user
    if (existing.rows.length === 0) {
      const passwordHash = await bcrypt.hash(password, 10);

      const inserted = await query(
        `INSERT INTO users (email, name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [email, name, passwordHash]
      );
      const user = inserted.rows[0];

      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.cookie("token", token, sessionCookieOptions);

      return successResponse(res, "Account created", {
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        isNewUser: true,
        profileComplete: false,
      });
    }

    // Email is present — figure out why, and never create a duplicate row for it
    const existingUser = existing.rows[0];

    if (existingUser.google_id) {
      return errorResponse(res, "This email is already registered with Google. Please continue with Google.", 409);
    }

    if (existingUser.github_id) {
      return errorResponse(res, "This email is already registered with GitHub. Please continue with GitHub.", 409);
    }

    if (existingUser.password_hash) {
      return errorResponse(res, "This email is already registered. Please log in instead.", 409);
    }

    // Edge case: email exists but has no google_id, github_id, or password_hash.
    // Should never happen under normal flow — flag it instead of guessing what to do with it.
    console.error(`Data integrity issue: user ${existingUser.id} (${email}) has no linked auth method`);
    return errorResponse(res, "We couldn't process this account. Please contact support.", 500);
  } catch (err) {
    console.error("registerUser error:", err.message);
    return errorResponse(res, "Could not create account", 500);
  }
};

// POST /api/auth/login
// Body: { email, password }
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return validationErrorResponse(res, "Email and password are required", [
        ...(!email ? [{ field: "email", message: "Email is required" }] : []),
        ...(!password ? [{ field: "password", message: "Password is required" }] : []),
      ]);
    }

    const result = await query(`SELECT * FROM users WHERE email = $1`, [email]);

    if (result.rows.length === 0) {
      return errorResponse(res, "No account found with this email", 401);
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      if (user.google_id) {
        return errorResponse(res, "This account uses Google sign-in. Please continue with Google.", 409);
      }
      if (user.github_id) {
        return errorResponse(res, "This account uses GitHub sign-in. Please continue with GitHub.", 409);
      }
      // Edge case: no password_hash, no google_id, no github_id — broken account
      console.error(`Data integrity issue: user ${user.id} (${email}) has no linked auth method`);
      return errorResponse(res, "We couldn't process this account. Please contact support.", 500);
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return errorResponse(res, "Invalid email or password", 401);
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, sessionCookieOptions);

    const profileComplete = Boolean(user.role);

    return successResponse(res, "Login successful", {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar_url,
        role: user.role,
        phoneNumber: user.phone_number,
        timezone: user.timezone,
        businessName: user.business_name,
        businessType: user.business_type,
      },
      isNewUser: false,
      profileComplete,
    });
  } catch (err) {
    console.error("loginUser error:", err.message);
    return errorResponse(res, "Login failed", 500);
  }
};



export async function updateProfile(req, res) {
  try {
    const userId = req.user.userId;
    const { phoneNumber, timezone, bio, businessName, businessType, qualifications } = req.body;

    const currentUser = await query("SELECT role FROM users WHERE id = $1", [userId]);
    if (currentUser.rows.length === 0) {
      return errorResponse(res, "User not found", 404);
    }
    const role = currentUser.rows[0].role;

    // Prepare update object
    const updateData = {};

    // Validate & add phone number
    if (phoneNumber) {
      if (!phoneNumber.match(/^[\d\s\-\+()]+$/)) {
        return validationErrorResponse(res, "Invalid phone number format", [
          { field: "phoneNumber", message: "Phone number format is invalid" },
        ]);
      }
      updateData.phone_number = phoneNumber;
    }

    // Validate & add timezone.
    if (timezone) {
      if (!isValidTimezone(timezone)) {
        return validationErrorResponse(res, "Please fix the errors below", [
          { field: "timezone", message: "That is not a timezone we recognise" },
        ]);
      }
      updateData.timezone = timezone;
    }

    // Validate & add bio (providers only)
    if (role === "provider" && bio !== undefined) {
      if (bio.length > 500) {
        return validationErrorResponse(res, "Bio exceeds 500 characters", [
          { field: "bio", message: "Bio must be 500 characters or less" },
        ]);
      }
      updateData.bio = bio;
    }

    // Qualifications — providers only, and it appears on their public page.
    // Checked against `role` read from the database a few lines above, not
    // against anything in the request, so a client cannot set a field that only
    // makes sense for a provider.
    //
    // `!== undefined` rather than a truthiness test: an empty string is a
    // deliberate "remove what I wrote", and a truthiness check would silently
    // ignore it and leave the old text on the public page.
    if (role === "provider" && qualifications !== undefined) {
      if (String(qualifications).length > 500) {
        return validationErrorResponse(res, "Please fix the errors below", [
          { field: "qualifications", message: "Qualifications must be 500 characters or less" },
        ]);
      }
      updateData.qualifications = String(qualifications).trim() || null;
    }

    // Business fields — providers only
    if (role === "provider") {
      if (businessName) updateData.business_name = businessName;
      if (businessType) updateData.business_type = businessType;
    }

    // Handle the profile photo. The file's real type is decided by sniffing its
    // header, not by its extension or the MIME type the browser claimed — see
    // utils/fileValidation.js.
    if (req.file) {
      const validation = await validateUploadedImage(req.file, "avatar");
      if (!validation.valid) {
        await discardUpload(req.file);
        return validationErrorResponse(res, validation.error, [
          { field: "profilePicture", message: validation.error },
        ]);
      }

      const fileName = buildStoredFileName(userId, validation.extension);
      await fs.rename(req.file.path, path.join(path.dirname(req.file.path), fileName));

      // Remove the previous avatar only after the replacement is in place, so a
      // failure part-way through leaves the user with a photo rather than none.
      const user = await query("SELECT avatar_url FROM users WHERE id = $1", [userId]);
      await deleteStoredFile(user.rows[0]?.avatar_url);

      updateData.avatar_url = `/uploads/avatars/${fileName}`;
    }

    // Update user in database
    const columns = Object.keys(updateData);
    if (columns.length === 0) {
      return errorResponse(res, "No fields to update", 400);
    }

    const setClause = columns
      .map((col, idx) => `${col} = $${idx + 1}`)
      .join(", ");

    const updateSql = `
      UPDATE users
      SET ${setClause}, updated_at = NOW()
      WHERE id = $${columns.length + 1}
      RETURNING id, email, name, phone_number, timezone, bio, qualifications,
                avatar_url, role, business_name, business_type
    `;

    const result = await query(updateSql, [...Object.values(updateData), userId]);

    if (result.rows.length === 0) {
      return errorResponse(res, "User not found", 404);
    }

    return successResponse(res, "Profile updated successfully", result.rows[0], 200);
  } catch (err) {
    await discardUpload(req.file);
    console.error("Error updating profile:", err);
    return errorResponse(res, "Failed to update profile", 500);
  }
}

// POST /api/auth/logout
// POST /api/auth/logout
export const logout = (req, res) => {
  res.clearCookie("token", sessionCookieClearOptions);
  return successResponse(res, "Logged out");
};
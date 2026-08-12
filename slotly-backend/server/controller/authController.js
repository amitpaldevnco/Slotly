/**
 * Authentication, identity and profile endpoints.
 *
 * This file owns three things that are easy to conflate and are kept apart on
 * purpose:
 *
 *   1. **Proving who someone is** — `registerUser`/`loginUser` for the password
 *      route, `googleAuth`/`githubAuthRedirect`/`githubAuthCallback` for OAuth.
 *      All five end the same way: a signed JWT in an httpOnly cookie. Nothing in
 *      this file ever puts a token in the response body, because a token a
 *      script can read is a token an injected script can steal.
 *   2. **Deciding what account they land on** — delegated entirely to
 *      `services/accountLinking.js`, so Google and GitHub cannot drift apart.
 *      See that file for why one email always resolves to one row.
 *   3. **Completing and editing a profile** — `completeProfile` runs exactly
 *      once, `updateProfile` runs any number of times. That split is the whole
 *      reason `role` cannot be rewritten; see `completeProfile`.
 *
 * ## The one asymmetry worth knowing about
 *
 * Signing in socially on an email that already has a password account *links*
 * the two. Registering with a password on an email that already has a social
 * account is *refused* with 409 naming the provider to use. The directions are
 * deliberately different: the social provider has verified the address, so it
 * is safe to attach that identity to the existing row, whereas anyone can type
 * an email into a registration form and attaching a password to a stranger's
 * verified account on that basis would be an account-takeover primitive.
 */
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { DateTime } from "luxon";
import axios from "axios";
import bcrypt from "bcrypt";
import { query } from "../config/dbConfig.js";
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
  ERROR_CODES,
} from "../responseController/responseHandler.js";
import { validateUploadedImage, discardUpload } from "../utils/fileValidation.js";
import { storeImage, deleteImage } from "../services/imageStorage.js";
import { resolveSocialAccount } from "../services/accountLinking.js";
import {
  frontendBaseUrl,
  sessionCookieOptions,
  sessionCookieClearOptions,
} from "../config/appConfig.js";

/** How long a session lasts. Matches the cookie's own maxAge in appConfig. */
const SESSION_LIFETIME = "7d";

/** bcrypt work factor. 10 is ~100ms per hash on current hardware. */
const BCRYPT_ROUNDS = 10;

/**
 * True when Luxon can resolve `zone` as an IANA timezone name.
 *
 * Used rather than a regex or a hardcoded list because the set of valid zones
 * is whatever the runtime's ICU data says it is, and that changes with the
 * Node version. Asking the library that will later do the arithmetic is the
 * only check that cannot disagree with it.
 *
 * @param {unknown} zone
 * @returns {boolean}
 */
function isValidTimezone(zone) {
  return typeof zone === "string" && zone.length > 0 && DateTime.local().setZone(zone).isValid;
}

/**
 * Mints the session cookie for a user row.
 *
 * Shared by all five sign-in paths so the token's claims, lifetime and cookie
 * attributes cannot drift between them — a difference there would be invisible
 * until one route's sessions started outliving another's.
 *
 * @param {import('express').Response} res
 * @param {{id: number, email: string}} user
 */
function issueSession(res, user) {
  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: SESSION_LIFETIME,
  });
  res.cookie("token", token, sessionCookieOptions);
}

/**
 * The user shape every auth endpoint returns.
 *
 * One function rather than six inline object literals, because the client reads
 * these fields positionally in its auth context and a field missing from one
 * response but present in another shows up as a value that mysteriously blanks
 * after signing in by a different route.
 *
 * @param {object} row A `users` row.
 * @returns {object} Safe to send to the browser — no password hash, no
 *   provider ids.
 */
function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatar: row.avatar_url,
    role: row.role,
    phoneNumber: row.phone_number,
    timezone: row.timezone,
    businessName: row.business_name,
    businessType: row.business_type,
  };
}

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google — public.
 *
 * Body: `{ credential }` — the ID token Google's button hands the frontend.
 *
 * The token is verified against Google's own keys with the audience pinned to
 * `GOOGLE_CLIENT_ID`, so a token minted for some other application is rejected.
 * That verification is why the client is trusted to supply it at all: nothing
 * in the request is believed until Google has vouched for it.
 *
 * @returns 200 with `{ user, isNewUser, profileComplete }` and a session cookie.
 *   401 if the credential is missing, expired, forged, or issued for a
 *   different client id — all reported identically, since distinguishing them
 *   would tell an attacker which of their guesses was closer.
 */
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

    issueSession(res, user);

    // role is NULL until the user finishes the profile-completion form
    const profileComplete = Boolean(user.role);

    return successResponse(res, isNewUser ? "Account created" : "Login successful", {
      user: publicUser(user),
      isNewUser,
      profileComplete,
    });
  } catch (err) {
    console.error("Google auth error:", err.message);
    return errorResponse(res, "Google authentication failed", 401);
  }
};

/**
 * PATCH /api/auth/complete-profile — requires a session.
 *
 * Body: `{ role, phoneNumber, timezone, businessName?, businessType? }`
 *
 * The one and only time a user's `role` is ever written. Everything after this
 * goes through `updateProfile`, which cannot touch `role` at all.
 *
 * ## Why this is refused once the role is set
 *
 * `role` is not a preference, it is the axis every authorization decision in the
 * app turns on: `requireProviderRole` gates the service and availability
 * endpoints, `createBooking` insists the caller is a client, and the booking
 * queries choose between `provider_id = me` and `client_id = me` from it.
 * Letting a signed-in user rewrite it would mean any client could grant
 * themselves provider access by replaying this request with a different value —
 * server-side authorization that the client gets to reconfigure is not
 * authorization at all.
 *
 * It is refused in the other direction too, which matters just as much and is
 * less obvious: a provider who flipped to `client` would keep every booking on
 * their calendar while losing every endpoint that can read or act on one, so
 * real appointments with real people on the other end would become
 * unreachable — cancellable by nobody, visible to nobody.
 *
 * Changing role is therefore a support operation on a fresh account, not a
 * self-service toggle. The check reads the *current* value from the database
 * rather than trusting anything in the request or the token.
 *
 * @returns 200 with `{ user }` on success. 400 VALIDATION_FAILED for a bad
 *   field. **409 INVALID_TRANSITION when a role has already been chosen.**
 *   404 if the session names a user that no longer exists.
 */
export const completeProfile = async (req, res) => {
  try {
    const { role, phoneNumber, timezone, businessName, businessType } = req.body;

    const current = await query("SELECT role FROM users WHERE id = $1", [req.user.userId]);
    if (current.rows.length === 0) {
      return errorResponse(res, "User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (current.rows[0].role) {
      return errorResponse(
        res,
        `Your account is already set up as a ${current.rows[0].role}. Roles cannot be changed once chosen.`,
        409,
        ERROR_CODES.INVALID_TRANSITION
      );
    }

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
      if (!businessName) {
        errors.push({ field: "businessName", message: "Business name is required for providers" });
      }
      if (!businessType) {
        errors.push({ field: "businessType", message: "Business type is required" });
      }
    }

    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    // `AND role IS NULL` repeats the check above inside the write itself. Two
    // requests arriving together would both pass the SELECT; only one can match
    // this UPDATE, so the role is still written exactly once.
    const updated = await query(
      `UPDATE users
       SET role = $1,
           phone_number = $2,
           timezone = $3,
           business_name = $4,
           business_type = $5,
           updated_at = NOW()
       WHERE id = $6 AND role IS NULL
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
      // The row exists — the SELECT above found it — so matching nothing here
      // means a concurrent request set the role first.
      return errorResponse(
        res,
        "Your account was already set up. Please reload the page.",
        409,
        ERROR_CODES.INVALID_TRANSITION
      );
    }

    return successResponse(res, "Profile completed", { user: publicUser(updated.rows[0]) });
  } catch (err) {
    console.error("completeProfile error:", err.message);
    return errorResponse(res, "Could not update profile", 500);
  }
};

/**
 * GET /api/auth/me — requires a session.
 *
 * The endpoint the React app calls on every page load to rehydrate its auth
 * context, which is why it returns the full profile rather than just an id: the
 * alternative is a second round trip before anything can render.
 *
 * Columns are listed explicitly rather than `SELECT *` so that adding a column
 * to `users` — a password hash, a provider id, a reset token — cannot silently
 * start sending it to the browser.
 *
 * @returns 200 with the profile. 401 if the cookie is missing or invalid
 *   (raised by `verifyToken` before this runs). 404 if the session names a user
 *   that has since been deleted.
 */
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



/**
 * GET /api/auth/github — public. Step 1 of the OAuth 2.0 authorization-code flow.
 *
 * Redirects the browser to GitHub's consent screen. Nothing secret is involved
 * here: only the client *id* travels, in a URL the user can read. The client
 * secret never leaves the server and is used once, in the callback below, to
 * exchange the returned code for a token.
 *
 * @returns 302 to github.com.
 */
export const githubAuthRedirect = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_CALLBACK_URL,
    scope: "read:user user:email",
    allow_signup: "true",
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
};

/**
 * GET /api/auth/github/callback — public. Step 2 of the flow.
 *
 * GitHub sends the browser here with a single-use `?code=`, which is exchanged
 * server-to-server for an access token. The profile is then read with that
 * token by this server, never by the client — so the identity this endpoint
 * acts on came from GitHub directly and cannot be forged by whoever is driving
 * the browser.
 *
 * A primary *verified* email is preferred when the profile's own email is
 * private, because the address is what account linking keys on; accepting an
 * unverified one would let someone claim an account by adding its address to
 * their GitHub profile.
 *
 * @returns 302 to the frontend — `/dashboard` when the profile is complete,
 *   `/complete-profile` when it is not, or `/login?error=…` for each distinct
 *   failure (`github_cancelled`, `github_token_failed`, `github_no_email`,
 *   `github_failed`) so the login page can explain what went wrong. Errors are
 *   redirects rather than JSON because the caller here is a browser following a
 *   redirect chain, not a fetch.
 */
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

    issueSession(res, user);

    const profileComplete = Boolean(user.role);
    res.redirect(
      `${frontendBaseUrl}/${profileComplete ? "dashboard" : "complete-profile"}`
    );
  } catch (err) {
    console.error("GitHub auth error:", err.response?.data || err.message);
    return res.redirect(`${frontendBaseUrl}/login?error=github_failed`);
  }
};




/**
 * POST /api/auth/register — public.
 *
 * Body: `{ name, email, password }`. Minimum password length is 8; the hash is
 * bcrypt, and the plaintext is never written anywhere, including logs.
 *
 * An email that already exists is never turned into a second row — `users.email`
 * is UNIQUE, and each reason the address is taken gets its own message so the
 * user is told which button to press instead of being stonewalled. See the file
 * header for why this direction refuses rather than links.
 *
 * @returns 201 with `{ user, isNewUser, profileComplete }` and a session cookie.
 *   400 VALIDATION_FAILED for a bad name, email or short password. 409 when the
 *   address already belongs to a Google, GitHub or password account. 500 for a
 *   row with no auth method at all, which should be unreachable and is logged
 *   as a data-integrity problem rather than guessed at.
 */
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
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const inserted = await query(
        `INSERT INTO users (email, name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [email, name, passwordHash]
      );
      const user = inserted.rows[0];

      issueSession(res, user);

      return successResponse(
        res,
        "Account created",
        { user: publicUser(user), isNewUser: true, profileComplete: false },
        201
      );
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

/**
 * POST /api/auth/login — public.
 *
 * Body: `{ email, password }`.
 *
 * An account with no `password_hash` reached this app through Google or GitHub,
 * so it is told which to use rather than being given "invalid password" for a
 * password it never had. That does disclose that an address is registered and
 * by which method — accepted deliberately, because the alternative is a user
 * who cannot work out how to get into their own account, and the address is
 * already discoverable through the registration form regardless.
 *
 * @returns 200 with `{ user, isNewUser: false, profileComplete }` and a session
 *   cookie. 400 if a field is missing. 401 for an unknown email or a wrong
 *   password. 409 when the account uses a social provider instead.
 */
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

    issueSession(res, user);

    return successResponse(res, "Login successful", {
      user: publicUser(user),
      isNewUser: false,
      profileComplete: Boolean(user.role),
    });
  } catch (err) {
    console.error("loginUser error:", err.message);
    return errorResponse(res, "Login failed", 500);
  }
};

/**
 * PATCH /api/auth/profile — requires a session. multipart/form-data.
 *
 * Edits the signed-in user's own profile, and only ever their own: the row is
 * chosen by `req.user.userId`, so there is no id in the request for a caller to
 * change. Every provider-only field is gated on the role read from the database
 * a few lines up rather than on anything the request claims, so a client cannot
 * set a bio or qualifications that would then appear on a public page.
 *
 * **`role` is deliberately not editable here.** See `completeProfile`.
 *
 * The optional `profilePicture` file has its real type decided by sniffing its
 * header, never by its extension or the MIME type the browser declared — see
 * `utils/fileValidation.js`. The previous image is removed only after the
 * replacement is safely stored, so a failure part-way through leaves the user
 * with a photo rather than none.
 *
 * @returns 200 with the updated row. 400 for an invalid phone number, timezone,
 *   over-long bio, or a rejected upload. 404 if the session names a user that no
 *   longer exists. 500 on an unexpected failure, after discarding the temporary
 *   upload so a rejected request leaves nothing behind on disk.
 */
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

      const storedUrl = await storeImage({
        file: req.file,
        kind: "avatar",
        extension: validation.extension,
        ownerId: userId,
      });

      // Remove the previous avatar only after the replacement is in place, so a
      // failure part-way through leaves the user with a photo rather than none.
      const user = await query("SELECT avatar_url FROM users WHERE id = $1", [userId]);
      await deleteImage(user.rows[0]?.avatar_url);

      updateData.avatar_url = storedUrl;
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

/**
 * POST /api/auth/logout — public.
 *
 * Deliberately unauthenticated: signing out a session that has already expired
 * must still clear the cookie, and requiring a valid token to do that would
 * leave a stale cookie sitting in the browser precisely when it is least wanted.
 *
 * `sessionCookieClearOptions` omits `maxAge` on purpose — a cookie is only
 * cleared when its attributes match the ones it was set with, and Express
 * derives `expires` from `maxAge`, which would overwrite the expiry-in-the-past
 * that does the clearing. See `config/appConfig.js`.
 *
 * @returns 200, always.
 */
export const logout = (req, res) => {
  res.clearCookie("token", sessionCookieClearOptions);
  return successResponse(res, "Logged out");
};
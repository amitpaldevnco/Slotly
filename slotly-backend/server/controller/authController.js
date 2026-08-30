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
import { assessTimezoneChange } from "../services/timezoneChange.js";
import {
  normaliseEmail,
  validateEmail,
  validateName,
  validatePhone,
  validateBusinessName,
} from "../utils/identity.js";
import { normaliseCountry, countryForTimezone, validateAddress } from "../utils/geography.js";
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
 * Normalises a currency code, or returns null if it is not one.
 *
 * Validated against `Intl.supportedValuesOf("currency")` — the runtime's own ICU
 * currency list — for the same reason `isValidTimezone` defers to Luxon: the
 * authority on what codes exist is the library that will later format them, and
 * a hardcoded list would drift from it. The fallback is a shape check, because
 * `supportedValuesOf` is absent on older runtimes and refusing every currency
 * there would be worse than accepting a well-formed unknown one.
 *
 * @param {unknown} code Any case; "gbp" and "GBP" are the same currency.
 * @returns {string|null} The upper-cased ISO 4217 code, or null.
 */
function normaliseCurrency(code) {
  if (typeof code !== "string") return null;
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) return null;

  try {
    const known = Intl.supportedValuesOf("currency");
    return known.includes(upper) ? upper : null;
  } catch {
    return upper;
  }
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
    currency: row.currency,
    // ISO 3166-1 alpha-2, or null when the account has never stated one and its
    // timezone did not imply one. The client needs it to tell a domestic service
    // it can book from one it cannot, and to prefill the profile form.
    country: row.country ?? null,
    businessAddress: row.business_address ?? null,
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
    const { role, phoneNumber, timezone, businessName, businessType, currency, country, businessAddress } =
      req.body;

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
    // Format-checked, not merely present. This endpoint used to accept any
    // truthy string, which is how `abcdef` became a stored phone number while
    // `updateProfile` — the very next screen — applied a real check.
    const checkedPhone = validatePhone(phoneNumber);
    if (!checkedPhone.ok) {
      errors.push({ field: "phoneNumber", message: checkedPhone.message });
    }
    if (!timezone) {
      errors.push({ field: "timezone", message: "Timezone is required" });
    } else if (!isValidTimezone(timezone)) {
      errors.push({ field: "timezone", message: "That is not a timezone we recognise" });
    }
    // Country, for both roles.
    //
    // A client's country is not decoration: a service with a domestic booking
    // scope is bookable only when the two countries match, so a client with none
    // cannot be told whether they are eligible. Asked of everyone for that
    // reason, and defaulted from the timezone they have just chosen so the form
    // can pre-select it and almost nobody has to think about it.
    //
    // Not fatal when it cannot be resolved. A timezone belonging to no country
    // (UTC) leaves this null, and null is a legitimate state the whole feature is
    // built to tolerate — see `services/bookingScope.js`. Refusing sign-up over
    // it would be turning an optional refinement into a barrier to entry.
    let resolvedCountry = null;
    if (country !== undefined && country !== null && String(country).trim() !== "") {
      resolvedCountry = normaliseCountry(country);
      if (!resolvedCountry) {
        errors.push({ field: "country", message: "That is not a country we recognise" });
      }
    } else if (isValidTimezone(timezone)) {
      resolvedCountry = countryForTimezone(timezone);
    }

    // Providers must state a currency here, at the one moment the profile is
    // filled in, because every price they go on to set is denominated in it.
    // Leaving it to a default would mean a London physiotherapist publishing
    // prices in rupees until they noticed.
    let resolvedCurrency = null;
    let cleanBusinessName = null;
    let resolvedAddress = null;
    if (role === "provider") {
      const checkedBusinessName = validateBusinessName(businessName);
      if (!checkedBusinessName.ok) {
        errors.push({ field: "businessName", message: checkedBusinessName.message });
      } else {
        cleanBusinessName = checkedBusinessName.value;
      }
      if (!businessType || !String(businessType).trim()) {
        errors.push({ field: "businessType", message: "Choose the category you work in" });
      }
      if (!currency) {
        errors.push({ field: "currency", message: "Choose the currency you charge in" });
      } else {
        resolvedCurrency = normaliseCurrency(currency);
        if (!resolvedCurrency) {
          errors.push({ field: "currency", message: "That is not a currency we recognise" });
        }
      }

      // Optional here, deliberately. A provider who will only ever offer virtual
      // services has no address to give, and this screen is the wrong place to
      // find that out — they have not created a service yet, so nothing yet
      // depends on it. `serviceController` asks at the point it becomes
      // load-bearing: publishing an In-Person service.
      const checkedAddress = validateAddress(businessAddress);
      if (!checkedAddress.ok) {
        errors.push({ field: "businessAddress", message: checkedAddress.message });
      } else {
        resolvedAddress = checkedAddress.value;
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
           currency = COALESCE($6, currency),
           country = COALESCE($8, country),
           business_address = $9,
           updated_at = NOW()
       WHERE id = $7 AND role IS NULL
       RETURNING *`,
      [
        role,
        checkedPhone.value,
        timezone,
        role === "provider" ? cleanBusinessName : null,
        role === "provider" ? String(businessType).trim() : null,
        // NULL for a client, so COALESCE leaves the column on its default. A
        // client never sets a price, so there is nothing for them to denominate.
        resolvedCurrency,
        req.user.userId,
        // COALESCE for the same reason as currency: an unresolvable country
        // leaves whatever the column already held rather than overwriting a
        // value with nothing.
        resolvedCountry,
        role === "provider" ? resolvedAddress : null,
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
              business_name, business_type, bio, qualifications, currency,
              country, business_address,
              cancellation_cutoff_hours,
              -- A boolean, never the hash. Settings needs to know whether it is
              -- offering "change your password" or "add one" -- a Google or
              -- GitHub account has none -- and that is the whole of what the
              -- browser is told about it.
              (password_hash IS NOT NULL) AS has_password
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
      has_password: user.has_password,
      business_name: user.business_name,
      business_type: user.business_type,
      bio: user.bio,
      qualifications: user.qualifications,
      currency: user.currency,
      // Trimmed on the way out because CHAR(2) is blank-padded by PostgreSQL, and
      // an unpadded comparison in the client would fail against a padded value.
      country: user.country ? String(user.country).trim() : null,
      business_address: user.business_address ?? null,
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

    // Both are normalised rather than merely checked, and the normalised values
    // are what gets inserted below — otherwise trimming a name or casefolding an
    // address would validate one string and store a different one.
    const checkedName = validateName(name);
    const checkedEmail = validateEmail(email);

    const errors = [];
    if (!checkedName.ok) errors.push({ field: "name", message: checkedName.message });
    if (!checkedEmail.ok) errors.push({ field: "email", message: checkedEmail.message });
    if (!password || password.length < 8) {
      errors.push({ field: "password", message: "Password must be at least 8 characters" });
    }
    if (errors.length > 0) {
      return validationErrorResponse(res, "Please fix the errors below", errors);
    }

    const cleanName = checkedName.value;
    const cleanEmail = checkedEmail.value;

    const existing = await query(`SELECT * FROM users WHERE email = $1`, [cleanEmail]);

    // Case 1 — email not present: brand new user
    if (existing.rows.length === 0) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const inserted = await query(
        `INSERT INTO users (email, name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [cleanEmail, cleanName, passwordHash]
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

    // Each branch carries its own machine-readable code, because a client has to
    // do something different in each case: WRONG_AUTH_METHOD means "send them to
    // the social button named in `details.provider`", ACCOUNT_EXISTS means "send
    // them to the login form". Both were previously falling back to the generic
    // CONFLICT, which the OpenAPI document nonetheless advertised as these two —
    // so a client written against the published spec matched neither.
    if (existingUser.google_id) {
      return errorResponse(
        res,
        "This email is already registered with Google. Please continue with Google.",
        409,
        ERROR_CODES.WRONG_AUTH_METHOD,
        { provider: "google" }
      );
    }

    if (existingUser.github_id) {
      return errorResponse(
        res,
        "This email is already registered with GitHub. Please continue with GitHub.",
        409,
        ERROR_CODES.WRONG_AUTH_METHOD,
        { provider: "github" }
      );
    }

    if (existingUser.password_hash) {
      return errorResponse(
        res,
        "This email is already registered. Please log in instead.",
        409,
        ERROR_CODES.ACCOUNT_EXISTS
      );
    }

    // Edge case: email exists but has no google_id, github_id, or password_hash.
    // Should never happen under normal flow — flag it instead of guessing what to do with it.
    console.error(`Data integrity issue: user ${existingUser.id} (${cleanEmail}) has no linked auth method`);
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

    // Casefolded before the lookup, so an address typed with a capital — which
    // is what a mobile keyboard offers by default — still finds its account.
    const result = await query(`SELECT * FROM users WHERE email = $1`, [normaliseEmail(email)]);

    // One wording, one code, for both "no such address" and "wrong password".
    //
    // Saying "no account found with this email" for the first and "invalid email
    // or password" for the second turns this form into an address oracle: submit
    // a list of addresses with any password and the two different replies tell
    // you which ones have accounts here. Both statuses were already 401, so the
    // leak was in the prose, which is exactly where it is easiest to miss.
    const invalidCredentials = () =>
      errorResponse(res, "Invalid email or password", 401, ERROR_CODES.INVALID_CREDENTIALS);

    if (result.rows.length === 0) {
      return invalidCredentials();
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      // Naming the social provider here is a deliberate exception to the rule
      // above, and a narrow one: the caller has proved nothing, but this is the
      // only way to tell someone who signed up with Google why their password
      // does not work. It reveals that the address is registered — which the
      // registration form would reveal anyway, since it must refuse duplicates.
      if (user.google_id) {
        return errorResponse(
          res,
          "This account uses Google sign-in. Please continue with Google.",
          409,
          ERROR_CODES.WRONG_AUTH_METHOD,
          { provider: "google" }
        );
      }
      if (user.github_id) {
        return errorResponse(
          res,
          "This account uses GitHub sign-in. Please continue with GitHub.",
          409,
          ERROR_CODES.WRONG_AUTH_METHOD,
          { provider: "github" }
        );
      }
      // Edge case: no password_hash, no google_id, no github_id — broken account
      console.error(`Data integrity issue: user ${user.id} (${email}) has no linked auth method`);
      return errorResponse(res, "We couldn't process this account. Please contact support.", 500);
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return invalidCredentials();
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
 * ## A provider's timezone is not a free edit
 *
 * For a provider, the timezone is not just a display preference — it is the zone
 * their weekly availability rules are read in, so moving it slides every working
 * window along the timeline while the appointments already booked stay exactly
 * where they are. A change can therefore leave a real appointment sitting
 * outside the hours the provider has just declared.
 *
 * So a provider's zone change is checked before it is written, and refused with
 * 409 `TIMEZONE_CONFLICT` when it would strand anything, with the affected
 * appointments in `details.conflicts`. The provider then either cancels or
 * reschedules those appointments and tries again, or leaves their timezone
 * alone. There is no force flag; see `services/timezoneChange.js`.
 *
 * Clients are unaffected — a client's timezone drives display only, and nothing
 * is interpreted in it.
 *
 * @returns 200 with the updated row. 400 for an invalid phone number, timezone,
 *   over-long bio, or a rejected upload. 404 if the session names a user that no
 *   longer exists. 409 TIMEZONE_CONFLICT when a provider's new zone would strand
 *   upcoming appointments — nothing is written in that case. 500 on an unexpected
 *   failure, after discarding the temporary upload so a rejected request leaves
 *   nothing behind on disk.
 */
export async function updateProfile(req, res) {
  try {
    const userId = req.user.userId;
    const {
      name,
      phoneNumber,
      timezone,
      bio,
      businessName,
      businessType,
      qualifications,
      currency,
      country,
      businessAddress,
    } = req.body;

    const currentUser = await query(
      "SELECT role, business_name, business_type FROM users WHERE id = $1",
      [userId]
    );
    if (currentUser.rows.length === 0) {
      return errorResponse(res, "User not found", 404);
    }
    // Read from the database rather than from the request, because a role decides
    // which fields below are allowed to be written at all -- so trusting the
    // caller for it would let a client set a bio that appears on a public page.
    //
    // `role` is not editable here or anywhere else: `completeProfile` writes it
    // exactly once, guarded by `AND role IS NULL`.
    const role = currentUser.rows[0].role;

    // Prepare update object
    const updateData = {};

    // Name is editable here, which it previously was not.
    //
    // It was treated as immutable on the grounds that it "comes from the account
    // you signed in with" -- true for Google and GitHub, but a password account
    // types its own name at registration, so a typo there was permanent and
    // followed the user onto every appointment and review they were part of.
    // Editing it changes nothing about identity: the account is keyed by email.
    if (name !== undefined) {
      const checkedName = validateName(name);
      if (!checkedName.ok) {
        return validationErrorResponse(res, "Please fix the errors below", [
          { field: "name", message: checkedName.message },
        ]);
      }
      updateData.name = checkedName.value;
    }

    // `!== undefined` rather than truthiness, so an empty string reads as a
    // deliberate "remove my number" and is stored as NULL. Under the old
    // truthiness test clearing the field changed nothing, the request ended up
    // with no fields at all, and the user was told "No fields to update" --
    // leaving a number already shared with providers impossible to withdraw.
    if (phoneNumber !== undefined) {
      const checkedPhone = validatePhone(phoneNumber, { allowEmpty: true });
      if (!checkedPhone.ok) {
        return validationErrorResponse(res, "Please fix the errors below", [
          { field: "phoneNumber", message: checkedPhone.message },
        ]);
      }
      updateData.phone_number = checkedPhone.value;
    }

    // Validate & add timezone.
    if (timezone) {
      if (!isValidTimezone(timezone)) {
        return validationErrorResponse(res, "Please fix the errors below", [
          { field: "timezone", message: "That is not a timezone we recognise" },
        ]);
      }

      // Providers only, and checked here — before the avatar is stored and long
      // before the UPDATE — so a refused change leaves the account exactly as it
      // was rather than half-applied. `assessTimezoneChange` returns safe
      // immediately when the zone is the one already stored, so a provider
      // saving an unrelated field pays nothing for this.
      if (role === "provider") {
        const impact = await assessTimezoneChange({ providerId: userId, timezone });

        if (!impact.safe) {
          await discardUpload(req.file);
          return errorResponse(
            res,
            `Moving to ${timezone} would leave ${impact.conflictCount} upcoming ` +
              `appointment${impact.conflictCount === 1 ? "" : "s"} outside your working hours. ` +
              `Cancel or reschedule ${impact.conflictCount === 1 ? "it" : "them"}, or keep your ` +
              `current timezone.`,
            409,
            ERROR_CODES.TIMEZONE_CONFLICT,
            impact
          );
        }
      }

      updateData.timezone = timezone;
    }

    // Country — both roles, for the reason `completeProfile` gives: a client's
    // country decides whether a domestic service is bookable by them, so it is
    // not a provider-only field.
    //
    // `!== undefined` rather than truthiness, and an empty string clears it to
    // NULL — the convention `phoneNumber` above established. Clearing has to be
    // possible: the value is *inferred* from a timezone for most accounts, so
    // someone whose inferred country is wrong needs a way to say "not this one"
    // as well as a way to correct it.
    if (country !== undefined) {
      if (country === null || String(country).trim() === "") {
        updateData.country = null;
      } else {
        const resolvedCountry = normaliseCountry(country);
        if (!resolvedCountry) {
          return validationErrorResponse(res, "Please fix the errors below", [
            { field: "country", message: "That is not a country we recognise" },
          ]);
        }
        updateData.country = resolvedCountry;
      }
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
      // Trimmed and checked rather than accepted on truthiness: `"   "` is
      // truthy and used to be stored verbatim, publishing a directory listing
      // whose heading rendered as nothing at all.
      if (businessName !== undefined) {
        const checkedBusinessName = validateBusinessName(businessName);
        if (!checkedBusinessName.ok) {
          return validationErrorResponse(res, "Please fix the errors below", [
            { field: "businessName", message: checkedBusinessName.message },
          ]);
        }
        updateData.business_name = checkedBusinessName.value;
      }
      if (businessType !== undefined) {
        const trimmedType = String(businessType).trim();
        if (!trimmedType) {
          return validationErrorResponse(res, "Please fix the errors below", [
            { field: "businessType", message: "Choose the category you work in" },
          ]);
        }
        updateData.business_type = trimmedType;
      }

      // Changing this re-denominates every price the provider already has: the
      // stored numbers do not move, only the currency they are read in. That is
      // the intended behaviour — it is a correction ("I have been showing rupees
      // and I charge pounds"), not a conversion — and the UI says so before
      // saving. Converting the amounts instead would need an exchange rate and a
      // date, which is a payments concern and out of scope.
      if (currency !== undefined) {
        const resolved = normaliseCurrency(currency);
        if (!resolved) {
          return validationErrorResponse(res, "Please fix the errors below", [
            { field: "currency", message: "That is not a currency we recognise" },
          ]);
        }
        updateData.currency = resolved;
      }

      // Where in-person appointments happen. Providers only, and it appears on
      // the public page, so it is gated on the role read from the database — the
      // same guard `bio` and `qualifications` are under.
      //
      // Clearing it is allowed even while an In-Person service is published.
      // Refusing that would be the wrong trade: the address is already wrong at
      // that point — that is why they are clearing it — and holding a stale
      // address on a public page to protect a constraint would keep sending
      // clients to a place the provider has left. `GET /availability/health`
      // reports the resulting gap so it is visible rather than silent.
      if (businessAddress !== undefined) {
        const checkedAddress = validateAddress(businessAddress);
        if (!checkedAddress.ok) {
          return validationErrorResponse(res, "Please fix the errors below", [
            { field: "businessAddress", message: checkedAddress.message },
          ]);
        }
        updateData.business_address = checkedAddress.value;
      }
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

    // A file multer refused on its declared type never becomes `req.file`, so
    // without this the request looks identical to one that sent nothing at all
    // and the user is told "No fields to update" — true, but not the reason.
    // Named here rather than in the middleware because only the controller
    // knows which allow-list applied to this route.
    if (req.rejectedUpload) {
      return validationErrorResponse(res, "Please fix the errors below", [
        {
          field: "profilePicture",
          message: "That file is not a supported image. Accepted formats: JPG or PNG.",
        },
      ]);
    }

    // Update user in database
    const columns = Object.keys(updateData);
    if (columns.length === 0) {
      // Phrased for the person reading it. "No fields to update" described the
      // request rather than the situation, and surfaced most often when someone
      // pressed Save without having changed anything.
      return errorResponse(res, "Nothing has changed yet", 400, ERROR_CODES.VALIDATION_FAILED);
    }

    const setClause = columns
      .map((col, idx) => `${col} = $${idx + 1}`)
      .join(", ");

    const updateSql = `
      UPDATE users
      SET ${setClause}, updated_at = NOW()
      WHERE id = $${columns.length + 1}
      RETURNING id, email, name, phone_number, timezone, bio, qualifications,
                avatar_url, role, business_name, business_type, currency,
                country, business_address,
                cancellation_cutoff_hours,
                -- Not written by this statement, but returned by it, because
                -- this response replaces the auth context wholesale and
                -- getCurrentUser includes it. Left out, saving the profile made
                -- has_password undefined, and Settings then told a password
                -- account it had signed in with Google or GitHub and offered to
                -- add a password -- a form with no current-password field, whose
                -- submit the server refused with a field error pointing at an
                -- input that was not on screen.
                (password_hash IS NOT NULL) AS has_password
    `;

    const result = await query(updateSql, [...Object.values(updateData), userId]);

    if (result.rows.length === 0) {
      return errorResponse(res, "User not found", 404);
    }

    // Trimmed for the reason `getCurrentUser` trims it: `country` is CHAR(2) and
    // PostgreSQL blank-pads it, so a raw "IN " reaching a `<select value="IN">`
    // matches no option and the control silently blanks. The two endpoints feed
    // the same auth context and have to hand back the same shape — this response
    // replaces that context wholesale after a save.
    const updated = result.rows[0];
    return successResponse(
      res,
      "Profile updated successfully",
      { ...updated, country: updated.country ? String(updated.country).trim() : null },
      200
    );
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
/**
 * Authentication and role middleware.
 *
 * Three guards, with deliberately different jobs:
 *
 *   - `verifyToken` — proves *who* the caller is, and blocks if it cannot.
 *   - `attachUserIfPresent` — recognises a caller if there is one, never blocks.
 *     Used on public routes that render differently for the owner.
 *   - `requireProviderRole` — proves *what* the caller is allowed to do.
 *
 * Authentication and authorization are separate on purpose, and neither is
 * sufficient alone: a valid session says nothing about whether that user may
 * touch this particular row. Ownership is therefore checked in the handlers,
 * against the specific record being acted on — see the booking and service
 * controllers, which compare `req.user.userId` to the row's own foreign keys.
 *
 * Every response here goes through the shared error envelope, so a client can
 * branch on `code` for an auth failure exactly as it does for any other error.
 */
import jwt from "jsonwebtoken";
import { query } from "../config/dbConfig.js";
import { errorResponse, ERROR_CODES } from "../responseController/responseHandler.js";

/**
 * Requires a valid session cookie and attaches its claims to `req.user`.
 *
 * The token is read from an httpOnly cookie rather than an Authorization
 * header, so no script running in the page can read it — which is the reason the
 * session is not kept in localStorage.
 *
 * @returns 401 UNAUTHENTICATED when the cookie is missing, forged or expired.
 *   The two cases are reported differently for the user's benefit but neither
 *   reveals anything about whether the account exists.
 */
export const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return errorResponse(res, "Not authenticated", 401, ERROR_CODES.UNAUTHENTICATED);
  }

  try {
    // Verifies the signature, so a client cannot edit the payload to become
    // another user, and checks `exp`.
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return errorResponse(res, "Invalid or expired session", 401, ERROR_CODES.UNAUTHENTICATED);
  }
};

/**
 * Attaches `req.user` when a valid session cookie is present, but never blocks.
 *
 * For public routes that still want to know who is looking — the provider page
 * shows editing controls to its owner, and renders slots in a signed-in
 * viewer's saved timezone. A missing or invalid token simply means "a guest",
 * which is a legitimate visitor here, not an error.
 */
export const attachUserIfPresent = (req, res, next) => {
  const token = req.cookies?.token;

  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // Invalid or expired token on a public route — treat as a guest.
    }
  }

  next();
};

/**
 * Requires the caller to be a provider.
 *
 * The role is read from the database on every call rather than taken from the
 * JWT, because a role can change after a token was issued and the token would
 * keep asserting the old one until it expired. This is a *role* check only —
 * it says the caller is some provider, not that they own the row they are about
 * to modify. Handlers still scope their writes to `req.user.userId`.
 *
 * @returns 403 FORBIDDEN for a client account or a user whose profile setup is
 *   incomplete (role still NULL); 500 if the lookup itself fails.
 */
export const requireProviderRole = async (req, res, next) => {
  try {
    const result = await query("SELECT role FROM users WHERE id = $1", [req.user.userId]);

    if (result.rows.length === 0 || result.rows[0].role !== "provider") {
      return errorResponse(res, "Only providers can perform this action", 403, ERROR_CODES.FORBIDDEN);
    }

    next();
  } catch (err) {
    console.error("requireProviderRole error:", err.message);
    return errorResponse(res, "Server error", 500, ERROR_CODES.SERVER_ERROR);
  }
};

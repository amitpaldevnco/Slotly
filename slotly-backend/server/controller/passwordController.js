/**
 * Changing your own password, from inside a session.
 *
 * ## Why this and not a reset link
 *
 * A "forgot password" link is the only way to help someone who cannot sign in,
 * but it needs an email transport to deliver it — and Slotly has none. Building
 * the token flow without the delivery would mean either logging reset links to
 * the server console, which is not a product, or standing up SMTP, which is a
 * bigger commitment than this app is making. So the recovery story is deliberately
 * narrower than the usual one: you can change your password whenever you are
 * signed in, and that is all.
 *
 * The trade-off is stated rather than hidden: an account whose password is
 * genuinely forgotten and which has no Google or GitHub identity attached cannot
 * be recovered. Google and GitHub sign-in exist partly for that reason — they
 * are the account-recovery path, delegated to providers who can verify a mailbox.
 *
 * ## Why the current password is required
 *
 * A session cookie proves the browser is signed in; it does not prove the person
 * holding it is the account's owner. Without this check, an unattended laptop or
 * a stolen cookie is enough to take the account permanently by changing its
 * password — which is exactly the escalation the check exists to stop. The same
 * reasoning is why this is not folded into `updateProfile`, where every other
 * field needs no such proof.
 *
 * ## Accounts with no password yet
 *
 * A Google- or GitHub-only account has no `password_hash` to verify, so there is
 * nothing to ask for and `currentPassword` is not required. Adding one is a
 * genuine addition rather than a change: it gives that account a second way in
 * without removing the first.
 */
import bcrypt from "bcrypt";
import { query } from "../config/dbConfig.js";
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
  ERROR_CODES,
} from "../responseController/responseHandler.js";

/** bcrypt work factor. Kept equal to the one in authController. */
const BCRYPT_ROUNDS = 10;

/** Matches the minimum enforced at registration. */
const PASSWORD_MIN = 8;

/**
 * PATCH /api/auth/password — requires a session.
 *
 * Body: `{ currentPassword, newPassword }`. `currentPassword` is required for an
 * account that has one and ignored for an account that does not.
 *
 * Existing sessions elsewhere are not revoked, because sessions are stateless
 * JWTs with no server-side store to invalidate — a known limitation recorded in
 * the README rather than papered over here.
 *
 * @returns 200 on success. 400 when the new password is too short or is the same
 *   as the old one. 401 INVALID_CREDENTIALS when `currentPassword` is wrong —
 *   deliberately the same code the login form returns, because it is the same
 *   statement about the same secret. 404 if the session names a user that no
 *   longer exists.
 */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};

    const found = await query(
      "SELECT id, password_hash, google_id, github_id FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (found.rows.length === 0) {
      return errorResponse(res, "User not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const user = found.rows[0];

    if (!newPassword || String(newPassword).length < PASSWORD_MIN) {
      return validationErrorResponse(res, "Please fix the errors below", [
        {
          field: "newPassword",
          message: `Password must be at least ${PASSWORD_MIN} characters`,
        },
      ]);
    }

    if (user.password_hash) {
      if (!currentPassword) {
        return validationErrorResponse(res, "Please fix the errors below", [
          { field: "currentPassword", message: "Enter your current password" },
        ]);
      }

      const matches = await bcrypt.compare(String(currentPassword), user.password_hash);
      if (!matches) {
        // A field error rather than a bare 401 body, so the form can attach it to
        // the input that is wrong instead of showing a banner that does not say
        // which of the two passwords it means.
        return errorResponse(
          res,
          "That is not your current password",
          401,
          ERROR_CODES.INVALID_CREDENTIALS,
          { field: "currentPassword" }
        );
      }

      // Caught here rather than allowed through: "changed" is what the success
      // message will claim, and it would not be true.
      const unchanged = await bcrypt.compare(String(newPassword), user.password_hash);
      if (unchanged) {
        return validationErrorResponse(res, "Please fix the errors below", [
          { field: "newPassword", message: "That is already your password" },
        ]);
      }
    }

    const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    await query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [
      passwordHash,
      user.id,
    ]);

    // `hadPassword` lets the client word its confirmation correctly: a social
    // account has just *gained* a password rather than changed one.
    return successResponse(res, "Password updated", { hadPassword: Boolean(user.password_hash) });
  } catch (err) {
    console.error("changePassword error:", err.message);
    return errorResponse(res, "Could not change your password", 500);
  }
};

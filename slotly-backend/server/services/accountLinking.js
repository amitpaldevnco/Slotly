/**
 * Resolving a social login to exactly one user row.
 *
 * ## The requirement this exists to satisfy
 *
 * A social login and a password account that share an email address must
 * resolve to a *single* user. Someone who registers with email and password and
 * later clicks "Sign in with Google" has to land in the account they already
 * have — not a second one, and not an error.
 *
 * ## Why it is a shared module rather than inline in each handler
 *
 * Google and GitHub need byte-for-byte identical account resolution; only the
 * column the external id lands in differs. Written twice, the two copies drift —
 * which is exactly what had happened: the GitHub callback linked by email while
 * the Google handler went straight from a `google_id` miss to an INSERT.
 * Because `users.email` is UNIQUE, that INSERT raised SQLSTATE 23505 for any
 * address that already had an account, which surfaced to the user as
 * "Google authentication failed" and locked them out of Google sign-in for good.
 *
 * Keeping the rule in one place also makes it testable without standing up an
 * OAuth provider: the interesting logic is which row you end up on, and that is
 * pure database work once the provider has told you an email.
 */
import { query } from "../config/dbConfig.js";

/**
 * Which column each provider's external id lives in.
 *
 * An allow-list, not a template: the column name is interpolated into SQL, so it
 * must never be able to come from a request. Looking it up here means an unknown
 * provider throws rather than reaching the query.
 */
const ID_COLUMN = {
  google: "google_id",
  github: "github_id",
};

/**
 * Finds, links, or creates the user behind a verified social identity.
 *
 * Resolution runs in three steps, in this order:
 *
 *   1. **Already linked** — a row carrying this provider id. Returned as-is.
 *   2. **Same email, different sign-in method** — a row with this email but no
 *      link to this provider yet. The provider id is attached to that row, so
 *      the two sign-in methods become two doors into one account.
 *   3. **Genuinely new** — no match either way. A new row is created.
 *
 * Step 2 writes *only* the id column. `name` and `avatar_url` are deliberately
 * left alone: the user may have set their own on an account they have been using
 * for months, and signing in is not a request to have that overwritten with
 * whatever the provider currently holds.
 *
 * @param {object} args
 * @param {"google"|"github"} args.provider Which social provider verified this.
 * @param {string} args.providerUserId The provider's stable user id (Google's
 *   `sub`, GitHub's numeric `id`). Must come from a *verified* token or an API
 *   call made with a token the backend exchanged itself — never from the client.
 * @param {string} args.email Verified email address from the provider.
 * @param {string} [args.name] Display name, used only when creating a new row.
 * @param {string} [args.avatarUrl] Avatar URL, used only when creating a new row.
 * @returns {Promise<{user: object, isNewUser: boolean, linked: boolean}>}
 *   `linked` is true only in case 2 — an existing account gaining a new sign-in
 *   method — which callers can use to word their response.
 * @throws {Error} If `provider` is not a known provider. That is a programming
 *   error, not a user error, so it is not turned into a validation message.
 */
export async function resolveSocialAccount({ provider, providerUserId, email, name, avatarUrl }) {
  const idColumn = ID_COLUMN[provider];
  if (!idColumn) throw new Error(`Unknown social provider: ${provider}`);

  if (!providerUserId) throw new Error("resolveSocialAccount requires a provider user id");
  if (!email) throw new Error("resolveSocialAccount requires an email address");

  // 1) Already linked by this provider's id.
  const byProviderId = await query(`SELECT * FROM users WHERE ${idColumn} = $1`, [String(providerUserId)]);
  if (byProviderId.rows.length > 0) {
    return { user: byProviderId.rows[0], isNewUser: false, linked: false };
  }

  // 2) The email already has an account reached by some other method — a
  //    password, or the other social provider. Attach this identity to it.
  const byEmail = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  if (byEmail.rows.length > 0) {
    const linked = await query(
      `UPDATE users SET ${idColumn} = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [String(providerUserId), byEmail.rows[0].id]
    );
    return { user: linked.rows[0], isNewUser: false, linked: true };
  }

  // 3) Nobody here by either route — a genuinely new account. `role` is left
  //    NULL, which is how the app knows to route them to profile completion.
  const inserted = await query(
    `INSERT INTO users (${idColumn}, email, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [String(providerUserId), email, name || null, avatarUrl || null]
  );

  return { user: inserted.rows[0], isNewUser: true, linked: false };
}

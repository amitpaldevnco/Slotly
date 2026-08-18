/**
 * Everything the app can ask about, or do to, the current session.
 *
 * The session itself is an httpOnly cookie this JavaScript cannot read, so there
 * is no token to pass around here — each call simply rides the cookie the browser
 * already sends, and `getCurrentUser` is how the app discovers who that cookie
 * belongs to.
 */
import { api, unwrap, API_BASE_URL } from "./client";

// The signed-in user, or a 401 rejection when there is no session.
export const getCurrentUser = () => api.get("/auth/me").then(unwrap);

/**
 * Ends the session by asking the server to clear the cookie.
 *
 * Has to be a request rather than a local state reset: the cookie is httpOnly,
 * so this JavaScript cannot delete it. Resolves with the raw response — there is
 * no payload worth unwrapping.
 */
export const logout = () => api.post("/auth/logout");

/**
 * Creates a password account and signs it in.
 *
 * @param {{name: string, email: string, password: string}} payload Password must
 *   be at least 8 characters.
 * @returns `{ user, isNewUser, profileComplete }`. `profileComplete` is false
 *   here by design — role and timezone are chosen in the next step, by
 *   `completeProfile`, which is the only place a role is ever written.
 *
 * Rejects 409 `ACCOUNT_EXISTS` when the address already has a password account,
 * or 409 `WRONG_AUTH_METHOD` when it belongs to a social one — in which case
 * `details.provider` names the button to send the user to instead.
 */
export const registerWithEmail = (payload) => api.post("/auth/register", payload).then(unwrap);

/**
 * Signs in with an email and password.
 *
 * A wrong password and an unknown address are answered identically, on purpose:
 * distinguishing them would turn the form into a way to test which addresses
 * have accounts. Rejects 409 `WRONG_AUTH_METHOD` when the account exists but was
 * created through Google or GitHub.
 */
export const loginWithEmail = (payload) => api.post("/auth/login", payload).then(unwrap);

/**
 * Exchanges the ID token from Google's button for a session.
 *
 * The server verifies the token against its own client id rather than trusting
 * it. If the Google address already has a password account, the two are linked
 * into one user rather than duplicated — the social provider has verified the
 * address, so attaching it is safe in that direction.
 *
 * @param {string} credential The ID token from @react-oauth/google.
 */
export const loginWithGoogle = (credential) =>
  api.post("/auth/google", { credential }).then(unwrap);


/**
 * Where to send the browser to begin GitHub sign-in.
 *
 * A URL rather than a request: OAuth needs a full-page navigation so GitHub can
 * show its own consent screen. The server handles the callback and redirects
 * back with the session cookie already set.
 */
export const githubRedirectUrl = () => `${API_BASE_URL}/auth/github`;

/**
 * The second half of signing up: choosing a role and a timezone.
 *
 * Runs exactly once per account. `role` is the axis every authorization decision
 * turns on, so it cannot be changed afterwards — a repeat call rejects with 409
 * `INVALID_TRANSITION`, and `updateProfile` cannot touch it at all.
 *
 * @param {{role: "client"|"provider", phoneNumber: string, timezone: string,
 *   businessName?: string, businessType?: string}} payload The two business
 *   fields are required for a provider and ignored for a client. `timezone` must
 *   be an IANA name the server can resolve.
 */
export const completeProfile = (payload) =>
  api.patch("/auth/complete-profile", payload).then(unwrap);

/**
 * Edits an existing profile. Never touches `role`; see `completeProfile`.
 *
 * FormData rather than JSON so a new avatar can travel with the other fields.
 * Changing `timezone` here re-renders every appointment in the new zone without
 * moving any of them — a booking is a fixed instant, and only the reader changed.
 *
 * @param {FormData} formData Any of `phoneNumber`, `timezone`, `bio`,
 *   `businessName`, `businessType`, `qualifications`, `profilePicture`.
 */
export const updateProfile = (formData) => api.patch("/auth/profile", formData).then(unwrap);

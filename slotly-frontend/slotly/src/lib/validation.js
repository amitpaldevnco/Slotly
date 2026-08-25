/**
 * Client-side copies of the server's rules for the fields people type about
 * themselves.
 *
 * These are a *mirror*, never the authority. The server validates every one of
 * these again against the row being written, and its answer is the one that
 * counts — this file exists so the answer arrives instantly and without a round
 * trip, not so the round trip can be skipped.
 *
 * Two things made that worth doing:
 *
 *   - The sign-in and sign-up forms had no local validation at all. Pressing
 *     "Create account" on an empty form was a network request whose only purpose
 *     was to be told the form was empty — and because registration is rate
 *     limited *counting failures*, a few mistyped attempts could exhaust the
 *     hourly allowance before the user had successfully signed up once.
 *   - Where local rules did exist they had drifted from the server's, so a value
 *     could pass here and fail there, which reads as the app being broken rather
 *     than the input being wrong.
 *
 * The messages are deliberately identical to the server's, so a field cannot
 * change its wording depending on which side caught it. Keep them in step with
 * `slotly-backend/server/utils/identity.js`.
 */

/** Matches `NAME_MIN`/`NAME_MAX` in the backend's identity module. */
export const NAME_MIN = 2;
export const NAME_MAX = 255;

/** The shortest password the server will store. */
export const PASSWORD_MIN = 8;

/**
 * @typedef {string|null} FieldError A message to show under the field, or null
 *   when the value is acceptable.
 */

/**
 * @param {string} name
 * @returns {FieldError}
 */
export function checkName(name) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "Name is required";
  if (trimmed.length < NAME_MIN) return `Name must be at least ${NAME_MIN} characters`;
  if (trimmed.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or less`;
  return null;
}

/**
 * @param {string} email
 * @returns {FieldError}
 */
export function checkEmail(email) {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Enter a valid email address";
  return null;
}

/**
 * @param {string} password
 * @returns {FieldError}
 */
export function checkPassword(password) {
  if (!password) return "Password is required";
  if (password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters`;
  }
  return null;
}

/**
 * Checks the confirmation box on the sign-up and reset forms.
 *
 * The confirmation exists because neither form can be undone by the user: sign-up
 * takes the password once and, with a mistyped one, the account is unreachable
 * from the login screen. Reset has the same shape. Typing it twice is the cheap
 * way to catch the typo while the person is still here.
 *
 * @param {string} password
 * @param {string} confirmation
 * @returns {FieldError}
 */
export function checkPasswordConfirmation(password, confirmation) {
  if (!confirmation) return "Re-enter your password";
  if (password !== confirmation) return "Those passwords do not match";
  return null;
}

/**
 * Checks a phone number the same way the server does.
 *
 * A shape check rather than a locale-aware parse — digits and the punctuation
 * people actually type. It replaces having no check at all, which is how
 * `abcdef` came to be stored in a field whose entire purpose is being reachable
 * when an appointment has to move.
 *
 * @param {string} phone
 * @param {{ allowEmpty?: boolean }} [options] When `allowEmpty`, a blank value
 *   is accepted as "remove my number" rather than reported as missing. Profile
 *   editing passes this; sign-up does not.
 * @returns {FieldError}
 */
export function checkPhone(phone, { allowEmpty = false } = {}) {
  const trimmed = (phone ?? "").trim();

  if (!trimmed) return allowEmpty ? null : "Phone number is required";
  if (trimmed.length > 30) return "Phone number must be 30 characters or less";
  if (!/^[\d\s\-+()]+$/.test(trimmed)) return "Use only digits, spaces and + - ( )";

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return "That is too short to be a phone number";
  if (digits.length > 15) return "That is too long to be a phone number";
  return null;
}

/**
 * @param {string} businessName
 * @returns {FieldError}
 */
export function checkBusinessName(businessName) {
  const trimmed = (businessName ?? "").trim();
  if (!trimmed) return "Business name is required";
  if (trimmed.length > 255) return "Business name must be 255 characters or less";
  return null;
}

/**
 * Drops the `null`s from a map of field results.
 *
 * Lets a form express its whole rule set as one object literal and hand the
 * result straight to its error state, instead of pushing onto an array and then
 * converting. An empty object means the form is good to send.
 *
 * @param {Record<string, FieldError>} checks
 * @returns {Record<string, string>}
 */
export function collectErrors(checks) {
  return Object.fromEntries(Object.entries(checks).filter(([, message]) => message));
}

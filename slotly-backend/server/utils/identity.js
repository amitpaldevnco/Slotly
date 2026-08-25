/**
 * Normalisation and validation for the fields that identify a person.
 *
 * These four — email, name, phone number, business name — were each validated in
 * two or three places that had quietly drifted apart, which is how the same
 * value could be accepted by one form and rejected by another:
 *
 *   - `registerUser` accepted any truthy name, so `"   "` and `"A"` both became
 *     accounts, while the service form rejected a whitespace-only name properly.
 *   - `completeProfile` accepted any truthy phone number, so `"abcdef"` was
 *     stored, while `updateProfile` a few hundred lines away applied a real
 *     format check.
 *   - Email was compared byte-for-byte, so a capitalised first letter — which is
 *     what a phone keyboard offers by default — failed to match an existing
 *     account and could create a second one.
 *
 * So the rules live here once and every caller imports them. Each validator
 * returns the same shape, `{ ok, value, message }`, where `value` is the
 * *normalised* form to store — callers are expected to persist `value` rather
 * than the raw input, which is what makes trimming actually take effect.
 */

/** Longest name we will store. Matches `users.name` (VARCHAR(255)). */
export const NAME_MAX = 255;

/** Shortest name that is plausibly a name rather than a stray keypress. */
export const NAME_MIN = 2;

/** Matches `users.phone_number` (VARCHAR(30)). */
export const PHONE_MAX = 30;

/** Matches `users.business_name` (VARCHAR(255)). */
export const BUSINESS_NAME_MAX = 255;

/**
 * Casefolds and trims an email so it can be used as an identifier.
 *
 * Addresses are case-insensitive in practice — no mail provider treats
 * `Casey@` and `casey@` as different people — but Postgres compares VARCHAR
 * case-sensitively, so without this the UNIQUE constraint permits a duplicate
 * account per capitalisation and `WHERE email = $1` misses the row it wants.
 *
 * Applied on registration, login, password reset and both OAuth paths, so every
 * route that can create or find an account agrees on what the address is.
 *
 * @param {unknown} email
 * @returns {string} The casefolded address, or `""` for anything that is not a
 *   string. Never null, so callers can compare without a guard.
 */
export function normaliseEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * The shape every validator in this file returns.
 *
 * @typedef {{ ok: boolean, value: string|null, message: string|null }} FieldResult
 */

/** @returns {FieldResult} */
const ok = (value) => ({ ok: true, value, message: null });

/** @returns {FieldResult} */
const fail = (message) => ({ ok: false, value: null, message });

/**
 * Checks an email is well formed, and returns it casefolded.
 *
 * The pattern is deliberately the permissive one already used at registration —
 * something, an @, something, a dot, something — rather than a stricter attempt
 * at RFC 5322. Over-strict email regexes reject real addresses, and the only
 * authority on whether an address exists is whether mail to it arrives.
 *
 * @param {unknown} email
 * @returns {FieldResult}
 */
export function validateEmail(email) {
  const normalised = normaliseEmail(email);
  if (!normalised) return fail("Email is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    return fail("Enter a valid email address");
  }
  return ok(normalised);
}

/**
 * Checks a person's display name and returns it trimmed.
 *
 * Trimming before the emptiness check is the entire point: `"   "` is truthy, so
 * a bare `if (!name)` let it through and the account was created with a name
 * that renders as nothing at all — on their dashboard greeting, on the
 * provider's appointment list, and beside any review they left.
 *
 * @param {unknown} name
 * @returns {FieldResult}
 */
export function validateName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return fail("Name is required");
  if (trimmed.length < NAME_MIN) return fail(`Name must be at least ${NAME_MIN} characters`);
  if (trimmed.length > NAME_MAX) return fail(`Name must be ${NAME_MAX} characters or less`);
  return ok(trimmed);
}

/**
 * Checks a business name and returns it trimmed.
 *
 * Held to the same trim-first rule as a person's name, and for a sharper reason:
 * this string *is* the provider's heading in the public directory, so a
 * whitespace-only value publishes a listing with no title.
 *
 * @param {unknown} businessName
 * @returns {FieldResult}
 */
export function validateBusinessName(businessName) {
  const trimmed = typeof businessName === "string" ? businessName.trim() : "";
  if (!trimmed) return fail("Business name is required");
  if (trimmed.length > BUSINESS_NAME_MAX) {
    return fail(`Business name must be ${BUSINESS_NAME_MAX} characters or less`);
  }
  return ok(trimmed);
}

/**
 * Checks a phone number and returns it trimmed.
 *
 * Deliberately a *shape* check and not a locale-aware one: digits, spaces and
 * the punctuation people actually type — `+`, `-`, `(`, `)`. Requiring a minimum
 * count of digits rather than a pattern keeps `+91 98765 43210`,
 * `(020) 7946 0000` and `+1-555-000-1234` all valid while rejecting `abcdef`,
 * which was previously stored verbatim and is unusable for the one thing the
 * field exists for — reaching someone when an appointment has to move.
 *
 * Parsing properly per country needs a library and a country code the form does
 * not collect; that is a bigger change than this field warrants.
 *
 * @param {unknown} phone
 * @param {{ allowEmpty?: boolean }} [options] When `allowEmpty`, an empty string
 *   resolves to `{ ok: true, value: null }` — a deliberate "remove my number"
 *   rather than a validation failure. Used by profile editing, where clearing
 *   the field has to be possible; not used at sign-up, where it is required.
 * @returns {FieldResult}
 */
export function validatePhone(phone, { allowEmpty = false } = {}) {
  const trimmed = typeof phone === "string" ? phone.trim() : "";

  if (!trimmed) {
    return allowEmpty ? ok(null) : fail("Phone number is required");
  }
  if (trimmed.length > PHONE_MAX) {
    return fail(`Phone number must be ${PHONE_MAX} characters or less`);
  }
  if (!/^[\d\s\-+()]+$/.test(trimmed)) {
    return fail("Use only digits, spaces and + - ( )");
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return fail("That is too short to be a phone number");
  if (digits.length > 15) return fail("That is too long to be a phone number");

  return ok(trimmed);
}

/**
 * Countries, and the one place that decides what counts as one.
 *
 * ## Why a library rather than a list
 *
 * The same reasoning `isValidTimezone` applies to Luxon and `normaliseCurrency`
 * applies to `Intl`: the authority on what codes exist should be the thing that
 * will later interpret them, not a constant in this repository that drifts from
 * it. `countries-and-timezones` is already a frontend dependency for exactly
 * this purpose — the timezone picker reads country names out of it — so using it
 * on the server means both halves of the app agree on the set of countries and
 * on which country a timezone belongs to. A hand-written list would eventually
 * accept a code the client refuses to render, or refuse one the client offers.
 *
 * ## Why the country is a column and the street address is free text
 *
 * The country is filtered on — `booking_scope = 'domestic'` is a comparison
 * between two countries, and the directory can narrow by it — so it is a
 * structured `CHAR(2)` holding an ISO 3166-1 alpha-2 code and nothing else. The
 * street address is only ever displayed, never queried, so it follows the
 * precedent `users.qualifications` set in `config/schema.js`: one unstructured
 * field, because structuring data nothing queries buys nothing and costs a
 * migration to undo.
 *
 * The code alone is stored, never a country *name*. Names are localised and
 * change; the code is stable, and `countryName()` exists for the one place that
 * needs to render one.
 */
import ct from "countries-and-timezones";

/** Longest a stored business address may be, in characters. */
export const ADDRESS_MAX = 500;

/**
 * Normalises a country code, or returns null if it is not one.
 *
 * @param {unknown} code Any case; "gb" and "GB" are the same country.
 * @returns {string|null} The upper-cased ISO 3166-1 alpha-2 code, or null when
 *   the value is not a country this runtime knows about.
 */
export function normaliseCountry(code) {
  if (typeof code !== "string") return null;

  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return null;

  // Shape alone is not enough: "ZZ" and "XX" are well-formed and are not
  // countries, and storing one would put a value in the column that no screen
  // can render and no comparison can meaningfully use.
  return ct.getCountry(upper) ? upper : null;
}

/**
 * The country a timezone belongs to, used as a default rather than a rule.
 *
 * Every account already states a timezone — it is `NOT NULL` and the sign-up
 * form pre-fills it from the browser — so a country can be inferred for almost
 * everyone without asking them a second question. That is what makes
 * `booking_scope = 'domestic'` enforceable against accounts created before the
 * column existed, and what lets the sign-up form offer a sensible default.
 *
 * It is only ever a *default*. A timezone is a poor proxy for a country in both
 * directions — America/New_York is one of twenty-nine US zones, and Europe/Zurich
 * covers a border region — so the value it produces is always overridable, and
 * the profile form lets anyone correct it.
 *
 * @param {unknown} timezone IANA zone name.
 * @returns {string|null} ISO 3166-1 alpha-2 code, or null when the zone is
 *   unknown or spans no single country.
 */
export function countryForTimezone(timezone) {
  if (typeof timezone !== "string" || !timezone) return null;
  return ct.getCountryForTimezone(timezone)?.id ?? null;
}

/**
 * The English display name for a country code.
 *
 * For server-composed prose only — "This service is only offered to clients in
 * the United Kingdom". Anything the client renders gets the bare code, which it
 * localises itself; see the comment on `users.currency` in `config/schema.js`
 * for the same argument applied to currency symbols.
 *
 * @param {unknown} code
 * @returns {string|null} The country's name, or null if the code is unknown.
 */
export function countryName(code) {
  const normalised = normaliseCountry(code);
  return normalised ? (ct.getCountry(normalised)?.name ?? null) : null;
}

/**
 * Every timezone this runtime knows, paired with its country.
 *
 * Exists for the one-time backfill in `config/schema.js`, which needs the whole
 * mapping as two parallel arrays so a single parameterised UPDATE can apply it
 * — the alternative being 341 statements, or the mapping duplicated in SQL.
 *
 * @returns {{timezones: string[], countries: string[]}} Same length, index-aligned.
 */
export function timezoneCountryPairs() {
  const timezones = [];
  const countries = [];

  for (const name of Object.keys(ct.getAllTimezones())) {
    // Resolved through `getCountryForTimezone`, the same call `countryForTimezone`
    // uses, rather than by requiring `zone.countries` to hold exactly one entry.
    //
    // That stricter reading looked safer and was wrong in the case that matters
    // most here: Europe/London lists GB, GG, IM and JE — the Crown dependencies
    // share the zone — so "exactly one country" skipped the United Kingdom
    // entirely and left every London provider with no country at all. The
    // library already knows which of the four is the zone's primary country, and
    // deferring to it is both correct and consistent with the rest of this file.
    //
    // A zone belonging to no country (UTC, Etc/GMT) yields null and is skipped;
    // those accounts keep the "not stated" reading `evaluateBookingScope`
    // already handles.
    const country = ct.getCountryForTimezone(name)?.id;
    if (country) {
      timezones.push(name);
      countries.push(country);
    }
  }

  return { timezones, countries };
}

/**
 * Trims and length-checks a free-text business address.
 *
 * @param {unknown} address
 * @param {{allowEmpty?: boolean}} [options] `allowEmpty` lets "" through as a
 *   deliberate "remove what I wrote", returning null — the same convention
 *   `validatePhone` uses.
 * @returns {{ok: true, value: string|null}|{ok: false, message: string}}
 */
export function validateAddress(address, { allowEmpty = true } = {}) {
  if (address === undefined || address === null) {
    return allowEmpty ? { ok: true, value: null } : { ok: false, message: "Address is required" };
  }

  const trimmed = String(address).trim();
  if (!trimmed) {
    return allowEmpty ? { ok: true, value: null } : { ok: false, message: "Address is required" };
  }
  if (trimmed.length > ADDRESS_MAX) {
    return { ok: false, message: `Address must be ${ADDRESS_MAX} characters or less` };
  }

  return { ok: true, value: trimmed };
}

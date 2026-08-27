/**
 * The country picker's data, and the guess it starts from.
 *
 * ## Every country, not a curated shortlist
 *
 * The opposite call from `lib/currencies.js`, and for a reason that is specific
 * to what each field does. A currency is a *choice* out of maybe twenty a
 * provider might plausibly bill in, so a 180-row dropdown there is worse for
 * everybody. A country is a *fact* about where someone is, there is exactly one
 * right answer, and a shortlist that omits it leaves that person unable to state
 * it at all — which for a `domestic` service means unable to be told whether
 * they may book. So the list is complete, and the control is searchable.
 *
 * ## Why the default is inferred rather than blank
 *
 * Every account already states a timezone, and the sign-up form pre-fills that
 * from the browser. A timezone implies a country for almost everyone, so
 * defaulting from it means most people never think about this field — and the
 * server does the same inference for anyone who leaves it unanswered, so the
 * form and the API agree on the starting value.
 *
 * It is only ever a default. A timezone is a poor proxy in both directions —
 * America/New_York is one of twenty-nine US zones, Europe/Zurich covers a border
 * region — so the picker always shows it and always lets it be changed.
 */
import ct from "countries-and-timezones";
import { normalizeTimezone } from "./timezones";
import { countryLabel } from "./serviceScope";

/**
 * Every country, as `{ code, name }`, sorted by name in the reader's locale.
 *
 * Names come from `countryLabel`, which asks `Intl.DisplayNames` — so the list
 * is in the reader's own language rather than in the English the data file
 * happens to carry, and it sorts correctly in that language.
 *
 * @returns {Array<{code: string, name: string}>}
 */
export function buildCountryOptions() {
  return Object.keys(ct.getAllCountries())
    .map((code) => ({ code, name: countryLabel(code) || code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The country a timezone implies, for use as a form default.
 *
 * Uses the library's own primary-country resolution rather than requiring the
 * zone to belong to exactly one country. That stricter reading looks safer and
 * is wrong in the case that matters most: Europe/London lists GB alongside the
 * Crown dependencies, so "exactly one" would leave every London provider with
 * no default at all. The server's `countryForTimezone` resolves it the same way,
 * which is what keeps the two in step.
 *
 * @param {string|null|undefined} timezone IANA zone name.
 * @returns {string|null} ISO 3166-1 alpha-2, or null for a zone belonging to no
 *   country — UTC, for instance, which is a real answer rather than a failure.
 */
export function countryFromTimezone(timezone) {
  if (typeof timezone !== "string" || !timezone) return null;
  return ct.getCountryForTimezone(normalizeTimezone(timezone))?.id ?? null;
}

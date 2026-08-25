/**
 * The categories a provider can be listed under.
 *
 * ## Why this file exists
 *
 * The list was written out twice — in `CompleteProfilePage` and in
 * `EditProfilePage` — and the discovery page derived its filter from whatever
 * strings happened to be in the database instead. So three screens disagreed
 * about what a category is, and the disagreement was visible:
 *
 *   - The directory offered "Physiotherapy", "Therapy" and "Tutoring", none of
 *     which are in the dropdown, alongside "Healthcare" and "Education", which
 *     are the same things under their canonical names. A visitor filtering by
 *     Healthcare did not see the physiotherapists.
 *   - Worse, a provider whose stored category was "Physiotherapy" opened their
 *     profile form and saw **"Healthcare"** selected, because a `<select>` whose
 *     value matches no option falls back to the first one. They were being shown
 *     a category that was not theirs, and saving the form would have written it.
 *
 * One list here, imported by all three, plus an explicit answer for values that
 * predate it.
 */

/** The canonical list, in the order it is offered. */
export const CATEGORIES = [
  "Healthcare",
  "Salon & Beauty",
  "Fitness",
  "Education",
  "Legal",
  "Consulting",
  "Automotive",
  "Home Services",
  "Repair Services",
  "Photography",
  "Pet Care",
  "Travel",
  "Finance",
  "Other",
];

/**
 * Free-text categories that existed before the list did, mapped onto it.
 *
 * Used for *filtering* only — a provider stored as "Physiotherapy" is found
 * under Healthcare, so the directory stops splitting one profession across two
 * near-duplicate filters. It deliberately does not rewrite what the provider has
 * stored: renaming somebody's own description of their business without asking
 * is not this file's decision to make. Their profile form shows them the real
 * value and invites them to pick a canonical one (see `categoryOptions`).
 *
 * Keys are compared casefolded.
 */
const LEGACY_ALIASES = {
  physiotherapy: "Healthcare",
  physio: "Healthcare",
  therapy: "Healthcare",
  counselling: "Healthcare",
  counseling: "Healthcare",
  nutrition: "Healthcare",
  wellness: "Healthcare",
  dental: "Healthcare",
  medical: "Healthcare",
  tutoring: "Education",
  tuition: "Education",
  teaching: "Education",
  coaching: "Fitness",
  yoga: "Fitness",
  "personal training": "Fitness",
  gym: "Fitness",
  salon: "Salon & Beauty",
  beauty: "Salon & Beauty",
  hair: "Salon & Beauty",
  spa: "Salon & Beauty",
  business: "Consulting",
  "business consulting": "Consulting",
  finance: "Finance",
  accounting: "Finance",
  photography: "Photography",
  photographer: "Photography",
  pets: "Pet Care",
  veterinary: "Pet Care",
};

/** True when `value` is one of the canonical categories, exactly. */
export function isKnownCategory(value) {
  return CATEGORIES.includes(value);
}

/**
 * The canonical category a stored value belongs under, for filtering and
 * grouping.
 *
 * @param {string|null|undefined} value Whatever is in `business_type`.
 * @returns {string|null} A member of `CATEGORIES`, or the original trimmed
 *   string when nothing matches — so an unrecognised category still groups with
 *   itself rather than vanishing from the directory or being lumped into
 *   "Other", which would hide it from the provider who set it.
 */
export function normaliseCategory(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (isKnownCategory(trimmed)) return trimmed;
  return LEGACY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * The options a category `<select>` should render, given what is stored.
 *
 * When the stored value is not canonical it is returned as an extra option at
 * the top, labelled as the provider's current setting. That is the whole fix for
 * the silent-substitution bug: the control shows what the account actually says
 * instead of quietly resolving to the first option, and the provider can see
 * that it is unlisted and choose a real one.
 *
 * @param {string|null|undefined} current The stored `business_type`.
 * @returns {Array<{value: string, label: string}>}
 */
export function categoryOptions(current) {
  const trimmed = (current ?? "").trim();
  const canonical = CATEGORIES.map((name) => ({ value: name, label: name }));

  if (!trimmed || isKnownCategory(trimmed)) return canonical;

  return [{ value: trimmed, label: `${trimmed} (not a listed category)` }, ...canonical];
}

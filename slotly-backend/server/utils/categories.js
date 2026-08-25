/**
 * The canonical provider categories, and the free-text values that predate them.
 *
 * A deliberate mirror of `slotly-frontend/slotly/src/lib/categories.js`. The two
 * services share no code by design, so the list is written twice — keep them in
 * step, the same way `utils/identity.js` mirrors the frontend's validation rules.
 *
 * ## What this is for here
 *
 * The directory groups providers by canonical category: someone stored as
 * "Physiotherapy" or "Therapy" is listed and filtered under **Healthcare**. The
 * search box, though, matched `business_type` as literal text — so searching
 * "Healthcare" found only the providers whose column happened to say exactly
 * that, and missed every physiotherapist the very same page filed under
 * Healthcare. One dataset, two answers, depending on whether you clicked the
 * filter or typed the word.
 *
 * `rawTypesForCategorySearch` closes that gap: it turns a search term into every
 * stored spelling that belongs to a category the term names.
 */

/** The canonical list, in the order the profile form offers it. */
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
 * Stored values that predate the list, mapped onto it. Keys are compared
 * casefolded. Kept identical to the frontend's table.
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

/**
 * Every stored `business_type` spelling that should be found by a search for
 * `term`, lowercased for a case-insensitive comparison.
 *
 * Two ways in, both substring matches so that "health" finds Healthcare and
 * "beauty" finds Salon & Beauty:
 *
 *   1. The term names a canonical category → return that category plus every
 *      legacy spelling that resolves to it. This is what makes searching
 *      "Healthcare" return the physiotherapists.
 *   2. The term names a legacy spelling → return the canonical category it maps
 *      to, and its siblings. So searching "physio" also surfaces the providers
 *      who wrote "Healthcare", which is the same profession under the tidier
 *      name.
 *
 * @param {string} term Raw search input.
 * @returns {string[]} Lowercased `business_type` values, possibly empty. An
 *   empty result means the term names no category, and the caller should simply
 *   not add a category condition — never treat it as "match nothing".
 */
export function rawTypesForCategorySearch(term) {
  const needle = String(term ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return [];

  // Which canonical categories does this term point at?
  const canonical = new Set(
    CATEGORIES.filter((name) => name.toLowerCase().includes(needle))
  );

  for (const [alias, target] of Object.entries(LEGACY_ALIASES)) {
    if (alias.includes(needle)) canonical.add(target);
  }

  if (canonical.size === 0) return [];

  // Every stored spelling that lands on one of them.
  const spellings = new Set();
  for (const name of canonical) {
    spellings.add(name.toLowerCase());
    for (const [alias, target] of Object.entries(LEGACY_ALIASES)) {
      if (target === name) spellings.add(alias);
    }
  }

  return [...spellings];
}

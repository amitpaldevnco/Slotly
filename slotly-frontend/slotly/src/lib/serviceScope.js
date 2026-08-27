/**
 * How a service is delivered, and who may book it — the client's half.
 *
 * Two independent properties, and the app is careful never to derive one from
 * the other:
 *
 *   - **`deliveryType`** — `in_person` or `virtual`. Says *where*.
 *   - **`bookingScope`** — `domestic` or `international`. Says *who*.
 *
 * A clinic can see international visitors in person and an online tutor can take
 * domestic students only, so both are stated separately by the provider. The
 * server's `services/bookingScope.js` holds the same two vocabularies and the
 * rule that enforces them; this file is the labels, the option lists and the
 * rendering, and nothing here is trusted as enforcement — the API re-checks
 * every one of these against the row being touched.
 *
 * ## Why the labels live here and not inline
 *
 * The same four words appear on the service form, the service card, the details
 * modal, the provider's public page, the booking page and two filter rails. Six
 * copies of "In-Person" is six chances for one screen to say "In person" and
 * read as a different thing, which is exactly what happened to the category
 * spellings before `normaliseCategory` existed.
 */

/** Canonical delivery types. Mirrors the server's CHECK constraint. */
export const DELIVERY_TYPES = ["in_person", "virtual"];

/** Canonical booking scopes. Mirrors the server's CHECK constraint. */
export const BOOKING_SCOPES = ["domestic", "international"];

/** What the API stores when a provider states nothing. Mirrors the column defaults. */
export const DEFAULT_DELIVERY_TYPE = "in_person";
export const DEFAULT_BOOKING_SCOPE = "international";

/**
 * Delivery types as the form and the filter rail offer them.
 *
 * `hint` is the one-line explanation shown under a radio on the service form.
 * `icon` names a Material Symbol, the set the rest of the UI draws from.
 */
export const DELIVERY_OPTIONS = [
  {
    value: "in_person",
    label: "In-Person",
    icon: "place",
    hint: "The client comes to your address.",
  },
  {
    value: "virtual",
    label: "Virtual",
    icon: "videocam",
    hint: "Online — no address needed.",
  },
];

/**
 * Booking scopes as the form offers them.
 *
 * The labels are the provider's words for their own rule. The *client* sees
 * different wording for the same values — see `SCOPE_FILTER_OPTIONS` — because
 * "Domestic" describes the restriction from the provider's side and answers a
 * different question from the client's side, which is "can I book this?".
 */
export const SCOPE_OPTIONS = [
  {
    value: "domestic",
    label: "Domestic",
    icon: "home_pin",
    hint: "Only clients in your own country can book.",
  },
  {
    value: "international",
    label: "International",
    icon: "public",
    hint: "Anyone, anywhere, can book.",
  },
];

/** The delivery filter on the client's directory. Same values, client's wording. */
export const DELIVERY_FILTER_OPTIONS = [
  { value: "in_person", label: "In-person" },
  { value: "virtual", label: "Virtual (online)" },
];

/**
 * The scope filter on the client's directory.
 *
 * Worded as what it means for the reader rather than as the stored value's name.
 * "Domestic" on a client's screen is ambiguous — domestic to whom? — whereas
 * "Open to any country" and "Same country only" say what the provider has
 * decided without the reader having to work out whose country is meant.
 */
export const SCOPE_FILTER_OPTIONS = [
  { value: "international", label: "Open to any country" },
  { value: "domestic", label: "Same country only" },
];

/**
 * The label for a delivery type, falling back to the column default.
 *
 * Falls back rather than returning "Unknown": both columns are NOT NULL on the
 * server, so an absent value means an older client or a payload that did not
 * select the field — not a service whose delivery is genuinely undecided.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function deliveryLabel(value) {
  const match = DELIVERY_OPTIONS.find((option) => option.value === value);
  return (match ?? DELIVERY_OPTIONS[0]).label;
}

/** The icon name for a delivery type. @see deliveryLabel */
export function deliveryIcon(value) {
  const match = DELIVERY_OPTIONS.find((option) => option.value === value);
  return (match ?? DELIVERY_OPTIONS[0]).icon;
}

/** The label for a booking scope, falling back to the column default. */
export function scopeLabel(value) {
  const match = SCOPE_OPTIONS.find((option) => option.value === value);
  return (match ?? SCOPE_OPTIONS[1]).label;
}

/** The icon name for a booking scope. @see scopeLabel */
export function scopeIcon(value) {
  const match = SCOPE_OPTIONS.find((option) => option.value === value);
  return (match ?? SCOPE_OPTIONS[1]).icon;
}

/** True when a service is delivered at the provider's address. */
export function isInPerson(service) {
  return (service?.deliveryType ?? DEFAULT_DELIVERY_TYPE) === "in_person";
}

/** True when a service is restricted to the provider's own country. */
export function isDomestic(service) {
  return (service?.bookingScope ?? DEFAULT_BOOKING_SCOPE) === "domestic";
}

/**
 * Whether a signed-in client may book this service, judged the way the server
 * judges it.
 *
 * A local copy of `evaluateBookingScope`, and it exists to *explain* rather than
 * to decide: the API re-checks every booking and every reschedule against the
 * row being touched, so this only chooses which sentence a card shows. It
 * mirrors the server's permissiveness exactly, including the part that looks
 * like a bug — **an unknown country on either side is eligible** — because a UI
 * that refused where the server allows would hide a service the client could
 * actually have booked.
 *
 * @param {object} args
 * @param {{bookingScope?: string}} args.service
 * @param {string|null|undefined} args.clientCountry ISO 3166-1 alpha-2.
 * @param {string|null|undefined} args.providerCountry ISO 3166-1 alpha-2.
 * @returns {{eligible: boolean, reason: string|null}} `reason` is null when
 *   eligible, so a caller can render it unconditionally.
 */
export function judgeEligibility({ service, clientCountry, providerCountry }) {
  if (!isDomestic(service)) return { eligible: true, reason: null };

  const client = normaliseCountryCode(clientCountry);
  const provider = normaliseCountryCode(providerCountry);

  // Unknown on either side: the server allows it, so this must too.
  if (!client || !provider || client === provider) return { eligible: true, reason: null };

  return {
    eligible: false,
    reason: `Only available to clients in ${countryLabel(provider)}. Your account is set to ${countryLabel(client)}.`,
  };
}

/**
 * A country code rendered for a reader.
 *
 * `Intl.DisplayNames` rather than a bundled name table, for the reason
 * `lib/currencies.js` gives about symbols: the name is a rendering concern, it
 * is localised, and the runtime already knows it in the reader's own language.
 * Falls back to the bare code, which is still readable — "GB" is worse than
 * "United Kingdom" and much better than nothing.
 *
 * @param {string|null|undefined} code ISO 3166-1 alpha-2.
 * @returns {string} The country's name, the bare code, or "" for no code.
 */
export function countryLabel(code) {
  const normalised = normaliseCountryCode(code);
  if (!normalised) return "";

  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(normalised) ?? normalised;
  } catch {
    return normalised;
  }
}

/**
 * Trims and upper-cases a stored country code.
 *
 * `CHAR(2)` is blank-padded by PostgreSQL and the server trims on the way out,
 * but a value can also reach the client through an older payload or a form
 * input, so this is applied wherever two codes are compared rather than assumed
 * upstream.
 *
 * @param {unknown} code
 * @returns {string|null}
 */
export function normaliseCountryCode(code) {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

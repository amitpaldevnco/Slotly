/**
 * Where a service may be delivered, and who may book it.
 *
 * Two independent properties of a service, deliberately kept apart:
 *
 *   - **`delivery_type`** — `in_person` or `virtual`. Says *where* the
 *     appointment happens, and therefore whether the provider's street address
 *     is part of the arrangement at all.
 *   - **`booking_scope`** — `domestic` or `international`. Says *who* may book
 *     it: anyone, or only clients in the provider's own country.
 *
 * They are not the same question and the app does not couple them. A London
 * clinic can perfectly well see international visitors in person, and an online
 * tutor can perfectly well take only domestic students because they are
 * registered to teach in one country. Deriving one from the other would make
 * both of those unrepresentable, so a provider states each separately.
 *
 * ## Pure, and no ambient clock or database
 *
 * Same contract as `bookingRules.js`: every input is passed in, nothing is read
 * from a connection, nothing is read from the environment. That is what lets the
 * slot list, the create path and the reschedule path all ask the same question
 * and be guaranteed the same answer — the property `slotEngine`'s "both paths,
 * same gates" note is about — and it is why this is a service rather than three
 * copies of an `if` in `bookingController`.
 */

/** The delivery types a service may declare. Mirrors the CHECK constraint. */
export const DELIVERY_TYPES = ["in_person", "virtual"];

/** The booking scopes a service may declare. Mirrors the CHECK constraint. */
export const BOOKING_SCOPES = ["domestic", "international"];

/** Human labels, for server-composed prose only. The client renders its own. */
const SCOPE_LABELS = { domestic: "Domestic", international: "International" };
const DELIVERY_LABELS = { in_person: "In-Person", virtual: "Virtual" };

/**
 * True when `value` is a delivery type the schema accepts.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDeliveryType(value) {
  return typeof value === "string" && DELIVERY_TYPES.includes(value);
}

/**
 * True when `value` is a booking scope the schema accepts.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBookingScope(value) {
  return typeof value === "string" && BOOKING_SCOPES.includes(value);
}

/**
 * Normalises a delivery type arriving from a request body.
 *
 * Service writes are `multipart/form-data`, so every value arrives as a string
 * and none of it is trusted. Accepts the hyphenated and spaced spellings a form
 * might send ("in-person", "In Person") because the UI's own labels use them and
 * refusing them would be a validation error about punctuation.
 *
 * @param {unknown} value
 * @returns {string|null} A canonical delivery type, or null.
 */
export function normaliseDeliveryType(value) {
  if (typeof value !== "string") return null;
  const canonical = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return isDeliveryType(canonical) ? canonical : null;
}

/**
 * Normalises a booking scope arriving from a request body.
 *
 * @param {unknown} value
 * @returns {string|null} A canonical booking scope, or null.
 */
export function normaliseBookingScope(value) {
  if (typeof value !== "string") return null;
  const canonical = value.trim().toLowerCase();
  return isBookingScope(canonical) ? canonical : null;
}

/**
 * Whether a client in `clientCountry` may book this service.
 *
 * ## Why an unknown country is allowed through
 *
 * `country` is nullable on `users`, and it has to be: it was added after the
 * first release, and a country genuinely can be unstated in a way a currency
 * cannot. `config/schema.js` backfills it from each account's timezone, which
 * reaches almost everyone, but "almost" is the operative word — a UTC timezone
 * belongs to no country, and so does an account created through a path that
 * never asked.
 *
 * So when either side's country is unknown this returns `allowed: true`, and
 * that is a decision rather than an oversight. The alternative is refusing a
 * booking on the strength of a fact the app does not have, which means an
 * existing client who could book yesterday cannot book today because a column
 * was added — a restriction nobody chose, applied to people who cannot see why.
 * Failing open keeps every pre-existing flow working exactly as it did, and the
 * rule bites the moment both countries are actually known.
 *
 * The `reason` is filled in even when allowed is true and there is nothing to
 * refuse, so a caller rendering an explanation does not have to special-case it.
 *
 * @param {object} args
 * @param {{booking_scope?: string, delivery_type?: string}} args.service The
 *   service row, or anything carrying those two columns.
 * @param {string|null|undefined} args.clientCountry ISO 3166-1 alpha-2.
 * @param {string|null|undefined} args.providerCountry ISO 3166-1 alpha-2.
 * @returns {{allowed: boolean, code: string|null, reason: string|null,
 *            scope: string, clientCountry: string|null, providerCountry: string|null}}
 *   `code` is `OUTSIDE_SERVICE_AREA` when refused, null otherwise.
 */
export function evaluateBookingScope({ service, clientCountry, providerCountry }) {
  // Anything other than an explicit 'domestic' is treated as unrestricted,
  // including a row that somehow carries no scope at all. The column is NOT NULL
  // with an 'international' default, so that case should not arise — but the
  // safe reading of a missing restriction is that there is no restriction, not
  // that everyone is refused.
  const scope = normaliseBookingScope(service?.booking_scope) ?? "international";

  const client = normaliseStored(clientCountry);
  const provider = normaliseStored(providerCountry);

  const base = { scope, clientCountry: client, providerCountry: provider };

  if (scope !== "domestic") {
    return { allowed: true, code: null, reason: null, ...base };
  }

  if (!client || !provider) {
    return { allowed: true, code: null, reason: null, ...base };
  }

  if (client === provider) {
    return { allowed: true, code: null, reason: null, ...base };
  }

  return {
    allowed: false,
    code: "OUTSIDE_SERVICE_AREA",
    // Names the country rather than only saying "not your country", because a
    // client who has the wrong country on their profile — the likeliest cause,
    // since it is inferred from a timezone — can only work that out if they are
    // told which one the service wants.
    reason: `This service is only offered to clients in ${provider}. Your account is set to ${client}.`,
    ...base,
  };
}

/**
 * Whether a provider has the location an in-person service needs.
 *
 * Kept here rather than inline in `serviceController` so the write path and the
 * provider-facing health report cannot disagree about what "ready to publish an
 * in-person service" means — the same reason `isCompactEvent` lives beside the
 * layout that inflates the blocks it describes.
 *
 * A country alone is not enough: a client travelling to an appointment needs the
 * street address, and "GB" is not somewhere you can go. Conversely a `domestic`
 * scope needs only the country, because the only thing it does with it is
 * compare it. So the two requirements are reported separately.
 *
 * @param {object} args
 * @param {string} args.deliveryType
 * @param {string} args.bookingScope
 * @param {{country?: string|null, business_address?: string|null}} args.provider
 * @returns {{ok: boolean, missing: Array<"address"|"country">}}
 */
export function checkProviderLocation({ deliveryType, bookingScope, provider }) {
  const missing = [];

  if (normaliseDeliveryType(deliveryType) === "in_person") {
    if (!String(provider?.business_address ?? "").trim()) missing.push("address");
  }

  if (normaliseBookingScope(bookingScope) === "domestic") {
    if (!normaliseStored(provider?.country)) missing.push("country");
  }

  return { ok: missing.length === 0, missing };
}

/**
 * The label pair a server-composed message uses.
 *
 * @param {{delivery_type?: string, booking_scope?: string}} service
 * @returns {{delivery: string, scope: string}}
 */
export function describeServiceScope(service) {
  const delivery = normaliseDeliveryType(service?.delivery_type) ?? "in_person";
  const scope = normaliseBookingScope(service?.booking_scope) ?? "international";
  return { delivery: DELIVERY_LABELS[delivery], scope: SCOPE_LABELS[scope] };
}

/**
 * Reads a country as stored: `CHAR(2)` is blank-padded on the way out of
 * PostgreSQL, so a naive comparison of `"GB"` against `"GB"` from the column can
 * fail on a trailing space. Trimmed and upper-cased once, here, rather than at
 * every call site that might forget.
 */
function normaliseStored(code) {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

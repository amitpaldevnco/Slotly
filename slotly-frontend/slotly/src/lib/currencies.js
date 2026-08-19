/**
 * The currency a provider prices in: the picker's options, and a sensible guess.
 *
 * ## Why a curated list and not every ISO 4217 code
 *
 * There are about 180 active codes, most of which no provider on this platform
 * will ever pick, and a 180-row dropdown is a worse experience than a 25-row one
 * for everybody. The list below covers the currencies of the places people
 * actually sign up from, and the server accepts any valid code regardless — so a
 * provider in a country not listed here is not locked out, they simply do not get
 * a one-click option. If that becomes a real complaint, the fix is to add a row,
 * not to restructure anything.
 *
 * Labels carry the code *and* the name because "$" alone is ambiguous across at
 * least five of these, and a provider picking the wrong one misprices everything
 * they offer.
 */
import ct from "countries-and-timezones";
import { normalizeTimezone } from "./timezones";

/**
 * Currencies offered in the picker, in the order shown.
 *
 * Not alphabetical: the handful that cover most signups sit at the top, and the
 * rest follow alphabetically. A strict A–Z would bury USD under AED and CAD.
 */
export const CURRENCIES = [
  { code: "INR", name: "Indian Rupee" },
  { code: "USD", name: "US Dollar" },
  { code: "GBP", name: "Pound Sterling" },
  { code: "EUR", name: "Euro" },
  { code: "AED", name: "UAE Dirham" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "DKK", name: "Danish Krone" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "IDR", name: "Indonesian Rupiah" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "KES", name: "Kenyan Shilling" },
  { code: "LKR", name: "Sri Lankan Rupee" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "MYR", name: "Malaysian Ringgit" },
  { code: "NGN", name: "Nigerian Naira" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "PHP", name: "Philippine Peso" },
  { code: "PKR", name: "Pakistani Rupee" },
  { code: "PLN", name: "Polish Zloty" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "THB", name: "Thai Baht" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "ZAR", name: "South African Rand" },
];

/** What the picker falls back to, and what the database column defaults to. */
export const DEFAULT_CURRENCY = "INR";

/**
 * ISO 3166 country → ISO 4217 currency, for the countries the list above covers.
 *
 * Only used to pre-select a likely option; a wrong guess costs the provider one
 * dropdown change, and every guess is visible and editable before they save.
 * Eurozone members all map to EUR, which is why there are so many of them.
 */
const CURRENCY_BY_COUNTRY = {
  IN: "INR",
  US: "USD",
  GB: "GBP",
  AE: "AED",
  AU: "AUD",
  BR: "BRL",
  CA: "CAD",
  CH: "CHF",
  CN: "CNY",
  DK: "DKK",
  HK: "HKD",
  ID: "IDR",
  JP: "JPY",
  KE: "KES",
  LK: "LKR",
  MX: "MXN",
  MY: "MYR",
  NG: "NGN",
  NO: "NOK",
  NZ: "NZD",
  PH: "PHP",
  PK: "PKR",
  PL: "PLN",
  SA: "SAR",
  SE: "SEK",
  SG: "SGD",
  TH: "THB",
  TR: "TRY",
  ZA: "ZAR",
  // Eurozone
  AT: "EUR", BE: "EUR", CY: "EUR", DE: "EUR", EE: "EUR", ES: "EUR", FI: "EUR",
  FR: "EUR", GR: "EUR", HR: "EUR", IE: "EUR", IT: "EUR", LT: "EUR", LU: "EUR",
  LV: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SI: "EUR", SK: "EUR",
};

/**
 * Guesses the currency for a timezone, so the picker opens on a likely answer
 * rather than on whatever happens to be first.
 *
 * A guess, explicitly: `Europe/London` is a good signal for GBP, and a provider
 * in London billing in euros just changes it. The value is never applied without
 * being shown.
 *
 * @param {string} timezone IANA zone name.
 * @returns {string} An ISO 4217 code; DEFAULT_CURRENCY when nothing maps.
 */
export function currencyForTimezone(timezone) {
  if (!timezone) return DEFAULT_CURRENCY;

  try {
    const zone = ct.getTimezone(normalizeTimezone(timezone));
    const country = zone?.countries?.[0];
    return (country && CURRENCY_BY_COUNTRY[country]) || DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

/**
 * "GBP — Pound Sterling", with the runtime's symbol when it knows one.
 *
 * @param {{code: string, name: string}} currency
 * @returns {string}
 */
export function currencyLabel({ code, name }) {
  try {
    const symbol = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value;

    return symbol && symbol !== code ? `${code} — ${name} (${symbol})` : `${code} — ${name}`;
  } catch {
    return `${code} — ${name}`;
  }
}

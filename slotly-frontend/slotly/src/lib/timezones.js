//The timezone picker's data and styling, in one place.
 
import ct from "countries-and-timezones";


export function normalizeTimezone(timezone) {
  const aliases = {
    "Asia/Calcutta": "Asia/Kolkata",
  };
  return aliases[timezone] || timezone;
}

export function buildTimezonesWithCountry() {
  const zones = ct.getAllTimezones();

  const entries = Object.entries(zones)
    .filter(([, info]) => info.countries.length > 0)
    .map(([tzName, info]) => {
      const normalized = normalizeTimezone(tzName);
      const country = ct.getCountry(info.countries[0]);
      const city = normalized.split("/").pop().replace(/_/g, " ");
      const label = country ? `${city} — ${country.name}` : city;

      // react-timezone-select keys its own list on the historical spelling, so the
      // key has to match what it will hand back on change; the value is
      // normalised again on save.
      const key = normalized === "Asia/Kolkata" ? "Asia/Calcutta" : normalized;

      return [key, label];
    });

  return {
    UTC: "UTC",
    ...Object.fromEntries(entries),
  };
}

/**
 * The option list the timezone pickers actually render, and why they do not use
 * the one `react-timezone-select` builds for them.
 *
 * That library collapses its list to **one option per UTC offset**. The intent
 * is a short menu — you find your city by typing it, and the option you land on
 * is whichever zone represents that offset. It exempts any zone it does not
 * recognise from its own bundled list, on the assumption that a caller passing
 * something unusual means it.
 *
 * Handing it the complete IANA set inverts that. Every well-known zone *is* in
 * its bundled list, so every well-known zone competes for the single slot its
 * offset gets — and loses it to whichever obscure zone shares the offset and is
 * therefore "custom". 49 zones disappeared, and they were the ones people
 * actually live in: Europe/London, Asia/Kolkata, Asia/Tokyo, Australia/Sydney,
 * America/Mexico_City, Europe/Dublin. Both demo providers' own zones were
 * unselectable. Searching "London" returned Casablanca, Faroe and Madeira.
 *
 * It was invisible from the outside because `parseTimezone` resolves the
 * *current* value against the full pre-dedupe list. An account already on
 * Europe/London displayed "London — United Kingdom" perfectly; it just could
 * never be chosen, so anyone who moved off it could not move back.
 *
 * Picking a same-offset stand-in is not a harmless substitution either. The
 * stored zone is what `countryFromTimezone` reads and what every conversion
 * runs through, so a London user recorded as Africa/Casablanca gets the wrong
 * country, and their appointments drift by an hour the first time the two
 * places change their clocks on different dates.
 *
 * `TimezoneSelect` spreads caller props over its own, so passing `options` and
 * `filterOption` replaces the collapsed list with this one. Everything else —
 * value resolution, styling, change handling — is left to the library.
 */

/**
 * A zone's current UTC offset in minutes, or null if this runtime does not know
 * the zone.
 *
 * `countries-and-timezones` ships its own table, so it can name a zone that the
 * browser's ICU build has not got — a recently split one, on an older engine.
 * `Intl.DateTimeFormat` throws a RangeError for those, and one throw here would
 * take out the whole list and leave an empty picker. Skipping the single zone
 * is the containable failure.
 */
function offsetMinutes(timeZone, at) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(at);
  } catch {
    return null;
  }

  // "GMT+01:00", "GMT-04:00", or a bare "GMT" at exactly zero.
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The "+1:00" / "-4:00" / "+5:30" part of a label.
 *
 * Reproduces `react-timezone-select`'s own arithmetic exactly, down to the
 * unpadded hour, because the *selected* value is still labelled by the library
 * and the two spellings sit next to each other on screen.
 */
function offsetLabel(minutes) {
  const hours = (minutes / 60) | 0;
  const rest = minutes % 60 === 0 ? "00" : String(Math.abs(minutes % 60));
  const hr = `${hours}:${rest}`;
  return hr.includes("-") ? hr : `+${hr}`;
}

export function buildTimezoneOptions(at = new Date()) {
  return Object.entries(buildTimezonesWithCountry())
    .map(([value, name]) => {
      const offset = offsetMinutes(value, at);
      if (offset === null) return null;
      return {
        value,
        offset,
        label: `(GMT${offsetLabel(offset)}) ${name}`,
        // So "Europe/London" finds London as readily as "London" does. The
        // library filters on `label` and `searchTerms`, nothing else.
        searchTerms: value.replace(/[_/]/g, " "),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label));
}

/** Matches the library's own filter: label first, then the search terms. */
export function timezoneFilterOption(option, inputValue) {
  const term = inputValue.trim().toLowerCase();
  if (!term) return true;
  const data = option.data ?? {};
  return (
    (data.label ?? option.label ?? "").toLowerCase().includes(term) ||
    (data.searchTerms ?? "").toLowerCase().includes(term)
  );
}

// react-select class overrides so the picker matches every other form control.

export const timezoneSelectClassNames = {
  control: () =>
    "!min-h-11 sm:!min-h-10 !rounded-md !border !border-line !bg-surface !px-3 !py-1 !text-base sm:!text-sm !text-ink !shadow-none focus-within:!border-brand focus-within:!ring-2 focus-within:!ring-brand/10",
  valueContainer: () => "!p-0 !gap-1",
  singleValue: () => "!text-ink !m-0",
  input: () => "!text-ink !m-0 !p-0",
  placeholder: () => "!text-ink-3",
  indicatorSeparator: () => "!hidden",
  dropdownIndicator: () => "!text-ink-3 !p-0",
  clearIndicator: () => "!text-ink-3 !p-0",
  menu: () =>
    "!mt-1 !rounded-md !border !border-line !bg-surface !shadow-float !overflow-hidden !z-50",
  menuList: () => "!p-1 !max-h-60",
  option: ({ isFocused, isSelected }) =>
    `!rounded-sm !px-3 !py-2 !text-sm !cursor-pointer ${
      isSelected
        ? "!bg-brand !text-white"
        : isFocused
          ? "!bg-subtle !text-ink"
          : "!bg-surface !text-ink"
    }`,
  noOptionsMessage: () => "!text-ink-3 !text-sm !px-2.5 !py-1.5",
};

/**
 * Props that get the open list out of its card.
 *
 * react-select renders the menu as a sibling of the control, and `Section` —
 * the panel every profile form sits in — sets `overflow-hidden` to keep its
 * tinted header inside the rounded corners. The two together meant the list was
 * cut off at the card's bottom edge: with the Timezone field near the end of
 * the panel, barely two options were visible.
 *
 * Portalling to `<body>` removes the menu from that clipping context
 * altogether; react-select keeps it aligned to the control and scrolling with
 * the page. Spread these alongside `timezoneSelectClassNames`.
 */
export const timezoneSelectMenuProps = {
  menuPortalTarget: typeof document === "undefined" ? null : document.body,

  /*
   * The portal wrapper gets `z-index: 1` written inline by react-select, which
   * puts it under the sticky navbar. An inline value can only be answered by
   * another inline value, so this one goes through `styles`, not `classNames`.
   */
  styles: {
    menuPortal: (base) => ({ ...base, zIndex: 50 }),
  },
};

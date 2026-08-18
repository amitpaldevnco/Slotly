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

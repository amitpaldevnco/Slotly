//Read-only summary of a provider's published hours, shown on their public page.

import { DateTime } from "luxon";
import Icon from "../ui/Icon";
import { Section } from "../ui/Page";
import { formatClockTime } from "../../lib/time";
import { zoneName } from "../../lib/ui";

/** Monday first, matching the calendar and how a working week reads. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_SHORT = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

/** "9:00 AM–5:00 PM, 6:00 PM–8:00 PM", or null for a closed day. */
function describeDay(windows) {
  if (!windows || windows.length === 0) return null;
  return windows
    .map((w) => `${formatClockTime(w.startTime)}–${formatClockTime(w.endTime)}`)
    .join(", ");
}

function groupWeek(byWeekday) {
  const rows = [];

  for (const weekday of WEEKDAY_ORDER) {
    const hours = describeDay(byWeekday[weekday]);
    const previous = rows[rows.length - 1];

    // Extend the current run when the hours match, otherwise start a new one.
    // Comparing the *formatted* string rather than the windows means two days
    // expressed differently but reading identically still group.
    if (previous && previous.hours === hours) {
      previous.end = weekday;
    } else {
      rows.push({ start: weekday, end: weekday, hours });
    }
  }

  return rows.map((row) => ({
    days:
      row.start === row.end
        ? WEEKDAY_SHORT[row.start]
        : `${WEEKDAY_SHORT[row.start]}–${WEEKDAY_SHORT[row.end]}`,
    hours: row.hours,
  }));
}

export default function WeeklyHoursSummary({ availability }) {
  const { rules = [], exceptions = [], timezone } = availability;

  if (rules.length === 0) return null;

  /**
   * Renders one closure's date range for a visitor.
   *
   * The year is included whenever the closure does not fall in the current one.
   * Without that test, a block stored for 2099 rendered as "1 Feb – 3 Feb" and
   * read exactly like one next week — the reader had no way to tell a genuine
   * upcoming closure from a typo in the far future.
   *
   * @param {{startDate: string, endDate: string}} closure ISO calendar dates.
   * @returns {string}
   */
  function formatClosure(closure) {
    const start = DateTime.fromISO(closure.startDate);
    const end = DateTime.fromISO(closure.endDate);
    const thisYear = DateTime.now().year;
    const spansOtherYear = start.year !== thisYear || end.year !== thisYear;

    if (closure.startDate === closure.endDate) {
      return start.toFormat(spansOtherYear ? "ccc d LLLL yyyy" : "ccc d LLLL");
    }

    // With both ends in one other year, the year is stated once at the end
    // ("1 Feb – 3 Feb 2099") rather than repeated on both sides. A range that
    // straddles a year boundary needs it on each.
    if (start.year !== end.year) {
      return `${start.toFormat("d LLL yyyy")} – ${end.toFormat("d LLL yyyy")}`;
    }
    return `${start.toFormat("d LLL")} – ${end.toFormat(spansOtherYear ? "d LLL yyyy" : "d LLL")}`;
  }

  const byWeekday = {};
  for (const rule of rules) {
    if (!byWeekday[rule.weekday]) byWeekday[rule.weekday] = [];
    byWeekday[rule.weekday].push(rule);
  }

  // Sorted so a day with a morning and an afternoon window reads in order.
  for (const key of Object.keys(byWeekday)) {
    byWeekday[key].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  const rows = groupWeek(byWeekday);

  // Only future full-day blocks are worth showing a visitor — a partial block is
  // an internal detail that already shows up as missing slots.
  const upcomingClosures = exceptions
    .filter((exception) => exception.kind === "block" && exception.isAllDay)
    .slice(0, 3);

  return (
    <Section
      headingId="hours-heading"
      title="Usual hours"
      description={`In the provider's timezone${timezone ? ` (${zoneName(timezone)})` : ""}`}
      flush
    >
      <dl className="divide-y divide-line-soft">
        {rows.map((row) => (
          <div key={row.days} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
            <dt className="w-20 shrink-0 text-[0.8125rem] font-medium text-ink">{row.days}</dt>
            <dd className="text-right text-[0.8125rem] tabular-nums text-ink-2">
              {row.hours || <span className="text-ink-3">Closed</span>}
            </dd>
          </div>
        ))}
      </dl>

      {upcomingClosures.length > 0 && (
        <div className="border-t border-line px-5 py-3.5">
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3">
            <Icon name="ban" size={12} />
            Closed on
          </p>
          <ul className="mt-1 space-y-0.5">
            {upcomingClosures.map((closure) => (
              <li key={closure.id} className="text-xs text-ink-2">
                {formatClosure(closure)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-line-soft px-3 py-2 text-xs text-ink-3">
        Bookable times are converted to your own timezone when you choose a slot.
      </p>
    </Section>
  );
}

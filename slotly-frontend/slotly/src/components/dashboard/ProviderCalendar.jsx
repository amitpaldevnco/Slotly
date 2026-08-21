/**
 * The provider's day, week and month grid, built on react-big-calendar.
 *
 * Only the grid: the range label, the arrows, Today and the Day/Week/Month
 * switch sit above the card in the reference and are owned by `CalendarPage`,
 * which already holds the date and view state they change.
 *
 * ## The Filters row is a filter as well as a key
 *
 * A week with three cancellations and a no-show in it is mostly noise for a
 * provider trying to read what they are actually doing on Thursday, and the
 * colours alone do not help — a cancelled block still takes up the same slot on
 * the grid as a live one.
 *
 * So the legend's swatches are controls, and the row sits *above* the grid where
 * a toolbar belongs. **Clicking one shows only that status** — click Completed
 * and the grid holds the completed appointments and nothing else. `All` brings
 * everything back, and so does clicking the status that is already the only one
 * showing. The row keeps doing its original job at the same time: the swatch and
 * the word are still there, so it remains the key that explains what the fills
 * mean.
 *
 * These first shipped as hide-toggles, where a click *removed* a status, and it
 * was the wrong model: asking to see the completed appointments is the reason
 * somebody presses Completed, and getting every status except that one is the
 * opposite of the request. Combining statuses is still available on
 * ctrl/cmd-click, which is the rarer intent and so is the one that takes the
 * modifier. See `select()`.
 *
 * Two decisions worth naming:
 *
 *   - **Everything is on by default**, so the grid opens showing the whole
 *     picture. A calendar that hides appointments before being asked to is a
 *     calendar a provider cannot trust.
 *   - **What is on screen is named out loud** beneath the row, with the count of
 *     what is not. A filter with no visible consequence is how somebody
 *     concludes their Thursday is free.
 *
 * The filter is local state rather than a prop: it is a way of looking at the
 * range, not part of what the range *is*, and lifting it would put a view
 * preference into the query that fetches the bookings.
 */

import { useCallback, useMemo, useState } from "react";
import { Calendar, luxonLocalizer, Views } from "react-big-calendar";
import { DateTime, Settings } from "luxon";
import Icon from "../ui/Icon";
import { TIME_FORMAT, toDisplayDate } from "../../lib/time";
import { zoneName, STATUS_STYLES } from "../../lib/ui";
import "react-big-calendar/lib/css/react-big-calendar.css";

// Weeks start on Monday, which is how a working week reads for every provider
// this app is for.
Settings.defaultWeekSettings = { firstDay: 1, minimalDays: 4, weekend: [6, 7] };

const localizer = luxonLocalizer(DateTime, { firstDayOfWeek: 1 });

/** The hour the grid opens on when there is neither a today nor a booking to aim at. */
const FALLBACK_SCROLL_HOUR = 8;

/** Every status the filter row offers, in the order the legend already printed them. */
const ALL_STATUSES = Object.keys(STATUS_STYLES);

/**
 * A time-of-day for the grid's `min`/`max`/`scrollToTime`, which read only the
 * clock from the Date they are given. 24:00 is not a time, so the end of the day
 * has to be expressed as the last second of it.
 */
function atHour(hour) {
  if (hour >= 24) return new Date(1970, 0, 1, 23, 59, 59);
  return new Date(1970, 0, 1, hour, 0, 0);
}

/**
 * Midnight to midnight, every day, whatever is booked.
 *
 * The grid used to be cropped to a working day and widened by any appointment
 * that fell outside it, which kept the box short but meant the red "now" line
 * simply was not drawn whenever the provider's own clock sat outside the crop —
 * before 8am, or after the last appointment's hour. react-big-calendar renders
 * that line only while `min <= now <= max`. A full day is the only window that
 * is always true for, and it is also the only one in which an early-morning or
 * late-night hour can be read at all rather than merely being cropped in when
 * something happens to be booked in it.
 */
const DAY_MIN = atHour(0);
const DAY_MAX = atHour(24);

const CALENDAR_FORMATS = {
  timeGutterFormat: TIME_FORMAT,
  dayFormat: "ccc d",
  weekdayFormat: "ccc",
  dayHeaderFormat: "cccc d LLLL yyyy",
  eventTimeRangeFormat: ({ start, end }, culture, local) =>
    `${local.format(start, TIME_FORMAT, culture)} – ${local.format(end, TIME_FORMAT, culture)}`,
  eventTimeRangeStartFormat: ({ start }, culture, local) =>
    `${local.format(start, TIME_FORMAT, culture)} – `,
  eventTimeRangeEndFormat: ({ end }, culture, local) =>
    ` – ${local.format(end, TIME_FORMAT, culture)}`,
  selectRangeFormat: ({ start, end }, culture, local) =>
    `${local.format(start, TIME_FORMAT, culture)} – ${local.format(end, TIME_FORMAT, culture)}`,
};

/**
 * An appointment block, filled in its own status colour.
 *
 * Every block used to share one grey body and differ only in a 4px left edge.
 * That reads fine in a list, where the status badge is right there in words, and
 * badly on a week grid: an appointment is a small rectangle among thirty others,
 * and a 4px stripe is not what the eye picks up when someone glances at last
 * week to see how it went. The fill carries the status instead — **completed in
 * green**, the one status that means "this happened as planned".
 *
 * The stripe is kept as well as the fill, at full saturation. Two encodings of
 * the same fact cost nothing, and the darker edge is what separates two adjacent
 * blocks of the same status.
 *
 * Colour is still never the only signal: the block prints its title, and the
 * detail panel and every list print the status in words. The `-ink` tokens are
 * darkened against their fills so the label clears contrast rather than becoming
 * decoration on a tint.
 *
 * Cancelled is the exception to "fill it in": it keeps a reduced opacity and a
 * strike-through, because a cancelled appointment is not an event on the
 * calendar so much as the ghost of one, and it should recede rather than compete
 * with the appointments that are actually happening.
 */
function eventStyleGetter(event) {
  const status = event.resource.booking.status;
  const known = STATUS_STYLES[status] ? status : "booked";

  return {
    style: {
      backgroundColor: `var(--color-status-${known}-soft)`,
      color: `var(--color-status-${known}-ink)`,
      border: `1px solid var(--color-status-${known}-line)`,
      borderLeft: `4px solid var(--color-status-${known})`,
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: 500,
      lineHeight: 1.35,
      padding: "3px 6px",
      opacity: status === "cancelled" ? 0.6 : 1,
      textDecoration: status === "cancelled" ? "line-through" : "none",
    },
  };
}

/**
 * A day column heading: the weekday in caption caps over the date in `h3`, with
 * today's number reversed out in a filled circle. Transcribed from the
 * reference, which the library's own single-line heading does not resemble.
 */
function DayHeader({ date, timezone }) {
  const day = DateTime.fromJSDate(date);
  const today = DateTime.now().setZone(timezone);
  const isToday = day.hasSame(
    DateTime.fromObject({ year: today.year, month: today.month, day: today.day }),
    "day"
  );

  return (
    <div className={`py-2.5 text-center ${isToday ? "bg-primary/5" : ""}`}>
      <div
        className={`font-caption text-caption uppercase ${
          isToday ? "font-bold text-primary" : "text-on-surface-variant"
        }`}
      >
        {day.toFormat("ccc")}
      </div>
      {/* 32px disc rather than the reference's 40px, and a 20px numeral rather
          than the 24px `h3`. The taller pair did not fit the row the library
          gives a header and was being cut through horizontally. */}
      <div
        className={
          isToday
            ? "mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[20px] font-semibold leading-none text-on-primary"
            : "mt-1 text-[20px] font-semibold leading-8 text-on-background"
        }
      >
        {day.toFormat("d")}
      </div>
    </div>
  );
}

export default function ProviderCalendar({
  bookings,
  timezone,
  date,
  view,
  onNavigate,
  onView,
  onSelectBooking,
  loading = false,
  height = 720,
}) {
  // Every status on, so the grid opens on the whole picture. See the note above.
  const [shown, setShown] = useState(() => new Set(ALL_STATUSES));

  /** How many appointments in this range hold each status, for the row's counts. */
  const counts = useMemo(() => {
    const tally = {};
    for (const booking of bookings) {
      tally[booking.status] = (tally[booking.status] || 0) + 1;
    }
    return tally;
  }, [bookings]);

  const visible = useMemo(
    // A status the legend does not know about has no toggle to turn it back on,
    // so it is never hidden — the alternative is an appointment that cannot be
    // recovered from the UI. `eventStyleGetter` already draws these as 'booked'.
    () => bookings.filter((b) => shown.has(b.status) || !STATUS_STYLES[b.status]),
    [bookings, shown]
  );

  const hiddenCount = bookings.length - visible.length;
  const allShown = ALL_STATUSES.every((status) => shown.has(status));

  /** The statuses currently on screen, named, for the line under the row. */
  const shownLabels = ALL_STATUSES.filter((s) => shown.has(s)).map((s) => STATUS_STYLES[s].label);

  /**
   * Picks what the grid shows.
   *
   * A plain click means **show only this** — click Completed and you get the
   * completed appointments, nothing else. That is what a filter is for, and it is
   * the whole interaction most of the time.
   *
   * Two ways back out, so nobody can get stuck looking at one status:
   *
   *   - `All`, which is the obvious one.
   *   - clicking the status that is already the only one showing, which returns
   *     everything. The chip is its own undo.
   *
   * `additive` (ctrl/cmd-click) builds a combination — Booked *and* Rescheduled,
   * say. It is deliberately the modifier rather than the default: making every
   * click additive is what produced the backwards behaviour where clicking
   * Completed *removed* the completed appointments. Deselecting the last one this
   * way returns everything rather than leaving an empty grid, since a calendar
   * showing nothing at all is never what was meant.
   */
  const select = (status, additive) =>
    setShown((current) => {
      if (additive) {
        const next = new Set(current);
        if (next.has(status)) next.delete(status);
        else next.add(status);
        return next.size === 0 ? new Set(ALL_STATUSES) : next;
      }

      const alreadyAlone = current.size === 1 && current.has(status);
      return alreadyAlone ? new Set(ALL_STATUSES) : new Set([status]);
    });

  const events = useMemo(
    () =>
      visible.map((booking) => ({
        title: `${booking.client.name} — ${booking.service.name}`,
        start: toDisplayDate(booking.startsAt, timezone),
        end: toDisplayDate(booking.endsAt, timezone),
        // The untouched booking travels with the event so every interaction
        // works from real data rather than from the shifted display Dates.
        resource: { booking },
      })),
    [visible, timezone]
  );

  const getNow = useCallback(() => toDisplayDate(new Date(), timezone), [timezone]);

  /**
   * Where the twenty-four hours open.
   *
   * A full day is about 1,500px inside a 720px box, so the grid always opens
   * part-way down a scrollbar and the opening position is what decides whether
   * it lands somewhere useful. An hour before now when the range on screen
   * contains today — which puts the red line just below the top edge rather
   * than eight hours down — an hour before the first appointment otherwise, and
   * a working-day 8am when there is neither.
   *
   * Memoised on the range rather than on the clock: react-big-calendar reads
   * this when the grid mounts and when the value changes by a minute, so a
   * `scrollToTime` that ticked would drag the grid back under a provider who
   * had scrolled it.
   * `events` rather than `bookings` because those Dates have already been
   * shifted into the provider's zone, which is the clock the grid is drawn in.
   */
  const scrollToTime = useMemo(() => {
    const anchor = DateTime.fromJSDate(date);
    const now = DateTime.fromJSDate(getNow());

    const showsToday =
      view === Views.DAY
        ? anchor.hasSame(now, "day")
        : // A week can straddle two years, so the year has to be checked separately.
          anchor.hasSame(now, "week") && anchor.hasSame(now, "year");

    if (showsToday) return atHour(Math.max(0, now.hour - 1));

    const earliest = events.reduce((soonest, event) => {
      const hour = DateTime.fromJSDate(event.start).hour;
      return soonest === null ? hour : Math.min(soonest, hour);
    }, null);

    return atHour(Math.max(0, (earliest ?? FALLBACK_SCROLL_HOUR) - 1));
  }, [date, view, events, getNow]);

  // Memoised: react-big-calendar remounts a header whose component identity
  // changes, which on every render is every header, on every scroll.
  const components = useMemo(() => {
    const header = ({ date }) => <DayHeader date={date} timezone={timezone} />;

    // The month view's header is one weekday name over a whole column of dates,
    // not a date of its own, so `DayHeader` — which draws a number and rings
    // today — has nothing to say there.
    const monthHeader = ({ label }) => (
      <div className="py-2.5 text-center font-caption text-caption uppercase text-on-surface-variant">
        {label}
      </div>
    );

    return { week: { header }, day: { header }, month: { header: monthHeader } };
  }, [timezone]);

  return (
    <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-raise">
      {/* Above the grid, not below it. Now that the swatches are controls rather
          than only a key, they belong where a toolbar belongs — a filter a
          provider has to scroll a full day of hours past to reach is a filter
          they will not know is there. This row still prints the words beside the
          colours, so it remains the legend as well. */}
      <div className="border-b border-outline-variant bg-surface-container-lowest px-4 py-3">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter appointments by status"
        >
          <span className="font-caption text-caption font-semibold uppercase tracking-wide text-on-surface-variant">
            Filters
          </span>

          <button
            type="button"
            onClick={() => setShown(new Set(ALL_STATUSES))}
            disabled={allShown}
            className="cursor-pointer rounded-md border border-outline-variant px-2.5 py-1 font-caption text-caption text-on-surface-variant transition-colors hover:bg-surface-variant disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
          >
            All
          </button>

          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-outline-variant" />

          {ALL_STATUSES.map((status) => {
            const { label } = STATUS_STYLES[status];
            const on = shown.has(status);
            const count = counts[status] || 0;

            return (
              <button
                key={status}
                type="button"
                onClick={(event) => select(status, event.ctrlKey || event.metaKey)}
                aria-pressed={on}
                // Named for a screen reader, which cannot see that the swatch
                // has gone hollow: "Cancelled, 2 appointments" plus the pressed
                // state is the whole control in words.
                aria-label={`Show only ${label}, ${count} appointment${count === 1 ? "" : "s"}`}
                // The combination is worth having but is not worth a line of
                // instructions in the toolbar, so it lives here.
                title={`Show only ${label} — ctrl-click to add it to what is already showing`}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 font-caption text-caption transition-colors ${
                  on
                    ? "border-outline-variant bg-surface text-on-surface shadow-raise"
                    : "border-transparent text-on-surface-variant hover:bg-surface-variant"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-sm border transition-colors"
                  style={{
                    // Hollow when off: the swatch itself says whether the status
                    // is being drawn, so the control reads at a glance without
                    // depending on the button's own background.
                    backgroundColor: on ? `var(--color-status-${status}-soft)` : "transparent",
                    borderColor: `var(--color-status-${status})`,
                  }}
                />
                {label}
                {count > 0 && <span className="tabular-nums opacity-60">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Names what is on screen, not only what is missing. A filter with no
            visible consequence is how somebody concludes their Thursday is
            free — and "showing Completed only" is the sentence that makes an
            unexpectedly empty grid legible. */}
        {!allShown && (
          <p aria-live="polite" className="mt-2 font-caption text-caption text-on-surface-variant">
            Showing <span className="font-semibold">{shownLabels.join(", ")}</span> only
            {hiddenCount > 0 &&
              ` · ${hiddenCount} appointment${hiddenCount === 1 ? "" : "s"} hidden`}
          </p>
        )}
      </div>

      <div
        id="provider-calendar-grid"
        aria-busy={loading}
        className={`transition-opacity duration-150 motion-reduce:transition-none ${
          loading ? "opacity-55" : "opacity-100"
        }`}
      >
        <Calendar
          localizer={localizer}
          events={events}
          date={date}
          view={view}
          getNow={getNow}
          formats={CALENDAR_FORMATS}
          onNavigate={onNavigate}
          onView={onView}
          views={[Views.DAY, Views.WEEK, Views.MONTH]}
          components={components}
          step={30}
          timeslots={2}
          min={DAY_MIN}
          max={DAY_MAX}
          scrollToTime={scrollToTime}
          popup
          onSelectEvent={(event) => onSelectBooking(event.resource.booking)}
          eventPropGetter={eventStyleGetter}
          style={{ height }}
          tooltipAccessor={(event) => {
            const { booking } = event.resource;
            return `${booking.service.name} with ${booking.client.name} — ${booking.status}`;
          }}
        />
      </div>

      <p className="flex items-center gap-2 border-t border-outline-variant bg-surface-container-lowest px-4 py-3 font-caption text-caption text-on-surface-variant">
        <Icon name="public" size={14} />
        Times shown in {zoneName(timezone)}, whatever zone this device is set to.
      </p>
    </div>
  );
}

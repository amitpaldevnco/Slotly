/**
 * The provider's day, week and month grid, built on react-big-calendar.
 *
 * Only the grid: the range label, the arrows, Today and the Day/Week/Month
 * switch sit above the card in the reference and are owned by `CalendarPage`,
 * which already holds the date and view state they change.
 */

import { useCallback, useMemo } from "react";
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
  const events = useMemo(
    () =>
      bookings.map((booking) => ({
        title: `${booking.client.name} — ${booking.service.name}`,
        start: toDisplayDate(booking.startsAt, timezone),
        end: toDisplayDate(booking.endsAt, timezone),
        // The untouched booking travels with the event so every interaction
        // works from real data rather than from the shifted display Dates.
        resource: { booking },
      })),
    [bookings, timezone]
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

      {/* Now that the blocks are filled rather than merely edged, the fill is
          doing real work, and a colour nobody has been told the meaning of is
          just decoration. The legend is the key — and it prints the words, so
          anyone who cannot separate the hues still has the full information. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-outline-variant bg-surface-container-lowest px-4 py-3">
        {Object.entries(STATUS_STYLES).map(([status, { label }]) => (
          <span
            key={status}
            className="inline-flex items-center gap-1.5 font-caption text-caption text-on-surface-variant"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-sm border"
              style={{
                backgroundColor: `var(--color-status-${status}-soft)`,
                borderColor: `var(--color-status-${status})`,
              }}
            />
            {label}
          </span>
        ))}
      </div>

      <p className="flex items-center gap-2 border-t border-outline-variant bg-surface-container-lowest px-4 py-3 font-caption text-caption text-on-surface-variant">
        <Icon name="public" size={14} />
        Times shown in {zoneName(timezone)}, whatever zone this device is set to.
      </p>
    </div>
  );
}

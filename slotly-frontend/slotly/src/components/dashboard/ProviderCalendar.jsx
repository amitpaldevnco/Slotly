//The provider's day and week calendar, built on react-big-calendar.

import { useCallback, useMemo } from "react";
import { Calendar, luxonLocalizer, Views } from "react-big-calendar";
import { DateTime, Settings } from "luxon";
import Icon from "../ui/Icon";
import { SegmentedControl } from "../ui/Tabs";
import { TIME_FORMAT, fromDisplayDate, toDisplayDate } from "../../lib/time";
import { iconButton, secondaryButton, buttonSm, zoneName, STATUS_STYLES } from "../../lib/ui";
import "react-big-calendar/lib/css/react-big-calendar.css";

// Weeks start on Monday, which is how a working week reads for every provider
// this app is for.
Settings.defaultWeekSettings = { firstDay: 1, minimalDays: 4, weekend: [6, 7] };

const localizer = luxonLocalizer(DateTime, { firstDayOfWeek: 1 });


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


function eventStyleGetter(event) {
  const status = event.resource.booking.status;

  const known = STATUS_STYLES[status] ? status : "booked";

  return {
    style: {
      backgroundColor: `var(--color-status-${known})`,
      color: "#FFFFFF",
      border: "none",
      borderRadius: "4px",
      fontSize: "11.5px",
      lineHeight: 1.3,
      padding: "2px 5px",

      opacity: status === "cancelled" ? 0.5 : 1,
    },
  };
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
}) {
  const events = useMemo(
    () =>
      bookings.map((booking) => ({
        title: `${booking.service.name} · ${booking.client.name}`,
        start: toDisplayDate(booking.startsAt, timezone),
        end: toDisplayDate(booking.endsAt, timezone),
        // The untouched booking travels with the event so every interaction
        // works from real data rather than from the shifted display Dates.
        resource: { booking },
      })),
    [bookings, timezone]
  );


  const getNow = useCallback(() => toDisplayDate(new Date(), timezone), [timezone]);

  /** Steps the visible date by one unit of whichever view is showing. */
  const step = (direction) => {
    const unit = view === Views.DAY ? "days" : "weeks";
    const moved = fromDisplayDate(date, timezone).plus({ [unit]: direction });
    onNavigate(toDisplayDate(moved.toJSDate(), timezone));
  };

  /** The label the library's own toolbar used to print, in our own type. */
  const rangeLabel = useMemo(() => {
    const anchor = fromDisplayDate(date, timezone);

    if (view === Views.DAY) return anchor.toFormat("cccc d LLLL yyyy");

    const start = anchor.startOf("week");
    const end = anchor.endOf("week");

    // "3 – 9 Nov 2026" when the week does not straddle a month or a year, which
    // is most weeks; the fuller form only when it has to be.
    if (start.month === end.month) {
      return `${start.toFormat("d")} – ${end.toFormat("d LLL yyyy")}`;
    }
    if (start.year === end.year) {
      return `${start.toFormat("d LLL")} – ${end.toFormat("d LLL yyyy")}`;
    }
    return `${start.toFormat("d LLL yyyy")} – ${end.toFormat("d LLL yyyy")}`;
  }, [date, view, timezone]);

  const isToday = useMemo(() => {
    const shown = fromDisplayDate(date, timezone);
    const now = DateTime.now().setZone(timezone);
    return view === Views.DAY
      ? shown.hasSame(now, "day")
      : shown.hasSame(now, "week") && shown.hasSame(now, "year");
  }, [date, view, timezone]);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-subtle px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" onClick={() => step(-1)} aria-label="Previous" className={iconButton}>
            <Icon name="chevronLeft" size={16} />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next" className={iconButton}>
            <Icon name="chevronRight" size={16} />
          </button>

          <button
            type="button"
            onClick={() => onNavigate(toDisplayDate(new Date(), timezone))}
            disabled={isToday}
            className={`${secondaryButton} ${buttonSm} ml-1`}
          >
            Today
          </button>

          <h3 className="ml-2 min-w-0 truncate text-sm font-semibold text-ink">{rangeLabel}</h3>
        </div>

        <SegmentedControl
          label="Calendar view"
          panelId="provider-calendar-grid"
          value={view}
          onChange={onView}
          options={[
            { id: Views.DAY, label: "Day" },
            { id: Views.WEEK, label: "Week" },
          ]}
        />
      </div>

      <div
        id="provider-calendar-grid"
        aria-busy={loading}
        className={`p-2 transition-opacity duration-150 motion-reduce:transition-none sm:p-3 ${
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
          views={[Views.DAY, Views.WEEK]}
          step={30}
          timeslots={2}
          scrollToTime={new Date(1970, 0, 1, 7, 0, 0)}
          popup
          onSelectEvent={(event) => onSelectBooking(event.resource.booking)}
          eventPropGetter={eventStyleGetter}
          style={{ height: 560 }}
          tooltipAccessor={(event) => {
            const { booking } = event.resource;
            return `${booking.service.name} with ${booking.client.name} — ${booking.status}`;
          }}
        />
      </div>

      <p className="flex items-center gap-1.5 border-t border-line-soft px-3 py-2 text-xs text-ink-3">
        <Icon name="globe" size={12} />
        Times shown in {zoneName(timezone)}, whatever zone this device is set to.
      </p>
    </div>
  );
}

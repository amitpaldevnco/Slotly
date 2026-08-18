/**
 * The provider's calendar — `schedule_calendar`.
 *
 * The header is the reference's: the range as an `h2`, a joined pair of arrows,
 * a Today button, and a Day/Week switch on the right. The grid below it is
 * `ProviderCalendar`, unchanged in behaviour — the same window query, the same
 * timezone anchoring and the same click-through to a booking that the dashboard
 * used before this screen had a route of its own.
 *
 * All three of the reference's views are here. Month was previously left out on
 * the grounds that it would have to fetch a month of records per arrow press —
 * which it does, and which turns out to be the right trade: `GET /bookings`
 * takes an arbitrary `from`/`to` with no range cap, and a month of *bookings* is
 * a handful of rows, not the dense grid the slots endpoint has to generate. The
 * query covers the whole visible grid, including the tail of the previous month
 * and the head of the next, so no cell is drawn empty for want of asking.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Views } from "react-big-calendar";
import { DateTime } from "luxon";
import * as bookingsApi from "../api/bookings";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import ProviderCalendar from "../components/dashboard/ProviderCalendar";
import Icon from "../components/ui/Icon";
import { Alert, SkeletonBlock } from "../components/ui/Feedback";
import { fromDisplayDate, toDisplayDate } from "../lib/time";
import { container } from "../lib/ui";

/** A phone cannot show seven columns legibly, so it opens on a single day. */
function initialCalendarView() {
  if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches) {
    return Views.DAY;
  }
  return Views.WEEK;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // The zone the whole calendar is drawn in: the provider's saved zone, read
  // from their user row. Nothing on this screen consults the device's zone.
  const timezone = user?.timezone || "UTC";

  const [date, setDate] = useState(() => toDisplayDate(new Date(), timezone));
  const [view, setView] = useState(initialCalendarView);

  // Changing the saved timezone re-anchors "today" — otherwise the grid keeps
  // showing the day that was today in the previous zone.
  const anchoredZone = useRef(timezone);
  useEffect(() => {
    if (anchoredZone.current === timezone) return;
    anchoredZone.current = timezone;
    setDate(toDisplayDate(new Date(), timezone));
  }, [timezone]);

  // The window the grid needs: the visible day or week, padded a day either side
  // so an appointment on a boundary is never clipped.
  const range = useMemo(() => {
    const anchor = fromDisplayDate(date, timezone);

    if (view === Views.MONTH) {
      // A month grid also draws the tail of the previous month and the head of
      // the next, so the window is the visible *cells* rather than the month —
      // otherwise those leading and trailing days would always look free.
      return {
        from: anchor.startOf("month").startOf("week").minus({ days: 1 }).toUTC().toISO(),
        to: anchor.endOf("month").endOf("week").plus({ days: 1 }).toUTC().toISO(),
      };
    }

    const unit = view === Views.DAY ? "day" : "week";

    return {
      from: anchor.startOf(unit).minus({ days: 1 }).toUTC().toISO(),
      to: anchor.endOf(unit).plus({ days: 1 }).toUTC().toISO(),
    };
  }, [date, view, timezone]);

  const { data, loading, error, reload } = useApiResource(
    ({ signal }) => bookingsApi.list({ from: range.from, to: range.to }, { signal }),
    { deps: [range], fallback: "Could not load your calendar.", keepPreviousData: true }
  );

  const bookings = data?.bookings ?? [];

  /** Steps the visible date by one unit of whichever view is showing. */
  const step = (direction) => {
    const unit = view === Views.DAY ? "days" : view === Views.MONTH ? "months" : "weeks";
    const moved = fromDisplayDate(date, timezone).plus({ [unit]: direction });
    setDate(toDisplayDate(moved.toJSDate(), timezone));
  };

  const rangeLabel = useMemo(() => {
    const anchor = fromDisplayDate(date, timezone);
    if (view === Views.DAY) return anchor.toFormat("cccc d LLLL yyyy");
    if (view === Views.MONTH) return anchor.toFormat("LLLL yyyy");

    const start = anchor.startOf("week");
    const end = anchor.endOf("week");

    // "3 – 9 Nov 2026" when the week does not straddle a month or a year, which
    // is most weeks; the fuller form only when it has to be.
    if (start.month === end.month) return `${start.toFormat("d")} – ${end.toFormat("d LLL yyyy")}`;
    if (start.year === end.year) {
      return `${start.toFormat("d LLL")} – ${end.toFormat("d LLL yyyy")}`;
    }
    return `${start.toFormat("d LLL yyyy")} – ${end.toFormat("d LLL yyyy")}`;
  }, [date, view, timezone]);

  const isToday = useMemo(() => {
    const shown = fromDisplayDate(date, timezone);
    const now = DateTime.now().setZone(timezone);

    if (view === Views.DAY) return shown.hasSame(now, "day");
    if (view === Views.MONTH) return shown.hasSame(now, "month");
    // A week can straddle two years, so the year has to be checked separately.
    return shown.hasSame(now, "week") && shown.hasSame(now, "year");
  }, [date, view, timezone]);

  return (
    <div className={`${container} py-margin-mobile md:py-margin-desktop`}>
      <header className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="font-h2 text-h2 text-on-background">{rangeLabel}</h1>

          <div className="flex items-center rounded-md border border-outline-variant bg-surface">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous"
              className="cursor-pointer border-r border-outline-variant p-2 text-on-surface-variant transition-colors hover:bg-surface-variant"
            >
              <Icon name="chevron_left" size={24} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next"
              className="cursor-pointer p-2 text-on-surface-variant transition-colors hover:bg-surface-variant"
            >
              <Icon name="chevron_right" size={24} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDate(toDisplayDate(new Date(), timezone))}
            disabled={isToday}
            className="cursor-pointer rounded-md border border-outline-variant bg-surface px-4 py-2 font-small text-small text-on-background transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-50"
          >
            Today
          </button>
        </div>

        <div className="flex items-center rounded-md border border-outline-variant bg-surface-container-low p-1">
          {[
            { id: Views.DAY, label: "Day" },
            { id: Views.WEEK, label: "Week" },
            { id: Views.MONTH, label: "Month" },
          ].map((option) => {
            const active = option.id === view;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                aria-pressed={active}
                className={`cursor-pointer rounded-md px-4 py-1.5 font-small text-small transition-colors ${
                  active
                    ? "border border-outline-variant/50 bg-surface font-semibold text-primary shadow-raise"
                    : "text-on-surface-variant hover:text-primary"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </header>

      {error && (
        <Alert
          tone="error"
          className="mb-6"
          action={
            <button
              type="button"
              onClick={reload}
              className="cursor-pointer font-small text-small font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          }
        >
          {error}
        </Alert>
      )}

      {loading && bookings.length === 0 ? (
        <div
          aria-hidden="true"
          className="overflow-hidden rounded-lg border border-outline-variant bg-surface p-4"
        >
          <SkeletonBlock className="h-[720px] w-full rounded-md" />
        </div>
      ) : (
        <ProviderCalendar
          bookings={bookings}
          timezone={timezone}
          date={date}
          view={view}
          loading={loading}
          onNavigate={setDate}
          onView={setView}
          onSelectBooking={(booking) => navigate(`/bookings/${booking.id}`)}
        />
      )}
    </div>
  );
}

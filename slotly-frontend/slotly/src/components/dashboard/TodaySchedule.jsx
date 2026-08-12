// The provider's day.

import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import StatusBadge from "../ui/StatusBadge";
import Icon from "../ui/Icon";
import EmptyState, { SkeletonRows } from "../ui/Feedback";
import { Section } from "../ui/Page";
import { formatTime, relativeTime } from "../../lib/time";
import { linkClasses, highlightPill, emphasisRow } from "../../lib/ui";


export default function TodaySchedule({ bookings, timezone, loading }) {

  const now = DateTime.now().setZone(timezone);
  const today = now.toISODate();

  const todays = bookings
    .filter((booking) => DateTime.fromISO(booking.startsAt).setZone(timezone).toISODate() === today)
    // Cancelled appointments stay in history but are not part of the day's work.
    .filter((booking) => booking.status !== "cancelled")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const nowMillis = Date.now();
  const next = todays.find((booking) => new Date(booking.startsAt).getTime() > nowMillis);

  return (
    <Section
      headingId="today-heading"
      title="Today"
      description={now.toFormat("cccc d LLLL")}
      actions={
        !loading && (
          <span className="text-xs tabular-nums text-ink-3">
            {todays.length === 0 ? "Clear" : `${todays.length} appt${todays.length === 1 ? "" : "s"}`}
          </span>
        )
      }
      flush
    >
      {loading ? (
        <div className="p-3">
          <SkeletonRows count={3} variant="line" />
        </div>
      ) : todays.length === 0 ? (
        <EmptyState
          compact
          icon="calendar"
          title="Nothing booked today"
          description="Clients can only book times inside your published hours."
          actionLabel="Check availability"
          actionTo="/availability"
        />
      ) : (
        <ul className="divide-y divide-line-soft">
          {todays.map((booking) => {
            const upcoming = new Date(booking.startsAt).getTime() > nowMillis;
            const isNext = next?.id === booking.id;

            return (
              <li key={booking.id}>
                <Link
                  to={`/bookings/${booking.id}`}
                  // The one row that is next gets the tint and the left edge.
                  // Everything else, including everything already finished, stays
                  // plain — which is what makes the one treatment mean something.
                  className={`flex items-start gap-3 px-3 py-2.5 transition hover:bg-subtle ${
                    isNext ? emphasisRow : ""
                  }`}
                >
                
                  <span
                    className={`w-[4.25rem] shrink-0 text-[0.8125rem] tabular-nums ${
                      isNext
                        ? "font-semibold text-ink"
                        : upcoming
                          ? "text-ink"
                          : "text-ink-3 line-through decoration-line"
                    }`}
                  >
                    {formatTime(booking.startsAt, timezone)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-medium text-ink">
                      {booking.service.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {booking.client.name}
                    </span>
                    
                    {isNext && (
                      <span className={`${highlightPill} mt-1.5`}>
                        {relativeTime(booking.startsAt)}
                      </span>
                    )}
                  </span>

                  
                  {booking.status !== "booked" && (
                    <StatusBadge status={booking.status} className="mt-0.5" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && todays.length > 0 && (
        <p className="flex items-center gap-1.5 border-t border-line-soft px-3 py-2 text-xs text-ink-3">
          <Icon name="clock" size={12} />
          <Link to="/availability" className={linkClasses}>
            Block time off
          </Link>
        </p>
      )}
    </Section>
  );
}

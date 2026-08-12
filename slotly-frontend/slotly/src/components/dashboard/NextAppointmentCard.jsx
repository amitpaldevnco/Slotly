//  The client's next appointment, promoted above the list.

import { Link } from "react-router-dom";
import StatusBadge from "../ui/StatusBadge";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import { formatLongDate, formatTime, relativeTime, zoneLabel } from "../../lib/time";
import {
  primaryButton,
  secondaryButton,
  buttonSm,
  metricLg,
  highlightPill,
  accentEdge,
  formatDuration,
  metaLine,
  zoneName,
} from "../../lib/ui";


export default function NextAppointmentCard({ booking, viewerZone }) {
  const provider = booking.provider;
  const differentZones = booking.client.timezone !== booking.provider.timezone;

  return (
    <section
      aria-labelledby="next-appointment-heading"
      className={`overflow-hidden rounded-lg border border-brand-line bg-surface ${accentEdge}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-brand-line bg-brand-soft px-4 py-2">
        <h2
          id="next-appointment-heading"
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-brand-ink"
        >
          <Icon name="calendarCheck" size={14} />
          Your next appointment
        </h2>
        <StatusBadge status={booking.status} />
      </div>

      <div className="p-4 sm:p-5">
       
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className={metricLg}>{formatTime(booking.startsAt, viewerZone)}</p>
          <p className="text-base text-ink-2">{formatLongDate(booking.startsAt, viewerZone)}</p>
          <span className={highlightPill}>
            <Icon name="clock" size={12} />
            {relativeTime(booking.startsAt)}
          </span>
        </div>

        <p className="mt-1 text-xs text-ink-3">
          {metaLine(
            `until ${formatTime(booking.endsAt, viewerZone)}`,
            formatDuration(booking.service.duration),
            `${zoneLabel(booking.startsAt, viewerZone)} · your time`
          )}
        </p>

        
        {differentZones && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
            <Icon name="globe" size={12} />
            {formatTime(booking.startsAt, booking.provider.timezone)} for them in{" "}
            {zoneName(booking.provider.timezone)}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2.5 border-t border-line-soft pt-3.5">
          <Avatar src={provider.avatarUrl} name={provider.name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{booking.service.name}</p>
            <p className="truncate text-xs text-ink-3">
              with {provider.businessName || provider.name}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={`/bookings/${booking.id}`} className={`${primaryButton} ${buttonSm}`}>
            View details
          </Link>
          
          <Link to={`/bookings/${booking.id}`} className={`${secondaryButton} ${buttonSm}`}>
            <Icon name="message" size={14} />
            Ask a question
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * One appointment, as a card. The shared row in every list of bookings —
 * dashboards, history, the client's upcoming list.
 *
 * Always renders the time with its zone label attached. A time without its zone
 * is precisely the ambiguity this app exists to remove, and a card is the most
 * likely place to drop it, because there is never quite enough room.
 */
import { Link } from "react-router-dom";
import StatusBadge from "../ui/StatusBadge";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import { formatDateTime, formatTime, relativeTime, zoneLabel } from "../../lib/time";
import {
  cardInteractive,
  highlightPill,
  emphasisRow,
  formatPrice,
  formatDuration,
  metaLine,
} from "../../lib/ui";


export default function BookingCard({ booking, viewerRole, highlight = false }) {
  const isClientView = viewerRole === "client";

  const viewerZone = isClientView ? booking.client.timezone : booking.provider.timezone;
  const otherZone = isClientView ? booking.provider.timezone : booking.client.timezone;
  const otherParty = isClientView ? booking.provider : booking.client;
  const differentZones = booking.client.timezone !== booking.provider.timezone;

  const upcoming = booking.status === "booked" || booking.status === "rescheduled";

  const isNext = Boolean(highlight);

  return (
    <Link
      to={`/bookings/${booking.id}`}
      className={`${cardInteractive} block px-3.5 py-3 ${isNext ? emphasisRow : ""}`}
    >
      <div className="flex items-start gap-3">
        <Avatar src={otherParty.avatarUrl} name={otherParty.name} size="md" />

        <div className="min-w-0 flex-1">
          {/* The time first and in the app's one emphasis weight — this is the
              line the reader came for. */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-ink">
              {formatDateTime(booking.startsAt, viewerZone)}
            </span>
            {upcoming && (
              <span className={highlightPill}>{relativeTime(booking.startsAt)}</span>
            )}
          </div>

          <p className="mt-0.5 truncate text-sm text-ink">
            {booking.service.name}
            <span className="text-ink-3"> {isClientView ? "with" : "for"} </span>
            <span className="text-ink-2">{otherParty.businessName || otherParty.name}</span>
          </p>

          <p className="mt-1 truncate text-xs text-ink-3">
            {metaLine(
              zoneLabel(booking.startsAt, viewerZone),
              formatDuration(booking.service.duration),
              formatPrice(booking.service.price),
              differentZones ? `${formatTime(booking.startsAt, otherZone)} their time` : null
            )}
          </p>

          {booking.status === "cancelled" && booking.cancellationReason && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs leading-relaxed text-danger-ink">
              <Icon name="info" size={13} className="mt-px" />
              <span className="min-w-0">{booking.cancellationReason}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge status={booking.status} />
          <Icon name="chevronRight" size={15} className="hidden text-ink-3 sm:block" />
        </div>
      </div>
    </Link>
  );
}

// The provider's bookings, as a table.

import { useNavigate } from "react-router-dom";
import StatusBadge from "../ui/StatusBadge";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import BookingCard from "./BookingCard";
import { inZone, formatTime, relativeTime, TIME_FORMAT } from "../../lib/time";
import {
  tableClasses,
  theadClasses,
  thClasses,
  metricSm,
  highlightPill,
  formatPrice,
  formatDuration,
} from "../../lib/ui";


export default function BookingsTable({ bookings, timezone }) {
  const navigate = useNavigate();

  return (
    <>
      {/* Phone: the same rows as every other list in the app. */}
      <ul className="space-y-2 md:hidden">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <BookingCard booking={booking} viewerRole="provider" />
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border border-line bg-surface md:block">
        <table className={tableClasses}>
          <caption className="sr-only">
            Your bookings, with the appointment time, service, client and status.
          </caption>

          <thead className={theadClasses}>
            <tr>
              <th scope="col" className={thClasses}>
                When
              </th>
              <th scope="col" className={thClasses}>
                Service
              </th>
              <th scope="col" className={thClasses}>
                Client
              </th>
              <th scope="col" className={`${thClasses} hidden lg:table-cell`}>
                Duration
              </th>
              <th scope="col" className={`${thClasses} hidden text-right lg:table-cell`}>
                Price
              </th>
              <th scope="col" className={thClasses}>
                Status
              </th>
              {/* The chevron column. Headed for structure, unlabelled for the eye. */}
              <th scope="col" className={`${thClasses} w-9`}>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {bookings.map((booking) => (
              <Row
                key={booking.id}
                booking={booking}
                timezone={timezone}
                onOpen={() => navigate(`/bookings/${booking.id}`)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ booking, timezone, onOpen }) {
  const when = inZone(booking.startsAt, timezone);
  const upcoming = booking.status === "booked" || booking.status === "rescheduled";

  return (
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer border-b border-line-soft transition last:border-0 hover:bg-subtle focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-brand"
    >
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="block text-[0.8125rem] font-semibold text-ink">
          {when.toFormat("ccc d LLL")}
        </span>
        <span className="block text-xs tabular-nums text-ink-2">{when.toFormat(TIME_FORMAT)}</span>
      </td>

      <td className="max-w-[16rem] px-3 py-2.5">
        <span className="block truncate text-[0.8125rem] text-ink">{booking.service.name}</span>
        {upcoming && (
          <span className={`${highlightPill} mt-0.5`}>{relativeTime(booking.startsAt)}</span>
        )}
      </td>

      <td className="max-w-[14rem] px-3 py-2.5">
        <span className="flex items-center gap-2">
          <Avatar src={booking.client.avatarUrl} name={booking.client.name} size="xs" />
          <span className="min-w-0">
            <span className="block truncate text-[0.8125rem] text-ink">{booking.client.name}</span>
            {/* Only when the client is somewhere else. On a same-zone booking this
                line would repeat the time in the first column. */}
            {booking.client.timezone !== timezone && (
              <span className="block truncate text-xs text-ink-3">
                {formatTime(booking.startsAt, booking.client.timezone)} their time
              </span>
            )}
          </span>
        </span>
      </td>

      <td className="hidden px-3 py-2.5 text-[0.8125rem] whitespace-nowrap text-ink-2 lg:table-cell">
        {formatDuration(booking.service.duration)}
      </td>

      <td className={`hidden px-3 py-2.5 text-right whitespace-nowrap lg:table-cell ${metricSm}`}>
        {formatPrice(booking.service.price)}
      </td>

      <td className="px-3 py-2.5">
        <StatusBadge status={booking.status} dot />
      </td>

      <td className="px-3 py-2.5 text-right">
        <Icon name="chevronRight" size={15} className="text-ink-3" />
      </td>
    </tr>
  );
}

// One service in a grid.

import { useState } from "react";
import { Link } from "react-router-dom";
import { imageUrl } from "../../api/client";
import Icon from "../ui/Icon";
import {
  formatPrice,
  formatDuration,
  primaryButton,
  secondaryButton,
  buttonSm,
  iconButton,
  badgeVariants,
  metric,
  metricSm,
} from "../../lib/ui";


export default function ServiceCard({
  service,
  isOwner,
  providerId,
  canBook,
  onEdit,
  onDelete,
  onViewBookings,
  onViewDetails,
}) {
  const retired = service.is_active === false;

  return (
    <article
      className={`group relative flex h-full flex-col overflow-hidden rounded-lg border bg-surface transition ${
        retired ? "border-line opacity-70" : "border-line hover:border-brand-line hover:shadow-raise"
      }`}
    >
      <Cover src={imageUrl(service.cover_image)} name={service.service_name} />

      {/* The owner's controls float over the cover, so they cost the card no
          vertical space. Always visible on touch, where there is no hover. */}
      {isOwner && (
        <div className="absolute right-2 top-2 flex gap-1 rounded-md bg-surface/90 p-0.5 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => onEdit(service)}
            aria-label={`Edit ${service.service_name}`}
            className={iconButton}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(service)}
            aria-label={`Remove ${service.service_name}`}
            className={`${iconButton} hover:bg-danger-soft hover:text-danger-ink`}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug text-ink">{service.service_name}</h3>
          {retired && <span className={badgeVariants.neutral}>Retired</span>}
        </div>

        {/* Duration and price on one line, because these are the two values a
            client actually compares between cards. */}
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={metric}>{formatPrice(service.price)}</span>
          <span className="text-xs text-ink-3">{formatDuration(service.duration)}</span>
        </div>

        {service.description && (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-2">
            {service.description}
          </p>
        )}

        {/* Owner-only.  */}
        {isOwner && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-soft pt-2.5 text-xs text-ink-3">
            <span>
              <span className={metricSm}>{service.total_bookings ?? 0}</span> booked
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <span className={metricSm}>{formatPrice(service.total_earnings)}</span> earned
            </span>
            {Number(service.upcoming_bookings) > 0 && (
              <span className="text-warn-ink">{service.upcoming_bookings} upcoming</span>
            )}
          </div>
        )}

        {/* Pushed to the bottom so cards with differing text lengths still line
            their buttons up across the grid row. */}
        <div className="mt-auto flex gap-2 pt-3">
          <button
            type="button"
            onClick={() => onViewDetails(service)}
            className={`${secondaryButton} ${buttonSm} flex-1`}
          >
            Details
          </button>

          {isOwner ? (
            <button
              type="button"
              onClick={() => onViewBookings(service)}
              className={`${secondaryButton} ${buttonSm} flex-1`}
            >
              Bookings
            </button>
          ) : retired ? (
            <span className="flex flex-1 items-center justify-center text-xs text-ink-3">
              No longer offered
            </span>
          ) : canBook ? (
            <Link
              to={`/providers/${providerId}/book/${service.id}`}
              className={`${primaryButton} ${buttonSm} flex-1`}
            >
              Book
            </Link>
          ) : (
            <Link
              to="/login"
              state={{ from: `/providers/${providerId}/book/${service.id}` }}
              className={`${primaryButton} ${buttonSm} flex-1`}
            >
              Sign in to book
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}


function Cover({ src, name }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-28 w-full items-center justify-center border-b border-line bg-canvas text-ink-3">
        <Icon name="tag" size={20} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${name} cover image`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-28 w-full border-b border-line object-cover"
    />
  );
}

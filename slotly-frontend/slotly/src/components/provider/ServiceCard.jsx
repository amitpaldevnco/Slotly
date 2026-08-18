/**
 * One service — `services_management`.
 *
 * Transcribed from the reference: a 48px glyph tile top-left, the Active /
 * Inactive chip and the edit pencil top-right, an `h3` name, the description
 * filling the remaining height, and a hairline above a wrapped row of duration,
 * price and buffer.
 *
 * The reference gives each service a different glyph; Slotly has no icon field
 * on `services`, so a service's own cover image is used where one was uploaded
 * and a category glyph stands in where one was not. That is the same slot, drawn
 * from data the application actually stores.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { imageUrl } from "../../api/client";
import Icon from "../ui/Icon";
import { formatPrice, formatDuration } from "../../lib/ui";

export default function ServiceCard({
  service,
  isOwner,
  providerId,
  canBook,
  onEdit,
  onDelete,
  onReactivate,
  reactivating = false,
  onViewBookings,
  onViewDetails,
}) {
  const retired = service.isActive === false;
  const buffer = (service.bufferBefore || 0) + (service.bufferAfter || 0);

  return (
    <div className="group relative flex flex-col rounded-lg border border-outline-variant bg-surface p-6 transition-all duration-200 hover:border-primary/30 hover:shadow-raise">
      <div className="mb-4 flex items-start justify-between gap-3">
        <ServiceGlyph src={imageUrl(service.coverImage)} name={service.name} />

        <div className="flex items-center gap-2">
          {/* An "Active" chip on every card a client can see says nothing — they
              are all active, or they would not be listed. It appears for the
              owner, who has both kinds, and on a retired service anywhere. */}
          {(isOwner || retired) && (
            <span
              className={`rounded-md px-2 py-1 font-caption text-caption font-bold uppercase tracking-wider ${
                retired ? "bg-surface-variant text-on-surface-variant" : "bg-primary/10 text-primary"
              }`}
            >
              {retired ? "Inactive" : "Active"}
            </span>
          )}

          {/* A retired service is frozen — the API refuses an edit with
              SERVICE_RETIRED, because live bookings show their own snapshotted
              name and price and changing the row would alter only history. So
              Edit is replaced by Reactivate rather than being offered and then
              failing. Remove stays: a retired service with no history can still
              be deleted outright. */}
          {isOwner && (
            <>
              {retired ? (
                <button
                  type="button"
                  onClick={() => onReactivate(service)}
                  disabled={reactivating}
                  aria-label={`Reactivate ${service.name}`}
                  className="cursor-pointer p-1 text-on-surface-variant transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name={reactivating ? "progress_activity" : "restart_alt"} size={20} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onEdit(service)}
                  aria-label={`Edit ${service.name}`}
                  className="cursor-pointer p-1 text-on-surface-variant transition-colors hover:text-primary"
                >
                  <Icon name="edit" size={20} />
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(service)}
                aria-label={`Remove ${service.name}`}
                className="cursor-pointer p-1 text-on-surface-variant transition-colors hover:text-error"
              >
                <Icon name="delete" size={20} />
              </button>
            </>
          )}
        </div>
      </div>

      <h3 className="mb-2 font-h3 text-h3 text-primary">{service.name}</h3>

      <p
        className={`mb-6 flex-1 font-small text-small text-on-surface-variant ${
          retired ? "opacity-70" : ""
        }`}
      >
        {service.description || "No description yet."}
      </p>

      <div
        className={`flex flex-wrap gap-x-4 gap-y-3 border-t border-outline-variant/50 pt-4 ${
          retired ? "opacity-70" : ""
        }`}
      >
        <div className="flex w-[calc(50%-8px)] items-center gap-1.5 text-on-surface-variant">
          <Icon name="schedule" size={16} />
          <span className="font-small text-small">{formatDuration(service.duration)}</span>
        </div>
        <div className="flex w-[calc(50%-8px)] items-center gap-1.5 text-on-surface-variant">
          <Icon name="payments" size={16} />
          <span className="font-small text-small font-semibold text-primary">
            {formatPrice(service.price)}
          </span>
        </div>
        {buffer > 0 && (
          <div className="flex w-full items-center gap-1.5 text-on-surface-variant">
            <Icon name="hourglass_empty" size={16} />
            <span className="font-caption text-caption">{buffer} min buffer</span>
          </div>
        )}
      </div>

      {/* The owner's running totals, and the actions each viewer gets. The
          reference card is display-only because its edit pencil is the only
          affordance a provider needs; a client's card has to offer the booking. */}
      {isOwner ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-outline-variant/50 pt-4 font-caption text-caption text-on-surface-variant">
            <span>
              <span className="font-bold text-on-surface">{service.stats?.totalBookings ?? 0}</span> booked
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <span className="font-bold text-on-surface">
                {formatPrice(service.stats?.totalEarnings)}
              </span>{" "}
              earned
            </span>
            {Number(service.stats?.upcomingBookings) > 0 && (
              <span className="font-semibold text-on-surface">
                {service.stats.upcomingBookings} upcoming
              </span>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => onViewDetails(service)}
              className="flex-1 cursor-pointer rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => onViewBookings(service)}
              className="flex-1 cursor-pointer rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
            >
              Bookings
            </button>
          </div>

          {/* Retiring used to be a one-way door in the UI even though it never
              was in the data, so a provider who retired something by mistake had
              to recreate it — losing that service's booking history and reviews
              to a new row. A labelled button rather than only the header icon,
              because this is the one action a retired card exists to offer. */}
          {retired && (
            <button
              type="button"
              onClick={() => onReactivate(service)}
              disabled={reactivating}
              className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 font-small text-small font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="restart_alt" size={16} />
              {reactivating ? "Reactivating…" : "Reactivate service"}
            </button>
          )}
        </>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onViewDetails(service)}
            className="flex-1 cursor-pointer rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
          >
            Details
          </button>

          {/* This branch is the non-owner view, so a retired service is simply
              a fact to state — a client has nothing to do about it. The owner's
              Reactivate action lives in the owner branch above. */}
          {retired ? (
            <span className="flex flex-1 items-center justify-center font-caption text-caption text-on-surface-variant">
              No longer offered
            </span>
          ) : canBook ? (
            <Link
              to={`/providers/${providerId}/book/${service.id}`}
              className="flex flex-1 items-center justify-center rounded-md bg-primary px-4 py-2 font-small text-small text-on-primary transition-colors hover:bg-primary/90"
            >
              Book
            </Link>
          ) : (
            <Link
              to="/login"
              state={{ from: `/providers/${providerId}/book/${service.id}` }}
              className="flex flex-1 items-center justify-center rounded-md bg-primary px-4 py-2 font-small text-small text-on-primary transition-colors hover:bg-primary/90"
            >
              Sign in to book
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** The 48px tile: the service's cover image, or a category glyph in its place. */
function ServiceGlyph({ src, name }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-outline-variant/50 bg-surface-container-low text-primary">
        <Icon name="category" size={24} />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-12 w-12 shrink-0 rounded-md border border-outline-variant/50 object-cover"
      title={name}
    />
  );
}

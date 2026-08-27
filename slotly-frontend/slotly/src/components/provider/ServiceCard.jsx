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

import { Link } from "react-router-dom";
import Icon from "../ui/Icon";
import ServiceCover from "./ServiceCover";
import { formatPrice, formatDuration } from "../../lib/ui";
import {
  deliveryIcon,
  deliveryLabel,
  scopeIcon,
  scopeLabel,
} from "../../lib/serviceScope";

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
    // `w-full` is what makes every card the same width, and its absence is
    // why they were not. The grid's columns were always equal — Tailwind's
    // `grid-cols-3` emits `minmax(0, 1fr)` — but this card is a *flex item* of
    // the grid cell, and a flex item's `flex-grow` defaults to 0. So the card
    // never grew to fill its column: `flex-basis: auto` sized it to its own
    // content, and a service whose description ran to one line came out visibly
    // narrower than the card beside it, with the leftover column width showing
    // as a gap after it.
    //
    // Reserving the inner zones could not have fixed this. Equal columns are not
    // equal cards unless something tells the card to occupy its column.
    <div className="group relative flex w-full flex-col rounded-lg border border-outline-variant bg-surface p-6 transition-all duration-200 hover:border-primary/30 hover:shadow-raise">
      <div className="mb-4 flex items-start justify-between gap-3">
        {/* The management grid keeps its 48px square tile from the reference —
            this card is not the public list and is not what the services design
            describes. The border is passed explicitly because `ServiceCover`
            draws one only on the placeholder: at 48px a photo reads better with
            an edge than without, which is the opposite of the large public
            thumbnail. */}
        <ServiceCover
          coverImage={service.coverImage}
          name={service.name}
          className="h-12 w-12 rounded-md border border-outline-variant/50"
        />

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
              failing.

              Remove goes with it. `DELETE /services/:id` does one of two
              entirely different things depending on a number that is not on this
              card: with no bookings it deletes the row outright, and with any
              bookings it sets `is_active = FALSE` — which, on a service that is
              *already* inactive, is a no-op that still reports success. One
              icon, two outcomes, no way for the provider to tell which they were
              about to get, and on the common case (a retired service has history,
              which is usually why it was retired) a button that does nothing at
              all.

              A retired card therefore offers one action: put it back. Deleting a
              retired service that genuinely has no history is still reachable —
              reactivate it, then remove it — and that path at least says what it
              is doing at each step. */}
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
              {!retired && (
                <button
                  type="button"
                  onClick={() => onDelete(service)}
                  aria-label={`Remove ${service.name}`}
                  className="cursor-pointer p-1 text-on-surface-variant transition-colors hover:text-error"
                >
                  <Icon name="delete" size={20} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Two lines, always — the same reservation the description gets below,
          and for the same reason. This was unclamped, so "Initial consultation
          and treatment plan" took three lines where "Follow-up session" took
          one, and everything under it on that card sat two lines lower than on
          its neighbour. Fixing the description alone would have left the name
          free to reintroduce the misalignment.

          Reserved through the theme's own type scale rather than a measured
          pixel value, so it stays exactly two lines if `--text-h3` or its
          line-height is ever changed. */}
      <h3 className="mb-2 line-clamp-2 min-h-[calc(2*var(--text-h3)*var(--text-h3--line-height))] font-h3 text-h3 text-primary">
        {service.name}
      </h3>

      {/* Always exactly three lines tall, whether the description fills them
          or the service has none.

          Clamped at three because that is what the form's own live preview
          shows: unclamped, one long description stretched its card past its
          neighbours, and a provider who wrote it was shown a tidy three-line
          preview, saved, and got something else. Three lines rather than a
          character count, so the cut lands on a line boundary at whatever width
          the card happens to be. The full text stays in the DOM — still
          selectable and searchable — and `Details` opens all of it.

          The reserved height, in place of `flex-1`, is the part that makes a
          row of cards line up. `flex-1` let this paragraph absorb every pixel of
          leftover height in the card, so a service with no description got one
          enormous gap between "No description yet." and its duration — and its
          duration, price and stats sat tens of pixels lower than the same rows
          on the card beside it. Reserving three lines instead means the block
          under the description starts at the same height on every card, and the
          slack moves to `mt-auto` on the actions, where it reads as padding
          rather than as a hole.

          Computed from the theme's own `--text-small` and its line-height, so
          three lines stays three lines if the type scale moves. This was `3lh`,
          which reads better but needs Chrome 109 / Safari 16.4 / Firefox 120 —
          and on anything older the declaration is dropped in silence and the
          card goes back to being sized by its text, which is the one failure
          mode this is here to prevent. `calc()` over a custom property has no
          such floor. */}
      <p
        className={`mb-6 line-clamp-3 min-h-[calc(3*var(--text-small)*var(--text-small--line-height))] font-small text-small text-on-surface-variant ${
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
            {formatPrice(service.price, service.currency)}
          </span>
        </div>
        {/* Always drawn, so the stats and the buttons below it sit at the same
            height on every card. This row used to appear only when there was a
            buffer, which made it the last thing that could still shift a card's
            insides — a service with buffer time pushed its own stats a line
            lower than an identical service without.

            Filled with the true statement rather than an empty spacer: "no
            buffer time" is a fact a provider scanning this grid wants, and a
            blank reserved line would look like something failed to load. */}
        {buffer > 0 ? (
          <div className="flex w-full items-center gap-1.5 text-on-surface-variant">
            <Icon name="hourglass_empty" size={16} />
            <span className="font-caption text-caption">{buffer} min buffer</span>
          </div>
        ) : (
          <div className="flex w-full items-center gap-1.5 text-outline">
            <Icon name="hourglass_empty" size={16} />
            <span className="font-caption text-caption">No buffer time</span>
          </div>
        )}

        {/* Where it happens and who may book it, on one line.
            Always drawn, for the reason the buffer line above is: both columns
            are NOT NULL on the server, so every service has an answer, and a
            row that appeared only sometimes would be the last thing left that
            could shift a card's insides. */}
        <div className="flex w-full flex-wrap items-center gap-1.5">
          <ScopeChip icon={deliveryIcon(service.deliveryType)} label={deliveryLabel(service.deliveryType)} />
          <ScopeChip icon={scopeIcon(service.bookingScope)} label={scopeLabel(service.bookingScope)} />
        </div>
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
                {formatPrice(service.stats?.totalEarnings, service.currency)}
              </span>{" "}
              earned
            </span>
            {/* Carries its own separator, like the pair above it. Without one
                the row read "2 booked · £0 earned 2 upcoming", where the third
                figure ran straight into the second and looked like part of it. */}
            {Number(service.stats?.upcomingBookings) > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-on-surface">
                  {service.stats.upcomingBookings} upcoming
                </span>
              </>
            )}
          </div>

          {/* `mt-auto` so the buttons sit on the card's bottom edge whatever
              the card's height. With the description no longer stretching, this
              is what takes up the difference between a card that has a buffer
              row and one that does not. */}
          <div className="mt-auto flex gap-2 pt-4">
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
        <div className="mt-auto flex gap-2 pt-4">
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

/**
 * One small labelled chip: an icon and a word.
 *
 * Deliberately not a `StatusBadge` — those carry a booking's status and are
 * colour-coded to it, and reusing that vocabulary here would suggest these two
 * values are states a service moves between rather than settings it holds.
 * Neutral, so the status badge at the top of the card stays the only coloured
 * thing on it.
 */
function ScopeChip({ icon, label }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant px-2 py-0.5 text-on-surface-variant">
      <Icon name={icon} size={13} />
      <span className="font-caption text-caption">{label}</span>
    </span>
  );
}

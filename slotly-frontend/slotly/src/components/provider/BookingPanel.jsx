/**
 * The body of the "Book an Appointment" panel — service choice, the facts about
 * the chosen service, and the control that leads to the slot picker.
 *
 * Lifted out of `ProviderPublicProfilePage` unchanged, because the same panel
 * now appears twice on a phone: in its usual place at the foot of the page, and
 * in a sheet that opens the moment a service is selected. On a narrow screen the
 * panel sits *after* the whole services list, so a reader who tapped Select saw
 * nothing happen — the thing that reacted was a screen further down, and a first
 * time visitor had no reason to believe there was anything below the list at
 * all. The sheet answers the tap where the tap happened.
 *
 * Presentation only. Every prop is derived by the page, the selection lives
 * there, and this file holds no state — so the sheet and the panel are two
 * renderings of one selection rather than two selections that have to be kept
 * in step.
 */

import { Link } from "react-router-dom";
import Icon from "../ui/Icon";
import { Alert } from "../ui/Feedback";
import { Select } from "../ui/Field";
import { formatPrice, formatDuration, zoneName } from "../../lib/ui";
import { deliveryIcon, deliveryLabel, isInPerson } from "../../lib/serviceScope";

export default function BookingPanel({
  bookable,
  selectedService,
  onSelectService,
  eligibility,
  provider,
  providerId,
  isOwner,
  canBook,
  // Whether anyone is signed in at all. `canBook` alone cannot answer that —
  // it is false for a signed-out visitor and for a signed-in provider, and the
  // two need different sentences.
  isSignedIn,
  // Fired when a control inside the panel takes the reader somewhere else on
  // the page. Only the sheet supplies it.
  onCompare,
  // The two copies are in the document together on a phone — the sheet is
  // mounted over the page that also holds the panel — and a duplicated `id`
  // would point both labels at whichever select the browser found first.
  fieldId = "booking-service",
}) {
  return (
    bookable.length === 0 ? (
      <p className="font-body text-body text-on-surface-variant">
        Nothing is bookable here yet.
      </p>
    ) : (
      <div className="space-y-5">
        {/* The service is chosen here, in the panel that books it.

            This was a read-only box under the words "Pick a different
            one from the Services list" — an instruction the panel gave
            and then could not help with. The list is most of a screen
            further down the left column, and the panel is `sticky`, so
            on a desktop the reader had to scroll away from the thing
            they were being told to change, click Select on a row, then
            scroll back to a panel that had never moved. On a phone the
            panel sits below the whole list, so the instruction pointed
            backwards past everything they had already scrolled through.

            A dropdown is the smaller of the two changes the panel
            needed: the rows below keep their Select buttons and still
            drive the same state, so choosing from either place works
            and the two always agree. */}
        <div>
          {bookable.length > 1 ? (
            <>
              <label
                htmlFor={fieldId}
                className="mb-1 block font-small text-small font-medium text-on-surface"
              >
                Selected Service
              </label>
              {/* Name and price in the option text, because a native
                  option cannot be laid out — and the price is the
                  other half of what someone is choosing between. */}
              <Select
                id={fieldId}
                value={selectedService?.id ?? ""}
                onChange={(event) => onSelectService(Number(event.target.value))}
              >
                {bookable.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} — {formatPrice(service.price, service.currency)}
                  </option>
                ))}
              </Select>

              {/* Jumping to the list has to dismiss the sheet first, or the
                  page scrolls to a section the sheet is covering and the link
                  looks broken. In the page's own panel there is no sheet and
                  `onCompare` is not passed, so the anchor behaves as it did. */}
              <a
                href="#services"
                onClick={onCompare}
                className="mt-2 inline-flex items-center gap-1 font-caption text-caption text-primary underline-offset-2 hover:underline"
              >
                Compare all {bookable.length} services
                <Icon name="chevronDown" size={14} />
              </a>
            </>
          ) : (
            <>
              <p className="mb-1 block font-small text-small font-medium text-on-surface">
                Selected Service
              </p>
              {/* One service, so there is nothing to choose between and
                  no control to offer. The old hint was wrong here in
                  its own right: it told the reader to pick a different
                  one when there was no different one to pick. */}
              <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant bg-surface-container-low p-3 font-body text-body text-on-surface">
                <span className="min-w-0 truncate">
                  {selectedService?.name ?? "Choose a service"}
                </span>
                {selectedService && (
                  <span className="shrink-0 font-bold">
                    {formatPrice(selectedService.price, selectedService.currency)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {selectedService && (
          <dl className="flex flex-wrap gap-x-6 gap-y-2 border-t border-outline-variant pt-4 font-small text-small">
            <div className="flex items-center gap-2">
              <dt className="text-on-surface-variant">Duration</dt>
              <dd className="font-semibold text-on-surface">
                {formatDuration(selectedService.duration)}
              </dd>
            </div>
            {provider.timezone && (
              <div className="flex items-center gap-2">
                <dt className="text-on-surface-variant">
                  Their zone
                </dt>
                <dd className="font-semibold text-on-surface">
                  {zoneName(provider.timezone)}
                </dd>
              </div>
            )}
            <div className="flex items-center gap-2">
              <dt className="text-on-surface-variant">Delivery</dt>
              <dd className="flex items-center gap-1 font-semibold text-on-surface">
                <Icon name={deliveryIcon(selectedService.deliveryType)} size={15} />
                {deliveryLabel(selectedService.deliveryType)}
              </dd>
            </div>
          </dl>
        )}

        {/* The address, before the client commits to anything.
            An in-person appointment is a journey, and the moment to
            learn where to is while choosing the service — not on a
            confirmation screen after picking a time. Drawn from the
            service rather than the provider so a virtual service never
            shows one, even though this provider has an address on
            file. */}
        {selectedService && isInPerson(selectedService) && selectedService.location?.address && (
          <div className="flex items-start gap-2 rounded-md border border-outline-variant bg-surface-container-low p-3">
            <Icon name="place" size={16} className="mt-0.5 shrink-0 text-on-surface-variant" />
            <div className="min-w-0">
              <p className="font-caption text-caption font-semibold uppercase tracking-wider text-on-surface-variant">
                Where
              </p>
              {/* whitespace-pre-line because the address is one free-text
                  field and providers type it as they would write it on an
                  envelope. Collapsing the newlines would run a
                  three-line address into one unreadable string. */}
              <p className="whitespace-pre-line font-small text-small text-on-surface">
                {selectedService.location.address}
              </p>
            </div>
          </div>
        )}

        {/* Whether this reader may book it at all.
            Rendered here, on the panel that holds the button, rather
            than on the card — a client who has selected a service they
            cannot book should be told beside the control that is about
            to refuse them. Advisory: the API re-checks it, and both
            say the same thing because both fail open on an unknown
            country. */}
        {selectedService && !eligibility.eligible && (
          <Alert tone="warn">{eligibility.reason}</Alert>
        )}

        {isOwner ? (
          <p className="rounded-md border border-outline-variant bg-surface-container-low p-3 font-caption text-caption text-on-surface-variant">
            This is your own page, so there is nothing to book here.
          </p>
        ) : canBook && selectedService && !eligibility.eligible ? (
          /* Ineligible: the button is inert rather than a link into a
             page that can only refuse. The reason is already stated
             above it, so the honest thing is to stop offering the
             action — a live "Choose a time" that leads to "not
             available in your country" spends the client's click to
             tell them something this panel has already said.

             Still rendered, and still the same size, so the panel does
             not change shape between an eligible and an ineligible
             service and the reason is what draws the eye. */
          <button
            type="button"
            disabled
            className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md bg-surface-variant font-small text-small font-medium text-on-surface-variant"
          >
            Not available in your country
          </button>
        ) : canBook && selectedService ? (
          <Link
            to={`/providers/${providerId}/book/${selectedService.id}`}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary font-small text-small font-medium text-on-primary transition-colors hover:bg-primary/90"
          >
            Choose a time
            <Icon name="arrow_forward" size={18} />
          </Link>
        ) : isSignedIn ? (
          /* Signed in, not the owner, and still cannot book — which leaves one
             case: a provider looking at another provider's page. This branch
             used to fall through to "Sign in to book" below, because `canBook`
             is false for both a visitor and a provider and nothing here told
             them apart. So a signed-in provider was asked to sign in, under a
             note promising times in a timezone they were already seeing, by a
             link to `/login` that `GuestOnlyRoute` bounces straight back.

             Stated rather than offered, for the same reason the ineligible
             branch above stops offering "Choose a time": the action cannot
             succeed, so the honest thing is to say why instead of spending the
             reader's click on finding out. */
          <p className="rounded-md border border-outline-variant bg-surface-container-low p-3 font-caption text-caption text-on-surface-variant">
            Only client accounts can book appointments. Yours is a provider
            account, so there is nothing to book here.
          </p>
        ) : (
          <>
            <Link
              to="/login"
              state={{ from: `/providers/${providerId}` }}
              className="flex h-12 w-full items-center justify-center rounded-md bg-primary font-small text-small font-medium text-on-primary transition-colors hover:bg-primary/90"
            >
              Sign in to book
            </Link>
            <p className="font-caption text-caption text-on-surface-variant">
              Sign in and you will see every time converted to your
              own timezone before you choose.
            </p>
          </>
        )}
      </div>
    )
  );
}

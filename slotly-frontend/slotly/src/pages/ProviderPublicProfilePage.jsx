/**
 * A provider's public page — `dr._sarah_jenkins_slotly_profile`.
 *
 * Transcribed from the reference: a two-thirds column holding the identity card,
 * an About Me / Qualifications bento and the services list, beside a sticky
 * one-third booking panel.
 *
 * The reference's booking panel picks a date and a time inline. Slotly's slot
 * picker is its own screen (`/providers/:id/book/:serviceId`) because it needs
 * the provider's real free/busy for a chosen service and a chosen week — so the
 * panel keeps its position and its heading, chooses the *service* itself, and
 * hands off to that screen for the date and the time rather than reimplementing
 * them here.
 *
 * Choosing the service in the panel matters more than it looks. The panel is
 * `sticky` and the services list is most of a screen below it in the left
 * column, so a read-only summary that said "pick a different one from the
 * Services list" was asking the reader to scroll away from the panel, act on a
 * row, and scroll back to a panel that had not moved — and on a phone, where the
 * panel sits *after* the whole list, it pointed backwards past everything they
 * had just scrolled through. The rows keep their Select buttons and drive the
 * same selection, so either route works and the two always agree.
 *
 * The other half of that problem is the click itself, and it is answered by
 * breakpoint. The panel is a third of the way across a desktop and often above
 * the fold the reader is looking at, so pressing Select on a row two screens
 * down changed one button's colour and nothing the reader could see — the row
 * now says where the click landed. Below `lg` there is no panel beside the list
 * at all; it falls to the foot of the page, past the reviews and the opening
 * hours, so the same press opens `BookingPanel` in a sheet instead. Both are the
 * one panel reading the one selection: nothing about what is bookable, by whom,
 * or on what terms depends on the width of the window.
 *
 * "Top Rated" and a street address are not reproduced: `GET /providers/:id`
 * returns rating aggregates only where reviews exist, and there is no address
 * column on `users`. The chips carry what is true instead — the category, and
 * whether anything is currently bookable.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import ServiceDetailsModal from "../components/provider/ServiceDetailsModal";
import BookingPanel from "../components/provider/BookingPanel";
import ServiceCover from "../components/provider/ServiceCover";
import WeeklyHoursSummary from "../components/provider/WeeklyHoursSummary";
import ProviderReviews from "../components/reviews/ProviderReviews";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import BackLink from "../components/ui/BackLink";
import EmptyState, { ErrorState, PageLoader } from "../components/ui/Feedback";
import Modal from "../components/ui/Modal";
import { container, formatPrice, formatDuration, zoneName } from "../lib/ui";
import usePageTitle from "../hooks/usePageTitle";
import useMediaQuery from "../hooks/useMediaQuery";
import {
  deliveryIcon,
  deliveryLabel,
  scopeIcon,
  isDomestic,
  judgeEligibility,
  countryLabel,
} from "../lib/serviceScope";

export default function ProviderPublicProfilePage() {
  const { providerId } = useParams();
  const { user } = useAuth();

  const [detailsService, setDetailsService] = useState(null);
  const [selectedServiceId, setSelectedServiceId] = useState(null);

  // Below `lg` the two-column layout collapses and the booking panel falls to
  // the foot of the page, under the whole services list. That is the layout the
  // sheet exists for, so it is the same breakpoint rather than a second guess at
  // where "mobile" begins — 1023.98px, so a viewport sitting exactly on 1024px
  // is desktop to both this query and Tailwind's `lg:`.
  const isNarrow = useMediaQuery("(max-width: 1023.98px)");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Whether the reader chose a service themselves, as opposed to the panel
  // opening on the first bookable one. Only a real choice is worth confirming,
  // and on load there has been no choice to confirm.
  const [pickedFromList, setPickedFromList] = useState(false);

  // Widening past `lg` puts the panel back on the right, so the sheet has
  // nothing left to do. Without this it stays armed, and dragging the window
  // narrow again would pop open a sheet for a tap made minutes ago on a layout
  // that no longer exists.
  useEffect(() => {
    if (!isNarrow) setSheetOpen(false);
  }, [isNarrow]);

  // "Compare all N services", from inside the sheet.
  //
  // The plain anchor cannot do this one on its own. Its jump runs on the click,
  // while the sheet is still up and `Modal` still has `overflow: hidden` on the
  // body — so the browser sets the hash, declines to scroll because the document
  // cannot scroll, and the sheet closes over a page that has not moved. The
  // reader is left exactly where they were, having asked to be somewhere else.
  //
  // So the jump waits for the sheet to actually go. The ref is set on the click,
  // the effect below runs after the sheet has unmounted and returned the body's
  // scrolling, and only then does the page move.
  const jumpToServices = useRef(false);

  useEffect(() => {
    if (sheetOpen || !jumpToServices.current) return;
    jumpToServices.current = false;
    // `scroll-mt-24` on the section supplies the offset for the sticky top bar,
    // the same one the anchor relied on.
    document.getElementById("services")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sheetOpen]);

  const { data, loading, error, errorCode, reload } = useApiResource(
    async ({ signal }) => {
      const [provider, services, availability] = await Promise.all([
        providersApi.get(providerId, { signal }),
        providersApi.listServices(providerId, { signal }),
        providersApi
          .getAvailability(providerId, {}, { signal })
          .catch(() => null),
      ]);
      return { provider, services, availability };
    },
    { deps: [providerId], fallback: "Could not load this provider." },
  );

  const provider = data?.provider ?? null;
  const services = data?.services ?? [];
  const availability = data?.availability ?? null;

  // Named once it is known, so a tab left open on a provider says who.
  usePageTitle(provider ? provider.business_name || provider.name : "Provider");

  // Taken from the server's answer rather than compared client-side.
  const isOwner = Boolean(provider?.isOwner);
  const canBook = user?.role === "client";

  // Selecting from a row in the list. The panel's own dropdown calls
  // `setSelectedServiceId` directly: it is already the panel, so it has nothing
  // to point at and nothing to open.
  //
  // Neither the sheet nor the desktop note fires for the owner. Their panel says
  // there is nothing to book here, and raising that over the page — or telling
  // them to go and choose a slot — would be answering a question they did not
  // ask. Selecting still works: it drives the details they came to check.
  const chooseFromList = (serviceId) => {
    setSelectedServiceId(serviceId);
    setPickedFromList(!isOwner);
    if (isNarrow && !isOwner) setSheetOpen(true);
  };

  // A retired service is visible only to its owner: it exists for reconciling
  // against booking history, and a client cannot book it.
  const visibleServices = isOwner
    ? services
    : services.filter((s) => s.isActive !== false);
  const bookable = services.filter((s) => s.isActive !== false);

  // The booking panel opens on the first bookable service, so it is never empty
  // while there is something to book.
  //
  // Derived during render rather than pushed into state by an effect. The effect
  // that used to do this ran after the first paint, so for one frame there was
  // no selection at all — which the read-only box hid behind the words "Choose a
  // service", but the dropdown that replaced it would have rendered blank, its
  // value matching none of its own options. Falling back here means the panel is
  // right on the frame it first appears, and `selectedServiceId` holds only what
  // the reader actually picked.
  const selectedService =
    bookable.find((s) => s.id === selectedServiceId) || bookable[0] || null;

  // Whether the signed-in reader may book the selected service.
  //
  // Judged locally only to choose a sentence. `POST /bookings` re-checks it
  // against the row it is about to write, and `judgeEligibility` mirrors the
  // server's permissiveness exactly — including allowing an unknown country
  // through — so the two can never disagree about who is turned away.
  const selectedEligibility = judgeEligibility({
    service: selectedService,
    clientCountry: user?.country,
    providerCountry: selectedService?.location?.country ?? data?.provider?.country ?? null,
  });

  if (loading) return <PageLoader label="Loading provider…" />;

  // An unreachable API is not a missing provider.
  //
  // Every failure used to land in the "not found" branch below, on the reasoning
  // that a page which cannot be fetched is, to the visitor, a page that is not
  // there. That holds for a 404 and for a 500, and it is plainly false when the
  // request never arrived: the API host sleeps when idle and takes the best part
  // of a minute to wake, and during that window a provider who exists was being
  // reported as deleted — with "Browse providers" as the only way on, which was
  // about to fail for exactly the same reason. So a network failure says so and
  // offers a retry, which is the action that actually resolves it, and matches
  // what the directory page already does.
  if (errorCode === "NETWORK_ERROR") {
    return (
      <div className={`${container} py-8 md:py-12`}>
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  // Anything else — a real 404, or a server that answered with an error — reads
  // as a page that is not there.
  if (error || !provider) {
    return (
      <div className={`${container} py-8 md:py-12`}>
        <EmptyState
          icon="search_off"
          title="Provider not found"
          description="This page may have been removed, or the link may be wrong."
          actionLabel="Browse providers"
          actionTo="/providers"
        />
      </div>
    );
  }

  const qualifications = String(provider.qualifications || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className={`${container} py-8 md:py-12`}>
      {/* This page hangs below the directory and has no sidebar entry, so
          without this the only way out is the browser's own back button —
          awkward on a phone, and absent entirely when the app is installed to a
          home screen. A provider reaching their own page from the dashboard has
          not come from the directory, which is why BackLink pops history when
          it can and only falls back to the list when there is none. */}
      <BackLink
        fallbackTo="/providers"
        fallbackLabel="All providers"
        className="mb-6"
      />

      <div className="flex flex-col gap-gutter lg:flex-row">
        {/* Left: main content */}
        <div className="flex w-full flex-col gap-8 lg:w-2/3">
          {isOwner && (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-outline-variant bg-surface-container-low px-6 py-4">
              <p className="flex min-w-0 flex-1 items-center gap-2 font-small text-small text-on-surface-variant">
                <Icon name="info" size={18} />
                This is your public page — what clients see.
              </p>
              <Link
                to="/profile"
                className="rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface"
              >
                Edit profile
              </Link>
              <Link
                to="/services"
                className="rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface"
              >
                Services
              </Link>
            </div>
          )}

          {/* Identity */}
          <section className="flex flex-col items-start gap-6 rounded-lg border border-outline-variant bg-surface p-6 md:flex-row md:items-center md:p-8">
            <Avatar
              src={provider.avatar_url}
              name={provider.name}
              size="2xl"
              className="h-32 w-32 border-2 border-primary-container text-3xl md:h-40 md:w-40 sm:h-32 sm:w-32"
            />

            <div className="flex min-w-0 flex-grow flex-col gap-2">
              <div>
                <h1 className="font-h1-mobile text-h1-mobile text-primary md:font-h1 md:text-h1">
                  {provider.business_name || provider.name}
                </h1>
                <p className="mt-1 font-body-lg text-body-lg text-on-surface-variant">
                  {provider.business_name ? provider.name : "Service provider"}
                </p>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-4 font-small text-small text-on-surface-variant">
                {provider.stats?.ratingAverage != null && (
                  <span className="flex items-center gap-1 text-primary">
                    <Icon name="star" size={18} fill />
                    <span className="font-bold">
                      {Number(provider.stats.ratingAverage).toFixed(1)}
                    </span>
                    <span className="ml-1 text-on-surface-variant">
                      ({provider.stats.ratingCount}{" "}
                      {provider.stats.ratingCount === 1 ? "review" : "reviews"})
                    </span>
                  </span>
                )}

                {provider.timezone && (
                  <span className="flex items-center gap-1">
                    <Icon name="public" size={18} />
                    {zoneName(provider.timezone)}
                  </span>
                )}

                {/* Beside the timezone, since the two together are the answer to
                    "where is this person". The country and not the street
                    address: the address belongs to a specific in-person service
                    and is shown on the booking panel once one is selected, but
                    the country is a fact about the practice and belongs in the
                    header. */}
                {provider.country && (
                  <span className="flex items-center gap-1">
                    <Icon name="place" size={18} />
                    {countryLabel(provider.country)}
                  </span>
                )}

                {provider.stats?.completedAppointments > 0 && (
                  <span className="flex items-center gap-1">
                    <Icon name="event_available" size={18} />
                    {provider.stats.completedAppointments} completed
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {provider.business_type && (
                  <span className="rounded-full bg-primary/10 px-3 py-1 font-caption text-caption font-bold uppercase tracking-wider text-primary">
                    {provider.business_type}
                  </span>
                )}
                <span className="rounded-full bg-surface-variant px-3 py-1 font-caption text-caption font-bold uppercase tracking-wider text-on-surface">
                  {bookable.length > 0
                    ? "Accepting bookings"
                    : "Not accepting bookings"}
                </span>
              </div>
            </div>
          </section>

          {/* About / Qualifications */}
          {(provider.bio || qualifications.length > 0) && (
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {provider.bio && (
                <div className="rounded-lg border border-outline-variant bg-surface p-6">
                  <h2 className="mb-4 flex items-center gap-2 font-h3 text-h3 text-primary">
                    <Icon name="person" size={24} />
                    About
                  </h2>
                  <p className="whitespace-pre-line font-body text-body leading-relaxed text-on-surface-variant">
                    {provider.bio}
                  </p>
                </div>
              )}

              {qualifications.length > 0 && (
                <div className="flex flex-col gap-4 rounded-lg border border-outline-variant bg-surface p-6">
                  <h2 className="mb-2 flex items-center gap-2 font-h3 text-h3 text-primary">
                    <Icon name="school" size={24} />
                    Qualifications
                  </h2>
                  <ul className="flex flex-col gap-3 font-body text-body text-on-surface-variant">
                    {qualifications.map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Icon
                          name="check_circle"
                          size={20}
                          className="mt-0.5 shrink-0 text-primary"
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Contact.
              Its own card rather than a line in the header meta row: an email
              address is long enough to wrap awkwardly beside the timezone and
              the rating, and this is something a reader comes looking for rather
              than glances at.

              Its purpose is the gap before a booking exists. Slotly's messaging
              is per-booking, so "do you treat this injury?" has nowhere to go
              until the client has already committed to a time — which is the
              wrong order. These details close that gap.

              Rendered only when there is something to render, and each row
              independently: a provider who has cleared their phone number gets
              an email row and no empty second line implying the field failed to
              load. */}
          {(provider.email || provider.phoneNumber) && (
            <section className="rounded-lg border border-outline-variant bg-surface p-6">
              <h2 className="mb-4 flex items-center gap-2 font-h3 text-h3 text-primary">
                <Icon name="contact_page" size={24} />
                Contact
              </h2>

              <dl className="flex flex-col gap-3">
                {provider.email && (
                  <div className="flex items-start gap-2">
                    <dt className="sr-only">Email</dt>
                    <Icon
                      name="mail"
                      size={20}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-on-surface-variant"
                    />
                    {/* A real mailto: link. The whole point of publishing this is
                        that a client can act on it, and an address they have to
                        select and copy is a worse version of the same thing.
                        `break-all` because a long address in a narrow column
                        otherwise pushes the card wider than the grid. */}
                    <dd className="min-w-0">
                      <a
                        href={`mailto:${provider.email}`}
                        className="break-all font-body text-body text-primary underline decoration-outline-variant underline-offset-2 transition-colors hover:decoration-primary"
                      >
                        {provider.email}
                      </a>
                    </dd>
                  </div>
                )}

                {provider.phoneNumber && (
                  <div className="flex items-start gap-2">
                    <dt className="sr-only">Phone</dt>
                    <Icon
                      name="call"
                      size={20}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-on-surface-variant"
                    />
                    <dd className="min-w-0">
                      {/* Spaces stripped from the href only. A stored
                          "+44 20 7946 0000" is what a person should read, and
                          "+442079460000" is what a dialler needs — so the label
                          keeps the formatting and the link does not. */}
                      <a
                        href={`tel:${String(provider.phoneNumber).replace(/\s+/g, "")}`}
                        className="font-body text-body text-primary underline decoration-outline-variant underline-offset-2 transition-colors hover:decoration-primary"
                      >
                        {provider.phoneNumber}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              {/* Said plainly, because a client who emails about a booking they
                  have already made will otherwise wonder why nobody replied on
                  the thread they were pointed at. */}
              <p className="mt-4 font-caption text-caption text-on-surface-variant">
                For questions before you book. Once you have an appointment, message
                {provider.business_name ? ` ${provider.business_name}` : " them"} about it from
                the appointment itself — that thread stays attached to the booking.
              </p>
            </section>
          )}

          {/* Services.

              `id` because the booking panel links here: the panel's dropdown
              carries each service's name and price, but the description, the
              cover photo and the full details live in these rows, so someone
              deciding between two services still needs a way down to them.

              `scroll-mt-24` matches the offset the panel uses to clear the
              sticky top bar. Without it the browser aligns the heading with the
              very top of the viewport and the bar covers it, so the jump lands
              on a section whose title you cannot see. */}
          <section
            id="services"
            className="scroll-mt-24 overflow-hidden rounded-lg border border-outline-variant bg-surface"
          >
            <div className="border-b border-outline-variant bg-surface-bright p-6">
              <h2 className="font-h2 text-h2 text-primary">Services</h2>
            </div>

            {visibleServices.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  compact
                  icon="category"
                  title={
                    isOwner
                      ? "You have not added any services yet"
                      : "No services listed yet"
                  }
                  description={
                    isOwner
                      ? "Add a service with a duration and a price, and clients can start booking it."
                      : "This provider has not published anything bookable yet."
                  }
                  {...(isOwner
                    ? {
                        actionLabel: "Add your first service",
                        actionTo: "/services",
                      }
                    : {})}
                />
              </div>
            ) : (
              <div className="divide-y divide-outline-variant">
                {visibleServices.map((service) => {
                  const retired = service.isActive === false;
                  const selected = service.id === selectedService?.id;

                  return (
                    <div
                      key={service.id}
                      className="group p-6 transition-colors hover:bg-surface-bright"
                    >
                      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                        {/* The service's own cover, which this list previously did
                            not draw at all — a provider could upload one, see it on
                            their management page, and find it nowhere on the page
                            clients actually read. Landscape rather than the square
                            tile used in the management grid, because these rows are
                            wide and a photo of a room reads better than a crop of
                            it. `ServiceCover` supplies the glyph for a service with
                            no cover, so rows stay aligned either way. */}
                        <div className="flex min-w-0 flex-grow items-start gap-4">
                          <ServiceCover
                            coverImage={service.coverImage}
                            name={service.name}
                            iconSize={32}
                            // 148x92, measured off the reference. Exact pixels
                            // rather than a spacing-scale pair, because the
                            // design's 1.6:1 landscape crop does not land on any
                            // two steps of the scale, and rounding it to
                            // h-24/w-36 would visibly shorten the thumbnail
                            // against the three lines of text beside it.
                            //
                            // The radius stays on the token scale even though the
                            // dimensions do not: the reference corner is about
                            // 6px, this theme jumps 4px -> 8px, and 8px is both
                            // the closer of the two and a value the rest of the
                            // app already uses. A one-off 6px would be an
                            // invented token for a difference nobody can see.
                            className="h-[92px] w-[148px] rounded-lg"
                          />

                          <div className="min-w-0 flex-grow">
                            <h3 className="mb-1 font-h3 text-[20px] font-semibold text-primary">
                              {service.name}
                            </h3>
                            {/* Two lines, matching the reference. A service with a
                                long description used to push the price and the
                                Select button hundreds of pixels down the page and
                                swamp every other service in the list — the one
                                thing a list of services exists to let you compare.
                                `Details` opens the full text. */}
                            {service.description && (
                              <p className="mb-2 line-clamp-2 font-body text-body text-on-surface-variant">
                                {service.description}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-4 font-small text-small text-on-surface-variant">
                              <span className="flex items-center gap-1">
                                <Icon name="schedule" size={16} />
                                {formatDuration(service.duration)}
                              </span>
                              {/* In the meta row rather than as a separate line,
                                  because "where" and "how long" are the same kind
                                  of fact about a service and a client comparing
                                  three of them reads them together. */}
                              <span className="flex items-center gap-1">
                                <Icon name={deliveryIcon(service.deliveryType)} size={16} />
                                {deliveryLabel(service.deliveryType)}
                              </span>
                              {isDomestic(service) && (
                                <span className="flex items-center gap-1">
                                  <Icon name={scopeIcon(service.bookingScope)} size={16} />
                                  {countryLabel(service.location?.country ?? provider.country) ||
                                    "One country"}{" "}
                                  only
                                </span>
                              )}
                              {/* Drawn as a sibling of the duration above, because
                                  that is what it sits beside in the reference. It
                                  used to carry a permanent underline that ran
                                  under the icon as well as the label, which read
                                  as a stray hyperlink rather than part of the meta
                                  row.

                                  The underline moves to hover instead of
                                  disappearing: this is the only control in the
                                  row, and with no affordance at all it would look
                                  like the static text it now matches. Only the
                                  label is underlined, never the glyph. */}
                              <button
                                type="button"
                                onClick={() => setDetailsService(service)}
                                aria-label={`See full details of ${service.name}`}
                                className="group/details flex cursor-pointer items-center gap-1 rounded transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                              >
                                <Icon name="info" size={16} />
                                <span className="underline-offset-2 group-hover/details:underline">
                                  Details
                                </span>
                              </button>
                              {retired && (
                                <span className="rounded-full bg-surface-variant px-2 py-0.5 font-caption text-caption font-bold uppercase tracking-wider">
                                  Inactive
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex w-full min-w-[120px] flex-col items-end gap-3 sm:w-auto">
                          <span className="font-h3 text-[22px] font-bold text-primary">
                            {formatPrice(service.price, service.currency)}
                          </span>

                          {retired ? (
                            <span className="font-caption text-caption text-on-surface-variant">
                              No longer offered
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => chooseFromList(service.id)}
                              className={`h-10 w-full rounded-md font-small text-small font-medium transition-colors ${
                                selected
                                  ? "bg-primary text-on-primary hover:bg-primary/90"
                                  : "border border-primary bg-transparent text-primary hover:bg-surface-variant"
                              }`}
                            >
                              {selected ? "Selected" : "Select"}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Desktop only, and only for a service the reader chose
                          themselves. The panel that reacted to the click is a
                          third of the way across the page and often above the
                          fold the reader is looking at, so on a wide screen the
                          only feedback for a click down here was a button
                          changing colour. This says where the click landed.

                          Below `lg` there is no panel on the right to point at —
                          the sheet has already opened over this row — so it is
                          hidden rather than reworded. */}
                      {selected && pickedFromList && (
                        <p className="mt-4 hidden items-center gap-2 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 font-small text-small text-on-surface-variant lg:flex">
                          <Icon name="check_circle" size={16} className="shrink-0 text-primary" />
                          Service selected — use the Book an Appointment panel on
                          the right to choose your slot.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <ProviderReviews
            providerId={providerId}
            providerName={provider.business_name || provider.name}
            isOwner={isOwner}
            // Reviews are timestamps, so they follow the reader's own zone like
            // every other instant in the app. A guest with no saved zone gets the
            // provider's, which is the most meaningful default on this page.
            viewerZone={user?.timezone || provider.timezone || "UTC"}
          />
        </div>

        {/* Right: sticky booking panel */}
        <div className="w-full lg:w-1/3">
          <div className="sticky top-24 flex flex-col gap-6">
            <div className="rounded-lg border border-outline-variant bg-surface p-6 shadow-float">
              <h3 className="mb-4 font-h3 text-[20px] font-bold text-primary">
                Book an Appointment
              </h3>

              <BookingPanel
                bookable={bookable}
                selectedService={selectedService}
                onSelectService={setSelectedServiceId}
                eligibility={selectedEligibility}
                provider={provider}
                providerId={providerId}
                isOwner={isOwner}
                canBook={canBook}
              />
            </div>

            {availability && <WeeklyHoursSummary availability={availability} />}
          </div>
        </div>
      </div>

      {/* The mobile answer to a tap on Select.

          Below `lg` the booking panel is not beside the list, it is after it —
          past every service, the reviews and the weekly hours. A reader who
          tapped Select got a button that changed colour and nothing else, and
          had no way to know that the thing they had just chosen was waiting a
          screen and a half further down. The sheet brings that panel to the tap.

          The same `Modal` every other dialog uses, so it is already a sheet on a
          narrow screen — bottom-anchored, full width, rounded at the top — with
          the focus trap, the Escape key, the backdrop and the close button that
          come with it, and nothing new to keep in step with them.

          Mounted only while `isNarrow`, not hidden with a class: this is a focus
          trap that locks body scroll, so a hidden copy on a desktop would still
          swallow Tab and freeze the page behind it.

          It renders the same `BookingPanel` off the same props as the panel
          below, so there is one selection and one CTA — the sheet is a second
          view of the panel, not a second panel. */}
      {isNarrow && (
        <Modal
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Book an Appointment"
          size="lg"
        >
          <BookingPanel
            bookable={bookable}
            selectedService={selectedService}
            onSelectService={setSelectedServiceId}
            eligibility={selectedEligibility}
            provider={provider}
            providerId={providerId}
            isOwner={isOwner}
            canBook={canBook}
            onCompare={(event) => {
              event.preventDefault();
              jumpToServices.current = true;
              setSheetOpen(false);
            }}
            // The panel at the foot of the page is in the document at the same
            // time as this one, and two `booking-service` ids would tie both
            // labels to the same select.
            fieldId="sheet-booking-service"
          />
        </Modal>
      )}

      <ServiceDetailsModal
        service={detailsService}
        provider={provider}
        providerId={providerId}
        canBook={canBook}
        isOwner={false}
        onClose={() => setDetailsService(null)}
        onEdit={() => setDetailsService(null)}
      />
    </div>
  );
}

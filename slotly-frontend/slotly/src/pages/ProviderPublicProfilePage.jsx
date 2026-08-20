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
 * panel keeps its position, its heading and its summary of the selected service,
 * and hands off to that screen rather than reimplementing it here.
 *
 * "Top Rated" and a street address are not reproduced: `GET /providers/:id`
 * returns rating aggregates only where reviews exist, and there is no address
 * column on `users`. The chips carry what is true instead — the category, and
 * whether anything is currently bookable.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import ServiceDetailsModal from "../components/provider/ServiceDetailsModal";
import ServiceCover from "../components/provider/ServiceCover";
import WeeklyHoursSummary from "../components/provider/WeeklyHoursSummary";
import ProviderReviews from "../components/reviews/ProviderReviews";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import BackLink from "../components/ui/BackLink";
import EmptyState, { PageLoader } from "../components/ui/Feedback";
import { container, formatPrice, formatDuration, zoneName } from "../lib/ui";

export default function ProviderPublicProfilePage() {
  const { providerId } = useParams();
  const { user } = useAuth();

  const [detailsService, setDetailsService] = useState(null);
  const [selectedServiceId, setSelectedServiceId] = useState(null);

  const { data, loading, error } = useApiResource(
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

  // Taken from the server's answer rather than compared client-side.
  const isOwner = Boolean(provider?.isOwner);
  const canBook = user?.role === "client";

  // A retired service is visible only to its owner: it exists for reconciling
  // against booking history, and a client cannot book it.
  const visibleServices = isOwner
    ? services
    : services.filter((s) => s.isActive !== false);
  const bookable = services.filter((s) => s.isActive !== false);

  // The booking panel opens on the first bookable service, so it is never empty
  // while there is something to book.
  useEffect(() => {
    if (selectedServiceId == null && bookable.length > 0)
      setSelectedServiceId(bookable[0].id);
  }, [bookable, selectedServiceId]);

  const selectedService =
    bookable.find((s) => s.id === selectedServiceId) || null;

  if (loading) return <PageLoader label="Loading provider…" />;

  // Any failure lands here, not only a 404. A provider page that cannot be
  // fetched is, from the visitor's point of view, a page that is not there.
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

          {/* Services */}
          <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface">
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
                  const selected = service.id === selectedServiceId;

                  return (
                    <div
                      key={service.id}
                      className="group flex flex-col items-start justify-between gap-4 p-6 transition-colors hover:bg-surface-bright sm:flex-row sm:items-center"
                    >
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
                            onClick={() => setSelectedServiceId(service.id)}
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

              {bookable.length === 0 ? (
                <p className="font-body text-body text-on-surface-variant">
                  Nothing is bookable here yet.
                </p>
              ) : (
                <div className="space-y-5">
                  <div>
                    <p className="mb-1 block font-small text-small font-medium text-on-surface">
                      Selected Service
                    </p>
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
                    <p className="mt-2 font-caption text-caption text-on-surface-variant">
                      Pick a different one from the Services list.
                    </p>
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
                    </dl>
                  )}

                  {isOwner ? (
                    <p className="rounded-md border border-outline-variant bg-surface-container-low p-3 font-caption text-caption text-on-surface-variant">
                      This is your own page, so there is nothing to book here.
                    </p>
                  ) : canBook && selectedService ? (
                    <Link
                      to={`/providers/${providerId}/book/${selectedService.id}`}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary font-small text-small font-medium text-on-primary transition-colors hover:bg-primary/90"
                    >
                      Choose a time
                      <Icon name="arrow_forward" size={18} />
                    </Link>
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
              )}
            </div>

            {availability && <WeeklyHoursSummary availability={availability} />}
          </div>
        </div>
      </div>

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

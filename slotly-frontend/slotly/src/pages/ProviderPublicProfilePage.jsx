//A provider's public page: who they are, what they offer, and when they work.


import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import ProviderHeader from "../components/provider/ProviderHeader";
import ServiceCard from "../components/provider/ServiceCard";
import ServiceDetailsModal from "../components/provider/ServiceDetailsModal";
import WeeklyHoursSummary from "../components/provider/WeeklyHoursSummary";
import ProviderReviews from "../components/reviews/ProviderReviews";
import Page, { Section, SplitLayout } from "../components/ui/Page";
import Icon from "../components/ui/Icon";
import EmptyState, { PageLoader } from "../components/ui/Feedback";
import { primaryButton, secondaryButton, buttonSm } from "../lib/ui";

export default function ProviderPublicProfilePage() {
  const { providerId } = useParams();
  const { user } = useAuth();

  // The service whose details modal is open. Holds the object straight from
  const [detailsService, setDetailsService] = useState(null);

  const { data, loading, error } = useApiResource(
    async ({ signal }) => {
      const [provider, services, availability] = await Promise.all([
        providersApi.get(providerId, { signal }),
        providersApi.listServices(providerId, { signal }),
        providersApi.getAvailability(providerId, {}, { signal }).catch(() => null),
      ]);
      return { provider, services, availability };
    },
    { deps: [providerId], fallback: "Could not load this provider." }
  );

  const provider = data?.provider ?? null;
  const services = data?.services ?? [];
  const availability = data?.availability ?? null;

  if (loading) return <PageLoader label="Loading provider…" />;

  // Any failure lands here, not only a 404. A provider page that cannot be
  // fetched is, from the visitor's point of view, a page that is not there.
  if (error || !provider) {
    return (
      <Page narrow>
        <EmptyState
          icon="search"
          title="Provider not found"
          description="This page may have been removed, or the link may be wrong."
          actionLabel="Browse providers"
          actionTo="/providers"
        />
      </Page>
    );
  }

  // Taken from the server's answer rather than compared client-side, so the
  const isOwner = Boolean(provider.isOwner);
  const canBook = user?.role === "client";

  // A retired service is visible only to its owner: it exists for reconciling
  // against booking history, and a client cannot book it.
  const visibleServices = isOwner ? services : services.filter((s) => s.is_active !== false);
  const bookableCount = services.filter((s) => s.is_active !== false).length;

  return (
    <Page className="space-y-4">
      <ProviderHeader provider={provider} isOwner={isOwner} />

      {isOwner && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand-line bg-brand-soft px-3.5 py-2.5">
          <p className="flex min-w-0 flex-1 items-center gap-2 text-[0.8125rem] text-brand-ink">
            <Icon name="info" size={15} />
            This is your public page — what clients see. Edit it from Services and Availability.
          </p>
          <Link to="/services" className={`${secondaryButton} ${buttonSm}`}>
            <Icon name="tag" size={14} />
            Services
          </Link>
          <Link to="/availability" className={`${secondaryButton} ${buttonSm}`}>
            <Icon name="clock" size={14} />
            Availability
          </Link>
        </div>
      )}

      <SplitLayout
        aside={
          <>
            {availability && <WeeklyHoursSummary availability={availability} />}

            {// Only for a signed-out visitor who has something to book. 
            }
            {!isOwner && !user && bookableCount > 0 && (
              <Section title="Ready to book?" flush>
                <div className="px-3 py-3">
                  <p className="text-xs leading-relaxed text-ink-2">
                    Sign in and you will see every time converted to your own timezone before you
                    choose.
                  </p>
                  <Link
                    to="/login"
                    state={{ from: `/providers/${providerId}` }}
                    className={`mt-2.5 ${primaryButton} ${buttonSm} w-full`}
                  >
                    Sign in or create an account
                  </Link>
                </div>
              </Section>
            )}
          </>
        }
      >
        <Section
          headingId="services-heading"
          title="Services"
          description={
            bookableCount > 0
              ? `${bookableCount} bookable${isOwner && services.length > bookableCount ? ` · ${services.length - bookableCount} retired` : ""}`
              : undefined
          }
          actions={
            isOwner && (
              <Link to="/services" className={`${secondaryButton} ${buttonSm}`}>
                <Icon name="plus" size={14} />
                Add
              </Link>
            )
          }
        >
          {visibleServices.length === 0 ? (
            <EmptyState
              compact
              icon="tag"
              title={isOwner ? "You have not added any services yet" : "No services listed yet"}
              description={
                isOwner
                  ? "Add a service with a duration and a price, and clients can start booking it."
                  : "This provider has not published anything bookable yet."
              }
              {...(isOwner
                ? { actionLabel: "Add your first service", actionTo: "/services" }
                : {})}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleServices.map((service) => (
                <li key={service.id}>
                  <ServiceCard
                    service={service}
                    
                    isOwner={false}
                    providerId={providerId}
                    canBook={canBook}
                    onViewDetails={setDetailsService}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <ProviderReviews
          providerId={providerId}
          providerName={provider.business_name || provider.name}
          isOwner={isOwner}
          // Reviews are timestamps, so they follow the reader's own zone like every
          // other instant in the app. A guest with no saved zone gets the
          // provider's, which is the most meaningful default on this page.
          viewerZone={user?.timezone || provider.timezone || "UTC"}
        />
      </SplitLayout>

      <ServiceDetailsModal
        service={detailsService}
        provider={provider}
        providerId={providerId}
        canBook={canBook}
        isOwner={false}
        onClose={() => setDetailsService(null)}
        onEdit={() => setDetailsService(null)}
      />
    </Page>
  );
}

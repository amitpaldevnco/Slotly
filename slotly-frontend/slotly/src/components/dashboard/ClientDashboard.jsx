//  The client's dashboard: what is coming up, and what already happened.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as bookingsApi from "../../api/bookings";
import { useApiResource } from "../../hooks/useApiResource";
import BookingCard from "../bookings/BookingCard";
import NextAppointmentCard from "./NextAppointmentCard";
import Icon from "../ui/Icon";
import Page, { PageHeader, Section, SplitLayout } from "../ui/Page";
import { SegmentedControl } from "../ui/Tabs";
import EmptyState, { ErrorState, SkeletonRows } from "../ui/Feedback";
import Pagination, { usePagination } from "../ui/Pagination";
import {
  primaryButton,
  secondaryButton,
  buttonSm,
  chipClasses,
  linkClasses,
  highlightPill,
  zoneName,
} from "../../lib/ui";

const TABS = [
  { id: "upcoming", label: "Upcoming", icon: "calendar" },
  { id: "past", label: "Past", icon: "clock" },
];

/** Bookings per page. Ten compact rows is about one screen on a laptop. */
const PAGE_SIZE = 10;

export default function ClientDashboard({ user }) {
  const [tab, setTab] = useState("upcoming");


  const [counts, setCounts] = useState({});

  const { data, loading, error, reload } = useApiResource(
    ({ signal }) => bookingsApi.list({ scope: tab }, { signal }),
    { deps: [tab], fallback: "Could not load your bookings." }
  );

  const bookings = data?.bookings ?? [];

  useEffect(() => {
    if (data) setCounts((current) => ({ ...current, [tab]: data.bookings.length }));
  }, [data, tab]);

  const { data: unreadData } = useApiResource(
    ({ signal }) => bookingsApi.unreadCount({ signal }).catch(() => null),
    { deps: [] }
  );
  const unread = unreadData?.unread ?? 0;


  const nextAppointment = tab === "upcoming" && !loading && bookings.length > 0 ? bookings[0] : null;
  const restOfList = nextAppointment ? bookings.slice(1) : bookings;

  const { pageItems, page, pageCount, setPage, total, from, to } = usePagination(
    restOfList,
    PAGE_SIZE
  );

  const firstName = user.name?.split(" ")[0];

  return (
    <Page>
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : "Your bookings"}
        description="Every appointment you have booked, across every provider."
        meta={
          user.timezone && (
            <span className={chipClasses}>
              <Icon name="globe" size={12} />
              {zoneName(user.timezone)}
            </span>
          )
        }
        actions={
          <Link to="/providers" className={primaryButton}>
            <Icon name="plus" size={15} />
            Book an appointment
          </Link>
        }
      />

      <SplitLayout
        aside={
          <>
            {unread > 0 && (
              <Section title="Messages" flush>
                <div className="px-3 py-3">
                  <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-ink-2">
                    <Icon name="message" size={15} className="mt-0.5 text-highlight-ink" />
                    <span>
                      <span className={highlightPill}>
                        {unread} unread
                      </span>{" "}
                      <span className="block pt-1">
                        Open a booking below to read {unread === 1 ? "it" : "them"}.
                      </span>
                    </span>
                  </p>
                </div>
              </Section>
            )}

            <Section title="Your timezone" flush>
              <div className="px-3 py-3">
                <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink">
                  <Icon name="globe" size={15} className="text-ink-3" />
                  {zoneName(user.timezone) || "Not set"}
                </p>
              
                <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
                  Every time on this page is converted to it.{" "}
                  <Link to="/profile" className={linkClasses}>
                    Change it
                  </Link>
                </p>
              </div>
            </Section>

            <Section title="Book again" flush>
              <div className="px-3 py-3">
                <p className="text-xs leading-relaxed text-ink-3">
                  Browse providers by name, business or category.
                </p>
                <Link to="/providers" className={`mt-2.5 ${secondaryButton} ${buttonSm} w-full`}>
                  <Icon name="search" size={14} />
                  Find a provider
                </Link>
              </div>
            </Section>
          </>
        }
      >
        {nextAppointment && (
          <NextAppointmentCard booking={nextAppointment} viewerZone={user.timezone || "UTC"} />
        )}

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl
              label="Booking history"
              panelId="bookings-panel"
              value={tab}
              onChange={setTab}
              options={TABS.map((option) => ({ ...option, count: counts[option.id] }))}
            />
          </div>

          <div
            id="bookings-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            
            aria-busy={loading}
          >
            {loading ? (
              <SkeletonRows count={4} />
            ) : error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : bookings.length === 0 ? (
              <EmptyState
                icon={tab === "upcoming" ? "calendar" : "clock"}
                title={tab === "upcoming" ? "Nothing booked yet" : "No past appointments"}
                description={
                  tab === "upcoming"
                    ? "Find a provider, pick a service and choose a time that works for you."
                    : "Appointments show up here once they are done or cancelled."
                }
                {...(tab === "upcoming"
                  ? { actionLabel: "Find a provider", actionTo: "/providers" }
                  : {})}
              />
            ) : restOfList.length === 0 ? (
              // The only booking is already shown as the hero above, so repeating
              // it in a list of one would read as a duplicate.
              <p className="rounded-lg border border-dashed border-line bg-surface/60 px-4 py-5 text-center text-[0.8125rem] text-ink-2">
                That is your only upcoming appointment.
              </p>
            ) : (
              <>
                {nextAppointment && (
                  <h2 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    Later
                  </h2>
                )}
                <ul className="space-y-2">
                  {pageItems.map((booking) => (
                    <li key={booking.id}>
                      <BookingCard booking={booking} viewerRole="client" />
                    </li>
                  ))}
                </ul>
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  onChange={setPage}
                  total={total}
                  from={from}
                  to={to}
                  unit="appointment"
                  className="mt-3"
                />
              </>
            )}
          </div>
        </div>
      </SplitLayout>
    </Page>
  );
}

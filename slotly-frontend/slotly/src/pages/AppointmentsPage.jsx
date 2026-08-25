/**
 * Appointments.
 *
 * Two presentations of one screen, both transcribed from the reference: a
 * provider gets the twelve-column table from `manage_appointments`, a client
 * gets the stacked cards from `my_appointments`. Everything above the list — the
 * heading, the search box, the Filter disclosure and the underlined tabs — is
 * shared, because both reference screens draw it identically.
 *
 * The tabs map onto query parameters `GET /bookings` already accepts:
 * Upcoming is `scope=upcoming`, Past and Cancelled are `scope=`/`status=`.
 * Nothing is filtered in the browser that the server could filter itself, and no
 * new endpoint was needed for any of it.
 *
 * ## Why "Past" and not "Completed"
 *
 * It used to be `status=completed`, and that quietly lost appointments. A
 * booking has five statuses, and `no_show` is one of them — but no tab asked for
 * it, so once a provider recorded a no-show the appointment vanished from this
 * screen for *both* parties. Not archived, not filtered out on purpose: simply
 * unreachable, while still sitting in the database and still counting towards
 * the provider's totals elsewhere in the app.
 *
 * `scope=past` is the server's own answer to "everything that has already
 * happened", so it covers completed and no-show together and cannot drift out of
 * step the next time a status is added. The tab is named for what it contains.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as bookingsApi from "../api/bookings";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import RescheduleDialog from "../components/bookings/RescheduleDialog";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import { Select } from "../components/ui/Field";
import EmptyState, { ErrorState, SkeletonRows } from "../components/ui/Feedback";
import { usePagination } from "../components/ui/Pagination";
import { formatDateTime, formatTime } from "../lib/time";
import {
  container,
  statusStyle,
  formatPrice,
  formatDuration,
  inputClasses,
} from "../lib/ui";
import usePageTitle from "../hooks/usePageTitle";

/**
 * The three tabs, and the query each one stands for.
 *
 * `past` deliberately asks for a *scope* rather than a status: it has to include
 * `no_show` as well as `completed`, and letting the server decide what "past"
 * means keeps this list from having to be updated every time the status set
 * changes. `completed` alone is what used to hide every no-show appointment.
 *
 * The id is what appears in the URL, so it is kept stable and readable — the
 * `?tab=` parameter is something people bookmark and paste to each other.
 */
const TABS = [
  { id: "upcoming", label: "Upcoming", params: { scope: "upcoming" } },
  { id: "past", label: "Past", params: { scope: "past" } },
  { id: "cancelled", label: "Cancelled", params: { status: "cancelled" } },
];

const PAGE_SIZE = 10;

export default function AppointmentsPage() {
  usePageTitle("Appointments");

  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isProvider = user?.role === "provider";
  const viewerZone = user?.timezone || "UTC";

  const tab = TABS.some((option) => option.id === searchParams.get("tab"))
    ? searchParams.get("tab")
    : "upcoming";

  const [term, setTerm] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ serviceId: "", from: "", to: "" });
  const [rescheduling, setRescheduling] = useState(null);

  const search = useDebouncedValue(term.trim().toLowerCase(), 250);

  // A provider's service list drives the Filter panel's service dropdown. The
  // client has no equivalent, so the request is skipped for them entirely.
  const { data: services } = useApiResource(
    ({ signal }) => providersApi.listServices(user.id, { signal }).catch(() => []),
    { enabled: isProvider && Boolean(user?.id), deps: [user?.id], initialData: [] }
  );

  const { data, loading, error, reload } = useApiResource(
    ({ signal }) => {
      const params = { ...TABS.find((option) => option.id === tab).params };
      // Empty filters are dropped rather than sent as blanks, which the API
      // would otherwise have to interpret.
      for (const [key, value] of Object.entries(filters)) {
        if (value !== "") params[key] = value;
      }
      return bookingsApi.list(params, { signal });
    },
    { deps: [tab, filters], fallback: "Could not load your appointments." }
  );

  // Memoised because it feeds a `useMemo` below; a fresh `[]` on every render
  // would make that filter re-run on every render too.
  const bookings = useMemo(() => data?.bookings ?? [], [data]);

  // The reference puts a search box on this screen. `GET /bookings` has no text
  // parameter, so this narrows the page that has already been fetched rather
  // than pretending to query the server.
  const visible = useMemo(() => {
    if (!search) return bookings;
    return bookings.filter((booking) => {
      const other = isProvider ? booking.client : booking.provider;
      return (
        (other?.name || "").toLowerCase().includes(search) ||
        (other?.businessName || "").toLowerCase().includes(search) ||
        (booking.service?.name || "").toLowerCase().includes(search)
      );
    });
  }, [bookings, search, isProvider]);

  // Whether this client has ever booked anything — which decides whether the
  // empty Upcoming tab reads "your first appointment" or "your next one". The
  // tab's own request cannot answer it: it returns what is upcoming, which is
  // nothing in both cases. So the history is asked for separately, and only when
  // it is needed — a client, on Upcoming, with an empty list and no search term.
  const needsHistory =
    !isProvider && tab === "upcoming" && !loading && !error && !search && visible.length === 0;

  const { data: historyData, loading: historyLoading } = useApiResource(
    ({ signal }) => bookingsApi.list({ scope: "past" }, { signal }).catch(() => ({ bookings: [] })),
    { enabled: needsHistory }
  );

  const hasHistory = (historyData?.bookings?.length ?? 0) > 0;

  // Counts for every tab, not just the open one. Re-read when the open tab's
  // data changes, because acting on a booking — cancelling it, moving it — moves
  // it between tabs, and a stale badge is worse than none.
  const { data: tabCounts } = useApiResource(
    ({ signal }) => bookingsApi.counts({ signal }).catch(() => null),
    { deps: [data] }
  );

  const {
    pageItems,
    page,
    setPage,
    pageCount,
    total,
    from: firstRow,
    to: lastRow,
  } = usePagination(visible, PAGE_SIZE);

  // A tab or filter change should start the reader at the top of the new list,
  // not on page four of it. The hook clamps an out-of-range page but has no way
  // of knowing that the list underneath it is a different list.
  useEffect(() => {
    setPage(1);
  }, [tab, search, filters, setPage]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id === "upcoming") next.delete("tab");
    else next.set("tab", id);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className={`${container} py-margin-mobile md:py-margin-desktop`}>
      {/* Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          {/* `h1`, not `h2`. This is the page's own name, and it was the only
              heading on the screen -- so the document started at level 2 and a
              screen reader's heading list had no top level to anchor on. */}
          <h1 className="font-h2 text-h2 font-bold text-primary">Appointments</h1>
          <p className="mt-1 font-body text-body text-on-surface-variant">
            {isProvider
              ? "Manage your upcoming schedule and client bookings."
              : "Manage your bookings and schedule."}
          </p>
        </div>

        <div className="flex w-full items-center gap-3 md:w-auto">
          <div className="relative flex-1 md:w-64">
            <label htmlFor="appointment-search" className="sr-only">
              Search appointments
            </label>
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              id="appointment-search"
              type="text"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search appointments..."
              className={`${inputClasses} h-10 pl-9`}
            />
          </div>

          {isProvider && (
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              // The word "Filter" is hidden below md, so on a phone this button
              // is an icon and a number — nothing a screen reader can read. The
              // label is unconditional rather than conditional on the breakpoint,
              // because an accessible name that only exists at some widths is
              // the harder bug to notice.
              aria-label={
                activeFilterCount > 0
                  ? `Filter appointments (${activeFilterCount} active)`
                  : "Filter appointments"
              }
              className="flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-outline-variant bg-surface px-4 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
            >
              <Icon name="filter_list" size={18} />
              <span className="hidden md:inline">Filter</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-caption text-[10px] font-bold text-on-primary">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Filter panel — the design's Filter button, opened. Holds the service and
          date-range parameters `GET /bookings` accepts. */}
      {isProvider && filtersOpen && (
        <div className="mb-6 grid gap-4 rounded-lg border border-outline-variant bg-surface p-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="filter-service"
              className="mb-2 block font-caption text-caption font-bold uppercase tracking-wider text-on-surface-variant"
            >
              Service
            </label>
            <Select
              id="filter-service"
              value={filters.serviceId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, serviceId: event.target.value }))
              }
            >
              <option value="">All services</option>
              {(services ?? []).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                  {service.isActive === false ? " (retired)" : ""}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              htmlFor="filter-from"
              className="mb-2 block font-caption text-caption font-bold uppercase tracking-wider text-on-surface-variant"
            >
              From
            </label>
            <input
              id="filter-from"
              type="date"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({ ...current, from: event.target.value }))
              }
              className={inputClasses}
            />
          </div>

          <div>
            <label
              htmlFor="filter-to"
              className="mb-2 block font-caption text-caption font-bold uppercase tracking-wider text-on-surface-variant"
            >
              To
            </label>
            <input
              id="filter-to"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
              className={inputClasses}
            />
          </div>

          {activeFilterCount > 0 && (
            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={() => setFilters({ serviceId: "", from: "", to: "" })}
                className="cursor-pointer font-small text-small font-semibold text-primary underline underline-offset-2"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="no-scrollbar mb-6 flex overflow-x-auto border-b border-outline-variant">
        {TABS.map((option) => {
          const active = option.id === tab;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => selectTab(option.id)}
              aria-current={active ? "page" : undefined}
              className={`cursor-pointer whitespace-nowrap border-b-2 px-6 py-3 font-small text-small transition-colors ${
                active
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-on-surface-variant hover:text-primary"
              }`}
            >
              {option.label}
              {/* The open tab shows what is actually on screen, which the
                  search box can narrow; the others show their server-side
                  total. Using `visible.length` for the open tab keeps the
                  number honest while filtering. */}
              {active
                ? !loading && ` (${visible.length})`
                : tabCounts && ` (${tabCounts[option.id] ?? 0})`}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <SkeletonRows count={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : visible.length === 0 ? (
        // Held back until the history lands, so a returning client does not
        // watch "your first appointment" turn into "your next one".
        needsHistory && historyLoading ? (
          <SkeletonRows count={2} />
        ) : (
          <NoAppointments
            tab={tab}
            isProvider={isProvider}
            searching={Boolean(search)}
            hasHistory={hasHistory}
          />
        )
      ) : isProvider ? (
        <ProviderTable
          bookings={pageItems}
          viewerZone={viewerZone}
          total={total}
          firstRow={firstRow}
          lastRow={lastRow}
          page={page}
          pageCount={pageCount}
          onPage={setPage}
          onReschedule={setRescheduling}
        />
      ) : (
        <ClientCards
          bookings={pageItems}
          viewerZone={viewerZone}
          total={total}
          firstRow={firstRow}
          lastRow={lastRow}
          page={page}
          pageCount={pageCount}
          onPage={setPage}
        />
      )}

      {/* The provider's reschedule flow, unchanged — the same dialog the booking
          detail page opens, reached from the row's own icon. */}
      <RescheduleDialog
        open={Boolean(rescheduling)}
        booking={rescheduling}
        onClose={() => setRescheduling(null)}
        onRescheduled={() => {
          setRescheduling(null);
          reload();
        }}
      />
    </div>
  );
}

/* ==========================================================================
 * The provider's table — `manage_appointments`
 * ========================================================================== */

function ProviderTable({
  bookings,
  viewerZone,
  total,
  firstRow,
  lastRow,
  page,
  pageCount,
  onPage,
  onReschedule,
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface">
      {/* Header row. Hidden below `md`, where each record becomes a stacked
          block and column headings have nothing to sit above. */}
      <div className="hidden grid-cols-12 gap-4 border-b border-outline-variant bg-surface-container-lowest p-4 font-caption text-caption uppercase tracking-wider text-on-surface-variant md:grid">
        <div className="col-span-3">Client</div>
        <div className="col-span-3">Service</div>
        <div className="col-span-2">Date &amp; Time</div>
        <div className="col-span-1">Details</div>
        <div className="col-span-1">Status</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>

      <div className="divide-y divide-outline-variant">
        {bookings.map((booking) => (
          <ProviderRow
            key={booking.id}
            booking={booking}
            viewerZone={viewerZone}
            onReschedule={onReschedule}
          />
        ))}
      </div>

      <ListFooter
        total={total}
        firstRow={firstRow}
        lastRow={lastRow}
        page={page}
        pageCount={pageCount}
        onPage={onPage}
      />
    </div>
  );
}

function ProviderRow({ booking, viewerZone, onReschedule }) {
  const status = statusStyle(booking.status);
  const client = booking.client;
  const canReschedule = booking.status === "booked" || booking.status === "rescheduled";

  return (
    <div className="group grid grid-cols-12 items-center gap-4 p-4 transition-colors hover:bg-surface-container-lowest">
      <div className="col-span-12 flex items-center gap-3 md:col-span-3">
        <Avatar
          src={client.avatarUrl}
          name={client.name}
          size="md"
          className="border border-outline-variant"
        />
        <div className="min-w-0">
          <p className="truncate font-small text-small font-semibold text-primary">{client.name}</p>
          <p className="truncate font-caption text-caption text-on-surface-variant">
            {client.email}
          </p>
        </div>
      </div>

      <div className="col-span-12 md:col-span-3">
        <p className="truncate font-small text-small text-primary">{booking.service.name}</p>
        <p className="truncate font-caption text-caption text-on-surface-variant">
          {booking.client.timezone !== booking.provider.timezone
            ? `${formatTime(booking.startsAt, booking.client.timezone)} their time`
            : "Same timezone"}
        </p>
      </div>

      <div className="col-span-12 md:col-span-2">
        <p className="font-small text-small text-primary">
          {formatDateTime(booking.startsAt, viewerZone).split(",")[0]}
        </p>
        <p className="font-caption text-caption text-on-surface-variant">
          {formatTime(booking.startsAt, viewerZone)} – {formatTime(booking.endsAt, viewerZone)}
        </p>
      </div>

      <div className="col-span-6 md:col-span-1">
        <p className="font-small text-small text-primary">
          {formatDuration(booking.service.duration)}
        </p>
        <p className="font-caption text-caption text-on-surface-variant">
          {formatPrice(booking.service.price, booking.service.currency)}
        </p>
      </div>

      <div className="col-span-6 flex items-center md:col-span-1">
        <span className={status.className}>{status.label}</span>
      </div>

      <div className="col-span-12 flex items-center justify-end gap-2 opacity-100 transition-opacity md:col-span-2 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <Link
          to={`/messages/${booking.id}`}
          title="Message"
          aria-label={`Message ${client.name}`}
          className="rounded-md p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
        >
          <Icon name="chat" size={18} />
        </Link>

        {canReschedule && (
          <button
            type="button"
            onClick={() => onReschedule(booking)}
            title="Reschedule"
            aria-label={`Reschedule ${client.name}`}
            className="cursor-pointer rounded-md p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
          >
            <Icon name="event_repeat" size={18} />
          </button>
        )}

        <Link
          to={`/bookings/${booking.id}`}
          className="ml-2 rounded-md border border-outline-variant px-3 py-1.5 font-caption text-caption text-primary transition-colors hover:bg-surface-container-low"
        >
          Details
        </Link>
      </div>
    </div>
  );
}

/* ==========================================================================
 * The client's cards — `my_appointments`
 * ========================================================================== */

function ClientCards({ bookings, viewerZone, total, firstRow, lastRow, page, pageCount, onPage }) {
  return (
    <>
      <div className="flex flex-col gap-4">
        {bookings.map((booking) => (
          <ClientCard key={booking.id} booking={booking} viewerZone={viewerZone} />
        ))}
      </div>

      {pageCount > 1 && (
        <div className="mt-6 overflow-hidden rounded-lg border border-outline-variant bg-surface">
          <ListFooter
            total={total}
            firstRow={firstRow}
            lastRow={lastRow}
            page={page}
            pageCount={pageCount}
            onPage={onPage}
          />
        </div>
      )}
    </>
  );
}

function ClientCard({ booking, viewerZone }) {
  const status = statusStyle(booking.status);
  const provider = booking.provider;
  const canReschedule = booking.status === "booked" || booking.status === "rescheduled";

  return (
    <div className="group flex flex-col items-start justify-between gap-5 rounded-md border border-outline-variant bg-surface p-5 transition-shadow hover:shadow-raise md:flex-row md:items-center">
      <div className="flex flex-1 items-start gap-4">
        <Avatar
          src={provider.avatarUrl}
          name={provider.name}
          size="lg"
          className="border border-outline-variant/30"
        />

        <div className="flex min-w-0 flex-col">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="font-small text-base font-semibold text-primary">
              {provider.businessName || provider.name}
            </h3>
            <span className={status.className}>{status.label}</span>
          </div>

          <p className="font-small text-small text-on-surface-variant">{booking.service.name}</p>

          <div className="mt-3 flex flex-wrap items-center gap-4 font-caption text-caption text-on-surface-variant">
            <span className="flex items-center gap-1.5">
              <Icon name="calendar_today" size={16} />
              {formatDateTime(booking.startsAt, viewerZone).split(",")[0]}
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="schedule" size={16} />
              {formatTime(booking.startsAt, viewerZone)} – {formatTime(booking.endsAt, viewerZone)}
            </span>
            <span className="hidden items-center gap-1.5 md:flex">
              <Icon name="payments" size={16} />
              {formatPrice(booking.service.price, booking.service.currency)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex w-full items-center gap-2 border-t border-outline-variant pt-4 md:mt-0 md:w-auto md:border-none md:pt-0">
        {/* Rescheduling a booking is the provider's action in Slotly — a client
            asks for it. This is where that ask starts, which is why it opens the
            thread rather than a slot picker. */}
        {canReschedule && (
          <Link
            to={`/messages/${booking.id}`}
            className="flex h-10 flex-1 items-center justify-center rounded-md border border-outline-variant px-4 font-small text-small text-primary transition-colors hover:bg-surface-container-low md:flex-none"
          >
            Message
          </Link>
        )}
        <Link
          to={`/bookings/${booking.id}`}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 font-small text-small text-on-primary transition-colors hover:bg-primary/90 md:flex-none"
        >
          View Details
        </Link>
      </div>
    </div>
  );
}

/* ==========================================================================
 * Shared furniture
 * ========================================================================== */

/** The card's own footer: a count on the left, two arrows on the right. */
function ListFooter({ total, firstRow, lastRow, page, pageCount, onPage }) {
  return (
    <div className="flex items-center justify-between border-t border-outline-variant bg-surface-container-lowest p-4">
      <p className="font-caption text-caption text-on-surface-variant">
        Showing {firstRow} to {lastRow} of {total} appointment{total === 1 ? "" : "s"}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="cursor-pointer rounded-md border border-outline-variant p-1 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="chevron_left" size={18} />
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
          className="cursor-pointer rounded-md border border-outline-variant p-1 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="chevron_right" size={18} />
        </button>
      </div>
    </div>
  );
}

/** The `no_appointments` screen. */
function NoAppointments({ tab, isProvider, searching, hasHistory }) {
  if (searching) {
    return (
      <EmptyState
        icon="search"
        title="No appointments match that search"
        description="Try a different name or service."
      />
    );
  }

  // A client with an empty Upcoming tab is one of two people. Someone who has
  // never booked needs to be told what to do; someone between appointments knows
  // already, and being shown a beginner's screen every time they clear their
  // schedule reads as though the app has forgotten them.
  const clientUpcoming = hasHistory
    ? {
        title: "Book your next appointment",
        description: "Nothing coming up. Pick a provider and a time whenever you are ready.",
      }
    : {
        title: "Book your first appointment",
        description:
          "Find a provider, pick a service and choose a time that suits you. Everything you book shows up here.",
      };

  const copy = {
    upcoming: {
      title: isProvider ? "No upcoming appointments" : clientUpcoming.title,
      description: isProvider
        ? "Once clients start booking, their appointments appear here."
        : clientUpcoming.description,
    },
    past: {
      title: "No past appointments",
      description:
        "Appointments move here once their time has passed — whether they were completed or marked as a no-show.",
    },
    cancelled: {
      title: "No cancelled appointments",
      description: "Nothing has been called off.",
    },
  }[tab];

  return (
    <EmptyState
      // An invitation to book, not a report that nothing is booked — so the
      // client's Upcoming tab gets the affirmative glyph the dashboard uses.
      icon={tab === "upcoming" && !isProvider ? "event_available" : "event_busy"}
      title={copy.title}
      description={copy.description}
      {...(tab === "upcoming" && !isProvider
        ? { actionLabel: hasHistory ? "Book again" : "Find a provider", actionTo: "/providers" }
        : {})}
      {...(tab === "upcoming" && isProvider
        ? { actionLabel: "Manage services", actionTo: "/services" }
        : {})}
    />
  );
}

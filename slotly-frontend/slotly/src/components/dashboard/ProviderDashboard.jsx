//  The provider's schedule: a day/week calendar and a filterable table of the same bookings.
import { useEffect, useMemo, useRef, useState } from "react";
import { Views } from "react-big-calendar";
import { Link, useNavigate } from "react-router-dom";
import { DateTime } from "luxon";
import * as bookingsApi from "../../api/bookings";
import * as providersApi from "../../api/providers";
import * as availabilityApi from "../../api/availability";
import { useApiResource } from "../../hooks/useApiResource";
import { fromDisplayDate, toDisplayDate } from "../../lib/time";
import ProviderCalendar from "./ProviderCalendar";
import TodaySchedule from "./TodaySchedule";
import BookingsTable from "../bookings/BookingsTable";
import Icon from "../ui/Icon";
import Page, { PageHeader, Section, SplitLayout, Toolbar } from "../ui/Page";
import { SegmentedControl } from "../ui/Tabs";
import { Select } from "../ui/Field";
import EmptyState, { Alert, SkeletonBlock, SkeletonRows } from "../ui/Feedback";
import Pagination, { usePagination } from "../ui/Pagination";
import {
  inputClasses,
  ghostButton,
  secondaryButton,
  buttonSm,
  chipClasses,
  cardClasses,
  metric,
  formatPrice,
  zoneName,
} from "../../lib/ui";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "booked", label: "Booked" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No-show" },
];

/** Rows per page in the table. Twenty compact rows is roughly one screen. */
const PAGE_SIZE = 20;


function initialCalendarView() {
  // `matchMedia` is guarded for a non-browser render; 768px is Tailwind's `md`,
  // the same breakpoint the rest of the layout switches on.
  if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches) {
    return Views.DAY;
  }
  return Views.WEEK;
}

export default function ProviderDashboard({ user }) {
  const navigate = useNavigate();

  const [mode, setMode] = useState("calendar");

  // The zone the whole calendar is drawn in: the provider's saved zone, read
  // from their user row. Nothing on this screen consults the device's zone.
  const timezone = user.timezone || "UTC";

  const { data: overview, loading: overviewLoading } = useApiResource(
    async ({ signal }) => {
      const [services, summary, health] = await Promise.all([
        providersApi.listServices(user.id, { signal }).catch(() => []),
        bookingsApi.summary({ signal }).catch(() => null),
        // Non-fatal: the "needs attention" panel is an extra, and the dashboard
        // must still render its schedule if this one call fails.
        availabilityApi.getHealth({ signal }).catch(() => null),
      ]);
      return { services, summary, health };
    },
    { deps: [user.id] }
  );

  const services = overview?.services ?? [];
  const summary = overview?.summary ?? null;
  const health = overview?.health ?? null;

  const [calendarDate, setCalendarDate] = useState(() => toDisplayDate(new Date(), timezone));
  const [calendarView, setCalendarView] = useState(initialCalendarView);
  // Table state
  const [filters, setFilters] = useState({ status: "", serviceId: "", from: "", to: "" });

  const anchoredZone = useRef(timezone);
  useEffect(() => {
    if (anchoredZone.current === timezone) return;
    anchoredZone.current = timezone;
    setCalendarDate(toDisplayDate(new Date(), timezone));
  }, [timezone]);

  // Today's appointments, fetched independently of the calendar window.

  const { data: todayData, loading: todayLoading } = useApiResource(
    ({ signal }) => {
      const dayStart = DateTime.now().setZone(timezone).startOf("day");
      return bookingsApi
        .list(
          { from: dayStart.toUTC().toISO(), to: dayStart.plus({ days: 1 }).toUTC().toISO() },
          { signal }
        )
        // Today's panel is a convenience over the calendar beside it; a failure
        // here must not surface as a page-level error.
        .catch(() => ({ bookings: [] }));
    },
    { deps: [timezone] }
  );

  const todayBookings = todayData?.bookings ?? [];

  // The window the calendar needs: the visible day or week, padded a day either
  // side so an appointment on a boundary is never clipped.

  const calendarRange = useMemo(() => {
    const anchor = fromDisplayDate(calendarDate, timezone);
    const unit = calendarView === Views.DAY ? "day" : "week";

    return {
      from: anchor.startOf(unit).minus({ days: 1 }).toUTC().toISO(),
      to: anchor.endOf(unit).plus({ days: 1 }).toUTC().toISO(),
    };
  }, [calendarDate, calendarView, timezone]);


  const {
    data: calendarData,
    loading: calendarLoading,
    error: calendarError,
    reload: loadCalendar,
  } = useApiResource(
    ({ signal }) => bookingsApi.list({ from: calendarRange.from, to: calendarRange.to }, { signal }),
    {
      enabled: mode === "calendar",
      deps: [mode, calendarRange],
      fallback: "Could not load your calendar.",
    }
  );

  const {
    data: listData,
    loading: listLoading,
    error: listError,
    reload: loadList,
  } = useApiResource(
    ({ signal }) =>
      // Empty filters are dropped rather than sent as blanks, which the API
      // would otherwise have to interpret.
      bookingsApi.list(
        Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "")),
        { signal }
      ),
    { enabled: mode === "list", deps: [mode, filters], fallback: "Could not load your bookings." }
  );

  const calendarBookings = calendarData?.bookings ?? [];
  const listBookings = listData?.bookings ?? [];

  // Only the view actually on screen can raise a page-level error.
  const error = mode === "calendar" ? calendarError : listError;

  const updateFilter = (field) => (event) =>
    setFilters((current) => ({ ...current, [field]: event.target.value }));

  const clearFilters = () => setFilters({ status: "", serviceId: "", from: "", to: "" });
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const { pageItems, page, pageCount, setPage, total, from, to } = usePagination(
    listBookings,
    PAGE_SIZE
  );

  return (
    <Page>
      <PageHeader
        title="Schedule"
        description="Everything booked with you. Every time on this page is drawn in your own timezone."
        meta={
          <span className={chipClasses}>
            <Icon name="globe" size={12} />
            {zoneName(timezone)}
          </span>
        }
        actions={
          <SegmentedControl
            label="How to view your bookings"
            panelId="schedule-panel"
            value={mode}
            onChange={setMode}
            options={[
              { id: "calendar", label: "Calendar", icon: "calendar" },
              { id: "list", label: "List", icon: "list" },
            ]}
          />
        }
      />

      {error && (
        <Alert
          tone="error"
          className="mb-4"
          action={
            <button
              type="button"
              onClick={mode === "calendar" ? loadCalendar : loadList}
              className={`${secondaryButton} ${buttonSm}`}
            >
              <Icon name="refresh" size={14} />
              Retry
            </button>
          }
        >
          {error}
        </Alert>
      )}

      <div id="schedule-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
        {mode === "calendar" ? (
          <SplitLayout
            aside={
              <>
                {/* First in the sidebar: these are the things stopping bookings
                    from happening at all, so they outrank today's schedule and
                    the running totals. */}
                <NeedsAttentionPanel
                  health={health}
                  user={user}
                  services={services}
                  loading={overviewLoading}
                />
                <TodaySchedule
                  bookings={todayBookings}
                  timezone={timezone}
                  loading={todayLoading}
                />
                <SummaryPanel
                  summary={summary}
                  activeServiceCount={services.filter((s) => s.is_active !== false).length}
                  loading={overviewLoading}
                />
              </>
            }
          >
            {calendarLoading && calendarBookings.length === 0 ? (
              <CalendarSkeleton />
            ) : (
              <ProviderCalendar
                bookings={calendarBookings}
                timezone={timezone}
                date={calendarDate}
                view={calendarView}
                loading={calendarLoading}
                onNavigate={setCalendarDate}
                onView={setCalendarView}
                onSelectBooking={(booking) => navigate(`/bookings/${booking.id}`)}
              />
            )}
          </SplitLayout>
        ) : (
          <div className="space-y-3">
            
            <Toolbar>
              <Icon name="sliders" size={15} className="text-ink-3" />

              <Select
                aria-label="Filter by status"
                value={filters.status}
                onChange={updateFilter("status")}
                className="w-auto min-w-[9.5rem]"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>

              <Select
                aria-label="Filter by service"
                value={filters.serviceId}
                onChange={updateFilter("serviceId")}
                className="w-auto min-w-[10rem] max-w-[16rem]"
              >
                <option value="">All services</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.service_name}
                    {service.is_active === false ? " (retired)" : ""}
                  </option>
                ))}
              </Select>

              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="From date"
                  value={filters.from}
                  onChange={updateFilter("from")}
                  className={`${inputClasses} w-auto`}
                />
                <span aria-hidden="true" className="text-xs text-ink-3">
                  to
                </span>
                <input
                  type="date"
                  aria-label="To date"
                  value={filters.to}
                  onChange={updateFilter("to")}
                  className={`${inputClasses} w-auto`}
                />
              </div>

              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className={`${ghostButton} ${buttonSm} ml-auto`}
                >
                  <Icon name="close" size={14} />
                  Clear {activeFilterCount}
                </button>
              )}
            </Toolbar>

            {listLoading ? (
              <div className={`${cardClasses} overflow-hidden`}>
                <SkeletonRows count={8} variant="table" className="space-y-0" />
              </div>
            ) : listBookings.length === 0 ? (
              <EmptyState
                icon={hasFilters ? "search" : "calendar"}
                title={hasFilters ? "No bookings match those filters" : "No bookings yet"}
                description={
                  hasFilters
                    ? "Try widening the date range or clearing a filter."
                    : "Once clients start booking, their appointments appear here."
                }
                {...(hasFilters
                  ? { actionLabel: "Clear filters", onAction: clearFilters }
                  : { actionLabel: "Set up a service", actionTo: "/services" })}
              />
            ) : (
              <>
                <BookingsTable bookings={pageItems} timezone={timezone} />
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  onChange={setPage}
                  total={total}
                  from={from}
                  to={to}
                  unit="booking"
                />
              </>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}

/**
 * The one place that says "something here needs you".
 *
 * These warnings were previously either nowhere (an incomplete profile) or
 * buried on the screen that causes them (a service whose hours cannot yield a
 * slot, which only appears once you open Availability and pick that service's
 * tab). Both share a property that makes a dashboard the right home: a provider
 * has no reason to go looking for them, because from where they are standing
 * nothing looks wrong — the calendar is simply empty.
 *
 * Each entry is one sentence and one link to the screen that fixes it. The full
 * explanation — which day, which buffer, what to change — stays on the
 * Availability page, where the controls are. Repeating it here would turn a
 * glance into a read, and the panel is meant to be glanceable.
 *
 * Renders nothing when there is nothing wrong, rather than an empty "all good"
 * card: a permanent panel that is usually blank stops being looked at.
 */
function NeedsAttentionPanel({ health, user, services, loading }) {
  if (loading) return null;

  const items = [];

  // Ordered by how badly each one blocks a booking, most blocking first.
  if (services.length > 0 && services.every((s) => s.is_active === false)) {
    items.push({
      icon: "tag",
      text: "None of your services are active, so nothing can be booked.",
      to: "/services",
      action: "Manage services",
    });
  }

  for (const name of health?.servicesWithoutHours ?? []) {
    items.push({
      icon: "clock",
      text: `${name} has no hours set, so clients cannot book it.`,
      to: "/availability",
      action: "Set hours",
    });
  }

  for (const service of health?.misconfiguredServices ?? []) {
    const day = service.problemDays[0];
    items.push({
      icon: "alert",
      // Deliberately short. The provider needs to know *that* it is broken and
      // where to go; the Availability page tells them why and what to change.
      text: day
        ? `${service.serviceName} offers no times — your ${day.weekdayName} hours are too short for it once buffers are counted.`
        : `${service.serviceName} offers no bookable times with its current hours.`,
      to: "/availability",
      action: "Fix hours",
    });
  }

  if (!user.bio?.trim()) {
    items.push({
      icon: "user",
      text: "Your profile has no bio yet — clients see it when choosing a provider.",
      to: "/profile",
      action: "Add a bio",
    });
  }

  if (items.length === 0) return null;

  return (
    <Section title="Needs attention" tone="warn" flush>
      <ul className="divide-y divide-line-soft">
        {items.map((item) => (
          <li key={item.text} className="px-3 py-2.5">
            <p className="flex gap-2 text-[0.8125rem] leading-relaxed text-ink-2">
              <Icon name={item.icon} size={14} className="mt-0.5 shrink-0 text-warn-ink" />
              <span>{item.text}</span>
            </p>
            <Link
              to={item.to}
              className="mt-1 ml-6 inline-flex items-center gap-1 text-xs font-medium text-brand transition hover:text-brand-strong"
            >
              {item.action}
              <Icon name="arrowRight" size={13} />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SummaryPanel({ summary, activeServiceCount, loading }) {
  if (!loading && !summary) return null;

  const figures = [
    { label: "Upcoming", icon: "calendar", value: summary && summary.upcomingBookings },
    { label: "Completed", icon: "check", value: summary && summary.completedBookings },
    { label: "Active services", icon: "tag", value: summary && activeServiceCount },
    { label: "Total earnings", icon: "spark", value: summary && formatPrice(summary.totalEarnings) },
  ];

  return (
    <Section title="At a glance" flush>
      <dl className="divide-y divide-line-soft">
        {figures.map((figure) => (
          <div key={figure.label} className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
              <Icon name={figure.icon} size={14} className="text-ink-3" />
              {figure.label}
            </dt>
            <dd className={metric}>
              {figure.value == null ? <SkeletonBlock className="h-4 w-12" /> : figure.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-line-soft px-3 py-2">
        <Link
          to="/services"
          className="flex items-center justify-between text-xs font-medium text-brand transition hover:text-brand-strong"
        >
          Manage services
          <Icon name="arrowRight" size={14} />
        </Link>
      </div>
    </Section>
  );
}


function CalendarSkeleton() {
  return (
    <div className={`${cardClasses} overflow-hidden`} aria-hidden="true">
      <div className="flex items-center justify-between border-b border-line bg-subtle px-3 py-2.5">
        <SkeletonBlock className="h-6 w-48" />
        <SkeletonBlock className="h-6 w-28 rounded-md" />
      </div>
      <div className="grid grid-cols-7 gap-1 p-3">
        {Array.from({ length: 7 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[520px] w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

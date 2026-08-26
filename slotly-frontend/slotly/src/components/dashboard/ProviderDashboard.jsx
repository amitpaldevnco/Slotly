/**
 * The provider's dashboard — `provider_dashboard`.
 *
 * Transcribed from the reference: a greeting, a row of five metric tiles, then a
 * twelve-column split with Today's Schedule on the left and Quick Actions and
 * Recent Messages stacked on the right.
 *
 * Two tiles differ from the reference's labels, because the reference asks for
 * figures Slotly does not record. There is no "Revenue (This Month)" — a booking
 * carries a price but the app takes no payments, so the tile shows lifetime
 * earnings from `GET /bookings/summary` and says so. There is no aggregate
 * rating on this endpoint either, so "Average Rating" is replaced by the active
 * service count, which is the number a provider on this screen can act on.
 *
 * The calendar and the bookings table that used to live here now have routes of
 * their own — `/calendar` and `/appointments` — matching the reference's sidebar.
 *
 * ## Today's Schedule carries more than the reference draws
 *
 * The reference gives this panel eight of the twelve columns and puts a start
 * time and a name in each row, which left most of the widest thing on the page
 * blank. Everything added to it is derived from the appointments already
 * fetched, so none of it costs a request: a four-figure summary of the day above
 * the rows (`DayOverview`), and per row the end time, the client's photo, the
 * fee, and the note the client wrote when booking. The note in particular was
 * being collected on the booking form and then shown nowhere except inside the
 * appointment itself.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import * as bookingsApi from "../../api/bookings";
import * as providersApi from "../../api/providers";
import * as messagesApi from "../../api/messages";
import { useApiResource } from "../../hooks/useApiResource";
import { useNotifications } from "../../context/NotificationsContext";
import { useToast } from "../../context/ToastContext";
import { parseApiError } from "../../api/client";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import { SkeletonBlock, SkeletonRows } from "../ui/Feedback";
import Modal from "../ui/Modal";
import { countdownTo, formatTime, greeting, relativeTime } from "../../lib/time";
import {
  container,
  formatPrice,
  formatDuration,
  statusStyle,
  zoneName,
  secondaryButton,
  dangerButton,
} from "../../lib/ui";

export default function ProviderDashboard({ user }) {
  // The account-health warnings are already loaded once per session by the
  // shell, so this screen reads them rather than repeating the requests.
  const { warnings, unread, reload: reloadNotices } = useNotifications();

  // The zone everything on this screen is drawn in: the provider's saved zone,
  // read from their user row. Nothing here consults the device's zone.
  const timezone = user.timezone || "UTC";

  const { data: overview, loading: overviewLoading, reload: reloadOverview } = useApiResource(
    async ({ signal }) => {
      const [services, summary] = await Promise.all([
        providersApi.listServices(user.id, { signal }).catch(() => []),
        bookingsApi.summary({ signal }).catch(() => null),
      ]);
      return { services, summary };
    },
    { deps: [user.id] }
  );

  const services = overview?.services ?? [];
  const summary = overview?.summary ?? null;

  // Appointments that have finished with no result recorded. Nothing settles
  // these automatically — see the note above `awaitsOutcome()` on the server —
  // so this list is the only thing that gets them resolved, and it sits at the
  // top of the page for that reason.
  const {
    data: outcomeData,
    loading: outcomeLoading,
    reload: reloadOutcomeQueue,
  } = useApiResource(
    ({ signal }) =>
      bookingsApi
        .list({ scope: "awaiting_outcome" }, { signal })
        // A failure here must not take the whole dashboard down with it.
        .catch(() => ({ bookings: [] })),
    { deps: [user.id], initialData: { bookings: [] } }
  );

  const awaitingOutcome = outcomeData?.bookings ?? [];

  // Today's appointments, fetched independently of anything else on the screen.
  const { data: todayData, loading: todayLoading, reload: reloadToday } = useApiResource(
    ({ signal }) => {
      const dayStart = DateTime.now().setZone(timezone).startOf("day");
      return (
        bookingsApi
          .list(
            { from: dayStart.toUTC().toISO(), to: dayStart.plus({ days: 1 }).toUTC().toISO() },
            { signal }
          )
          // Today's panel is a convenience; a failure here must not surface as a
          // page-level error.
          .catch(() => ({ bookings: [] }))
      );
    },
    { deps: [timezone] }
  );

  // Genuinely the most recently active conversations, from
  // `GET /bookings/recent-messages`. This panel used to list *upcoming bookings*
  // and stamp each row with the appointment time, so a box headed "Recent
  // Messages" showed rows reading "in 2 days" — a message that had not been sent,
  // dated in the future. Non-fatal: the dashboard must not fail on this panel.
  const { data: recentData, loading: conversationsLoading } = useApiResource(
    ({ signal }) => messagesApi.recent(3, { signal }).catch(() => ({ conversations: [] })),
    { deps: [], initialData: { conversations: [] } }
  );

  const todayBookings = useMemo(
    () =>
      (todayData?.bookings ?? [])
        .filter((booking) => booking.status !== "cancelled")
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [todayData]
  );

  const firstName = user.name?.split(" ")[0];
  const activeServiceCount = services.filter((service) => service.isActive !== false).length;

  // The next appointment still to come, found once. This was `nextOf(...)`
  // called inside the render loop, so a day with n appointments scanned the list
  // n times to answer one question about it.
  const nextBookingId = nextOf(todayBookings)?.id ?? null;

  // Which row is mid-request, so only that row's buttons go quiet rather than
  // the whole panel freezing while one appointment is settled.
  const [settlingId, setSettlingId] = useState(null);

  // The appointment awaiting a no-show confirmation, or null.
  //
  // Only no-show is confirmed. "Completed" is the expected outcome and is
  // correctable by marking it again; a no-show is a statement about the client
  // that shows on their record, withholds the fee from earnings and blocks the
  // review, and it sat one mis-tap away from Completed with no undo.
  const [pendingNoShow, setPendingNoShow] = useState(null);
  const toast = useToast();

  /**
   * Records an outcome the provider has chosen, then re-reads everything the
   * choice moves: the queue itself, the earnings tiles, and the header badge.
   */
  const recordOutcome = async (booking, status) => {
    setPendingNoShow(null);
    setSettlingId(booking.id);
    try {
      await bookingsApi.setStatus(booking.id, status);
      toast.success(
        status === "completed"
          ? `Marked completed. ${formatPrice(booking.service.price, booking.service.currency)} added to your earnings.`
          : "Marked no-show. Nothing added to your earnings."
      );
      // Today's Schedule lists the same appointment lower down the page, so it
      // has to be re-read too — otherwise the row the provider just settled
      // still reads "BOOKED" directly beneath the panel that settled it.
      await Promise.all([
        reloadOutcomeQueue(),
        reloadOverview(),
        reloadToday(),
        reloadNotices(),
      ]);
    } catch (err) {
      toast.error(parseApiError(err, "Could not update this appointment.").message);
    } finally {
      setSettlingId(null);
    }
  };

  return (
    <div className={`${container} py-margin-mobile md:py-margin-desktop`}>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="font-h1-mobile text-h1-mobile text-primary md:font-h1 md:text-h1">
          {firstName ? `${greeting(timezone)}, ${firstName}` : "Your schedule"}
        </h1>
        <p className="mt-2 font-body-lg text-body-lg text-on-surface-variant">
          Here&apos;s what&apos;s happening with your practice today.
        </p>
      </div>

      {/* Appointments waiting on a result.
          Above the account-health warnings deliberately: those describe a
          configuration that could be better, this one is unfinished work with
          money attached, and it is the only thing on the page that will not
          resolve itself if ignored. */}
      {!outcomeLoading && awaitingOutcome.length > 0 && (
        <section
          aria-labelledby="awaiting-outcome-heading"
          className="mb-8 overflow-hidden rounded-lg border border-primary/30 bg-surface"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary/5 px-6 py-3">
            <Icon name="event_available" size={18} className="text-primary" />
            <p
              id="awaiting-outcome-heading"
              className="font-small text-small font-semibold text-on-surface"
            >
              {awaitingOutcome.length === 1
                ? "1 appointment has ended. Please mark the result as Completed or No-show."
                : `${awaitingOutcome.length} appointments have ended. Please mark each result as Completed or No-show.`}
            </p>
            {summary?.awaitingOutcomeValue > 0 && (
              <span className="ml-auto font-caption text-caption text-on-surface-variant">
                {formatPrice(summary.awaitingOutcomeValue, user.currency)} unconfirmed
              </span>
            )}
          </div>

          <ul className="divide-y divide-outline-variant/50">
            {awaitingOutcome.map((booking) => {
              const busy = settlingId === booking.id;
              return (
                <li
                  key={booking.id}
                  className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/bookings/${booking.id}`}
                      className="block truncate font-body text-body font-semibold text-on-surface hover:text-primary"
                    >
                      {booking.client.name}
                    </Link>
                    <p className="mt-0.5 truncate font-caption text-caption text-on-surface-variant">
                      {booking.service.name} ·{" "}
                      {formatTime(booking.startsAt, timezone)} ·{" "}
                      {/* "ended 3 hours ago" is the fact that makes this actionable. */}
                      ended {relativeTime(booking.endsAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => recordOutcome(booking, "completed")}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 font-caption text-caption font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <Icon name="check" size={14} />
                      Completed
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingNoShow(booking)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-outline-variant px-3 py-2 font-caption text-caption font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50"
                    >
                      <Icon name="ban" size={14} />
                      No-show
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Warnings. The reference has no panel for these, but the application
          does raise them and they block bookings — so they sit directly under
          the greeting, where the eye already is. */}
      {/* {warnings.length > 0 && (
        <div className="mb-8 overflow-hidden rounded-lg border border-outline-variant bg-surface">
          <div className="flex items-center gap-2 border-b border-outline-variant bg-surface-container-low px-6 py-3">
            <Icon name="warning" size={18} className="text-error" />
            <p className="font-small text-small font-semibold text-on-surface">Needs attention</p>
          </div>
          <ul className="divide-y divide-outline-variant/50">
            {warnings.map((warning) => (
              <li key={warning.id}>
                <Link
                  to={warning.to}
                  className="flex items-start gap-3 px-6 py-4 transition-colors hover:bg-surface-container-lowest"
                >
                  <Icon
                    name={warning.icon}
                    size={20}
                    className="mt-0.5 shrink-0 text-on-surface-variant"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-small text-small font-semibold text-on-surface">
                      {warning.title}
                    </span>
                    <span className="mt-1 block font-caption text-caption text-on-surface-variant">
                      {warning.body}
                    </span>
                  </span>
                  <span className="mt-0.5 flex shrink-0 items-center gap-1 font-caption text-caption font-semibold text-primary">
                    {warning.actionLabel}
                    <Icon name="arrow_forward" size={14} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )} */}

      {/* Metrics */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5 md:gap-gutter">
        <MetricTile
          label="Today's Appointments"
          icon="calendar_today"
          value={todayLoading ? null : todayBookings.length}
        />
        <MetricTile
          label="Upcoming"
          icon="event_upcoming"
          value={summary?.upcomingBookings}
          loading={overviewLoading}
        />
        {/* `totalBookings`, not `completedBookings` — this tile read the latter
            while carrying the former's label, so a provider with four bookings
            and two finished ones saw "Total Bookings: 2". */}
        <MetricTile
          label="Total Bookings"
          icon="check_circle"
          value={summary?.totalBookings}
          loading={overviewLoading}
        />
        <MetricTile
          label="Total Earnings"
          icon="payments"
          value={summary ? formatPrice(summary.totalEarnings, user.currency) : null}
          loading={overviewLoading}
        />
        <MetricTile
          label="Active Services"
          icon="category"
          value={overviewLoading ? null : activeServiceCount}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        {/* Today's Schedule */}
        <div className="rounded-lg border border-outline-variant bg-surface p-6 md:p-8 lg:col-span-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h3 className="font-h3 text-h3 text-primary">Today&apos;s Schedule</h3>
            <Link
              to="/calendar"
              className="rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
            >
              View Full Calendar
            </Link>
          </div>

          {todayLoading ? (
            <SkeletonRows count={3} variant="line" />
          ) : todayBookings.length === 0 ? (
            <div className="rounded-md border border-dashed border-outline-variant px-6 py-12 text-center">
              <Icon name="event_available" size={28} className="mx-auto text-on-surface-variant" />
              <p className="mt-3 font-small text-small font-semibold text-on-surface">
                Nothing booked today
              </p>
              {/* An empty day is not the same thing as an empty diary, and the
                  panel used to say the same sentence about published hours
                  either way — sending a provider off to check availability that
                  is, in fact, working fine. The upcoming count is already loaded
                  for the tile above, so saying which of the two situations this
                  is costs nothing. */}
              {summary?.upcomingBookings > 0 ? (
                <>
                  <p className="mt-1 font-caption text-caption text-on-surface-variant">
                    You have {summary.upcomingBookings} appointment
                    {summary.upcomingBookings === 1 ? "" : "s"} booked on later days.
                  </p>
                  <Link
                    to="/appointments"
                    className="mt-4 inline-flex rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
                  >
                    See what&apos;s coming up
                  </Link>
                </>
              ) : (
                <>
                  <p className="mt-1 font-caption text-caption text-on-surface-variant">
                    Clients can only book times inside your published hours.
                  </p>
                  <Link
                    to="/availability"
                    className="mt-4 inline-flex rounded-md border border-outline-variant px-4 py-2 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
                  >
                    Check availability
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              {/* The shape of the day, above the day itself.

                  This panel is two-thirds of the page's width and its rows are
                  a time and two lines of text, so it carried a lot of blank
                  space — most of it in exactly the place a reader looks first.
                  These four figures are all derived from the appointments
                  already on screen, so the panel answers "what does today look
                  like" before the reader has to add it up from the rows. */}
              <DayOverview bookings={todayBookings} timezone={timezone} currency={user.currency} />

              <div className="space-y-4">
                {todayBookings.map((booking, index) => (
                  <ScheduleRow
                    key={booking.id}
                    booking={booking}
                    timezone={timezone}
                    isNext={booking.id === nextBookingId}
                    gapBefore={gapBetween(todayBookings[index - 1], booking)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-gutter lg:col-span-4">
          {/* Quick Actions */}
          <div className="rounded-lg border border-outline-variant bg-surface p-6">
            <h3 className="mb-4 font-h3 text-h3 text-primary">Quick Actions</h3>
            <div className="space-y-3">
              <QuickAction to="/services?new=1" icon="add_circle" label="Add Service" />
              <QuickAction to="/availability" icon="edit_calendar" label="Edit Availability" />
              <QuickAction
                to={`/providers/${user.id}`}
                icon="account_circle"
                label="View Public Profile"
                trailingIcon="open_in_new"
                external
              />
            </div>
          </div>

          {/* Recent Messages */}
          <div className="rounded-lg border border-outline-variant bg-surface p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-h3 text-[20px] leading-tight text-primary">Recent Messages</h3>
              <Link
                to="/messages"
                // `-my-2 py-2` widens the tap area without moving the text. At
                // caption size this was a 47x17px target, under the 24x24
                // minimum and awkward to hit with a thumb.
                className="-my-2 rounded px-1 py-2 font-caption text-caption text-primary hover:underline"
              >
                View All
              </Link>
            </div>

            <RecentConversations
              conversations={recentData?.conversations ?? []}
              loading={conversationsLoading}
              unread={unread}
            />
          </div>

          {/* Timezone note. Every time on this screen depends on it. */}
          <p className="flex items-center gap-2 px-1 font-caption text-caption text-on-surface-variant">
            <Icon name="public" size={14} />
            Times shown in {zoneName(timezone)}
          </p>
        </div>
      </div>

      <Modal
        open={Boolean(pendingNoShow)}
        onClose={() => setPendingNoShow(null)}
        title="Mark this as a no-show?"
        description={
          pendingNoShow
            ? `${pendingNoShow.client?.name ?? "This client"} · ${pendingNoShow.service?.name ?? ""}`
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setPendingNoShow(null)}
              className={secondaryButton}
            >
              Go back
            </button>
            <button
              type="button"
              onClick={() => recordOutcome(pendingNoShow, "no_show")}
              disabled={settlingId === pendingNoShow?.id}
              className={dangerButton}
            >
              {settlingId === pendingNoShow?.id ? "Saving…" : "Mark no-show"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2">
          Nothing is added to your earnings, the client sees this on their own record, and they
          cannot review the appointment. If they did attend, choose Completed instead.
        </p>
      </Modal>
    </div>
  );
}

/** The next appointment still to come today, if there is one. */
function nextOf(bookings) {
  const now = Date.now();
  return bookings.find((booking) => new Date(booking.startsAt).getTime() > now);
}

/**
 * The reference draws an italic "1 hour break" between two rows that are not
 * adjacent. This reports a real gap rather than a decorative one, and only when
 * it is at least a quarter of an hour.
 */
function gapBetween(previous, booking) {
  if (!previous) return null;

  const minutes = Math.round(
    (new Date(booking.startsAt).getTime() - new Date(previous.endsAt).getTime()) / 60000
  );
  if (minutes < 15) return null;

  return formatDuration(minutes);
}

function MetricTile({ label, icon, value, loading = false, className = "" }) {
  return (
    <div
      className={`flex flex-col justify-between rounded-lg border border-outline-variant bg-surface p-4 md:p-6 ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <p className="font-small text-small text-on-surface-variant">{label}</p>
        <Icon name={icon} size={20} className="shrink-0 text-primary" />
      </div>
      {loading || value == null ? (
        <SkeletonBlock className="h-8 w-20" />
      ) : (
        <p className="font-h2 text-h2 text-primary">{value}</p>
      )}
    </div>
  );
}

/**
 * The four figures that describe a provider's day, read off the appointments the
 * panel is already showing.
 *
 * Derived rather than fetched: every one of these is a reduction over the list
 * beside it, so the panel costs no extra request and can never disagree with the
 * rows underneath it.
 *
 * The two that need a stated rule:
 *
 *   - **Booked** counts every appointment's duration, including a no-show. The
 *     slot was held and nothing else could be booked into it, so the time was
 *     spent whether or not the client turned up.
 *   - **Value** excludes no-shows, because a no-show earns nothing — the same
 *     rule the earnings tiles and `recordOutcome`'s own toast apply. Counting it
 *     here and not there would put two different answers to one question on one
 *     screen.
 *
 * Currency is the provider's own on every row, so the sum needs no conversion.
 */
function DayOverview({ bookings, timezone, currency }) {
  const now = Date.now();

  const minutes = bookings.reduce(
    (total, booking) => total + (Number(booking.service.duration) || 0),
    0
  );

  const value = bookings.reduce(
    (total, booking) =>
      booking.status === "no_show" ? total : total + (Number(booking.service.price) || 0),
    0
  );

  const ahead = bookings.filter((booking) => Date.parse(booking.startsAt) > now).length;

  // The list is sorted by start, so the first start is the day's start. The last
  // *end* is found rather than taken from the last row: it is the same booking
  // in practice, but reducing says so instead of relying on it.
  const lastEnd = bookings.reduce(
    (latest, booking) => (Date.parse(booking.endsAt) > Date.parse(latest) ? booking.endsAt : latest),
    bookings[0].endsAt
  );

  return (
    <dl className="mb-6 grid grid-cols-2 gap-4 rounded-md border border-outline-variant bg-surface-container-lowest p-4 sm:grid-cols-4">
      <DayStat term="First to last">
        {formatTime(bookings[0].startsAt, timezone)} – {formatTime(lastEnd, timezone)}
      </DayStat>
      <DayStat term="Booked">{formatDuration(minutes)}</DayStat>
      <DayStat term="Value">{formatPrice(value, currency)}</DayStat>
      <DayStat term="Still ahead">
        {ahead === 0 ? "Day is done" : `${ahead} of ${bookings.length}`}
      </DayStat>
    </dl>
  );
}

/** One figure in the day overview. */
function DayStat({ term, children }) {
  return (
    <div className="min-w-0">
      <dt className="font-caption text-caption uppercase tracking-wider text-on-surface-variant">
        {term}
      </dt>
      <dd className="mt-0.5 truncate font-small text-small font-semibold tabular-nums text-on-surface">
        {children}
      </dd>
    </div>
  );
}

function ScheduleRow({ booking, timezone, isNext, gapBefore }) {
  const status = statusStyle(booking.status);
  const done = booking.status === "completed" || booking.status === "no_show";

  return (
    <>
      {gapBefore && (
        <div className="flex items-center gap-4 px-4 py-2">
          {/* Matches the time column's width below, so the break note lines up
              with the appointments either side of it. */}
          <div className="w-20 shrink-0 text-right" />
          <div className="mx-2 hidden h-4 w-px border-l border-dashed border-outline-variant sm:block" />
          <p className="font-caption text-caption italic text-on-surface-variant">
            {gapBefore} break
          </p>
        </div>
      )}

      <div
        className={`relative flex items-start gap-4 overflow-hidden rounded-md border p-4 ${
          isNext
            ? "border-primary/20 bg-primary/5"
            : done
              ? "border-outline-variant/50 bg-surface-container-low opacity-75"
              : "border-outline-variant bg-surface"
        }`}
      >
        {isNext && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary" />}

        <div className="w-20 shrink-0 pt-1 text-right">
          <p
            className={`font-small text-small ${
              isNext ? "font-semibold text-primary" : "text-on-surface-variant"
            }`}
          >
            {formatTime(booking.startsAt, timezone)}
          </p>
          {/* When it ends, which the row never said. "9:00 AM" alone leaves the
              one question a provider looking at their day actually has — how
              long am I in this for — answerable only by adding the duration
              printed three columns to the right. The panel already knew: every
              booking carries `endsAt`. */}
          <p className="mt-0.5 font-caption text-caption text-on-surface-variant">
            to {formatTime(booking.endsAt, timezone)}
          </p>
          {/* Only on the next one, and only while it is still ahead. Repeating
              a countdown beside every row of a day's schedule is noise, and
              printing one against an appointment that already happened would be
              worse than noise. */}
          {isNext && !done && (
            <p className="mt-0.5 font-caption text-[10px] font-semibold text-primary">
              {countdownTo(booking.startsAt)}
            </p>
          )}
        </div>

        <div className="mx-2 hidden h-12 w-px bg-outline-variant/50 sm:block" />

        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {/* The client's face. This column was two lines of text across
                two-thirds of the page's width, so there was room for it, and a
                provider recognises a regular by their photo faster than by
                reading a name off a list. */}
            <Avatar
              src={booking.client.avatarUrl}
              name={booking.client.name}
              size="sm"
              className="mt-0.5 border border-outline-variant"
            />

            <div className="min-w-0">
              <p
                className={`truncate font-body-lg text-body-lg font-semibold text-on-surface ${
                  done ? "line-through" : ""
                }`}
              >
                {booking.client.name}
              </p>
              <p className="truncate font-caption text-caption text-on-surface-variant">
                {booking.service.name} · {formatDuration(booking.service.duration)}
              </p>

              {/* What the client asked to be told, on the screen the provider
                  reads before they walk into the room. It was written on the
                  booking form and then only visible by opening the appointment,
                  which is one click too many for something this short and this
                  useful. Clamped to two lines, because the field allows 500
                  characters and a long one would push the rest of the day off
                  the screen. */}
              {booking.clientNote && (
                <p className="mt-1 line-clamp-2 font-caption text-caption italic text-on-surface-variant">
                  &ldquo;{booking.clientNote}&rdquo;
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* What the appointment is worth. A provider's own currency, so
                these never need converting — and it is the figure the earnings
                tiles above are made of, shown per appointment. */}
            <span className="font-small text-small font-semibold tabular-nums text-on-surface">
              {formatPrice(booking.service.price, booking.service.currency)}
            </span>
            <span className={status.className}>{status.label}</span>

            {/* A visible label, not just a `title`.

                This was a bare speech-bubble glyph. It did carry `title` and
                `aria-label`, so a screen reader always read it correctly — the
                gap was for everyone else. A `title` tooltip needs a mouse held
                still for about a second, cannot be styled, and never appears on
                a touch screen at all, which is where a provider checking their
                day is most likely to be. So the word is on the button.

                `aria-label` stays, and stays more specific than the visible
                text: "Message Priya Sharma" is the useful announcement in a
                list of several rows. It still begins with the visible label, so
                voice control ("click Message") continues to match it. */}
            <Link
              to={`/messages/${booking.id}`}
              aria-label={`Message ${booking.client.name}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-outline-variant px-3 py-2 font-caption text-caption font-semibold text-on-surface-variant transition-colors hover:bg-surface hover:text-primary"
            >
              <Icon name="chat" size={16} />
              Message
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function QuickAction({ to, icon, label, trailingIcon = "chevron_right", external = false }) {
  return (
    <Link
      to={to}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="group flex w-full items-center justify-between rounded-md border border-outline-variant p-3 transition-all hover:border-primary hover:bg-surface-container-lowest"
    >
      <span className="flex items-center gap-3">
        <Icon
          name={icon}
          size={20}
          className="text-on-surface-variant transition-colors group-hover:text-primary"
        />
        <span className="font-small text-small text-on-surface">{label}</span>
      </span>
      <Icon name={trailingIcon} size={18} className="text-outline-variant" />
    </Link>
  );
}

/**
 * The conversations behind the most recent appointments.
 *
 * The reference previews the last message in each thread. Slotly cannot: there
 * is no conversations endpoint, and fetching a thread is what marks it read — so
 * a preview here would silently clear the unread badge just by loading the
 * dashboard. Each row therefore carries the appointment it belongs to instead,
 * which is real and is what the thread is about.
 */
/**
 * The most recently active threads: who it was with, what was last said, and
 * when it was said.
 *
 * Every value here comes from a message. The panel previously rendered upcoming
 * *bookings* — the name was the appointment's client, the timestamp was the
 * appointment's start, and the order was by appointment date — which meant a box
 * headed "Recent Messages" routinely showed a future time like "in 2 days" for a
 * message nobody had sent.
 *
 * Unread threads are marked in place rather than summarised in a banner above
 * the list, so it is clear *which* conversation is waiting.
 */
function RecentConversations({ conversations, loading, unread }) {
  if (loading) return <SkeletonRows count={3} />;

  if (conversations.length === 0) {
    return (
      <p className="py-6 text-center font-caption text-caption text-on-surface-variant">
        {unread > 0
          ? "No conversations to show."
          : "No messages yet. A thread opens as soon as someone books with you."}
      </p>
    );
  }

  return (
    <div className="divide-y divide-outline-variant/30">
      {conversations.map((conversation) => (
        <Link
          key={conversation.bookingId}
          to={`/messages/${conversation.bookingId}`}
          className="-mx-2 flex cursor-pointer items-start gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-container-lowest"
        >
          <Avatar
            src={conversation.withUser.avatarUrl}
            name={conversation.withUser.name}
            size="md"
            className="border border-outline-variant"
          />

          <span className="min-w-0 flex-1">
            <span className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="truncate font-small text-small font-semibold text-on-surface">
                {conversation.withUser.name}
              </span>
              {/* The time the message was sent — always in the past, so this
                  reads "2 hours ago" rather than the "in 2 days" the old
                  appointment-based version produced. */}
              <span className="shrink-0 font-caption text-[10px] text-on-surface-variant">
                {relativeTime(conversation.lastMessage.at)}
              </span>
            </span>

            <span className="flex items-center gap-2">
              <span
                className={`block min-w-0 flex-1 truncate font-caption text-caption ${
                  conversation.unread > 0
                    ? "font-semibold text-on-surface"
                    : "text-on-surface-variant"
                }`}
              >
                {/* "You:" is what makes a thread list scannable — without it a
                    provider cannot tell whether they are waiting on a reply or
                    owe one. */}
                {conversation.lastMessage.fromMe && (
                  <span className="text-on-surface-variant">You: </span>
                )}
                {conversation.lastMessage.preview}
              </span>

              {conversation.unread > 0 && (
                <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-caption text-[10px] font-bold text-on-primary">
                  {conversation.unread > 9 ? "9+" : conversation.unread}
                </span>
              )}
            </span>

            <span className="mt-0.5 block truncate font-caption text-[10px] text-outline">
              {conversation.serviceName}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

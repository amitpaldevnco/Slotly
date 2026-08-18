/**
 * The client's dashboard — `my_dashboard`.
 *
 * Transcribed from the reference: a greeting, then a bento grid — the next
 * appointment as an eight-column feature, a four-column side column beside it,
 * and below them the upcoming list and a recent-activity timeline.
 *
 * ## Where this departs from the reference, and why
 *
 * The side column holds an appointment summary and a discovery card. It used to
 * hold four quick-action tiles (Book, Appointments, Messages, Settings), and
 * every one of them was a second copy of a sidebar link — a quarter of the page
 * spent repeating the navigation. Nothing was lost in removing them: the sidebar
 * still carries all four, including the unread badge on Messages.
 *
 * Two of the reference's panels ask for data Slotly does not have, and both are
 * answered with real figures rather than plausible ones:
 *
 *   - The summary counts *this client's own* bookings. The reference reads like
 *     a provider's business metrics; a client has no business, and platform-wide
 *     numbers here would be invented.
 *   - "Trending Services" is grouped from the public provider directory, so it
 *     is honestly "most providers" — there is no view or booking telemetry to
 *     rank popularity by.
 *
 * The activity feed is likewise built from the booking records themselves
 * (created, rescheduled, cancelled, completed), because there is no activity
 * endpoint and inventing one would mean inventing the events.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import * as bookingsApi from "../../api/bookings";
import * as providersApi from "../../api/providers";
import { useApiResource } from "../../hooks/useApiResource";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import EmptyState, { ErrorState, SkeletonRows } from "../ui/Feedback";
import { countdownTo, formatTime, greeting, relativeTime } from "../../lib/time";
import { container, formatDuration, statusStyle, zoneName } from "../../lib/ui";

export default function ClientDashboard({ user }) {
  const viewerZone = user.timezone || "UTC";

  const {
    data: upcomingData,
    loading,
    error,
    reload,
  } = useApiResource(({ signal }) => bookingsApi.list({ scope: "upcoming" }, { signal }), {
    deps: [],
    fallback: "Could not load your bookings.",
  });

  // The history behind the activity feed, and behind the empty state's wording.
  // Non-fatal: it must not be able to fail the whole page, so a rejection
  // resolves to an empty list rather than propagating.
  const { data: pastData, loading: pastLoading } = useApiResource(
    ({ signal }) => bookingsApi.list({ scope: "past" }, { signal }).catch(() => ({ bookings: [] })),
    { deps: [] }
  );

  const upcoming = useMemo(() => upcomingData?.bookings ?? [], [upcomingData]);
  const past = useMemo(() => pastData?.bookings ?? [], [pastData]);
  const next = upcoming[0] ?? null;
  const rest = upcoming.slice(1, 4);

  const activity = useMemo(() => buildActivity(upcoming, past), [upcoming, past]);

  // Has this client ever booked anything? A cancelled booking still counts —
  // they have been through the flow, so "your first appointment" would be wrong.
  const hasHistory = past.length > 0;

  // The most recent appointment they actually attended, which is the only one
  // worth naming back to them. Deliberately not "the most recent past booking":
  // that could be one they cancelled, and "you last saw X" would be a lie.
  const lastAttended = useMemo(() => {
    const completed = past.filter((booking) => booking.status === "completed");
    if (completed.length === 0) return null;
    return completed.reduce((latest, booking) =>
      new Date(booking.startsAt) > new Date(latest.startsAt) ? booking : latest
    );
  }, [past]);

  // With nothing upcoming, the empty state's wording depends on the history, so
  // it cannot be drawn until the history has arrived — otherwise a returning
  // client watches "first appointment" flip to "next appointment". A failed
  // upcoming request is exempt: that screen is an error, not an empty state, and
  // it should not wait on a second request it will never use.
  const awaitingHistory = !error && upcoming.length === 0 && pastLoading;

  const firstName = user.name?.split(" ")[0];

  return (
    <div className={`${container} py-margin-mobile md:py-margin-desktop`}>
      <div className="space-y-8">
        {/* Welcome */}
        <div>
          <h2 className="mb-2 font-h1-mobile text-h1-mobile text-primary md:font-h1 md:text-h1">
            {firstName ? `${greeting(viewerZone)}, ${firstName}` : "Your bookings"}
          </h2>
          <p className="font-body text-body text-on-surface-variant">
            Here is what&apos;s happening with your schedule today.
          </p>
        </div>

        {loading || awaitingHistory ? (
          <SkeletonRows count={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <div className="grid grid-cols-1 gap-gutter md:grid-cols-12">
            {/* Next appointment — the feature */}
            {next ? (
              <NextAppointment booking={next} viewerZone={viewerZone} />
            ) : (
              <div className="md:col-span-8">
                {/* Two different people see this panel: someone who has never
                    booked, who needs to be told what the product does, and
                    someone between appointments, who does not. */}
                <EmptyState
                  icon="event_available"
                  title={hasHistory ? "Book your next appointment" : "Book your first appointment"}
                  description={
                    hasHistory
                      ? lastAttended
                        ? `Nothing coming up. You last saw ${
                            lastAttended.provider.businessName || lastAttended.provider.name
                          } — book them again, or find someone new.`
                        : "Nothing coming up. Pick a provider and a time whenever you are ready."
                      : "Find a provider, pick a service and choose a time that suits you. It takes about a minute."
                  }
                  actionLabel={hasHistory ? "Book again" : "Find a service"}
                  actionTo="/providers"
                />
              </div>
            )}

            {/* Right column: a summary of the client's own bookings, then a way
                into discovery. Replaces the four quick-action tiles that used to
                sit here — every one of those was a duplicate of a sidebar link,
                so the column was spending a quarter of the page repeating the
                navigation. */}
            <div className="flex flex-col gap-4 md:col-span-4">
              <AppointmentSummary upcoming={upcoming} past={past} />
              <TrendingServices />
            </div>

            {/* Upcoming list */}
            <div className="rounded-lg border border-outline-variant bg-surface p-6 md:col-span-7">
              <div className="mb-6 flex items-center justify-between gap-3">
                <h3 className="font-h3 text-h3 text-primary">Upcoming Appointments</h3>
                <Link
                  to="/appointments"
                  className="font-small text-small text-primary hover:underline"
                >
                  View All
                </Link>
              </div>

              {rest.length === 0 ? (
                <p className="py-6 text-center font-caption text-caption text-on-surface-variant">
                  {next
                    ? "That is your only upcoming appointment."
                    : "Nothing scheduled after today."}
                </p>
              ) : (
                <div className="space-y-4">
                  {rest.map((booking) => (
                    <UpcomingRow key={booking.id} booking={booking} viewerZone={viewerZone} />
                  ))}
                </div>
              )}
            </div>

            {/* Recent activity */}
            <div className="rounded-lg border border-outline-variant bg-surface p-6 md:col-span-5">
              <h3 className="mb-6 font-h3 text-h3 text-primary">Recent Activity</h3>

              {activity.length === 0 ? (
                <p className="py-6 text-center font-caption text-caption text-on-surface-variant">
                  Nothing has happened yet.
                </p>
              ) : (
                <div className="relative space-y-8 border-l border-outline-variant pb-4 pl-6">
                  {activity.map((entry, index) => (
                    <div key={entry.id} className="relative">
                      <span
                        aria-hidden="true"
                        className={`absolute -left-[30px] top-1 h-3 w-3 rounded-full border-2 bg-surface ${
                          index === 0 ? "border-primary" : "border-outline"
                        }`}
                      />
                      <p className="font-small text-small text-primary">{entry.title}</p>
                      <p className="font-caption text-caption text-on-surface-variant">
                        {entry.body}
                      </p>
                      <span className="mt-1 block font-caption text-caption text-outline">
                        {relativeTime(entry.at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <p className="flex items-center gap-2 font-caption text-caption text-on-surface-variant">
          <Icon name="public" size={14} />
          Every time on this page is shown in {zoneName(viewerZone)}.{" "}
          <Link to="/settings" className="font-semibold text-primary underline underline-offset-2">
            Change it
          </Link>
        </p>
      </div>
    </div>
  );
}

/** The eight-column feature card. */
function NextAppointment({ booking, viewerZone }) {
  const provider = booking.provider;
  const start = DateTime.fromISO(booking.startsAt).setZone(viewerZone);
  const isToday = start.hasSame(DateTime.now().setZone(viewerZone), "day");

  return (
    <div className="flex flex-col justify-between rounded-lg border border-outline-variant bg-surface p-6 transition-shadow hover:shadow-raise md:col-span-8 lg:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 font-caption text-caption font-bold uppercase tracking-wider text-primary">
            Up Next
          </span>
          <h3 className="font-h2 text-h2 text-primary">{booking.service.name}</h3>
          <p className="mt-1 font-body text-body text-on-surface-variant">
            with {provider.businessName || provider.name}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-h3 text-h3 text-primary">{formatTime(booking.startsAt, viewerZone)}</p>
          <p className="font-small text-small text-on-surface-variant">
            {isToday ? "Today" : start.toFormat("ccc d LLL")},{" "}
            {formatDuration(booking.service.duration)}
          </p>
          {/* How long until it starts. The date and time above answer "when is
              it"; this answers "how much time do I have", which is the question
              someone glancing at a dashboard is actually asking. */}
          <p className="mt-1 inline-flex items-center gap-1 font-caption text-caption font-semibold text-primary">
            <Icon name="schedule" size={12} />
            {countdownTo(booking.startsAt)}
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-4 border-t border-outline-variant pt-6">
        <Avatar
          src={provider.avatarUrl}
          name={provider.name}
          size="md"
          className="border border-outline-variant"
        />
        <p className="mr-auto min-w-0 truncate font-small text-small text-on-surface-variant">
          {provider.name}
        </p>

        <Link
          to={`/bookings/${booking.id}`}
          className="flex h-10 items-center justify-center rounded-md bg-primary px-6 font-small text-small text-on-primary transition-colors hover:bg-primary/90"
        >
          View Details
        </Link>
        <Link
          to={`/messages/${booking.id}`}
          className="flex h-10 items-center justify-center rounded-md border border-outline-variant bg-transparent px-6 font-small text-small text-primary transition-colors hover:bg-surface-container-low"
        >
          Message
        </Link>
      </div>
    </div>
  );
}

/**
 * The dark summary card: how many appointments this client has, how many they
 * have been to, and how many are still ahead.
 *
 * Every figure is counted from the two booking lists the dashboard has already
 * fetched, so the card costs no extra request. The counts are deliberately of
 * *this client's own* bookings — the reference mockup reads like a provider's
 * business metrics, but a client has no business, and inventing platform-wide
 * numbers here would be inventing data.
 *
 * "Done" counts only `completed`. A cancelled appointment is in the history but
 * was never attended, so folding it in would overstate what the client has
 * actually been to — while still counting toward Total, because they did book it.
 *
 * @param {{upcoming: Array, past: Array}} props The two lists as the API returned
 *   them; `upcoming` is already filtered to active bookings by the server.
 */
function AppointmentSummary({ upcoming, past }) {
  const done = past.filter((booking) => booking.status === "completed").length;
  const stats = [
    { value: upcoming.length + past.length, label: "Total" },
    { value: done, label: "Done" },
    { value: upcoming.length, label: "Next" },
  ];

  return (
    <div className="rounded-lg bg-primary-container p-6 text-on-primary shadow-raise">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="font-small text-small font-semibold opacity-80">Appointment Summary</span>
        <Icon name="analytics" size={20} className="opacity-80" />
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {stats.map(({ value, label }) => (
          <div key={label} className="text-center">
            <dd className="font-h3 text-h3 font-bold tabular-nums">{value}</dd>
            <dt className="font-caption text-caption opacity-70">{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Material Symbols glyph per business type, so the categories are scannable. */
const CATEGORY_ICONS = {
  physiotherapy: "exercise",
  physio: "exercise",
  healthcare: "stethoscope",
  health: "stethoscope",
  wellness: "spa",
  fitness: "fitness_center",
  tutoring: "school",
  education: "school",
  consulting: "strategy",
  business: "strategy",
  legal: "gavel",
  beauty: "content_cut",
  therapy: "psychology",
};

/** Falls back to a generic tag rather than leaving a hole for an unknown type. */
function categoryIcon(category) {
  const key = String(category || "").toLowerCase();
  const match = Object.keys(CATEGORY_ICONS).find((name) => key.includes(name));
  return match ? CATEGORY_ICONS[match] : "category";
}

/**
 * The discovery card: which kinds of provider are on the platform, and how many
 * of each.
 *
 * Counted client-side from the provider directory rather than read from a
 * dedicated endpoint, because there isn't one and the directory is a single
 * cheap public request that the discovery page already makes. "Trending" is
 * therefore honestly just "most providers" — there is no view or booking
 * telemetry to rank by, and labelling a popularity ranking onto data that cannot
 * support it would be a lie told in the UI.
 *
 * The whole card is non-essential, so a failed request resolves to an empty list
 * and the card simply renders its call to action. A dashboard must not lose its
 * summary because a nice-to-have panel could not load.
 */
function TrendingServices() {
  const { data: providers } = useApiResource(
    ({ signal }) => providersApi.list({}, { signal }).catch(() => ({ providers: [] })),
    { deps: [], initialData: { providers: [] } }
  );

  const categories = useMemo(() => {
    const counts = new Map();

    for (const provider of providers?.providers ?? []) {
      const name = provider.businessType?.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([name, count]) => ({ name, count }));
  }, [providers]);

  return (
    <div className="rounded-lg border border-outline-variant bg-surface p-6">
      <h3 className="mb-4 font-small text-small font-bold text-primary">Trending Services</h3>

      {categories.length === 0 ? (
        <p className="py-2 font-caption text-caption text-on-surface-variant">
          No providers listed yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {categories.map(({ name, count }) => (
            <li key={name}>
              <Link
                to={`/providers?category=${encodeURIComponent(name)}`}
                className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-surface-container-low"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon name={categoryIcon(name)} size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-small text-small font-semibold text-primary">
                    {name}
                  </span>
                  <span className="block font-caption text-caption text-on-surface-variant">
                    {count} active provider{count === 1 ? "" : "s"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        to="/providers"
        className="mt-4 flex w-full items-center justify-center rounded-md border border-outline-variant py-2 font-small text-small font-semibold text-primary transition-colors hover:bg-surface-container-low"
      >
        Explore All Services
      </Link>
    </div>
  );
}

function UpcomingRow({ booking, viewerZone }) {
  const status = statusStyle(booking.status);
  const start = DateTime.fromISO(booking.startsAt).setZone(viewerZone);

  return (
    <Link
      to={`/bookings/${booking.id}`}
      className="flex items-center justify-between gap-4 rounded-md border border-outline-variant p-4 transition-colors hover:bg-surface-container-lowest"
    >
      <span className="flex min-w-0 items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full bg-surface-container-high text-primary">
          <span className="font-small text-small font-bold leading-none">
            {start.toFormat("h:mm")}
          </span>
          <span className="mt-0.5 font-caption text-[10px] leading-none">
            {start.toFormat("a")}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate font-small text-small text-primary">
            {booking.service.name}
          </span>
          <span className="block truncate font-caption text-caption text-on-surface-variant">
            {booking.provider.businessName || booking.provider.name} ·{" "}
            {start.toFormat("ccc d LLL")}
          </span>
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className={status.className}>{status.label}</span>
        <span className="font-caption text-caption text-on-surface-variant">
          {countdownTo(booking.startsAt)}
        </span>
      </span>
    </Link>
  );
}

/**
 * The activity feed, derived from the bookings themselves.
 *
 * `createdAt` is when it was booked; `cancelledAt` is when it was called off;
 * `updatedAt` on a completed or rescheduled booking is when that happened. Those
 * four columns are the whole of what Slotly records about a booking's life
 * outside its audit trail, which has no cross-booking endpoint.
 */
function buildActivity(upcoming, past) {
  const entries = [];

  for (const booking of [...upcoming, ...past]) {
    const who = booking.provider.businessName || booking.provider.name;

    if (booking.createdAt) {
      entries.push({
        id: `created-${booking.id}`,
        at: booking.createdAt,
        title: "Appointment booked",
        body: `${booking.service.name} with ${who}.`,
      });
    }

    if (booking.status === "cancelled" && booking.cancelledAt) {
      entries.push({
        id: `cancelled-${booking.id}`,
        at: booking.cancelledAt,
        title: "Appointment cancelled",
        body: `${booking.service.name} with ${who}.`,
      });
    }

    if (booking.status === "rescheduled" && booking.updatedAt) {
      entries.push({
        id: `moved-${booking.id}`,
        at: booking.updatedAt,
        title: "Appointment rescheduled",
        body: `${booking.service.name} with ${who} moved.`,
      });
    }

    if (booking.status === "completed" && booking.updatedAt) {
      entries.push({
        id: `done-${booking.id}`,
        at: booking.updatedAt,
        title: "Appointment completed",
        body: `${booking.service.name} with ${who}.`,
      });
    }
  }

  return entries.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 4);
}

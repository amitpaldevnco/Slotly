/**
 * The booking flow: pick a day, pick a time, confirm.
 *
 * ## The layout, and why it changed
 *
 * This was a vertical scroll: a week's worth of days, each rendered as its own
 * full-width card with a heading and a wrapped grid of time buttons inside it. A
 * provider open six days a week produced six stacked cards, so choosing between
 * Tuesday at 2pm and Thursday at 10am meant scrolling between them and holding
 * both in your head. The page's own height also changed every time the week did.
 *
 * It is now two panes: the days across the top (or down the side on a desktop),
 * and the times for the selected day beside them. One day's times are visible at
 * a time, the day strip shows at a glance which days have anything free, and the
 * page height is stable because only one column's worth of times ever renders.
 *
 * The service summary moves into a sidebar, where it stays visible while the
 * client is choosing — it was a header that scrolled away exactly when they were
 * deciding whether the price was worth it.
 *
 * ## What happens when someone else takes the slot you are looking at
 *
 * The position taken here is: **do not poll, and do not pretend the list is
 * live.** Silently removing a slot from under the cursor is worse than letting
 * the click fail — the user is left wondering whether they misread it. Instead:
 *
 *   - the list carries a visible "as of" time so it never claims to be live;
 *   - a `409 SLOT_TAKEN` is caught and explained in plain words;
 *   - the list refreshes immediately on that failure, so the taken slot
 *     disappears at the one moment the user is looking for an explanation;
 *   - the slot they tried to take is called out by name in the message, so they
 *     can see which one went.
 *
 * That turns a lost race into an ordinary, legible outcome instead of an error.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DateTime } from "luxon";
import { parseApiError } from "../api/client";
import * as bookingsApi from "../api/bookings";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Page, { PageHeader, Section, SplitLayout } from "../components/ui/Page";
import Icon from "../components/ui/Icon";
import Modal from "../components/ui/Modal";
import Field, { Textarea, CharCount } from "../components/ui/Field";
import EmptyState, { ErrorState, PageLoader, SkeletonRows } from "../components/ui/Feedback";
import {
  addDaysToDate,
  browserTimezone,
  formatTime,
  friendlyDateHeading,
  todayIn,
} from "../lib/time";
import {
  primaryButton,
  secondaryButton,
  ghostButton,
  buttonSm,
  iconButton,
  insetClasses,
  metric,
  metricLg,
  formatPrice,
  formatDuration,
  metaLine,
  zoneName,
} from "../lib/ui";

/** How many days of slots to request at once. */
const WINDOW_DAYS = 7;

/** Longest a note may be, matching the API's own validation. */
const MAX_NOTE = 500;

export default function BookServicePage() {
  const { providerId, serviceId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // The zone every time on this page is rendered in. The user's saved zone wins
  // over the browser's guess: someone travelling should still see their
  // appointments in the zone they actually plan around.
  const viewerTimezone = user?.timezone || browserTimezone();

  const [rangeStart, setRangeStart] = useState(() => todayIn(viewerTimezone));

  // Which day's times are showing. Held as an ISO date rather than an index, so
  // it survives a window change that returns a different number of days.
  const [selectedDate, setSelectedDate] = useState(null);

  const [selectedSlot, setSelectedSlot] = useState(null);
  const [note, setNote] = useState("");
  const [booking, setBooking] = useState(false);

  const rangeEnd = useMemo(() => addDaysToDate(rangeStart, WINDOW_DAYS - 1), [rangeStart]);

  // Paging to another week re-runs this. The hook aborts the previous request
  // first, so paging twice in quick succession cannot let the slower first
  // response land last and display the wrong week's times.
  const {
    data,
    loading,
    error,
    reload: loadSlots,
  } = useApiResource(
    ({ signal }) =>
      providersApi.getSlots(
        providerId,
        { serviceId, from: rangeStart, to: rangeEnd, timezone: viewerTimezone },
        { signal }
      ),
    {
      deps: [providerId, serviceId, rangeStart, rangeEnd, viewerTimezone],
      fallback: "Could not load available times.",
    }
  );

  // When the times on screen were last known to be accurate. Derived from the
  // data rather than set in the fetch, so it can only ever move when a response
  // actually arrives.
  const [fetchedAt, setFetchedAt] = useState(null);
  useEffect(() => {
    if (data) setFetchedAt(new Date());
  }, [data]);

  // Memoised on `data`, not derived inline: `data?.days ?? []` is a fresh array
  // identity on every render, so the effect below — which depends on it — would
  // re-run forever and fight the user's own day selection.
  const days = useMemo(() => data?.days ?? [], [data]);

  // Land on the first day that actually has times. Without this, a week whose
  // Monday is closed opened on an empty pane and looked like a provider with no
  // availability at all.
  useEffect(() => {
    if (days.length === 0) {
      setSelectedDate(null);
      return;
    }

    setSelectedDate((current) => {
      // Keep the client's choice if the new window still contains it — a refresh
      // after a lost race must not move them off the day they were looking at.
      if (current && days.some((day) => day.date === current)) return current;
      return days.find((day) => day.slots.length > 0)?.date ?? days[0].date;
    });
  }, [days]);

  const activeDay = days.find((day) => day.date === selectedDate) || null;

  const handleConfirm = async () => {
    if (!selectedSlot) return;

    setBooking(true);
    try {
      const created = await bookingsApi.create({
        serviceId: Number(serviceId),
        // Sent back exactly as received. Reformatting it here would be a chance
        // to introduce a timezone bug for no benefit — the server and the client
        // already agree on this instant.
        startsAt: selectedSlot.startsAt,
        ...(note.trim() ? { note: note.trim() } : {}),
      });

      setSelectedSlot(null);
      setNote("");
      toast.success("Booking confirmed.", { title: "You're booked in" });
      navigate(`/bookings/${created.id}?justBooked=1`);
    } catch (err) {
      const parsed = parseApiError(err, "Could not complete that booking.");

      if (parsed.code === "SLOT_TAKEN") {
        // The lost race, handled as an ordinary outcome. Naming the time makes
        // it obvious which slot went, and the refresh removes it from the list.
        const lostTime = formatTime(selectedSlot.startsAt, viewerTimezone);
        setSelectedSlot(null);
        toast.error(`Someone booked ${lostTime} moments before you. Here are the times still free.`, {
          title: "That slot just went",
          duration: 8000,
        });
        loadSlots();
      } else if (parsed.code === "SLOT_UNAVAILABLE") {
        setSelectedSlot(null);
        toast.error("That time is no longer offered. The list has been refreshed.");
        loadSlots();
      } else if (parsed.code === "MINIMUM_NOTICE_REQUIRED") {
        // Shouldn't happen through this picker — generateSlots() already
        // excludes same-day slots — but the server enforces it independently,
        // so a direct API call or a stale cached page can still hit it. The
        // server's own message already names the earliest available date.
        setSelectedSlot(null);
        toast.error(parsed.message, { title: "A little more notice needed", duration: 8000 });
      } else {
        toast.error(parsed.message);
      }
    } finally {
      setBooking(false);
    }
  };

  if (loading && !data) return <PageLoader label="Finding available times…" />;

  if (error && !data) {
    return (
      <Page narrow>
        <ErrorState message={error} onRetry={loadSlots}>
          <Link to={`/providers/${providerId}`} className={`${primaryButton} ${buttonSm}`}>
            Back to provider
          </Link>
        </ErrorState>
      </Page>
    );
  }

  const service = data?.service;
  const isFirstWindow = rangeStart === todayIn(viewerTimezone);
  const totalFree = days.reduce((sum, day) => sum + day.slots.length, 0);

  return (
    <Page>
      <PageHeader
        back={
          <Link
            to={`/providers/${providerId}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 transition hover:text-ink"
          >
            <Icon name="arrowLeft" size={15} />
            Back to provider
          </Link>
        }
        title={service?.name || "Choose a time"}
        description="Pick a day, then a time. Every time below is in your own timezone."
      />

      <SplitLayout
        aside={
          <>
            <Section title="What you're booking" flush>
              <dl className="divide-y divide-line-soft text-sm">
                <SummaryRow label="Service" value={service?.name} />
                <SummaryRow label="Duration" value={formatDuration(service?.duration)} />
                <SummaryRow
                  label="Price"
                  value={<span className={metric}>{formatPrice(service?.price)}</span>}
                />
                {(service?.bufferBefore > 0 || service?.bufferAfter > 0) && (
                  <SummaryRow
                    label="Time held"
                    value={metaLine(
                      service.bufferBefore > 0 ? `${service.bufferBefore}m before` : null,
                      service.bufferAfter > 0 ? `${service.bufferAfter}m after` : null
                    )}
                  />
                )}
              </dl>
            </Section>

            <TimezonePanel
              clientTimezone={data?.clientTimezone}
              providerTimezone={data?.providerTimezone}
            />

            {fetchedAt && (
              <div className="rounded-lg border border-line bg-subtle px-3 py-2.5">
                {/* Stated openly rather than implying the list updates itself. */}
                <p className="text-xs leading-relaxed text-ink-3">
                  Availability as of{" "}
                  <span className="font-medium text-ink-2">
                    {formatTime(fetchedAt.toISOString(), viewerTimezone)}
                  </span>
                  . Slots can be taken by someone else at any moment.
                </p>
                <button
                  type="button"
                  onClick={loadSlots}
                  disabled={loading}
                  className={`mt-2 ${secondaryButton} ${buttonSm} w-full`}
                >
                  <Icon name="refresh" size={14} />
                  {loading ? "Refreshing…" : "Refresh times"}
                </button>
              </div>
            )}
          </>
        }
      >
        <Section
          title="Choose a day"
          description={
            loading
              ? "Loading…"
              : `${totalFree} time${totalFree === 1 ? "" : "s"} free this week`
          }
          actions={
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRangeStart(addDaysToDate(rangeStart, -WINDOW_DAYS))}
                disabled={isFirstWindow}
                aria-label="Earlier week"
                className={iconButton}
              >
                <Icon name="chevronLeft" size={16} />
              </button>
              <button
                type="button"
                onClick={() => setRangeStart(addDaysToDate(rangeStart, WINDOW_DAYS))}
                aria-label="Later week"
                className={iconButton}
              >
                <Icon name="chevronRight" size={16} />
              </button>
              {!isFirstWindow && (
                <button
                  type="button"
                  onClick={() => setRangeStart(todayIn(viewerTimezone))}
                  className={`${ghostButton} ${buttonSm}`}
                >
                  This week
                </button>
              )}
            </div>
          }
          flush
        >
          {loading ? (
            <div className="p-4">
              <SkeletonRows count={2} variant="line" />
            </div>
          ) : days.length === 0 ? (
            <EmptyState
              compact
              icon="calendar"
              title="No times available this week"
              description="Try a later week — cancelled appointments come straight back into the list."
              actionLabel="Show the next week"
              onAction={() => setRangeStart(addDaysToDate(rangeStart, WINDOW_DAYS))}
            />
          ) : (
            <>
              <DayStrip
                days={days}
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
                timezone={viewerTimezone}
              />

              <div className="border-t border-line p-3 sm:p-4">
                {!activeDay ? null : activeDay.slots.length === 0 ? (
                  <EmptyState
                    compact
                    icon="ban"
                    title={`Nothing free on ${friendlyDateHeading(activeDay.date, viewerTimezone)}`}
                    description="Pick another day above, or try a later week."
                  />
                ) : (
                  <>
                    <h3 className="mb-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3">
                      {friendlyDateHeading(activeDay.date, viewerTimezone)} ·{" "}
                      {activeDay.slots.length} time{activeDay.slots.length === 1 ? "" : "s"}
                    </h3>

                    {/* A fixed-width grid rather than a wrapped flex row. Times
                        in a grid line up in columns, which is what lets the eye
                        find "the 2 o'clocks" without reading each button. */}
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
                      {activeDay.slots.map((slot) => (
                        <li key={slot.startsAt}>
                          <button
                            type="button"
                            // The day's own date travels with the selection.
                            // Deriving it from `startsAt` would give the *UTC*
                            // date, which is the wrong day for anyone whose local
                            // date differs from it — exactly the class of bug this
                            // app exists to avoid.
                            onClick={() => setSelectedSlot({ ...slot, localDate: activeDay.date })}
                            className="flex w-full min-h-11 flex-col items-center justify-center rounded-md border border-brand-line bg-surface px-2 py-1.5 text-sm font-medium text-brand-ink transition hover:border-brand hover:bg-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand hover:text-white"
                          >
                            {slot.clientTime}
                            {/* The provider's local time in small print: useful
                                context across a large offset, quiet enough not to
                                clutter the grid. */}
                            {slot.providerTime !== slot.clientTime && (
                              <span className="text-[0.625rem] font-normal opacity-70">
                                {slot.providerTime} there
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </Section>
      </SplitLayout>

      <Modal
        open={Boolean(selectedSlot)}
        onClose={() => !booking && setSelectedSlot(null)}
        title="Confirm your booking"
        description={service?.name}
        footer={
          <>
            <button
              type="button"
              onClick={() => setSelectedSlot(null)}
              disabled={booking}
              className={secondaryButton}
            >
              Back
            </button>
            <button type="button" onClick={handleConfirm} disabled={booking} className={primaryButton}>
              {booking ? "Booking…" : "Confirm booking"}
            </button>
          </>
        }
      >
        {selectedSlot && (
          <div className="space-y-4">
            <div className={insetClasses}>
              {/* The time, big, because it is the one thing being confirmed. */}
              <p className={metricLg}>{selectedSlot.clientTime}</p>
              <p className="mt-0.5 text-sm font-medium text-ink-2">
                {friendlyDateHeading(selectedSlot.localDate, viewerTimezone)}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
                {metaLine(
                  zoneName(data?.clientTimezone),
                  formatDuration(service?.duration),
                  formatPrice(service?.price)
                )}
              </p>

              {/* Both timezones before the user commits — the same pairing the
                  confirmation screen shows afterwards. Only when they differ. */}
              {data?.clientTimezone !== data?.providerTimezone && (
                <p className="mt-2.5 flex items-start gap-1.5 border-t border-line pt-2.5 text-xs leading-relaxed text-ink-2">
                  <Icon name="globe" size={13} className="mt-0.5" />
                  <span>
                    That is <span className="font-medium text-ink">{selectedSlot.providerTime}</span> for
                    the provider in {zoneName(data?.providerTimezone)}.
                  </span>
                </p>
              )}
            </div>

            <Field
              id="booking-note"
              label="Anything they should know?"
              optional
              hint="Shared with the provider only."
              action={<CharCount value={note} max={MAX_NOTE} />}
            >
              <Textarea
                id="booking-note"
                rows={3}
                maxLength={MAX_NOTE}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. First session, back pain on the left side"
              />
            </Field>
          </div>
        )}
      </Modal>
    </Page>
  );
}

/**
 * The day picker.
 *
 * ## Why a strip and not a month grid
 *
 * A month calendar is the obvious reference for this, and it is the wrong control
 * here: the API returns a seven-day window, so five of the six visible weeks in a
 * month grid would have no data behind them and would either look closed or need
 * their own fetch on hover. A strip shows exactly the window that was fetched, and
 * says how many times each day holds — which a month cell cannot.
 *
 * Scrolls sideways on a phone rather than wrapping, so the seven days stay one row
 * and the times below them stay on the screen.
 */
function DayStrip({ days, selectedDate, onSelect, timezone }) {
  const today = todayIn(timezone);

  return (
    <div
      role="tablist"
      aria-label="Choose a day"
      className="no-scrollbar flex gap-1.5 overflow-x-auto p-3 sm:grid sm:grid-cols-7 sm:gap-2 sm:p-4"
    >
      {days.map((day) => {
        const date = DateTime.fromISO(day.date, { zone: timezone });
        const active = day.date === selectedDate;
        const free = day.slots.length;
        const isToday = day.date === today;

        return (
          <button
            key={day.date}
            type="button"
            role="tab"
            aria-selected={active}
            // A day with nothing free is still reachable: pressing it explains
            // that it is closed, which is more useful than a dead control that
            // gives no reason.
            onClick={() => onSelect(day.date)}
            className={`flex min-w-[4.25rem] shrink-0 flex-col items-center gap-0.5 rounded-md border px-2 py-2 transition ${
              active
                ? "border-brand bg-brand text-white"
                : free === 0
                  ? "border-line bg-subtle text-ink-3 hover:border-ink-3/30"
                  : "border-line bg-surface text-ink hover:border-brand-line hover:bg-brand-soft"
            }`}
          >
            <span
              className={`text-[0.625rem] font-medium uppercase tracking-wide ${
                active ? "text-white/75" : "text-ink-3"
              }`}
            >
              {date.toFormat("ccc")}
            </span>
            <span className="text-base font-semibold tabular-nums leading-none">
              {date.toFormat("d")}
            </span>
            <span className={`text-[0.625rem] ${active ? "text-white/80" : "text-ink-3"}`}>
              {free === 0 ? "—" : free}
            </span>
            {/* Marks today without relying on it being the first column, which it
                is not once the client browses to a later week. */}
            {isToday && !active && (
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-brand" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * States both zones.
 *
 * Shown even when the two match — the reassurance is the point, and a panel that
 * appears and disappears depending on who is looking is harder to trust than one
 * that is always there.
 */
function TimezonePanel({ clientTimezone, providerTimezone }) {
  if (!clientTimezone) return null;

  const sameZone = clientTimezone === providerTimezone;

  return (
    <div className="rounded-lg border border-brand-line bg-brand-soft px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-brand-ink">
        <Icon name="globe" size={13} />
        Timezones
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-brand-ink">
        {sameZone ? (
          <>
            You and this provider are both in{" "}
            <span className="font-semibold">{zoneName(clientTimezone)}</span>, so the times above need
            no conversion.
          </>
        ) : (
          <>
            Times above are in <span className="font-semibold">{zoneName(clientTimezone)}</span> —
            yours. The provider is in{" "}
            <span className="font-semibold">{zoneName(providerTimezone)}</span>.
          </>
        )}
      </p>
    </div>
  );
}

function SummaryRow({ label, value }) {
  if (value == null) return null;

  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-[0.8125rem] text-ink-2">{value}</dd>
    </div>
  );
}

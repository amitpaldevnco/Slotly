/**
 * The booking flow: pick a day on a month calendar, pick a time, confirm.
 *
 * ## The layout
 *
 * Transcribed from the reference: a "Booking Details" column on the left holding
 * the provider and the service being bought, and beside it "Select Date & Time" —
 * a month calendar with the day's free times in a column next to it, and Confirm
 * Booking under them.
 *
 * ## Why a month grid is affordable here
 *
 * An earlier version of this screen used a seven-day strip on the grounds that a
 * month grid would have five weeks of cells with no data behind them. That is not
 * true of this API: `GET /providers/:id/slots` accepts any range up to
 * `MAX_RANGE_DAYS` (62), so one request covers the whole visible month and every
 * cell knows whether it has times. A day the provider is closed is drawn as
 * closed because the response says so, not because nothing was asked.
 *
 * The response only contains dates that *have* slots, which is exactly the shape
 * the calendar wants — presence in the map is availability.
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
 *
 * ## The one thing that *is* removed without being asked: a time that has passed
 *
 * Booking is real time, so today's remaining slots are on the list and the
 * earliest of them can be minutes away. A response held on screen therefore goes
 * stale in a way it never used to: leave this page open through 10:00 and the
 * 10:00 button is still sitting there, and pressing it can only fail.
 *
 * A slot whose time has *gone* is treated differently from one someone else took,
 * because the two are not the same event. Nobody took it; there is nothing to
 * explain and nobody to be surprised by. So `usableSlots` drops it on a one-minute
 * tick — see `useMinuteTick` — which is a clock, not a poll: no request is made,
 * and the server is still the only thing that decides what is bookable. Removing
 * it is strictly kinder than leaving a button that cannot work.
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
import Page from "../components/ui/Page";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import Field, { Textarea, CharCount } from "../components/ui/Field";
import EmptyState, { ErrorState, PageLoader, SkeletonRows } from "../components/ui/Feedback";
import { browserTimezone, formatTime, todayIn } from "../lib/time";
import {
  primaryButton,
  buttonSm,
  iconButton,
  formatPrice,
  formatDuration,
  zoneName,
} from "../lib/ui";

/** Longest a note may be, matching the API's own validation. */
const MAX_NOTE = 500;

/** The design's week starts on Sunday. */
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Cells in the month grid. Always six rows, so the calendar does not change
 * height between a month that needs five and one that needs six — the times
 * beside it would jump every time the client paged.
 */
const GRID_CELLS = 42;

/** How often the page re-checks which of the times on screen have gone by. */
const TICK_MS = 60_000;

/**
 * A value that changes once a minute, for re-deriving "has this time passed?".
 *
 * Deliberately a clock and not a poll. It issues no request and learns nothing
 * new from the server — it only re-runs the comparison the page can already make
 * for itself, so a slot that has quietly gone by stops being offered. Refreshing
 * the *list* on a timer would be the polling this page explicitly does not do.
 *
 * The interval is cleared on unmount, so nothing keeps ticking behind a page the
 * client has navigated away from.
 */
function useMinuteTick() {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return tick;
}

export default function BookServicePage() {
  const { providerId, serviceId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // The zone every time on this page is rendered in. The user's saved zone wins
  // over the browser's guess: someone travelling should still see their
  // appointments in the zone they actually plan around.
  const viewerTimezone = user?.timezone || browserTimezone();

  const [monthStart, setMonthStart] = useState(() =>
    DateTime.now().setZone(viewerTimezone).startOf("month").toFormat("yyyy-MM-dd")
  );

  // Held as an ISO date rather than an index, so it survives a month change that
  // returns a different set of days.
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [note, setNote] = useState("");
  const [booking, setBooking] = useState(false);

  const monthEnd = useMemo(
    () => DateTime.fromISO(monthStart).endOf("month").toFormat("yyyy-MM-dd"),
    [monthStart]
  );

  /**
   * Who the client is booking with, and the service's own description.
   *
   * Neither is on the slots endpoint, and neither is worth failing the page for —
   * a booking can be completed without knowing the provider's business type. Both
   * requests therefore swallow their own errors and the panel degrades to what it
   * does have.
   */
  const { data: profile } = useApiResource(
    async ({ signal }) => {
      const [provider, services] = await Promise.all([
        providersApi.get(providerId, { signal }).catch(() => null),
        providersApi.listServices(providerId, { signal }).catch(() => []),
      ]);
      return { provider, services };
    },
    { deps: [providerId] }
  );

  const provider = profile?.provider ?? null;
  const serviceDetail =
    (profile?.services ?? []).find((item) => String(item.id) === String(serviceId)) ?? null;

  // Paging to another month re-runs this. The hook aborts the previous request
  // first, so paging twice in quick succession cannot let the slower first
  // response land last and display the wrong month's times.
  const {
    data,
    loading,
    refreshing,
    error,
    reload: loadSlots,
  } = useApiResource(
    ({ signal }) =>
      providersApi.getSlots(
        providerId,
        { serviceId, from: monthStart, to: monthEnd, timezone: viewerTimezone },
        { signal }
      ),
    {
      deps: [providerId, serviceId, monthStart, monthEnd, viewerTimezone],
      fallback: "Could not load available times.",
      keepPreviousData: true,
    }
  );

  // When the times on screen were last known to be accurate. Derived from the
  // data rather than set in the fetch, so it can only ever move when a response
  // actually arrives.
  const [fetchedAt, setFetchedAt] = useState(null);
  useEffect(() => {
    if (data) setFetchedAt(new Date());
  }, [data]);

  // The instant "has this passed?" is judged against, re-read on the minute so
  // times that have gone by drop off the list without a request. See
  // useMinuteTick().
  const now = useMinuteTick();

  /**
   * Date → its free slots, with anything already started left out.
   *
   * The endpoint only returns dates that have something free, so membership of
   * this map *is* availability — a calendar cell needs no second question. A day
   * whose every remaining time has passed drops out of the map entirely, which is
   * what makes its calendar cell go quiet by itself rather than staying clickable
   * over an empty pane.
   *
   * The comparison is instant against instant: `startsAt` is the UTC instant the
   * server sent, and `now` is a reading of the same clock. No wall-clock string,
   * and no timezone, is involved in deciding this — the viewer's zone affects
   * only how the surviving times are *labelled*.
   *
   * `now` is the ticking value rather than a fresh `Date.now()` because it is
   * what makes this recompute at all: `data` has not changed when a slot lapses,
   * so the tick is the dependency that notices.
   */
  const slotsByDate = useMemo(() => {
    const map = new Map();

    for (const day of data?.days ?? []) {
      const stillAhead = day.slots.filter((slot) => Date.parse(slot.startsAt) > now);
      if (stillAhead.length > 0) map.set(day.date, stillAhead);
    }

    return map;
  }, [data, now]);

  // Taken from the filtered map rather than from `data.days`, which is why it is
  // not simply `data.days[0].date`: today can be the first day the server
  // returned and still have nothing left on it by the time the client looks. The
  // map is built in the server's ascending date order, so its first key is the
  // earliest date that genuinely still has a time on offer.
  const firstAvailable = slotsByDate.keys().next().value ?? null;

  // Land on the first day that actually has times. Without this, a month whose
  // 1st is closed opens on an empty pane and looks like a provider with no
  // availability at all.
  useEffect(() => {
    setSelectedDate((current) => {
      // Keep the client's choice if the new month still contains it — a refresh
      // after a lost race must not move them off the day they were looking at.
      if (current && slotsByDate.has(current)) return current;
      return firstAvailable;
    });
  }, [slotsByDate, firstAvailable]);

  // A time chosen on Tuesday means nothing once the client is looking at Friday.
  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate]);

  // Nor does a time that has since gone by, even if it is still selected. Letting
  // it stay selected would leave Confirm Booking enabled over a slot the list no
  // longer shows, and the only possible outcome would be a refusal.
  useEffect(() => {
    setSelectedSlot((current) => (current && Date.parse(current.startsAt) <= now ? null : current));
  }, [now]);

  const daySlots = selectedDate ? (slotsByDate.get(selectedDate) ?? []) : [];

  /** The six-row grid of dates for the month on screen. */
  const monthCells = useMemo(() => {
    const first = DateTime.fromISO(monthStart);
    // Luxon numbers weekdays 1 (Monday) to 7 (Sunday); the grid starts on Sunday,
    // so Sunday must map to a zero-length lead rather than a six-day one.
    const lead = first.weekday % 7;
    const gridStart = first.minus({ days: lead });

    return Array.from({ length: GRID_CELLS }, (_, index) => gridStart.plus({ days: index }));
  }, [monthStart]);

  // `keepPreviousData` keeps the previous month on screen while the next one
  // loads, which means `loading` is true only for the very first request. Every
  // later fetch — a month change, a refresh after a lost race — reports itself
  // through `refreshing`, so anything that dims or disables has to watch both.
  const busy = loading || refreshing;

  const monthLabel = DateTime.fromISO(monthStart).toFormat("LLLL yyyy");
  const today = todayIn(viewerTimezone);
  const isCurrentMonth =
    monthStart === DateTime.now().setZone(viewerTimezone).startOf("month").toFormat("yyyy-MM-dd");

  const shiftMonth = (delta) => {
    setMonthStart(DateTime.fromISO(monthStart).plus({ months: delta }).toFormat("yyyy-MM-dd"));
  };

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
        // Covers both "outside the provider's hours" and "that moment has now
        // gone" — the second of which is reachable here in a way it was not when
        // the earliest bookable time was a day away. Either way the honest thing
        // is to say the time is no longer offered and reload, which is also what
        // brings the rest of today's list up to date.
        setSelectedSlot(null);
        toast.error("That time is no longer offered. The list has been refreshed.");
        loadSlots();
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
  const differentZones =
    data?.clientTimezone && data?.providerTimezone && data.clientTimezone !== data.providerTimezone;

  return (
    <Page>
      <Link
        to={`/providers/${providerId}`}
        className="mb-6 inline-flex items-center gap-1.5 font-small text-small text-on-surface-variant transition-colors hover:text-primary"
      >
        <Icon name="arrow_back" size={18} />
        Back
      </Link>

      <div className="grid items-start gap-gutter lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ---- Booking Details ------------------------------------------- */}
        <aside className="min-w-0">
          <h1 className="mb-4 font-h1-mobile text-h1-mobile text-primary">Booking Details</h1>

          <div className="rounded-lg border border-outline-variant bg-surface p-5">
            <div className="flex items-center gap-3">
              <Avatar
                src={provider?.avatar_url}
                name={provider?.name}
                size="lg"
                className="border border-outline-variant"
              />
              <div className="min-w-0">
                <p className="truncate font-small text-base font-semibold text-primary">
                  {provider?.business_name || provider?.name || "Provider"}
                </p>
                {(provider?.business_name ? provider?.name : provider?.business_type) && (
                  <p className="truncate font-caption text-caption text-on-surface-variant">
                    {provider.business_name ? provider.name : provider.business_type}
                  </p>
                )}
              </div>
            </div>

            <dl className="mt-5 space-y-4 border-t border-outline-variant pt-5">
              <DetailRow icon="description" term="Service">
                <span className="font-medium text-on-surface">{service?.name}</span>
                {serviceDetail?.description && (
                  <span className="mt-0.5 block font-caption text-caption text-on-surface-variant">
                    {serviceDetail.description}
                  </span>
                )}
              </DetailRow>

              <DetailRow icon="schedule" term="Duration">
                {formatDuration(service?.duration)}
              </DetailRow>

              <DetailRow icon="payments" term="Price">
                <span className="font-semibold text-on-surface">{formatPrice(service?.price)}</span>
              </DetailRow>

              {(service?.bufferBefore > 0 || service?.bufferAfter > 0) && (
                <DetailRow icon="hourglass_empty" term="Time held">
                  {[
                    service.bufferBefore > 0 ? `${service.bufferBefore}m before` : null,
                    service.bufferAfter > 0 ? `${service.bufferAfter}m after` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </DetailRow>
              )}
            </dl>
          </div>

          {/* The reference has no field for this, but `POST /bookings` accepts a
              note and dropping the control would quietly remove the only way a
              client can say why they are coming. It sits here rather than beside
              the times, where it would compete with the decision being made. */}
          <div className="mt-4">
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
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. First session, back pain on the left side"
              />
            </Field>
          </div>
        </aside>

        {/* ---- Select Date & Time ----------------------------------------- */}
        <div className="min-w-0">
          <h2 className="font-h3 text-h3 text-primary">Select Date &amp; Time</h2>
          <p className="mt-1 font-small text-small text-on-surface-variant">
            All times are displayed in your local timezone ({zoneName(data?.clientTimezone)})
            {differentZones && <> · the provider is in {zoneName(data.providerTimezone)}</>}
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_240px]">
            {/* Calendar */}
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  disabled={isCurrentMonth}
                  aria-label="Previous month"
                  className={iconButton}
                >
                  <Icon name="chevron_left" size={20} />
                </button>

                <p aria-live="polite" className="font-small text-small font-semibold text-primary">
                  {monthLabel}
                </p>

                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                  className={iconButton}
                >
                  <Icon name="chevron_right" size={20} />
                </button>
              </div>

              <div
                aria-hidden="true"
                className="grid grid-cols-7 gap-1 border-b border-outline-variant pb-2"
              >
                {WEEKDAY_INITIALS.map((initial, index) => (
                  <span
                    key={`${initial}-${index}`}
                    className="text-center font-caption text-caption text-on-surface-variant"
                  >
                    {initial}
                  </span>
                ))}
              </div>

              <div
                aria-busy={busy}
                className={`mt-2 grid grid-cols-7 gap-1 transition-opacity ${
                  busy ? "opacity-50" : "opacity-100"
                }`}
              >
                {monthCells.map((cell) => {
                  const iso = cell.toFormat("yyyy-MM-dd");
                  const outsideMonth = cell.toFormat("yyyy-MM") !== monthStart.slice(0, 7);
                  const free = slotsByDate.get(iso)?.length ?? 0;

                  return (
                    <CalendarCell
                      key={iso}
                      day={cell.day}
                      outsideMonth={outsideMonth}
                      free={free}
                      isToday={iso === today}
                      selected={iso === selectedDate}
                      onSelect={() => setSelectedDate(iso)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Times for the chosen day, and the commit */}
            <div className="flex min-w-0 flex-col">
              {busy && !selectedDate ? (
                <SkeletonRows count={3} variant="line" />
              ) : !selectedDate ? (
                <EmptyState
                  compact
                  icon="calendar"
                  title="Nothing free this month"
                  description="Try a later month — cancelled appointments come straight back into the list."
                  actionLabel="Next month"
                  onAction={() => shiftMonth(1)}
                />
              ) : (
                <>
                  <h3 className="font-small text-small font-semibold text-primary">
                    {DateTime.fromISO(selectedDate).toFormat("cccc, LLL d")}
                  </h3>

                  <ul className="mt-3 grid grid-cols-2 gap-2">
                    {daySlots.map((slot) => {
                      const chosen = selectedSlot?.startsAt === slot.startsAt;

                      return (
                        <li key={slot.startsAt}>
                          <button
                            type="button"
                            aria-pressed={chosen}
                            // The day's own date travels with the selection.
                            // Deriving it from `startsAt` would give the *UTC*
                            // date, which is the wrong day for anyone whose local
                            // date differs from it — exactly the class of bug this
                            // app exists to avoid.
                            onClick={() => setSelectedSlot({ ...slot, localDate: selectedDate })}
                            className={`w-full cursor-pointer rounded-md px-3 py-2 font-body text-small tabular-nums transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                              chosen
                                ? "border-2 border-primary bg-primary/5 font-bold text-primary"
                                : "border border-outline-variant text-on-surface hover:border-primary"
                            }`}
                          >
                            {slot.clientTime}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              <div className="mt-6 border-t border-outline-variant pt-4">
                {/* Both timezones at the moment of committing — the one place the
                    client is deciding, and the last chance to notice that 1:00 PM
                    for them is 8:30 PM for whoever they are booking. */}
                {selectedSlot && differentZones && (
                  <p className="mb-3 flex items-start gap-1.5 font-caption text-caption leading-relaxed text-on-surface-variant">
                    <Icon name="public" size={14} className="mt-0.5 shrink-0" />
                    <span>
                      That is{" "}
                      <span className="font-semibold text-on-surface">
                        {selectedSlot.providerTime}
                      </span>{" "}
                      for the provider in {zoneName(data.providerTimezone)}.
                    </span>
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!selectedSlot || booking}
                  className={`${primaryButton} w-full`}
                >
                  {booking ? "Booking…" : "Confirm Booking"}
                </button>

                {fetchedAt && (
                  // Stated openly rather than implying the list updates itself.
                  <p className="mt-3 text-center font-caption text-caption text-on-surface-variant">
                    Times as of {formatTime(fetchedAt.toISOString(), viewerTimezone)} ·{" "}
                    <button
                      type="button"
                      onClick={loadSlots}
                      disabled={busy}
                      className="cursor-pointer font-semibold text-primary underline underline-offset-2 disabled:opacity-50"
                    >
                      {busy ? "Refreshing…" : "Refresh"}
                    </button>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}

/**
 * One day in the month grid.
 *
 * Three states carry meaning and none of them relies on colour alone: a day with
 * nothing free is dimmed *and* disabled, so it cannot be chosen by keyboard
 * either; the chosen day is a filled disc; today keeps a dot under it, because
 * once the client pages forward it is no longer the first cell.
 */
function CalendarCell({ day, outsideMonth, free, isToday, selected, onSelect }) {
  if (outsideMonth) {
    return <span aria-hidden="true" className="h-9" />;
  }

  const bookable = free > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!bookable}
      aria-pressed={selected}
      aria-label={
        bookable ? `${day}, ${free} time${free === 1 ? "" : "s"} free` : `${day}, nothing free`
      }
      // `cursor-pointer` is stated per-branch rather than in the shared prefix:
      // two conflicting cursor utilities in one class attribute are resolved by
      // their order in the compiled stylesheet, not by the order written here.
      className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-full font-small text-small tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        selected
          ? "cursor-pointer bg-primary font-semibold text-on-primary"
          : bookable
            ? "cursor-pointer text-on-surface hover:bg-surface-container-high"
            : "cursor-not-allowed text-outline-variant"
      }`}
    >
      {day}
      {isToday && !selected && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 h-1 w-1 rounded-full bg-primary"
        />
      )}
    </button>
  );
}

/** A labelled line in the Booking Details card. */
function DetailRow({ icon, term, children }) {
  return (
    <div className="flex items-start gap-3">
      <Icon name={icon} size={18} className="mt-0.5 shrink-0 text-on-surface-variant" />
      <div className="min-w-0">
        <dt className="sr-only">{term}</dt>
        <dd className="font-small text-small text-on-surface-variant">{children}</dd>
      </div>
    </div>
  );
}

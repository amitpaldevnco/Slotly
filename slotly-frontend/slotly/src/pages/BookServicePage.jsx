/**
 * The booking flow: pick a day on a month calendar, pick a time, review, confirm.
 *
 * ## The layout
 *
 * Transcribed from the reference: a "Booking Details" column on the left holding
 * the provider and the service being bought, and beside it "Select Date & Time" —
 * a month calendar with the day's free times in a column next to it, and the
 * commit under them.
 *
 * ## Why there is a dialog in the way
 *
 * The reference goes straight from a chosen time to a booked appointment, and so
 * did this: one click on Confirm Booking and the client owned an appointment.
 * That made the most consequential button in the app — money, an hour of someone
 * else's week, a cancellation policy that may already have closed — the only one
 * with nothing between the click and the consequence.
 *
 * Everything the dialog shows was already on this screen. The service and its
 * price were in the left column, the two clocks were in a paragraph under the
 * calendar, the cancellation warning appeared in the one case where the window
 * had already shut, and the note field was at the bottom of a column the client
 * had scrolled past before they picked a day. Spread over three regions, none of
 * it was in front of them at the moment it mattered. The dialog does not add
 * information; it puts what there was in one place, at the point of decision, and
 * makes the last click deliberate.
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
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DateTime } from "luxon";
import { parseApiError } from "../api/client";
import * as bookingsApi from "../api/bookings";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Page from "../components/ui/Page";
import Modal from "../components/ui/Modal";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import Field, { Textarea, CharCount } from "../components/ui/Field";
import EmptyState, {
  ErrorState,
  PageLoader,
  Refreshing,
  SkeletonRows,
} from "../components/ui/Feedback";
import Pagination, { usePagination } from "../components/ui/Pagination";
import { browserTimezone, formatTime, todayIn, zoneLabel } from "../lib/time";
import {
  primaryButton,
  secondaryButton,
  buttonSm,
  iconButton,
  formatPrice,
  formatDuration,
  zoneName,
} from "../lib/ui";
import usePageTitle from "../hooks/usePageTitle";
import {
  countryLabel,
  deliveryIcon,
  deliveryLabel,
  describeLocation,
} from "../lib/serviceScope";
import { bookingNoticeBody } from "../lib/bookingNotice";

/** Longest a note may be, matching the API's own validation. */
const MAX_NOTE = 500;

/** The design's week starts on Sunday. */
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Times shown per page in the slot column.
 *
 * The grid is two columns, so twelve is six rows — tall enough to feel like a
 * real choice, short enough that Review booking stays on screen beneath it.
 *
 * A short service on a fine-grained interval is what makes this necessary. A
 * 2-minute service on a 10-minute grid across a working day yields well over
 * fifty times, and an unpaginated column pushed the confirm button metres down
 * the page — so picking a time and committing to it could not both be done
 * without scrolling away from the other.
 */
const SLOTS_PER_PAGE = 12;

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
  usePageTitle("Book an appointment");

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

  // Whether the confirmation dialog is open. Booking used to happen on the first
  // click of Confirm Booking, with no step between choosing a time and being
  // committed to it — so the one screen where a client is spending money and
  // giving up an hour of their week was also the only one in the app that acted
  // on a single click. Everything the dialog shows was already on this page or
  // one request away; what was missing was a moment to read it in.
  const [reviewing, setReviewing] = useState(false);

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
  const { data: profile, loading: profileLoading } = useApiResource(
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

  // The provider's own cancellation notice, already on the profile payload — no
  // extra request needed to warn about it.
  const cancellationCutoffHours = provider?.cancellationCutoffHours ?? null;

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
   * True when the chosen slot is nearer than the provider's cancellation notice,
   * which means the booking will be un-cancellable and un-reschedulable by the
   * client from the instant it is created.
   *
   * Judged against `now` — the same minute tick the slot list uses — rather than
   * a bare `Date.now()`, so on a page left open the boundary moves with the
   * clock instead of being decided once on mount and then going stale.
   */
  const locksImmediately = useMemo(() => {
    if (!selectedSlot || !cancellationCutoffHours) return false;
    const hoursUntilStart = (Date.parse(selectedSlot.startsAt) - now) / 3_600_000;
    return hoursUntilStart < cancellationCutoffHours;
  }, [selectedSlot, cancellationCutoffHours, now]);

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
  // it stay selected would leave the confirm step enabled over a slot the list no
  // longer shows, and the only possible outcome would be a refusal.
  useEffect(() => {
    setSelectedSlot((current) => (current && Date.parse(current.startsAt) <= now ? null : current));
  }, [now]);

  // Losing the slot closes the dialog that was confirming it, whichever way it
  // went: the minute tick above, a change of day, or a lost race clearing it in
  // `handleConfirm`. One rule rather than a `setReviewing(false)` at each of
  // those sites — which is also why a *generic* failure leaves the dialog open,
  // since the slot is still there and pressing Confirm again is a reasonable
  // thing to want to do.
  useEffect(() => {
    if (!selectedSlot) setReviewing(false);
  }, [selectedSlot]);

  const daySlots = selectedDate ? (slotsByDate.get(selectedDate) ?? []) : [];

  // The day's times, a page at a time. See SLOTS_PER_PAGE for why this is
  // paginated rather than simply listed.
  const slotPager = usePagination(daySlots, SLOTS_PER_PAGE);
  const { setPage: setSlotPage } = slotPager;

  // A new day starts at its first time, not wherever the client happened to be
  // in the previous day's list. Without this, picking a day with four times
  // after paging to page 5 of a busy one lands on an empty page.
  useEffect(() => {
    setSlotPage(1);
  }, [selectedDate, setSlotPage]);

  // Local clock readings that appear more than once in the day on screen.
  //
  // Non-empty on exactly one day a year: the day the clocks go back, when an
  // hour repeats and two distinct instants share one reading. Those buttons get
  // their zone printed beside them so they can be told apart; every other button
  // is left alone.
  //
  // Computed straight rather than memoised. `daySlots` is a fresh array on every
  // render, so a `useMemo` keyed on it would recompute every time regardless —
  // it would buy nothing and read as though it did. This is one pass over a
  // dozen strings.
  const repeatedTimes = new Set(
    daySlots
      .map((slot) => slot.clientTime)
      .filter((time, index, all) => all.indexOf(time) !== index)
  );

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

      setReviewing(false);
      setSelectedSlot(null);
      setNote("");
      // The confirmation restates the appointment rather than only announcing
      // that one exists. "Booking confirmed." told the client nothing they could
      // check, and the venue in particular is the fact they are most likely to
      // want a moment after agreeing — especially for a virtual appointment,
      // where there is no address to fall back on remembering.
      toast.success(
        bookingNoticeBody({ booking: created, viewerZone: data?.clientTimezone }) ||
          "Booking confirmed.",
        { title: "You're booked in", duration: 9000 }
      );
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
        {/* A wrong or retired service id is a bad link, not a failure, so the
            heading says which. `notFound` keys off the server's own wording
            rather than a status code, because this page's loader collapses
            several calls and reports only the message. */}
        <ErrorState
          title={/not found/i.test(error) ? "Service not found" : undefined}
          message={error}
          onRetry={loadSlots}
        >
          <Link to={`/providers/${providerId}`} className={`${primaryButton} ${buttonSm}`}>
            Back to provider
          </Link>
        </ErrorState>
      </Page>
    );
  }

  const service = data?.service;
  // The server's verdict on whether this client may book this service at all.
  // `eligibility` is always on the payload — `allowed: true` in the ordinary
  // case — so this reads one field rather than testing for its presence.
  const ineligible = data?.eligibility?.allowed === false;

  // The refusal, composed here rather than taken from the server's prose.
  //
  // The server names the countries by code — it has to, because it cannot know
  // the reader's language and a localised country name is a rendering concern,
  // the same argument that keeps currency *symbols* out of API responses. So the
  // payload carries the two codes and this turns them into names, which is also
  // what the provider's page does; without it the same refusal read "clients in
  // GB" on one screen and "clients in United Kingdom" on the other.
  //
  // Falls back to the server's sentence, then to a generic one, so a payload
  // from an older server still explains itself.
  const ineligibleReason = (() => {
    const providerCountry = countryLabel(data?.eligibility?.providerCountry);
    const clientCountry = countryLabel(data?.eligibility?.clientCountry);
    if (providerCountry && clientCountry) {
      return `Only available to clients in ${providerCountry}. Your account is set to ${clientCountry}.`;
    }
    return (
      data?.eligibility?.reason ??
      "This service is only offered to clients in the provider's own country."
    );
  })();
  const differentZones =
    data?.clientTimezone && data?.providerTimezone && data.clientTimezone !== data.providerTimezone;

  // Where this appointment happens, resolved once and read by both the side
  // panel and the confirmation dialog — the two places that have to agree about
  // it, and previously did not: the panel showed an address and the dialog
  // showed nothing at all.
  const venue = describeLocation(service);

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
            {/* This panel is fed by its own request, separate from the slots
                the rest of the page waits on — so it used to draw an avatar
                with no photo above the word "Provider", then rewrite both a
                moment later when the real names arrived. A placeholder for the
                one line that is genuinely unknown is quieter than a wrong
                answer that corrects itself. */}
            <div className="flex items-center gap-3">
              <Avatar
                src={provider?.avatar_url}
                name={provider?.name}
                size="lg"
                className="border border-outline-variant"
              />
              <div className="min-w-0 flex-1">
                {profileLoading ? (
                  <SkeletonRows count={1} variant="line" label="Loading provider…" />
                ) : (
                  <>
                    <p className="truncate font-small text-base font-semibold text-primary">
                      {provider?.business_name || provider?.name || "Provider"}
                    </p>
                    {(provider?.business_name
                      ? provider?.name
                      : provider?.business_type) && (
                      <p className="truncate font-caption text-caption text-on-surface-variant">
                        {provider.business_name ? provider.name : provider.business_type}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <dl className="mt-5 space-y-4 border-t border-outline-variant pt-5">
              <DetailRow icon="description" term="Service">
                <span className="font-medium text-on-surface">{service?.name}</span>
                {serviceDetail?.description && (
                  // Clamped, but no longer only clamped. A provider can write
                  // several hundred words here and this panel's job is to confirm
                  // *which* service is being booked, so a description long enough
                  // to push the price and duration off the screen defeats it —
                  // the clamp stays.
                  //
                  // What it used to do about the hidden text was hang it off a
                  // `title` attribute, which is not a way to read anything: it
                  // needs a mouse, it needs a hover held still, it never appears
                  // on a phone, and several hundred words in an OS tooltip is not
                  // reading them. So the text that was cut off with "…" now has a
                  // control that shows it.
                  <ExpandableText
                    text={serviceDetail.description}
                    className="mt-0.5 font-caption text-caption text-on-surface-variant"
                  />
                )}
              </DetailRow>

              <DetailRow icon="schedule" term="Duration">
                {formatDuration(service?.duration)}
              </DetailRow>

              <DetailRow icon="payments" term="Price">
                <span className="font-semibold text-on-surface">{formatPrice(service?.price, service?.currency)}</span>
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

              <DetailRow icon={deliveryIcon(service?.deliveryType)} term="Delivery">
                {deliveryLabel(service?.deliveryType)}
              </DetailRow>

              {/* The venue, in the panel the client reads before choosing a
                  time. An in-person appointment is a journey and this is the
                  screen where it is being planned; leaving the address to the
                  confirmation dialog would mean the client picks a time before
                  finding out whether they can get there.

                  Now answered for a virtual appointment too. This row used to
                  render only for `in_person`, so an online session said
                  "Delivery: Virtual" and then nothing — the question "where is
                  this?" went unanswered on the screen where it is asked, and the
                  client was left to infer that a missing address meant online.

                  whitespace-pre-line because the address is one free-text field
                  and providers write it as they would on an envelope. */}
              {venue.text && (
                <DetailRow
                  icon={venue.isVirtual ? "videocam" : "place"}
                  term={venue.term}
                >
                  <span className="whitespace-pre-line">{venue.text}</span>
                  {venue.meetingLink && (
                    <a
                      href={venue.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block break-all font-caption text-caption text-primary underline decoration-line-strong underline-offset-2 hover:text-ink"
                    >
                      {venue.meetingLink}
                    </a>
                  )}
                </DetailRow>
              )}
            </dl>
          </div>

          {/* The note used to sit here, at the bottom of this column — as far
              from the button that submits it as the layout allowed, and on a
              phone a whole screen above the calendar the client had yet to
              use. It asked a question about an appointment that had not been
              chosen yet, and by the time one had been, the field was out of
              sight. It now lives in the confirmation dialog, next to the
              button that sends it. */}
        </aside>

        {/* ---- Select Date & Time ----------------------------------------- */}
        <div className="min-w-0">
          <h2 className="font-h3 text-h3 text-primary">Select Date &amp; Time</h2>
          <p className="mt-1 font-small text-small text-on-surface-variant">
            All times are displayed in your local timezone ({zoneName(data?.clientTimezone)})
            {differentZones && <> · the provider is in {zoneName(data.providerTimezone)}</>}
          </p>

          {/* The service is not offered where this client is.
              Shown *instead of* the picker rather than above it, because the
              server has already emptied the slot list for exactly this case —
              `getAvailableSlots` returns `days: []` when eligibility fails — so
              leaving the calendar on screen would present a month of greyed-out
              dates and let the client conclude the provider is simply busy.
              Naming the reason and offering the way back is the honest version.

              `eligibility` is always present on the payload with
              `allowed: true` in the ordinary case, so this is one condition
              rather than a test for the field's existence. */}
          {ineligible ? (
            <div className="mt-6 rounded-lg border border-outline-variant bg-surface p-6">
              <EmptyState
                icon="public_off"
                title="Not available in your country"
                description={ineligibleReason}
                actionLabel="See their other services"
                actionTo={`/providers/${providerId}`}
              />
              {/* The likeliest cause is a country inferred from a timezone
                  rather than stated, so the fix is named next to the refusal
                  instead of leaving the client to guess that a profile field
                  decided this. */}
              <p className="mt-4 text-center font-caption text-caption text-on-surface-variant">
                If your country is wrong, you can change it under{" "}
                <Link to="/profile" className="font-semibold text-primary underline">
                  Profile
                </Link>
                .
              </p>
            </div>
          ) : (
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

              {/* Was its own copy of this, dimming to 50% where the other
                  two screens that did the same thing used 55%. */}
              <Refreshing active={busy} className="mt-2 grid grid-cols-7 gap-1">
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
              </Refreshing>
            </div>

            {/* Times for the chosen day, and the commit */}
            <div className="flex min-w-0 flex-col">
              {busy && !selectedDate ? (
                <SkeletonRows count={3} variant="line" label="Loading available times…" />
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
                    {slotPager.pageItems.map((slot) => {
                      const chosen = selectedSlot?.startsAt === slot.startsAt;
                      // On the day the clocks go back, one local reading covers
                      // two different real instants: 01:30 happens, an hour
                      // passes, and it is 01:30 again. Both are genuinely
                      // bookable and the engine offers both, so the list would
                      // otherwise show "1:30 AM" twice with no way for a human
                      // to tell which one they were choosing — and picking the
                      // wrong one means arriving an hour out.
                      //
                      // The zone label is appended only to the readings that are
                      // actually repeated, so 363 days a year this changes
                      // nothing on screen.
                      const ambiguous = repeatedTimes.has(slot.clientTime);

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
                            {ambiguous && (
                              <span className="ml-1 font-caption text-[11px] text-ink-3">
                                {zoneLabel(slot.startsAt, data.clientTimezone)}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Only renders once there is more than one page; below that
                      it is a count and nothing else, which is not worth a row
                      of chrome above the confirm button. */}
                  {slotPager.pageCount > 1 && (
                    <Pagination
                      className="mt-3"
                      unit="time"
                      page={slotPager.page}
                      pageCount={slotPager.pageCount}
                      onChange={slotPager.setPage}
                      total={slotPager.total}
                      from={slotPager.from}
                      to={slotPager.to}
                    />
                  )}
                </>
              )}

              <div className="mt-6 border-t border-outline-variant pt-4">
                {/* What has been chosen, restated next to the button that acts
                    on it.

                    Load-bearing once the times are paginated: the chosen slot
                    can be two pages back and entirely off screen, so without
                    this the client would be opening the review step with no
                    reminder of which time it is about to summarise.

                    The dialog now repeats both of these lines in full, which is
                    not duplication for its own sake — this is the selection as
                    it stands, changeable by clicking another time, and that is
                    the same selection as a thing about to be committed. Two
                    different questions, so both get an answer. */}
                {selectedSlot && (
                  <p className="mb-3 flex items-start gap-1.5 font-caption text-caption leading-relaxed text-on-surface-variant">
                    <Icon name="check" size={14} className="mt-0.5 shrink-0 text-primary" />
                    <span>
                      Booking{" "}
                      <span className="font-semibold text-on-surface">
                        {selectedSlot.clientTime}
                      </span>{" "}
                      on{" "}
                      <span className="font-semibold text-on-surface">
                        {DateTime.fromISO(selectedSlot.localDate).toFormat("cccc, LLL d")}
                      </span>
                      .
                    </span>
                  </p>
                )}

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

                {/* Opens the confirmation dialog rather than booking. The
                    label says so: a button that reads "Confirm Booking" and
                    then asks for confirmation has told the reader the wrong
                    thing about what their click does, and one that books
                    outright — which is what this did — gives them nowhere to
                    check the price, the provider's clock or the cancellation
                    terms before they are committed.

                    The cancellation warning that used to sit above this button
                    moved into that dialog, alongside the rest of the terms.
                    Repeating it in both places would be the same sentence twice
                    in two consecutive steps, and the dialog is now the only way
                    past this point, so it cannot be missed there. */}
                <button
                  type="button"
                  onClick={() => setReviewing(true)}
                  disabled={!selectedSlot}
                  className={`${primaryButton} w-full`}
                >
                  Review booking
                </button>

                {fetchedAt && (
                  // Stated openly rather than implying the list updates itself.
                  <p className="mt-3 text-center font-caption text-caption text-on-surface-variant">
                    Times as of {formatTime(fetchedAt.toISOString(), viewerTimezone)} ·{" "}
                    <button
                      type="button"
                      onClick={loadSlots}
                      disabled={busy}
                      // `-my-2 py-2` widens the tap area vertically without
                      // shifting the line: at caption size this rendered as a
                      // 46x17px target, under the 24x24 minimum and genuinely
                      // hard to hit on a phone.
                      className="-my-2 cursor-pointer rounded px-1 py-2 font-semibold text-primary underline underline-offset-2 disabled:opacity-50"
                    >
                      {busy ? "Refreshing…" : "Refresh"}
                    </button>
                  </p>
                )}
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* ---- The confirmation step ------------------------------------- */}
      {/*
        Everything a client is agreeing to, on one screen, immediately before
        they agree to it: which service, what it costs, when it happens on their
        clock *and* on the provider's, and what happens if they need to get out
        of it. All of it was already on the page — spread across a panel on the
        left, a paragraph under the calendar and a warning that only appeared in
        one case — and none of it was in front of them at the moment of the click.

        `open` is gated on the slot as well as the flag, so the dialog cannot
        render a summary of a slot that has lapsed out from under it. The effect
        above clears the flag in the same pass; this is the belt to its braces,
        because a dialog reading "undefined" is a worse failure than one that
        closes.
      */}
      <Modal
        open={reviewing && Boolean(selectedSlot)}
        // Not while the request is in flight. Escape or a backdrop click would
        // otherwise hide a booking that is still being made, and the client
        // would be looking at the slot list wondering whether it went through.
        onClose={() => {
          if (!booking) setReviewing(false);
        }}
        title="Confirm your booking"
        description="Nothing is booked until you press Confirm."
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setReviewing(false)}
              disabled={booking}
              className={`${secondaryButton} disabled:opacity-50`}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={booking}
              className={primaryButton}
            >
              {booking ? "Booking…" : "Confirm booking"}
            </button>
          </>
        }
      >
        {selectedSlot && (
          <div className="space-y-5">
            <dl className="space-y-3.5">
              <ReviewRow term="Service">
                <span className="font-semibold text-on-surface">{service?.name}</span>
                <span className="mt-0.5 block text-on-surface-variant">
                  {formatDuration(service?.duration)}
                </span>
              </ReviewRow>

              <ReviewRow term="Price">
                <span className="font-semibold text-on-surface">
                  {formatPrice(service?.price, service?.currency)}
                </span>
                {(service?.bufferBefore > 0 || service?.bufferAfter > 0) && (
                  <span className="mt-0.5 block text-on-surface-variant">
                    {[
                      service.bufferBefore > 0 ? `${service.bufferBefore}m before` : null,
                      service.bufferAfter > 0 ? `${service.bufferAfter}m after` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    held either side
                  </span>
                )}
              </ReviewRow>

              {/* Both clocks, named for whose they are.

                  The provider's date is derived from the instant rather than
                  reusing the client's, because the two can genuinely differ: a
                  late-evening London slot is already tomorrow in Kolkata, and a
                  confirmation screen that showed the client's Tuesday next to
                  the provider's time would be quietly telling them the wrong
                  day for the person they are meeting. */}
              <ReviewRow term="Your time">
                <span className="font-semibold text-on-surface">
                  {DateTime.fromISO(selectedSlot.localDate).toFormat("cccc, d LLLL")} at{" "}
                  {selectedSlot.clientTime}
                </span>
                <span className="mt-0.5 block text-on-surface-variant">
                  {zoneName(data?.clientTimezone)}
                </span>
              </ReviewRow>

              {differentZones && (
                <ReviewRow term="Their time">
                  <span className="font-semibold text-on-surface">
                    {DateTime.fromISO(selectedSlot.startsAt)
                      .setZone(data.providerTimezone)
                      .toFormat("cccc, d LLLL")}{" "}
                    at {selectedSlot.providerTime}
                  </span>
                  <span className="mt-0.5 block text-on-surface-variant">
                    {zoneName(data.providerTimezone)} — the same moment, their clock
                  </span>
                </ReviewRow>
              )}

              {/* Where it happens, on the dialog that commits to it.
                  
                  This was the one fact the confirmation step left out. The side
                  panel carries it, but that column is scrolled past on the way
                  to the calendar and is off-screen entirely on a phone by the
                  time this dialog opens — so the last thing a client saw before
                  agreeing was a time, with the venue several screens behind
                  them. Stated again here for the same reason both clocks are:
                  the moment of commitment is where a fact has to be legible,
                  not merely available. */}
              <ReviewRow term={venue.term}>
                <span className="whitespace-pre-line font-semibold text-on-surface">
                  {venue.text ?? "The provider has not published an address yet."}
                </span>
                {venue.meetingLink ? (
                  <a
                    href={venue.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 block break-all text-primary underline decoration-line-strong underline-offset-2 hover:text-ink"
                  >
                    {venue.meetingLink}
                  </a>
                ) : (
                  <span className="mt-0.5 block text-on-surface-variant">
                    {venue.isVirtual
                      ? "The provider will confirm how to join."
                      : deliveryLabel(service?.deliveryType)}
                  </span>
                )}
              </ReviewRow>
            </dl>

            {/* The cancellation terms, as a fact about this booking rather than
                a policy in the abstract: the deadline is computed from the slot
                the client is actually confirming, so it is a date and a time
                they can act on rather than a number of hours to do arithmetic
                with. */}
            <CancellationTerms
              cutoffHours={cancellationCutoffHours}
              startsAt={selectedSlot.startsAt}
              locked={locksImmediately}
              providerName={provider?.name}
              viewerTimezone={viewerTimezone}
            />

            {/* `POST /bookings` accepts a note, and this is the last moment it
                can be written — so it is asked for here, beside the button that
                sends it, rather than in a column the client scrolled past before
                they had chosen a time. */}
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
        )}
      </Modal>
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

/**
 * Text clamped to three lines, with a control to show the rest.
 *
 * Whether the clamp is actually biting is *measured* rather than guessed from the
 * string's length: three lines is a function of the container's width and the
 * font, so a character-count heuristic shows "More" over text that fits and
 * hides it over text that does not. The observer catches the same question being
 * re-answered when the column is resized.
 *
 * Nothing is measured while expanded — the element is unclamped then, so
 * `scrollHeight` and `clientHeight` agree and a fresh measurement would decide
 * the text was short and take the "Less" control away mid-read. Skipping the
 * measurement leaves the previous answer standing, which is the true one.
 */
function ExpandableText({ text, className = "" }) {
  const bodyId = useId();
  const bodyRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const element = bodyRef.current;
    if (!element || expanded) return undefined;

    // +1 absorbs the sub-pixel difference a fractional line-height leaves
    // between the two heights on an element that is not really overflowing.
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <span className={`block ${className}`}>
      {/* No `block` alongside the clamp: `line-clamp-3` sets its own
          `display: -webkit-box`, and `block` overrides it — leaving
          `-webkit-line-clamp` set on an element that ignores it, so the full
          text renders and the clamp silently does nothing. The wrapper above
          carries the block-level layout instead. */}
      <span ref={bodyRef} id={bodyId} className={expanded ? "" : "line-clamp-3"}>
        {text}
      </span>

      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          // `py-1` with `-mb-1` widens the tap target downwards without
          // pushing what follows; at caption size the label alone is well under
          // the 24px minimum. Not `-my-1`, which would set margin-top twice
          // over alongside `mt-0.5` and leave the winner to stylesheet order.
          className="-mb-1 mt-0.5 cursor-pointer rounded py-1 font-semibold text-primary underline underline-offset-2"
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </span>
  );
}

/** A term-and-value line in the confirmation dialog. */
function ReviewRow({ term, children }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-outline-variant pb-3.5 last:border-b-0 last:pb-0">
      <dt className="font-caption text-caption font-bold uppercase tracking-wider text-on-surface-variant">
        {term}
      </dt>
      <dd className="min-w-0 text-right font-small text-small">{children}</dd>
    </div>
  );
}

/**
 * What happens if this booking has to be called off.
 *
 * Three cases, and the difference between them matters enough to say in words.
 *
 * Slotly books in real time — there is no minimum notice — so a slot can
 * legitimately be nearer than the provider's own cancellation window. Booking it
 * is allowed, but it is locked from the instant it is made: the detail page opens
 * with Cancel and Reschedule already disabled. That is the case worth a warning
 * box, and discovering it one second *after* confirming is what the box exists to
 * prevent.
 *
 * Otherwise the deadline is stated as a moment rather than a duration. "You can
 * cancel until 24 hours before" asks the reader to do date arithmetic against a
 * time they may only have half-read; "until Monday, 1 September at 2:00 PM" is
 * the answer they were going to work out anyway, in their own timezone.
 */
function CancellationTerms({ cutoffHours, startsAt, locked, providerName, viewerTimezone }) {
  if (!cutoffHours) {
    return (
      <p className="rounded-md border border-outline-variant bg-surface-container-low p-3 font-caption text-caption leading-relaxed text-on-surface-variant">
        <span className="font-semibold text-on-surface">Cancellation</span> — this provider has not
        published a notice period, so cancelling or rescheduling online stays open until the
        appointment starts.
      </p>
    );
  }

  if (locked) {
    return (
      <p className="flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-3 font-caption text-caption leading-relaxed text-warn-ink">
        <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
        <span>
          This time is already inside {providerName || "the provider"}&apos;s{" "}
          <span className="font-semibold">{cutoffHours}-hour</span> cancellation window, so once you
          confirm you will not be able to cancel or reschedule it online at all. Message them
          directly if your plans change.
        </span>
      </p>
    );
  }

  const deadline = DateTime.fromISO(startsAt)
    .minus({ hours: cutoffHours })
    .setZone(viewerTimezone);

  return (
    <p className="rounded-md border border-outline-variant bg-surface-container-low p-3 font-caption text-caption leading-relaxed text-on-surface-variant">
      <span className="font-semibold text-on-surface">Cancellation</span> — free to cancel or
      reschedule online until{" "}
      <span className="font-semibold text-on-surface">
        {deadline.toFormat("cccc, d LLLL")} at {deadline.toFormat("h:mm a")}
      </span>{" "}
      ({cutoffHours} hours before it starts). After that, message {providerName || "the provider"}{" "}
      directly.
    </p>
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

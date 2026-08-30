/**
 * One booking in full: both timezones, the actions available to whoever is
 * looking, and the complete history of how it got to its current status.
 *
 * This is where the brief's "confirmation screen shows the appointment time in
 * both the client's and the provider's timezone" requirement lives, and where
 * the audit trail from `booking_events` is rendered as a readable timeline.
 *
 * Which actions are offered comes from `viewerRole`, which the server supplies —
 * the page never works it out by comparing ids itself.
 *
 * ## The layout
 *
 * This was six full-width panels stacked in a 768px column: the time, the
 * details, a row of buttons, the review, the conversation, the history. Two
 * problems with that. The actions — cancel, reschedule, mark completed — sat in
 * the middle of the page, so a provider had to scroll past them to read the
 * conversation and back up to act on it. And the history, which is reference
 * material, occupied exactly as much width as the appointment itself.
 *
 * Now the appointment, its actions and the conversation are the main column, with
 * the details, the review and the history alongside. The one thing that changes
 * what someone does next — the time — is at the top and nothing competes with it.
 */
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DateTime } from "luxon";
import { parseApiError } from "../api/client";
import * as bookingsApi from "../api/bookings";
import { useApiResource } from "../hooks/useApiResource";
import { useToast } from "../context/ToastContext";
import StatusBadge from "../components/ui/StatusBadge";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import BackLink from "../components/ui/BackLink";
import Page, { PageHeader, Section, SplitLayout } from "../components/ui/Page";
import Modal from "../components/ui/Modal";
import Field, { Textarea, CharCount } from "../components/ui/Field";
import EmptyState, { Alert, PageLoader } from "../components/ui/Feedback";
import BookingTimeline from "../components/bookings/BookingTimeline";
import RescheduleDialog from "../components/bookings/RescheduleDialog";
import BookingConversation from "../components/messages/BookingConversation";
import BookingReview from "../components/reviews/BookingReview";
import { formatLongDate, formatTime, relativeTime, zoneLabel } from "../lib/time";
import {
  primaryButton,
  secondaryButton,
  dangerButton,
  buttonSm,
  metricLg,
  metricSm,
  highlightPill,
  accentEdge,
  formatPrice,
  formatDuration,
  metaLine,
  zoneName,
} from "../lib/ui";
import usePageTitle from "../hooks/usePageTitle";
import { deliveryLabel } from "../lib/serviceScope";

const MAX_REASON = 500;

export default function BookingDetailPage() {
  usePageTitle("Appointment");

  const { bookingId } = useParams();
  const [searchParams] = useSearchParams();
  const toast = useToast();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  // Which outcome is waiting to be confirmed — "completed", "no_show", or null.
  //
  // Both are confirmed, because neither can be taken back:
  // `evaluateProviderTransition` refuses every transition out of a settled
  // booking, so a second attempt answers 409 BOOKING_NOT_ACTIVE. The two buttons
  // also sit side by side, which is exactly the arrangement that makes a mis-tap
  // land on the wrong one. What differs is the wording, not whether to ask — a
  // no-show is a statement about the client that shows on their record, keeps
  // the fee out of earnings and blocks their review, so its dialog says so.
  const [pendingOutcome, setPendingOutcome] = useState(null);

  // Set when arriving straight from a successful booking, so the page can lead
  // with a confirmation instead of looking like any other detail view.
  const justBooked = searchParams.get("justBooked") === "1";

  const {
    data: booking,
    loading,
    error,
    reload: load,
  } = useApiResource(({ signal }) => bookingsApi.get(bookingId, { signal }), {
    deps: [bookingId],
    fallback: "Could not load this booking.",
  });

  const handleCancel = async () => {
    setWorking(true);
    try {
      await bookingsApi.cancel(bookingId, reason.trim());
      setCancelOpen(false);
      setReason("");
      toast.success("Booking cancelled. The slot is free again.");
      load();
    } catch (err) {
      const parsed = parseApiError(err, "Could not cancel this booking.");

      if (parsed.code === "CANCELLATION_WINDOW_CLOSED") {
        // Explain the refusal with the actual deadline rather than restating the
        // policy in the abstract.
        const deadline = parsed.details?.deadline;
        toast.error(
          deadline
            ? `Cancellations for this booking closed on ${formatLongDate(
                deadline,
                booking.client.timezone
              )} at ${formatTime(deadline, booking.client.timezone)}. Contact the provider directly.`
            : parsed.message,
          { title: "Too late to cancel", duration: 9000 }
        );
      } else {
        toast.error(parsed.message);
      }

      setCancelOpen(false);
      load();
    } finally {
      setWorking(false);
    }
  };

  const handleStatusChange = async (status) => {
    setWorking(true);
    try {
      await bookingsApi.setStatus(bookingId, status);
      setPendingOutcome(null);
      toast.success(`Marked as ${status.replace("_", "-")}.`);
      load();
    } catch (err) {
      toast.error(parseApiError(err, "Could not update this booking.").message);
    } finally {
      setWorking(false);
    }
  };

  // Only while there is nothing to show for *this* booking. `load()` also runs
  // after a cancel or a status change, and swapping the whole page out for a
  // spinner on those refetches is what made the content vanish and then reappear.
  const hasThisBooking = booking && String(booking.id) === String(bookingId);

  if (loading && !hasThisBooking) return <PageLoader label="Loading booking…" />;

  // Any failure lands here, not only a 404: a booking that cannot be fetched is,
  // to the person looking at it, a booking that is not there.
  if (error || !booking) {
    return (
      <Page narrow>
        <EmptyState
          icon="search"
          title="Booking not found"
          description="It may have been removed, or it may belong to someone else."
          actionLabel="Back to your dashboard"
          actionTo="/dashboard"
        />
      </Page>
    );
  }

  const isClient = booking.viewerRole === "client";
  const isActive = booking.status === "booked" || booking.status === "rescheduled";
  const hasStarted = DateTime.fromISO(booking.startsAt) <= DateTime.now();
  const otherParty = isClient ? booking.provider : booking.client;

  // Whichever party is looking, rendered in *their* current timezone. Derived once
  // here so the timeline, the review and the conversation cannot disagree.
  const viewerZone = isClient ? booking.client.timezone : booking.provider.timezone;

  return (
    <Page>
      {/* The back control was a hardcoded "Back to dashboard", which was wrong
          for most arrivals: the appointments list and the calendar both link
          here, and both sent you somewhere you had not come from. BackLink
          returns to wherever that was, and only falls back to the list for a
          booking opened from a direct link. */}
      <PageHeader
        back={<BackLink fallbackTo="/appointments" fallbackLabel="All appointments" />}
        title={booking.service.name}
        meta={<StatusBadge status={booking.status} dot />}
        description={
          <>
            {isClient ? "with " : "for "}
            {/* A client should be able to get back to the provider's page from
                here — to book again, or to read their other services. This was
                previously a dead end. */}
            {isClient ? (
              <Link
                to={`/providers/${booking.provider.id}`}
                className="font-medium text-brand underline decoration-brand/35 underline-offset-2 transition hover:decoration-brand"
              >
                {otherParty.businessName || otherParty.name}
              </Link>
            ) : (
              <span className="font-medium text-ink">{otherParty.name}</span>
            )}
          </>
        }
      />

      {justBooked && isActive && (
        <Alert tone="success" title="Appointment confirmed" className="mb-4">
         Your appointment details are shown in both time zones.
        </Alert>
      )}

      <SplitLayout
        aside={
          <>
            <Section title="Details" flush>
              <dl className="divide-y divide-line-soft">
                <DetailRow label="Duration" value={formatDuration(booking.service.duration)} />
                <DetailRow
                  label="Price"
                  value={<span className={metricSm}>{formatPrice(booking.service.price, booking.service.currency)}</span>}
                />
                <DetailRow
                  label="Delivery"
                  value={deliveryLabel(booking.service.deliveryType)}
                />
                {/* Where to go, on the page the client opens on the day.
                    Read live from the provider rather than snapshotted onto the
                    booking, so a clinic that has moved shows its new address on
                    appointments it took before the move — an address is a fact
                    about where they are now, unlike the price, which is a term
                    of the agreement and must not move. Absent for a virtual
                    appointment, which does not happen anywhere. */}
                {booking.service.location?.address && (
                  <DetailRow
                    label="Where"
                    value={
                      <span className="whitespace-pre-line">
                        {booking.service.location.address}
                      </span>
                    }
                  />
                )}
                <DetailRow label={isClient ? "Provider" : "Client"} value={otherParty.name} />

                {/* Contact details are the provider's view only — a client has no
                    need for the provider's inbox, and the API scopes these to the
                    provider's response for the same reason. */}
                {!isClient && booking.client.email && (
                  <DetailRow label="Email" value={booking.client.email} />
                )}
                {!isClient && booking.client.phoneNumber && (
                  <DetailRow label="Phone" value={booking.client.phoneNumber} />
                )}
              </dl>
            </Section>

            {(booking.clientNote || booking.cancellationReason) && (
              <Section title="Notes" flush>
                <div className="space-y-3 px-5 py-4">
                  {booking.clientNote && (
                    <div>
                      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3">
                        From the client
                      </p>
                      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink">
                        {booking.clientNote}
                      </p>
                    </div>
                  )}
                  {booking.cancellationReason && (
                    <div className="rounded-md bg-danger-soft px-2.5 py-2">
                      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-danger-ink">
                        Cancellation reason
                      </p>
                      <p className="mt-1 text-[0.8125rem] leading-relaxed text-danger-ink">
                        {booking.cancellationReason}
                      </p>
                    </div>
                  )}
                </div>
              </Section>
            )}

            <BookingReview
              bookingId={booking.id}
              bookingStatus={booking.status}
              viewerRole={booking.viewerRole}
              viewerZone={viewerZone}
              otherPartyName={otherParty.businessName || otherParty.name}
            />

            <BookingTimeline timeline={booking.timeline} viewerZone={viewerZone} />
          </>
        }
      >
        <AppointmentPanel booking={booking} isClient={isClient} otherParty={otherParty} />

        {isActive && (
          <Section title={isClient ? "Manage appointment" : "Actions"}>
            <div className="flex flex-wrap gap-2">
              {isClient ? (
                <>
                  {/* Moving it is offered before cancelling it, and styled as the
                      primary action: a client who wants a different time is better
                      served by keeping the appointment than by dropping it. Both
                      are governed by the same cutoff. */}
                  <button
                    type="button"
                    onClick={() => setRescheduleOpen(true)}
                    disabled={!booking.canClientReschedule || working}
                    className={primaryButton}
                  >
                    <Icon name="calendar" size={15} />
                    Reschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    disabled={!booking.canClientCancel || working}
                    className={dangerButton}
                  >
                    <Icon name="close" size={15} />
                    Cancel booking
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setRescheduleOpen(true)}
                    disabled={working}
                    className={primaryButton}
                  >
                    <Icon name="calendar" size={15} />
                    Reschedule
                  </button>
                  {/* Only meaningful once the appointment has actually happened —
                      the server refuses these before then, so the buttons follow. */}
                  {hasStarted && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPendingOutcome("completed")}
                        disabled={working}
                        className={secondaryButton}
                      >
                        <Icon name="check" size={15} />
                        Mark completed
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingOutcome("no_show")}
                        disabled={working}
                        className={secondaryButton}
                      >
                        <Icon name="ban" size={15} />
                        Mark no-show
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    disabled={working}
                    className={dangerButton}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {isClient && (
              <p className="mt-3 flex items-start gap-1.5 border-t border-line-soft pt-3 text-xs leading-relaxed text-ink-3">
                <Icon name="info" size={13} className="mt-px" />
                <span>
                  {booking.canClientCancel
                    ? `You can move or cancel this yourself up to ${booking.cancellationCutoffHours} hour${
                        booking.cancellationCutoffHours === 1 ? "" : "s"
                      } before it starts.`
                    : // "Contact them directly" pointed at nothing: no phone
                      // number or email for the provider appears anywhere on
                      // this page, while the message thread that does reach them
                      // is a few inches below and works on a closed booking.
                      `The ${booking.cancellationCutoffHours}-hour window for changing this has closed. Message ${otherParty.name} below to ask about moving or cancelling it.`}
                </span>
              </p>
            )}
          </Section>
        )}

        {!isActive && isClient && (
          <Section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-2">
                This appointment is {booking.status.replace("_", "-")}.
              </p>
              <Link to={`/providers/${booking.provider.id}`} className={`${primaryButton} ${buttonSm}`}>
                Book with {otherParty.businessName || otherParty.name} again
              </Link>
            </div>
          </Section>
        )}

        <BookingConversation
          bookingId={booking.id}
          otherPartyName={otherParty.businessName || otherParty.name}
        />
      </SplitLayout>

      <Modal
        open={cancelOpen}
        onClose={() => !working && setCancelOpen(false)}
        title="Cancel this booking?"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              disabled={working}
              className={secondaryButton}
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={handleCancel}
              // A provider must give a reason; a client's is optional.
              disabled={working || (!isClient && !reason.trim())}
              className={dangerButton}
            >
              {working ? "Cancelling…" : "Cancel booking"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2">
          The slot goes straight back into {isClient ? "the provider's" : "your"} available times. This
          booking stays in {isClient ? "your" : "the"} history, marked cancelled.
        </p>

        <Field
          id="cancel-reason"
          label="Reason"
          optional={isClient}
          className="mt-4"
          hint={isClient ? undefined : "The client will see this."}
          action={<CharCount value={reason} max={MAX_REASON} />}
        >
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={MAX_REASON}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isClient ? "Anything you'd like them to know" : "The client will see this — be clear and kind"
            }
          />
        </Field>
      </Modal>

      {/* One dialog for both outcomes. They are the same decision taken two ways
          and neither is reversible, so they get the same shape; only the copy and
          the weight of the confirm button differ. Worded to match the same pair
          of confirmations on the provider dashboard. */}
      <Modal
        open={Boolean(pendingOutcome)}
        onClose={() => !working && setPendingOutcome(null)}
        title={
          pendingOutcome === "no_show"
            ? "Mark this as a no-show?"
            : "Mark this appointment as completed?"
        }
        description={`${otherParty.name ?? "This client"} · ${booking.service?.name ?? ""}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setPendingOutcome(null)}
              disabled={working}
              className={secondaryButton}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleStatusChange(pendingOutcome)}
              disabled={working}
              // Completed is the ordinary end of an appointment that happened,
              // so it does not get the danger treatment a no-show does.
              className={pendingOutcome === "no_show" ? dangerButton : primaryButton}
            >
              {working ? "Saving…" : "Confirm"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2">
          {pendingOutcome === "no_show" ? (
            <>
              Nothing is added to your earnings, the client sees this on their own record, and they
              cannot review the appointment. If they did attend, choose Completed instead. This
              cannot be undone.
            </>
          ) : (
            <>
              Are you sure you want to mark this appointment as completed?{" "}
              {formatPrice(booking.service.price, booking.service.currency)} is added to your
              earnings and the client can leave a review. This cannot be undone.
            </>
          )}
        </p>
      </Modal>

      <RescheduleDialog
        open={rescheduleOpen}
        booking={booking}
        onClose={() => setRescheduleOpen(false)}
        onRescheduled={() => {
          setRescheduleOpen(false);
          load();
        }}
      />
    </Page>
  );
}

/**
 * The appointment itself — the page's headline.
 *
 * ## Why the time is the largest thing here
 *
 * It renders side by side when the two zones differ, and collapses to a single
 * reading when they match: repeating an identical time twice under two headings
 * looks like a bug rather than like care.
 *
 * The zones are each party's *current* one, so an appointment follows its owner
 * when they change their profile timezone. The appointment itself does not move —
 * it is a fixed instant — but the clock face it is read on does. When the viewer's
 * zone has changed since they booked, `MovedZoneNote` says so, because a time that
 * has silently shifted since you last looked is unsettling unless something
 * explains why.
 */
function AppointmentPanel({ booking, isClient, otherParty }) {
  const sameZone = booking.client.timezone === booking.provider.timezone;
  const viewerZone = isClient ? booking.client.timezone : booking.provider.timezone;
  const upcoming = booking.status === "booked" || booking.status === "rescheduled";

  return (
    <Section
      tone="brand"
      title="Appointment time"
      className={accentEdge}
    >
      {/* The countdown lives in the body, not the header. The header of a
          `tone="brand"` Section is brand-tinted, and the highlight tint is a
          neighbouring shade of the same family — a pill placed there sat at
          almost identical lightness to the strip behind it and vanished. On the
          white body it reads immediately. */}
      {upcoming && (
        <p className="mb-3">
          <span className={highlightPill}>
            <Icon name="clock" size={12} />
            Starts {relativeTime(booking.startsAt)}
          </span>
        </p>
      )}

      {sameZone ? (
        <div>
          <p className={metricLg}>
            {formatTime(booking.startsAt, viewerZone)}
            <span className="font-normal text-ink-3">
              {" – "}
              {formatTime(booking.endsAt, viewerZone)}
            </span>
          </p>
          <p className="mt-1 text-base text-ink-2">
            {formatLongDate(booking.startsAt, viewerZone)}
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {metaLine(zoneName(viewerZone), zoneLabel(booking.startsAt, viewerZone))}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-line-soft">
          {/* Named from the reader's side, so one of the two is always "Your
              time" and the other is the party they are dealing with.

              These were fixed labels — "Client's time" and "Provider's time" —
              with a "· yours" tacked onto whichever one belonged to the viewer.
              A client therefore read "CLIENT'S TIME · YOURS", which says the
              same thing twice in two different vocabularies and makes the reader
              translate a role name into a person before they can tell which
              column is theirs. A provider got "PROVIDER'S TIME · YOURS", the
              same problem from the other side.

              The columns stay in the same order for both roles: the client's
              zone on the left, the provider's on the right. It happens to put
              the reader's own column first for a client and second for a
              provider, which is fine — the type scale below, not the position,
              is what marks which one is theirs, and a layout that reshuffles
              itself by role is harder to describe to someone than one that does
              not. */}
          <ZoneReading
            heading={isClient ? "Your time" : "Client's time"}
            zone={booking.client.timezone}
            startsAt={booking.startsAt}
            endsAt={booking.endsAt}
            highlighted={isClient}
          />
          <ZoneReading
            heading={isClient ? "Provider's time" : "Your time"}
            zone={booking.provider.timezone}
            startsAt={booking.startsAt}
            endsAt={booking.endsAt}
            highlighted={!isClient}
            className="sm:pl-4"
          />
        </div>
      )}

      <div className="mt-4 flex items-center gap-2.5 border-t border-line-soft pt-3.5">
        <Avatar src={otherParty.avatarUrl} name={otherParty.name} size="sm" />
        <p className="min-w-0 truncate text-sm text-ink-2">
          {isClient ? "with " : "for "}
          <span className="font-medium text-ink">{otherParty.businessName || otherParty.name}</span>
        </p>
      </div>

      <MovedZoneNote booking={booking} />
    </Section>
  );
}

function ZoneReading({ heading, zone, startsAt, endsAt, highlighted, className = "" }) {
  return (
    <div className={className}>
      {/* No "· yours" any more: the heading says "Your time" when it is the
          reader's, so the suffix was restating it. `highlighted` still drives
          the type scale below, which is what actually distinguishes the two. */}
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {heading}
      </p>
      <p
        // The viewer's own reading is the one they act on, so it is the larger and
        // heavier of the two. The other party's is context.
        className={`mt-1 tracking-tight tabular-nums ${
          highlighted ? "text-2xl font-bold text-ink" : "text-lg font-medium text-ink-2"
        }`}
      >
        {formatTime(startsAt, zone)}
        <span className="font-normal text-ink-3"> – {formatTime(endsAt, zone)}</span>
      </p>
      <p className="mt-0.5 text-[0.8125rem] text-ink-2">{formatLongDate(startsAt, zone)}</p>
      <p className="mt-0.5 text-xs text-ink-3">{zoneName(zone)}</p>
    </div>
  );
}

/**
 * Explains a time that has changed since the user last looked.
 *
 * Only rendered when the viewer's current timezone differs from the one they held
 * when the booking was made. Without it, someone who books at 09:00 in Kolkata,
 * moves to Mexico and returns to this page finds a different clock time and no
 * reason for it — which reads as a bug. Naming the original zone makes it legible:
 * the appointment is the same moment, shown on a different clock.
 */
function MovedZoneNote({ booking }) {
  const party = booking.viewerRole === "client" ? booking.client : booking.provider;
  const bookedIn = party.timezoneAtBooking;

  if (!bookedIn || bookedIn === party.timezone) return null;

  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-md bg-subtle px-2.5 py-2 text-xs leading-relaxed text-ink-3">
      <Icon name="globe" size={13} className="mt-px" />
      <span>
        Shown in your current timezone, <span className="font-medium text-ink">{zoneName(party.timezone)}</span>
        . You booked this while using <span className="font-medium text-ink">{zoneName(bookedIn)}</span> —
        the appointment itself has not moved.
      </span>
    </p>
  );
}

function DetailRow({ label, value }) {
  if (value == null) return null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-5 py-2.5">
      <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[0.8125rem] text-ink">{value}</dd>
    </div>
  );
}

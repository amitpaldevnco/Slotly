/**
 * Moving an existing booking — used by both parties, on different terms.
 *
 * The differences are deliberate and mirror the server's rules exactly (see
 * `rescheduleBooking`):
 *
 *   - **Whose clock the times are drawn in.** The provider is choosing a slot on
 *     their own calendar, so they see their own zone. The client sees theirs —
 *     the same zone the original booking screen used — because a client picking
 *     "3:00 PM" in the provider's zone would be choosing a time they have not
 *     actually read.
 *   - **Whether a reason is required.** The provider is imposing the change on
 *     someone else and must explain it. The client is moving their own
 *     appointment and owes nobody an explanation, so the field is optional.
 *   - **Whether the terms have to be agreed first.** A client's move enters the
 *     service's current price and duration, so when the provider has edited
 *     either since, this dialog opens on the figures rather than on the picker.
 *     Only for the client, and only because it is their money — the provider
 *     moving the same booking keeps the terms it was made under.
 *
 * ## Why the terms are a step and not a footnote
 *
 * The server refuses a client's first attempt with `SERVICE_TERMS_CHANGED` and
 * writes nothing, so the question can be asked without the answer having already
 * been committed. That refusal is also handled here as a late arrival: a provider
 * can edit the service while this dialog is open, and the choice then has to be
 * put to the client rather than failing with a message they cannot act on.
 */
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { parseApiError } from "../../api/client";
import * as bookingsApi from "../../api/bookings";
import * as providersApi from "../../api/providers";
import { useApiResource } from "../../hooks/useApiResource";
import { useToast } from "../../context/ToastContext";
import Modal from "../ui/Modal";
import Icon from "../ui/Icon";
import Field, { Textarea, CharCount } from "../ui/Field";
import { Refreshing, SkeletonRows } from "../ui/Feedback";
import { addDaysToDate, friendlyDateHeading, todayIn } from "../../lib/time";
import { bookingNoticeBody } from "../../lib/bookingNotice";
import {
  primaryButton,
  secondaryButton,
  iconButton,
  formatPrice,
  formatDuration,
} from "../../lib/ui";

const WINDOW_DAYS = 7;
const MAX_REASON = 500;

/**
 * The two sets of figures, side by side, and a plain sentence for each thing that
 * actually moved.
 *
 * Both columns are always drawn even when only one row changed, because "what it
 * was" and "what it becomes" is the comparison being asked about — printing only
 * the delta would leave the client working out which number they currently hold.
 * The changed rows are the only ones marked, so the eye still goes to them.
 */
function TermsComparison({ changes }) {
  const { price, duration, currency } = changes;

  const rows = [
    {
      label: "Price",
      changed: price.changed,
      was: formatPrice(price.booked, currency),
      now: formatPrice(price.current, currency),
    },
    {
      label: "Duration",
      changed: duration.changed,
      was: formatDuration(duration.booked),
      now: formatDuration(duration.current),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-line">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-line bg-subtle px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-3">
          <span />
          <span className="text-right">You booked</span>
          <span className="text-right">Now</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 border-b border-line-soft px-3 py-2 text-sm last:border-b-0"
          >
            <span className="text-ink-2">{row.label}</span>
            <span className={`text-right tabular-nums ${row.changed ? "text-ink-3 line-through" : "text-ink"}`}>
              {row.was}
            </span>
            <span
              className={`text-right tabular-nums ${row.changed ? "font-semibold text-ink" : "text-ink-3"}`}
            >
              {row.now}
            </span>
          </div>
        ))}
      </div>

      <ul className="space-y-1 text-[0.8125rem] text-ink-2">
        {price.changed && (
          <li>
            The price will change from{" "}
            <span className="font-semibold text-ink">{formatPrice(price.booked, currency)}</span> to{" "}
            <span className="font-semibold text-ink">{formatPrice(price.current, currency)}</span> if
            you move this appointment.
          </li>
        )}
        {duration.changed && (
          <li>
            Your appointment will now run for{" "}
            <span className="font-semibold text-ink">{formatDuration(duration.current)}</span>{" "}
            instead of {formatDuration(duration.booked)}.
          </li>
        )}
        <li className="text-ink-3">
          Nothing has changed yet — cancel and your appointment stays exactly as it is.
        </li>
      </ul>
    </div>
  );
}

export default function RescheduleDialog({ open, booking, onClose, onRescheduled }) {
  const toast = useToast();

  const isClient = booking?.viewerRole === "client";

  // The zone every time in this dialog is rendered in: whichever party is
  // looking. Named `viewerZone` rather than `providerZone` because it is no
  // longer always the provider's.
  const viewerZone =
    (isClient ? booking?.client?.timezone : booking?.provider?.timezone) || "UTC";

  const [rangeStart, setRangeStart] = useState(() => todayIn(viewerZone));
  const [activeDate, setActiveDate] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Whether the client has agreed to the service's current price and duration,
  // and the report they are agreeing to. `lateChanges` is set only when the
  // server refuses a submit that this dialog thought was clear — the provider
  // edited the service while it was open.
  const [accepted, setAccepted] = useState(false);
  const [lateChanges, setLateChanges] = useState(null);

  // Only ever a gate on the client; the server says as much in
  // `requiresAcceptance`, and this trusts it rather than re-deriving the rule.
  const changes =
    lateChanges || (isClient && booking?.serviceChanges?.requiresAcceptance
      ? booking.serviceChanges
      : null);

  const showTerms = Boolean(changes) && !accepted;

  const {
    data,
    loading,
    refreshing,
    error,
    reload: loadSlots,
  } = useApiResource(
    ({ signal }) =>
      providersApi.getSlots(
        booking.provider.id,
        {
          serviceId: booking.service.id,
          from: rangeStart,
          to: addDaysToDate(rangeStart, WINDOW_DAYS - 1),
          // Rendered in the provider's own zone: they are the one choosing, and
          // this is their calendar.
          timezone: viewerZone,
          // Asks for times *this* appointment could move to, rather than times a
          // new one could be booked at. Without it the list is wrong in three
          // ways the server can see and this dialog cannot: the appointment
          // blocks its own move, the slots are sized from the service's current
          // duration rather than the one this booking is held at, and a retired
          // service answers 404. See `getSlots` and `getAvailableSlots`.
          bookingId: booking.id,
        },
        { signal }
      ),
    {
      enabled: open && Boolean(booking),
      deps: [open, booking?.id, rangeStart, viewerZone],
      fallback: "Could not load your free times.",
      // Paging to another week used to swap the slot list for two grey bars, so
      // the arrow the provider had just pressed emptied the pane beneath it.
      // The previous week's times stay and dim instead.
      keepPreviousData: true,
    }
  );

  const days = useMemo(() => data?.days ?? [], [data]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);


  useEffect(() => {
    if (open) {
      setSelected(null);
      setReason("");
      setRangeStart(todayIn(viewerZone));
      // Consent does not survive the dialog closing. Re-opening it asks again,
      // which is the only safe default for something that changes what is owed.
      setAccepted(false);
      setLateChanges(null);
    }
  }, [open, viewerZone]);


  useEffect(() => {
    if (days.length === 0) {
      setActiveDate(null);
      return;
    }
    if (activeDate && days.some((day) => day.date === activeDate)) return;
    setActiveDate(days.find((day) => day.slots.length > 0)?.date ?? days[0].date);
  }, [days, activeDate]);

  const handleSubmit = async () => {
    if (!selected || (!isClient && !reason.trim())) return;

    setSaving(true);
    try {
      // The response is the moved booking, and it is what the message below is
      // built from — not the local `selected` slot or the stale `booking` prop.
      // That is what makes the notification carry the *latest* appointment: the
      // handler re-selects through BOOKING_SELECT after the write, so the venue
      // it returns is the provider's current address (or the service's current
      // meeting link) rather than whatever was on screen when the dialog opened.
      const moved = await bookingsApi.reschedule(booking.id, {
        startsAt: selected.startsAt,
        // Omitted entirely rather than sent empty, so the timeline records no
        // reason instead of a blank one.
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        // Sent only once the client has actually seen the figures and agreed. The
        // server refuses the move without it, which is what makes the agreement
        // real rather than a checkbox this dialog could forget to tick.
        ...(accepted ? { acceptChanges: true } : {}),
      });

      // A move is the one change where restating everything earns its space: the
      // reader has just replaced the time they had memorised, so the message
      // names the appointment, the new moment and where it happens. Previously
      // it said only that the *other* party could see the new time, which is the
      // one fact the person reading it did not need.
      const detail = bookingNoticeBody({ booking: moved, viewerZone });
      const audience = isClient
        ? "The provider can see your new time."
        : "The client can see the new time and why it changed.";

      toast.success(detail ? `${detail}\n${audience}` : audience, {
        title: "Appointment moved",
        duration: 11000,
      });
      onRescheduled();
    } catch (err) {
      const parsed = parseApiError(err, "Could not move this appointment.");

      if (parsed.code === "SLOT_TAKEN") {
        // The same race a client can lose, from the provider's side.
        toast.error(
          isClient
            ? "Someone booked that time while you were choosing. Here are the times still free."
            : "A client booked that time while you were choosing. Here are the times still free."
        );
        setSelected(null);
        loadSlots();
      } else if (parsed.code === "SERVICE_TERMS_CHANGED") {
        // The provider edited the service while this dialog was open. The choice
        // has to be put to the client rather than reported as a failure they can
        // do nothing about — and the server wrote nothing, so the selected time
        // is still valid and is kept.
        setLateChanges(parsed.details);
        setAccepted(false);
        toast.error("This service has changed since you booked. Please review the new details.");
      } else {
        toast.error(parsed.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!booking) return null;

  const activeDay = days.find((day) => day.date === activeDate) || null;
  const isFirstWindow = rangeStart === todayIn(viewerZone);

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={showTerms ? "Service details have changed" : "Move this appointment"}
      description={
        showTerms
          ? `${booking.provider.businessName || booking.provider.name} has updated this service since you booked. Moving your appointment uses the current details.`
          : isClient
            ? `${booking.provider.businessName || booking.provider.name} will see the new time in their own timezone.`
            : `${booking.client.name} will see the new time in their own timezone.`
      }
      size="lg"
      footer={
        showTerms ? (
          <>
            <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
              Cancel
            </button>
            <button type="button" onClick={() => setAccepted(true)} className={primaryButton}>
              {changes.price.changed
                ? `Accept ${formatPrice(changes.price.current, changes.currency)} & choose a time`
                : "Accept the changes & choose a time"}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || !selected || (!isClient && !reason.trim())}
              className={primaryButton}
            >
              {saving ? "Moving…" : "Move appointment"}
            </button>
          </>
        )
      }
    >
      {showTerms ? (
        <TermsComparison changes={changes} />
      ) : (
      <div className="space-y-4">
        {/* What was agreed, restated where the commitment is actually made. The
            client accepted on the previous step and then went looking through a
            week of times, which is long enough to have stopped holding the
            figure in mind. */}
        {accepted && changes && (
          <div className="flex items-start gap-2 rounded-md border border-line bg-subtle px-3 py-2 text-[0.8125rem] text-ink-2">
            <Icon name="check" size={15} className="mt-0.5 shrink-0 text-ink-3" />
            <span>
              {changes.price.changed && (
                <>
                  New price{" "}
                  <span className="font-semibold text-ink">
                    {formatPrice(changes.price.current, changes.currency)}
                  </span>{" "}
                  accepted.
                </>
              )}
              {changes.price.changed && changes.duration.changed && " "}
              {changes.duration.changed && (
                <>
                  This appointment will run for{" "}
                  <span className="font-semibold text-ink">
                    {formatDuration(changes.duration.current)}
                  </span>
                  .
                </>
              )}
            </span>
          </div>
        )}

        {selected && (
          <div className="flex items-center gap-2 rounded-md border border-brand-line bg-brand-soft px-3 py-2 text-sm text-brand-ink">
            <Icon name="calendarCheck" size={15} />
            <span>
              Moving to{" "}
              <span className="font-semibold">
                {friendlyDateHeading(activeDate, viewerZone)} at {selected.clientTime}
              </span>
            </span>
          </div>
        )}

        <div className="overflow-hidden rounded-md border border-line">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-subtle px-2.5 py-2">
            <h3 className="text-xs font-semibold text-ink">
              {/* "Your" is only true for the provider — these are the provider's
                  open slots, which from the client's side are simply what is
                  available. */}
              {isClient ? "Available times" : "Your free times"}
            </h3>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setRangeStart(addDaysToDate(rangeStart, -WINDOW_DAYS))}
                disabled={isFirstWindow}
                aria-label="Earlier week"
                className={iconButton}
              >
                <Icon name="chevronLeft" size={15} />
              </button>
              <button
                type="button"
                onClick={() => setRangeStart(addDaysToDate(rangeStart, WINDOW_DAYS))}
                aria-label="Later week"
                className={iconButton}
              >
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-3">
              <SkeletonRows count={2} variant="line" label="Loading free times…" />
            </div>
          ) : days.length === 0 ? (
            <p className="px-3 py-5 text-center text-[0.8125rem] text-ink-3">
              No free slots this week.{" "}
              <button
                type="button"
                onClick={() => setRangeStart(addDaysToDate(rangeStart, WINDOW_DAYS))}
                className="font-medium text-brand underline"
              >
                Try the next one
              </button>
              .
            </p>
          ) : (
            // Dims while the next week is fetched, rather than reverting to the
            // skeleton above. See `keepPreviousData` on the resource.
            <Refreshing active={refreshing}>
              <div
                role="tablist"
                aria-label="Choose a day"
                className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line-soft p-2"
              >
                {days.map((day) => {
                  const date = DateTime.fromISO(day.date, { zone: viewerZone });
                  const active = day.date === activeDate;
                  const free = day.slots.length;

                  return (
                    <button
                      key={day.date}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveDate(day.date)}
                      className={`flex min-w-[3.5rem] shrink-0 flex-col items-center rounded-md border px-2 py-1.5 transition ${
                        active
                          ? "border-brand bg-brand text-white"
                          : free === 0
                            ? "border-line bg-subtle text-ink-3"
                            : "border-line bg-surface text-ink hover:border-brand-line"
                      }`}
                    >
                      <span
                        className={`text-[0.625rem] uppercase ${active ? "text-white/75" : "text-ink-3"}`}
                      >
                        {date.toFormat("ccc")}
                      </span>
                      <span className="text-sm font-semibold tabular-nums leading-tight">
                        {date.toFormat("d")}
                      </span>
                      <span className={`text-[0.625rem] ${active ? "text-white/80" : "text-ink-3"}`}>
                        {free === 0 ? "—" : free}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="max-h-44 overflow-y-auto p-2">
                {!activeDay ? null : activeDay.slots.length === 0 ? (
                  <p className="py-4 text-center text-[0.8125rem] text-ink-3">
                    Nothing free on {friendlyDateHeading(activeDay.date, viewerZone)}.
                  </p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5">
                    {activeDay.slots.map((slot) => {
                      const isSelected = selected?.startsAt === slot.startsAt;

                      return (
                        <button
                          key={slot.startsAt}
                          type="button"
                          onClick={() => setSelected(slot)}
                          aria-pressed={isSelected}
                          className={`min-h-9 rounded-md border px-2 text-[0.8125rem] font-medium transition ${
                            isSelected
                              ? "border-brand bg-brand text-white"
                              : "border-line bg-surface text-ink hover:border-brand hover:bg-brand-soft"
                          }`}
                        >
                          {slot.clientTime}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </Refreshing>
          )}
        </div>

        <Field
          id="reschedule-reason"
          label={isClient ? "Add a note (optional)" : "Why are you moving it?"}
          hint={
            isClient
              ? "Shared with the provider along with the new time."
              : "The client will see this, along with the new time."
          }
          action={<CharCount value={reason} max={MAX_REASON} />}
        >
          <Textarea
            id="reschedule-reason"
            rows={2}
            maxLength={MAX_REASON}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isClient
                ? "e.g. Something came up that morning"
                : "e.g. Clinic closing early that afternoon"
            }
          />
        </Field>
      </div>
      )}
    </Modal>
  );
}

// Provider-only dialog for moving an existing booking.
 
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
import { SkeletonRows } from "../ui/Feedback";
import { addDaysToDate, friendlyDateHeading, todayIn } from "../../lib/time";
import { primaryButton, secondaryButton, iconButton } from "../../lib/ui";

const WINDOW_DAYS = 7;
const MAX_REASON = 500;

export default function RescheduleDialog({ open, booking, onClose, onRescheduled }) {
  const toast = useToast();

  const providerZone = booking?.provider?.timezone || "UTC";

  const [rangeStart, setRangeStart] = useState(() => todayIn(providerZone));
  const [activeDate, setActiveDate] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    data,
    loading,
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
          timezone: providerZone,
        },
        { signal }
      ),
    {
      enabled: open && Boolean(booking),
      deps: [open, booking?.id, rangeStart, providerZone],
      fallback: "Could not load your free times.",
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
      setRangeStart(todayIn(providerZone));
    }
  }, [open, providerZone]);


  useEffect(() => {
    if (days.length === 0) {
      setActiveDate(null);
      return;
    }
    if (activeDate && days.some((day) => day.date === activeDate)) return;
    setActiveDate(days.find((day) => day.slots.length > 0)?.date ?? days[0].date);
  }, [days, activeDate]);

  const handleSubmit = async () => {
    if (!selected || !reason.trim()) return;

    setSaving(true);
    try {
      await bookingsApi.reschedule(booking.id, {
        startsAt: selected.startsAt,
        reason: reason.trim(),
      });
      toast.success("Appointment moved. The client can see the new time and why it changed.");
      onRescheduled();
    } catch (err) {
      const parsed = parseApiError(err, "Could not move this appointment.");

      if (parsed.code === "SLOT_TAKEN") {
        // The same race a client can lose, from the provider's side.
        toast.error("A client booked that time while you were choosing. Here are the times still free.");
        setSelected(null);
        loadSlots();
      } else {
        toast.error(parsed.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!booking) return null;

  const activeDay = days.find((day) => day.date === activeDate) || null;
  const isFirstWindow = rangeStart === todayIn(providerZone);

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Move this appointment"
      description={`${booking.client.name} will see the new time in their own timezone.`}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !selected || !reason.trim()}
            className={primaryButton}
          >
            {saving ? "Moving…" : "Move appointment"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
      
        {selected && (
          <div className="flex items-center gap-2 rounded-md border border-brand-line bg-brand-soft px-3 py-2 text-sm text-brand-ink">
            <Icon name="calendarCheck" size={15} />
            <span>
              Moving to{" "}
              <span className="font-semibold">
                {friendlyDateHeading(activeDate, providerZone)} at {selected.providerTime}
              </span>
            </span>
          </div>
        )}

        <div className="overflow-hidden rounded-md border border-line">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-subtle px-2.5 py-2">
            <h3 className="text-xs font-semibold text-ink">Your free times</h3>
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
              <SkeletonRows count={2} variant="line" />
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
            <>
              <div
                role="tablist"
                aria-label="Choose a day"
                className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line-soft p-2"
              >
                {days.map((day) => {
                  const date = DateTime.fromISO(day.date, { zone: providerZone });
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
                    Nothing free on {friendlyDateHeading(activeDay.date, providerZone)}.
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
                          {slot.providerTime}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <Field
          id="reschedule-reason"
          label="Why are you moving it?"
          hint="The client will see this, along with the new time."
          action={<CharCount value={reason} max={MAX_REASON} />}
        >
          <Textarea
            id="reschedule-reason"
            rows={2}
            maxLength={MAX_REASON}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Clinic closing early that afternoon"
          />
        </Field>
      </div>
    </Modal>
  );
}

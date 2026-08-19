/**
 * One-off overrides to a provider's weekly pattern: blocking a date or range
 * (holiday, sick day) and opening extra hours on a specific date.
 *
 * Dates here are calendar dates, not instants — "22 August" means that day on
 * the provider's own calendar, wherever anyone reading it happens to be — so
 * they travel as bare "YYYY-MM-DD" strings and are never converted. `todayIn()`
 * supplies the lower bound in the provider's zone rather than the browser's, so
 * a provider cannot be offered a date that is already yesterday for them.
 */
import { useState } from "react";
import { DateTime } from "luxon";
import { parseApiError } from "../../api/client";
import * as availabilityApi from "../../api/availability";
import { useToast } from "../../context/ToastContext";
import Icon from "../ui/Icon";
import Field, { Input, CardRadioGroup } from "../ui/Field";
import EmptyState from "../ui/Feedback";
import { formatClockTime, todayIn } from "../../lib/time";
import {
  primaryButton,
  ghostButton,
  buttonSm,
  badgeVariants,
} from "../../lib/ui";

/** Renders an exception's date range the way a person would say it. */
function describeRange(exception) {
  const start = DateTime.fromISO(exception.startDate);
  const end = DateTime.fromISO(exception.endDate);

  if (exception.startDate === exception.endDate) return start.toFormat("ccc d LLLL yyyy");

  // Same month reads better collapsed: "3–7 June 2026" rather than repeating it.
  if (start.month === end.month && start.year === end.year) {
    return `${start.toFormat("d")}–${end.toFormat("d LLLL yyyy")}`;
  }
  return `${start.toFormat("d LLL")} – ${end.toFormat("d LLL yyyy")}`;
}


export default function ExceptionsEditor({ exceptions, timezone, serviceId, onChanged }) {
  const toast = useToast();

  const today = todayIn(timezone || "UTC");

  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState("block");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // "Open" means adding hours, which is meaningless without saying which hours,
  // so the all-day option does not apply to it.
  const showTimeFields = kind === "open" || !allDay;

  const resetForm = () => {
    setStartDate(today);
    setEndDate("");
    setAllDay(true);
    setStartTime("09:00");
    setEndTime("17:00");
    setNote("");
    setErrors({});
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrors({});
    setSaving(true);

    try {
      const payload = {
        kind,
        startDate,
        // Omitted rather than sent equal to startDate: the API defaults it, and
        // sending an empty string would fail its date validation.
        ...(endDate ? { endDate } : {}),
        ...(showTimeFields ? { startTime, endTime } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(serviceId ? { serviceId } : {}),
      };

      const created = await availabilityApi.createException(payload);
      onChanged([...exceptions, created]);
      resetForm();
      setFormOpen(false);
      toast.success(kind === "block" ? "Time blocked off." : "Extra hours added.");
    } catch (err) {
      const parsed = parseApiError(err, "Could not save that exception.");
      setErrors(parsed.fieldErrors);
      toast.error(parsed.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await availabilityApi.deleteException(id);
      onChanged(exceptions.filter((exception) => exception.id !== id));
      toast.success("Exception removed.");
    } catch (err) {
      toast.error(parseApiError(err, "Could not remove that exception.").message);
    } finally {
      setDeletingId(null);
    }
  };

  // Soonest first, so what is coming up next is at the top of the list rather
  // than wherever the API happened to return it.
  const sorted = [...exceptions].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant bg-surface/50 p-6">
        <div>
          <h2 className="font-h3 text-[18px] font-semibold text-primary">Exceptions</h2>
          <p className="mt-1 font-caption text-caption text-on-surface-variant">
            Holidays and one-off hours that override the pattern above.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          aria-expanded={formOpen}
          className="-mx-2 flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-2 font-small text-small text-on-surface-variant transition-colors hover:text-primary"
        >
          <Icon name={formOpen ? "close" : "add"} size={16} />
          {formOpen ? "Cancel" : "Add exception"}
        </button>
      </div>
      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="space-y-5 border-b border-outline-variant bg-surface-container-low p-6"
        >
          <CardRadioGroup
            name="exceptionKind"
            legend="What are you adding?"
            value={kind}
            onChange={setKind}
            options={[
              {
                value: "block",
                title: "Block time off",
                hint: "Holiday, appointment, sick day",
                icon: "ban",
              },
              {
                value: "open",
                title: "Open extra hours",
                hint: "A one-off outside your usual week",
                icon: "plus",
              },
            ]}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="exception-start" label="From" error={errors.startDate}>
              <Input
                id="exception-start"
                type="date"
                value={startDate}
                min={today}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </Field>

            <Field
              id="exception-end"
              label="To"
              optional
              hint="Leave blank for a single day."
              error={errors.endDate}
            >
              <Input
                id="exception-end"
                type="date"
                value={endDate}
                min={startDate || today}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
          </div>

          {kind === "block" && (
            <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="h-4 w-4"
              />
              Block the whole day
            </label>
          )}

          {showTimeFields && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="exception-start-time" label="Start time" error={errors.startTime}>
                <Input
                  id="exception-start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </Field>
              <Field id="exception-end-time" label="End time" error={errors.endTime}>
                <Input
                  id="exception-end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field
            id="exception-note"
            label="Note"
            optional
            hint="Only you see this."
            error={errors.note}
          >
            <Input
              id="exception-note"
              type="text"
              value={note}
              maxLength={255}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Family holiday"
            />
          </Field>

          <button type="submit" disabled={saving} className={`${primaryButton} ${buttonSm}`}>
            {saving ? "Saving…" : kind === "block" ? "Block this time" : "Add these hours"}
          </button>
        </form>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          compact
          icon="calendar"
          title="No exceptions"
          description="Your weekly hours apply every week. Add an exception for a holiday or a one-off."
        />
      ) : (
        <ul className="divide-y divide-outline-variant/50">
          {sorted.map((exception) => {
            const isBlock = exception.kind === "block";

            return (
              <li key={exception.id} className="flex items-start gap-4 p-6">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                    isBlock ? "bg-danger-soft text-danger-ink" : "bg-brand-soft text-brand-ink"
                  }`}
                >
                  <Icon name={isBlock ? "ban" : "plus"} size={13} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[0.8125rem] font-medium text-ink">
                      {describeRange(exception)}
                    </span>
                    <span className={isBlock ? badgeVariants.danger : badgeVariants.brand}>
                      {isBlock ? "Blocked" : "Extra hours"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {exception.isAllDay
                      ? "All day"
                      : `${formatClockTime(exception.startTime)} – ${formatClockTime(exception.endTime)}`}
                    {exception.note ? ` · ${exception.note}` : ""}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(exception.id)}
                  disabled={deletingId === exception.id}
                  aria-label={`Remove exception on ${describeRange(exception)}`}
                  className={`${ghostButton} ${buttonSm} shrink-0 hover:bg-danger-soft hover:text-danger-ink`}
                >
                  {deletingId === exception.id ? "Removing…" : <Icon name="trash" size={15} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

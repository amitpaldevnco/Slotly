/**
 * The weekly recurring-hours grid.
 *
 * Edits the whole week as one form and saves it in one request,
 */
import { useState } from "react";
import { parseApiError } from "../../api/client";
import * as availabilityApi from "../../api/availability";
import { useToast } from "../../context/ToastContext";
import Icon from "../ui/Icon";
import { Section } from "../ui/Page";
import { timeToMinutes } from "../../lib/time";
import {
  inputClasses,
  primaryButton,
  secondaryButton,
  ghostButton,
  buttonSm,
  iconButton,
  zoneName,
} from "../../lib/ui";

const WEEKDAYS = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

const DEFAULT_WINDOW = { startTime: "09:00", endTime: "17:00" };

/** Groups the flat rule list the API returns into one bucket per weekday. */
function groupByWeekday(rules) {
  const grouped = {};
  for (const day of WEEKDAYS) grouped[day.value] = [];

  for (const rule of rules) {
    if (!grouped[rule.weekday]) grouped[rule.weekday] = [];
    grouped[rule.weekday].push({ startTime: rule.startTime, endTime: rule.endTime });
  }

  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  return grouped;
}


function validateWeek(windowsByDay) {
  const errors = {};

  for (const day of WEEKDAYS) {
    const windows = windowsByDay[day.value] || [];

    windows.forEach((window, index) => {
      const start = timeToMinutes(window.startTime);
      const end = timeToMinutes(window.endTime);
      const key = `${day.value}-${index}`;

      if (start === null) errors[key] = "Start time must be HH:MM";
      else if (end === null) errors[key] = "End time must be HH:MM";
      else if (end <= start) errors[key] = "End must be after start";
    });

    // Overlap check within the day, comparing each window against the ones
    // before it. Cheap at this size and easier to read than a sort-and-sweep.
    windows.forEach((window, index) => {
      const start = timeToMinutes(window.startTime);
      const end = timeToMinutes(window.endTime);
      if (start === null || end === null) return;

      for (let other = 0; other < index; other += 1) {
        const otherStart = timeToMinutes(windows[other].startTime);
        const otherEnd = timeToMinutes(windows[other].endTime);
        if (otherStart === null || otherEnd === null) continue;

        if (start < otherEnd && otherStart < end) {
          errors[`${day.value}-${index}`] = "This overlaps another window on the same day";
        }
      }
    });
  }

  return errors;
}


export default function WeeklyHoursEditor({ rules, timezone, serviceId, scopeLabel, onSaved }) {
  const toast = useToast();

  const [windowsByDay, setWindowsByDay] = useState(() => groupByWeekday(rules));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  /** Every mutation goes through this, so `dirty` cannot get out of step. */
  const update = (updater) => {
    setWindowsByDay(updater);
    setDirty(true);
  };

  const updateWindow = (weekday, index, field, value) => {
    update((current) => ({
      ...current,
      [weekday]: current[weekday].map((window, i) =>
        i === index ? { ...window, [field]: value } : window
      ),
    }));
  };

  const addWindow = (weekday) => {
    update((current) => {
      const existing = current[weekday] || [];
      
      const last = existing[existing.length - 1];
      const suggestion = last
        ? { startTime: last.endTime === "24:00" ? "18:00" : last.endTime, endTime: "18:00" }
        : DEFAULT_WINDOW;

      return { ...current, [weekday]: [...existing, suggestion] };
    });
  };

  const removeWindow = (weekday, index) => {
    update((current) => ({
      ...current,
      [weekday]: current[weekday].filter((_, i) => i !== index),
    }));
  };

  /**
   * Turns a day on or off.
   *
   * Closing a day previously meant removing each of its windows one at a time
   * with an × per row. Since "closed" is the far more common edit than "remove
   * the second of three windows", it gets a single control.
   */
  const toggleDay = (weekday, open) => {
    update((current) => ({
      ...current,
      [weekday]: open ? [{ ...DEFAULT_WINDOW }] : [],
    }));
  };

  /** Copies Monday's windows to every other weekday — by far the most common shape. */
  const applyMondayToWeekdays = () => {
    const monday = windowsByDay[1] || [];
    if (monday.length === 0) {
      toast.info("Set Monday's hours first, then copy them across.");
      return;
    }

    update((current) => ({
      ...current,
      2: monday.map((w) => ({ ...w })),
      3: monday.map((w) => ({ ...w })),
      4: monday.map((w) => ({ ...w })),
      5: monday.map((w) => ({ ...w })),
    }));
    toast.info("Copied Monday's hours to Tuesday–Friday. Remember to save.");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const found = validateWeek(windowsByDay);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error("Please fix the highlighted times.");
      return;
    }

    setSaving(true);
    try {
      const payload = WEEKDAYS.flatMap((day) =>
        (windowsByDay[day.value] || []).map((window) => ({
          weekday: day.value,
          startTime: window.startTime,
          endTime: window.endTime,
        }))
      );

      const saved = await availabilityApi.saveRules(payload, serviceId);
      onSaved(saved.rules);
      setDirty(false);
      toast.success(serviceId ? `Hours saved for ${scopeLabel}.` : "Weekly hours saved.");
    } catch (err) {
      const parsed = parseApiError(err, "Could not save your hours.");
      toast.error(parsed.message);
    } finally {
      setSaving(false);
    }
  };

  const totalWindows = WEEKDAYS.reduce(
    (sum, day) => sum + (windowsByDay[day.value]?.length || 0),
    0
  );
  const openDays = WEEKDAYS.filter((day) => (windowsByDay[day.value]?.length || 0) > 0).length;

  return (
    <Section
      headingId="weekly-hours-heading"
      title={serviceId ? `Weekly hours — ${scopeLabel}` : "Weekly hours"}
      description={`Repeated every week, in ${zoneName(timezone)}`}
      actions={
        <button
          type="button"
          onClick={applyMondayToWeekdays}
          className={`${ghostButton} ${buttonSm}`}
        >
          <Icon name="refresh" size={13} />
          Copy Mon → Fri
        </button>
      }
      flush
    >
      <form onSubmit={handleSubmit}>
        <ul className="divide-y divide-line-soft">
          {WEEKDAYS.map((day) => {
            const windows = windowsByDay[day.value] || [];
            const open = windows.length > 0;

            return (
              <li
                key={day.value}
                className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3 ${
                  open ? "" : "bg-subtle/60"
                }`}
              >
                
                <label className="flex min-h-9 shrink-0 cursor-pointer items-center gap-2 sm:w-32">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(e) => toggleDay(day.value, e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span
                    className={`text-[0.8125rem] font-medium ${open ? "text-ink" : "text-ink-3"}`}
                  >
                    {day.label}
                  </span>
                </label>

                <div className="min-w-0 flex-1">
                  {!open ? (
                    <p className="flex min-h-9 items-center text-[0.8125rem] text-ink-3">Closed</p>
                  ) : (
                    <div className="space-y-1.5">
                      {windows.map((window, index) => {
                        const error = errors[`${day.value}-${index}`];

                        return (
                          <div key={index}>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="time"
                                value={window.startTime}
                                onChange={(e) =>
                                  updateWindow(day.value, index, "startTime", e.target.value)
                                }
                                aria-label={`${day.label} window ${index + 1} start time`}
                                aria-invalid={Boolean(error)}
                                className={`${inputClasses} w-auto min-w-0 flex-1 sm:max-w-[8rem] sm:flex-none`}
                              />
                              <span aria-hidden="true" className="text-xs text-ink-3">
                                to
                              </span>
                              <input
                                type="time"
                                value={window.endTime}
                                onChange={(e) =>
                                  updateWindow(day.value, index, "endTime", e.target.value)
                                }
                                aria-label={`${day.label} window ${index + 1} end time`}
                                aria-invalid={Boolean(error)}
                                className={`${inputClasses} w-auto min-w-0 flex-1 sm:max-w-[8rem] sm:flex-none`}
                              />

                              
                              {windows.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeWindow(day.value, index)}
                                  aria-label={`Remove ${day.label} window ${index + 1}`}
                                  className={`${iconButton} hover:bg-danger-soft hover:text-danger-ink`}
                                >
                                  <Icon name="close" size={15} />
                                </button>
                              )}

                              {index === windows.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() => addWindow(day.value)}
                                  aria-label={`Add another window on ${day.label}`}
                                  title="Add another window"
                                  className={iconButton}
                                >
                                  <Icon name="plus" size={15} />
                                </button>
                              )}
                            </div>

                            {error && (
                              <p className="mt-1 flex items-start gap-1 text-xs text-danger">
                                <Icon name="alert" size={13} className="mt-px" />
                                <span>{error}</span>
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        
        <div
          className={`sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2.5 ${
            dirty ? "border-brand-line bg-brand-soft" : "border-line bg-subtle"
          }`}
        >
          <p className="text-xs text-ink-2">
            {totalWindows === 0 ? (
              <span className="flex items-center gap-1.5 text-warn-ink">
                <Icon name="alert" size={13} />
                No hours set — clients cannot book anything yet.
              </span>
            ) : (
              `${openDays} day${openDays === 1 ? "" : "s"} open · ${totalWindows} window${
                totalWindows === 1 ? "" : "s"
              }`
            )}
          </p>

          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs font-medium text-brand-ink">Unsaved changes</span>}
            <button
              type="submit"
              disabled={saving || !dirty}
              className={dirty ? `${primaryButton} ${buttonSm}` : `${secondaryButton} ${buttonSm}`}
            >
              {saving ? "Saving…" : "Save hours"}
            </button>
          </div>
        </div>
      </form>
    </Section>
  );
}

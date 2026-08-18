/**
 * The weekly recurring-hours grid.
 *
 * Edits the whole week as one form and saves it in one request,
 */
import { useEffect, useState } from "react";
import { parseApiError } from "../../api/client";
import * as availabilityApi from "../../api/availability";
import { useToast } from "../../context/ToastContext";
import Icon from "../ui/Icon";
import { Toggle } from "../ui/Field";
import { timeToMinutes } from "../../lib/time";
import { primaryButton, secondaryButton, buttonSm } from "../../lib/ui";

/**
 * A time field in a day row.
 *
 * Transparent rather than filled, because the reference draws these against the
 * card rather than as raised controls. `text-base` on a phone is the iOS
 * auto-zoom threshold — below it, tapping a time field zooms the page in and
 * does not zoom back out.
 */
const timeInputClasses =
  "min-w-0 flex-1 rounded-md border border-outline-variant bg-transparent px-3 py-2 " +
  "font-small text-base outline-none transition-colors focus:border-primary " +
  "focus:ring-1 focus:ring-primary aria-[invalid=true]:border-error sm:text-small";

/**
 * Warns that a service's settings cannot produce a single bookable time.
 *
 * Everything shown here comes from the server's own slot arithmetic (see
 * `useSlotFeasibility`), and everything is phrased in the provider's terms:
 * their hours, their service, their buffers. The engine's internals — the
 * candidate grid, the legal band, how the two interact — are what *cause* the
 * problem, but knowing about them is not what fixes it, so none of that appears.
 * What appears is which day is affected, why it is too tight, and what to change.
 *
 * The remedies arrive already ordered and already verified by the server; the
 * first is the recommendation and the rest are alternatives. Nothing here
 * changes a setting on the provider's behalf — each remedy is a sentence, not a
 * button, because silently rewriting a duration or a buffer to clear a warning
 * would be a worse surprise than the warning itself.
 */
function NoSlotsWarning({ report }) {
  const [recommended, ...alternatives] = report.remedies;
  const { duration, bufferBefore, bufferAfter } = report.config;

  return (
    <div className="border-b border-warn-line bg-warn-soft px-6 py-4 text-warn-ink">
      <div className="flex items-start gap-2.5">
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-semibold">
            No appointment times can be offered for {report.serviceName}.
          </p>

          <p className="mt-1 text-xs leading-relaxed">
            {report.problemDays.map((day) => (
              <span key={day.weekday}>
                Your {day.weekdayName} hours are{" "}
                <span className="font-medium">
                  {day.windows[0].startTime}–{day.windows[0].endTime}
                </span>
                , which is not quite long enough for this service once its buffer time is
                included.{" "}
              </span>
            ))}
          </p>

          {recommended && (
            <p className="mt-2 text-xs leading-relaxed">
              <span className="font-semibold">Recommended:</span> {recommended.summary}
            </p>
          )}

          {alternatives.length > 0 && (
            <>
              <p className="mt-2 text-xs font-medium">Or, if you would rather:</p>
              <ul className="mt-1 space-y-0.5 text-xs leading-relaxed">
                {alternatives.map((remedy) => (
                  <li key={remedy.kind} className="flex gap-1.5">
                    <span aria-hidden="true">·</span>
                    <span>{remedy.summary}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* The numbers behind the warning, stated plainly. A provider who
              disagrees with the conclusion can at least see what it was based
              on without having to guess which setting is which. */}
          <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-warn-line pt-2 text-xs">
            <div className="flex gap-1.5">
              <dt className="opacity-70">Service:</dt>
              <dd className="font-medium">{duration} min</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="opacity-70">Buffers:</dt>
              <dd className="font-medium">
                {bufferBefore} min before + {bufferAfter} min after
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="opacity-70">Slot interval:</dt>
              <dd className="font-medium">{report.config.slotInterval} min</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

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


/**
 * Flattens the per-day buckets back into the flat list the API takes.
 *
 * Shared by the save request and the feasibility check so the configuration the
 * provider is warned about is byte-for-byte the one they would be saving.
 */
function toRulePayload(windowsByDay) {
  return WEEKDAYS.flatMap((day) =>
    (windowsByDay[day.value] || []).map((window) => ({
      weekday: day.value,
      startTime: window.startTime,
      endTime: window.endTime,
    }))
  );
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


/**
 * Asks the server, as the grid is edited, whether these hours would actually
 * give clients anything to book.
 *
 * The check is a request rather than a calculation here on purpose. Whether a
 * window yields a slot depends on where the engine anchors its candidate grid
 * and how the two buffers narrow the legal band around it — reimplementing that
 * in the browser would create a second answer that could disagree with the one
 * clients actually experience. See `POST /api/availability/validate`.
 *
 * Debounced because the trigger is typing in a time input: a provider dragging
 * an `<input type="time">` spinner emits a change per minute, and each of those
 * is not a question worth asking. Aborting the previous request rather than
 * letting it resolve keeps a slow earlier answer from overwriting a fast later
 * one — the same reason `useApiResource` does it.
 *
 * @param {object} windowsByDay The draft grid.
 * @param {number|null} serviceId Scope being edited.
 * @param {object} localErrors Client-side field errors; a malformed draft is not
 *   worth sending, and warning about slot yield while a time is half-typed
 *   would flash nonsense.
 * @returns {{status:"idle"|"checking"|"ready", services:Array}}
 */
function useSlotFeasibility(windowsByDay, serviceId, localErrors) {
  const [state, setState] = useState({ status: "idle", services: [] });

  // Depending on the serialised payload rather than on `windowsByDay` means a
  // re-render that does not actually change the hours — a toggle elsewhere on
  // the page, a parent state update — does not fire another request. The effect
  // parses it back rather than closing over the array, so the dependency stays
  // a primitive and cannot go stale.
  const payloadKey = JSON.stringify(toRulePayload(windowsByDay));
  const hasLocalErrors = Object.keys(localErrors).length > 0;

  useEffect(() => {
    if (hasLocalErrors) {
      setState({ status: "idle", services: [] });
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, status: "checking" }));

      availabilityApi
        .validateRules(JSON.parse(payloadKey), serviceId, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setState({
            status: "ready",
            // `problemDays` is what makes this a *configuration* warning: a week
            // with no hours at all is also unbookable, but that is not a
            // misconfiguration and the footer already says so. Only days that
            // have hours yet still yield nothing belong here.
            services: result.checked
              ? result.services.filter((s) => !s.bookable && s.problemDays.length > 0)
              : [],
          });
        })
        .catch(() => {
          // A failed check is not a failed save and must not look like one. The
          // warning is an aid, so it simply does not appear — the provider is
          // never blocked by it, and the save endpoint validates independently.
          if (!controller.signal.aborted) setState({ status: "idle", services: [] });
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [payloadKey, serviceId, hasLocalErrors]);

  return state;
}

/**
 * The zone every time on this card is written in is stated once, by the
 * Timezone card at the top of the page, rather than repeated per editor.
 */
export default function WeeklyHoursEditor({ rules, serviceId, scopeLabel, onSaved }) {
  const toast = useToast();

  const [windowsByDay, setWindowsByDay] = useState(() => groupByWeekday(rules));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Re-seed the grid whenever the parent hands over a different rule set.
  //
  // This is load-bearing, not a tidy-up. Switching scope tabs remounts this
  // editor immediately — but the fetch for the newly selected scope is still in
  // flight, so the parent is still holding the *previous* scope's rules and
  // that is what the `useState` initialiser above latches. A `useState`
  // initialiser never runs again, so when the correct rules arrived a moment
  // later the grid kept showing the old ones. Switching to a service, then back
  // to Default, left the service's hours displayed under "Default hours" — and
  // saving from there wrote them over the provider's real default.
  //
  // Comparing the prop against the value last synced from is React's documented
  // way to adjust state during render; it re-runs immediately, before anything
  // paints, so the stale grid is never shown. Identity is the right test because
  // the parent only produces a new array on a fetch or a save, never on an
  // unrelated re-render, so a provider's in-progress edits are not disturbed.
  const [syncedRules, setSyncedRules] = useState(rules);
  if (rules !== syncedRules) {
    setSyncedRules(rules);
    setWindowsByDay(groupByWeekday(rules));
    setErrors({});
    setDirty(false);
  }

  const feasibility = useSlotFeasibility(windowsByDay, serviceId, errors);

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

    // The button is disabled while a save is in flight, but a second submit can
    // still arrive from an Enter keypress in one of the time inputs. Guarding on
    // the state as well is what actually makes duplicate submission impossible,
    // and this endpoint replaces the whole week — running it twice concurrently
    // is worth ruling out.
    if (saving) return;

    const found = validateWeek(windowsByDay);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error("Please fix the highlighted times.");
      return;
    }

    setSaving(true);

    // Only the request itself is guarded by the catch. Everything after it —
    // patching the page's state, clearing `dirty`, the toast — runs outside,
    // because those steps cannot fail *the save*. Folding them in is what made a
    // committed write report itself as "Cannot reach the server": a throw from
    // the parent's onSaved callback landed in this catch and was parsed as a
    // network error. A save either reached the server or it did not, and only
    // the request can answer that.
    let saved;
    try {
      saved = await availabilityApi.saveRules(toRulePayload(windowsByDay), serviceId);
    } catch (err) {
      setSaving(false);
      toast.error(parseApiError(err, "Unable to update availability. Please try again.").message);
      return;
    }

    setSaving(false);
    setDirty(false);
    setWindowsByDay(groupByWeekday(saved.rules));
    onSaved(saved.rules);

    if (saved.inheritsDefault) {
      // Clearing every day on a service is not an empty schedule, it is a
      // request to stop overriding — say which one happened, because the two
      // look identical on screen.
      toast.success(`${scopeLabel} now follows your default hours.`);
    } else {
      toast.success(
        serviceId ? `Availability updated for ${scopeLabel}.` : "Availability updated successfully."
      );
    }
  };

  const totalWindows = WEEKDAYS.reduce(
    (sum, day) => sum + (windowsByDay[day.value]?.length || 0),
    0
  );
  const openDays = WEEKDAYS.filter((day) => (windowsByDay[day.value]?.length || 0) > 0).length;

  return (
    <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <div className="flex items-center justify-between gap-4 border-b border-outline-variant bg-surface/50 p-6">
        <h2 className="font-h3 text-[18px] font-semibold text-primary">
          {serviceId ? `Weekly Hours — ${scopeLabel}` : "Weekly Hours"}
        </h2>
        <button
          type="button"
          onClick={applyMondayToWeekdays}
          className="flex cursor-pointer items-center gap-1 font-small text-small text-on-surface-variant transition-colors hover:text-primary"
        >
          <Icon name="content_copy" size={16} />
          Copy to all
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {feasibility.services.map((service) => (
          <NoSlotsWarning key={service.serviceId} report={service} />
        ))}

        <ul className="divide-y divide-outline-variant/50">
          {WEEKDAYS.map((day) => {
            const windows = windowsByDay[day.value] || [];
            const open = windows.length > 0;

            return (
              <li
                key={day.value}
                className={`group grid grid-cols-[100px_1fr] gap-4 p-6 md:grid-cols-[120px_1fr] ${
                  open
                    ? "items-start"
                    : "items-center opacity-60 transition-opacity hover:opacity-100"
                }`}
              >
                <div className={`flex items-center gap-3 ${open ? "pt-2" : ""}`}>
                  <Toggle
                    checked={open}
                    onChange={(next) => toggleDay(day.value, next)}
                    label={`${day.label} available`}
                  />
                  <span
                    className={`font-small text-small uppercase ${
                      open ? "font-semibold text-primary" : "text-on-surface-variant"
                    }`}
                  >
                    {day.short}
                  </span>
                </div>

                {!open ? (
                  <p className="py-2 font-small text-small italic text-on-surface-variant">
                    Unavailable
                  </p>
                ) : (
                  <div className="w-full space-y-3">
                    {windows.map((window, index) => {
                      const error = errors[`${day.value}-${index}`];

                      return (
                        <div key={index}>
                          <div className="flex w-full items-center gap-3">
                            <input
                              type="time"
                              value={window.startTime}
                              onChange={(e) =>
                                updateWindow(day.value, index, "startTime", e.target.value)
                              }
                              aria-label={`${day.label} window ${index + 1} start time`}
                              aria-invalid={Boolean(error)}
                              className={timeInputClasses}
                            />
                            <span aria-hidden="true" className="text-on-surface-variant">
                              -
                            </span>
                            <input
                              type="time"
                              value={window.endTime}
                              onChange={(e) =>
                                updateWindow(day.value, index, "endTime", e.target.value)
                              }
                              aria-label={`${day.label} window ${index + 1} end time`}
                              aria-invalid={Boolean(error)}
                              className={timeInputClasses}
                            />

                            {/* Revealed on hover at desktop widths, always present
                                on touch — where there is no hover, and a control
                                that only appears on one is unreachable. */}
                            {windows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeWindow(day.value, index)}
                                aria-label={`Remove ${day.label} window ${index + 1}`}
                                className="cursor-pointer rounded-md p-2 text-on-surface-variant transition-colors hover:bg-error-container/50 hover:text-error focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                              >
                                <Icon name="delete" size={20} />
                              </button>
                            )}
                          </div>

                          {error && (
                            <p className="mt-1.5 flex items-start gap-1.5 font-caption text-caption text-error">
                              <Icon name="warning" size={14} className="mt-px" />
                              <span>{error}</span>
                            </p>
                          )}
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => addWindow(day.value)}
                      className="flex cursor-pointer items-center gap-1 py-1 font-small text-small text-on-surface-variant transition-colors hover:text-primary"
                    >
                      <Icon name="add" size={16} />
                      Add range
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* The reference floats this bar over the whole page. Here it sticks to
            the foot of the card it belongs to, because the page also carries an
            exceptions editor with a save of its own, and two floating bars
            claiming the same strip is one too many. */}
        <div
          className={`sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t p-4 backdrop-blur-md ${
            dirty ? "border-primary/20 bg-primary/5" : "border-outline-variant bg-surface/90"
          }`}
        >
          <p className="font-small text-small text-on-surface-variant">
            {totalWindows === 0 ? (
              <span className="flex items-center gap-1.5 text-error">
                <Icon name="warning" size={16} />
                No hours set — clients cannot book anything yet.
              </span>
            ) : dirty ? (
              "Unsaved changes"
            ) : (
              `${openDays} day${openDays === 1 ? "" : "s"} open · ${totalWindows} window${
                totalWindows === 1 ? "" : "s"
              }`
            )}
          </p>

          <button
            type="submit"
            disabled={saving || !dirty}
            className={dirty ? `${primaryButton} ${buttonSm}` : `${secondaryButton} ${buttonSm}`}
          >
            {saving ? "Saving…" : "Save hours"}
          </button>
        </div>
      </form>
    </div>
  );
}

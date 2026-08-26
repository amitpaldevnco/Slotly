/**
 * The weekly recurring-hours grid.
 *
 * Edits the whole week as one form and saves it in one request.
 *
 * ## Validation happens as you type, not when you save
 *
 * `validateWeek` is derived from the draft rather than run once inside the
 * submit handler, so a window that ends before it begins is flagged on the edit
 * that breaks it and un-flagged on the edit that fixes it. The one exception is a
 * time left empty: those messages wait for the first Save, because an empty field
 * is already visibly empty and saying so on the keystroke that emptied it is
 * noise. See `visibleErrors`.
 */
import { useEffect, useMemo, useState } from "react";
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

/**
 * Every problem with the week, keyed by `weekday-index`.
 *
 * Each entry is `{ message, incomplete }`. `incomplete` marks the ones caused by
 * a time that is missing rather than wrong, which is what lets the editor show
 * the rest of them *while the provider types* and hold these back until they
 * press Save — see `visibleErrors`. A half-filled `<input type="time">` reports
 * its value as `""`, so without that distinction clearing an hour to retype it
 * flashes "Start time must be HH:MM" on every keystroke.
 *
 * First error per window wins. It used to be last: the overlap pass ran second
 * and overwrote whatever the first had found, so a window running 5pm–9am was
 * reported as overlapping its neighbour rather than as ending before it began —
 * the wrong problem, and the one the provider could do nothing about until they
 * had fixed the real one.
 */
function validateWeek(windowsByDay) {
  const errors = {};
  const flag = (key, message, incomplete = false) => {
    if (!errors[key]) errors[key] = { message, incomplete };
  };

  for (const day of WEEKDAYS) {
    const windows = windowsByDay[day.value] || [];

    windows.forEach((window, index) => {
      const start = timeToMinutes(window.startTime);
      const end = timeToMinutes(window.endTime);
      const key = `${day.value}-${index}`;

      if (start === null) flag(key, "Enter a start time", true);
      else if (end === null) flag(key, "Enter an end time", true);
      // Stated with both times in it. "End must be after start" describes the
      // rule; naming the two values the provider actually typed is what shows
      // them they have put an evening start against a morning end.
      else if (end === start) {
        flag(key, `Start and end are both ${window.startTime} — this window is zero minutes long`);
      } else if (end < start) {
        flag(key, `Ends before it starts: ${window.startTime} to ${window.endTime}`);
      }
    });

    // Overlap check within the day, comparing each window against the ones
    // before it. Cheap at this size and easier to read than a sort-and-sweep.
    windows.forEach((window, index) => {
      const start = timeToMinutes(window.startTime);
      const end = timeToMinutes(window.endTime);
      if (start === null || end === null || end <= start) return;

      for (let other = 0; other < index; other += 1) {
        const otherStart = timeToMinutes(windows[other].startTime);
        const otherEnd = timeToMinutes(windows[other].endTime);
        if (otherStart === null || otherEnd === null || otherEnd <= otherStart) continue;

        if (start < otherEnd && otherStart < end) {
          flag(
            `${day.value}-${index}`,
            `Overlaps ${windows[other].startTime}–${windows[other].endTime} on the same day`
          );
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
export default function WeeklyHoursEditor({
  rules,
  serviceId,
  scopeLabel,
  onSaved,
  // Present only when this scope is a service that currently overrides the
  // default hours. The page owns the reset itself — it is the thing holding the
  // service list and the confirmation — so this is only the trigger.
  canResetToDefault = false,
  onResetToDefault,
  resetting = false,
}) {
  const toast = useToast();

  const [windowsByDay, setWindowsByDay] = useState(() => groupByWeekday(rules));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Whether Save has been pressed on the current draft. The only thing it
  // changes is whether the "enter a time" errors are shown; see `visibleErrors`.
  const [submitAttempted, setSubmitAttempted] = useState(false);

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
    setDirty(false);
    setSubmitAttempted(false);
  }

  /**
   * The whole week's problems, re-derived on every edit.
   *
   * This was state, written only inside `handleSubmit` — so the form validated
   * once, when the provider pressed Save, and then kept showing that verdict.
   * Two consequences, both of which the "no clear validation" report is about:
   * an end time before its start looked perfectly acceptable until a save was
   * refused, and once the message appeared, correcting the time did not remove
   * it. Deriving instead means the error arrives on the edit that causes it and
   * leaves on the edit that fixes it.
   */
  const errors = useMemo(() => validateWeek(windowsByDay), [windowsByDay]);

  /**
   * The subset worth showing right now, as plain strings.
   *
   * A missing time is held back until Save, because an empty field is already
   * visibly empty — announcing it on the keystroke that emptied it tells the
   * provider something they can see, at the moment it is least useful. An end
   * before its start is the opposite: two filled-in, plausible-looking fields
   * that together describe no time at all, and nothing but a message says so.
   */
  const visibleErrors = useMemo(() => {
    const shown = {};
    for (const [key, error] of Object.entries(errors)) {
      if (!error.incomplete || submitAttempted) shown[key] = error.message;
    }
    return shown;
  }, [errors, submitAttempted]);

  const errorCount = Object.keys(errors).length;
  const visibleErrorCount = Object.keys(visibleErrors).length;

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

  // "Copy to all" used to sit in the header here. It copied *Monday's* windows
  // to *Tuesday through Friday* — so of the three words in its label, "all" was
  // wrong (the weekend was untouched) and neither the source nor the range was
  // named anywhere on the control. A provider could only find out what it did by
  // pressing it and reading the toast afterwards, on a control that had already
  // overwritten four days of their schedule. Removed rather than relabelled:
  // "Copy Monday to Tuesday–Friday" is an honest label for a button nobody would
  // reach for twice, and setting four days by hand is a handful of clicks.

  const handleSubmit = async (event) => {
    event.preventDefault();

    // The button is disabled while a save is in flight, but a second submit can
    // still arrive from an Enter keypress in one of the time inputs. Guarding on
    // the state as well is what actually makes duplicate submission impossible,
    // and this endpoint replaces the whole week — running it twice concurrently
    // is worth ruling out.
    if (saving) return;

    // Reveals the "enter a time" errors that are held back until now, and the
    // errors themselves are already derived — there is nothing to compute here.
    setSubmitAttempted(true);
    if (errorCount > 0) {
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
    setSubmitAttempted(false);
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

        {/* The way back to the default hours, in the header of the card that
            holds the custom ones.

            A reset did already exist — as the action slot of the notice above
            this card, which is not where anyone looks for it. A provider who has
            just spent a minute editing this grid looks for the undo *in the
            grid*, next to Save hours, and there was nothing there. Moving it
            rather than adding a second one: two buttons doing the same
            destructive thing on one screen is worse than one in the wrong place.

            Only for a service that is actually overriding the default. On the
            Default tab there is nothing to fall back to, and on a service that
            already inherits there is nothing to undo. */}
        {canResetToDefault && (
          <button
            type="button"
            onClick={onResetToDefault}
            disabled={resetting}
            className="-mx-2 flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 font-small text-small text-on-surface-variant transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="refresh" size={16} />
            {resetting ? "Resetting…" : "Reset to default hours"}
          </button>
        )}
      </div>

      {/* `noValidate`: the editor reports "End must be after start" and
          "This overlaps another window" itself, and a native bubble arriving
          first would suppress those and say something vaguer. */}
      <form onSubmit={handleSubmit} noValidate>
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
                // Single column on a phone, two from `sm` up.
                //
                // The two-column form reserved 100px for the day toggle and left
                // the ranges 178px on a 375px screen — not enough for two native
                // time inputs, which Chrome will not render below ~90px each.
                // The row could not shrink to fit and simply overflowed the card
                // by 24px, cutting the delete button off. Stacking gives the
                // ranges the full width instead of a third of it.
                className={`group grid grid-cols-1 gap-3 p-4 sm:grid-cols-[100px_1fr] sm:gap-4 sm:p-6 md:grid-cols-[120px_1fr] ${
                  open
                    ? "sm:items-start"
                    : "opacity-60 transition-opacity hover:opacity-100 sm:items-center"
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
                  // `min-w-0` because a grid item defaults to `min-width: auto`,
                  // which is its *min-content* width — so without this the time
                  // inputs refuse to shrink and push the row past the column
                  // instead of fitting inside it.
                  <div className="w-full min-w-0 space-y-3">
                    {windows.map((window, index) => {
                      const error = visibleErrors[`${day.value}-${index}`];

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

                            {/* The slot is always this wide, whether or not it
                                holds a button.
                                
                                Only a day with two or more windows can have one
                                removed, so on every other row the button was
                                simply absent — and its width came off the time
                                fields instead. The result was that Wednesday's
                                inputs were narrower than Monday's, and the
                                column of end times down the week did not line
                                up. Reserving the space keeps one grid.

                                The button itself is revealed on hover at desktop
                                widths and always present on touch, where there
                                is no hover and a control that needs one is
                                unreachable. */}
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center">
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
                            </span>
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
                      className="-mx-2 flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-2 font-small text-small text-on-surface-variant transition-colors hover:text-primary"
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
          {/* A bad time is now reported here as well as on the row itself.
              The row's message says what is wrong with that window; this says
              how many windows are wrong, next to the button being pressed —
              which is what a provider with a broken Thursday scrolled past
              needs, and what "Unsaved changes" was saying instead. */}
          <p className="font-small text-small text-on-surface-variant">
            {visibleErrorCount > 0 ? (
              <span className="flex items-center gap-1.5 text-error">
                <Icon name="warning" size={16} />
                {visibleErrorCount === 1
                  ? "1 time range needs fixing"
                  : `${visibleErrorCount} time ranges need fixing`}
              </span>
            ) : totalWindows === 0 ? (
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

/**
 * "With your current hours, these settings offer N appointments a week."
 *
 * ## Why this panel exists
 *
 * Duration, the two buffers and the slot spacing interact in a way nobody works
 * out in their head, and until now a provider only discovered the result by
 * saving and going to look at their own booking page. The engine's own
 * documented example: a 09:00–10:00 window with a 30-minute service, 10-minute
 * buffers and a 30-minute grid yields **nothing** — the legal band of starts is
 * 09:10–09:20, the grid offers 09:00 and 09:30, and the two never meet. Removing
 * one of the buffers makes the same window yield a slot.
 *
 * So the numbers are shown while they are being typed, against the hours the
 * provider has actually saved.
 *
 * ## Where the number comes from
 *
 * The server, via `POST /availability/preview`, not from arithmetic here. The
 * answer depends on how the slot engine anchors its candidate grid, and a
 * second implementation in the browser would be a second thing to keep in step
 * with the engine — the exact drift this app avoids everywhere else. The
 * endpoint walks the same `candidateStartsInWindow()` the real slot list walks,
 * so the count previewed is the count that will be offered.
 *
 * ## What it deliberately does not count
 *
 * Existing bookings, one-off blocks and the minimum-notice rule. None of those
 * can be changed from this form, and a day that is empty only because it is
 * fully booked is not a misconfiguration to warn someone about. This is the
 * recurring weekly shape.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as availabilityApi from "../../api/availability";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import Icon from "../ui/Icon";
import { SkeletonBlock } from "../ui/Feedback";

/** Long enough that typing "90" does not fire a request for "9". */
const PREVIEW_DEBOUNCE_MS = 400;

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * @param {object} props
 * @param {{duration: string, bufferBefore: string, bufferAfter: string, slotInterval: string}} props.fields
 *   The form's raw values, still strings as they come off the inputs.
 * @param {number} [props.serviceId] The service being edited, so one with its
 *   own hours is judged against those. Omitted when creating.
 */
export default function SlotYieldPreview({ fields, serviceId }) {
  // Debounced as one object: the four values change together while someone
  // tabs through the row, and four separate debounces would fire four requests.
  const draft = useDebouncedValue(
    JSON.stringify({
      duration: Number.parseInt(fields.duration, 10),
      bufferBefore: Number.parseInt(fields.bufferBefore, 10) || 0,
      bufferAfter: Number.parseInt(fields.bufferAfter, 10) || 0,
      slotInterval: Number.parseInt(fields.slotInterval, 10) || 30,
    }),
    PREVIEW_DEBOUNCE_MS
  );

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const parsed = JSON.parse(draft);

    // Nothing to preview until there is a duration. An empty field is a form
    // half-filled, not a configuration worth warning about.
    if (!Number.isInteger(parsed.duration) || parsed.duration <= 0) {
      setPreview(null);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);

    availabilityApi
      .previewSlots({ ...parsed, ...(serviceId ? { serviceId } : {}) }, { signal: controller.signal })
      .then(setPreview)
      // Silent on failure. This panel is an aid, not part of saving — a provider
      // must never be blocked from creating a service because a preview could
      // not load.
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [draft, serviceId]);

  if (!preview && !loading) return null;

  if (loading && !preview) {
    return (
      <div className="rounded-md border border-outline-variant bg-surface-container-lowest p-4">
        <SkeletonBlock className="h-4 w-48" />
      </div>
    );
  }

  // No hours at all is a different problem with a different fix — go and set
  // them — so it must not be worded as "these settings do not work".
  if (!preview.hasRules) {
    return (
      <div className="rounded-md border border-warn-line bg-warn-soft p-4">
        <p className="flex items-start gap-2 font-caption text-caption text-warn-ink">
          <Icon name="info" size={16} className="mt-px shrink-0" />
          <span>
            You have not set any working hours yet, so this service cannot be booked whatever its
            settings.{" "}
            <Link to="/availability" className="font-semibold underline underline-offset-2">
              Set your hours
            </Link>
          </span>
        </p>
      </div>
    );
  }

  const tone = preview.bookable
    ? "border-success-line bg-success-soft text-success-ink"
    : "border-warn-line bg-warn-soft text-warn-ink";

  return (
    <div className={`rounded-md border p-4 ${tone}`} aria-live="polite">
      <p className="flex items-start gap-2 font-small text-small font-semibold">
        <Icon name={preview.bookable ? "event_available" : "warning"} size={16} className="mt-px shrink-0" />
        {preview.bookable ? (
          <span>
            {preview.totalSlotsPerWeek} appointment
            {preview.totalSlotsPerWeek === 1 ? "" : "s"} a week with your current hours
          </span>
        ) : (
          <span>Your hours cannot fit this service — no times would be offered</span>
        )}
      </p>

      {/* The per-day grid, which is what turns a total into something a provider
          can act on: it shows *which* day is the problem. */}
      {preview.days.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {preview.days.map((day) => (
            <li
              key={day.weekday}
              title={`${day.weekdayName}: ${day.slotCount} slot${day.slotCount === 1 ? "" : "s"}`}
              className={`flex min-w-11 flex-col items-center rounded-md border px-2 py-1 ${
                day.slotCount === 0
                  ? "border-danger-line bg-danger-soft text-danger-ink"
                  : "border-outline-variant bg-surface text-on-surface"
              }`}
            >
              <span className="font-caption text-[10px] uppercase opacity-70">
                {WEEKDAY_INITIALS[day.weekday]}
              </span>
              <span className="font-small text-small font-bold tabular-nums">{day.slotCount}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Only verified suggestions reach here — the server checks each one
          against the same arithmetic before offering it, so the form never says
          "try a shorter buffer" when a shorter buffer would not help. */}
      {preview.remedies.length > 0 && (
        <p className="mt-3 font-caption text-caption">
          <span className="font-semibold">Try this: </span>
          {preview.remedies[0].summary}
        </p>
      )}

      {preview.bookable && preview.problemDays.length > 0 && (
        <p className="mt-2 font-caption text-caption">
          {preview.problemDays.map((day) => day.weekdayName).join(", ")} would offer nothing.
        </p>
      )}
    </div>
  );
}

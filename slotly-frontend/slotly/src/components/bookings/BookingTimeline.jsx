// The status history of one booking, rendered as a vertical timeline.

import { useState } from "react";
import Icon from "../ui/Icon";
import { Section } from "../ui/Page";
import { formatDateTime, relativeTime, zoneLabel } from "../../lib/time";
import { statusStyle, ghostButton, buttonSm } from "../../lib/ui";

function describeEvent(event) {
  const actor = event.actor?.name || (event.actor?.role === "system" ? "Slotly" : "Someone");
  const role =
    event.actor?.role === "provider" ? "provider" : event.actor?.role === "client" ? "client" : null;
  const who = role ? `${actor} (${role})` : actor;

  switch (event.toStatus) {
    case "booked":
      return `${who} booked this appointment`;
    case "rescheduled":
      return `${who} moved this appointment`;
    case "cancelled":
      return `${who} cancelled this appointment`;
    case "completed":
      return `${who} marked it completed`;
    case "no_show":
      return `${who} marked it a no-show`;
    default:
      return `${who} changed the status to ${event.toStatus}`;
  }
}

export default function BookingTimeline({ timeline, viewerZone, venue }) {
  const [open, setOpen] = useState(false);

  if (!timeline?.length) return null;

  // Newest last in the data, so the most recent event is the tail. That is the
  // one worth showing while collapsed.
  const latest = timeline[timeline.length - 1];
  const hidden = timeline.length - 1;

  return (
    <Section
      headingId="history-heading"
      title="History"
      description={`${timeline.length} change${timeline.length === 1 ? "" : "s"}`}
      actions={
        hidden > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={`${ghostButton} ${buttonSm}`}
          >
            {open ? "Hide" : `Show all ${timeline.length}`}
            <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
          </button>
        )
      }
      flush
    >
      <ol className="px-5 py-4">
        {(open ? timeline : [latest]).map((event, index, shown) => (
          <Entry
            key={event.id}
            event={event}
            viewerZone={viewerZone}
            venue={venue}
            isLast={index === shown.length - 1}
          />
        ))}
      </ol>
    </Section>
  );
}

function Entry({ event, viewerZone, venue, isLast }) {
  const style = statusStyle(event.toStatus);

  return (
    <li className="relative flex gap-2.5 pb-4 last:pb-0">
      {/* The connecting line, drawn behind the dots and stopped short on the
          final entry so the timeline does not trail into nothing. */}
      {!isLast && (
        <span aria-hidden="true" className="absolute left-[3.5px] top-3 h-full w-px bg-line" />
      )}

      <span
        aria-hidden="true"
        className={`relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
      />

      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] leading-snug text-ink">{describeEvent(event)}</p>

        <p className="mt-0.5 text-xs text-ink-3">
          {formatDateTime(event.at, viewerZone)} {zoneLabel(event.at, viewerZone)} ·{" "}
          {relativeTime(event.at)}
        </p>

        {/* A reschedule is the one event where the times themselves are the
            story, so both are printed rather than just the label. */}
        {event.toStatus === "rescheduled" && event.fromStartsAt && event.toStartsAt && (
          <p className="mt-1 text-xs text-ink-2">
            <span className="line-through decoration-line">
              {formatDateTime(event.fromStartsAt, viewerZone)}
            </span>{" "}
            → <span className="font-medium text-ink">{formatDateTime(event.toStartsAt, viewerZone)}</span>
          </p>
        )}

        {/* Where the appointment happens, on the entry that moved it.
            
            A move replaces the one detail the reader had memorised, so the
            record of it is the place a self-contained answer is worth repeating:
            the new time is directly above, and this is the other half of "so
            where and when am I going?".

            Only on a reschedule, and only ever the *current* venue — which is
            not a historic claim, because moving an appointment does not move it:
            the service and the provider are unchanged, so the venue on the
            booking now is the venue this move led to. Rendered from the booking
            rather than stored on the event for exactly that reason, and so that
            a provider who later corrects their address does not leave a stale
            one printed in the history.

            Deliberately not folded into `event.reason`: that field holds the
            words the other party wrote, and appending a venue to "Can't make
            Tuesday" would put our sentence inside their quotation. */}
        {event.toStatus === "rescheduled" && venue?.text && (
          <p className="mt-1 flex items-start gap-1 text-xs text-ink-3">
            <Icon
              name={venue.isVirtual ? "videocam" : "place"}
              size={13}
              className="mt-0.5 shrink-0"
            />
            {/* The link on its own line rather than trailing the sentence: a
                margin gives sighted readers the gap, but anything reading the
                text content runs "…the provider" straight into "https://…". */}
            <span>
              <span className="whitespace-pre-line">{`${venue.term}: ${venue.text}`}</span>
              {venue.meetingLink && (
                <a
                  href={venue.meetingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 block break-all text-primary underline decoration-line-strong underline-offset-2 hover:text-ink"
                >
                  {venue.meetingLink}
                </a>
              )}
            </span>
          </p>
        )}

        {event.reason && (
          <p className="mt-1.5 rounded-md bg-subtle px-2.5 py-1.5 text-xs leading-relaxed text-ink-2">
            {event.reason}
          </p>
        )}
      </div>
    </li>
  );
}

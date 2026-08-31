/**
 * The wording of the messages Slotly shows after a booking changes.
 *
 * ## Why these are toasts and not "notifications"
 *
 * Slotly has no notifications table, no push endpoint and no outbound email —
 * stated plainly in `context/NotificationsContext`, and repeated to the user in
 * Settings ("nothing is sent by email or push"). The bell is a *derived* list of
 * things needing attention (unread messages, broken availability, appointments
 * awaiting an outcome), not a log of events.
 *
 * So the places a person is actually told "your appointment has moved" are the
 * toast raised at the moment it happens and the History timeline on the booking
 * itself. Both are enriched here rather than a delivery channel being invented,
 * because inventing one would mean claiming to send something that never leaves
 * the browser.
 *
 * ## Why the wording lives in one file
 *
 * Four call sites raise these — the booking page, the cancel dialog, the
 * reschedule dialog, and the provider's outcome buttons — and every one of them
 * has to answer "which appointment?" and "where is it?" the same way. That is
 * the same argument the delivery labels in `lib/serviceScope` are centralised
 * under, and it applies harder here: a client who is told a different venue by
 * the confirmation than by the appointment page has been given contradictory
 * instructions about where to go.
 */

import { DateTime } from "luxon";
import { describeLocation } from "./serviceScope";

/**
 * "Thu 3 Sep at 5:00 AM" — the appointment's moment, in the reader's own zone.
 *
 * Deliberately not `relativeTime`: "in 3 days" is useless in a message someone
 * may act on tomorrow, and the whole point of these lines is that they restate
 * the facts rather than referring to them.
 *
 * @param {string} startsAt ISO instant.
 * @param {string} zone The *reader's* timezone, not the provider's.
 * @returns {string|null} Null when either input is missing, so callers can drop
 *   the line rather than print "Invalid DateTime".
 */
export function formatWhen(startsAt, zone) {
  if (!startsAt || !zone) return null;

  const moment = DateTime.fromISO(startsAt).setZone(zone);
  if (!moment.isValid) return null;

  return moment.toFormat("ccc d LLL 'at' h:mm a");
}

/**
 * The venue as one line: its heading and its value.
 *
 * "Where to meet: 12 A Street" for an in-person appointment, "Where to attend:
 * Virtual meeting with the provider" for a virtual one. The address is
 * flattened onto a single line — providers write it across several, as they
 * would on an envelope, and a toast is not the place for four of them.
 *
 * @param {object} service A service, or a booking's `service`.
 * @returns {string|null} Null when there is nothing to say — an in-person
 *   appointment with no address on file, which is a gap the provider is told
 *   about rather than something to invent a sentence for.
 */
export function formatVenueLine(service) {
  const venue = describeLocation(service);
  if (!venue.text) return null;

  const value = venue.text.replace(/\s*\n\s*/g, ", ").trim();
  const link = venue.meetingLink ? ` — ${venue.meetingLink}` : "";

  return `${venue.term}: ${value}${link}`;
}

/**
 * The body of a booking message: which appointment, when, and where.
 *
 * Composed as lines rather than one sentence because a toast renders
 * `white-space: pre-line`, and three short facts are read at a glance where a
 * paragraph is skipped.
 *
 * Every part is optional and dropped when absent, so a payload missing a field
 * produces a shorter message rather than one with a hole in it.
 *
 * @param {object} args
 * @param {object} args.booking A serialised booking. `service` carries the name
 *   and the venue; `startsAt` the moment.
 * @param {string} args.viewerZone The reader's timezone.
 * @returns {string} Possibly empty, which callers treat as "no detail to add".
 */
export function bookingNoticeBody({ booking, viewerZone }) {
  if (!booking) return "";

  const when = formatWhen(booking.startsAt, viewerZone);
  const venue = formatVenueLine(booking.service);

  return [
    [booking.service?.name, when].filter(Boolean).join(" — ") || null,
    venue,
  ]
    .filter(Boolean)
    .join("\n");
}

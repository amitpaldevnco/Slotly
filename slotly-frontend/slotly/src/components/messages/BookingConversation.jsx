/**
 * The conversation about one appointment, as it appears on the booking detail
 * page: a Section wrapped around the shared thread.
 *
 * The thread itself lives in `MessageThread`, which the Messages page renders
 * too. Keeping the fetching, sending and bubbles in one place is what stops the
 * two surfaces from drifting into two different chat implementations.
 */

import { Link } from "react-router-dom";
import Icon from "../ui/Icon";
import { Section } from "../ui/Page";
import MessageThread from "./MessageThread";

export default function BookingConversation({ bookingId, otherPartyName }) {
  return (
    <Section
      headingId="conversation-heading"
      title="Messages"
      // States the scope plainly. Without this, "Messages" reads like a general
      // inbox and people wonder where their other conversations are.
      description={`About this appointment only — just you and ${
        otherPartyName || "the other person"
      }.`}
      actions={
        <Link
          to={`/messages/${bookingId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink transition hover:text-ink-2"
        >
          Open in Messages
          <Icon name="arrowRight" size={13} />
        </Link>
      }
      flush
    >
      <MessageThread bookingId={bookingId} otherPartyName={otherPartyName} variant="panel" />
    </Section>
  );
}

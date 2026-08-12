//The conversation about one appointment, shown on the booking detail page.

import { useRef, useState } from "react";
import { parseApiError } from "../../api/client";
import * as messagesApi from "../../api/messages";
import { useApiResource } from "../../hooks/useApiResource";
import { useToast } from "../../context/ToastContext";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import { Section } from "../ui/Page";
import { Textarea } from "../ui/Field";
import { ErrorState, SkeletonRows } from "../ui/Feedback";
import { primaryButton, buttonSm } from "../../lib/ui";

/** Longest message, matching the column and the server's validation. */
const MAX_LENGTH = 2000;


const STARTERS = [
  "Should I arrive early?",
  "Do I need to bring anything?",
  "Is there parking nearby?",
  "Can I request something specific?",
];

export default function BookingConversation({ bookingId, otherPartyName }) {
  const toast = useToast();

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const inputRef = useRef(null);

  const {
    data: thread,
    setData: setThread,
    loading,
    error,
    reload: load,
  } = useApiResource(({ signal }) => messagesApi.listForBooking(bookingId, { signal }), {
    deps: [bookingId],
    fallback: "Could not load this conversation.",
  });

  const handleSend = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    try {
      const created = await messagesApi.sendToBooking(bookingId, body);
      
      setThread((current) =>
        current
          ? { ...current, count: current.count + 1, messages: [...current.messages, created] }
          : current
      );
      setDraft("");
    } catch (err) {
      toast.error(parseApiError(err, "Could not send that message.").message);
    } finally {
      setSending(false);
    }
  };

  const applyStarter = (text) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  const messages = thread?.messages ?? [];
  const viewerRole = thread?.viewerRole;

  return (
    <Section
      headingId="conversation-heading"
      title="Messages"
      // States the scope plainly. Without this, "Messages" reads like a general
      // inbox and people wonder where their other conversations are.
      description={`About this appointment only — just you and ${
        otherPartyName || thread?.otherParty?.name || "the other person"
      }.`}
      actions={
        messages.length > 0 && (
          <span className="text-xs tabular-nums text-ink-3">{messages.length}</span>
        )
      }
      flush
    >
      <div className="px-4 py-3.5">
        {loading ? (
          <SkeletonRows count={2} variant="line" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} bare />
        ) : messages.length === 0 ? (
          <div>
            <p className="text-[0.8125rem] text-ink-2">
              No messages yet. Ask anything you need to know before your appointment.
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {STARTERS.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => applyStarter(starter)}
                    className="rounded-full border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink-2 transition hover:border-brand-line hover:bg-brand-soft hover:text-brand-ink"
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
        
          <ol className="max-h-[26rem] space-y-3 overflow-y-auto">
            {messages.map((message) => (
              <Bubble key={message.id} message={message} viewerRole={viewerRole} />
            ))}
          </ol>
        )}
      </div>

      <form onSubmit={handleSend} className="border-t border-line bg-subtle px-4 py-3">
        <label htmlFor="message-body" className="sr-only">
          Your message
        </label>
        <Textarea
          id="message-body"
          ref={inputRef}
          rows={2}
          maxLength={MAX_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type your message…"
          
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend(event);
            }
          }}
          className="resize-none bg-surface"
        />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-3">Enter to send · Shift + Enter for a new line</p>
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className={`${primaryButton} ${buttonSm}`}
          >
            <Icon name="arrowRight" size={14} />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function Bubble({ message, viewerRole }) {
  const mine = message.isMine;
  // Each message carries both parties' readings of its timestamp; take the one
  // belonging to whoever is looking.
  const local =
    viewerRole === "client" ? message.createdAtLocal?.client : message.createdAtLocal?.provider;

  return (
    <li className={`flex gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
      <Avatar src={message.senderAvatarUrl} name={message.senderName} size="sm" className="mt-0.5" />

      <div className={`min-w-0 max-w-[80%] ${mine ? "text-right" : "text-left"}`}>
        <p className="text-xs text-ink-3">
          <span className="font-medium text-ink">{mine ? "You" : message.senderName}</span>
          {local?.formatted && <span> · {local.formatted}</span>}
        </p>

        <div
          className={`mt-1 inline-block rounded-lg px-3 py-1.5 text-left text-[0.8125rem] leading-relaxed ${
            mine ? "bg-brand text-white" : "border border-line bg-canvas text-ink"
          }`}
        >
          
          <p className="whitespace-pre-line break-words">{message.body}</p>
        </div>
      </div>
    </li>
  );
}

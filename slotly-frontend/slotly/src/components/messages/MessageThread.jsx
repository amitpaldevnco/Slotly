/**
 * One appointment's conversation: the messages, and the box to add to them.
 *
 * Extracted from `BookingConversation` so the booking detail page and the
 * Messages page render the same thread from the same code. The two differ only
 * in chrome, which is what `variant` selects — `panel` sits inside a Section on
 * the booking page, `page` fills the right-hand column of the inbox.
 *
 * Note that loading a thread marks it read server-side (see `listMessages`),
 * which is why nothing here ever prefetches a conversation the user has not
 * opened.
 */

import { useEffect, useRef, useState } from "react";
import { parseApiError } from "../../api/client";
import * as messagesApi from "../../api/messages";
import { useApiResource } from "../../hooks/useApiResource";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import { ErrorState, SkeletonRows } from "../ui/Feedback";

/** Longest message, matching the column and the server's validation. */
const MAX_LENGTH = 2000;

/**
 * Openers for an empty thread, by who is looking at it.
 *
 * A blank box with a cursor in it is the reason most of these conversations
 * never start; four concrete questions is a lower bar than composing one.
 *
 * They have to differ by role, because the questions a client wants to ask are
 * not questions a provider would ever ask their own client. Both sides were
 * being offered the client's set, so a physiotherapist opening a thread with
 * someone booked into their own clinic was invited to ask "Is there parking
 * nearby?" and "Should I arrive early?".
 */
const STARTERS = {
  client: [
    "Should I arrive early?",
    "Do I need to bring anything?",
    "Is there parking nearby?",
    "Can I request something specific?",
  ],
  provider: [
    "Anything I should know before we start?",
    "Is this a new problem or a recurring one?",
    "Please arrive five minutes early.",
    "Let me know if you need to move this.",
  ],
};

export default function MessageThread({
  bookingId,
  otherPartyName,
  variant = "panel",
  onThreadLoaded,
  onSent,
}) {
  const toast = useToast();
  const { user } = useAuth();

  const starters = STARTERS[user?.role === "provider" ? "provider" : "client"];

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const inputRef = useRef(null);
  const scrollerRef = useRef(null);

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

  // Opening a thread clears its unread messages on the server, so the badge in
  // the shell is now wrong until something tells it so.
  useEffect(() => {
    if (thread) onThreadLoaded?.(thread);
  }, [thread, onThreadLoaded]);

  // Pin to the newest message. A conversation opens at its end, not its start.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [thread?.messages?.length]);

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
      onSent?.(created);
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
  const isPage = variant === "page";

  return (
    <div className={isPage ? "flex min-h-0 flex-1 flex-col" : ""}>
      <div
        ref={scrollerRef}
        className={
          isPage
            ? "min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6"
            : "max-h-[26rem] overflow-y-auto px-5 py-4"
        }
      >
        {loading ? (
          <SkeletonRows count={3} variant="line" label="Loading messages…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} bare />
        ) : messages.length === 0 ? (
          <div className={isPage ? "mx-auto max-w-md py-8 text-center" : ""}>
            <p className="text-sm leading-relaxed text-ink-2">
              No messages yet. Ask anything you need to know before the appointment.
            </p>
            <ul
              className={`mt-3 flex flex-wrap gap-2 ${isPage ? "justify-center" : ""}`}
            >
              {starters.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => applyStarter(starter)}
                    className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-line-strong hover:bg-subtle hover:text-ink"
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className={isPage ? "space-y-5" : "space-y-4"}>
            {messages.map((message, index) => (
              <Bubble
                key={message.id}
                message={message}
                viewerRole={viewerRole}
                // The separator only appears where the day actually changes, so a
                // thread sent in one sitting carries a single one at the top.
                daySeparator={dayLabel(message, viewerRole, messages[index - 1])}
                spacious={isPage}
              />
            ))}
          </ol>
        )}
      </div>

      <form
        onSubmit={handleSend}
        className={
          isPage
            ? "shrink-0 border-t border-line bg-surface p-4"
            : "border-t border-line bg-subtle px-5 py-4"
        }
      >
        <label htmlFor={`message-body-${bookingId}`} className="sr-only">
          Your message
        </label>

        <div className="flex items-end gap-2 rounded-lg border border-line bg-surface p-2 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/10">
          <textarea
            id={`message-body-${bookingId}`}
            ref={inputRef}
            rows={1}
            maxLength={MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message…"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend(event);
              }
            }}
            className="max-h-32 min-h-10 flex-1 resize-none border-none bg-transparent px-2 py-2 text-base text-ink outline-none placeholder:text-ink-3 sm:text-sm"
          />

          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md bg-brand text-white transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="send" size={17} />
          </button>
        </div>

        <p className="mt-2 text-xs text-ink-3">
          Enter to send · Shift + Enter for a new line
          {otherPartyName && ` · Only you and ${otherPartyName} can read this`}
        </p>
      </form>
    </div>
  );
}

/**
 * Each message carries both parties' readings of its timestamp; take the one
 * belonging to whoever is looking, so two people in different zones each see
 * their own clock and their own day boundaries.
 */
function localOf(message, viewerRole) {
  return viewerRole === "client" ? message.createdAtLocal?.client : message.createdAtLocal?.provider;
}

/**
 * The server sends one string, "14 Aug 2026, 10:42 am", because that is what
 * every other timestamp in the API looks like. The thread needs the halves
 * separately — the date above a day's first message, the time under each bubble
 * — so it splits rather than asking for a second representation of the same
 * instant.
 */
function splitLocal(local) {
  const formatted = local?.formatted;
  if (!formatted) return { date: null, time: null };

  const separator = formatted.lastIndexOf(", ");
  if (separator === -1) return { date: formatted, time: null };

  return { date: formatted.slice(0, separator), time: formatted.slice(separator + 2) };
}

/** The date heading above the first message of each day, and only there. */
function dayLabel(message, viewerRole, previous) {
  const current = splitLocal(localOf(message, viewerRole)).date;
  if (!current) return null;
  if (!previous) return current;
  return splitLocal(localOf(previous, viewerRole)).date === current ? null : current;
}

function Bubble({ message, viewerRole, daySeparator, spacious }) {
  const mine = message.isMine;
  const { time } = splitLocal(localOf(message, viewerRole));

  return (
    <>
      {daySeparator && (
        <li className="flex justify-center py-1">
          <span className="rounded-full bg-subtle px-3 py-1 text-xs font-medium text-ink-3">
            {daySeparator}
          </span>
        </li>
      )}

      <li className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
        {!mine && (
          <Avatar
            src={message.senderAvatarUrl}
            name={message.senderName}
            size="xs"
            className="mb-5"
          />
        )}

        <div className={`min-w-0 ${spacious ? "max-w-[75%]" : "max-w-[80%]"}`}>
          <div
            className={`inline-block px-3.5 py-2.5 text-left text-sm leading-relaxed ${
              mine
                ? "rounded-lg rounded-br-sm bg-brand text-white"
                : "rounded-lg rounded-bl-sm border border-line bg-subtle text-ink"
            }`}
          >
            <p className="whitespace-pre-line break-words">{message.body}</p>
          </div>

          <p className={`mt-1.5 text-xs text-ink-3 ${mine ? "text-right" : "text-left"}`}>
            {!mine && <span className="font-medium text-ink-2">{message.senderName} · </span>}
            {time}
          </p>
        </div>
      </li>
    </>
  );
}

/**
 * The inbox.
 *
 * Slotly's messaging is per-appointment: every thread belongs to a booking, and
 * only its two parties can read it. There is no conversations endpoint, so the
 * list itself is assembled from the caller's bookings.
 *
 * Rows show the appointment rather than a preview of the last message. Reading a
 * preview would mean fetching every thread, and fetching a thread is what marks
 * it read (see `listMessages` on the server) — the inbox would empty the unread
 * badge just by being opened.
 *
 * The unread dot, however, is real. `GET /bookings/unread-count` returns a
 * `byBooking` breakdown alongside the total, counted from `read_at IS NULL` on
 * messages the caller did not send, so a row is marked because that thread
 * genuinely holds something unread — not because the page guessed.
 *
 * On a phone this is one column at a time: the list, or the thread, never both.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DateTime } from "luxon";
import * as bookingsApi from "../api/bookings";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationsContext";
import MessageThread from "../components/messages/MessageThread";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import StatusBadge from "../components/ui/StatusBadge";
import EmptyState, { ErrorState, SkeletonRows } from "../components/ui/Feedback";
import { formatDateTime } from "../lib/time";
import {
  inputClasses,
  iconButton,
  primaryButton,
  buttonSm,
  secondaryButton,
} from "../lib/ui";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
];

/**
 * How often the open inbox re-checks for new mail.
 *
 * Slotly has no websocket and no push, so a dot that only appears on reload is
 * the alternative. Thirty seconds is frequent enough to feel live while reading
 * a thread and rare enough that a tab left open overnight costs a couple of
 * thousand of the cheapest query in the app.
 */
const UNREAD_POLL_MS = 30_000;

export default function MessagesPage() {
  const { user } = useAuth();
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const {
    unread,
    unreadByBooking,
    reloadUnread,
    markThreadRead,
    reload: reloadNotifications,
  } = useNotifications();

  const [filter, setFilter] = useState("all");
  const [term, setTerm] = useState("");

  const { data, loading, error, reload } = useApiResource(
    ({ signal }) => bookingsApi.list({}, { signal }),
    { deps: [], fallback: "Could not load your conversations." }
  );

  const viewerZone = user?.timezone || "UTC";
  const isProvider = user?.role === "provider";

  const conversations = useMemo(() => {
    const bookings = data?.bookings ?? [];

    return bookings.map((booking) => {
      const other = isProvider ? booking.client : booking.provider;
      return {
        booking,
        id: booking.id,
        name: other?.businessName || other?.name || "Unknown",
        avatarUrl: other?.avatarUrl,
        serviceName: booking.service?.name,
        startsAt: booking.startsAt,
        status: booking.status,
        // JSON object keys are strings whatever the server put in them, so the
        // numeric booking id has to be stringified or every lookup misses.
        unread: unreadByBooking[String(booking.id)] ?? 0,
      };
    });
  }, [data, isProvider, unreadByBooking]);

  const visible = useMemo(() => {
    const now = DateTime.now();
    const needle = term.trim().toLowerCase();

    return conversations.filter((conversation) => {
      if (filter === "upcoming" && DateTime.fromISO(conversation.startsAt) < now) return false;
      if (filter === "past" && DateTime.fromISO(conversation.startsAt) >= now) return false;

      if (!needle) return true;
      return (
        conversation.name.toLowerCase().includes(needle) ||
        (conversation.serviceName || "").toLowerCase().includes(needle)
      );
    });
  }, [conversations, filter, term]);

  const selected = bookingId
    ? conversations.find((conversation) => String(conversation.id) === String(bookingId))
    : null;

  /**
   * Opening a thread clears its unread messages server-side.
   *
   * The local drop is what removes the dot immediately — waiting for the refetch
   * would leave it sitting on the row the reader has just opened — and the
   * refetch then reconciles the shell's badge.
   *
   * `useCallback` is load-bearing, not tidiness: `MessageThread` lists this in a
   * `useEffect` dependency array, so an inline arrow would be a new identity on
   * every render, re-run the effect, update the context, and render again.
   */
  const selectedId = selected?.id ?? null;
  const handleThreadLoaded = useCallback(() => {
    if (selectedId == null) return;
    markThreadRead(selectedId);
    reloadNotifications();
  }, [selectedId, markThreadRead, reloadNotifications]);

  /**
   * Notice a message that arrives while the inbox is open.
   *
   * Without this the dot would only appear on a reload, which is not what "you
   * have a new message" means to anyone sitting on this screen. It polls the one
   * cheap count endpoint rather than the whole notifications payload, and only
   * while this page is mounted — nothing else in the app polls anything.
   */
  useEffect(() => {
    const timer = setInterval(reloadUnread, UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [reloadUnread]);

  // A thread opened from a deep link may not be in the current filter, which
  // would leave the list looking as though nothing is selected.
  useEffect(() => {
    if (selected && !visible.some((conversation) => conversation.id === selected.id)) {
      setFilter("all");
      setTerm("");
    }
    // Only when the selection changes — not on every keystroke in the search box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  return (
    <div className="flex h-[calc(100dvh-var(--spacing-topbar))] min-h-0">
      {/* The list. Hidden on a phone once a thread is open, because 375px cannot
          hold both and a two-pane layout squeezed into one is worse than either. */}
      <aside
        className={`flex w-full min-w-0 shrink-0 flex-col border-r border-line bg-surface md:w-[20rem] lg:w-[23rem] ${
          selected ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="shrink-0 border-b border-line p-4">
          <h1 className="font-display text-xl font-semibold tracking-[-0.01em] text-ink">
            Messages
          </h1>
          <p className="mt-1 text-xs text-ink-3">
            {unread > 0
              ? `${unread} unread ${unread === 1 ? "message" : "messages"}`
              : "One conversation per appointment."}
          </p>

          <div className="relative mt-4">
            <label htmlFor="conversation-search" className="sr-only">
              Search conversations
            </label>
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <input
              id="conversation-search"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search by name or service…"
              className={`${inputClasses} pl-9`}
            />
          </div>

          <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                aria-pressed={filter === option.id}
                className={`shrink-0 cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                  filter === option.id
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface text-ink-2 hover:bg-subtle hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4">
              <SkeletonRows count={5} />
            </div>
          ) : error ? (
            <div className="p-4">
              <ErrorState message={error} onRetry={reload} bare />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              icon="inbox"
              title={
                conversations.length === 0 ? "No conversations yet" : "Nothing matches that"
              }
              description={
                conversations.length === 0
                  ? isProvider
                    ? "A conversation opens as soon as someone books with you."
                    : "Book an appointment and you can message the provider about it."
                  : "Try a different name, service or filter."
              }
              {...(conversations.length === 0 && !isProvider
                ? { actionLabel: "Find a provider", actionTo: "/providers" }
                : {})}
            />
          ) : (
            <ul>
              {visible.map((conversation) => (
                <li key={conversation.id}>
                  <ConversationRow
                    conversation={conversation}
                    active={selected?.id === conversation.id}
                    viewerZone={viewerZone}
                    onSelect={() => navigate(`/messages/${conversation.id}`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* The thread. */}
      <section
        className={`min-w-0 flex-1 flex-col bg-canvas ${selected ? "flex" : "hidden md:flex"}`}
      >
        {selected ? (
          <>
            <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
              <button
                type="button"
                onClick={() => navigate("/messages")}
                aria-label="Back to conversations"
                className={`${iconButton} -ml-2 md:hidden`}
              >
                <Icon name="arrowLeft" size={20} />
              </button>

              <Avatar src={selected.avatarUrl} name={selected.name} size="sm" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{selected.name}</p>
                <p className="truncate text-xs text-ink-3">
                  {selected.serviceName} · {formatDateTime(selected.startsAt, viewerZone)}
                </p>
              </div>

              <StatusBadge status={selected.status} className="hidden sm:inline-flex" />

              <button
                type="button"
                onClick={() => navigate(`/bookings/${selected.id}`)}
                className={`${secondaryButton} ${buttonSm} hidden sm:inline-flex`}
              >
                <Icon name="external" size={14} />
                Booking
              </button>
            </header>

            <MessageThread
              key={selected.id}
              bookingId={selected.id}
              otherPartyName={selected.name}
              variant="page"
              onThreadLoaded={handleThreadLoaded}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-10">
            <div className="max-w-sm text-center">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-subtle text-ink-3">
                <Icon name="message" size={26} />
              </span>
              <p className="font-display text-lg font-semibold text-ink">
                Choose a conversation
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">
                Every appointment has its own thread, readable only by the two people in it.
              </p>
              {!isProvider && conversations.length === 0 && (
                <a href="/providers" className={`mt-5 ${primaryButton} ${buttonSm}`}>
                  Find a provider
                </a>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationRow({ conversation, active, viewerZone, onSelect }) {
  const { unread } = conversation;
  const hasUnread = unread > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`relative flex w-full cursor-pointer items-start gap-3 border-b border-line-soft p-4 text-left transition ${
        active ? "bg-subtle" : "hover:bg-subtle"
      }`}
    >
      {active && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brand" />}

      <span className="relative shrink-0">
        <Avatar src={conversation.avatarUrl} name={conversation.name} size="md" />

        {/* The dot on the avatar, so the sender is identifiable at a glance even
            with the row's text truncated. Ringed in the row's own background so
            it reads as a badge rather than as part of the photograph. */}
        {hasUnread && (
          <span
            aria-hidden="true"
            className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-danger ring-2 ${
              active ? "ring-subtle" : "ring-surface"
            }`}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          {/* Weight is the second signal. Colour alone would leave the row
              unmarked for anyone who cannot pick the red out. */}
          <span
            className={`truncate text-sm ${
              hasUnread ? "font-bold text-ink" : "font-semibold text-ink"
            }`}
          >
            {conversation.name}
          </span>
          <span className={`shrink-0 text-xs ${hasUnread ? "font-semibold text-ink" : "text-ink-3"}`}>
            {formatDateTime(conversation.startsAt, viewerZone).split(",")[0]}
          </span>
        </span>

        <span className="mt-0.5 block truncate text-xs text-ink-2">
          {conversation.serviceName}
        </span>

        <span className="mt-2 flex items-center gap-2">
          <StatusBadge status={conversation.status} />

          {hasUnread && (
            <span
              aria-hidden="true"
              className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold tabular-nums text-white"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      </span>

      {/* The count is decorative twice over — it is drawn above and announced
          here — so the badge itself is hidden from assistive tech. */}
      {hasUnread && (
        <span className="sr-only">
          {unread} unread {unread === 1 ? "message" : "messages"}
        </span>
      )}
    </button>
  );
}

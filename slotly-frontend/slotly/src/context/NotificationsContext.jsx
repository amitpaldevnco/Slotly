/**
 * What the app has to tell the signed-in user, derived entirely from data it
 * already has.
 *
 * Slotly has no notifications table and no push endpoint, so this invents
 * nothing: every entry below is a fact the server already reports through an
 * endpoint some screen was already calling — the unread-message count, the
 * availability health report, the service list, and the user's own record.
 *
 * It lives in a context rather than in each screen because two places need the
 * same list and must not disagree: the bell in the top bar, and the inline
 * "needs attention" panel on the dashboard. Fetching it once per session also
 * keeps the shell from firing three requests on every route change.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as bookingsApi from "../api/bookings";
import * as availabilityApi from "../api/availability";
import * as providersApi from "../api/providers";
import { useAuth } from "./AuthContext";

const NotificationsContext = createContext(null);

/** How long before a refetch is worth making. Nothing here changes by the second. */
const STALE_AFTER_MS = 60_000;

export function NotificationsProvider({ children }) {
  const { user } = useAuth();

  const [unread, setUnread] = useState(0);
  /** Booking id → that thread's unread count. Threads with none are absent. */
  const [unreadByBooking, setUnreadByBooking] = useState({});
  const [health, setHealth] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);

  const isProvider = user?.role === "provider";
  const userId = user?.id;

  const load = useCallback(
    async ({ signal } = {}) => {
      if (!userId) return;

      setLoading(true);
      try {
        // Every one of these is non-fatal on its own. A failed health check must
        // not blank the unread badge, and a failed unread count must not hide a
        // provider's broken availability.
        const [unreadResult, healthResult, servicesResult] = await Promise.all([
          bookingsApi.unreadCount({ signal }).catch(() => null),
          isProvider ? availabilityApi.getHealth({ signal }).catch(() => null) : null,
          isProvider ? providersApi.listServices(userId, { signal }).catch(() => []) : [],
        ]);

        if (signal?.aborted) return;

        setUnread(unreadResult?.unread ?? 0);
        setUnreadByBooking(unreadResult?.byBooking ?? {});
        setHealth(healthResult);
        setServices(servicesResult ?? []);
        setFetchedAt(Date.now());
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [userId, isProvider]
  );

  /**
   * Just the mail, for callers that poll.
   *
   * `load` also fetches the availability health report and the service list —
   * three requests for a provider. The inbox wants to notice a new message
   * arriving, which is one cheap endpoint, and should not drag the other two
   * along every time it checks.
   */
  const reloadUnread = useCallback(async () => {
    if (!userId) return;

    const result = await bookingsApi.unreadCount().catch(() => null);
    if (!result) return;

    setUnread(result.unread ?? 0);
    setUnreadByBooking(result.byBooking ?? {});
  }, [userId]);

  // The map, readable inside a callback without becoming a dependency of it —
  // `markThreadRead` would otherwise get a new identity every time a message
  // arrives, and re-run the effect of everything holding it.
  const unreadByBookingRef = useRef(unreadByBooking);
  useEffect(() => {
    unreadByBookingRef.current = unreadByBooking;
  }, [unreadByBooking]);

  /**
   * Drops a thread's unread messages locally.
   *
   * Opening a thread marks it read on the server, but waiting for the next fetch
   * to hear that back leaves the dot sitting under the reader's cursor on the
   * conversation they are currently looking at. This clears it the moment they
   * open it; the next fetch reconciles.
   */
  const markThreadRead = useCallback((bookingId) => {
    const key = String(bookingId);
    const cleared = unreadByBookingRef.current[key] ?? 0;
    if (cleared === 0) return;

    // Kept in step deliberately: the total is reduced by exactly what the map
    // gives up, so the badge in the shell and the dots in the list cannot drift.
    unreadByBookingRef.current = { ...unreadByBookingRef.current };
    delete unreadByBookingRef.current[key];

    setUnreadByBooking(unreadByBookingRef.current);
    setUnread((current) => Math.max(0, current - cleared));
  }, []);

  useEffect(() => {
    if (!userId) {
      setUnread(0);
      setUnreadByBooking({});
      setHealth(null);
      setServices([]);
      setFetchedAt(0);
      return undefined;
    }

    const controller = new AbortController();
    load({ signal: controller.signal });
    return () => controller.abort();
  }, [userId, load]);

  /** Called after an action that could have changed any of this. Cheap to ignore. */
  const refresh = useCallback(() => {
    if (Date.now() - fetchedAt < STALE_AFTER_MS) return;
    load();
  }, [fetchedAt, load]);

  const notices = useMemo(
    () => buildNotices({ user, unread, health, services }),
    [user, unread, health, services]
  );

  const value = useMemo(
    () => ({
      notices,
      unread,
      /** Booking id (as a string key) → that thread's unread count. */
      unreadByBooking,
      /** Everything that is not simply "you have mail" — the account-health half. */
      warnings: notices.filter((notice) => notice.kind === "warning"),
      loading,
      refresh,
      reload: load,
      reloadUnread,
      markThreadRead,
      setUnread,
    }),
    [notices, unread, unreadByBooking, loading, refresh, load, reloadUnread, markThreadRead]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("useNotifications must be used inside NotificationsProvider");
  return context;
}

/**
 * Turns the raw responses into a single ordered list.
 *
 * Ordered by how badly each one blocks the thing the user came to do: something
 * that stops bookings happening at all outranks an unread message, which
 * outranks an incomplete profile.
 *
 * `kind` separates the two audiences this list serves. `warning` entries are
 * things the user must fix and are also rendered inline on the page that fixes
 * them; `info` entries are just news.
 */
function buildNotices({ user, unread, health, services }) {
  if (!user) return [];

  const notices = [];
  const isProvider = user.role === "provider";

  if (isProvider) {
    if (services.length === 0) {
      notices.push({
        id: "no-services",
        kind: "warning",
        tone: "warn",
        icon: "tag",
        title: "You have no services yet",
        body: "Clients cannot book anything until at least one service exists.",
        to: "/services",
        actionLabel: "Add a service",
      });
    } else if (services.every((service) => service.isActive === false)) {
      notices.push({
        id: "no-active-services",
        kind: "warning",
        tone: "warn",
        icon: "tag",
        title: "None of your services are active",
        body: "Nothing can be booked while every service is retired.",
        to: "/services",
        actionLabel: "Manage services",
      });
    }

    for (const name of health?.servicesWithoutHours ?? []) {
      notices.push({
        id: `no-hours-${name}`,
        kind: "warning",
        tone: "warn",
        icon: "clock",
        title: `${name} has no hours set`,
        body: "Clients cannot book it until you give it a schedule.",
        to: "/availability",
        actionLabel: "Set hours",
      });
    }

    for (const service of health?.misconfiguredServices ?? []) {
      const day = service.problemDays?.[0];
      notices.push({
        id: `bad-hours-${service.serviceId}`,
        kind: "warning",
        tone: "danger",
        icon: "alert",
        title: `${service.serviceName} offers no bookable times`,
        // Deliberately short. The provider needs to know *that* it is broken and
        // where to go; the Availability page tells them why and what to change.
        body: day
          ? `Your ${day.weekdayName} hours are too short for it once buffers are counted.`
          : "Its current hours cannot produce a single slot.",
        to: "/availability",
        actionLabel: "Fix hours",
      });
    }
  }

  if (unread > 0) {
    notices.push({
      id: "unread-messages",
      kind: "info",
      tone: "info",
      icon: "message",
      title: `${unread} unread ${unread === 1 ? "message" : "messages"}`,
      body: "From the people you have appointments with.",
      to: "/messages",
      actionLabel: "Open messages",
    });
  }

  if (isProvider && !user.bio?.trim()) {
    notices.push({
      id: "no-bio",
      kind: "warning",
      tone: "info",
      icon: "user",
      title: "Your profile has no bio",
      body: "Clients read it when choosing between providers.",
      to: "/profile",
      actionLabel: "Add a bio",
    });
  }

  if (isProvider && !user.business_name?.trim()) {
    notices.push({
      id: "no-business-name",
      kind: "warning",
      tone: "info",
      icon: "briefcase",
      title: "Your business name is missing",
      body: "It is what the provider directory lists you under.",
      to: "/profile",
      actionLabel: "Add it",
    });
  }

  if (!user.phone_number?.trim()) {
    notices.push({
      id: "no-phone",
      kind: "warning",
      tone: "info",
      icon: "phone",
      title: "No phone number on your account",
      body: "Useful when an appointment has to change at short notice.",
      to: "/profile",
      actionLabel: "Add a number",
    });
  }

  // UTC is the column default, so it means "never chosen" far more often than it
  // means "I am in Reykjavík" — and every time in the app is drawn in this zone.
  if (!user.timezone || user.timezone === "UTC") {
    notices.push({
      id: "default-timezone",
      kind: "warning",
      tone: "warn",
      icon: "globe",
      title: "Your timezone is still the default",
      body: "Every appointment time you see is drawn in it. Set your real one.",
      to: "/settings",
      actionLabel: "Set timezone",
    });
  }

  return notices;
}

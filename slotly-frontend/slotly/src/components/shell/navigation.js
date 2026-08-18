/**
 * What the sidebar offers, per role.
 *
 * One list, imported by both the desktop rail and the mobile drawer, so the two
 * cannot drift.
 *
 * The design's rail is the same for both roles — Dashboard, Appointments,
 * Calendar, Services, Messages, Profile, Settings — because the reference
 * screens were drawn from a provider's point of view throughout. Here it is
 * split by role, because a client has no services to manage and no calendar of
 * their own to keep, and a navigation row that leads to an empty screen is worse
 * than one that is absent. Every entry below points at a route that exists in
 * `App.jsx` and at a screen the application already had; nothing here is a new
 * feature.
 *
 * `Support` is the one row from the design that is not reproduced: Slotly has no
 * support screen, contact form or help centre to point it at.
 */

import { DISCOVERY_ROUTE } from "../../lib/discovery";

export function navItemsFor(user) {
  if (user?.role === "provider") {
    return [
      { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { to: "/appointments", label: "Appointments", icon: "event_available" },
      { to: "/calendar", label: "Calendar", icon: "calendar_month" },
      { to: "/services", label: "Services", icon: "category" },
      { to: "/availability", label: "Availability", icon: "schedule" },
      { to: "/messages", label: "Messages", icon: "chat", badge: "unread" },
      { to: "/profile", label: "Profile", icon: "person" },
      { to: "/settings", label: "Settings", icon: "settings" },
    ];
  }

  return [
    { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/appointments", label: "Appointments", icon: "event_available" },
    { to: DISCOVERY_ROUTE, label: "Services", icon: "search", end: true },
    { to: "/messages", label: "Messages", icon: "chat", badge: "unread" },
    { to: "/profile", label: "Profile", icon: "person" },
    { to: "/settings", label: "Settings", icon: "settings" },
  ];
}

/**
 * The one filled button at the top of the rail.
 *
 * The design labels it "New Appointment" for both roles, but a provider does not
 * book their own appointments in Slotly — clients do. Each role therefore gets
 * the action that is actually theirs, in the same slot and the same treatment.
 */
export function primaryActionFor(user) {
  if (user?.role === "provider") {
    return { to: "/services?new=1", label: "New Service", icon: "add" };
  }
  if (user?.role === "client") {
    return { to: DISCOVERY_ROUTE, label: "New Appointment", icon: "add" };
  }
  return null;
}

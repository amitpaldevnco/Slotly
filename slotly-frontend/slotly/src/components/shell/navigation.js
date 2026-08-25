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

import { DISCOVERY_ROUTE, DISCOVERY_LABEL } from "../../lib/discovery";

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
    // `DISCOVERY_LABEL`, not "Services". Two problems with the old label: a
    // provider's own rail uses "Services" for /services — their catalogue — so
    // the same word named two unrelated screens depending on who was signed in;
    // and it was a fifth name for this one destination, which the landing page,
    // the public header and the client dashboard were already calling three
    // other things. `lib/discovery` exists to settle exactly this.
    { to: DISCOVERY_ROUTE, label: DISCOVERY_LABEL, icon: "search", end: true },
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
    // "Book appointment" rather than the design's "New Appointment": this goes
    // to the directory, and a client does not create an appointment out of
    // nothing — they find someone and take one of their open times. "New" reads
    // as a blank form that does not exist.
    return { to: DISCOVERY_ROUTE, label: "Book appointment", icon: "add" };
  }
  return null;
}

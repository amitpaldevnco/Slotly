/**
 * Where a sign-in should land, given where the user was heading.
 *
 * ## Why this is a shared function and not an inline `||`
 *
 * Two places decide the destination after a successful sign-in, and they race.
 * `LoginPage` calls `navigate(redirectTo)` in its submit handler; the same
 * response also sets `user` on the auth context, which re-renders
 * `GuestOnlyRoute` — the guard wrapping `/login` — and a `<Navigate>` returned
 * by a parent route resolves before a child's imperative navigation.
 *
 * While only `LoginPage` read `state.from`, the guard won and always sent people
 * to `/dashboard`: the intended destination was recorded by the guards, passed
 * through the router, read by `LoginPage`, and then discarded a frame later. So
 * both now resolve through this one function, which makes the race harmless
 * rather than trying to win it.
 */

/** Where to go when there is no recorded destination, or it cannot be trusted. */
const DEFAULT_DESTINATION = "/dashboard";

/**
 * Validates a recorded destination and falls back to the dashboard.
 *
 * `state.from` is written by the route guards, so in practice it is always an
 * in-app path. It is checked anyway because it reaches `<Navigate to>`: history
 * state survives a back-button return to `/login` and is editable from the
 * console, and an absolute `https://…` or protocol-relative `//host` there would
 * turn signing in into an off-site redirect. Only a single-slash-rooted path is
 * accepted.
 *
 * @param {unknown} from The candidate path from `location.state.from`.
 * @returns {string} A path safe to hand to the router.
 */
export function safeReturnTo(from) {
  if (typeof from !== "string") return DEFAULT_DESTINATION;

  // Must be app-rooted. `//host` is protocol-relative and leaves the site.
  if (!from.startsWith("/") || from.startsWith("//")) return DEFAULT_DESTINATION;

  // Sending someone back to the form they just used is not a destination — and
  // `GuestOnlyRoute` would bounce them off it again immediately.
  if (from === "/login" || from.startsWith("/login?")) return DEFAULT_DESTINATION;

  return from;
}

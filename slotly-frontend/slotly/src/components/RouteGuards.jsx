/**
 * Client-side route guards.
 *
 * ## These are navigation, not security
 *
 * Worth stating plainly, because the file looks like an authorization layer and
 * is not one. Nothing here protects data: every route below calls an API that
 * re-checks the same question on the server, against the specific row being
 * touched. A user who edited their way past these guards would reach a page that
 * renders nothing but 403s.
 *
 * What they actually buy is that a user is never shown a screen that could only
 * fail — the brief's "enforced on the server, not by hiding buttons in the UI",
 * read the right way round.
 *
 * ## The one thing every guard has to get right
 *
 * `loading` and `offline` must both be handled before `user`. `useAuth` starts
 * with no user while `GET /auth/me` is in flight, so a guard that checked
 * `!user` first would redirect every signed-in person to the login page on a
 * hard refresh and bounce them back a moment later. `offline` is the same
 * mistake with a slower fuse: when the request fails outright there is still no
 * user, but the session is *unknown* rather than absent, and redirecting on it
 * signed people out every time the API was briefly unreachable. Neither is a
 * signed-out state and neither may reach the `!user` branch.
 *
 * That is why each guard below opens with the same three lines rather than
 * sharing a wrapper: the order is the correctness condition, and inlining it
 * keeps it visible in all four.
 */

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ErrorState, PageLoader } from "./ui/Feedback";

/**
 * Shown when the session could not be read because the server did not answer.
 *
 * Deliberately not a redirect to `/login`: the user may well be signed in, and
 * sending them to a form that cannot submit either turns one failure into two.
 * Offering the retry keeps them where they were, which is also the right place
 * to be once a sleeping host finishes waking up.
 *
 * @param {{onRetry: Function}} props `refetchUser` from the auth context.
 */
function SessionUnavailable({ onRetry }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <ErrorState
        message="We could not reach the server to check your session. You have not been signed out — this is usually a connection problem, or a server still starting up."
        onRetry={onRetry}
      />
    </div>
  );
}


/**
 * Requires a signed-in user with a role.
 *
 * Records where the user was heading in the redirect's `state.from`, so logging
 * in returns them there instead of dumping them on the dashboard.
 *
 * @returns The child route, or a redirect to `/login` (no session) or
 *   `/complete-profile` (a social sign-up that never finished choosing a role).
 */
export function ProtectedRoute() {
  const { user, loading, offline, refetchUser } = useAuth();
  const location = useLocation();

  // Rendering the redirect before /auth/me resolves would bounce every signed-in
  // user to the login page on a hard refresh.
  if (loading) return <PageLoader label="Checking your session…" />;

  // Unreachable, not unauthenticated. Falling through to `!user` here is what
  // logged people out whenever the API was asleep.
  if (offline && !user) return <SessionUnavailable onRetry={refetchUser} />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // A user exists but has not picked a role yet — an OAuth sign-up that never
  // finished. Every protected page needs the role, so finish setup first.
  if (!user.role) return <Navigate to="/complete-profile" replace />;

  return <Outlet />;
}


/**
 * Requires a signed-in user of one particular role.
 *
 * @param {{role: "client"|"provider"}} props The role this branch of the app is
 *   for. A user with the other one is sent to `/dashboard`, which renders the
 *   right thing for whoever they actually are — a plain error page would be
 *   accurate and useless.
 */
export function RoleRoute({ role }) {
  const { user, loading, offline, refetchUser } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader label="Checking your session…" />;
  if (offline && !user) return <SessionUnavailable onRetry={refetchUser} />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!user.role) return <Navigate to="/complete-profile" replace />;

  if (user.role !== role) {
    // Redirect rather than render an error: the dashboard is the right place for
    // whichever role they actually have, and it explains itself.
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}


/**
 * Profile completion — reachable only by a signed-in user who has no role yet.
 *
 * The role is chosen once and cannot be changed afterwards (the server returns
 * 409 INVALID_TRANSITION on a second attempt, which is where the rule is
 * actually enforced). Sending a user who already has one back to their
 * dashboard means they never see a form whose submit button could only fail.
 */
export function CompleteProfileRoute() {
  const { user, loading, offline, refetchUser } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader label="Checking your session…" />;
  if (offline && !user) return <SessionUnavailable onRetry={refetchUser} />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (user.role) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}


/**
 * For pages that only make sense signed out — login and registration.
 *
 * Sends a signed-in user onward rather than showing them a login form they have
 * already used, and picks the destination by how far through setup they are.
 */
export function GuestOnlyRoute() {
  const { user, loading } = useAuth();

  // The same label as the three guards above it. All four are waiting on the
    // same `/auth/me` call, and this one alone said "Loading…" — so which of two
    // sentences a reader saw depended on which route they happened to open.
  if (loading) return <PageLoader label="Checking your session…" />;
  if (user) return <Navigate to={user.role ? "/dashboard" : "/complete-profile"} replace />;

  return <Outlet />;
}

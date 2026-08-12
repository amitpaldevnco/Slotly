//Client-side route guards.

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PageLoader } from "./ui/Feedback";


export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Rendering the redirect before /auth/me resolves would bounce every signed-in
  // user to the login page on a hard refresh.
  if (loading) return <PageLoader label="Checking your session…" />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // A user exists but has not picked a role yet — an OAuth sign-up that never
  // finished. Every protected page needs the role, so finish setup first.
  if (!user.role) return <Navigate to="/complete-profile" replace />;

  return <Outlet />;
}


export function RoleRoute({ role }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader label="Checking your session…" />;
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


export function GuestOnlyRoute() {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader label="Loading…" />;
  if (user) return <Navigate to={user.role ? "/dashboard" : "/complete-profile"} replace />;

  return <Outlet />;
}

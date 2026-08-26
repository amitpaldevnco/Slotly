//The dashboard, which is a different screen for each role.

import { useAuth } from "../context/AuthContext";
import ClientDashboard from "../components/dashboard/ClientDashboard";
import ProviderDashboard from "../components/dashboard/ProviderDashboard";
import { PageLoader } from "../components/ui/Feedback";
import usePageTitle from "../hooks/usePageTitle";

export default function DashboardPage() {
  usePageTitle("Dashboard");

  const { user, loading } = useAuth();

  // ProtectedRoute has already guaranteed a user with a role by this point;
  // this is a defensive render for the brief moment during a refetch.
  // Labelled, like every other PageLoader in the app. This was the one bare
  // spinner left, so the app's most-visited route was also the only one that
  // did not say what it was waiting for.
  if (loading || !user) return <PageLoader label="Loading your dashboard…" />;

  return user.role === "provider" ? <ProviderDashboard user={user} /> : <ClientDashboard user={user} />;
}

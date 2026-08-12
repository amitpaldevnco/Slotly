//The dashboard, which is a different screen for each role.

import { useAuth } from "../context/AuthContext";
import ClientDashboard from "../components/dashboard/ClientDashboard";
import ProviderDashboard from "../components/dashboard/ProviderDashboard";
import { PageLoader } from "../components/ui/Feedback";

export default function DashboardPage() {
  const { user, loading } = useAuth();

  // ProtectedRoute has already guaranteed a user with a role by this point;
  // this is a defensive render for the brief moment during a refetch.
  if (loading || !user) return <PageLoader />;

  return user.role === "provider" ? <ProviderDashboard user={user} /> : <ClientDashboard user={user} />;
}

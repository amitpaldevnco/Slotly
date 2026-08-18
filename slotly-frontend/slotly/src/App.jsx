/**
 * Route table and the provider stack every page sits inside.
 *
 * Routing is where this app's authorization story becomes visible, and the
 * guards in `components/RouteGuards` are the whole of it on this side:
 * `ProtectedRoute` needs a session, `RoleRoute` needs a particular role,
 * `GuestOnlyRoute` bounces a signed-in user away from the login page, and
 * `CompleteProfileRoute` holds a half-registered account on the profile step
 * until it has picked a role.
 *
 * None of that is security. Every one of these routes calls an API that checks
 * the same thing again on the server, against the specific row being touched —
 * the guards here only keep a user from navigating somewhere that would render
 * nothing but an error.
 */
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import {
  ProtectedRoute,
  RoleRoute,
  GuestOnlyRoute,
  CompleteProfileRoute,
} from "./components/RouteGuards";
import Layout from "./components/Layout";

import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import CompleteProfilePage from "./pages/CompleteProfilePage";
import EditProfilePage from "./pages/EditProfilePage";
import ProvidersPage from "./pages/ProvidersPage";
import ProviderPublicProfilePage from "./pages/ProviderPublicProfilePage";
import BookServicePage from "./pages/BookServicePage";
import DashboardPage from "./pages/DashboardPage";
import BookingDetailPage from "./pages/BookingDetailPage";
import AppointmentsPage from "./pages/AppointmentsPage";
import CalendarPage from "./pages/CalendarPage";
import MessagesPage from "./pages/MessagesPage";
import SettingsPage from "./pages/SettingsPage";
import ServicesPage from "./pages/ServicesPage";
import AvailabilityPage from "./pages/AvailabilityPage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<LandingPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route
                path="/providers/:providerId"
                element={<ProviderPublicProfilePage />}
              />

              {/* Signed out only. */}
              <Route element={<GuestOnlyRoute />}>
                <Route path="/login" element={<LoginPage />} />
              </Route>

              {/* Signed in, but no role chosen yet. */}
              <Route element={<CompleteProfileRoute />}>
                <Route
                  path="/complete-profile"
                  element={<CompleteProfilePage />}
                />
              </Route>

              {/* Any signed-in user with a completed profile. */}
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/appointments" element={<AppointmentsPage />} />
                <Route path="/profile" element={<EditProfilePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/messages/:bookingId" element={<MessagesPage />} />
                <Route
                  path="/bookings/:bookingId"
                  element={<BookingDetailPage />}
                />
              </Route>

              {/* Clients only. */}
              <Route element={<RoleRoute role="client" />}>
                <Route
                  path="/providers/:providerId/book/:serviceId"
                  element={<BookServicePage />}
                />
              </Route>

              {/* Providers only. */}
              <Route element={<RoleRoute role="provider" />}>
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/availability" element={<AvailabilityPage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import {
  ProtectedRoute,
  RoleRoute,
  GuestOnlyRoute,
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

              <Route
                path="/complete-profile"
                element={<CompleteProfilePage />}
              />

              {/* Any signed-in user with a completed profile. */}
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/profile" element={<EditProfilePage />} />
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

/**
 * The shell every route renders inside — and which of the two shells that is.
 *
 * Slotly has two kinds of page. The application proper (dashboard, services,
 * availability, messages, profile, settings, a booking) gets the sidebar shell.
 * The pages a stranger can land on (the marketing page, sign-in, an error) get a
 * conventional header and footer, because a navigation rail full of destinations
 * they cannot reach is a wall rather than a shortcut.
 *
 * The split is decided here rather than in `App.jsx` so that the two route
 * groups keep sharing one `<Outlet />` and one scroll-reset — the alternative
 * was two nested layout routes and a duplicate of every public path.
 */

import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NotificationsProvider } from "../context/NotificationsContext";
import AppShell from "./shell/AppShell";
import PublicHeader from "./shell/PublicHeader";
import Footer from "./Footer";

/**
 * Routes that are never given the sidebar, signed in or not.
 *
 * `/login` and `/complete-profile` are single-purpose screens with one thing to
 * do on them; the landing page is the product's front door and belongs to the
 * marketing shell even for a user who happens to have a session.
 */
const ALWAYS_PUBLIC = ["/", "/login", "/complete-profile"];

function useScrollToTopOnNavigate() {
  const { pathname } = useLocation();

  useEffect(() => {
    // `instant` opts out of the global `scroll-behavior: smooth`, which is there
    // for anchor links. Animating the reset is the glitch, not the fix.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
}

export default function Layout() {
  useScrollToTopOnNavigate();

  const { user } = useAuth();
  const { pathname } = useLocation();

  const useAppShell = Boolean(user?.role) && !ALWAYS_PUBLIC.includes(pathname);

  return (
    <NotificationsProvider>
      <a
        href="#main"
        // Visible only on focus. The shell carries several interactive controls
        // before the content starts, which is several Tab presses on every page
        // for a keyboard user.
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      {useAppShell ? (
        <AppShell />
      ) : (
        <div className="flex min-h-dvh flex-col bg-canvas">
          <PublicHeader />

          <main id="main" className="flex-1">
            <Outlet />
          </main>

          <Footer />
        </div>
      )}
    </NotificationsProvider>
  );
}

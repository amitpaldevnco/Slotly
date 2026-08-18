/**
 * The signed-in shell: a fixed navigation rail, a sticky top bar, and the page.
 *
 * The reference markup pins the shell to `h-screen overflow-hidden` and scrolls
 * an inner div. That is not reproduced here, because it breaks `position:
 * sticky` for every panel header inside a page, hands the calendar a scroll
 * container it does not expect, and loses the browser's own scroll restoration.
 * A sticky top bar over normal document scroll is visually identical at every
 * width and behaves.
 *
 * The page's own padding and 1280px measure live in `Page`, using the same
 * `margin-mobile` / `margin-desktop` / `container-max-width` steps the design
 * puts on `<main>`, so the result is the same box.
 */

import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/** What the top bar calls the current screen. Matches the sidebar's labels. */
const TITLES = [
  [/^\/dashboard/, "Dashboard"],
  [/^\/appointments/, "Appointments"],
  [/^\/calendar/, "Calendar"],
  [/^\/services/, "Services"],
  [/^\/availability/, "Availability"],
  [/^\/messages/, "Messages"],
  [/^\/profile/, "Profile"],
  [/^\/settings/, "Settings"],
  [/^\/bookings\//, "Appointment"],
  [/^\/providers\/[^/]+\/book\//, "Book an appointment"],
  [/^\/providers/, "Providers"],
];

function titleFor(pathname) {
  return TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? "";
}

export default function AppShell() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);

  // Any navigation closes the drawer. Without this, tapping a link in it left it
  // open over the page it had just navigated to.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  const handleLogout = useCallback(async () => {
    setMenuOpen(false);
    await logout();
    navigate("/");
  }, [logout, navigate]);

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onLogout={handleLogout} />

      <div className="flex min-h-dvh min-w-0 flex-col md:ml-sidebar-width">
        <Topbar
          onOpenMenu={() => setMenuOpen(true)}
          onLogout={handleLogout}
          title={titleFor(location.pathname)}
        />

        <main id="main" className="min-w-0 flex-1 bg-background">
          <Outlet />
        </main>

        <ShellColophon />
      </div>
    </div>
  );
}

/** The one line the reference screens put at the bottom of the scroll area. */
function ShellColophon() {
  return (
    <div className="border-t border-outline-variant/30 px-margin-mobile py-6 text-center md:px-margin-desktop">
      <p className="font-caption text-caption text-on-surface-variant">
        © {new Date().getFullYear()} Slotly Inc. All rights reserved.
      </p>
    </div>
  );
}

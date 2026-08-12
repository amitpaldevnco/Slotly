// The shell every route renders inside.

import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Navbar";
import Footer from "./Footer";


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

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main"
        // Visible only on focus. The header now carries up to five interactive
        // controls before the content starts, which is five Tab presses on every
        // page for a keyboard user.
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <Header />

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}

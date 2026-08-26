/**
 * The header for the pages a signed-out visitor sees: the landing page, the
 * provider directory, a provider's public page, and the error screens.
 *
 * The design gives these pages a conventional marketing bar rather than the
 * application's sidebar, and that distinction is worth keeping — a visitor with
 * no account has nothing to navigate between, and a 240px rail of destinations
 * they cannot reach is a wall, not a shortcut.
 */

import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import Logo from "../ui/Logo";
import Icon from "../ui/Icon";
import { SkeletonBlock } from "../ui/Feedback";
import { container, primaryButton, secondaryButton, buttonSm, iconButtonTouch } from "../../lib/ui";
import { DISCOVERY_ROUTE, DISCOVERY_LABEL } from "../../lib/discovery";

const LINKS = [{ to: DISCOVERY_ROUTE, label: DISCOVERY_LABEL, end: true }];

export default function PublicHeader() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className={`${container} flex h-16 items-center gap-4`}>
        <Link
          to={user ? "/dashboard" : "/"}
          className="shrink-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Logo size="sm" />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-1 sm:flex" aria-label="Primary">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `inline-flex h-10 items-center rounded-md px-3 text-sm font-medium transition ${
                  isActive ? "bg-subtle text-ink" : "text-ink-2 hover:bg-subtle hover:text-ink"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {loading ? (
            // A placeholder rather than "Sign in": showing the signed-out state
            // while /auth/me is still in flight makes the header flicker on every
            // refresh for users who are, in fact, signed in.
            //
            // `SkeletonBlock` rather than the hand-written pulse that used to be
            // here, which reimplemented it class for class — so a change to the
            // app's skeleton colour or its reduced-motion behaviour would have
            // updated every placeholder except this one.
            <SkeletonBlock className="h-9 w-24 rounded-md" />
          ) : user ? (
            <Link to="/dashboard" className={`${primaryButton} ${buttonSm}`}>
              <Icon name="dashboard" size={15} />
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden h-10 items-center rounded-md px-3 text-sm font-medium text-ink-2 transition hover:bg-subtle hover:text-ink sm:inline-flex"
              >
                Sign in
              </Link>
              <Link to="/login" className={`${primaryButton} ${buttonSm}`}>
                <span className="sm:hidden">Sign up</span>
                <span className="hidden sm:inline">Get started</span>
              </Link>
            </>
          )}

          {/* The one nav link lives behind this below `sm`, where the bar has to
              hold a logo, a call to action and this toggle at 320px. */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Toggle menu"
            className={`${iconButtonTouch} sm:hidden`}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={20} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-line bg-surface sm:hidden" aria-label="Mobile">
          <div className={`${container} space-y-1 py-3`}>
            <Link to={DISCOVERY_ROUTE} className={`${secondaryButton} w-full`}>
              <Icon name="search" size={16} />
              {DISCOVERY_LABEL}
            </Link>
            {!user && !loading && (
              <Link to="/login" className={`${secondaryButton} w-full`}>
                <Icon name="user" size={16} />
                Sign in
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}

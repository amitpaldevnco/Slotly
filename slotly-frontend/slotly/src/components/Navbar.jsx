
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Avatar from "./ui/Avatar";
import Logo from "./ui/Logo";
import Icon from "./ui/Icon";
import {
  container,
  primaryButton,
  secondaryButton,
  buttonSm,
  iconButtonTouch,
  zoneName,
} from "../lib/ui";
import { DISCOVERY_ROUTE, DISCOVERY_LABEL, DISCOVERY_SHORT_LABEL } from "../lib/discovery";


function linksFor(user) {
  if (!user?.role) {
    return [{ to: DISCOVERY_ROUTE, label: DISCOVERY_LABEL, icon: "search", end: true }];
  }

  if (user.role === "provider") {
    return [
      { to: "/dashboard", label: "Schedule", icon: "calendar" },
      { to: "/services", label: "Services", icon: "tag" },
      { to: "/availability", label: "Availability", icon: "clock" },
    ];
  }

  return [
    { to: "/dashboard", label: "My bookings", icon: "calendarCheck" },
    { to: DISCOVERY_ROUTE, label: DISCOVERY_LABEL, icon: "search", end: true },
  ];
}

/**
 * The one action the header offers, which is not the same one for both roles.
 *
 * Signed-out visitors get nothing here — their one action is discovery, and that
 * sits in the header bar itself rather than inside the mobile sheet. See the
 * standalone link in the header below for why.
 */
function primaryActionFor(user) {
  if (user?.role === "provider") {
    return { to: "/services?new=1", label: "New service", icon: "plus" };
  }
  if (user?.role === "client") {
    return { to: "/providers", label: "Book an appointment", icon: "plus" };
  }
  return null;
}

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const links = linksFor(user);
  const action = primaryActionFor(user);

  // Any navigation closes both. Without this, tapping a link in the mobile sheet
  // left it open over the page it had just navigated to.
  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.pathname, location.search]);

  const handleLogout = async () => {
    setMenuOpen(false);
    setAccountOpen(false);
    await logout();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className={`${container} flex h-14 items-center gap-3`}>
        <Link
          to={user ? "/dashboard" : "/"}
          className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Logo size="sm" className="text-ink" />
        </Link>

        {/* An underline rather than a colour swap. Colour alone made the active
            link a slightly different green from the inactive ones, which is a
            weak signal and an invisible one to anyone who cannot separate the
            two hues. */}
        <nav className="hidden min-w-0 flex-1 items-center gap-1 md:flex" aria-label="Primary">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `relative inline-flex h-14 items-center gap-1.5 px-3 text-sm font-medium transition ${
                  isActive
                    ? "text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand"
                    : "text-ink-2 hover:text-ink"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* Discovery, in the bar itself, for anyone not signed in.

            Below `md` the nav above is hidden and everything it holds moves into
            the hamburger sheet — which meant the only thing a signed-out visitor
            can actually do without an account was invisible until they opened a
            menu, while "Get started" sat in the open. Someone who has not
            committed to an account yet should not have to go looking for the
            browse route. `md:hidden` because the full nav already carries the
            same link at wider widths. */}
        {!loading && !user && (
          <Link
            to={DISCOVERY_ROUTE}
            className={`${secondaryButton} ${buttonSm} shrink-0 md:hidden`}
          >
            <Icon name="search" size={15} />
            {DISCOVERY_SHORT_LABEL}
          </Link>
        )}

        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          {loading ? (
            // A placeholder rather than "Sign in": showing the signed-out state
            // while /auth/me is still in flight makes the header flicker on
            // every refresh for users who are, in fact, signed in.
            <div className="h-8 w-8 animate-pulse rounded-full bg-line motion-reduce:animate-none" />
          ) : user ? (
            <>
              {/* {action && (
                <Link to={action.to} className={`${primaryButton} ${buttonSm} hidden sm:inline-flex`} >
                  <Icon name={action.icon} size={15} />
                  {action.label}
                </Link>
              )} */}
              <AccountMenu
                user={user}
                open={accountOpen}
                onToggle={() => setAccountOpen((o) => !o)}
                onClose={() => setAccountOpen(false)}
                onLogout={handleLogout}
              />
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-ink-2 transition hover:text-ink sm:inline-flex"
              >
                Sign in
              </Link>
              {/* "Sign up" on the narrowest screens purely for width: at 320px
                  the bar also has to hold the logo and the discovery link, and
                  "Get started" is the widest of the three. Same destination —
                  /login offers both modes. */}
              <Link to="/login" className={`${primaryButton} ${buttonSm}`}>
                <span className="sm:hidden">Sign up</span>
                <span className="hidden sm:inline">Get started</span>
              </Link>
            </>
          )}

          {/* Signed-out visitors get no hamburger. Once discovery moved into the
              bar the sheet had one row left — "Sign in" — pointing at /login,
              which is where the button beside it already goes. A menu toggle
              that opens a duplicate of its neighbour is worth less than the
              44px it costs, and that width is exactly what the bar needs at
              320px to fit the logo, discovery and sign-up without overflowing. */}
          {user && (
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Toggle menu"
              className={`${iconButtonTouch} md:hidden`}
            >
              <Icon name={menuOpen ? "close" : "menu"} size={19} />
            </button>
          )}
        </div>
      </div>

      {menuOpen && user && (
        <MobileMenu links={links} action={action} user={user} onLogout={handleLogout} />
      )}
    </header>
  );
}

/**
 * The account menu.
 *
 * Replaces a permanent avatar chip plus a permanent "Sign out" button. Sign-out
 * is a rare, mildly destructive action; giving it the same standing as the
 * navigation meant the header's most prominent control was the one that ends the
 * session.
 *
 * The timezone is shown here because it is the single setting that makes every
 * time in the app read correctly or incorrectly, and this is where a user goes
 * looking when a time surprises them.
 */
function AccountMenu({ user, open, onToggle, onClose, onLogout }) {
  const ref = useRef(null);

  // Close on an outside click. Registered only while open, so the app is not
  // carrying a document-level listener for a menu nobody has opened.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex h-11 items-center gap-1.5 rounded-md px-1 transition hover:bg-canvas sm:h-9"
      >
        <Avatar src={user.avatar_url} name={user.name} size="sm" />
        <Icon name="chevronDown" size={14} className="hidden text-ink-3 sm:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-line bg-surface shadow-float"
        >
          <div className="border-b border-line bg-subtle px-3 py-2.5">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-3">{user.email}</p>
            {user.timezone && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-ink-3">
                <Icon name="globe" size={12} />
                <span className="truncate">{zoneName(user.timezone)}</span>
              </p>
            )}
          </div>

          <div className="p-1">
            <MenuLink to="/profile" icon="user" label="Profile & settings" />
            {user.role === "provider" && (
              <MenuLink to={`/providers/${user.id}`} icon="external" label="View public page" />
            )}
            <MenuLink to="/dashboard" icon="calendar" label="Dashboard" />
          </div>

          <div className="border-t border-line p-1">
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-danger-ink transition hover:bg-danger-soft"
            >
              <Icon name="logout" size={15} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, icon, label }) {
  return (
    <Link
      to={to}
      role="menuitem"
      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink-2 transition hover:bg-canvas hover:text-ink"
    >
      <Icon name={icon} size={15} className="text-ink-3" />
      {label}
    </Link>
  );
}

/**
 * The mobile sheet.
 *
 * Full-width rows with icons rather than a list of small text links, and the
 * primary action at the top instead of hidden behind the navigation — on a phone
 * this menu is the only route to both, and the action is the more common
 * destination.
 */
function MobileMenu({ links, action, user, onLogout }) {
  // The action and the navigation can point at the same page — a client's "Book
  // an appointment" and their "Find a provider" are both the discovery route,
  // and so is a signed-out visitor's CTA. Listing it twice, once as a button and
  // once as a row, reads as two destinations. The button wins; the row goes.
  const rows = links.filter((link) => link.to !== action?.to);

  return (
    <nav className="border-t border-line bg-canvas md:hidden" aria-label="Mobile">
      <div className={`${container} space-y-1 py-2.5`}>
        {action && (
          <Link to={action.to} className={`${primaryButton} w-full`}>
            <Icon name={action.icon} size={16} />
            {action.label}
          </Link>
        )}

        {rows.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-2.5 py-3 text-sm font-medium transition ${
                isActive ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-surface"
              }`
            }
          >
            <Icon name={link.icon} size={17} />
            {link.label}
          </NavLink>
        ))}

        {user && (
          <>
            <div className="my-1 h-px bg-line" />
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-3 text-sm font-medium transition ${
                  isActive ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-surface"
                }`
              }
            >
              <Icon name="user" size={17} />
              Profile & settings
            </NavLink>
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-3 text-left text-sm font-medium text-danger-ink transition hover:bg-danger-soft"
            >
              <Icon name="logout" size={17} />
              Sign out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}

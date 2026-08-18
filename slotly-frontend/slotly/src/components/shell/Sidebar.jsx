/**
 * The persistent 240px navigation rail, and the drawer it becomes on a phone.
 *
 * Transcribed from the reference screens: a `surface-container-low` wash with a
 * right outline, 32px py / 16px px, the mark and wordmark block, the filled
 * primary action, the nav list, and a divided group at the foot. The active row
 * is the design's — a 4px left bar, a lift to `surface`, weight 600, and a
 * filled glyph.
 *
 * One component renders both breakpoints: below `md` the same markup is
 * positioned as an off-canvas panel behind a scrim, above it as a fixed rail.
 * Keeping them as one is what stops the two navigations from listing different
 * things.
 */

import { useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationsContext";
import Icon from "../ui/Icon";
import Logo from "../ui/Logo";
import { navItemsFor, primaryActionFor } from "./navigation";

export default function Sidebar({ open, onClose, onLogout }) {
  const { user } = useAuth();

  const items = navItemsFor(user);
  const action = primaryActionFor(user);

  // Escape closes the drawer, and the body stops scrolling behind it. Both are
  // scoped to the open state so a desktop session carries no listener and no
  // style override for a drawer it will never open.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  return (
    <>
      {/* The scrim. Only ever rendered on a phone, and only while open. */}
      {open && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-inverse-surface/40 md:hidden"
        />
      )}

      <nav
        aria-label="Primary"
        className={
          "fixed left-0 top-0 z-50 flex h-screen w-[17rem] flex-col border-r border-outline-variant " +
          "bg-surface-container-low px-4 py-8 transition-transform duration-200 ease-in-out " +
          "md:z-40 md:w-sidebar-width md:translate-x-0 " +
          (open ? "translate-x-0" : "-translate-x-full")
        }
      >
        {/* Brand */}
        <div className="mb-8 flex items-center gap-3 px-4">
          <Link
            to="/dashboard"
            className="flex min-w-0 items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Logo size="sm" subtitle />
          </Link>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-2 ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high md:hidden"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        {/* The one filled action */}
        {action && (
          <Link
            to={action.to}
            className="mb-8 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-small text-small text-on-primary transition-colors hover:bg-primary/90"
          >
            <Icon name={action.icon} size={18} />
            {action.label}
          </Link>
        )}

        <ul className="no-scrollbar -mx-4 flex flex-1 flex-col gap-1 overflow-y-auto px-4">
          {items.map((item) => (
            <li key={item.to}>
              <SidebarLink item={item} />
            </li>
          ))}
        </ul>

        <div className="mt-auto space-y-1 border-t border-outline-variant/30 pt-6">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-r-md px-4 py-2 font-small text-small text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <Icon name="logout" size={20} />
            Log Out
          </button>
        </div>
      </nav>
    </>
  );
}

/**
 * One navigation row.
 *
 * Four signals mark the active one — the left bar, the lighter fill, the weight
 * change and the filled glyph — because in a greyscale palette a colour change
 * alone has almost nothing to say.
 */
function SidebarLink({ item }) {
  const { unread } = useNotifications();
  const count = item.badge === "unread" ? unread : 0;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        "flex items-center gap-3 rounded-r-sm border-l-4 px-4 py-3 font-small text-small transition-colors " +
        (isActive
          ? "border-primary bg-surface font-semibold text-primary"
          : "border-transparent text-on-surface-variant hover:bg-surface-container-high")
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={item.icon} size={20} fill={isActive} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>

          {count > 0 && (
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-caption text-[10px] font-bold text-on-primary">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

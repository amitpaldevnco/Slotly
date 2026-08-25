/**
 * The 64px bar above the content column.
 *
 * Transcribed from the reference screens: a translucent `surface` with a blur
 * and a bottom outline, the drawer toggle at 16px/40px page margins, search on
 * the left, and on the right the notification bell, a hairline divider and the
 * account chip — avatar, name, chevron.
 *
 * The left slot holds the search box for a client, and the page's title for a
 * provider. Both are treatments the design uses; which one appears is decided by
 * whether Slotly can actually answer a search for that role. A provider's
 * bookings are filterable by status, service and date but are not text-indexed,
 * and there is no endpoint behind "search appointments, clients" — so rather
 * than render a box that swallows what is typed into it, the provider gets the
 * titled variant from the Messages screen.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationsContext";
import Avatar from "../ui/Avatar";
import Icon from "../ui/Icon";
import { zoneName } from "../../lib/ui";
import { DISCOVERY_ROUTE } from "../../lib/discovery";

export default function Topbar({ onOpenMenu, onLogout, title }) {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-16 flex-none items-center justify-between border-b border-outline-variant bg-surface/80 px-margin-mobile backdrop-blur-md md:px-margin-desktop">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="-ml-2 p-2 text-on-surface-variant md:hidden"
        >
          <Icon name="menu" size={24} />
        </button>

        {user?.role === "client" ? (
          <DiscoverySearch />
        ) : (
          title && (
            <h2 className="truncate font-h3 text-h3 font-semibold text-on-surface">{title}</h2>
          )
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex gap-2">
          <NotificationsMenu />
        </div>

        <div aria-hidden="true" className="mx-2 hidden h-6 w-px bg-outline-variant md:block" />

        <AccountMenu user={user} onLogout={onLogout} />
      </div>
    </header>
  );
}

/** Submits to the provider directory, which owns the actual search. */
function DiscoverySearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = term.trim();
    navigate(trimmed ? `${DISCOVERY_ROUTE}?q=${encodeURIComponent(trimmed)}` : DISCOVERY_ROUTE);
  };

  return (
    <form onSubmit={handleSubmit} role="search" className="relative hidden w-64 md:flex md:items-center">
      <label htmlFor="shell-search" className="sr-only">
        Search providers
      </label>
      <Icon
        name="search"
        size={18}
        className="pointer-events-none absolute left-3 text-on-surface-variant"
      />
      <input
        id="shell-search"
        type="text"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search providers, services, categories…"
        className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-2 pl-10 pr-4 font-body text-body outline-none transition-shadow focus:border-primary focus:ring-1 focus:ring-primary/10"
      />
    </form>
  );
}

/**
 * The bell.
 *
 * Everything in it is derived from data the app already holds — see
 * `NotificationsContext`. Nothing here is dismissible, because there is no
 * server-side read state to dismiss into; an entry disappears when the thing it
 * describes is fixed, which is the only honest behaviour available.
 */
function NotificationsMenu() {
  const { notices } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useDismissable(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={notices.length > 0 ? `Notifications (${notices.length})` : "Notifications"}
        className="relative rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
      >
        <Icon name="notifications" size={24} />
        {notices.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error"
          />
        )}
      </button>

      {/*
        The panel below uses two different anchors, because on a phone it is wider
        than the space to the left of the bell.

        The bell sits inboard of the account chip, so its right edge is ~110px
        short of the viewport's. Anchoring the panel's right edge to it while
        sizing the panel from the *viewport* (`calc(100vw-2rem)`) put its left edge
        at -76px on a 375px screen — the heading read "fications". Clamping the
        width harder would have stopped the clipping and left a 240px panel
        floating in the middle of the screen.

        So below `sm` it is anchored to the viewport instead: fixed, inset from
        both edges, sitting just under the 64px header. From `sm` up there is room
        to the left of the bell, and it goes back to being an ordinary dropdown
        hanging off the button.
      */}
      {open && (
        <div
          role="menu"
          className="fixed inset-x-4 top-[4.25rem] z-50 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-float sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem]"
        >
          <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
            <p className="font-small text-small font-semibold text-on-surface">Notifications</p>
            {notices.length > 0 && (
              <span className="font-caption text-caption text-on-surface-variant">
                {notices.length}
              </span>
            )}
          </div>

          {notices.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Icon name="check_circle" size={24} className="mx-auto text-on-surface-variant" />
              <p className="mt-2 font-small text-small font-semibold text-on-surface">
                You are all caught up
              </p>
              <p className="mt-1 font-caption text-caption text-on-surface-variant">
                Nothing needs your attention right now.
              </p>
            </div>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-outline-variant/30 overflow-y-auto">
              {notices.map((notice) => (
                <li key={notice.id}>
                  <Link
                    to={notice.to}
                    onClick={() => setOpen(false)}
                    className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-container-low"
                  >
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_CHIP[notice.tone]}`}
                    >
                      <Icon name={notice.icon} size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-small text-small font-semibold text-on-surface">
                        {notice.title}
                      </span>
                      <span className="mt-0.5 block font-caption text-caption text-on-surface-variant">
                        {notice.body}
                      </span>
                      <span className="mt-1.5 inline-flex items-center gap-1 font-caption text-caption font-semibold text-primary">
                        {notice.actionLabel}
                        <Icon name="arrow_forward" size={14} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const TONE_CHIP = {
  danger: "bg-error-container text-on-error-container",
  warn: "bg-surface-container-high text-on-surface-variant",
  info: "bg-surface-container-low text-on-surface-variant",
};

/**
 * The account chip and its menu.
 *
 * Sign-out is a rare, mildly destructive action, so it sits behind this rather
 * than in the open. The timezone is shown because it is the single setting that
 * makes every time in the app read correctly or incorrectly, and this is where a
 * user goes looking when a time surprises them.
 */
function AccountMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useDismissable(ref, open, () => setOpen(false));

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex cursor-pointer items-center gap-3 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-surface-container-high"
      >
        <Avatar
          src={user.avatar_url}
          name={user.name}
          size="sm"
          className="border border-outline-variant"
        />
        <span className="hidden max-w-[10rem] truncate font-small text-small font-semibold text-on-surface md:block">
          {user.name}
        </span>
        <Icon name="expand_more" size={20} className="hidden text-on-surface-variant md:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-float"
        >
          <div className="border-b border-outline-variant bg-surface-container-low px-4 py-3">
            <p className="truncate font-small text-small font-semibold text-on-surface">
              {user.name}
            </p>
            <p className="truncate font-caption text-caption text-on-surface-variant">
              {user.email}
            </p>
            {user.timezone && (
              <p className="mt-1.5 flex items-center gap-1.5 font-caption text-caption text-on-surface-variant">
                <Icon name="public" size={14} />
                <span className="truncate">{zoneName(user.timezone)}</span>
              </p>
            )}
          </div>

          <div className="p-1.5">
            <MenuLink to="/profile" icon="person" label="Profile" onNavigate={() => setOpen(false)} />
            <MenuLink
              to="/settings"
              icon="settings"
              label="Settings"
              onNavigate={() => setOpen(false)}
            />
            {user.role === "provider" && (
              <MenuLink
                to={`/providers/${user.id}`}
                icon="open_in_new"
                label="View public page"
                onNavigate={() => setOpen(false)}
              />
            )}
          </div>

          <div className="border-t border-outline-variant p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-left font-small text-small text-on-error-container transition-colors hover:bg-error-container"
            >
              <Icon name="logout" size={18} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, icon, label, onNavigate }) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 font-small text-small text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
    >
      <Icon name={icon} size={18} />
      {label}
    </Link>
  );
}

/**
 * Closes a popover on an outside click or Escape.
 *
 * Registered only while open, so the app is not carrying two document-level
 * listeners for menus nobody has opened.
 */
function useDismissable(ref, open, onClose) {
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
  }, [ref, open, onClose]);
}

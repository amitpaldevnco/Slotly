/**
 * The four ways this app tells a user that something is other than normal:
 * an alert, an empty state, and two skeleton placeholders.
 *
 * Collected in one file because they are the states most easily forgotten while
 * building the happy path, and having them close together makes it obvious when
 * a screen has a loading state but no empty one.
 */
import { Link } from "react-router-dom";
import Icon from "./Icon";
import { cardClasses, secondaryButton, primaryButton, buttonSm } from "../../lib/ui";

// Alerts


const ALERT_TONES = {
  error: { className: "border-danger-line bg-danger-soft text-danger-ink", icon: "alert" },
  warn: { className: "border-warn-line bg-warn-soft text-warn-ink", icon: "info" },
  success: { className: "border-success-line bg-success-soft text-success-ink", icon: "checkCircle" },
  info: { className: "border-line bg-subtle text-ink-2", icon: "info" },
};


export function Alert({ tone = "info", title, children, action, className = "" }) {
  const variant = ALERT_TONES[tone] || ALERT_TONES.info;

  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-4 py-3 text-sm ${variant.className} ${className}`}
    >
      <Icon name={variant.icon} size={17} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && (
          <p className={`leading-relaxed ${title ? "mt-1 text-[0.8125rem]" : ""}`}>{children}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// Empty


export default function EmptyState({
  icon = "inbox",
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  compact = false,
  className = "",
}) {
  const body = (
    <>
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-ink-3">
        <Icon name={icon} size={22} />
      </span>

      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-[44ch] text-sm leading-relaxed text-ink-2">{description}</p>
      )}

      {actionLabel && actionTo && (
        <Link to={actionTo} className={`mt-5 ${primaryButton} ${buttonSm}`}>
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionTo && onAction && (
        <button type="button" onClick={onAction} className={`mt-5 ${secondaryButton} ${buttonSm}`}>
          {actionLabel}
        </button>
      )}
    </>
  );

  if (compact) {
    return (
      <div className={`flex flex-col items-center px-4 py-10 text-center ${className}`}>{body}</div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center rounded-lg border border-line bg-surface px-4 py-14 text-center ${className}`}
    >
      {body}
    </div>
  );
}

//Error

/**
 * @param {object} props
 * @param {string} [props.title] Overrides the default heading. Worth setting
 *   whenever the failure has a name: a mistyped service id produced
 *   "Something went wrong / Service not found for this provider", where the
 *   heading contradicted the message it sat above — one says the app broke, the
 *   other says the link is wrong.
 */
export function ErrorState({
  message,
  title = "Something went wrong",
  onRetry,
  children,
  bare = false,
  className = "",
}) {
  return (
    <div className={`${bare ? "" : cardClasses} px-4 py-12 text-center ${className}`}>
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger-ink">
        <Icon name="alert" size={22} />
      </span>

      <p className="font-display text-base font-semibold text-ink">{title}</p>
      <p role="alert" className="mx-auto mt-1.5 max-w-[48ch] text-sm leading-relaxed text-ink-2">
        {message}
      </p>

      {(onRetry || children) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <button type="button" onClick={onRetry} className={`${secondaryButton} ${buttonSm}`}>
              <Icon name="refresh" size={14} />
              Try again
            </button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
 * Loading
 *
 * Three situations, one answer each. Screens across the app had been picking
 * differently for the same situation — some drew a skeleton, some a spinner, and
 * nine fetches drew nothing at all and let the content appear from nowhere. Three
 * of those nine rendered an *empty state* while the request was in flight, so the
 * screen actively said there was nothing there and then contradicted itself.
 *
 *   1. **A whole page, first load** → `PageLoader`, with a label naming what is
 *      being fetched. One centred spinner for the whole route.
 *
 *   2. **A panel or list inside a page that is already drawn** → `SkeletonRows`,
 *      with the `variant` that matches the shape of what will land there. The
 *      page frame, its heading and its navigation stay put; only the part that is
 *      still unknown is a placeholder.
 *
 *   3. **Content already on screen, being re-fetched** → `Refreshing`. The
 *      content stays and dims. Never a skeleton: replacing a list the reader is
 *      looking at with grey bars loses their place and reads as though the data
 *      was thrown away. This needs `keepPreviousData: true` on the resource, or
 *      `loading` fires again and situation 2 wins by accident.
 *
 * And one prohibition: **never render an empty state while a request is in
 * flight.** "No providers listed yet" and "You are all caught up" are answers,
 * and a screen that gives the wrong answer confidently is worse than one that
 * admits it does not know yet.
 * ========================================================================== */

export function PageLoader({ label = "Loading…" }) {
  return (
    <div role="status" className="flex min-h-[40vh] flex-col items-center justify-center gap-2.5">
      <Spinner size={22} />
      <p className="text-sm text-ink-3">{label}</p>
    </div>
  );
}

/**
 * Content that is on screen and being replaced by a newer version of itself.
 *
 * Situation 3 above. Dims what is there and marks the region `aria-busy`, so a
 * reader keeps their place and a screen reader is told the region is in flux
 * rather than being read a list that is about to change underneath it.
 *
 * Extracted because three screens had each written their own version of this and
 * no two agreed — two different opacities, and one of them wired to a flag that
 * could never become true. A fourth, fifth and sixth screen wanted it and reset
 * to a skeleton instead.
 */
export function Refreshing({ active, children, className = "", ...rest }) {
  return (
    <div
      {...rest}
      aria-busy={active || undefined}
      className={`transition-opacity duration-150 motion-reduce:transition-none ${
        active ? "opacity-55" : "opacity-100"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** The one spinner. Sized to sit inside a button, a row, or on its own. */
export function Spinner({ size = 16, className = "" }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 9)) }}
      className={`inline-block animate-spin rounded-full border-line border-t-brand motion-reduce:animate-none ${className}`}
    />
  );
}


export function SkeletonBlock({ className = "h-5 w-20" }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded bg-line/70 motion-reduce:animate-none ${className}`}
    />
  );
}


/**
 * A placeholder shaped like the content that is coming.
 *
 * `role="status"` on the container, with the individual bars left
 * `aria-hidden`. The whole thing used to be `aria-hidden`, which made every
 * skeleton in the app completely silent — a screen reader was told nothing at
 * all between navigating to a page and its content arriving, and `PageLoader`
 * was the only loading state in the codebase that announced itself.
 *
 * @param {string} label What is loading. Worth setting whenever a screen has
 *   more than one of these, so the announcement says which panel rather than
 *   "Loading…" three times.
 */
export function SkeletonRows({ count = 3, variant = "row", className = "", label = "Loading…" }) {
  return (
    <div role="status" aria-label={label} className={`space-y-2 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonItem key={i} variant={variant} />
      ))}
    </div>
  );
}

function SkeletonItem({ variant }) {
  if (variant === "line") {
    return (
      <div className="flex items-center gap-3 py-2">
        <SkeletonBlock className="h-3.5 w-14" />
        <SkeletonBlock className="h-3.5 flex-1" />
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className="flex items-center gap-3 border-b border-line-soft px-3 py-3 last:border-0">
        <SkeletonBlock className="h-3.5 w-28" />
        <SkeletonBlock className="h-3.5 flex-1" />
        <SkeletonBlock className="h-3.5 w-16" />
        <SkeletonBlock className="h-4 w-16 rounded-full" />
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div className={`${cardClasses} p-4`}>
        <SkeletonBlock className="h-28 w-full rounded-md" />
        <SkeletonBlock className="mt-3 h-4 w-2/5" />
        <SkeletonBlock className="mt-2 h-3 w-4/5" />
      </div>
    );
  }

  return (
    <div className={`${cardClasses} flex items-center gap-3 p-4`}>
      <SkeletonBlock className="h-9 w-9 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonBlock className="h-3.5 w-2/5" />
        <SkeletonBlock className="h-3 w-3/5" />
      </div>
      <SkeletonBlock className="h-4 w-16 rounded-full" />
    </div>
  );
}

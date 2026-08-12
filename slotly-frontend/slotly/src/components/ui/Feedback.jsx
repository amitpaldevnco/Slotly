
import { Link } from "react-router-dom";
import Icon from "./Icon";
import { cardClasses, secondaryButton, primaryButton, buttonSm } from "../../lib/ui";

// Alerts


const ALERT_TONES = {
  error: { className: "border-danger-line bg-danger-soft text-danger-ink", icon: "alert" },
  warn: { className: "border-warn-line bg-warn-soft text-warn-ink", icon: "info" },
  success: { className: "border-brand-line bg-brand-soft text-brand-ink", icon: "check" },
  info: { className: "border-line bg-subtle text-ink-2", icon: "info" },
};


export function Alert({ tone = "info", title, children, action, className = "" }) {
  const variant = ALERT_TONES[tone] || ALERT_TONES.info;

  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-3.5 py-2.5 text-sm ${variant.className} ${className}`}
    >
      <Icon name={variant.icon} size={16} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <p className={`leading-relaxed ${title ? "mt-0.5 text-[0.8125rem]" : ""}`}>{children}</p>}
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
      <span className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas text-ink-3">
        <Icon name={icon} size={17} />
      </span>

      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && (
        <p className="mt-1 max-w-[44ch] text-[0.8125rem] leading-relaxed text-ink-2">{description}</p>
      )}

      {actionLabel && actionTo && (
        <Link to={actionTo} className={`mt-4 ${primaryButton} ${buttonSm}`}>
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionTo && onAction && (
        <button type="button" onClick={onAction} className={`mt-4 ${secondaryButton} ${buttonSm}`}>
          {actionLabel}
        </button>
      )}
    </>
  );

  if (compact) {
    return (
      <div className={`flex flex-col items-center px-4 py-8 text-center ${className}`}>{body}</div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center rounded-lg border border-dashed border-line bg-surface/60 px-4 py-10 text-center ${className}`}
    >
      {body}
    </div>
  );
}

//Error

export function ErrorState({ message, onRetry, children, bare = false, className = "" }) {
  return (
    <div className={`${bare ? "" : cardClasses} px-4 py-8 text-center ${className}`}>
      <span className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-full border border-danger-line bg-danger-soft text-danger-ink">
        <Icon name="alert" size={17} />
      </span>

      <p className="text-sm font-semibold text-ink">Something went wrong</p>
      <p role="alert" className="mx-auto mt-1 max-w-[48ch] text-[0.8125rem] leading-relaxed text-ink-2">
        {message}
      </p>

      {(onRetry || children) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
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

// Loading

export function PageLoader({ label = "Loading…" }) {
  return (
    <div role="status" className="flex min-h-[40vh] flex-col items-center justify-center gap-2.5">
      <Spinner size={22} />
      <p className="text-sm text-ink-3">{label}</p>
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


export function SkeletonRows({ count = 3, variant = "row", className = "" }) {
  return (
    <div aria-hidden="true" className={`space-y-2 ${className}`}>
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

// Page scaffolding.

import { container, pagePad, h1, subtle, prose } from "../../lib/ui";

export default function Page({ children, narrow = false, className = "" }) {
  return (
    <div className={`${container} ${pagePad} ${className}`}>
      {narrow ? <div className="mx-auto w-full max-w-[720px]">{children}</div> : children}
    </div>
  );
}


export function PageHeader({ title, description, actions, meta, back, className = "" }) {
  return (
    <header className={`mb-5 ${className}`}>
      {back && <div className="mb-2.5">{back}</div>}

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className={h1}>{title}</h1>
            {meta}
          </div>
          {description && <p className={`mt-1 ${subtle} ${prose}`}>{description}</p>}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

// A titled panel: the card-with-tinted-header pattern that five components had each implemented separately.
 
export function Section({
  title,
  description,
  actions,
  children,
  flush = false,
  tone = "default",
  className = "",
  headingId,
  ...rest
}) {
  const brand = tone === "brand";

  return (
    <section
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-lg border bg-surface ${
        brand ? "border-brand-line" : "border-line"
      } ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-2.5 ${
            brand ? "border-brand-line bg-brand-soft" : "border-line bg-subtle"
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h2
                id={headingId}
                className={`text-sm font-semibold ${brand ? "text-brand-ink" : "text-ink"}`}
              >
                {title}
              </h2>
            )}
            {description && (
              <p className={`mt-0.5 text-xs ${brand ? "text-brand-ink/85" : "text-ink-3"}`}>
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}

      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

/**
 * A horizontal strip of controls above a list or table — filters, a search box,
 * a view switch. Scrolls sideways on a phone rather than wrapping into a tall
 * stack that pushes the actual content off the screen.
 */
export function Toolbar({ children, className = "" }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The two-column app layout: content, then a sidebar of secondary information.
 *
 * This is the piece that puts the width to work. The sidebar drops below the
 * content on anything under `lg`, and its order is set in the markup rather than
 * with `order-*` so the reading order and the DOM order match — a screen reader
 * and a phone both get the main content first.
 */
export function SplitLayout({ children, aside, className = "" }) {
  return (
    <div className={`grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] ${className}`}>
      <div className="min-w-0 space-y-5">{children}</div>
      {aside && <aside className="min-w-0 space-y-4 lg:sticky lg:top-[4.75rem]">{aside}</aside>}
    </div>
  );
}

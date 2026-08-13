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
 
/** Heading treatments a Section can take. Keyed by the `tone` prop. */
const TONES = {
  default: {
    border: "border-line",
    header: "border-line bg-subtle",
    title: "text-ink",
    description: "text-ink-3",
  },
  brand: {
    border: "border-brand-line",
    header: "border-brand-line bg-brand-soft",
    title: "text-brand-ink",
    description: "text-brand-ink/85",
  },
  warn: {
    border: "border-warn-line",
    header: "border-warn-line bg-warn-soft",
    title: "text-warn-ink",
    description: "text-warn-ink/85",
  },
};

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
  // `warn` exists for panels that report something the user has to act on, so
  // the heading carries the same colour language as an Alert rather than
  // looking like one more neutral card among the others.
  const toneStyles = TONES[tone] || TONES.default;

  return (
    <section
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-lg border bg-surface ${toneStyles.border} ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-2.5 ${toneStyles.header}`}
        >
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className={`text-sm font-semibold ${toneStyles.title}`}>
                {title}
              </h2>
            )}
            {description && (
              <p className={`mt-0.5 text-xs ${toneStyles.description}`}>{description}</p>
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
 * a view switch. Wraps onto more lines rather than overflowing sideways, so a
 * narrow screen never gets a horizontal scrollbar.
 *
 * `stack` turns it into a single full-width column below `sm` and restores the
 * row above it. Wrapping alone is enough when the controls are small, but a
 * search box next to two dropdowns has more intrinsic width than a 320px phone
 * has room for: the items then wrap to one per line anyway, at inconsistent
 * widths, with the gaps landing in odd places. Stacking asks for that outcome
 * deliberately and makes every control the same full width.
 *
 * @param {boolean} [stack] Stack vertically below the `sm` breakpoint.
 */
export function Toolbar({ children, stack = false, className = "" }) {
  const layout = stack
    ? "flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center"
    : "flex flex-wrap items-center gap-2";

  return (
    <div className={`${layout} rounded-lg border border-line bg-surface px-3 py-2.5 ${className}`}>
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

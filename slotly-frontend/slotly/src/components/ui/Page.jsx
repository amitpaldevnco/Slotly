// Page scaffolding.

import { container, pagePad, h1, subtle, prose } from "../../lib/ui";

export default function Page({ children, narrow = false, className = "" }) {
  return (
    <div className={`${container} ${pagePad} ${className}`}>
      {narrow ? <div className="mx-auto w-full max-w-[760px]">{children}</div> : children}
    </div>
  );
}

/**
 * The block at the top of a page: title, one line of context, and the actions
 * that belong to the page as a whole.
 *
 * The title is the design's 40px display heading, which is a lot of ink — so it
 * gets a lot of air beneath it (`mb-8`) rather than being crowded by the first
 * card.
 */
export function PageHeader({ title, description, actions, meta, back, className = "" }) {
  return (
    <header className={`mb-6 lg:mb-8 ${className}`}>
      {back && <div className="mb-4">{back}</div>}

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className={h1}>{title}</h1>
            {meta}
          </div>
          {description && <p className={`mt-2 ${subtle} ${prose}`}>{description}</p>}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/* ==========================================================================
 * Section — a titled panel
 *
 * The card-with-a-title pattern that five components had each implemented
 * separately. The design puts the title inside the card above a hairline rather
 * than in a tinted strip on top of it, which is what this now does.
 * ========================================================================== */

/** Heading treatments a Section can take. Keyed by the `tone` prop. */
const TONES = {
  default: {
    border: "border-line",
    header: "border-line",
    title: "text-ink",
    description: "text-ink-3",
  },
  brand: {
    border: "border-line",
    header: "border-line",
    title: "text-ink",
    description: "text-ink-3",
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
  // the heading carries the same colour language as an Alert rather than looking
  // like one more neutral card among the others.
  const toneStyles = TONES[tone] || TONES.default;

  return (
    <section
      aria-labelledby={headingId}
      className={`overflow-hidden rounded-lg border bg-surface ${toneStyles.border} ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-4 ${toneStyles.header}`}
        >
          <div className="min-w-0">
            {title && (
              <h2
                id={headingId}
                className={`font-display text-[0.9375rem] font-semibold ${toneStyles.title}`}
              >
                {title}
              </h2>
            )}
            {description && (
              <p className={`mt-1 text-xs leading-relaxed ${toneStyles.description}`}>
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}

      <div className={flush ? "" : "p-5"}>{children}</div>
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
    ? "flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center"
    : "flex flex-wrap items-center gap-3";

  return (
    <div className={`${layout} rounded-lg border border-line bg-surface p-4 ${className}`}>
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
 *
 * The sticky offset is the top bar's height plus the page's own top padding, so
 * a stuck aside lands just under the bar rather than behind it.
 */
export function SplitLayout({ children, aside, className = "" }) {
  return (
    <div className={`grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] ${className}`}>
      <div className="min-w-0 space-y-6">{children}</div>
      {aside && (
        <aside className="min-w-0 space-y-6 lg:sticky lg:top-[calc(var(--spacing-topbar)+1.5rem)]">
          {aside}
        </aside>
      )}
    </div>
  );
}

/**
 * The in-page section navigation the design gives Profile and Settings: a
 * sticky column of anchors on the left, the sections on the right.
 *
 * Anchor links rather than tabs, because every section is part of one form and
 * hiding half of it behind a tab means a user can submit changes they can no
 * longer see. `scroll-mt` on each target keeps the sticky top bar from covering
 * the heading it just jumped to.
 */
export function SectionNav({ items, active, className = "" }) {
  return (
    <nav
      aria-label="Sections"
      className={`hidden lg:sticky lg:top-[calc(var(--spacing-topbar)+1.5rem)] lg:block ${className}`}
    >
      <ul className="space-y-1">
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={isActive ? "true" : undefined}
                className={`block border-l-2 px-4 py-2.5 text-sm transition ${
                  isActive
                    ? "border-brand bg-surface font-semibold text-ink"
                    : "border-transparent text-ink-2 hover:bg-subtle hover:text-ink"
                }`}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

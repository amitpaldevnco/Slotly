//The shared class vocabulary.
 //Layout

export const container = "mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8";

// Vertical rhythm for a page's content area. Compact, and the same everywhere. 
export const pagePad = "py-6 sm:py-8";

/**
 * The reading measure for body copy that is not in a card — a page description,
 * an explanatory paragraph. Applied to the text, never to the layout.
 */
export const prose = "max-w-[68ch]";

//   Type scale


export const h1 = "text-xl font-semibold tracking-tight text-ink sm:text-[1.375rem]";
export const h2 = "text-base font-semibold tracking-tight text-ink";
export const h3 = "text-sm font-semibold text-ink";

/** The small caps label used above a group of fields or a panel section. */
export const eyebrow = "text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3";

/** One-line supporting copy under a heading. */
export const subtle = "text-sm text-ink-2";

/** The smallest supporting text: hints, captions, timestamps. */
export const caption = "text-xs text-ink-3";

// Emphasis
 

/** The single most important number on a screen. Use once. */
export const metricLg =
  "text-2xl font-bold tracking-tight tabular-nums text-ink sm:text-[1.75rem]";

/** A key value: a price, a total, a count. Reads as data, not prose. */
export const metric = "text-base font-semibold tabular-nums text-ink";

/** A key value inside a dense row or a definition list. */
export const metricSm = "text-[0.8125rem] font-semibold tabular-nums text-ink";


export const highlightPill =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-highlight-line " +
  "bg-highlight px-2 py-0.5 text-xs font-semibold text-highlight-ink";

/** The same emphasis without the chip, for a value inline in a sentence. */
export const highlightText = "font-semibold text-brand";

/**
 * The one row in a list that is next or current.
 *
 * A tinted background plus a left edge, because in a list of otherwise identical
 * rows a tint alone is easy to miss on a bright screen and an edge alone reads as
 * a decoration.
 *
 * `border-l-brand` rather than `border-brand`: these are applied on top of
 * components that already have a border colour of their own, and the unscoped
 * version sets all four sides. Which one won would then depend on the order the
 * two utilities happen to appear in the compiled stylesheet, not on the order
 * they are written in the class attribute.
 */
export const emphasisRow = "border-l-2 border-l-brand bg-highlight/45";

/** A left accent edge for the panel that answers why the user came. */
export const accentEdge = "border-l-2 border-l-brand";

 // Form controls

/**
 * Every text input, textarea and select in the app.
 *
 * `text-base sm:text-sm` is not a styling preference — it is a mobile bug fix.
 * Safari on iOS zooms the whole page in when a form control smaller than 16px
 * receives focus, and does not zoom back out. At a flat `text-sm` (14px) every
 * input did that: tapping a time field on the availability page left the
 * provider pinched in and scrolling sideways to reach the next one. 16px on
 * phones is the documented threshold that suppresses it; from `sm` up the denser
 * 14px returns, where no such behaviour exists.
 */
export const inputClasses =
  "block w-full min-h-11 rounded-md border border-line bg-surface px-3 py-2 text-base text-ink " +
  "shadow-[inset_0_1px_0_rgb(15_23_42_/_0.02)] transition " +
  "placeholder:text-ink-3 outline-none " +
  "focus:border-brand focus:ring-[3px] focus:ring-brand/15 " +
  "disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-3 " +
  "aria-[invalid=true]:border-danger-line aria-[invalid=true]:focus:ring-danger/15 " +
  "sm:min-h-9 sm:py-1.5 sm:text-sm";

/**
 * A select.
 *
 * The native arrow is suppressed and redrawn by the `Select` component in
 * `components/ui/Field`, because the platform's own is a different shape and
 * weight on every OS — which is exactly the kind of drift the rest of this file
 * exists to prevent. `pr-9` reserves the space for it.
 */
export const selectClasses = `${inputClasses} appearance-none pr-9`;

/** A textarea should not inherit the single-line control's min-height. */
export const textareaClasses = `${inputClasses} min-h-0 py-2 leading-relaxed sm:min-h-0 sm:py-2`;

export const labelClasses = "mb-1.5 block text-xs font-medium text-ink";

/** The hint under a field. Sits between the input and any error. */
export const hintClasses = "mt-1.5 text-xs text-ink-3";

export const fieldErrorClasses = "mt-1.5 flex items-start gap-1 text-xs text-danger";

/** The file input's native button, styled to match the secondary button. */
export const fileInputClasses =
  "block w-full cursor-pointer text-sm text-ink-2 " +
  "file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface " +
  "file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink file:transition hover:file:bg-canvas";

 //Buttons

/** Shared by every button variant: geometry, focus, disabled. */
const buttonBase =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm  cursor-pointer" +
  "font-medium whitespace-nowrap transition select-none " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-55 sm:min-h-9";

export const primaryButton =
  `${buttonBase} bg-brand text-white shadow-raise hover:bg-brand-strong ` +
  "active:bg-brand-strong focus-visible:outline-brand";

export const secondaryButton =
  `${buttonBase} border border-line bg-surface text-ink shadow-raise ` +
  "hover:border-ink-3/40 hover:bg-canvas focus-visible:outline-brand";

export const dangerButton =
  `${buttonBase} border border-danger-line bg-surface text-danger-ink ` +
  "hover:bg-danger-soft focus-visible:outline-danger";

export const ghostButton =
  `${buttonBase} text-ink-2 hover:bg-canvas hover:text-ink focus-visible:outline-brand`;

/**
 * Size modifiers, appended to a variant.
 *
 * `buttonSm` is for a control inside a card header or a table row, where a 36px
 * button next to 13px text is out of proportion. It keeps the 44px floor on
 * touch, because a thumb does not care that the row is dense.
 */
export const buttonSm = "px-2.5 text-[0.8125rem] sm:min-h-8  cursor-pointer";
export const buttonLg = "min-h-12 px-5 text-[0.9375rem] sm:min-h-11  cursor-pointer";
export const buttonBlock = "w-full  cursor-pointer";

/** A square icon-only button. Pass an `aria-label`. */
export const iconButton =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-3 transition " +
  "hover:bg-canvas hover:text-ink focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50";

/** Same, sized for a thumb. Used where the icon button is a primary route. */
export const iconButtonTouch = `${iconButton} h-11 w-11 sm:h-9 sm:w-9`;

/** A text link inside body copy. */
export const linkClasses =
  "font-medium text-brand underline decoration-brand/35 underline-offset-2 transition  cursor-pointer" +
  "hover:decoration-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-brand rounded-sm  cursor-pointer";

/* ==========================================================================
 * Containers
 * ========================================================================== */

/** The default panel. Everything that groups content sits on one of these. */
export const cardClasses = "rounded-lg border border-line bg-surface";

/** A card that is also a link or a button. */
export const cardInteractive =
  `${cardClasses} transition hover:border-brand-line hover:shadow-raise ` +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand  cursor-pointer";

/** The tinted strip at the top of a panel. Paired with `cardClasses` + `overflow-hidden`. */
export const cardHeader =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-subtle px-4 py-2.5";

/** Standard body padding for a panel. */
export const cardBody = "p-4 sm:p-5";

/** An inset panel: a form inside a card, a quoted reply, a summary block. */
export const insetClasses = "rounded-md border border-line bg-subtle p-3.5";

/** A tinted informational panel — timezone notices, owner banners. */
export const noticeClasses =
  "rounded-md border border-brand-line bg-brand-soft px-3.5 py-2.5 text-sm text-brand-ink";

/* ==========================================================================
 * Badges
 * ========================================================================== */

const badgeBase =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium";

export const badgeVariants = {
  neutral: `${badgeBase} border-line bg-canvas text-ink-2`,
  brand: `${badgeBase} border-brand-line bg-brand-soft text-brand-ink`,
  danger: `${badgeBase} border-danger-line bg-danger-soft text-danger-ink`,
  warn: `${badgeBase} border-warn-line bg-warn-soft text-warn-ink`,
  info: `${badgeBase} border-info-line bg-info-soft text-info-ink`,
};

/** An untinted pill for a category or a count. */
export const chipClasses =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-xs text-ink-2";

/* ==========================================================================
 * Table
 * ========================================================================== */

/**
 * Tables are compact by construction: 12px uppercase headers, 40px rows, and
 * borders only between rows. The alternative — a card per record — turned forty
 * bookings into five thousand pixels of scroll.
 */
export const tableClasses = "w-full border-collapse text-sm";

export const theadClasses = "border-b border-line bg-subtle";

export const thClasses =
  "px-3 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3 whitespace-nowrap";

export const tdClasses = "px-3 py-2.5 align-middle text-ink-2";

export const trClasses = "border-b border-line-soft last:border-0 transition hover:bg-subtle";

/* ==========================================================================
 * Booking status
 * ========================================================================== */

/**
 * Visual treatment per booking status.
 *
 * Colour alone never carries the meaning — every badge prints its label too — so
 * this stays readable for anyone who cannot distinguish the hues. `dot` is the
 * solid version, used where a full badge would not fit (a table's leading
 * column, a timeline node).
 */
export const STATUS_STYLES = {
  booked: { label: "Booked", variant: "brand", dot: "bg-status-booked" },
  rescheduled: { label: "Rescheduled", variant: "warn", dot: "bg-status-rescheduled" },
  cancelled: { label: "Cancelled", variant: "danger", dot: "bg-status-cancelled" },
  completed: { label: "Completed", variant: "info", dot: "bg-status-completed" },
  no_show: { label: "No-show", variant: "neutral", dot: "bg-status-no_show" },
};

/** Falls back to a neutral badge rather than crashing on an unexpected status. */
export function statusStyle(status) {
  const found = STATUS_STYLES[status];
  if (found) return { ...found, className: badgeVariants[found.variant] };

  return {
    label: String(status || "unknown").replace(/_/g, " "),
    variant: "neutral",
    dot: "bg-ink-3",
    className: badgeVariants.neutral,
  };
}

/* ==========================================================================
 * Formatters
 * ========================================================================== */

/** Formats a price for display. Prices arrive from PostgreSQL NUMERIC as strings. */
export function formatPrice(value, currencySymbol = "₹") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${currencySymbol}${number.toLocaleString(undefined, {
    minimumFractionDigits: number % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "1h 30m", "45m" — durations read better than a bare minute count. */
export function formatDuration(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total)) return "—";

  const hours = Math.floor(total / 60);
  const mins = total % 60;

  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** Drops the underscores IANA zone names carry, for display only. */
export function zoneName(timezone) {
  return String(timezone || "UTC").replace(/_/g, " ");
}

/** Joins the parts of a metadata line, skipping anything absent. */
export function metaLine(...parts) {
  return parts.filter(Boolean).join(" · ");
}

/**
 * The shared class vocabulary.
 *
 * Every recurring surface, control and piece of type is named here once, and
 * every string is transcribed from the Stitch design's own markup — the button
 * geometry from its buttons, the input's focus ring from its inputs, the badge's
 * 10px uppercase from its badges. Components import a name; they never spell out
 * a colour, a radius or a focus ring.
 */

/* ==========================================================================
 * Layout
 * ========================================================================== */

/** The design's 1280px column with its 16px/40px page margins. */
export const container =
  "mx-auto w-full max-w-container-max-width px-margin-mobile md:px-margin-desktop";

/** Vertical rhythm for a page's content area. The same everywhere. */
export const pagePad = "py-margin-mobile md:py-margin-desktop";

/**
 * The reading measure for body copy that is not in a card — a page description,
 * an explanatory paragraph. Applied to the text, never to the layout.
 */
export const prose = "max-w-[68ch]";

/* ==========================================================================
 * Type scale
 *
 * The design's steps carry their own size, line height, tracking and weight, so
 * `text-h1` is the whole treatment; these constants only add the family and the
 * colour, and the responsive step-down where a desktop size will not fit a
 * phone.
 * ========================================================================== */

/** The page title. 32px on a phone, 40px from `md`. One per screen. */
export const h1 =
  "font-h1-mobile text-h1-mobile md:font-h1 md:text-h1 text-on-surface";

/** A section title above a card. */
export const h2 = "font-h2 text-h2 text-on-surface";

/** A card title. */
export const h3 = "font-h3 text-h3 text-on-surface";

/** The small caps label above a group of fields or a panel section. */
export const eyebrow =
  "font-caption text-caption uppercase tracking-wider font-bold text-on-surface-variant";

/** One-line supporting copy under a heading. */
export const subtle = "font-body text-body text-on-surface-variant";

/** The smallest supporting text: hints, captions, timestamps. */
export const caption = "font-caption text-caption text-on-surface-variant";

/* ==========================================================================
 * Emphasis
 * ========================================================================== */

/** The single most important number on a screen. Use once. */
export const metricLg = "font-h2 text-h2 text-primary tabular-nums";

/** A key value: a price, a total, a count. Reads as data, not prose. */
export const metric = "font-small text-small font-semibold tabular-nums text-on-surface";

/** A key value inside a dense row or a definition list. */
export const metricSm = "font-caption text-caption font-bold tabular-nums text-on-surface";

/**
 * The chip on the one thing that is next or current — the design's "Up Next".
 * Uppercase and bold at 10px; the emphasis comes from the letterform, because
 * the palette has no colour to spend on it.
 */
export const highlightPill =
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-3 py-1 " +
  "font-caption text-[10px] font-bold uppercase tracking-wider text-primary";

/** The same emphasis without the chip, for a value inline in a sentence. */
export const highlightText = "font-semibold text-primary";

/**
 * The one row in a list that is next or current: a 4px left bar over a 5% tint,
 * exactly as the design draws its "confirmed, active" appointment.
 *
 * `border-l-primary` rather than `border-primary`: these are applied on top of
 * components that already have a border colour of their own, and the unscoped
 * version sets all four sides. Which one won would then depend on the order the
 * two utilities happen to appear in the compiled stylesheet, not on the order
 * they are written in the class attribute.
 */
export const emphasisRow = "border-l-4 border-l-primary bg-primary/5";

/** A left accent edge for the panel that answers why the user came. */
export const accentEdge = "border-l-4 border-l-primary";

/* ==========================================================================
 * Form controls
 * ========================================================================== */

/**
 * Every text input, textarea and select in the app.
 *
 * `text-base sm:text-small` is not a styling preference — it is a mobile bug
 * fix. Safari on iOS zooms the whole page in when a form control smaller than
 * 16px receives focus, and does not zoom back out. 16px on phones is the
 * documented threshold that suppresses it; from `sm` up the design's 14px
 * returns, where no such behaviour exists.
 *
 * The focus treatment is the design's: the border goes to the primary and a 2px
 * ring at 10% opacity appears outside it.
 */
export const inputClasses =
  "block w-full min-h-11 rounded-md border border-outline-variant bg-surface-container-lowest " +
  "px-3 py-2.5 font-body text-base text-on-surface transition-all outline-none " +
  "placeholder:text-outline " +
  "focus:border-primary focus:ring-2 focus:ring-primary/10 " +
  "disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-outline " +
  "aria-[invalid=true]:border-error aria-[invalid=true]:focus:ring-error/15 " +
  "sm:min-h-10 sm:text-small";

/**
 * A select.
 *
 * The native arrow is suppressed and redrawn by the `Select` component in
 * `components/ui/Field`, because the platform's own is a different shape and
 * weight on every OS — which is exactly the kind of drift this file exists to
 * prevent. `pr-10` reserves the space for it.
 */
export const selectClasses = `${inputClasses} appearance-none pr-10 cursor-pointer`;

/** A textarea should not inherit the single-line control's min-height. */
export const textareaClasses = `${inputClasses} min-h-0 py-3 leading-relaxed sm:min-h-0 sm:py-3`;

/** Labels sit above the field, in `small` type at weight 500. */
export const labelClasses = "mb-2 block font-small text-small text-on-surface";

/** The hint under a field. Sits between the input and any error. */
export const hintClasses = "mt-2 font-caption text-caption text-on-surface-variant";

export const fieldErrorClasses = "mt-2 flex items-start gap-1.5 font-caption text-caption text-error";

/** The file input's native button, styled to match the secondary button. */
export const fileInputClasses =
  "block w-full cursor-pointer font-small text-small text-on-surface-variant " +
  "file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-outline-variant " +
  "file:bg-surface file:px-4 file:py-2 file:font-small file:text-small file:text-on-surface " +
  "file:transition-colors hover:file:bg-surface-container-low";

/* ==========================================================================
 * Buttons
 *
 * The design's standard height is 40px; the large variant used for page CTAs is
 * 48px. On touch the floor stays 44px regardless, because a thumb does not care
 * that a table row is dense.
 * ========================================================================== */

/** Shared by every button variant: geometry, focus, disabled. */
const buttonBase =
  "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md " +
  "px-6 font-small text-small whitespace-nowrap transition-colors select-none " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10";

export const primaryButton =
  `${buttonBase} bg-primary text-on-primary hover:bg-primary/90 ` +
  "active:bg-primary focus-visible:outline-primary";

export const secondaryButton =
  `${buttonBase} border border-outline-variant bg-surface text-primary ` +
  "hover:bg-surface-container-low focus-visible:outline-primary";

export const dangerButton =
  `${buttonBase} border border-error/30 bg-surface text-on-error-container ` +
  "hover:bg-error-container focus-visible:outline-error";

export const ghostButton =
  `${buttonBase} text-on-surface-variant hover:bg-surface-container-low hover:text-primary ` +
  "focus-visible:outline-primary";

/**
 * Size modifiers, appended to a variant.
 *
 * `buttonSm` is for a control inside a card header or a table row, where a 40px
 * button next to 14px text is out of proportion.
 */
export const buttonSm = "px-4 sm:min-h-9";
export const buttonLg = "min-h-12 px-8 sm:min-h-12";
export const buttonBlock = "w-full";

/** A square icon-only button. Pass an `aria-label`. */
export const iconButton =
  "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full " +
  "text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary disabled:opacity-50";

/** Same, sized for a thumb. Used where the icon button is a primary route. */
export const iconButtonTouch = `${iconButton} h-11 w-11 sm:h-10 sm:w-10`;

/** A bordered icon button, as the design draws the row-level actions. */
export const iconButtonOutlined =
  "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md " +
  "border border-outline-variant text-on-surface-variant transition-colors " +
  "hover:bg-surface-container-low hover:text-primary focus-visible:outline " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** A text link inside body copy. */
export const linkClasses =
  "cursor-pointer rounded-sm font-medium text-primary underline decoration-outline-variant " +
  "underline-offset-2 transition-colors hover:decoration-primary focus-visible:outline " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/* ==========================================================================
 * Containers
 *
 * Level 0 is the background, Level 1 is a card in the same tone with a 1px
 * outline and no shadow, Level 2 is a modal or popover which adds a very soft
 * diffused shadow but keeps its border. Depth is an outline, not a drop shadow.
 * ========================================================================== */

/** The default panel. Everything that groups content sits on one of these. */
export const cardClasses = "rounded-lg border border-outline-variant bg-surface";

/** A card that is also a link or a button. */
export const cardInteractive =
  `${cardClasses} cursor-pointer transition-all hover:border-primary hover:shadow-raise ` +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** The header strip at the top of a panel. Paired with `cardClasses`. */
export const cardHeader =
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-outline-variant px-6 py-4";

/** Standard body padding for a panel. The design leans generous. */
export const cardBody = "p-6";

/** An inset panel: a form inside a card, a quoted reply, a summary block. */
export const insetClasses =
  "rounded-md border border-outline-variant bg-surface-container-low p-4";

/** A tinted informational panel — timezone notices, owner banners. */
export const noticeClasses =
  "rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 font-small text-small text-on-surface-variant";

/* ==========================================================================
 * Badges
 *
 * The design's status chip: 10px, uppercase, bold, wide tracking, pill-shaped,
 * on a 10% tint of the semantic colour.
 * ========================================================================== */

const badgeBase =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 " +
  "font-caption text-[10px] font-bold uppercase tracking-wider whitespace-nowrap";

export const badgeVariants = {
  neutral: `${badgeBase} bg-surface-variant text-on-surface-variant`,
  brand: `${badgeBase} bg-primary/10 text-primary`,
  danger: `${badgeBase} bg-error/10 text-on-error-container`,
  warn: `${badgeBase} bg-surface-container-high text-on-surface-variant`,
  info: `${badgeBase} bg-tertiary-fixed/40 text-on-tertiary-fixed-variant`,
};

/** An untinted pill for a category or a count. Sentence case, not a status. */
export const chipClasses =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-outline-variant " +
  "bg-surface px-3 py-1 font-caption text-caption text-on-surface-variant";

/** A flat tag, as the design draws a provider's specialities. */
export const tagClasses =
  "inline-flex shrink-0 items-center rounded-md bg-surface-container px-3 py-1.5 font-caption text-caption text-on-surface-variant";

/* ==========================================================================
 * Table
 * ========================================================================== */

/**
 * Tables are compact by construction: 12px uppercase headers, generous rows,
 * and borders only between them. The alternative — a card per record — turned
 * forty bookings into five thousand pixels of scroll.
 */
export const tableClasses = "w-full border-collapse";

export const theadClasses = "border-b border-outline-variant bg-surface-container-low";

export const thClasses =
  "px-6 py-3 text-left font-caption text-caption font-bold uppercase tracking-wider text-on-surface-variant whitespace-nowrap";

export const tdClasses = "px-6 py-4 align-middle font-small text-small text-on-surface-variant";

export const trClasses =
  "border-b border-outline-variant/50 last:border-0 transition-colors hover:bg-surface-container-lowest";

/* ==========================================================================
 * Application shell
 *
 * A persistent 240px rail and a 64px top bar. The active row's treatment — a
 * 4px left bar, a lift to `surface` and a jump to weight 600 — is stated here
 * rather than in the Sidebar component, so it sits beside everything else it
 * has to match.
 * ========================================================================== */

const navRowBase =
  "flex items-center gap-3 rounded-r-md border-l-4 px-4 py-3 font-small text-small transition-colors";

export const navRow =
  `${navRowBase} border-transparent text-on-surface-variant hover:bg-surface-container-high`;

export const navRowActive = `${navRowBase} border-primary bg-surface font-semibold text-primary`;

/** The secondary rows below the divider — sign out. */
export const navRowQuiet =
  "flex items-center gap-3 rounded-r-md px-4 py-2 font-small text-small text-on-surface-variant transition-colors hover:bg-surface-container-high";

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
    dot: "bg-outline",
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

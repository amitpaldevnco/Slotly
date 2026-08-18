/**
 * The Slotly logo.
 *
 * One image, used everywhere the brand appears. The hand-drawn SVG mark that
 * used to live here has been removed: `assets/logo.png` is the real logo now,
 * and keeping a second, different mark in the codebase is how two logos end up
 * shipping on two different screens.
 *
 * The asset is a **lockup** — the mark and the word "Slotly" together — so
 * nothing here renders the wordmark as text. Anywhere the old component was
 * asked for `wordmark={false}`, there is no mark-only asset to fall back to;
 * that prop is gone rather than silently ignored.
 */

import logoUrl from "../../assets/logo.png";

/**
 * Rendered heights.
 *
 * Generous, because the PNG carries a wide margin of its own: roughly a third of
 * its height is transparent padding, so a 40px box draws a mark about 26px tall.
 * Trim the asset and these can all come down a step.
 */
const SIZES = {
  sm: "h-10",
  md: "h-12",
  lg: "h-16",
};

export default function Logo({
  size = "sm",
  /** The "Professional Booking" strapline under the lockup, as in the sidebar. */
  subtitle = false,
  className = "",
}) {
  const height = SIZES[size] || SIZES.sm;

  return (
    <span className={`inline-flex min-w-0 flex-col ${className}`}>
      <img
        src={logoUrl}
        alt="Slotly"
        // `w-auto` with a fixed height keeps the lockup's aspect ratio whatever
        // the asset is later replaced with; `object-contain` stops a future
        // non-matching ratio from cropping the wordmark off.
        className={`${height} w-auto shrink-0 object-contain object-left`}
      />

      {subtitle && (
        <span className="mt-0.5 block font-caption text-caption text-on-surface-variant">
          Professional Booking
        </span>
      )}
    </span>
  );
}

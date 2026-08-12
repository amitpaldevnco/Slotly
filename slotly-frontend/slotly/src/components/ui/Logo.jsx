// The Slotly logo.


/** The terracotta and cream of the mark itself. Not theme tokens — see above. */
const MARK_BG = "#8A3F24";
const MARK_SLOT = "#F1E0D5";

const SIZES = {
  sm: { mark: 26, text: "text-[0.9375rem]", gap: "gap-2" },
  md: { mark: 32, text: "text-lg", gap: "gap-2.5" },
  lg: { mark: 40, text: "text-2xl", gap: "gap-3" },
};

export default function Logo({ size = "sm", wordmark = true, className = "" }) {
  const { mark, text, gap } = SIZES[size] || SIZES.sm;

  return (
    <span className={`inline-flex items-center ${gap} ${className}`}>
      <svg
        width={mark}
        height={mark}
        viewBox="0 0 40 40"
        {...(wordmark
          ? { "aria-hidden": "true" }
          : { role: "img", "aria-label": "Slotly" })}
        className="shrink-0"
      >
        <rect width="40" height="40" rx="10" fill={MARK_BG} />
        <rect x="20" y="16" width="10" height="10" rx="2" fill={MARK_SLOT} />
      </svg>

      {wordmark && (
        <span className={`font-semibold tracking-tight ${text}`}>Slotly</span>
      )}
    </span>
  );
}

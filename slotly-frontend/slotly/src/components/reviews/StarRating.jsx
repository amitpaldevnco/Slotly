//Stars, for reading a rating and for setting one.


function Star({ filled }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-full w-full">
      <path
        d="M10 1.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L10 14.9l-5.25 2.76 1-5.86L1.5 7.66l5.9-.86z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}


export function StarRatingDisplay({ value, size = "sm", showValue = true, count }) {
  const rounded = Math.round(Number(value) || 0);
  const box = size === "md" ? "h-5 w-5" : "h-4 w-4";

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-0.5 text-star"
        role="img"
        aria-label={`${Number(value).toFixed(1)} out of 5`}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={box}>
            <Star filled={star <= rounded} />
          </span>
        ))}
      </span>

      {showValue && (
        <span className="text-[0.8125rem] font-semibold text-ink">{Number(value).toFixed(1)}</span>
      )}
      {count != null && (
        <span className="text-xs text-ink-3">
          ({count} review{count === 1 ? "" : "s"})
        </span>
      )}
    </span>
  );
}


export function StarRatingInput({ value, onChange, disabled }) {
  const labels = {
    1: "Poor",
    2: "Fair",
    3: "Good",
    4: "Very good",
    5: "Excellent",
  };

  return (
    <fieldset disabled={disabled} className="border-0 p-0">
      <legend className="mb-1.5 block text-xs font-medium text-ink">
        Your rating
      </legend>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <label
              key={star}
              // 44px tap target around a 28px star: the star itself should not be
              // the hit area on a phone.
              className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg transition hover:bg-canvas ${
                disabled ? "cursor-not-allowed opacity-60" : ""
              }`}
            >
              <input
                type="radio"
                name="rating"
                value={star}
                checked={value === star}
                onChange={() => onChange(star)}
                // Visually hidden but still focusable, so the focus ring lands on
                // the label and arrow keys move between stars.
                className="peer sr-only"
              />
              <span
                className={`h-7 w-7 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand ${
                  star <= value ? "text-star" : "text-line"
                }`}
              >
                <Star filled={star <= value} />
              </span>
              <span className="sr-only">
                {star} star{star === 1 ? "" : "s"} — {labels[star]}
              </span>
            </label>
          ))}
        </div>

        {/* Naming the chosen value confirms the click landed on the star the user
            meant, which is easy to get wrong on a small screen. */}
        {value > 0 && <span className="text-[0.8125rem] text-ink-2">{labels[value]}</span>}
      </div>
    </fieldset>
  );
}

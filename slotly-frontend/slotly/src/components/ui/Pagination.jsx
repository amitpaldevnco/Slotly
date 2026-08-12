//Pagination, and the hook that drives it.

import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { iconButton } from "../../lib/ui";


export function usePagination(items, pageSize = 10) {
  const [page, setPage] = useState(1);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Two ways the current page can stop existing: a filter narrows the list while
  // the user is on page 4, or the last item on the last page is deleted. Either
  // way, clamping here means the list shows results instead of going blank —
  // which is what "page 4 of 1" renders as.
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const safePage = Math.min(page, pageCount);

  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );

  return {
    pageItems,
    page: safePage,
    pageCount,
    setPage,
    total,
    pageSize,
    // 1-indexed, inclusive, for the "showing 11–20 of 47" line.
    from: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to: Math.min(safePage * pageSize, total),
  };
}

/**
 * Builds the page-number list with ellipses.
 *
 * Always the first page, the last page, and a window around the current one, so
 * the control's width does not grow with the number of pages — the reason a bare
 * `Array.from({length: pageCount})` is unusable past about fifteen.
 */
function pageWindow(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const window = new Set([1, pageCount, page, page - 1, page + 1]);
  const pages = [...window].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

  const withGaps = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1] > 1) withGaps.push("gap");
    withGaps.push(n);
  });

  return withGaps;
}


export default function Pagination({
  page,
  pageCount,
  onChange,
  total,
  from,
  to,
  unit = "result",
  className = "",
}) {
  // A single page needs no control, but the count line is still worth having:
  // "8 bookings" tells the reader the list is complete rather than truncated.
  const showPages = pageCount > 1;
  const showCount = total != null;

  if (!showPages && !showCount) return null;

  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}
    >
      {showCount ? (
        <p className="text-xs text-ink-3" aria-live="polite">
          {total === 0 ? (
            `No ${unit}s`
          ) : showPages ? (
            <>
              <span className="font-medium text-ink-2">
                {from}–{to}
              </span>{" "}
              of {total} {unit}
              {total === 1 ? "" : "s"}
            </>
          ) : (
            <>
              {total} {unit}
              {total === 1 ? "" : "s"}
            </>
          )}
        </p>
      ) : (
        <span />
      )}

      {showPages && (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onChange(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
            className={iconButton}
          >
            <Icon name="chevronLeft" size={16} />
          </button>

          {/* Numbers are hidden on a phone, where six 36px targets in a row is
              wider than the screen. The arrows and the count line carry it. */}
          <div className="hidden items-center gap-0.5 sm:flex">
            {pageWindow(page, pageCount).map((entry, index) =>
              entry === "gap" ? (
                <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-xs text-ink-3">
                  …
                </span>
              ) : (
                <button
                  key={entry}
                  type="button"
                  onClick={() => onChange(entry)}
                  aria-current={entry === page ? "page" : undefined}
                  className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-[0.8125rem] font-medium tabular-nums transition ${
                    entry === page
                      ? "bg-brand text-white"
                      : "text-ink-2 hover:bg-canvas hover:text-ink"
                  }`}
                >
                  {entry}
                </button>
              )
            )}
          </div>

          <span className="px-1.5 text-xs tabular-nums text-ink-3 sm:hidden">
            {page} / {pageCount}
          </span>

          <button
            type="button"
            onClick={() => onChange(page + 1)}
            disabled={page === pageCount}
            aria-label="Next page"
            className={iconButton}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      )}
    </nav>
  );
}

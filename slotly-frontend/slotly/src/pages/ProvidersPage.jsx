/**
 * The provider directory — `search_professionals`.
 *
 * Transcribed from the reference: a heading with a search box, a filter rail on
 * the left, a "Showing N / Sort by" strip, and a two-column grid of cards.
 *
 * Three of the reference's filters and two of its card fields have no data
 * behind them and are therefore not drawn:
 *
 * - Hourly Rate, Minimum Rating and Availability. `GET /providers` returns a
 *   service count and a cheapest price, no rating, and no "who is free on
 *   Saturday" index — availability is computed per provider, per service, on
 *   demand. Filtering by any of them would mean fetching every provider's slots
 *   up front or lying about the result.
 * - The card's star rating and "Next Available". Same reason: neither is on the
 *   directory endpoint. Those two slots keep their position and treatment and
 *   carry the numbers that do exist — the service count and the shortest
 *   appointment on offer.
 *
 * The same reasoning rules out the reference's "Highest Rated" sort option. The
 * other three are kept, and "Price: High to Low" is a second ordering of a field
 * that is genuinely returned.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import EmptyState, { ErrorState, SkeletonRows } from "../components/ui/Feedback";
import { usePagination, pageWindow } from "../components/ui/Pagination";
import { container, formatPrice, formatDuration, zoneName } from "../lib/ui";
import { comparablePrice } from "../lib/currencies";
import { normaliseCategory } from "../lib/categories";
import usePageTitle from "../hooks/usePageTitle";

const SEARCH_DEBOUNCE_MS = 300;

/** Providers per page. Four fills the two-column grid exactly, as the design draws it. */
const PAGE_SIZE = 4;

/**
 * How many matched service names a card lists before summarising the rest.
 *
 * Three keeps the card the same height whether a provider matched on one service
 * or on twenty — the QA fixture provider has twenty-six — so a broad search does
 * not produce one card ten times taller than its neighbours.
 */
const MAX_MATCHED_SHOWN = 3;

const SORT_OPTIONS = [
  { value: "relevance", label: "Recommended" },
  { value: "price", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "services", label: "Most services" },
];

export default function ProvidersPage() {
  // The top bar's search box submits here, so the term has to be readable from
  // the URL as well as from the input on this page.
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  // Seeded from the URL as well, so the dashboard's "Trending Services" rows can
  // link straight to a filtered directory — and so a filtered view is a URL
  // someone can bookmark or send, rather than a state you have to arrive at by
  // clicking.
  const [category, setCategory] = useState(() => searchParams.get("category") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);

  usePageTitle("Find a provider");

  // Sort lives in the URL for the same reason the search term and the category
  // do: a sorted, filtered directory should be a link. It was the one control
  // held only in component state, so "cheapest first" was unshareable and lost
  // on reload while the other two survived.
  const sortParam = searchParams.get("sort") || "";
  const sort = SORT_OPTIONS.some((option) => option.value === sortParam) ? sortParam : "relevance";

  const queryParam = searchParams.get("q") || "";
  useEffect(() => {
    setSearch(queryParam);
  }, [queryParam]);

  const categoryParam = searchParams.get("category") || "";
  useEffect(() => {
    setCategory(categoryParam);
  }, [categoryParam]);

  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  /**
   * Writes one control's value into the query string.
   *
   * The URL is the single place these three live, so every control goes through
   * here. Before this, the top bar's search box wrote `?q=` and the page read
   * it, but typing into the page's *own* box changed only local state — so the
   * same search was a shareable link when it came from one input and not from
   * the other. `replace` because filtering is not a navigation: twenty
   * keystrokes should not be twenty entries to press Back through.
   */
  const setParam = useCallback(
    (key, value) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // The debounced term is what goes into the URL, not every keystroke.
  useEffect(() => {
    if (term !== queryParam) setParam("q", term);
  }, [term, queryParam, setParam]);

  const {
    data,
    loading: initialLoading,
    refreshing: searching,
    error,
    reload,
  } = useApiResource(({ signal }) => providersApi.list(term ? { search: term } : {}, { signal }), {
    deps: [term],
    fallback: "Could not load providers.",
    keepPreviousData: true,
  });

  const providers = useMemo(() => data?.providers ?? [], [data]);

  // Counted against the *canonical* category, so a provider stored as
  // "Physiotherapy" is counted under Healthcare rather than creating a second
  // near-duplicate filter beside it. That split was visible in the sidebar as
  // Healthcare, Physiotherapy and Therapy listed as three separate things.
  const categories = useMemo(() => {
    const counts = new Map();
    for (const provider of providers) {
      const canonical = normaliseCategory(provider.businessType);
      if (!canonical) continue;
      counts.set(canonical, (counts.get(canonical) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [providers]);

  const visible = useMemo(() => {
    const filtered = category
      ? providers.filter((provider) => normaliseCategory(provider.businessType) === category)
      : providers;

    if (sort === "relevance") return filtered;

    return [...filtered].sort((a, b) => {
      if (sort === "price" || sort === "price_desc") {
        // Compared in a common unit rather than as bare numbers. `fromPrice` is
        // denominated in each provider's own currency, so subtracting one from
        // the other ranked ₹900 above £250 — roughly £8 sorted as dearer than
        // £250. See `comparablePrice` for why an indicative rate is the right
        // tool for an ordering and the wrong one for a displayed figure.
        const left = comparablePrice(a.fromPrice, a.currency);
        const right = comparablePrice(b.fromPrice, b.currency);

        // A provider with no published price sorts last in *either* direction,
        // rather than first — which is what `null` compares as by default.
        // Compared rather than substituted with ±Infinity, because two unpriced
        // providers would then subtract to NaN and the comparator would be
        // returning a value the sort is not defined for.
        if (left == null || right == null) {
          if (left == null && right == null) return 0;
          return left == null ? 1 : -1;
        }

        return sort === "price_desc" ? right - left : left - right;
      }
      return (b.serviceCount || 0) - (a.serviceCount || 0);
    });
  }, [providers, category, sort]);

  const {
    pageItems,
    page,
    setPage,
    pageCount,
    from: firstRow,
    to: lastRow,
  } = usePagination(visible, PAGE_SIZE);

  const hasFilters = Boolean(category) || sort !== "relevance" || Boolean(search.trim());

  const clearAll = () => {
    setSearch("");
    setCategory("");
    // Every control lives in the URL, so clearing them all is one write. Leaving
    // any behind would produce an address that re-applies a filter the user has
    // just dismissed, the moment the page is reloaded or shared.
    setSearchParams({}, { replace: true });
  };

  return (
    <div className={`${container} py-8 md:py-12`}>
      {/* Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <h1 className="mb-2 font-h1-mobile text-h1-mobile text-primary md:font-h1 md:text-h1">
            Find a Provider
          </h1>
          <p className="font-body text-body text-on-surface-variant">
            Filter by category to find the right match. All times are shown in your own timezone.
          </p>
        </div>

        <div className="relative w-full shrink-0 md:w-72">
          <label htmlFor="provider-search" className="sr-only">
            Search providers
          </label>
          <Icon
            name="search"
            size={20}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            id="provider-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, service or category…"
            className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 font-body text-base outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/10 md:text-small"
          />
        </div>
      </div>

      <div className="relative flex flex-col items-start gap-gutter lg:flex-row">
        {/* Filter rail */}
        <aside className="w-full shrink-0 lg:w-[280px]">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-outline-variant bg-surface px-4 py-2.5 font-small text-small text-primary transition-colors hover:bg-surface-container-low lg:hidden"
          >
            <Icon name="tune" size={18} />
            Filters
            {hasFilters && (
              <span className="rounded-full bg-primary px-2 py-0.5 font-caption text-[10px] font-bold text-on-primary">
                on
              </span>
            )}
          </button>

          <div
            className={`${filtersOpen ? "mt-4 flex" : "hidden"} flex-col gap-6 lg:mt-0 lg:flex lg:sticky lg:top-24`}
          >
            <div className="flex items-center justify-between border-b border-outline-variant pb-4">
              <h2 className="font-h3 text-h3 text-primary">Filters</h2>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="cursor-pointer font-small text-small text-on-surface-variant transition-colors hover:text-primary"
                >
                  Clear All
                </button>
              )}
            </div>

            {categories.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="font-small text-small font-semibold text-on-surface">Category</h3>
                <ul className="flex flex-col gap-2">
                  <li>
                    <CategoryOption
                      label="All categories"
                      count={providers.length}
                      checked={category === ""}
                      onSelect={() => setParam("category", "")}
                    />
                  </li>
                  {categories.map(([name, count]) => (
                    <li key={name}>
                      <CategoryOption
                        label={name}
                        count={count}
                        checked={category === name}
                        onSelect={() => setParam("category", name)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>

        {/* Results */}
        <div className="flex w-full flex-1 flex-col gap-6">
          <div className="flex items-center justify-between border-b border-outline-variant pb-4">
            <span className="font-small text-small text-on-surface-variant">
              {initialLoading ? (
                "Loading providers…"
              ) : (
                <>
                  {/* The range as well as the total. "Showing 13 professionals"
                      above a grid of four was accurate about the result set and
                      wrong about the page, which is the number the reader is
                      looking at. */}
                  Showing{" "}
                  <strong className="text-on-surface">
                    {visible.length === 0 ? 0 : `${firstRow}–${lastRow}`}
                  </strong>{" "}
                  of <strong className="text-on-surface">{visible.length}</strong>{" "}
                  {visible.length === 1 ? "professional" : "professionals"}
                </>
              )}
            </span>

            <div className="flex items-center gap-2">
              <label htmlFor="provider-sort" className="font-caption text-caption text-on-surface-variant">
                Sort by:
              </label>
              <select
                id="provider-sort"
                value={sort}
                onChange={(event) => setParam("sort", event.target.value)}
                className="cursor-pointer border-none bg-transparent py-1 pr-8 font-small text-small text-on-surface focus:ring-0"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            aria-busy={searching}
            className={`transition-opacity duration-150 motion-reduce:transition-none ${
              searching ? "opacity-55" : "opacity-100"
            }`}
          >
            {initialLoading ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <SkeletonRows key={i} count={1} />
                ))}
              </div>
            ) : error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : visible.length === 0 ? (
              <EmptyState
                icon="search_off"
                title={hasFilters ? "No providers match that search" : "No providers yet"}
                description={
                  hasFilters
                    ? "Try a provider's name, a service you want to book, or a category."
                    : "Once providers publish their services they will appear here."
                }
                {...(hasFilters ? { actionLabel: "Clear filters", onAction: clearAll } : {})}
              />
            ) : (
              <>
                {/* The results are their own scroll region, so the heading, the
                    filter rail and the pager stay put while the cards move.
                    Only from `lg`: on a phone the page is one column and a
                    scroller nested inside the page's own scroll traps the
                    gesture — the list is four cards there, which is a short
                    page rather than a long one. */}
                <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:max-h-[calc(100dvh-17rem)] lg:overflow-y-auto lg:pr-2">
                  {pageItems.map((provider) => (
                    <li key={provider.id} className="flex">
                      <ProviderCard provider={provider} />
                    </li>
                  ))}
                </ul>

                {pageCount > 1 && (
                  <div className="mt-8 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage(page - 1)}
                      disabled={page <= 1}
                      aria-label="Previous page"
                      className="cursor-pointer rounded-md border border-outline-variant p-2 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon name="chevron_left" size={18} />
                    </button>

                    {/* The reference draws "1 2 3 … ›". Rendering every number
                        instead is fine at three pages and unusable at forty, so
                        the window is shared with the app's other pagination
                        rather than reimplemented with a different rule. */}
                    {pageWindow(page, pageCount).map((entry, index) =>
                      entry === "gap" ? (
                        <span
                          key={`gap-${index}`}
                          aria-hidden="true"
                          className="px-1 text-on-surface-variant"
                        >
                          …
                        </span>
                      ) : (
                        <button
                          key={entry}
                          type="button"
                          onClick={() => setPage(entry)}
                          aria-current={entry === page ? "page" : undefined}
                          className={`h-9 min-w-9 cursor-pointer rounded-md border px-2 font-small text-small tabular-nums transition-colors ${
                            entry === page
                              ? "border-primary bg-primary text-on-primary"
                              : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                          }`}
                        >
                          {entry}
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      onClick={() => setPage(page + 1)}
                      disabled={page >= pageCount}
                      aria-label="Next page"
                      className="cursor-pointer rounded-md border border-outline-variant p-2 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon name="chevron_right" size={18} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A category row.
 *
 * The reference draws checkboxes. Only one category can apply at a time, given
 * the filter is a single value — so these are buttons wearing a checkbox, and a
 * second click on the same one does not silently untick its neighbour.
 */
function CategoryOption({ label, count, checked, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 text-left font-small text-small transition-colors ${
        checked ? "font-semibold text-on-surface" : "text-on-surface-variant hover:text-primary"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
          checked
            ? "border-primary bg-primary text-on-primary"
            : "border-outline-variant bg-surface-container-lowest"
        }`}
      >
        {checked && <Icon name="check" size={14} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-caption text-caption tabular-nums text-on-surface-variant">
        {count}
      </span>
    </button>
  );
}

const ProviderCard = memo(function ProviderCard({ provider }) {
  return (
    <Link
      to={`/providers/${provider.id}`}
      className="group relative flex w-full flex-col gap-4 overflow-hidden rounded-lg border border-outline-variant bg-surface p-6 transition-shadow hover:shadow-raise"
    >
      {/* The reference's corner wash. Decorative, and behind everything. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-gradient-to-br from-primary/5 to-transparent"
      />

      <div className="flex items-start gap-4">
        <Avatar
          src={provider.avatarUrl}
          name={provider.name}
          size="xl"
          className="h-16 w-16 border-2 border-surface text-lg sm:h-16 sm:w-16 sm:text-lg"
        />

        {/* `min-w-0` is what lets the `truncate` below actually engage. A flex
            item defaults to `min-width: auto`, so without it this block refuses
            to shrink under its min-content width and the card's name and service
            count spill past the card edge on a phone rather than eliding. */}
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-body-lg text-body-lg font-semibold text-on-surface transition-colors group-hover:text-primary">
                {provider.businessName || provider.name}
              </h3>
              <p className="truncate font-small text-small text-on-surface-variant">
                {provider.businessName ? provider.name : provider.businessType || "Provider"}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1 text-primary">
              <Icon name="category" size={16} fill />
              <span className="font-small text-small font-semibold">{provider.serviceCount}</span>
              <span className="ml-1 font-caption text-caption text-on-surface-variant">
                {provider.serviceCount === 1 ? "service" : "services"}
              </span>
            </div>
          </div>

          {provider.timezone && (
            <div className="mt-2 flex items-center gap-3 text-on-surface-variant">
              <span className="flex items-center gap-1 font-caption text-caption">
                <Icon name="public" size={14} />
                {zoneName(provider.timezone)}
              </span>
            </div>
          )}
        </div>
      </div>

      {provider.bio && (
        <p className="line-clamp-2 font-small text-small text-on-surface-variant">{provider.bio}</p>
      )}

      {provider.businessType && (
        <div className="mt-1 flex flex-wrap gap-2">
          <span className="rounded-md bg-surface-container px-2 py-1 font-caption text-caption text-on-surface">
            {provider.businessType}
          </span>
        </div>
      )}

      {/* Why this provider is in the results.

          The search matches service names as well as provider names, so a search
          for "Haircut" can return a salon whose card contains that word nowhere
          — the match is one level down, on a service. Naming the matched service
          is what turns a plausible-looking list into an explicable one, and it is
          the service the client was actually looking for.

          Present only on a search, and only when the match came through a
          service; the API sends an empty array otherwise. */}
      {provider.matchedServices?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-caption text-caption text-on-surface-variant">Matching:</span>
          {provider.matchedServices.slice(0, MAX_MATCHED_SHOWN).map((name) => (
            <span
              key={name}
              className="rounded-md bg-primary/10 px-2 py-1 font-caption text-caption font-medium text-primary"
            >
              {name}
            </span>
          ))}
          {provider.matchedServices.length > MAX_MATCHED_SHOWN && (
            <span className="font-caption text-caption text-on-surface-variant">
              +{provider.matchedServices.length - MAX_MATCHED_SHOWN} more
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-outline-variant/50 pt-4">
        <div className="flex flex-col">
          <span className="font-caption text-caption text-on-surface-variant">Starting at</span>
          <span className="font-small text-small font-semibold text-on-surface">
            {provider.fromPrice != null ? formatPrice(provider.fromPrice, provider.currency) : "—"}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-caption text-caption text-on-surface-variant">Shortest session</span>
          <span className="flex items-center gap-1 font-small text-small font-medium text-primary">
            <Icon name="schedule" size={14} />
            {provider.shortestDuration != null
              ? formatDuration(provider.shortestDuration)
              : "—"}
          </span>
        </div>
      </div>
    </Link>
  );
});

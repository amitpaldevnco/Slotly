/**
 * The provider directory — `search_professionals`.
 *
 * Transcribed from the reference: a heading with a search box, a filter rail on
 * the left, a "Showing N / Sort by" strip, and a two-column grid of cards.
 *
 * ## The filters, and which of the reference's are real
 *
 * Category, price, rating and session length all read fields the directory
 * endpoint returns, so each one filters on something rather than approximating:
 *
 * - Rating is `ratingAverage`, which `GET /providers` aggregates alongside the
 *   service count. It genuinely was not there before, which is why the card's
 *   star slot had been repurposed to carry a service count; the stars are back
 *   in the position the reference gives them.
 * - Price is banded rather than given a threshold, because Slotly has no
 *   exchange rates and this directory is multi-currency. See `PRICE_BANDS`.
 * - Session length filters `shortestDuration`. Minutes need no conversion, so
 *   this is the one filter that can state an absolute number.
 *
 * **Availability is still not drawn, and that is deliberate rather than
 * unfinished.** There is no "who is free on Saturday" index: availability is
 * resolved per provider, per service, on demand, against their weekly rules,
 * their exceptions and their existing bookings. Filtering the directory by it
 * would mean computing slots for every provider on every keystroke — and a
 * directory that promises a provider is free tomorrow and then offers no slots
 * is worse than one that never claimed to know. The card's "Next Available"
 * slot is blank for the same reason and carries the shortest session instead.
 *
 * "Most services" used to be a fourth sort option. It is gone because it was
 * never a different answer: the server orders by `service_count DESC, name ASC`,
 * which is precisely what Recommended shows, so the two produced the same list
 * in the same order every time.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import EmptyState, {
  ErrorState,
  Refreshing,
  SkeletonBlock,
  SkeletonRows,
} from "../components/ui/Feedback";
import { StarRatingDisplay } from "../components/reviews/StarRating";
import { usePagination, pageWindow } from "../components/ui/Pagination";
import { container, formatPrice, formatDuration, zoneName } from "../lib/ui";
import { comparablePrice } from "../lib/currencies";
import { normaliseCategory } from "../lib/categories";
import usePageTitle from "../hooks/usePageTitle";
import { DELIVERY_FILTER_OPTIONS, SCOPE_FILTER_OPTIONS } from "../lib/serviceScope";

const SEARCH_DEBOUNCE_MS = 300;

/** Providers per page. Four fills the two-column grid exactly, as the design draws it. */
const PAGE_SIZE = 8;

/**
 * How many matched service names a card lists before summarising the rest.
 *
 * Three keeps the card the same height whether a provider matched on one service
 * or on twenty — the QA fixture provider has twenty-six — so a broad search does
 * not produce one card ten times taller than its neighbours.
 */
const MAX_MATCHED_SHOWN = 3;

/**
 * The orderings, each with the sentence that says what it actually does.
 *
 * "Recommended" is the default and explained nothing — a reader had no way to
 * know whether it was ranking by quality, by proximity, by payment, or by
 * nothing at all, and an unexplained default ordering invites the suspicion that
 * it is the one that suits the platform. It ranks by how many services a
 * provider publishes, which is worth saying out loud precisely because it is so
 * much less than the word "recommended" implies.
 */
const SORT_OPTIONS = [
  {
    value: "relevance",
    label: "Recommended",
    hint: "Providers publishing the most services first, then alphabetically. Not a ranking by quality.",
  },
  {
    value: "rating",
    label: "Highest rated",
    hint: "Best average review score first. Providers nobody has reviewed yet come last, not lowest.",
  },
  {
    value: "price",
    label: "Price: Low to High",
    hint: "By each provider's cheapest service. Prices in other currencies are ranked using indicative rates — every figure shown is still the provider's own, unconverted.",
  },
  {
    value: "price_desc",
    label: "Price: High to Low",
    hint: "By each provider's cheapest service, dearest first. Providers with no published price come last either way.",
  },
];

/**
 * The rating floors on offer.
 *
 * Floors rather than exact scores: nobody looks for a provider rated exactly
 * four. A provider with no reviews is excluded by any of these, because "not yet
 * rated" cannot be shown to clear a bar — which is also why "Any rating" has to
 * stay the default rather than a 1-and-up option standing in for it.
 */
const RATING_OPTIONS = [
  { value: "4.5", label: "4.5 and up" },
  { value: "4", label: "4 and up" },
  { value: "3", label: "3 and up" },
];

/** Session-length ceilings, against the shortest appointment each provider offers. */
const DURATION_OPTIONS = [
  { value: "30", label: "30 minutes or less" },
  { value: "60", label: "1 hour or less" },
  { value: "120", label: "2 hours or less" },
];

/**
 * Price bands — thirds of the providers currently listed, not amounts.
 *
 * A "under $50" control is what the reference draws and what this cannot
 * honestly be. Slotly stores each provider's prices in that provider's own
 * currency and has no exchange rates; `comparablePrice` exists to put two prices
 * in a defensible *order* using indicative figures, and its own documentation is
 * explicit that those figures are for ordering "and for nothing else". A
 * threshold is not an ordering — printing "under $50" next to a filter that is
 * really comparing £, ₹ and $ through a rounded constant would be showing a made
 * up number as a fact, which is the one thing the rest of this app refuses to do.
 *
 * So the bands are relative, and say so. They split on the same comparable
 * magnitude the price sort already uses, which means the filter and the sort can
 * never disagree about which provider is the cheaper.
 */
const PRICE_BANDS = [
  { value: "low", label: "Least expensive third" },
  { value: "mid", label: "Middle third" },
  { value: "high", label: "Most expensive third" },
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
  const activeSort = SORT_OPTIONS.find((option) => option.value === sort);

  // The three added filters live in the URL for the reason the other controls
  // do, and are read straight from it rather than mirrored into state: they are
  // set by a click, not typed into, so there is no keystroke to debounce and
  // nothing local to keep in step. Each is validated against its own option
  // list, so `?rating=banana` is no filter rather than a filter matching nobody.
  const minRating = pickOption(RATING_OPTIONS, searchParams.get("rating"));
  const maxDuration = pickOption(DURATION_OPTIONS, searchParams.get("duration"));
  const priceBand = pickOption(PRICE_BANDS, searchParams.get("price"));
  // Delivery type and booking scope, read from the URL and validated against
  // their own option lists like every other control here — so `?delivery=banana`
  // is no filter rather than a filter matching nobody.
  const deliveryType = pickOption(DELIVERY_FILTER_OPTIONS, searchParams.get("delivery"));
  const bookingScope = pickOption(SCOPE_FILTER_OPTIONS, searchParams.get("scope"));

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

  // Where the two band boundaries fall, in the common unit the price sort uses.
  //
  // Measured against every provider the search returned rather than the ones
  // left after filtering, so choosing a band does not move the boundaries that
  // defined it — the thirds are a property of the result set, and recomputing
  // them from the survivors would make "middle third" mean something new the
  // moment it was picked.
  const priceBounds = useMemo(() => priceTertiles(providers), [providers]);

  const matchesFilters = useCallback(
    (provider, { skip } = {}) => {
      if (skip !== "category" && category) {
        if (normaliseCategory(provider.businessType) !== category) return false;
      }
      if (skip !== "rating" && minRating) {
        // Unrated is not "rated badly", so it cannot clear a floor.
        if (provider.ratingAverage == null || provider.ratingAverage < Number(minRating)) {
          return false;
        }
      }
      if (skip !== "duration" && maxDuration) {
        if (provider.shortestDuration == null || provider.shortestDuration > Number(maxDuration)) {
          return false;
        }
      }
      if (skip !== "price" && priceBand) {
        if (!inPriceBand(provider, priceBand, priceBounds)) return false;
      }
      // Matched against the *set* a provider offers, not a single value: a clinic
      // doing both in-person and online consultations has to appear under either
      // filter, which is why the API sends arrays.
      if (skip !== "delivery" && deliveryType) {
        if (!(provider.deliveryTypes ?? []).includes(deliveryType)) return false;
      }
      if (skip !== "scope" && bookingScope) {
        if (!(provider.bookingScopes ?? []).includes(bookingScope)) return false;
      }
      return true;
    },
    [category, minRating, maxDuration, priceBand, priceBounds, deliveryType, bookingScope]
  );

  /**
   * Each group's options, with the number of providers each one would leave.
   *
   * Counted against the other filters but not its own — the number beside "4 and
   * up" is how many providers you would see if you clicked it, which is the only
   * number that answers the question a reader asks of it. Counting every group
   * against the raw result set instead, as the category list used to, makes those
   * numbers disagree with the list the moment a second filter is on.
   *
   * An option nobody matches is not offered, because a filter that can only empty
   * the screen is a dead end dressed up as a choice. The exception is one that is
   * currently selected: dropping that would make an active filter invisible while
   * it was still narrowing the list.
   */
  const filterGroups = useMemo(() => {
    const poolFor = (skip) => providers.filter((provider) => matchesFilters(provider, { skip }));

    const withCounts = (options, pool, predicate, active) =>
      options
        .map((option) => ({
          ...option,
          count: pool.filter((provider) => predicate(provider, option.value)).length,
        }))
        .filter((option) => option.count > 0 || option.value === active);

    // Counted against the *canonical* category, so a provider stored as
    // "Physiotherapy" counts under Healthcare rather than appearing as a second
    // near-duplicate filter beside it. That split used to be visible in the rail
    // as Healthcare, Physiotherapy and Therapy, listed as three separate things.
    const categoryPool = poolFor("category");
    const categoryNames = [
      ...new Set(categoryPool.map((provider) => normaliseCategory(provider.businessType))),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const ratingPool = poolFor("rating");
    const durationPool = poolFor("duration");
    const pricePool = poolFor("price");
    const deliveryPool = poolFor("delivery");
    const scopePool = poolFor("scope");

    return {
      category: {
        allLabel: "All categories",
        allCount: categoryPool.length,
        options: withCounts(
          categoryNames.map((name) => ({ value: name, label: name })),
          categoryPool,
          (provider, value) => normaliseCategory(provider.businessType) === value,
          category
        ),
      },
      rating: {
        allLabel: "Any rating",
        allCount: ratingPool.length,
        options: withCounts(
          RATING_OPTIONS,
          ratingPool,
          (provider, value) =>
            provider.ratingAverage != null && provider.ratingAverage >= Number(value),
          minRating
        ),
      },
      price: {
        allLabel: "Any price",
        allCount: pricePool.length,
        options: priceBounds
          ? withCounts(
              PRICE_BANDS,
              pricePool,
              (provider, value) => inPriceBand(provider, value, priceBounds),
              priceBand
            )
          : [],
      },
      duration: {
        allLabel: "Any length",
        allCount: durationPool.length,
        options: withCounts(
          DURATION_OPTIONS,
          durationPool,
          (provider, value) =>
            provider.shortestDuration != null && provider.shortestDuration <= Number(value),
          maxDuration
        ),
      },
      delivery: {
        allLabel: "In person or online",
        allCount: deliveryPool.length,
        options: withCounts(
          DELIVERY_FILTER_OPTIONS,
          deliveryPool,
          (provider, value) => (provider.deliveryTypes ?? []).includes(value),
          deliveryType
        ),
      },
      scope: {
        allLabel: "Anywhere",
        allCount: scopePool.length,
        options: withCounts(
          SCOPE_FILTER_OPTIONS,
          scopePool,
          (provider, value) => (provider.bookingScopes ?? []).includes(value),
          bookingScope
        ),
      },
    };
  }, [
    providers,
    matchesFilters,
    priceBounds,
    category,
    minRating,
    priceBand,
    maxDuration,
    deliveryType,
    bookingScope,
  ]);

  const visible = useMemo(() => {
    const filtered = providers.filter((provider) => matchesFilters(provider));

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

      // Highest first, and unrated last in either case — for the same reason an
      // unpriced provider sorts last above. `null` would otherwise subtract to
      // NaN and leave the comparator undefined.
      const left = a.ratingAverage;
      const right = b.ratingAverage;
      if (left == null || right == null) {
        if (left == null && right == null) return 0;
        return left == null ? 1 : -1;
      }
      return right - left;
    });
  }, [providers, matchesFilters, sort]);

  const {
    pageItems,
    page,
    setPage,
    pageCount,
    from: firstRow,
    to: lastRow,
  } = usePagination(visible, PAGE_SIZE);

  const hasFilters =
    Boolean(category) ||
    Boolean(minRating) ||
    Boolean(priceBand) ||
    Boolean(maxDuration) ||
    Boolean(deliveryType) ||
    Boolean(bookingScope) ||
    sort !== "relevance" ||
    Boolean(search.trim());

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
            Narrow by category, appointment type, rating, price or session length. All times are
            shown in your own timezone.
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

          {/* Not `lg:sticky` any more.

              A sticky element taller than the viewport pins its top and puts its
              bottom permanently out of reach — there is no scroll left to bring
              it up. With one filter group the rail was short enough for that
              never to happen; with four it is the tallest column on the page,
              and on a laptop screen the last group would have been unreachable.

              Giving it its own `overflow-y-auto` would fix that and hand the page
              back the second scrollbar this change exists to remove. Sticky also
              bought very little here now: the rail is taller than the results
              beside it, so it is what sets the page height, and there is almost
              nothing to scroll past it. */}
          <div className={`${filtersOpen ? "mt-4 flex" : "hidden"} flex-col gap-6 lg:mt-0 lg:flex`}>
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

            <FilterGroup
              title="Category"
              group={filterGroups.category}
              active={category}
              onSelect={(value) => setParam("category", value)}
            />

            <FilterGroup
              title="Rating"
              group={filterGroups.rating}
              active={minRating}
              onSelect={(value) => setParam("rating", value)}
            />

            {/* High in the rail, above price and length, because it is the
                filter most likely to rule a provider out entirely: someone who
                cannot travel is not comparing prices between clinics they
                cannot reach. */}
            <FilterGroup
              title="Appointment type"
              group={filterGroups.delivery}
              active={deliveryType}
              onSelect={(value) => setParam("delivery", value)}
            />

            <div className="flex flex-col gap-2">
              <FilterGroup
                title="Who can book"
                group={filterGroups.scope}
                active={bookingScope}
                onSelect={(value) => setParam("scope", value)}
              />
              {/* Filters on what the provider has decided, not on whether this
                  reader is eligible — the two differ, and conflating them would
                  be the more tempting mistake. "Same country only" means the
                  service is restricted to the *provider's* country, which may or
                  may not be the reader's; each service card and the booking page
                  answer the eligibility question for them, because only those
                  know both countries. */}
              {filterGroups.scope.options.length > 1 && (
                <p className="font-caption text-caption text-on-surface-variant">
                  Whether a provider limits bookings to their own country. Each service
                  says if it is open to you.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <FilterGroup
                title="Price"
                group={filterGroups.price}
                active={priceBand}
                onSelect={(value) => setParam("price", value)}
              />
              {/* Said next to the control, not just in the source. The bands are
                  thirds of this list, and a reader who assumes they are amounts
                  would draw the wrong conclusion from them — this directory
                  quotes prices in several currencies, and Slotly deliberately
                  does not convert between them. */}
              {filterGroups.price.options.length > 1 && (
                <p className="font-caption text-caption text-on-surface-variant">
                  Relative to the providers listed here. Prices stay in each
                  provider&apos;s own currency and are never converted.
                </p>
              )}
            </div>

            <FilterGroup
              title="Session length"
              group={filterGroups.duration}
              active={maxDuration}
              onSelect={(value) => setParam("duration", value)}
            />

            {/* No availability filter, and that is a decision rather than an
                omission — see the note at the top of this file. Availability is
                resolved per provider, per service, on demand, so the directory
                has nothing to filter on and guessing would be worse than the
                gap. */}
          </div>
        </aside>

        {/* Results */}
        <div className="flex w-full flex-1 flex-col gap-6">
          <div className="border-b border-outline-variant pb-4">
            <div className="flex items-center justify-between">
              {/* The count line goes quiet while loading rather than saying
                  "Loading providers…" — the skeleton grid immediately below is
                  already answering that, for the same request, and two
                  announcements of one fetch is one too many. This was also the
                  only place in the app that used a text string as a loading
                  state for a fetch. */}
              <span className="font-small text-small text-on-surface-variant">
                {initialLoading ? (
                  <SkeletonBlock className="h-4 w-40" />
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

            {/* What the chosen ordering actually does.

                "Recommended" was the default and said nothing about itself, which
                is the worst combination: the reader cannot tell whether the list
                is ranked by quality, by distance, by who paid, or by nothing —
                and an unexplained default ordering in a marketplace invites the
                assumption that it favours the platform. Every option carries a
                sentence rather than only that one, because the others make
                claims worth qualifying too: the price sorts compare across
                currencies, and "Highest rated" has to say where the unrated go. */}
            <p className="mt-2 flex items-start gap-1.5 font-caption text-caption text-on-surface-variant">
              <Icon name="info" size={14} className="mt-px shrink-0" />
              <span>{activeSort.hint}</span>
            </p>
          </div>

          <Refreshing active={searching}>
            {initialLoading ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  // `variant="card"` — this grid holds provider *cards*, and
                  // the default "row" variant draws an avatar-and-two-lines
                  // strip, so the placeholder was the wrong shape for what
                  // replaced it and the grid jumped when the real cards landed.
                  // `ServicesPage` already used "card" for the same job.
                  <SkeletonRows key={i} count={1} variant="card" label="Loading providers…" />
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
                {/* One scrollbar on this page, not two.

                    The grid used to be its own scroll region from `lg`, so that
                    the heading, rail and pager stayed put while the cards moved.
                    The cost was a second scrollbar inside the first: a wheel
                    gesture did different things depending on which few hundred
                    pixels the pointer happened to be over, and reaching the
                    pager meant scrolling the inner region to its end before the
                    outer one would budge at all. The rail is `lg:sticky`, so it
                    already stays in view under a normal page scroll — which was
                    most of what the scroller was for.

                    `md:auto-rows-fr` is what makes every card the same height.
                    Grid rows size to their own content, so with two rows of two
                    the second row was as tall as its tallest card and the first
                    row as tall as its own — one bio longer than another was
                    enough to leave the grid visibly ragged. Equal rows plus the
                    footer's existing `mt-auto` puts every "Starting at" line at
                    the same height across the page. Not below `md`, where a
                    single column would only mean padding every short card out to
                    match the tallest one. */}
                <ul className="grid grid-cols-1 gap-6 md:auto-rows-fr md:grid-cols-2">
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
          </Refreshing>
        </div>
      </div>
    </div>
  );
}

/**
 * The value from `options` matching `raw`, or the empty string.
 *
 * Every filter goes through here on the way out of the URL, so a hand-edited or
 * stale `?rating=banana` is no filter at all rather than a filter that silently
 * matches nobody and leaves the reader looking at an empty directory.
 */
function pickOption(options, raw) {
  return options.some((option) => option.value === raw) ? raw : "";
}

/**
 * The two prices that cut a list of providers into thirds, in the common unit
 * `comparablePrice` produces. `null` when there are too few prices to divide.
 *
 * The boundary is the *last* member of each third rather than the first of the
 * next, because `inPriceBand` closes each band at the top. Taking
 * `floor(n / 3)` instead puts the boundary one place too high, which at three
 * providers hands two of them to the cheapest band and leaves the dearest band
 * with nobody in it — a third of the control, permanently empty.
 */
function priceTertiles(providers) {
  const values = providers
    .map((provider) => comparablePrice(provider.fromPrice, provider.currency))
    .filter((value) => value != null)
    .sort((a, b) => a - b);

  if (values.length < 2) return null;

  return {
    low: values[Math.ceil(values.length / 3) - 1],
    high: values[Math.ceil((values.length * 2) / 3) - 1],
  };
}

/**
 * Which of the three price bands a provider's cheapest service falls in.
 *
 * Bands are open at the bottom and closed at the top, so every priced provider
 * lands in exactly one of them and none lands in two. A provider with no
 * published price lands in none: being unpriced is not being cheap, which is the
 * same call the price sort makes when it puts them last in both directions.
 */
function inPriceBand(provider, band, bounds) {
  if (!bounds) return true;

  const value = comparablePrice(provider.fromPrice, provider.currency);
  if (value == null) return false;

  if (band === "low") return value <= bounds.low;
  if (band === "mid") return value > bounds.low && value <= bounds.high;
  return value > bounds.high;
}

/**
 * One group of mutually exclusive filter options, with an "any" row on top.
 *
 * Hidden when it has fewer than two real options, because a group whose only
 * choice selects everything already on screen cannot change what you are looking
 * at. An active selection keeps it visible regardless — a filter the reader has
 * set has to stay somewhere they can see it and undo it.
 */
function FilterGroup({ title, group, active, onSelect }) {
  const { options, allLabel, allCount } = group;
  if (options.length < 2 && !active) return null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-small text-small font-semibold text-on-surface">{title}</h3>
      <ul className="flex flex-col gap-2">
        <li>
          <FilterOption
            label={allLabel}
            count={allCount}
            checked={active === ""}
            onSelect={() => onSelect("")}
          />
        </li>
        {options.map((option) => (
          <li key={option.value}>
            <FilterOption
              label={option.label}
              count={option.count}
              checked={active === option.value}
              onSelect={() => onSelect(option.value)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One filter row.
 *
 * The reference draws checkboxes. Only one category can apply at a time, given
 * the filter is a single value — so these are buttons wearing a checkbox, and a
 * second click on the same one does not silently untick its neighbour.
 */
function FilterOption({ label, count, checked, onSelect }) {
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
              {/* Two lines, not one. `truncate` gave the name a single line and
                  the service count beside it takes a third of the card's width,
                  so anything longer than about twenty characters — which is most
                  business names — was cut off mid-word with no way to read the
                  rest. Now that the cards are all one height there is room for
                  the second line, and clamping at two still stops a very long
                  name from pushing the card out of shape. */}
              <h3 className="line-clamp-2 font-body-lg text-body-lg font-semibold text-on-surface transition-colors group-hover:text-primary">
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

          {/* The stars, in the slot the reference gives them. They were absent
              because `GET /providers` did not aggregate a rating; it does now,
              and a directory offering a "4 and up" filter has to show what it
              filtered on — otherwise the reader has to take the filter's word
              for it. Omitted entirely rather than shown as zero when nobody has
              reviewed yet: an empty row of stars reads as a bad provider rather
              than a new one. */}
          {(provider.ratingAverage != null || provider.timezone) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-on-surface-variant">
              {provider.ratingAverage != null && (
                <StarRatingDisplay value={provider.ratingAverage} count={provider.ratingCount} />
              )}
              {provider.timezone && (
                <span className="flex items-center gap-1 font-caption text-caption">
                  <Icon name="public" size={14} />
                  {zoneName(provider.timezone)}
                </span>
              )}
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

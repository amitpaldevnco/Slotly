// The provider directory — where a client starts.
import { memo, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import Page, { PageHeader, Toolbar } from "../components/ui/Page";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import { Select } from "../components/ui/Field";
import EmptyState, { ErrorState, SkeletonRows } from "../components/ui/Feedback";
import Pagination, { usePagination } from "../components/ui/Pagination";
import {
  cardInteractive,
  inputClasses,
  ghostButton,
  buttonSm,
  chipClasses,
  formatPrice,
  formatDuration,
  metaLine,
  zoneName,
} from "../lib/ui";


const SEARCH_DEBOUNCE_MS = 300;

// Providers per page. Nine fills a three-column grid exactly. 
const PAGE_SIZE = 9;

const SORT_OPTIONS = [
  { value: "relevance", label: "Best match" },
  { value: "price", label: "Lowest price" },
  { value: "services", label: "Most services" },
];

export default function ProvidersPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("relevance");

  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

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

  const categories = useMemo(() => {
    const counts = new Map();
    for (const provider of providers) {
      if (!provider.businessType) continue;
      counts.set(provider.businessType, (counts.get(provider.businessType) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [providers]);

  const visible = useMemo(() => {
    const filtered = category
      ? providers.filter((provider) => provider.businessType === category)
      : providers;

    if (sort === "relevance") return filtered;

    return [...filtered].sort((a, b) => {
      if (sort === "price") {
        // A provider with no published price sorts last rather than first, which
        // is what `null` compares as by default.
        const left = a.fromPrice == null ? Infinity : Number(a.fromPrice);
        const right = b.fromPrice == null ? Infinity : Number(b.fromPrice);
        return left - right;
      }
      return (b.serviceCount || 0) - (a.serviceCount || 0);
    });
  }, [providers, category, sort]);

  const { pageItems, page, pageCount, setPage, total, from, to } = usePagination(visible, PAGE_SIZE);

  const hasFilters = Boolean(category) || sort !== "relevance" || Boolean(search.trim());

  const clearAll = () => {
    setSearch("");
    setCategory("");
    setSort("relevance");
  };

  return (
    <Page>
      <PageHeader
        title="Find a provider"
        description="Browse who is available, pick a service, and choose a time. Every time you see is shown in your own timezone."
      />

      <Toolbar className="mb-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor="provider-search" className="sr-only">
            Search providers
          </label>
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            id="provider-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, business or category…"
            className={`${inputClasses} pl-9`}
          />
        </div>

        {categories.length > 1 && (
          <Select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-auto min-w-[11rem]"
          >
            <option value="">All categories</option>
            {categories.map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
          </Select>
        )}

        <Select
          aria-label="Sort providers"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="w-auto min-w-[9.5rem]"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        {hasFilters && (
          <button type="button" onClick={clearAll} className={`${ghostButton} ${buttonSm} ml-auto`}>
            <Icon name="close" size={14} />
            Clear
          </button>
        )}
      </Toolbar>

      <div
        aria-busy={searching}
        className={`transition-opacity duration-150 motion-reduce:transition-none ${
          searching ? "opacity-55" : "opacity-100"
        }`}
      >
        {initialLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonRows key={i} count={1} />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="search"
            title={hasFilters ? "No providers match that search" : "No providers yet"}
            description={
              hasFilters
                ? "Try a different name, business or category."
                : "Once providers publish their services they will appear here."
            }
            {...(hasFilters ? { actionLabel: "Clear filters", onAction: clearAll } : {})}
          />
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((provider) => (
                <li key={provider.id}>
                  <ProviderCard provider={provider} />
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageCount={pageCount}
              onChange={setPage}
              total={total}
              from={from}
              to={to}
              unit="provider"
              className="mt-4"
            />
          </>
        )}
      </div>
    </Page>
  );
}

const ProviderCard = memo(function ProviderCard({ provider }) {
  return (
    <Link
      to={`/providers/${provider.id}`}
      className={`${cardInteractive} flex h-full flex-col gap-3 p-3.5`}
    >
      <div className="flex items-start gap-3">
        <Avatar src={provider.avatarUrl} name={provider.name} size="lg" />

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">
            {provider.businessName || provider.name}
          </h2>
          <p className="truncate text-xs text-ink-3">
            {provider.businessName ? provider.name : provider.businessType || "Provider"}
          </p>

          
        </div>
      </div>

      {provider.bio && <p className="line-clamp-2 text-xs leading-relaxed text-ink-2">{provider.bio}</p>}

      <div className="mt-auto space-y-2 border-t border-line-soft pt-2.5">
        {provider.businessType && (
          <span className={chipClasses}>
            <Icon name="tag" size={11} />
            {provider.businessType}
          </span>
        )}

        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink-3">
            {metaLine(
              `${provider.serviceCount} service${provider.serviceCount === 1 ? "" : "s"}`,
              provider.shortestDuration != null
                ? `from ${formatDuration(provider.shortestDuration)}`
                : null
            )}
          </span>
          {provider.fromPrice != null && (
            <span className="shrink-0 font-semibold tabular-nums text-ink">
              {formatPrice(provider.fromPrice)}
              <span className="font-normal text-ink-3">+</span>
            </span>
          )}
        </div>

        {provider.timezone && (
          <p className="flex items-center gap-1 truncate text-xs text-ink-3">
            <Icon name="globe" size={11} />
            {zoneName(provider.timezone)}
          </p>
        )}
      </div>
    </Link>
  );
});

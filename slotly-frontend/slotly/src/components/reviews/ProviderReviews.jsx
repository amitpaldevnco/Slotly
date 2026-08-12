//The reviews section on a provider's public page.

import * as providersApi from "../../api/providers";
import { useApiResource } from "../../hooks/useApiResource";
import { StarRatingDisplay } from "./StarRating";
import { Section } from "../ui/Page";
import EmptyState, { ErrorState, SkeletonRows } from "../ui/Feedback";
import Pagination, { usePagination } from "../ui/Pagination";
import { formatShortDate } from "../../lib/time";

/** Reviews per page. */
const PAGE_SIZE = 5;

export default function ProviderReviews({ providerId, providerName, isOwner, viewerZone }) {
  const { data, loading, error, reload } = useApiResource(
    ({ signal }) => providersApi.listReviews(providerId, { signal }),
    { deps: [providerId], fallback: "Could not load reviews." }
  );

  const reviews = data?.reviews ?? [];
  const summary = data?.summary;

  const { pageItems, page, pageCount, setPage, total, from, to } = usePagination(reviews, PAGE_SIZE);

  return (
    <Section
      headingId="reviews-heading"
      title="Reviews"
      actions={
        summary?.average != null && (
          <StarRatingDisplay value={summary.average} count={summary.count} />
        )
      }
      flush
    >
      {loading ? (
        <div className="px-4 py-4">
          <SkeletonRows count={2} variant="line" />
        </div>
      ) : error ? (
        <div className="px-4 py-4">
          <ErrorState message={error} onRetry={reload} bare />
        </div>
      ) : reviews.length === 0 ? (
        <EmptyState
          compact
          icon="star"
          title="No reviews yet"
          description={
            isOwner
              ? "Clients can leave a review after an appointment is completed. They appear here automatically."
              : `${providerName} has not been reviewed yet.`
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-line-soft">
            {pageItems.map((review) => (
              <li key={review.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <StarRatingDisplay value={review.rating} showValue={false} />
                  <p className="text-xs text-ink-3">
                    {review.author.firstName}
                    {review.serviceName && ` · ${review.serviceName}`} ·{" "}
                    {formatShortDate(review.createdAt, viewerZone)}
                  </p>
                </div>

                {review.comment && (
                  <p className="mt-2 max-w-[68ch] whitespace-pre-line text-[0.8125rem] leading-relaxed text-ink">
                    {review.comment}
                  </p>
                )}

                {review.providerReply && (
                  <div className="mt-2.5 border-l-2 border-brand-line bg-subtle px-3 py-2">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3">
                      Reply from {providerName}
                    </p>
                    <p className="mt-1 max-w-[68ch] whitespace-pre-line text-[0.8125rem] leading-relaxed text-ink">
                      {review.providerReply}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="border-t border-line px-4 py-2.5">
            <Pagination
              page={page}
              pageCount={pageCount}
              onChange={setPage}
              total={total}
              from={from}
              to={to}
              unit="review"
            />
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * Public provider endpoints: the discovery directory and one provider's profile.
 *
 * Both are readable without signing in — a provider's page is their shopfront,
 * and a client comparing three physiotherapists should not have to register
 * first. That is why everything here is deliberately narrow about what it
 * selects: the fields are listed one by one rather than returning the row, so no
 * amount of later schema growth can start publishing a provider's email address
 * or password hash to anonymous callers.
 *
 * Neither endpoint reveals anything about a client. The counts on a profile
 * ("42 appointments delivered", "18 clients served") are aggregates over
 * bookings; no individual booking, name or time crosses this boundary.
 */
import { query } from "../config/dbConfig.js";
import { successResponse, errorResponse, ERROR_CODES } from "../responseController/responseHandler.js";
import { rawTypesForCategorySearch } from "../utils/categories.js";

/**
 * GET /api/providers — public.
 *
 * Query: search, businessType, limit (default 50, max 100).
 *
 * ## What `search` looks at
 *
 * The provider's name, their business name, **the names of the services they
 * offer**, and their category — including the category's other spellings.
 *
 * Services were the gap. The directory's search box has always been labelled
 * "Search by name or service…", and the topbar's "Search providers, services…",
 * but the query only ever looked at the three columns on `users`. So a client
 * who knew what they wanted — "Haircut", "Math Tuition – 1 Hour" — and typed it
 * got an empty directory, while the same words were sitting in `services` one
 * join away. Searching by the thing you want to book is the most obvious way to
 * use a booking site, and it was the one way that did not work.
 *
 * Category matching goes through `rawTypesForCategorySearch` rather than an
 * `ILIKE` on the column, so that typing a category finds the same providers as
 * clicking that category in the sidebar. Matching the raw text alone meant
 * "Healthcare" returned the four providers stored under that exact word and
 * skipped the physiotherapists the sidebar files under it.
 *
 * All four are OR'd: a term needs to match any one of them, so nothing that was
 * findable before has become unfindable.
 */

export const listProviders = async (req, res) => {
  try {
    const { search, businessType } = req.query;
    // Rejected rather than clamped. Clamping turned nonsense into a plausible
    // answer: `?limit=-5` became 1, so a caller with an off-by-one bug got a
    // single provider back and no hint that the API had silently disagreed with
    // them. An absent limit still means "use the default"; a limit that is
    // present has to be a real number in range.
    let limit = 50;
    if (req.query.limit !== undefined && req.query.limit !== "") {
      const parsed = Number(req.query.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return errorResponse(
          res,
          "`limit` must be a whole number between 1 and 100",
          400,
          ERROR_CODES.VALIDATION_FAILED,
          [{ field: "limit", message: "limit must be a whole number between 1 and 100" }]
        );
      }
      limit = parsed;
    }
    const conditions = ["u.role = 'provider'"];
    const params = [];
    const term = search && String(search).trim() ? String(search).trim() : null;

    // Holds the $n of the `%term%` pattern once bound, so the lateral join below
    // can reuse the same parameter to report *which* services matched.
    let patternParam = null;

    if (term) {
      // The wildcards are added here rather than being taken from the query
      // string, so a search for "100%" is matched literally instead of the %
      // becoming a wildcard.
      params.push(`%${term}%`);
      patternParam = params.length;

      const clauses = [
        `u.name ILIKE $${patternParam}`,
        `u.business_name ILIKE $${patternParam}`,
        `u.business_type ILIKE $${patternParam}`,
        // The service names. `EXISTS` rather than a join, so a provider with
        // three matching services is still one row -- a join would multiply
        // them and the directory would list the same practice three times.
        //
        // Gated on `is_active` for the same reason the counts and prices above
        // are: a retired service is not bookable, so finding a provider by one
        // would be an invitation to a dead end.
        `EXISTS (
           SELECT 1 FROM services s2
           WHERE s2.provider_id = u.id
             AND s2.is_active
             AND s2.service_name ILIKE $${patternParam}
         )`,
      ];

      // A term that names a category matches every stored spelling of it. Empty
      // when the term names no category at all, in which case no clause is added
      // -- an empty ANY(...) would match nothing and is simply not the question
      // being asked.
      const categoryTypes = rawTypesForCategorySearch(term);
      if (categoryTypes.length > 0) {
        params.push(categoryTypes);
        clauses.push(`lower(u.business_type) = ANY($${params.length})`);
      }

      conditions.push(`(${clauses.join("\n          OR ")})`);
    }

    if (businessType && String(businessType).trim()) {
      params.push(String(businessType).trim());
      conditions.push(`u.business_type = $${params.length}`);
    }

    params.push(limit);

    // Which of this provider's services matched the term, so a card can say why
    // it is in the results. Without it, searching "Haircut" returns a list of
    // salons with nothing on any card containing the word "Haircut", and the
    // results look arbitrary.
    //
    // Only built when there is a term; an unfiltered directory has no "matched"
    // to report and should not pay for the join.
    const matchedServices = patternParam
      ? `, (
           SELECT array_agg(s3.service_name ORDER BY s3.service_name)
           FROM services s3
           WHERE s3.provider_id = u.id
             AND s3.is_active
             AND s3.service_name ILIKE $${patternParam}
         ) AS matched_services`
      : "";

    // The service count and cheapest price come from a lateral join rather than
    // a follow-up query per provider, so the directory costs one round trip
    // however many providers it returns.
    const result = await query(
      `SELECT u.id, u.name, u.avatar_url, u.bio, u.timezone,
              u.business_name, u.business_type, u.currency,
              stats.service_count, stats.min_price, stats.min_duration,
              ratings.average AS rating_average, ratings.count AS rating_count${matchedServices}
       FROM users u
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS service_count,
                MIN(price)    AS min_price,
                MIN(duration) AS min_duration
         FROM services s
         WHERE s.provider_id = u.id AND s.is_active
       ) stats ON TRUE
       -- The headline rating, for the same reason the service count is here: the
       -- directory sorts and filters on it, and a card that offers a "4 stars and
       -- up" filter has to be able to show what it filtered on. A second lateral
       -- keeps that free -- the directory is still one round trip however many
       -- providers it returns, where a follow-up request per card would be N.
       --
       -- Rounded to one decimal place because GET /providers/:id and
       -- GET /providers/:id/reviews both round the same way. A card reading 4.3
       -- above a profile reading 4.25 is one dataset contradicting itself
       -- depending on which screen you are looking at.
       LEFT JOIN LATERAL (
         SELECT ROUND(AVG(rating)::numeric, 1) AS average,
                COUNT(*)::int                  AS count
         FROM reviews r
         WHERE r.provider_id = u.id
       ) ratings ON TRUE
       WHERE ${conditions.join(" AND ")}
       ORDER BY stats.service_count DESC NULLS LAST, u.name ASC
       LIMIT $${params.length}`,
      params
    );

    return successResponse(res, "Providers fetched", {
      count: result.rows.length,
      providers: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        avatarUrl: row.avatar_url,
        bio: row.bio,
        timezone: row.timezone,
        businessName: row.business_name,
        businessType: row.business_type,
        serviceCount: row.service_count ?? 0,
        // Denominates `fromPrice` below. Without it the directory renders every
        // provider's cheapest service in one assumed currency, which is wrong
        // for all but one of them.
        currency: row.currency,
        fromPrice: row.min_price,
        shortestDuration: row.min_duration,
        // Named as GET /providers/:id names them, so a caller moving between the
        // directory and a profile reads the same two fields.
        //
        // `null` rather than 0 when nobody has reviewed yet, which is how the
        // reviews endpoint reports it too: "no reviews" and "rated zero" are
        // different facts, and an empty star row renders the second.
        ratingAverage: row.rating_average === null ? null : Number(row.rating_average),
        ratingCount: row.rating_count ?? 0,
        // Present only on a search, and only for providers matched through a
        // service name. `[]` rather than null when a provider matched on their
        // own name instead, so a caller can render it without a type check.
        matchedServices: row.matched_services ?? [],
      })),
    });
  } catch (err) {
    console.error("listProviders error:", err.message);
    return errorResponse(res, "Could not fetch providers", 500);
  }
};

/**
 * Booking statuses that count towards a provider's public track record.
 *
 * **`no_show` is included alongside `completed` by product decision.** The
 * reasoning is the provider's: the appointment reached its scheduled time, the
 * slot was held, and the provider turned up — whether the client did is not
 * something the provider controls. The alternative reading, that only
 * `completed` counts because only then did someone actually receive the service,
 * is equally defensible; this is a judgement call, not a correctness one.
 *
 * What matters is that it is applied *consistently*: the same list drives both
 * the appointment count and the distinct-client count, so "clients served" can
 * never exceed "appointments completed" — which is the kind of contradiction a
 * reader notices immediately.
 *
 * `cancelled` is excluded, and `booked` / `rescheduled` are excluded because
 * they have not happened yet. A future appointment is not a track record.
 */
const DELIVERED_STATUSES = ["completed", "no_show"];

/**
 * GET /api/providers/:id — public.
 *
 * `attachUserIfPresent` runs before this, so `req.user` may or may not be set;
 * the request is never blocked either way. `isOwner` lets the page render the
 * provider's own editing controls without a second request.
 *
 * ## The statistics
 *
 * Computed on read from `bookings` and `services`, never stored. There is no
 * counter column to drift out of step with the rows it counts, and cancelling a
 * booking corrects the figures for free — the same reasoning that keeps
 * availability as rules rather than pre-generated slot rows.
 *
 * Everything returned here is an aggregate that reveals nothing about an
 * individual client: a count of appointments, a count of distinct clients, a
 * count of services. **Earnings are deliberately absent** — `price_snapshot`
 * sums are owner-only and live in `getServicesByProvider` and
 * `getBookingSummary`, both of which check the caller first. A stranger has no
 * business knowing what a provider earns.
 */
export const getProviderProfile = async (req, res) => {
  try {
    // One round trip. The two counts are correlated subqueries rather than a
    // GROUP BY join because a provider with no bookings and no services must
    // still return a row with zeros, not disappear from the result set.
    const result = await query(
      `SELECT u.id, u.name, u.avatar_url, u.bio, u.timezone,
              u.business_name, u.business_type, u.qualifications, u.currency,
              u.cancellation_cutoff_hours, u.role,
              (SELECT COUNT(*)::int FROM bookings b
                 WHERE b.provider_id = u.id AND b.status = ANY($2)) AS delivered_appointments,
              (SELECT COUNT(DISTINCT b.client_id)::int FROM bookings b
                 WHERE b.provider_id = u.id AND b.status = ANY($2)) AS clients_served,
              (SELECT COUNT(*)::int FROM services s
                 WHERE s.provider_id = u.id AND s.is_active) AS active_services,
              -- Folded in here rather than exposed as a fourth request: the
              -- profile page always wants the headline rating, and only opens the
              -- full list (GET /providers/:id/reviews) when the reader scrolls to
              -- it. AVG returns NULL with no rows, which is deliberately passed
              -- through as null so the UI shows nothing instead of "0.0 stars".
              (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews r
                 WHERE r.provider_id = u.id) AS rating_average,
              (SELECT COUNT(*)::int FROM reviews r
                 WHERE r.provider_id = u.id) AS rating_count
       FROM users u
       WHERE u.id = $1`,
      [req.params.id, DELIVERED_STATUSES]
    );

    if (result.rows.length === 0 || result.rows[0].role !== "provider") {
      return errorResponse(res, "Provider not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const provider = result.rows[0];

    return successResponse(res, "Provider fetched", {
      id: provider.id,
      name: provider.name,
      avatar_url: provider.avatar_url,
      bio: provider.bio,
      timezone: provider.timezone,
      business_name: provider.business_name,
      business_type: provider.business_type,
      qualifications: provider.qualifications,
      currency: provider.currency,
      cancellationCutoffHours: provider.cancellation_cutoff_hours,
      isOwner: Boolean(req.user && req.user.userId === provider.id),
      // Exact figures, never rounded into "500+" buckets. At this scale a bucket
      // would be a lie in both directions — "500+" for 512 is fine, but the same
      // presentation applied to 3 completed appointments is not, and the UI
      // cannot know which case it is holding.
      stats: {
        completedAppointments: provider.delivered_appointments,
        clientsServed: provider.clients_served,
        activeServices: provider.active_services,
        // null, not 0, when nobody has reviewed yet — see the query comment.
        ratingAverage: provider.rating_average === null ? null : Number(provider.rating_average),
        ratingCount: provider.rating_count,
      },
    });
  } catch (err) {
    console.error("getProviderProfile error:", err.message);
    return errorResponse(res, "Server error", 500);
  }
};

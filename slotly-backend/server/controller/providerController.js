import { query } from "../config/dbConfig.js";
import { successResponse, errorResponse, ERROR_CODES } from "../responseController/responseHandler.js";

/**
 * GET /api/providers — public.
 *
 * Query: search (matches name, business name or business type), businessType,
 * limit (default 50, max 100).
 */

export const listProviders = async (req, res) => {
  try {
    const { search, businessType } = req.query;
    // Clamped rather than rejected: a silly `limit` should not fail the request,
    // it should just not let one caller ask for the whole table.
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const conditions = ["u.role = 'provider'"];
    const params = [];
    if (search && String(search).trim()) {
      // The wildcards are added here rather than being taken from the query
      // string, so a search for "100%" is matched literally instead of the %
      // becoming a wildcard.
      params.push(`%${String(search).trim()}%`);
      conditions.push(
        `(u.name ILIKE $${params.length}
          OR u.business_name ILIKE $${params.length}
          OR u.business_type ILIKE $${params.length})`
      );
    }

    if (businessType && String(businessType).trim()) {
      params.push(String(businessType).trim());
      conditions.push(`u.business_type = $${params.length}`);
    }

    params.push(limit);
    // The service count and cheapest price come from a lateral join rather than
    // a follow-up query per provider, so the directory costs one round trip
    // however many providers it returns.
    const result = await query(
      `SELECT u.id, u.name, u.avatar_url, u.bio, u.timezone,
              u.business_name, u.business_type, u.currency,
              stats.service_count, stats.min_price, stats.min_duration
       FROM users u
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS service_count,
                MIN(price)    AS min_price,
                MIN(duration) AS min_duration
         FROM services s
         WHERE s.provider_id = u.id AND s.is_active
       ) stats ON TRUE
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

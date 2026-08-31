// The public landing page.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/ui/Icon";
import { SkeletonBlock } from "../components/ui/Feedback";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { categoryIcon, groupByCategory } from "../lib/categories";
import {
  container,
  primaryButton,
  secondaryButton,
  buttonLg,
} from "../lib/ui";
import { DISCOVERY_ROUTE } from "../lib/discovery";
import HERO_IMAGE  from "../assets/HERO_IMAGE.png";
import CONSULTING_IMAGE  from "../assets/CONSULTING_IMAGE.jpg";
import usePageTitle from "../hooks/usePageTitle";

/**
 * The two photographs the design places in the hero and in the large category
 * tile. They are named here rather than inline so a swap to self-hosted files
 * later is one edit in one place, and so the markup below stays readable.
 */

/** The publications strip under the hero's call to action. */
const PRESS = ["Secure Scheduling", "Easy Booking", "Built for Professionals"];

/**
 * How many tiles the bento grid has room for: one photographic feature and two
 * small ones beside it.
 */
const TILE_COUNT = 3;

/** `/providers?category=Healthcare` — the directory reads this on mount. */
const categoryHref = (category) =>
  `${DISCOVERY_ROUTE}?category=${encodeURIComponent(category)}`;

/**
 * The categories these tiles offer, read from the directory they link into.
 *
 * They used to be three hard-coded names — Consulting, Healthcare, Fitness —
 * which was half a fix. An earlier pass had already corrected them from linking
 * to the bare directory to applying a real `?category=`, so the link works; what
 * it could not fix is that the names are a guess about who has signed up. On the
 * current data two of the three are empty, so the most prominent invitation on
 * the landing page sends a first-time visitor to "No providers match that
 * search" — the worst possible first answer, and one they get by doing exactly
 * what the page told them to.
 *
 * Counting the directory instead means a tile exists only if it has providers
 * behind it, and the count under each name comes from the same grouping the
 * client dashboard's category card uses, so the two cannot disagree.
 *
 * Non-fatal by design: this is one public request, and the landing page must
 * still render its hero and its calls to action if it fails. A rejection
 * resolves to an empty list, and an empty list hides the section rather than
 * heading a hole with "Explore by Category".
 */
function useCategoryTiles() {
  const { data, loading } = useApiResource(
    ({ signal }) => providersApi.list({}, { signal }).catch(() => ({ providers: [] })),
    { deps: [], initialData: { providers: [] } }
  );

  const tiles = useMemo(
    () => groupByCategory(data?.providers, TILE_COUNT),
    [data]
  );

  return { tiles, loading };
}

/** "12 active providers" — the same wording the dashboard's card uses. */
const providerCount = (count) => `${count} active provider${count === 1 ? "" : "s"}`;

export default function LandingPage() {
  usePageTitle(null);

  return (
    <div>
      {/* ---- Hero --------------------------------------------------------- */}
      <section
        className={`${container} grid grid-cols-1 items-center gap-12 py-16 lg:grid-cols-2 lg:py-24`}
      >
        <div className="space-y-8">
          {/* The design's 64px display step. Stepped down twice on the way to a
              phone, because 64px is half the width of a 375px screen. */}
          <h1 className="max-w-2xl font-display text-h1-mobile text-primary sm:text-h1 lg:text-display">
            Find the right professional. Book the right time.
          </h1>

          <p className="max-w-xl font-body-lg text-body-lg text-on-surface-variant">
            Slotly connects you with top-tier professionals across healthcare, consulting, and
            personal services. Experience frictionless scheduling designed for the modern world.
          </p>

          <div className="flex flex-wrap gap-4">
            <Link to={DISCOVERY_ROUTE} className={`${primaryButton} ${buttonLg}`}>
              Find a Professional
              <Icon name="arrowRight" size={20} />
            </Link>
            <Link to="/login" className={`${secondaryButton} ${buttonLg}`}>
              Join as a provider
            </Link>
          </div>

          {/* Trust indicators. Greyscale and held back, so they read as a
              footnote to the call to action rather than competing with it. */}
          <div className="flex flex-wrap items-center gap-6 border-t border-outline-variant pt-8 opacity-70 grayscale sm:gap-8">
            {PRESS.map((name) => (
              <span key={name} className="font-h3 text-h3 text-on-surface-variant">
                {name}
              </span>
            ))}
          </div>
        </div>

        <div className="relative flex h-[320px] w-full items-center justify-center overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low sm:h-[440px] lg:h-[600px]">
          <img
            src={HERO_IMAGE}
            alt="Slotly's scheduling interface, showing a month of availability with one slot selected."
            loading="eager"
            className="h-full w-full object-cover"
          />
        </div>
      </section>

      {/* ---- Categories (bento) ------------------------------------------- */}
      <CategorySection />
    </div>
  );
}

/**
 * "Explore by Category" — the bento grid, filled from the live directory.
 *
 * Hidden entirely once it is known there is nothing to show. A heading that
 * promises categories over an empty grid is worse than the section not being
 * there, and on a brand-new deployment with no providers that is exactly what
 * the old hard-coded tiles produced: three invitations, all of them dead ends.
 */
function CategorySection() {
  const { tiles, loading } = useCategoryTiles();

  if (!loading && tiles.length === 0) return null;

  const [featured, ...rest] = tiles;

  return (
    <section className={`${container} py-16`}>
      <div className="mb-12">
        <h2 className="font-h2 text-h2 text-primary">Explore by Category</h2>
        <p className="mt-2 font-body text-body text-on-surface-variant">
          Discover curated professionals tailored to your specific needs.
        </p>
      </div>

      <div className="grid auto-rows-[240px] grid-cols-1 gap-6 md:grid-cols-3">
        {loading ? (
          /* The tiles keep their footprint while the count is being fetched, so
             the hero above does not jump when they arrive. */
          <>
            <SkeletonBlock className="h-full w-full rounded-xl md:col-span-2 md:row-span-2" />
            <SkeletonBlock className="h-full w-full rounded-xl" />
            <SkeletonBlock className="h-full w-full rounded-xl" />
          </>
        ) : (
          <>
            {/* The feature tile: two columns wide, two rows tall from `md`. It
                carries a photograph rather than an icon, which is why it is
                spelled out here instead of going through the map below. */}
            <Link
              to={categoryHref(featured.name)}
              className="group relative overflow-hidden rounded-xl border border-outline-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:col-span-2 md:row-span-2"
            >
              {/* Decorative, hence the empty alt: it sets the mood of the tile
                  and the heading below carries the meaning. One generic
                  photograph serves whichever category ranks first, because
                  there is no per-category art to switch to. */}
              <img
                src={CONSULTING_IMAGE}
                alt=""
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
              {/* The gradient is what keeps the label legible over a photograph
                  whose brightness is not ours to control. */}
              <div className="absolute inset-0 bg-gradient-to-t from-primary/80 to-transparent" />

              <div className="absolute bottom-0 left-0 w-full p-6 text-on-primary sm:p-8">
                <Icon name={categoryIcon(featured.name)} size={36} className="mb-2" />
                <h3 className="mb-1 font-h3 text-h3 text-on-primary">{featured.name}</h3>
                <p className="font-small text-small text-on-primary/80">
                  {providerCount(featured.count)}
                </p>
              </div>
            </Link>

            {rest.map(({ name, count }) => (
              <Link
                key={name}
                to={categoryHref(name)}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-outline-variant bg-surface p-6 transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container-low text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
                  <Icon name={categoryIcon(name)} size={24} />
                </span>

                <div>
                  <h3 className="mb-1 font-h3 text-[20px] font-semibold leading-tight text-primary">
                    {name}
                  </h3>
                  <p className="font-small text-small text-on-surface-variant">
                    {providerCount(count)}
                  </p>
                </div>
              </Link>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

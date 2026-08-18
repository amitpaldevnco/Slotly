// The public landing page.

import { Link } from "react-router-dom";
import Icon from "../components/ui/Icon";
import {
  container,
  primaryButton,
  secondaryButton,
  buttonLg,
} from "../lib/ui";
import { DISCOVERY_ROUTE } from "../lib/discovery";
import HERO_IMAGE  from "../assets/HERO_IMAGE.png";
import CONSULTING_IMAGE  from "../assets/CONSULTING_IMAGE.jpg";

/**
 * The two photographs the design places in the hero and in the large category
 * tile. They are named here rather than inline so a swap to self-hosted files
 * later is one edit in one place, and so the markup below stays readable.
 */

/** The publications strip under the hero's call to action. */
const PRESS = ["Secure Scheduling", "Easy Booking", "Built for Professionals"];

/**
 * The two small tiles in the bento grid. The large one is spelled out in the
 * markup because it carries a photograph and an overlay rather than an icon.
 */
const CATEGORIES = [
  {
    icon: "stethoscope",
    title: "Healthcare",
    body: "Therapy, Nutrition & Wellness",
  },
  {
    icon: "fitness_center",
    title: "Fitness",
    body: "Personal Training & Yoga",
  },
];

export default function LandingPage() {
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
              Join as a Services Provider
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
      <section className={`${container} py-16`}>
        <div className="mb-12">
          <h2 className="font-h2 text-h2 text-primary">Explore by Category</h2>
          <p className="mt-2 font-body text-body text-on-surface-variant">
            Discover curated professionals tailored to your specific needs.
          </p>
        </div>

        <div className="grid auto-rows-[240px] grid-cols-1 gap-6 md:grid-cols-3">
          {/* The feature tile: two columns wide, two rows tall from `md`. */}
          <Link
            to={DISCOVERY_ROUTE}
            className="group relative overflow-hidden rounded-xl border border-outline-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:col-span-2 md:row-span-2"
          >
            <img
              src={CONSULTING_IMAGE}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
            {/* The gradient is what keeps the label legible over a photograph
                whose brightness is not ours to control. */}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/80 to-transparent" />

            <div className="absolute bottom-0 left-0 w-full p-6 text-on-primary sm:p-8">
              <Icon name="lightbulb" size={36} className="mb-2" />
              <h3 className="mb-1 font-h3 text-h3 text-on-primary">Business Consulting</h3>
              <p className="font-small text-small text-on-primary/80">
                Strategy, Finance &amp; Operations
              </p>
            </div>
          </Link>

          {CATEGORIES.map((category) => (
            <Link
              key={category.title}
              to={DISCOVERY_ROUTE}
              className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-outline-variant bg-surface p-6 transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container-low text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
                <Icon name={category.icon} size={24} />
              </span>

              <div>
                <h3 className="mb-1 font-h3 text-[20px] font-semibold leading-tight text-primary">
                  {category.title}
                </h3>
                <p className="font-small text-small text-on-surface-variant">{category.body}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

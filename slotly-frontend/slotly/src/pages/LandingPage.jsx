
 // The public landing page.

import { Link } from "react-router-dom";
import Icon from "../components/ui/Icon";
import { container, primaryButton, secondaryButton, buttonLg, eyebrow } from "../lib/ui";
import { DISCOVERY_ROUTE, DISCOVERY_LABEL } from "../lib/discovery";

const ROLE_COLUMNS = [
  {
    eyebrow: "For clients",
    title: "Find a slot, book it, done.",
    icon: "user",
    points: [
      "Sign in with Google or GitHub — no password to set or forget.",
      "See a provider's open times already converted to your timezone.",
      "Book a slot and it is locked immediately — no waiting for confirmation.",
      "One dashboard for every appointment, across every provider.",
    ],
  },
  {
    eyebrow: "For providers",
    title: "Run your schedule, not a spreadsheet.",
    icon: "briefcase",
    points: [
      "Publish services with a duration, a price and their own buffers.",
      "Set weekly hours once; clients always see them in their own zone.",
      "Double-booking is rejected by the database, not just by the interface.",
      "A day and week calendar, drawn in your timezone whatever device you use.",
    ],
  },
];

const STEPS = [
  {
    title: "Sign in",
    body: "One click with Google or GitHub, or an email and a password. No verification email to wait on.",
  },
  {
    title: "Tell us who you are",
    body: "Client or provider. Providers add a business name and category; both set a timezone.",
  },
  {
    title: "Book, or get booked",
    body: "Clients pick from times that are genuinely free. Providers manage what comes in.",
  },
];

export default function LandingPage() {
  return (
    <div>

      <section className={`${container} py-12 sm:py-16`}>
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className={eyebrow}>Appointment booking, built for two sides</p>
            <h1 className="mt-2.5 text-3xl font-semibold leading-[1.15] tracking-tight text-ink sm:text-4xl">
              Every appointment, exactly on time.
            </h1>
            <p className="mt-4 max-w-md text-[0.9375rem] leading-relaxed text-ink-2">
              Slotly has two sides: clients who need a slot, and providers who manage a schedule.
              Sign in, tell us which one you are, and the rest is set up for you.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/login" className={`${primaryButton} ${buttonLg}`}>
                Get started free
              </Link>
              {/* Was "Browse providers" — the same destination the navbar and
                  footer call "Find a provider". One name for one page. */}
              <Link to={DISCOVERY_ROUTE} className={`${secondaryButton} ${buttonLg}`}>
                <Icon name="search" size={16} />
                {DISCOVERY_LABEL}
              </Link>
            </div>

            <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
              <Icon name="check" size={13} className="text-brand" />
              Free to use · No card required
            </p>
          </div>

          
          <DayIllustration />
        </div>
      </section>

      {/* ---- Two roles ---------------------------------------------------- */}
      <section className="border-t border-line bg-surface">
        <div className={`${container} py-14`}>
          <h2 className="max-w-lg text-2xl font-semibold tracking-tight text-ink">
            One app, two roles — each with what it actually needs.
          </h2>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {ROLE_COLUMNS.map((column) => (
              <div key={column.eyebrow} className="rounded-lg border border-line bg-canvas p-5">
                <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-brand">
                  <Icon name={column.icon} size={13} />
                  {column.eyebrow}
                </p>
                <h3 className="mt-1.5 text-base font-semibold tracking-tight text-ink">
                  {column.title}
                </h3>

                <ul className="mt-4 space-y-2.5">
                  {column.points.map((point) => (
                    <li key={point} className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
                      <Icon name="check" size={15} className="mt-0.5 text-brand" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- How it works ------------------------------------------------- */}
      <section className="border-t border-line">
        <div className={`${container} py-14`}>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">How it works</h2>

          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                {/* The number is the only thing telling a reader these three are a
                    sequence, so it uses the accent at full strength rather than a
                    tint of it — a lighter green measured 2.8:1 here. */}
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-2.5 text-sm font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---- Close -------------------------------------------------------- */}
      <section className="border-t border-line bg-surface">
        <div className={`${container} py-12 text-center`}>
          <h2 className="text-xl font-semibold tracking-tight text-ink">
            Whichever side you are on, start here.
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">
            Sign in and pick client or provider on the next step — or look around first.
          </p>
          {/* The closing section previously offered only "Get started free", so
              the one thing a visitor can do without an account disappeared after
              the hero. Both routes are offered here, matching the hero pair. */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/login" className={`${primaryButton} ${buttonLg}`}>
              Get started free
            </Link>
            <Link to={DISCOVERY_ROUTE} className={`${secondaryButton} ${buttonLg}`}>
              <Icon name="search" size={16} />
              {DISCOVERY_LABEL}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}


function DayIllustration() {
  const hours = ["9", "10", "11", "12", "1", "2", "3", "4"];
  const highlight = 3;

  return (
    <div aria-hidden="true" className="relative rounded-xl bg-dark px-6 py-7 pb-14 sm:px-8">
      <div className="flex flex-col">
        {hours.map((hour, i) => {
          const isHighlight = i === highlight;

          return (
            <div key={hour} className="flex items-center gap-3.5 py-2">
              <span
                
                className={`w-5 shrink-0 text-right font-mono text-xs tabular-nums ${
                  isHighlight ? "text-dark-ink" : "text-dark-3"
                }`}
              >
                {hour}
              </span>
              <div className="relative flex-1">
                <div className={`h-px w-full ${isHighlight ? "bg-transparent" : "bg-dark-line"}`} />
                {isHighlight && (
                  <div className="absolute inset-y-0 left-0 flex items-center gap-2.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-dark-accent motion-safe:animate-pulse" />
                    <span className="h-px w-9 bg-dark-accent" />
                    <span className="text-xs font-medium text-dark-accent">2:30 PM · Confirmed</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute -bottom-6 left-6 right-6 rounded-lg border border-line bg-surface p-4 shadow-float sm:left-8 sm:right-8">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Booked with
        </p>
        <p className="mt-0.5 text-sm font-semibold text-ink">Sharma Skin Clinic</p>
        <div className="mt-2.5 flex items-center justify-between gap-3 text-xs">
          <span className="text-ink-2">Tue, 12:00 PM · Asia/Kolkata</span>
          <span className="rounded-full border border-brand-line bg-brand-soft px-2 py-0.5 font-medium text-brand-ink">
            Confirmed
          </span>
        </div>
      </div>
    </div>
  );
}

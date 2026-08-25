/**
 * The site footer.
 *
 * Rendered only by the public shell (see `Layout`), so there is no signed-in
 * variant — the application shell carries its own one-line colophon instead.
 *
 * Four columns from `md`: the wordmark and the copyright, then Product, Legal
 * and Support. Light rather than inverted, because the design gives the footer
 * the same `surface` tone as the page and separates it with a single rule — the
 * same "flat but tactile" idea every card on the site is built on.
 */

import { Link } from "react-router-dom";
import Logo from "./ui/Logo";
import { LEGAL_ROUTES } from "./ui/LegalLinks";
import { DISCOVERY_ROUTE, DISCOVERY_LABEL } from "../lib/discovery";
import { container } from "../lib/ui";

/**
 * The link columns.
 *
 * `to` is an internal route; `href` is anything else.
 *
 * Every one of these was `href: "#"` — seven labels that looked like navigation
 * and did nothing, two of them documents the sign-up card asks people to agree
 * to. They now point at real pages (see `pages/LegalPage`), except the two that
 * described features Slotly does not have: there is no pricing, because nothing
 * is charged for, and a "Features" page listing what a visitor can already see
 * on the landing page is filler. Those are replaced by the two links a visitor
 * to the footer actually wants — find someone to book, or read the FAQ.
 */
const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: DISCOVERY_LABEL, to: DISCOVERY_ROUTE },
      { label: "How booking works", to: LEGAL_ROUTES.help },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", to: LEGAL_ROUTES.privacy },
      { label: "Terms of Service", to: LEGAL_ROUTES.terms },
      { label: "Cookie Settings", to: LEGAL_ROUTES.cookies },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Contact Us", to: LEGAL_ROUTES.contact },
      { label: "Help Center", to: LEGAL_ROUTES.help },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="mt-auto w-full border-t border-outline-variant bg-surface">
      <div className={`${container} grid grid-cols-1 gap-gutter py-12 sm:grid-cols-2 md:grid-cols-4`}>
        <div className="space-y-4">
          <Logo size="sm" />
          <p className="font-caption text-caption text-on-surface-variant">
            © {new Date().getFullYear()} Slotly Inc. All rights reserved.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <FooterColumn key={column.title} title={column.title} links={column.links} />
        ))}
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="mb-2 font-small text-small font-semibold text-primary">{title}</h4>

      {links.map((link) => {
        // `w-fit` with vertical padding widens each hit area without moving the
        // text: at 12px these are the smallest targets on the page.
        const className =
          "-my-1 w-fit rounded-sm py-1 font-caption text-caption text-on-surface-variant " +
          "transition-colors hover:text-primary hover:underline focus-visible:outline " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

        return link.to ? (
          <Link key={link.label} to={link.to} className={className}>
            {link.label}
          </Link>
        ) : (
          <a key={link.label} href={link.href} className={className}>
            {link.label}
          </a>
        );
      })}
    </div>
  );
}

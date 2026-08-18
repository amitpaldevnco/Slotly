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
import { container } from "../lib/ui";

/**
 * The link columns.
 *
 * `to` is an internal route; `href` is anything else. Several of the design's
 * labels have no page behind them yet — those carry `href: "#"` and are listed
 * here rather than spelled out in the markup, so wiring each one up later is a
 * single edit in a single place and nothing in the layout has to move.
 */
const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#" },
      { label: "Pricing", href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "#" },
      { label: "Terms of Service", href: "#" },
      { label: "Cookie Settings", href: "#" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Contact Us", href: "#" },
      { label: "Help Center", href: "#" },
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

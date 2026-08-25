/**
 * Links to the policy pages, in the two places that name them.
 *
 * The sign-up card asks people to agree to the Terms and the Privacy Policy, and
 * the footer lists them. Both used to render the names as plain text — the
 * footer as `href="#"`, the sign-up line as no link at all — so a condition of
 * creating an account was stated and then made unreachable.
 *
 * Centralised rather than repeated because the two must not drift: the sign-up
 * line and the footer have to point at the same documents.
 */
import { Link } from "react-router-dom";

/** Where each document lives. Also used by `App` to build the routes. */
export const LEGAL_ROUTES = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  cookies: "/legal/cookies",
  contact: "/legal/contact",
  help: "/legal/help",
};

const linkClasses =
  "font-medium underline decoration-line-strong underline-offset-2 transition hover:text-ink";

function LegalLink({ to, children, className = "" }) {
  return (
    <Link to={to} className={`${linkClasses} ${className}`}>
      {children}
    </Link>
  );
}

const LegalLinks = {
  Terms: (props) => (
    <LegalLink to={LEGAL_ROUTES.terms} {...props}>
      Terms of Service
    </LegalLink>
  ),
  Privacy: (props) => (
    <LegalLink to={LEGAL_ROUTES.privacy} {...props}>
      Privacy Policy
    </LegalLink>
  ),
};

export default LegalLinks;

/**
 * Where "go and find someone to book with" leads, and what it is called.
 *
 * Both live here because they had drifted. The landing page said "Browse
 * providers", the navbar and footer said "Find a provider", and the client
 * dashboard offered "Book an appointment" — three names in three places for one
 * destination, which reads to a first-time visitor as three different features.
 *
 * `/providers` is the existing discovery route (see App.jsx); this adds no page
 * and changes no routing. It only gives every entry point one label and one
 * target to import, so the next CTA someone adds cannot quietly become a fourth
 * name for the same screen.
 */
export const DISCOVERY_ROUTE = "/providers";

/**
 * The wording, chosen because it was already the most-used: it is the discovery
 * page's own heading, and what the navbar and footer call it.
 */
export const DISCOVERY_LABEL = "Find a provider";

/**
 * The same destination, for places with no room for the full phrase — currently
 * the mobile header bar, where this sits beside a logo, a sign-up button and a
 * menu toggle on a 320px screen. Paired with a magnifier icon everywhere it is
 * used, which is what keeps the shorter word unambiguous.
 */
export const DISCOVERY_SHORT_LABEL = "Providers";

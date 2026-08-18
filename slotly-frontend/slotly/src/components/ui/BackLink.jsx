/**
 * "← Back" for a page that is not reachable from the sidebar.
 *
 * ## The problem this solves
 *
 * Several screens sit one level below a list — a provider's public page under
 * the directory, a booking under the appointments list — and the sidebar has no
 * entry for them, so once you are there the only way out is the browser's own
 * back button. That is fine on a laptop and genuinely awkward on a phone, where
 * the app is often installed to the home screen and there is no visible chrome.
 *
 * ## Why it is not simply `<Link to="/providers">`
 *
 * Because the same page is reached from more than one place, and a hardcoded
 * destination is wrong for all but one of them. A provider opening their own
 * public page from the dashboard's "View Public Profile" has not come from the
 * directory, and sending them there would be a non-sequitur.
 *
 * So this goes *back* when there is somewhere to go back to, and falls back to a
 * sensible list when there is not. `location.key` is React Router's own signal
 * for that: it is the string `"default"` only on the first entry of a session,
 * which is exactly the deep-link case — a shared URL, a new tab, a refresh —
 * where `navigate(-1)` would either do nothing or leave the app entirely.
 *
 * The label follows the same split: it names the fallback when it is going to
 * use it, and stays a plain "Back" when it is stepping through history, because
 * naming a destination the click will not reach is worse than not naming one.
 */

import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon";

/**
 * @param {object} props
 * @param {string} props.fallbackTo Where to go when there is no history to pop —
 *   the list this page belongs under.
 * @param {string} [props.fallbackLabel] What to call that destination, e.g.
 *   "All providers". Shown only when the fallback is what will actually happen.
 * @param {string} [props.className] Extra classes for layout at the call site.
 */
export default function BackLink({ fallbackTo, fallbackLabel, className = "" }) {
  const navigate = useNavigate();
  const location = useLocation();

  // "default" means this is the first entry in the history stack — the page was
  // opened directly rather than navigated to.
  const canGoBack = location.key !== "default";

  return (
    <button
      type="button"
      onClick={() => (canGoBack ? navigate(-1) : navigate(fallbackTo))}
      className={`inline-flex items-center gap-1.5 font-small text-small text-on-surface-variant transition-colors hover:text-primary ${className}`}
    >
      <Icon name="arrow_back" size={18} />
      {canGoBack || !fallbackLabel ? "Back" : fallbackLabel}
    </button>
  );
}

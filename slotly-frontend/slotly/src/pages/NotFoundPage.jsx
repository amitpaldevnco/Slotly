/**
 * Catch-all route.
 *
 * Offers the two places a lost visitor actually wants — the directory and their
 * dashboard — rather than a dead end with a back button.
 */
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import { primaryButton, secondaryButton } from "../lib/ui";

export default function NotFoundPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink-3">
        <Icon name="search" size={20} />
      </span>

      <p className="mt-4 font-mono text-xs font-medium tracking-wide text-ink-3">404</p>
      <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink">This page does not exist</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        The link may be out of date, or the page may have moved.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to={user ? "/dashboard" : "/"} className={primaryButton}>
          {user ? "Your dashboard" : "Back home"}
        </Link>
        <Link to="/providers" className={secondaryButton}>
          Find a provider
        </Link>
      </div>
    </div>
  );
}

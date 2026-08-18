/**
 * Catch-all route.
 *
 * Offers the two places a lost visitor actually wants — the directory and their
 * dashboard — rather than a dead end with a back button.
 */
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import { primaryButton, secondaryButton, eyebrow } from "../lib/ui";

export default function NotFoundPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-subtle text-ink-3">
        <Icon name="search" size={26} />
      </span>

      <p className={`mt-6 ${eyebrow}`}>Error 404</p>

      <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
        This page does not exist
      </h1>
      <p className="mt-3 text-base leading-relaxed text-ink-2">
        The link may be out of date, or the page may have moved.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
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

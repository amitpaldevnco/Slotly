/**
 * Subscribe to a CSS media query from React.
 *
 * For the cases where a `lg:` class is not enough — where the breakpoint decides
 * whether a subtree is *mounted*, not just whether it is visible. The provider
 * page's booking sheet is one: it is a focus trap that locks body scroll, so
 * rendering it on a desktop and hiding it with a class would still trap the
 * keyboard and freeze the page behind it.
 *
 * Read during the initial render rather than in an effect, so the first paint is
 * already right — a sheet that mounts on the second frame flashes.
 */
import { useEffect, useState } from "react";

export default function useMediaQuery(query) {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;

  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);

    // Re-read on subscribe: the query can already have flipped between the
    // render that seeded state and this effect — a phone rotated during the
    // first paint, or a desktop window dragged narrower.
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

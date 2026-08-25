/**
 * Sets `document.title` for the page that calls it.
 *
 * Every route rendered the same title — "Slotly" — because a single-page app
 * never reloads the document and nothing was updating it. Three things depend on
 * that string and all three were broken by it:
 *
 *   - **Browser history and bookmarks.** Six identical entries called "Slotly"
 *     are not a history anyone can navigate.
 *   - **Tabs.** Two Slotly tabs open on different screens were indistinguishable.
 *   - **Screen readers.** On a real navigation the browser announces the new
 *     document title. Client-side routing produces no such event, so the title is
 *     the only signal available, and an unchanging one tells a screen-reader user
 *     the page never changed.
 *
 * @param {string|null|undefined} title The page's own name, without the suffix.
 *   Falsy leaves the bare app name, which is right for the landing page and for a
 *   page still loading the thing it is named after.
 */
import { useEffect } from "react";

/** Appended so a tab is identifiable when the title itself is generic. */
const SUFFIX = "Slotly";

export default function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX;

    // Restored on unmount so a page that unmounts without another mounting --
    // an error boundary, a redirect -- does not leave the previous screen's name
    // in the tab.
    return () => {
      document.title = SUFFIX;
    };
  }, [title]);
}

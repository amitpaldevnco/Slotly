/**
 * The app's one dialog: a focus trap, an overlay, and a close affordance.
 *
 * Everything modal in Slotly goes through here — confirming a cancellation,
 * editing a service, rescheduling — so the keyboard behaviour is implemented
 * once. A dialog that can be tabbed out of into the page behind it is a common
 * and genuinely disorienting bug, which is what the trap below exists to
 * prevent.
 */
import { useEffect, useRef } from "react";
import Icon from "./Icon";
import { iconButtonTouch } from "../../lib/ui";

/** Elements that can hold focus. Used to find the trap's first and last stop. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
};


export default function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
}) {
  const panelRef = useRef(null);

  // Held in a ref so the effect below can call the current handler without
  // listing it as a dependency. Every call site passes an inline arrow, so
  // `onClose` is a different function on each render of the parent — and while
  // it was a dependency, typing in a field inside the dialog re-ran the effect
  // and pulled focus back to the panel after every keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Keyed on `open` alone: this runs when the dialog opens and closes, never
  // while the user is typing in it.
  useEffect(() => {
    if (!open) return undefined;

    // Remember where focus came from so it can be handed back on close. Captured
    // before anything moves it.
    const previouslyFocused = document.activeElement;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      // The focus trap. The list is read on each Tab rather than cached once,
      // because the dialog's contents change while it is open — the reschedule
      // dialog swaps in a slot list, and a stale list would let Tab land on a
      // button that no longer exists.
      const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusable.length === 0) {
        // Nothing to land on — keep focus on the panel rather than letting it
        // escape to the page underneath.
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap at both ends. Without this, Tab past the last control walks into
      // the page behind the backdrop, where the focus ring is invisible.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(document.activeElement)) {
        // Focus somehow started outside — pull it back in.
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    // Freeze the page behind the dialog; without this, scrolling inside the
    // modal scrolls the list underneath once the modal reaches its end.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the dialog. The first real control is preferred over the
    // panel itself so a keyboard user starts on something actionable rather than
    // having to Tab once to reach it.
    const initial = panelRef.current?.querySelector(FOCUSABLE);
    (initial || panelRef.current)?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;

      // Hand focus back to whatever opened the dialog — the slot button, the
      // Cancel button — so the user resumes where they left off instead of at
      // the top of the document. Guarded because that element can be gone by
      // now: confirming a booking navigates away, and cancelling one re-renders
      // the card that held the trigger.
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-dark/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        // Without this the click would bubble to the backdrop handler above and
        // close the dialog the moment the user touched anything inside it.
        onClick={(event) => event.stopPropagation()}
        // On a phone the dialog is a sheet: full width, anchored to the bottom,
        // rounded only at the top. A centred 24px-inset card on a 375px screen
        // wastes the width it most needs, and a sheet puts the actions where the
        // thumb already is.
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-lg border border-line bg-surface shadow-float outline-none sm:max-h-[85vh] sm:rounded-lg ${
          SIZES[size] || SIZES.md
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-xs text-ink-3">{description}</p>}
          </div>

          {/* A full touch target: this is the first thing focus lands on when the
              dialog opens and often the first thing a thumb reaches for. The
              negative margin keeps the glyph optically aligned with the title
              despite the larger hit area. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${iconButtonTouch} -mr-2 -mt-1.5`}
          >
            <Icon name="close" size={17} />
          </button>
        </div>

        {/* The body scrolls, not the dialog. With the whole panel scrolling, a
            long slot list pushed the footer's Confirm button out of reach and
            the title out of view. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-subtle px-5 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

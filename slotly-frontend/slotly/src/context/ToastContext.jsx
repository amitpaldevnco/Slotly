//In-app notifications.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/ui/Icon";

const ToastContext = createContext(null);

const DEFAULT_DURATION_MS = 5000;

const VARIANTS = {
  success: { className: "border-brand-line bg-brand-soft text-brand-ink", icon: "check" },
  error: { className: "border-danger-line bg-danger-soft text-danger-ink", icon: "alert" },
  info: { className: "border-line bg-surface text-ink", icon: "info" },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // Timeouts are tracked so they can be cleared on unmount; without this, a
  // dismissal firing after the provider has gone would set state on nothing.
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));

    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, { variant = "info", duration = DEFAULT_DURATION_MS, title } = {}) => {
      const id = crypto.randomUUID();

      // Newest first, capped at four. An action that fires several messages
      // should not bury the page under a stack of them.
      setToasts((current) => [{ id, message, variant, title }, ...current].slice(0, 4));

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        );
      }

      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (message, options) => push(message, { ...options, variant: "success" }),
      error: (message, options) => push(message, { ...options, variant: "error" }),
      info: (message, options) => push(message, { ...options, variant: "info" }),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* aria-live="polite" so a screen reader announces each message without
          interrupting whatever the user is currently doing. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:top-0 sm:items-end sm:p-6"
      >
        {toasts.map((toast) => {
          const variant = VARIANTS[toast.variant] || VARIANTS.info;

          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-float ${variant.className}`}
            >
              <Icon name={variant.icon} size={16} className="mt-0.5" />

              <div className="min-w-0 flex-1">
                {toast.title && <p className="text-sm font-semibold">{toast.title}</p>}
                <p
                  className={`break-words leading-snug ${
                    toast.title ? "mt-0.5 text-[0.8125rem]" : "text-sm"
                  }`}
                >
                  {toast.message}
                </p>
              </div>

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="-mr-1 shrink-0 rounded p-1 opacity-60 transition hover:opacity-100"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}


export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

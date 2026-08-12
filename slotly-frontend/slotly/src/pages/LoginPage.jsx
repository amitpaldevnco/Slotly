//  Sign in and sign up.

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "../context/AuthContext";
import { parseApiError } from "../api/client";
import * as authApi from "../api/auth";
import Field, { Input } from "../components/ui/Field";
import { Alert } from "../components/ui/Feedback";
import Icon from "../components/ui/Icon";
import Logo from "../components/ui/Logo";
import { primaryButton, buttonBlock, buttonLg, secondaryButton } from "../lib/ui";

const HOURS = ["9", "10", "11", "12", "1", "2", "3", "4", "5"];
const HIGHLIGHT_INDEX = 3;

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

/**
 * The Google button, drawn to match the GitHub one.
 *
 * `<GoogleLogin>` renders a cross-origin iframe: its logo offset, font and text
 * alignment live inside Google's document and no stylesheet of ours reaches
 * them, so side by side with our own button the two never lined up. The fix is
 * to draw the button ourselves and lay Google's real one on top of it,
 * transparent and stretched to the same box, so it stays the thing that is
 * actually clicked. That keeps the ID-token flow — and therefore
 * `POST /auth/google` — exactly as it was; `useGoogleLogin` would have styled
 * cleanly but hands back an access token the backend does not accept.
 *
 * Because the iframe sits above it, the visible layer never receives hover or
 * focus itself; both are mirrored from the wrapper via `group-*`.
 */
function GoogleButton({ onSuccess, onError }) {
  return (
    <div className="group relative">
      <div
        aria-hidden="true"
        className={`${secondaryButton} ${buttonBlock} ${buttonLg} pointer-events-none
          group-hover:border-ink-3/40 group-hover:bg-canvas
          group-focus-within:outline group-focus-within:outline-2
          group-focus-within:outline-offset-2 group-focus-within:outline-brand`}
      >
        <GoogleMark />
        Continue with Google
      </div>

      {/*
        Google's own button: full-bleed, and invisible rather than `opacity-0`
        so it keeps rendering. The trailing `!` beats the width and height GSI
        writes inline on the iframe, which would otherwise leave the lower
        strip of our button dead to the pointer.
      */}
      <div
        className="absolute inset-0 overflow-hidden opacity-[0.001]
          [&>div]:h-full [&>div]:w-full [&_iframe]:h-full! [&_iframe]:w-full!"
      >
        <GoogleLogin
          onSuccess={onSuccess}
          onError={onError}
          theme="outline"
          size="large"
          shape="rectangular"
          width="352"
        />
      </div>
    </div>
  );
}

function HourRail() {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {HOURS.map((hour, i) => {
        const isHighlight = i === HIGHLIGHT_INDEX;

        return (
          <div key={hour} className="flex items-center gap-3 py-2">
            <span
              className={`w-5 shrink-0 text-right font-mono text-xs tabular-nums ${
                isHighlight ? "text-dark-ink" : "text-dark-3"
              }`}
            >
              {hour}
            </span>
            <div className="relative flex-1">
              <div className={`h-px w-full ${isHighlight ? "bg-transparent" : "bg-dark-line"}`} />
              {isHighlight && (
                <div className="absolute inset-y-0 left-0 flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-dark-accent motion-safe:animate-pulse" />
                  <span className="h-px w-8 bg-dark-accent" />
                  <span className="text-xs font-medium text-dark-accent">2:30 PM · Confirmed</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [error, setError] = useState("");
  const [conflictNotice, setConflictNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { refetchUser } = useAuth();

  // Where to land after signing in. A guard or a "Sign in to book" link puts the
  // page the user was actually reaching for in `location.state.from`, so they
  // resume what they were doing instead of being dropped on the dashboard.
  const redirectTo = location.state?.from || "/dashboard";

  const goAfterAuth = (profileComplete) => {
    navigate(profileComplete ? redirectTo : "/complete-profile", { replace: true });
  };

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) setError("GitHub sign-in was cancelled or failed. Please try again.");
  }, [searchParams]);

  const resetMessages = () => {
    setError("");
    setConflictNotice(null);
    setFieldErrors({});
  };

  const switchMode = (next) => {
    setMode(next);
    resetMessages();
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setLoading(true);
    resetMessages();
    try {
      const { profileComplete } = await authApi.loginWithGoogle(credentialResponse.credential);
      await refetchUser();
      goAfterAuth(profileComplete);
    } catch (err) {
      setError(parseApiError(err, "Google sign-in failed. Please try again.").message);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();

    setLoading(true);
    resetMessages();

    try {
      const { profileComplete } =
        mode === "register"
          ? await authApi.registerWithEmail({ name, email, password })
          : await authApi.loginWithEmail({ email, password });

      await refetchUser();
      goAfterAuth(profileComplete);
    } catch (err) {
      const parsed = parseApiError(err, "Something went wrong. Please try again.");

      if (parsed.status === 409) {
        const msg =
          parsed.message || "This email is already registered under a different sign-in method.";
        const lower = msg.toLowerCase();

        if (lower.includes("google")) {
          setConflictNotice({ provider: "google", message: msg });
        } else if (lower.includes("github")) {
          setConflictNotice({ provider: "github", message: msg });
        } else {
          setConflictNotice({ provider: "existing", message: msg });
        }

        return;
      }

      if (Object.keys(parsed.fieldErrors).length > 0) {
        setFieldErrors(parsed.fieldErrors);
        return;
      }

      setError(parsed.message);
    } finally {
      setLoading(false);
    }
  };

  const isRegister = mode === "register";

  return (
    <div className="flex flex-col lg:min-h-[calc(100dvh-3.5rem)] lg:flex-row">
      {/* Left panel — desktop only */}
      <div className="hidden w-[42%] flex-col justify-between bg-dark px-10 py-12 lg:flex">
        <Logo size="md" className="text-dark-ink" />
        <div>
          <p className="mb-6 max-w-xs text-xl font-semibold leading-snug tracking-tight text-dark-ink">
            Every appointment, exactly on time.
          </p>
          <HourRail />
        </div>

        <p className="text-xs text-dark-3">Built for providers and the clients who book them.</p>
      </div>

      {/* Right panel — the form */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
        <div className="w-full max-w-[22rem] animate-fade-in motion-reduce:animate-none">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-[1.375rem]">
            {isRegister ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            {isRegister
              ? "Set a password, or continue with Google or GitHub."
              : "Sign in to manage your appointments."}
          </p>

          <div className="mt-5 space-y-2">
            <GoogleButton
              onSuccess={handleGoogleSuccess}
              onError={() => setError("Google sign-in was cancelled or failed")}
            />

            <button
              type="button"
              onClick={() => {
                window.location.href = authApi.githubRedirectUrl();
              }}
              className={`${secondaryButton} ${buttonBlock} ${buttonLg}`}
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Continue with GitHub
            </button>
          </div>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="text-xs text-ink-3">or with email</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          {/* Account exists under a different sign-in method. */}
          {conflictNotice && (
            <Alert tone="warn" className="mb-4">
              {conflictNotice.message}
              {conflictNotice.provider === "google" && " Use the Google button above to continue."}
              {conflictNotice.provider === "github" && " Use the GitHub button above to continue."}
              {conflictNotice.provider === "existing" && isRegister && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="font-medium underline"
                  >
                    Log in instead
                  </button>
                </>
              )}
            </Alert>
          )}

          <form onSubmit={handleEmailAuth} noValidate className="space-y-3.5">
            {isRegister && (
              <Field id="name" label="Name" error={fieldErrors.name}>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </Field>
            )}

            <Field id="email" label="Email" error={fieldErrors.email}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>

            <Field
              id="password"
              label="Password"
              error={fieldErrors.password}
              hint={isRegister ? "At least 8 characters." : undefined}
            >
              <Input
                id="password"
                type="password"
                autoComplete={isRegister ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            <button
              type="submit"
              disabled={loading}
              className={`${primaryButton} ${buttonBlock} ${buttonLg}`}
            >
              {loading ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
            </button>
          </form>

          {error && (
            <Alert tone="error" className="mt-4">
              {error}
            </Alert>
          )}

          <p className="mt-4 text-center text-sm text-ink-2">
            {isRegister ? "Already have an account? " : "New here? "}
            <button
              type="button"
              onClick={() => switchMode(isRegister ? "login" : "register")}
              className="font-medium text-brand underline decoration-brand/35 underline-offset-2 transition hover:decoration-brand"
            >
              {isRegister ? "Sign in" : "Create an account"}
            </button>
          </p>

          <p className="mt-8 flex items-start gap-1.5 text-xs leading-relaxed text-ink-3">
            <Icon name="info" size={13} className="mt-px" />
            <span>By continuing, you agree to Slotly&apos;s Terms of Service and Privacy Policy.</span>
          </p>
        </div>
      </div>
    </div>
  );
}

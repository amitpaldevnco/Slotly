//  Sign in and sign up.

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "../context/AuthContext";
import { parseApiError } from "../api/client";
import * as authApi from "../api/auth";
import Field, { Input } from "../components/ui/Field";
import PasswordInput from "../components/ui/PasswordInput";
import LegalLinks from "../components/ui/LegalLinks";
import { NAME_MAX } from "../lib/validation";
import {
  checkEmail,
  checkName,
  checkPassword,
  checkPasswordConfirmation,
  collectErrors,
} from "../lib/validation";
import { Alert } from "../components/ui/Feedback";
import Icon from "../components/ui/Icon";
import Logo from "../components/ui/Logo";
import { primaryButton, buttonBlock, buttonLg, secondaryButton, cardClasses } from "../lib/ui";
import usePageTitle from "../hooks/usePageTitle";

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
          group-hover:border-line-strong group-hover:bg-subtle
          group-focus-within:outline group-focus-within:outline-2
          group-focus-within:outline-offset-2 group-focus-within:outline-brand`}
      >
        <GoogleMark />
        Google
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

export default function LoginPage() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [error, setError] = useState("");
  const [conflictNotice, setConflictNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { refetchUser, sessionExpired } = useAuth();

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

  /**
   * The rules for whichever form is on screen.
   *
   * Checked before the request rather than after it. Registration is rate
   * limited counting failures, so a form submitted empty used to spend one of
   * the ten attempts an address gets per hour purely to be told it was empty.
   */
  const validate = () => {
    if (mode === "register") {
      return collectErrors({
        name: checkName(name),
        email: checkEmail(email),
        password: checkPassword(password),
        confirmPassword: checkPasswordConfirmation(password, confirmPassword),
      });
    }

    return collectErrors({ email: checkEmail(email), password: checkPassword(password) });
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();

    resetMessages();

    const problems = validate();
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      return;
    }

    setLoading(true);

    try {
      const { profileComplete } =
        mode === "register"
          ? await authApi.registerWithEmail({ name: name.trim(), email: email.trim(), password })
          : await authApi.loginWithEmail({ email: email.trim(), password });

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

  const heading = isRegister ? "Create your account" : "Welcome back";

  const subheading = isRegister
    ? "Set a password, or continue with Google or GitHub."
    : "Log in to manage your appointments.";

  const submitLabel = isRegister ? "Create account" : "Log in";

  // Declared after `heading` on purpose: it is the same string, and calling the
  // hook above the `const` would read it inside its temporal dead zone.
  usePageTitle(heading);

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      {/* One centred card on the canvas, per the design. The form is the whole
          page here — there is nothing else to look at and nothing else to do. */}
      <div className="w-full max-w-[26rem] animate-fade-in motion-reduce:animate-none">
        <div className={`${cardClasses} p-6 sm:p-10`}>
          <div className="text-center">
            <Logo size="lg" />

            <h1 className="mt-6 font-display text-3xl font-semibold tracking-[-0.02em] text-ink">
              {heading}
            </h1>
            <p className="mt-2 text-[0.9375rem] text-ink-2">{subheading}</p>
          </div>

          {/* Why they are looking at a sign-in page they did not ask for. */}
          {sessionExpired && (
            <Alert tone="warn" className="mt-6">
              Your session has expired. Please sign in again to pick up where you left off.
            </Alert>
          )}

          {/* Account exists under a different sign-in method. */}
          {conflictNotice && (
            <Alert tone="warn" className="mt-6">
              {conflictNotice.message}
              {conflictNotice.provider === "google" && " Use the Google button below to continue."}
              {conflictNotice.provider === "github" && " Use the GitHub button below to continue."}
              {conflictNotice.provider === "existing" && isRegister && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="font-semibold underline"
                  >
                    Log in instead
                  </button>
                </>
              )}
            </Alert>
          )}

          <form onSubmit={handleEmailAuth} noValidate className="mt-8 space-y-5">
              {isRegister && (
                <Field id="name" label="Full name" error={fieldErrors.name} required>
                  <Input
                    type="text"
                    autoComplete="name"
                    maxLength={NAME_MAX}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                  />
                </Field>
              )}

              <Field id="email" label="Email address" error={fieldErrors.email} required>
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </Field>

              <Field
                id="password"
                label="Password"
                error={fieldErrors.password}
                required
                hint={isRegister ? "At least 8 characters." : undefined}
              >
                <PasswordInput
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </Field>

              {/* Asked for once more, because sign-up is the one moment a typo
                  becomes permanent: the password is never shown again and, until
                  the reset flow above existed, there was no way back into the
                  account at all. */}
              {isRegister && (
                <Field
                  id="confirmPassword"
                  label="Confirm password"
                  error={fieldErrors.confirmPassword}
                  required
                >
                  <PasswordInput
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
              )}

            <button
              type="submit"
              disabled={loading}
              className={`${primaryButton} ${buttonBlock} ${buttonLg}`}
            >
              {loading ? "Please wait…" : submitLabel}
            </button>
          </form>

          {error && (
            <Alert tone="error" className="mt-5">
              {error}
            </Alert>
          )}

          <div className="my-7 flex items-center gap-4">
            <div className="h-px flex-1 bg-line" />
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
              or continue with
            </span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <div className="space-y-3">
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
              GitHub
            </button>
          </div>

          <p className="mt-8 border-t border-line-soft pt-6 text-center text-sm text-ink-2">
            {isRegister ? "Already have an account? " : "Don't have an account? "}
            <button
              type="button"
              onClick={() => switchMode(isRegister ? "login" : "register")}
              className="font-semibold text-ink underline decoration-line-strong underline-offset-2 transition hover:decoration-ink"
            >
              {isRegister ? "Log in" : "Create account"}
            </button>
          </p>
        </div>

        {/* The two documents are named because agreeing to them is a condition of
            using the account, and something a person is asked to agree to has to
            be reachable from where they agree to it. They were plain text here. */}
        <p className="mt-6 flex items-start justify-center gap-1.5 text-xs leading-relaxed text-ink-3">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          <span>
            By continuing, you agree to Slotly&apos;s <LegalLinks.Terms /> and{" "}
            <LegalLinks.Privacy />.
          </span>
        </p>
      </div>
    </div>
  );
}

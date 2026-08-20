/**
 * Session state for the whole app.
 *
 * ## Why the session has to be fetched rather than read
 *
 * The token is an httpOnly cookie, which this JavaScript cannot see by design —
 * a script that can read the token is a script an attacker can steal it with.
 * So "am I signed in?" is not a local question: the app has to ask
 * `GET /auth/me` on every load and wait for the answer.
 *
 * That is where `loading` comes from, and why it starts `true`. Every consumer
 * must treat "loading" and "signed out" as different states; conflating them
 * shows signed-out UI to a signed-in user for one frame on every refresh, and
 * makes the route guards redirect people who were never logged out.
 *
 * `user` here is also the source of the viewer's timezone, which every screen
 * renders times in — so `refetchUser` after a profile change is what makes the
 * whole app re-read the clock, without touching a single booking.
 *
 * ## Unreachable is not signed out
 *
 * There are three answers to `GET /auth/me`, not two: a user, a 401, and no
 * reply at all. Only the 401 means "you are signed out". Treating a failed
 * request the same way logged people out whenever the API was briefly
 * unreachable — and on a free-tier host that sleeps after fifteen minutes, the
 * *first* request of a session routinely takes twenty to fifty seconds or times
 * out, so this fired for real users on the one request that matters most. They
 * arrived holding a perfectly valid cookie and were bounced to the sign-in page,
 * where signing in failed too, because the server was still waking up.
 *
 * So a network failure leaves `user` untouched and raises `offline` instead. The
 * route guards treat `offline` as "wait", not "leave", and `refetchUser` is the
 * retry. The distinction comes from `parseApiError`, which already separates
 * `NETWORK_ERROR` from an HTTP status for exactly this reason.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as authApi from "../api/auth";

const AuthContext = createContext(null);

/**
 * Provides the session to the tree and loads it once on mount.
 *
 * Exposes `{ user, setUser, loading, logout, refetchUser }`. `setUser` is for
 * the sign-in pages, which already hold the user the login call returned and
 * would otherwise trigger a redundant round trip; `refetchUser` is for anything
 * that changed the profile server-side.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  // Starts true so guards and the header render a loading state on first paint
  // instead of briefly showing signed-out UI to a signed-in user.
  const [loading, setLoading] = useState(true);

  // True when the last attempt to read the session never reached the server.
  // Distinct from `!user`: it means "unknown", not "nobody". See the note at the
  // top of this file for why conflating the two logged people out.
  const [offline, setOffline] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      setUser(await authApi.getCurrentUser());
      setOffline(false);
    } catch (err) {
      // No `response` at all means the request never arrived — DNS, a dropped
      // connection, a CORS refusal, or a host still waking from sleep. The
      // session is not known to be invalid, so it is left alone.
      if (!err?.response) {
        console.error("Could not reach the server to load the session:", err);
        setOffline(true);
        return;
      }

      // A 401 is the ordinary signed-out case, not an error worth logging.
      if (err.response.status !== 401) {
        console.error("Could not load the current session:", err);
      }
      setUser(null);
      setOffline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setOffline(false);
      // Cleared even if the request fails: the user asked to sign out, and
      // leaving them looking signed in is the worse outcome. The cookie expires
      // on its own regardless.
      setUser(null);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const value = useMemo(
    () => ({ user, setUser, loading, offline, logout, refetchUser: fetchUser }),
    [user, loading, offline, logout, fetchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Reads the session.
 *
 * @returns {{user: object|null, setUser: Function, loading: boolean,
 *   offline: boolean, logout: Function, refetchUser: Function}} `offline` is
 *   true when the session could not be read because the server was unreachable.
 *   Callers must not read that as signed out — see the note at the top of this
 *   file.
 * @throws {Error} When called outside `AuthProvider` — a wiring mistake that
 *   would otherwise surface as an unexplained null far from its cause.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

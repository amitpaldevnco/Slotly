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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as authApi from "../api/auth";
import { onSessionExpired } from "../api/client";

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

  // True when a session that *was* valid stopped being so mid-visit, as opposed
  // to a visitor who simply arrived signed out. Only the first case deserves an
  // explanation on the sign-in page; telling a first-time visitor their session
  // expired would be a lie.
  const [sessionExpired, setSessionExpired] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      setUser(await authApi.getCurrentUser());
      setOffline(false);
      // A session was just read successfully, so nothing is expired. This is
      // where the notice is retired — not when the sign-in page unmounts, which
      // under StrictMode happens once immediately after mounting and cleared the
      // flag before the render that would have shown it.
      setSessionExpired(false);
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
      // Signing out deliberately is not an expiry. Cleared here so the sign-in
      // page does not greet someone who just pressed Log Out with "your session
      // expired".
      setSessionExpired(false);
      // Cleared even if the request fails: the user asked to sign out, and
      // leaving them looking signed in is the worse outcome. The cookie expires
      // on its own regardless.
      setUser(null);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Mirrors `user` so the 401 handler below can read "was somebody signed in?"
  // without taking `user` as a dependency — which would re-subscribe the handler
  // on every sign-in and sign-out.
  const userRef = useRef(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Any authenticated request answering 401 means the cookie this app is holding
  // is no longer good. Dropping `user` is what lets the route guards do their
  // ordinary job and send the visitor to /login with `state.from` set, instead
  // of leaving them on a screen whose only content is an error they cannot act
  // on.
  //
  // The "was there a session?" test reads the ref rather than being folded into
  // a `setUser` updater. A state updater must be pure — React invokes it twice
  // under StrictMode — so raising the notice from inside one meant the flag was
  // set and then lost, and the sign-in page appeared with no explanation of why
  // the user was looking at it. It also guards the honest case: a stray 401 while
  // already signed out must not tell a first-time visitor their session expired.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (userRef.current) setSessionExpired(true);
        setUser(null);
      }),
    []
  );

  const value = useMemo(
    () => ({
      user,
      setUser,
      loading,
      offline,
      sessionExpired,
      logout,
      refetchUser: fetchUser,
    }),
    [user, loading, offline, sessionExpired, logout, fetchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Reads the session.
 *
 * @returns {{user: object|null, setUser: Function, loading: boolean,
 *   offline: boolean, sessionExpired: boolean, logout: Function,
 *   refetchUser: Function}} `offline` is true when the session
 *   could not be read because the server was unreachable. Callers must not read
 *   that as signed out — see the note at the top of this file. `sessionExpired`
 *   is true when a session that had been valid was rejected mid-visit, and is
 *   what the sign-in page uses to say so.
 * @throws {Error} When called outside `AuthProvider` — a wiring mistake that
 *   would otherwise surface as an unexplained null far from its cause.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

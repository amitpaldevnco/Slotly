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


  const fetchUser = useCallback(async () => {
    try {
      setUser(await authApi.getCurrentUser());
    } catch (err) {
      // A 401 is the ordinary signed-out case, not an error worth logging.
      if (err?.response?.status !== 401) {
        console.error("Could not load the current session:", err);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
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
    () => ({ user, setUser, loading, logout, refetchUser: fetchUser }),
    [user, loading, logout, fetchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Reads the session.
 *
 * @returns {{user: object|null, setUser: Function, loading: boolean,
 *   logout: Function, refetchUser: Function}}
 * @throws {Error} When called outside `AuthProvider` — a wiring mistake that
 *   would otherwise surface as an unexplained null far from its cause.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

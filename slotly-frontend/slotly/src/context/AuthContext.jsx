//Session state for the whole app.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as authApi from "../api/auth";

const AuthContext = createContext(null);

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

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

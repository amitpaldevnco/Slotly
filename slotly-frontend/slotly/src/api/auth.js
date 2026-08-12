/**
 * Everything the app can ask about, or do to, the current session.
 *
 * The session itself is an httpOnly cookie this JavaScript cannot read, so there
 * is no token to pass around here — each call simply rides the cookie the browser
 * already sends, and `getCurrentUser` is how the app discovers who that cookie
 * belongs to.
 */
import { api, unwrap, API_BASE_URL } from "./client";

// The signed-in user, or a 401 rejection when there is no session.
export const getCurrentUser = () => api.get("/auth/me").then(unwrap);

export const logout = () => api.post("/auth/logout");

export const registerWithEmail = (payload) => api.post("/auth/register", payload).then(unwrap);

export const loginWithEmail = (payload) => api.post("/auth/login", payload).then(unwrap);

export const loginWithGoogle = (credential) =>
  api.post("/auth/google", { credential }).then(unwrap);


export const githubRedirectUrl = () => `${API_BASE_URL}/auth/github`;

export const completeProfile = (payload) =>
  api.patch("/auth/complete-profile", payload).then(unwrap);

export const updateProfile = (formData) => api.patch("/auth/profile", formData).then(unwrap);

/**
 * Browser entry point.
 *
 * Mounts the app inside `GoogleOAuthProvider`, which has to wrap everything
 * rather than just the login page: it loads Google's script once, and the
 * sign-in button on any route needs it already present.
 *
 * `VITE_GOOGLE_CLIENT_ID` must match the `GOOGLE_CLIENT_ID` the API verifies ID
 * tokens against. If they differ, the button renders and sign-in then fails at
 * the server, which is a confusing way to find out about a typo.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App.jsx";
import "./index.css";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </StrictMode>
);
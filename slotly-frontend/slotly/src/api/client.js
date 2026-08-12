import axios from "axios";

// The one place the API's location is decided. Everything else — every resource
// module, and `imageUrl` below — builds on this, so there is a single value to
// change per environment and no hardcoded host anywhere in `src/`.
//
// The fallback covers a fresh clone with no `.env` yet. It is not a safety net in
// production: if the variable is missing from a deployed build, requests go to
// localhost, the browser cannot reach it, and every call reports
// "Cannot reach the server". That is a louder failure than defaulting to a
// relative path, which would return the SPA's own HTML for every API call and
// look like a parsing bug instead of a configuration one.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";


export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});


export const unwrap = (res) => res.data.data;


export function isCanceled(err) {
  return axios.isCancel(err);
}

export function parseApiError(err, fallback = "Something went wrong. Please try again.") {
  const response = err?.response;
  const data = response?.data;

  const fieldErrors = {};
  if (Array.isArray(data?.details)) {
    for (const detail of data.details) {
      if (detail?.field) fieldErrors[detail.field] = detail.message;
    }
  }

  return {
    message: data?.error || data?.message || (response ? fallback : "Cannot reach the server."),
    code: data?.code || (response ? "SERVER_ERROR" : "NETWORK_ERROR"),
    fieldErrors,
    status: response?.status ?? null,
    details: data?.details,
  };
}


export function imageUrl(path) {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

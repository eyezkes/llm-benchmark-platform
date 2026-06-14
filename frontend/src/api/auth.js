const BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

const ACCESS_KEY = "wabs_access_token";
const REFRESH_KEY = "wabs_refresh_token";
const LLM_CACHE_KEY = "wabs_llm_cache";

export const getToken = () => sessionStorage.getItem(ACCESS_KEY);

const setTokens = (access, refresh) => {
  sessionStorage.setItem(ACCESS_KEY, access);
  if (refresh) sessionStorage.setItem(REFRESH_KEY, refresh);
};

export const clearToken = () => {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(LLM_CACHE_KEY);
};

const authPost = async (path, body, errorFallback) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? errorFallback);
  }
  return res.json();
};

export const login = async (email, password) => {
  const data = await authPost("/auth/login", { email, password }, "Invalid email or password.");
  setTokens(data.access_token, data.refresh_token);
  return data.access_token;
};

export const register = async (email, password) => {
  const data = await authPost("/auth/register", { email, password }, "Registration failed.");
  setTokens(data.access_token, data.refresh_token);
  return data.access_token;
};

// Decode exp from JWT payload without signature verification.
const getTokenExpiry = () => {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    return payload.exp ?? null;
  } catch {
    return null;
  }
};

// True when token is missing or expires within the next 2 minutes.
const tokenExpiresSoon = () => {
  const exp = getTokenExpiry();
  if (!exp) return true;
  return exp - Math.floor(Date.now() / 1000) < 120;
};

// Returns a new access token, or null if the refresh token is missing/expired.
export const tryRefresh = async () => {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    const data = await authPost("/auth/refresh", { refresh_token: refreshToken }, "Refresh failed.");
    sessionStorage.setItem(ACCESS_KEY, data.access_token);
    return data.access_token;
  } catch {
    return null;
  }
};

// In-flight refresh promise — prevents concurrent requests from each triggering a refresh.
let _refreshInFlight = null;

// Call before every API request. Refreshes proactively if the token expires soon.
export const ensureFreshToken = async () => {
  if (!tokenExpiresSoon()) return getToken();

  if (!_refreshInFlight) {
    _refreshInFlight = tryRefresh().finally(() => { _refreshInFlight = null; });
  }
  return _refreshInFlight;
};

export const changePassword = async (oldPassword, newPassword) => {
  const token = getToken();
  const res = await fetch(`${BASE}/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to change password.");
  }
};

export const logout = async () => {
  const token = getToken();
  if (token) {
    await fetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  clearToken();
};

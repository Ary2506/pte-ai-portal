const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getDeviceId() {
  let id = localStorage.getItem("pte_device_id");
  if (!id) {
    id = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("pte_device_id", id);
  }
  return id;
}

// Any of these codes mean the current session/account can no longer be trusted client-side.
// The frontend must never keep showing protected screens once the backend reports one of these.
const FORCE_LOGOUT_CODES = new Set([
  "ACCOUNT_BLOCKED",
  "ACCOUNT_SUSPENDED",
  "SUBSCRIPTION_EXPIRED",
  "SUBSCRIPTION_INACTIVE",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "SESSION_INVALID"
]);

// Exported so the client-side subscription-expiry timer (a UX convenience only — see
// useAuth in App.jsx) can trigger the exact same clear-and-redirect flow as a rejected
// API response, instead of a second logout mechanism.
export function forceLogout(message) {
  localStorage.removeItem("pte_token");
  localStorage.removeItem("pte_user");
  sessionStorage.setItem("pte_login_notice", message || "You have been signed out.");
  window.location.href = "/";
}

async function request(path, options = {}) {
  const token = localStorage.getItem("pte_token");
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["X-Device-Id"] = getDeviceId();
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (token && data.code && FORCE_LOGOUT_CODES.has(data.code)) {
      forceLogout(data.message);
    }
    const err = new Error(data.message || "Request failed");
    err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  auth: {
    signin: (body) => request("/auth/signin", { method: "POST", body: JSON.stringify(body) }),
    me: () => request("/auth/me"),
    logout: () => request("/auth/logout", { method: "POST" }).catch(() => {})
  },
  admin: {
    getStats: () => request("/admin/dashboard/stats"),
    getAuditLog: (limit = 10) => request(`/admin/audit-log?limit=${limit}`),
    createUser: (body) => request("/admin/users", { method: "POST", body: JSON.stringify(body) }),
    listUsers: (params = {}) => {
      const q = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null))
      ).toString();
      return request(`/admin/users${q ? `?${q}` : ""}`);
    },
    getUser: (id) => request(`/admin/users/${id}`),
    updateUser: (id, body) => request(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    setStatus: (id, accountStatus) =>
      request(`/admin/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ accountStatus }) }),
    setSubscription: (id, body) =>
      request(`/admin/users/${id}/subscription`, { method: "PATCH", body: JSON.stringify(body) }),
    renew: (id, days) => request(`/admin/users/${id}/renew`, { method: "POST", body: JSON.stringify({ days }) }),
    resetPassword: (id, password) =>
      request(`/admin/users/${id}/password`, { method: "PATCH", body: JSON.stringify({ password }) }),
    revokeSessions: (id) => request(`/admin/users/${id}/revoke-sessions`, { method: "POST" }),
    testSessions: {
      list: (params = {}) => {
        const q = new URLSearchParams(
          Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null))
        ).toString();
        return request(`/admin/test-sessions${q ? `?${q}` : ""}`);
      },
      get: (id) => request(`/admin/test-sessions/${id}`)
    },
    questions: {
      types: () => request("/admin/questions/types"),
      stats: () => request("/admin/questions/stats"),
      list: (params = {}) => {
        const q = new URLSearchParams(
          Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null))
        ).toString();
        return request(`/admin/questions${q ? `?${q}` : ""}`);
      },
      get: (id) => request(`/admin/questions/${id}`),
      create: (body) => request("/admin/questions", { method: "POST", body: JSON.stringify(body) }),
      update: (id, body) => request(`/admin/questions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
      setStatus: (id, active) => request(`/admin/questions/${id}/status`, { method: "PATCH", body: JSON.stringify({ active }) }),
      remove: (id) => request(`/admin/questions/${id}`, { method: "DELETE" })
    }
  },
  dashboard: () => request("/dashboard"),
  plan: () => request("/dashboard/study-plan"),
  questions: (section, type) => request(`/questions?section=${section || ""}&type=${type || ""}`),
  history: () => request("/submissions/history"),
  submit: (form) => request("/submissions", { method: "POST", body: form }),
  retryEvaluation: (submissionId) => request(`/submissions/${submissionId}/retry-evaluation`, { method: "POST" }),
  testSessions: {
    start: () => request("/test-sessions", { method: "POST" }),
    get: (id) => request(`/test-sessions/${id}`),
    complete: (id) => request(`/test-sessions/${id}/complete`, { method: "POST" }),
    list: () => request("/test-sessions"),
    details: (id) => request(`/test-sessions/${id}/details`)
  }
};

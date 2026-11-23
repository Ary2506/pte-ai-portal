import { API_URL as API, API_ORIGIN } from "./apiBase.js";
import { safeLocal, safeSession } from "./safeStorage.js";
import { activeStudentView, endStudentView } from "./studentView.js";

function getDeviceId() {
  let id = safeLocal.getItem("pte_device_id");
  if (!id) {
    id = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    safeLocal.setItem("pte_device_id", id);
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
// Closes this tab's student view and returns it to the admin panel. The stored sign-in is not this
// tab's (it belongs to whoever is signed in to the browser), so it is never touched here. It goes to
// "/", which leads the admin to the admin panel but anyone else (another tab may have signed in a
// student meanwhile) to their own home, never to an admin page they would be refused.
let leftStudentView = false;
function leaveStudentView() {
  leftStudentView = true;
  endStudentView();
  window.location.href = "/";
}

export function forceLogout(message) {
  // In a student-view tab the stored sign-in is the admin's own; ending the view must never sign
  // the admin out. It closes the view and returns this tab to the admin panel.
  if (activeStudentView()) {
    leaveStudentView();
    return;
  }
  // This tab's view has just been closed and the tab is on its way to the admin panel. A reply
  // still arriving from the view is not a reason to sign anyone out.
  if (leftStudentView) return;
  safeLocal.removeItem("pte_token");
  safeLocal.removeItem("pte_user");
  safeSession.setItem("pte_login_notice", message || "You have been signed out.");
  // A shared-answer link needs no session, so ending a stale one must not carry the visitor away
  // from the report they opened.
  if (window.location.pathname.startsWith("/shared-answer/")) return;
  window.location.href = "/";
}

// The token this tab's requests carry: a student-view pass when one is active here, otherwise the
// signed-in user's own.
function currentToken() {
  return activeStudentView()?.token || safeLocal.getItem("pte_token");
}

async function request(path, options = {}) {
  const view = activeStudentView();
  // A student view is read only. The server refuses writes from it too; stopping them here keeps
  // the message clear and means nothing is even sent.
  if (view && (options.method || "GET").toUpperCase() !== "GET") {
    const err = new Error("Student view is read-only. Nothing can be changed from here.");
    err.code = "READ_ONLY_VIEW";
    throw err;
  }
  const token = currentToken();
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["X-Device-Id"] = getDeviceId();
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (view) {
      // Only the view itself ending closes it; the student's own access limits are just shown.
      // Decided by the view this request was SENT with: when several fail together, the first one
      // has already closed the view by the time the others arrive, and they must still only close
      // it, never fall through to signing the browser out.
      if (data.code === "STUDENT_VIEW_ENDED" || data.code === "SESSION_INVALID") leaveStudentView();
    } else if (token && data.code && FORCE_LOGOUT_CODES.has(data.code)) {
      forceLogout(data.message);
    }
    const err = new Error(data.message || "Request failed");
    err.code = data.code;
    throw err;
  }
  return data;
}

/**
 * Ends this tab's Student View on the server ("Back to Admin Panel" / "Exit student view").
 *
 * The one non-read a view pass may send, so it skips request()'s read-only guard. Resolves once the
 * server has ended the view — or already had (STUDENT_VIEW_ENDED: it ended or expired before). Any
 * other outcome, a network failure included, throws: the view may still be open, so the caller
 * must not claim it ended.
 */
export async function endStudentViewSession() {
  const view = activeStudentView();
  if (!view) return { ended: true };
  let res;
  try {
    res = await fetch(`${API}/student-view/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${view.token}`, "X-Device-Id": getDeviceId() }
    });
  } catch {
    const err = new Error("Could not reach the server to end this student view. Check your connection and try again.");
    err.code = "NETWORK_ERROR";
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok || data.code === "STUDENT_VIEW_ENDED") return { ended: true };
  const err = new Error(data.message ? `Could not end this student view: ${data.message}` : "Could not end this student view. Please try again.");
  err.code = data.code;
  throw err;
}

// The shared-answer page is opened by people who are not signed in. Its requests carry no session
// token and no device id, and a refusal never signs anyone out: they are answered by the token in
// the link alone.
async function publicRequest(path) {
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "Request failed");
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const publicApi = {
  sharedAnswer: (token) => publicRequest(`/public/shared-answers/${encodeURIComponent(token)}`),
  sharedAnswerAudioUrl: (token) => publicRequest(`/public/shared-answers/${encodeURIComponent(token)}/audio-url`)
};

export const api = {
  auth: {
    signin: (body) => request("/auth/signin", { method: "POST", body: JSON.stringify(body) }),
    me: () => request("/auth/me"),
    // The caller's own target score.
    setTargetScore: (targetScore) =>
      request("/auth/target-score", { method: "PATCH", body: JSON.stringify({ targetScore }) }),
    logout: () => request("/auth/logout", { method: "POST" }).catch(() => {})
  },
  admin: {
    getStats: () => request("/admin/dashboard/stats"),
    // A read-only pass to view the student-facing site as this student (see studentView.js).
    startStudentView: (userId) => request(`/admin/users/${userId}/view-session`, { method: "POST" }),
    getAuditLog: (limit = 10, page = 1) => request(`/admin/audit-log?limit=${limit}&page=${page}`),
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
    // `sections` is optional: left out, the server renews every section the student holds.
    renew: (id, days, sections) =>
      request(`/admin/users/${id}/renew`, { method: "POST", body: JSON.stringify(sections ? { days, sections } : { days }) }),
    // Grants `days` of each section: extended from its own expiry if still active, started today if not.
    addPurchase: (id, body) => request(`/admin/users/${id}/purchases`, { method: "POST", body: JSON.stringify(body) }),
    listPurchases: (id) => request(`/admin/users/${id}/purchases`),
    resetPassword: (id, password) =>
      request(`/admin/users/${id}/password`, { method: "PATCH", body: JSON.stringify({ password }) }),
    revokeSessions: (id) => request(`/admin/users/${id}/revoke-sessions`, { method: "POST" }),
    // Temporary/emergency admin feature — see the removal note at the top of
    // server/src/models/SubscriptionExtension.js for how to remove this cleanly, including this
    // one nested block.
    subscriptionExtension: {
      // `sections` is optional on both: left out, every active section is adjusted.
      extendUser: (id, days, reason, sections) =>
        request(`/admin/subscription-extension/users/${id}`, { method: "POST", body: JSON.stringify(sections ? { days, reason, sections } : { days, reason }) }),
      revokeUser: (id, days, sections) =>
        request(`/admin/subscription-extension/users/${id}/revoke`, { method: "POST", body: JSON.stringify(sections ? { days, sections } : { days }) }),
      // Without `sections`, cancels everything still active — what this always did.
      cancelUser: (id, sections) =>
        request(`/admin/subscription-extension/users/${id}/cancel`, sections
          ? { method: "POST", body: JSON.stringify({ sections }) }
          : { method: "POST" }),
      bulkPreview: (days) =>
        request(`/admin/subscription-extension/bulk/preview`, { method: "POST", body: JSON.stringify({ days }) }),
      bulkExtend: (days, reason, clientRequestId) =>
        request(`/admin/subscription-extension/bulk`, { method: "POST", body: JSON.stringify({ days, reason, clientRequestId }) }),
      history: (params = {}) => {
        const q = new URLSearchParams(
          Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null))
        ).toString();
        return request(`/admin/subscription-extension/history${q ? `?${q}` : ""}`);
      }
    },
    testSessions: {
      list: (params = {}) => {
        const q = new URLSearchParams(
          Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null))
        ).toString();
        return request(`/admin/test-sessions${q ? `?${q}` : ""}`);
      },
      get: (id) => request(`/admin/test-sessions/${id}`)
    },
    media: {
      // multipart/form-data with field name "file", matching the Phase 2 endpoint exactly —
      // request() already skips setting a JSON Content-Type for a FormData body (see above),
      // the same mechanism api.submit() already relies on for student audio uploads.
      upload: (file) => {
        const form = new FormData();
        form.append("file", file);
        return request("/admin/media/upload", { method: "POST", body: form });
      }
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
  // Per-day practice activity since the student joined, for the profile streak calendar.
  activity: () => request("/dashboard/activity"),
  questions: (section, type) => request(`/questions?section=${section || ""}&type=${type || ""}`),
  // Ids and types only, for counting what a section holds. The full fetch is capped at 200
  // documents, which is fine for one task type but silently truncated a whole section.
  questionIndex: (section) => request(`/questions?section=${section || ""}&index=1`),
  // Repeat Sentence's Transcript button. The transcript is never part of the question list, so it
  // is fetched here, only when the student asks for it.
  questionTranscript: (id) => request(`/questions/${id}/transcript`),
  // Optional params, all narrowing: `summary: 1` drops answer/transcript/feedback (only safe for
  // a caller that lists attempts without reopening one), `section`/`type` scope the rows to a
  // single task. No params keeps the original full, unfiltered shape.
  history: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null))
    ).toString();
    return request(`/submissions/history${q ? `?${q}` : ""}`);
  },
  submit: (form) => request("/submissions", { method: "POST", body: form }),
  retryEvaluation: (submissionId) => request(`/submissions/${submissionId}/retry-evaluation`, { method: "POST" }),
  // The owner's own recording, as something an <audio> element can play: a signed URL when
  // recordings are in R2, otherwise the file fetched with this session and handed over as a blob
  // URL (the caller revokes it). Ownership is checked by the server on both requests.
  ownRecordingSrc: async (submissionId) => {
    const where = await request(`/submissions/${submissionId}/audio-url`);
    if (where.url) return { src: where.url, isBlob: false };
    const res = await fetch(`${API_ORIGIN}${where.path}`, {
      headers: { Authorization: `Bearer ${currentToken()}`, "X-Device-Id": getDeviceId() }
    });
    if (!res.ok) throw new Error("Recording could not be loaded.");
    return { src: URL.createObjectURL(await res.blob()), isBlob: true };
  },
  // Share Answer: a 30-day public link to one scored speaking answer, and withdrawing it.
  shareSubmission: (submissionId) => request(`/submissions/${submissionId}/share`, { method: "POST" }),
  unshareSubmission: (submissionId) => request(`/submissions/${submissionId}/share`, { method: "DELETE" }),
  testSessions: {
    start: () => request("/test-sessions", { method: "POST" }),
    // The attempt still open on the server, if there is one, with its questions and the answers
    // already submitted — so a refresh resumes rather than starting over.
    active: () => request("/test-sessions/active"),
    get: (id) => request(`/test-sessions/${id}`),
    complete: (id) => request(`/test-sessions/${id}/complete`, { method: "POST" }),
    list: () => request("/test-sessions"),
    details: (id) => request(`/test-sessions/${id}/details`)
  }
};

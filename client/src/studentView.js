import { safeSession } from "./safeStorage.js";

// Student Website View: an admin seeing the student-facing site as one student sees it, read only.
//
// The pass (a token the API accepts for reads only, plus the student's public profile) lives in
// this tab's sessionStorage — never in localStorage, which holds the admin's own sign-in and is
// shared by every tab. So the view tab runs as the student while the admin's other tabs stay the
// admin, and closing the tab or pressing "Back to Admin Panel" leaves no trace of it.
//
// The admin panel opens the view in a new tab at /student-view#<pass>. The pass travels in the
// URL fragment, which browsers never send to a server.

const KEY = "pte_student_view";
export const STUDENT_VIEW_PATH = "/student-view";

/** The view pass active in this tab, or null (none, unreadable, or expired). */
export function activeStudentView() {
  try {
    const view = JSON.parse(safeSession.getItem(KEY) || "null");
    if (!view?.token || !view?.student || !(new Date(view.expiresAt) > new Date())) return null;
    return view;
  } catch {
    return null;
  }
}

/** The link that opens a view pass in a new tab. */
export function studentViewUrl({ token, expiresAt, student }) {
  return `${STUDENT_VIEW_PATH}#${encodeURIComponent(JSON.stringify({ token, expiresAt, student }))}`;
}

/** On arrival at /student-view#<pass>: keep the pass for this tab and drop it from the address bar. */
export function enterStudentViewFromUrl() {
  if (typeof window === "undefined" || window.location.pathname !== STUDENT_VIEW_PATH || !window.location.hash) return null;
  try {
    const view = JSON.parse(decodeURIComponent(window.location.hash.slice(1)));
    if (view?.token && view?.student) safeSession.setItem(KEY, JSON.stringify(view));
  } catch { /* a malformed link simply opens nothing */ }
  window.history.replaceState(null, "", STUDENT_VIEW_PATH);
  return activeStudentView();
}

/** Keeps the viewed student's profile current (from /auth/me) without touching the admin's. */
export function updateStudentViewProfile(student) {
  const view = activeStudentView();
  if (view) safeSession.setItem(KEY, JSON.stringify({ ...view, student }));
}

export function endStudentView() {
  safeSession.removeItem(KEY);
}

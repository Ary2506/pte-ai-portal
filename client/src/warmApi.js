import { API_ORIGIN } from "./apiBase.js";

// Wakes the API while the visitor is still reading the landing page.
//
// The API runs on a host that sleeps after a period without traffic, and the first request after
// that waits roughly a minute for the process to boot. The landing page itself is static and
// renders instantly, so without this the whole delay lands on the student at the worst possible
// moment: they type their password, press Sign in, and watch a spinner for a minute.
//
// Firing a request as the page mounts moves that boot into the twenty to forty seconds they spend
// reading and typing. It does not remove the wait — it hides most of it behind something they
// were doing anyway. And it is a real visitor's request, not synthetic traffic.
//
// Deliberately fire-and-forget: nothing renders from it, nothing waits on it, and a failure is
// not worth a single pixel of the page. If the API is unreachable the sign-in attempt will say
// so properly.
let alreadyWarmed = false;

export function warmApi() {
  if (alreadyWarmed) return;
  // One per page load. React runs effects twice in development's StrictMode, and a remount should
  // not mean a second request either.
  alreadyWarmed = true;

  // jsdom and older browsers may not have it. Nothing here is important enough to risk a throw.
  if (typeof fetch !== "function") return;

  try {
    fetch(`${API_ORIGIN}/api/health`, {
      method: "GET",
      // A cached 200 would defeat the point: the request has to actually reach the server for the
      // sleeping instance to wake.
      cache: "no-store",
      // Lets the request outlive the page if the visitor signs in immediately.
      keepalive: true
    }).catch(() => {
      // Unreachable, asleep, or blocked. The sign-in attempt reports failure properly; this is
      // only ever an optimisation.
    });
  } catch {
    // Some environments throw synchronously on an unsupported option rather than rejecting.
  }
}

/** Test seam: lets a test exercise the once-per-load guard. */
export function resetWarmApiForTests() {
  alreadyWarmed = false;
}

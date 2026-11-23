import { safeLocal, safeSession } from "./safeStorage.js";
import { activeStudentView } from "./studentView.js";

// Who is signed in, per tab.
//
// Each tab keeps its own sign-in in sessionStorage, so a student in one tab and an admin in
// another both work, and signing in or out in one tab never changes another. localStorage keeps
// the browser's most recent sign-in, only as the starting point for a tab that has none yet: a new
// tab, or one opened after the browser was closed, starts as whoever signed in last.
//
// A tab that signed out remembers that (TAB_SIGNED_OUT) and stays signed out on reload, rather
// than picking up whichever account another tab signed in with.

const BROWSER_TOKEN = "pte_token";
const BROWSER_USER = "pte_user";
const TAB_TOKEN = "pte_tab_token";
const TAB_USER = "pte_tab_user";
const TAB_SIGNED_OUT = "pte_tab_signed_out";

const parse = (raw) => { try { return JSON.parse(raw || "null"); } catch { return null; } };

// The account a sign-in token belongs to, read from its payload (the server signs
// { userId, sessionId }). Not verified here — the server does that — only used to tell whose it is.
function tokenOwner(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).userId || null;
  } catch {
    return null;
  }
}

/**
 * The browser's most recent sign-in, or null. A sign-in writes the token and then the user, so for
 * a moment the two can belong to different accounts; that half-written pair is not a sign-in yet.
 */
export function browserSession() {
  const token = safeLocal.getItem(BROWSER_TOKEN);
  const user = parse(safeLocal.getItem(BROWSER_USER));
  if (!token || !user) return null;
  const owner = tokenOwner(token);
  if (owner && String(owner) !== String(user.id)) return null;
  return { token, user };
}

/** This tab's sign-in, or null. A tab with none yet starts as the browser's most recent one. */
export function tabSession() {
  const token = safeSession.getItem(TAB_TOKEN);
  if (token) return { token, user: parse(safeSession.getItem(TAB_USER)) };
  if (safeSession.getItem(TAB_SIGNED_OUT)) return null;
  const latest = browserSession();
  if (latest) {
    safeSession.setItem(TAB_TOKEN, latest.token);
    safeSession.setItem(TAB_USER, JSON.stringify(latest.user));
  }
  return latest;
}

/** A sign-in in this tab: it becomes this tab's account and the starting point for new tabs. */
export function saveSession(token, user) {
  safeSession.removeItem(TAB_SIGNED_OUT);
  safeSession.setItem(TAB_TOKEN, token);
  safeSession.setItem(TAB_USER, JSON.stringify(user));
  safeLocal.setItem(BROWSER_TOKEN, token);
  safeLocal.setItem(BROWSER_USER, JSON.stringify(user));
}

/** Replaces this tab's user (e.g. after /auth/me), and the browser's copy when it is the same account. */
export function updateSessionUser(user) {
  safeSession.setItem(TAB_USER, JSON.stringify(user));
  const latest = browserSession();
  if (latest && latest.user?.id === user?.id) safeLocal.setItem(BROWSER_USER, JSON.stringify(user));
}

/**
 * Takes over the browser's most recent sign-in when it is this tab's own account signed in again
 * elsewhere. The server keeps one session per account, so that sign-in has just ended this tab's;
 * the new token keeps this tab working. Returns the adopted user, or null when nothing changed.
 */
export function adoptSameAccountSession() {
  const mine = tabSession();
  const latest = browserSession();
  if (!mine || !latest || latest.user?.id !== mine.user?.id) return null;
  if (latest.token === mine.token && JSON.stringify(latest.user) === JSON.stringify(mine.user)) return null;
  safeSession.setItem(TAB_TOKEN, latest.token);
  safeSession.setItem(TAB_USER, JSON.stringify(latest.user));
  return latest.user;
}

/**
 * After the server refused `refusedToken`: true when this tab can carry on with a newer sign-in of
 * the same account — it already switched to one, or the browser holds one, which it switches to
 * now. False means the refusal stands and the tab should be signed out.
 */
export function recoverSameAccountSession(refusedToken) {
  const mine = tabSession();
  if (!mine) return false;
  if (mine.token !== refusedToken) return true;
  const latest = browserSession();
  if (!latest || latest.token === refusedToken || latest.user?.id !== mine.user?.id) return false;
  safeSession.setItem(TAB_TOKEN, latest.token);
  safeSession.setItem(TAB_USER, JSON.stringify(latest.user));
  return true;
}

// Open tabs can be asked whether they are using a given session. A new tab starts on the same
// session as the tab that signed in, so signing out in one of them must not end the session on the
// server while another is still using it — that would sign the other tab out too.
const TABS_CHANNEL = "pte_tabs";
let channel;
function tabsChannel() {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(TABS_CHANNEL) : null;
  } catch {
    channel = null;
  }
  if (channel) {
    channel.unref?.(); // Node (tests) only: an open channel must not keep the process alive.
    channel.onmessage = (event) => {
      const message = event.data;
      // A student-view tab carries a copy of the admin's sign-in but does not use it; the admin
      // signing out should still end the session, and with it the view.
      if (message?.type !== "who-uses" || activeStudentView()) return;
      if (message.token && safeSession.getItem(TAB_TOKEN) === message.token) {
        channel.postMessage({ type: "in-use", id: message.id });
      }
    };
  }
  return channel;
}

/** Starts answering other tabs' "who uses this session?" — called once when the app starts. */
export function answerOtherTabs() {
  tabsChannel();
}

/** Whether another open tab is using `token`. Without a way to ask (old browsers), assumes not. */
export function otherTabsUse(token, waitMs = 300) {
  const ch = tabsChannel();
  if (!ch || !token) return Promise.resolve(false);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const listener = (event) => {
      if (event.data?.type === "in-use" && event.data.id === id) finish(true);
    };
    const timer = setTimeout(() => finish(false), waitMs);
    function finish(result) {
      clearTimeout(timer);
      ch.removeEventListener("message", listener);
      resolve(result);
    }
    ch.addEventListener("message", listener);
    ch.postMessage({ type: "who-uses", token, id });
  });
}

/**
 * Signs this tab out. The browser's copy is cleared only when it is this same sign-in, so a tab
 * signing out never signs out the account another tab is using; `keepBrowser` keeps it even then,
 * for a session another open tab is still using.
 */
export function clearSession({ keepBrowser = false } = {}) {
  // A tab that has not read its sign-in yet is running as the browser's most recent one.
  const token = safeSession.getItem(TAB_TOKEN)
    || (safeSession.getItem(TAB_SIGNED_OUT) ? null : safeLocal.getItem(BROWSER_TOKEN));
  safeSession.removeItem(TAB_TOKEN);
  safeSession.removeItem(TAB_USER);
  safeSession.setItem(TAB_SIGNED_OUT, "1");
  if (!keepBrowser && token && safeLocal.getItem(BROWSER_TOKEN) === token) {
    safeLocal.removeItem(BROWSER_TOKEN);
    safeLocal.removeItem(BROWSER_USER);
  }
}

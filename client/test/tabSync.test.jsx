import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";

// Each tab keeps its own sign-in (session.js): a student in one tab and an admin in another both
// work, and nothing done in one tab changes who another tab is.
vi.mock("../src/api.js", () => ({
  forceLogout: vi.fn(),
  endStudentViewSession: vi.fn(),
  publicApi: { sharedAnswer: vi.fn(), sharedAnswerAudioUrl: vi.fn() },
  api: {
    auth: { signin: vi.fn(), me: vi.fn(() => Promise.resolve({})), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(() => Promise.resolve({ totalUsers: 0, accountStatus: {}, paymentStatus: {}, subscription: {} })),
      getAuditLog: vi.fn(() => Promise.resolve({ logs: [] })), listUsers: vi.fn(() => Promise.resolve({ users: [] })),
      questions: { stats: vi.fn(() => Promise.resolve({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} })) }
    },
    dashboard: vi.fn(() => Promise.resolve({ stats: { overall: 0, practiceCount: 0, targetScore: 79 }, bySection: [], recent: [], streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false }, weeklyActivity: [] })),
    plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(() => Promise.resolve({ submissions: [] })), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(() => Promise.resolve({ testSessions: [] })) }
  }
}));

// Shaped like the server's tokens: the account id is in the payload ({ userId, sessionId }).
const jwt = (userId, session = "1") => `h.${btoa(JSON.stringify({ userId, sessionId: session }))}.sig`;
const ADMIN = { id: "a1", role: "admin", name: "Admin", username: "admin" };
const STUDENT = { id: "s1", role: "student", name: "Student", username: "pte001", subscriptionStatus: "ACTIVE" };

let replace;
const original = window.location;
beforeEach(() => {
  replace = vi.fn();
  delete window.location;
  window.location = { ...original, replace, assign: vi.fn(), pathname: "/" };
});
afterEach(() => { window.location = original; });

// The browser's most recent sign-in (what a brand-new tab starts as).
function browserSignedInAs(user, token = jwt(user.id)) {
  localStorage.setItem("pte_token", token);
  localStorage.setItem("pte_user", JSON.stringify(user));
}
// This tab's own sign-in.
function tabSignedInAs(user, token = jwt(user.id)) {
  sessionStorage.setItem("pte_tab_token", token);
  sessionStorage.setItem("pte_tab_user", JSON.stringify(user));
}
const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
// What another tab does, as this tab hears it: the write, then a storage event for that key.
function otherTab(key, value) {
  act(() => {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
  });
}
const shownUser = () => document.querySelector(".top-user b")?.textContent;

describe("each tab keeps its own sign-in", () => {
  it("another tab signing in as the admin leaves this student tab a student", async () => {
    browserSignedInAs(STUDENT);
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);

    otherTab("pte_token", jwt("a1"));
    otherTab("pte_user", JSON.stringify(ADMIN));
    expect(shownUser()).toBe("Student");
    expect(sessionStorage.getItem("pte_tab_token")).toBe(jwt("s1"));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/Access denied/)).toBeNull();
  });

  it("and the other way round: a student signing in elsewhere leaves this admin tab the admin", async () => {
    browserSignedInAs(ADMIN);
    renderAt("/admin");
    await screen.findByRole("heading", { name: "Admin Panel" });
    otherTab("pte_token", jwt("s1"));
    otherTab("pte_user", JSON.stringify(STUDENT));
    expect(screen.getByRole("heading", { name: "Admin Panel" })).toBeInTheDocument();
    expect(sessionStorage.getItem("pte_tab_token")).toBe(jwt("a1"));
  });

  it("a reload keeps this tab's own account, not the browser's most recent sign-in", async () => {
    tabSignedInAs(STUDENT);
    browserSignedInAs(ADMIN);
    renderAt("/admin");
    // A student on /admin is redirected — this is the student, as this tab was.
    expect(await screen.findByText(/Welcome back/)).toBeInTheDocument();
    expect(shownUser()).toBe("Student");
  });

  it("a brand-new tab starts as the browser's most recent sign-in", async () => {
    browserSignedInAs(ADMIN);
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Admin Panel" })).toBeInTheDocument();
    expect(sessionStorage.getItem("pte_tab_token")).toBe(jwt("a1"));
  });

  it("another tab signing out does not sign this tab out", async () => {
    browserSignedInAs(STUDENT);
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);
    otherTab("pte_token", null);
    otherTab("pte_user", null);
    expect(shownUser()).toBe("Student");
  });

  it("this same account signing in again elsewhere: this tab carries on with the new session", async () => {
    browserSignedInAs(STUDENT);
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);
    otherTab("pte_token", jwt("s1", "2"));
    otherTab("pte_user", JSON.stringify({ ...STUDENT, name: "Renamed Student" }));
    await waitFor(() => expect(shownUser()).toBe("Renamed Student"));
    expect(sessionStorage.getItem("pte_tab_token")).toBe(jwt("s1", "2"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("logging out signs out only this tab, and it stays signed out on reload", async () => {
    tabSignedInAs(STUDENT);
    browserSignedInAs(ADMIN); // another tab's sign-in
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);
    fireEvent.click(screen.getByText("Log out"));
    expect(await screen.findAllByRole("button", { name: "Sign in" })).not.toHaveLength(0);
    expect(localStorage.getItem("pte_token")).toBe(jwt("a1")); // the admin tab is untouched

    cleanup(); // reload this tab
    renderAt("/dashboard");
    expect(await screen.findAllByRole("button", { name: "Sign in" })).not.toHaveLength(0);
  });

  it("logging out the browser's most recent sign-in clears it, so new tabs start signed out", async () => {
    browserSignedInAs(STUDENT);
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);
    fireEvent.click(screen.getByText("Log out"));
    await screen.findAllByRole("button", { name: "Sign in" });
    expect(localStorage.getItem("pte_token")).toBeNull();
    expect(localStorage.getItem("pte_user")).toBeNull();
  });

  it("logging out while another open tab uses the same session signs out only this tab", async () => {
    const { api } = await import("../src/api.js");
    api.auth.logout.mockClear();
    browserSignedInAs(STUDENT);
    // Another open tab on the same session answers when asked.
    const other = new BroadcastChannel("pte_tabs");
    other.onmessage = (event) => {
      if (event.data?.type === "who-uses" && event.data.token === jwt("s1")) other.postMessage({ type: "in-use", id: event.data.id });
    };
    try {
      renderAt("/dashboard");
      await screen.findByText(/Welcome back/);
      fireEvent.click(screen.getByText("Log out"));
      await screen.findAllByRole("button", { name: "Sign in" });
      expect(api.auth.logout).not.toHaveBeenCalled(); // the session stays alive for the other tab
      expect(localStorage.getItem("pte_token")).toBe(jwt("s1"));
      expect(sessionStorage.getItem("pte_tab_token")).toBeNull();
    } finally {
      other.close();
    }
  });

  it("logging out with no other tab on the session ends it on the server", async () => {
    const { api } = await import("../src/api.js");
    api.auth.logout.mockClear();
    browserSignedInAs(STUDENT);
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);
    fireEvent.click(screen.getByText("Log out"));
    await screen.findAllByRole("button", { name: "Sign in" });
    expect(api.auth.logout).toHaveBeenCalledTimes(1);
  });

  it("a student-view tab is left alone: it runs on its own pass", async () => {
    browserSignedInAs(ADMIN, "admin-token");
    sessionStorage.setItem("pte_student_view", JSON.stringify({
      token: "view-token", expiresAt: new Date(Date.now() + 3600e3).toISOString(), student: STUDENT
    }));
    renderAt("/dashboard");
    await waitFor(() => expect(document.querySelector(".student-view-banner")).not.toBeNull());
    otherTab("pte_user", JSON.stringify(STUDENT));
    expect(document.querySelector(".student-view-banner")).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});

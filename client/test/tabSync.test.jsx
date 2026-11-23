import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";

// Every tab shares one stored sign-in (localStorage). Another tab signing in as someone else, or
// signing out, must not leave this tab acting as an account it no longer is.
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

const ADMIN = { id: "a1", role: "admin", name: "Admin", username: "admin" };
const STUDENT = { id: "s1", role: "student", name: "Student", username: "pte001", subscriptionStatus: "ACTIVE" };

let replace;
const original = window.location;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  replace = vi.fn();
  delete window.location;
  window.location = { ...original, replace, assign: vi.fn(), pathname: "/" };
});
afterEach(() => { window.location = original; });

function signedInAs(user, token = `${user.id}-token`) {
  localStorage.setItem("pte_token", token);
  localStorage.setItem("pte_user", JSON.stringify(user));
}
function renderAt(path) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}
// What the other tab does, as this tab hears it: the write, then a storage event for that key.
function otherTab(key, value) {
  act(() => {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
  });
}

describe("tabs follow the browser's sign-in", () => {
  it("an admin tab starts over when another tab signs in as a student — not after the token alone", async () => {
    signedInAs(ADMIN);
    renderAt("/admin");
    await screen.findByRole("heading", { name: "Admin Panel" });

    otherTab("pte_token", "s1-token");
    expect(replace).not.toHaveBeenCalled(); // the new account is not named yet
    otherTab("pte_user", JSON.stringify(STUDENT));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/");
    expect(sessionStorage.getItem("pte_access_denied_notice")).toBeNull();
  });

  it("a signed-in tab starts over when another tab signs out", async () => {
    signedInAs(STUDENT);
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);
    otherTab("pte_token", null);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("a signed-out tab starts over once another tab has signed in", async () => {
    renderAt("/");
    await screen.findAllByRole("button", { name: "Sign in" });
    otherTab("pte_token", "s1-token");
    expect(replace).not.toHaveBeenCalled();
    otherTab("pte_user", JSON.stringify(STUDENT));
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("the same account changing in another tab only refreshes what this tab shows", async () => {
    signedInAs(STUDENT);
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);
    otherTab("pte_token", "s1-new-token"); // the same student signing in again elsewhere
    otherTab("pte_user", JSON.stringify({ ...STUDENT, name: "Renamed Student" }));
    await waitFor(() => expect(document.querySelector(".top-user b")).toHaveTextContent("Renamed Student"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("ignores other stored settings", async () => {
    signedInAs(STUDENT);
    renderAt("/dashboard");
    await screen.findByText(/Welcome back/);
    otherTab("pte_theme", "light");
    expect(replace).not.toHaveBeenCalled();
  });

  it("a student-view tab is left alone: it runs on its own pass", async () => {
    signedInAs(ADMIN, "admin-token");
    sessionStorage.setItem("pte_student_view", JSON.stringify({
      token: "view-token", expiresAt: new Date(Date.now() + 3600e3).toISOString(), student: STUDENT
    }));
    renderAt("/dashboard");
    await waitFor(() => expect(document.querySelector(".student-view-banner")).not.toBeNull());
    otherTab("pte_user", JSON.stringify(STUDENT));
    expect(replace).not.toHaveBeenCalled();
  });
});

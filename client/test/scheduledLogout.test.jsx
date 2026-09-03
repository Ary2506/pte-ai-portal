import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// Partially mocked: api.* methods are stubbed to avoid real network calls, but forceLogout is
// the REAL implementation from src/api.js — this test exists specifically to prove the
// scheduled-logout timer reuses that exact clear-and-redirect flow, not a second one.
vi.mock("../src/api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
      admin: {
        getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
        updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn(),
        questions: { types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn() }
      },
      dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
      testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
    }
  };
});

function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

const originalLocation = window.location;

beforeEach(() => {
  delete window.location;
  window.location = { href: "", pathname: "/dashboard" };
  api.dashboard.mockResolvedValue({ stats: { overall: 0, practiceCount: 0, streak: 0, targetScore: 79 }, bySection: [], recent: [] });
});

afterEach(() => {
  vi.useRealTimers();
  window.location = originalLocation;
  localStorage.clear();
  sessionStorage.clear();
});

describe("client-side scheduled logout at subscription expiry", () => {
  it("schedules a logout for the expiry instant and clears auth state via the existing force-logout flow when it fires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt("/dashboard", {
      role: "student", name: "Student", username: "pte001",
      subscriptionStatus: "ACTIVE", subscriptionEndDate: new Date(Date.now() + 200).toISOString()
    });
    await screen.findByText(/Welcome back/);
    expect(localStorage.getItem("pte_token")).toBe("test-token");

    await vi.advanceTimersByTimeAsync(250);

    expect(localStorage.getItem("pte_token")).toBeNull();
    expect(localStorage.getItem("pte_user")).toBeNull();
    expect(window.location.href).toBe("/");
    expect(sessionStorage.getItem("pte_login_notice")).toMatch(/expired/i);
  });

  it("logs out immediately if the cached subscription is already expired on load", async () => {
    // Real timers on purpose: this branch fires synchronously inside the mount effect, so
    // there's nothing to advance — mixing fake timers into a plain waitFor poll here is what
    // caused this exact test to hang/flake during development.
    renderAt("/dashboard", {
      role: "student", name: "Student", username: "pte002",
      subscriptionStatus: "EXPIRED", subscriptionEndDate: new Date(Date.now() - 1000).toISOString()
    });

    await waitFor(() => expect(localStorage.getItem("pte_token")).toBeNull());
    expect(window.location.href).toBe("/");
  });

  it("never schedules a logout for an admin, even with a very near expiry-like date on the object", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: { active: 0, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 }, subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
    api.admin.getAuditLog.mockResolvedValue({ logs: [] });
    api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });

    renderAt("/admin", {
      role: "admin", name: "Admin", username: "admin",
      subscriptionStatus: "ACTIVE", subscriptionEndDate: new Date(Date.now() + 100).toISOString()
    });
    await screen.findByText("Admin Panel");

    await vi.advanceTimersByTimeAsync(5000);

    expect(localStorage.getItem("pte_token")).toBe("test-token");
    expect(window.location.href).toBe("");
  });
});

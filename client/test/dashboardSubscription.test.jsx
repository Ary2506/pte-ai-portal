import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn(),
      questions: { types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn() }
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  },
  forceLogout: vi.fn()
}));

function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.dashboard.mockResolvedValue({ stats: { overall: 60, practiceCount: 4, streak: 2, targetScore: 79 }, bySection: [], recent: [] });
});

describe("student dashboard subscription card", () => {
  it("shows ACTIVE status, start date, expiry date, and days remaining", async () => {
    const startDate = "2026-09-01T00:00:00.000Z";
    // Matches the component's own formatting exactly, rather than assuming one locale's
    // output — the rendered wording is locale-dependent, but it must always be present.
    const expectedStart = new Date(startDate).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
    renderAt("/dashboard", {
      role: "student", name: "Student", username: "pte001",
      subscriptionStatus: "ACTIVE",
      subscriptionStartDate: startDate,
      subscriptionEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    });

    expect(await screen.findByText("Subscription")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText(expectedStart)).toBeInTheDocument();
    expect(screen.getByText("Started")).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
    expect(screen.getByText("Days remaining")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("shows the EXPIRED state and the contact-administrator message, with no dates/days shown", async () => {
    renderAt("/dashboard", {
      role: "student", name: "Student", username: "pte002",
      subscriptionStatus: "EXPIRED",
      subscriptionStartDate: "2026-07-01T00:00:00.000Z",
      subscriptionEndDate: "2026-07-31T00:00:00.000Z"
    });

    expect(await screen.findByText("Subscription")).toBeInTheDocument();
    expect(screen.getByText("EXPIRED")).toBeInTheDocument();
    expect(screen.getByText("Your 30-day subscription has expired.")).toBeInTheDocument();
    expect(screen.getByText("Please contact the administrator for renewal.")).toBeInTheDocument();
    expect(screen.queryByText("Days remaining")).not.toBeInTheDocument();
  });

  it("does not render a subscription card for an admin", async () => {
    api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: { active: 0, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 }, subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
    api.admin.getAuditLog.mockResolvedValue({ logs: [] });
    api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
    renderAt("/dashboard", { role: "admin", name: "Admin", username: "admin" });

    // Admins are redirected away from /dashboard content entirely in this app's routing only
    // if they navigate to /admin; landing on /dashboard as an admin still renders Dashboard,
    // which must not show a student subscription card for them.
    await screen.findByText(/Welcome back/);
    expect(screen.queryByText("Subscription")).not.toBeInTheDocument();
  });
});

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(),
      getAuditLog: vi.fn(),
      createUser: vi.fn(),
      listUsers: vi.fn(),
      getUser: vi.fn(),
      updateUser: vi.fn(),
      setStatus: vi.fn(),
      setSubscription: vi.fn(),
      renew: vi.fn(),
      resetPassword: vi.fn(),
      revokeSessions: vi.fn(),
      questions: {
        types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn()
      }
    },
    dashboard: vi.fn(),
    plan: vi.fn(),
    questions: vi.fn(),
    history: vi.fn(),
    submit: vi.fn(),
    retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function adminAuthUser() {
  return { role: "admin", name: "Admin", username: "admin" };
}
function sampleUser(overrides = {}) {
  return {
    id: "u1", username: "pte001", name: "Test Student", email: "pte001@example.com",
    role: "student", accountStatus: "ACTIVE", paymentStatus: "PAID",
    subscriptionStartDate: "2026-08-01T00:00:00.000Z", subscriptionEndDate: "2026-09-30T00:00:00.000Z",
    subscriptionStatus: "ACTIVE", targetScore: 79, lastLoginAt: "2026-08-30T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z", sessionStatus: "ACTIVE",
    ...overrides
  };
}
function usersPage(users, overrides = {}) {
  return { users, total: users.length, page: 1, limit: 20, totalPages: 1, ...overrides };
}
function emptyStats() {
  return {
    totalUsers: 0,
    accountStatus: { active: 0, blocked: 0, suspended: 0 },
    paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 },
    subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 }
  };
}

function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.admin.getStats.mockResolvedValue(emptyStats());
  api.admin.getAuditLog.mockResolvedValue({ logs: [] });
  api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
  api.admin.questions.types.mockResolvedValue({ types: [] });
  api.admin.questions.list.mockResolvedValue({ data: [], page: 1, limit: 20, total: 0, totalPages: 1 });
  api.admin.listUsers.mockResolvedValue(usersPage([sampleUser()]));
});

describe("Admin — recent login attempts in user detail", () => {
  it("renders recent login attempts with a safe reason label, success/failure badge, and timestamp", async () => {
    api.admin.getUser.mockResolvedValue({
      user: sampleUser(),
      sessions: [],
      loginAttempts: [
        { id: "a1", success: false, reason: "DEVICE_NOT_REGISTERED", deviceId: "device-xyz", ipAddress: "10.0.0.5", createdAt: "2026-08-30T10:00:00.000Z" },
        { id: "a2", success: true, reason: "SUCCESS", deviceId: null, ipAddress: "10.0.0.5", createdAt: "2026-08-30T09:00:00.000Z" }
      ]
    });
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("Manage"));

    const heading = await screen.findByText("Recent login attempts");
    const list = heading.nextElementSibling;
    expect(list.textContent).toMatch(/Device restriction/);
    expect(list.textContent).toMatch(/Signed in/);
    expect(list.textContent).toMatch(/Failed/);
    expect(list.textContent).toMatch(/Success/);

    // Never renders a raw device identifier.
    expect(list.textContent).not.toMatch(/device-xyz/);
  });

  it("shows an empty state when there are no recorded login attempts", async () => {
    api.admin.getUser.mockResolvedValue({ user: sampleUser(), sessions: [], loginAttempts: [] });
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("Manage"));

    await screen.findByText("Recent login attempts");
    expect(screen.getByText("No login attempts recorded yet.")).toBeInTheDocument();
  });
});

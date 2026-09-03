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
function studentAuthUser() {
  return { role: "student", name: "Student", username: "pte001" };
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
  api.admin.getStats.mockResolvedValue(emptyStats());
  api.admin.getAuditLog.mockResolvedValue({ logs: [] });
  api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
  api.admin.questions.types.mockResolvedValue({ types: [] });
  api.admin.questions.list.mockResolvedValue({ data: [], page: 1, limit: 20, total: 0, totalPages: 1 });
  api.admin.listUsers.mockResolvedValue(usersPage([]));
  api.admin.getUser.mockResolvedValue({ user: sampleUser(), sessions: [] });
  api.admin.createUser.mockResolvedValue({ user: { username: "pte099" }, temporaryPassword: "Tmp12345" });
  api.admin.setStatus.mockResolvedValue({ user: sampleUser({ accountStatus: "BLOCKED" }) });
  api.admin.setSubscription.mockResolvedValue({ user: sampleUser() });
  api.admin.renew.mockResolvedValue({ user: sampleUser() });
  api.admin.resetPassword.mockResolvedValue({ user: sampleUser(), temporaryPassword: "newpass1" });
  api.admin.revokeSessions.mockResolvedValue({ message: "ok", revokedCount: 1 });
  api.dashboard.mockResolvedValue({ stats: { overall: 0, practiceCount: 0, streak: 0, targetScore: 79 }, bySection: [], recent: [] });
  api.questions.mockResolvedValue({ questions: [] });
});

describe("admin route access", () => {
  it("lets an admin open the Users page", async () => {
    renderAt("/admin", adminAuthUser());
    expect(await screen.findByText("Admin Panel")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Users"));
    expect(await screen.findByText("User accounts")).toBeInTheDocument();
  });

  it("redirects a normal user away from the Admin page", async () => {
    renderAt("/admin", studentAuthUser());
    expect(await screen.findByText(/Welcome back/)).toBeInTheDocument();
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
  });
});

describe("user creation", () => {
  it("submits the create-user form and shows the temporary password once", async () => {
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("+ Create user"));
    fireEvent.change(screen.getByPlaceholderText("pte002"), { target: { value: "pte099" } });
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "New Student" } });
    fireEvent.click(screen.getByText("Create user"));
    expect(await screen.findByText(/Temporary password: Tmp12345/)).toBeInTheDocument();
    expect(api.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ username: "pte099", name: "New Student" }));
  });
});

describe("user list", () => {
  it("loads and renders users from the API", async () => {
    api.admin.listUsers.mockResolvedValueOnce(usersPage([sampleUser()]));
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    expect(await screen.findByText("pte001")).toBeInTheDocument();
    expect(screen.getByText("Test Student")).toBeInTheDocument();
  });

  it("shows an expired subscription clearly, with no days remaining", async () => {
    api.admin.listUsers.mockResolvedValueOnce(
      usersPage([sampleUser({ subscriptionStatus: "EXPIRED", subscriptionEndDate: "2020-01-01T00:00:00.000Z" })])
    );
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    expect(await screen.findByText("EXPIRED")).toBeInTheDocument();
  });
});

describe("search and filters", () => {
  it("sends the search term to the API", async () => {
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    const input = await screen.findByPlaceholderText(/Search by User ID/);
    fireEvent.change(input, { target: { value: "dev" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.admin.listUsers).toHaveBeenCalledWith(expect.objectContaining({ search: "dev" })));
  });

  it("re-queries when the account status filter changes", async () => {
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.change(await screen.findByLabelText("Filter by account status"), { target: { value: "BLOCKED" } });
    await waitFor(() => expect(api.admin.listUsers).toHaveBeenCalledWith(expect.objectContaining({ status: "BLOCKED" })));
  });
});

describe("pagination", () => {
  it("requests the next page when Next is clicked", async () => {
    api.admin.listUsers.mockResolvedValueOnce(usersPage([sampleUser()], { totalPages: 2, page: 1 }));
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("Next ›"));
    await waitFor(() => expect(api.admin.listUsers).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });
});

describe("user detail actions", () => {
  async function openDetail() {
    api.admin.listUsers.mockResolvedValueOnce(usersPage([sampleUser()]));
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("Manage"));
    await screen.findByText("Actions");
  }

  it("blocks a user after confirmation", async () => {
    await openDetail();
    fireEvent.click(screen.getByText("Block"));
    fireEvent.click(await screen.findByText("Block user"));
    await waitFor(() => expect(api.admin.setStatus).toHaveBeenCalledWith("u1", "BLOCKED"));
  });

  it("renews a subscription for 30 days", async () => {
    await openDetail();
    fireEvent.click(screen.getByText("+30 days"));
    await waitFor(() => expect(api.admin.renew).toHaveBeenCalledWith("u1", 30));
  });

  it("force-logs-out a user after confirmation", async () => {
    await openDetail();
    fireEvent.click(screen.getByText("Force logout"));
    fireEvent.click(await screen.findByText("Force logout now"));
    await waitFor(() => expect(api.admin.revokeSessions).toHaveBeenCalledWith("u1"));
  });

  it("resets a password after confirmation and surfaces it once", async () => {
    await openDetail();
    fireEvent.click(screen.getByText("Reset password"));
    fireEvent.click(await screen.findByText("Reset password now"));
    await waitFor(() => expect(api.admin.resetPassword).toHaveBeenCalledWith("u1", ""));
    expect(await screen.findByText(/New password for pte001: newpass1/)).toBeInTheDocument();
  });
});

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
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn(),
      questions: { types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn() }
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function studentUser() { return { id: "s1", role: "student", name: "Student", username: "pte001", subscriptionStatus: "ACTIVE" }; }
function adminUser() { return { id: "a1", role: "admin", name: "Admin", username: "admin" }; }
function renderAt(path, user) {
  if (user) {
    localStorage.setItem("pte_token", "test-token");
    localStorage.setItem("pte_user", JSON.stringify(user));
  }
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}
function mockAdminDashboardApis() {
  api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: { active: 0, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 }, subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
  api.admin.getAuditLog.mockResolvedValue({ logs: [] });
  api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  api.dashboard.mockResolvedValue({
    stats: { overall: 0, practiceCount: 0, targetScore: 79 }, bySection: [], recent: [],
    streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false }, weeklyActivity: []
  });
});

describe("Login routing by verified server role (Part 5/10 items 6-7)", () => {
  it("routes an admin straight to /admin after login, using the role the server returned — not the username", async () => {
    mockAdminDashboardApis();
    api.auth.signin.mockResolvedValue({ token: "t", user: adminUser() });
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText("e.g. pte001"), { target: { value: "admin" } });
    fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("Sign In"));

    // The "Admin Panel" *page heading* specifically (not the sidebar's own "Admin Panel" quick
    // link, which renders for any admin regardless of which route is active) is the actual proof
    // the route settled on /admin, not just that the user object carries the admin role.
    expect(await screen.findByRole("heading", { name: "Admin Panel" })).toBeInTheDocument();
    expect(await screen.findByText("Admin Mode")).toBeInTheDocument();
    expect(await screen.findByText("Users")).toBeInTheDocument(); // Admin()'s own tab strip
  });

  it("routes a student straight to /dashboard after login", async () => {
    api.auth.signin.mockResolvedValue({ token: "t", user: studentUser() });
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText("e.g. pte001"), { target: { value: "pte001" } });
    fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("Sign In"));

    await waitFor(() => expect(api.auth.signin).toHaveBeenCalled());
    expect(await screen.findByText(/Welcome back/)).toBeInTheDocument();
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
  });
});

describe("Student is fully blocked from the admin surface (Part 3/10 item 1/3)", () => {
  it("a student directly navigating (or refreshing) to /admin is redirected to the dashboard and shown an explicit access-denied message, not a silent bounce", async () => {
    renderAt("/admin", studentUser());
    expect(await screen.findByText(/Welcome back/)).toBeInTheDocument();
    expect(screen.getByText(/Access denied.*admin permissions/i)).toBeInTheDocument();
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
  });

  it("a student never sees any admin navigation (no Admin Mode badge, no Admin Panel link) anywhere on the student site", async () => {
    renderAt("/dashboard", studentUser());
    await screen.findByText(/Welcome back/);
    expect(screen.queryByText("Admin Mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
  });
});

describe("Admin Panel is a genuinely separate interface (Part 2/10 item 2)", () => {
  it("an admin visiting /admin sees the real Admin Panel — admin-only nav, no PTE Practice/More menus", async () => {
    mockAdminDashboardApis();
    renderAt("/admin", adminUser());
    expect(await screen.findByText("Admin Panel")).toBeInTheDocument();
    expect(screen.getByText("Admin Mode")).toBeInTheDocument();
    expect(screen.getByText("Admin Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Student Site")).toBeInTheDocument();
    expect(screen.queryByText("PTE Practice")).not.toBeInTheDocument();
    expect(screen.queryByText("More")).not.toBeInTheDocument();
  });
});

describe("Admin can move freely between the two sites (Part 4/10 item 4)", () => {
  it("clicking Student Site from the admin sidebar takes the admin to the normal dashboard, same session", async () => {
    mockAdminDashboardApis();
    renderAt("/admin", adminUser());
    await screen.findByText("Admin Panel");

    fireEvent.click(screen.getByText("Student Site"));
    expect(await screen.findByText(/Welcome back/)).toBeInTheDocument();
    expect(localStorage.getItem("pte_token")).toBe("test-token"); // same session, no re-login
  });

  it("from the student site, an admin sees a clear Admin Panel link and can return to it", async () => {
    renderAt("/dashboard", adminUser());
    await screen.findByText(/Welcome back/);
    const link = screen.getByText("Admin Panel").closest("a");
    expect(link).toHaveAttribute("href", "/admin");
  });
});

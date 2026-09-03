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
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(), details: vi.fn() }
  }
}));

function adminAuthUser() { return { role: "admin", name: "Admin", username: "admin" }; }
function renderAt(path, user) {
  if (user) {
    localStorage.setItem("pte_token", "test-token");
    localStorage.setItem("pte_user", JSON.stringify(user));
  }
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: { active: 0, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 }, subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
  api.admin.getAuditLog.mockResolvedValue({ logs: [] });
  api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
  api.admin.listUsers.mockResolvedValue({ users: [], total: 0, page: 1, totalPages: 1 });
});

describe("Login page — one device/one browser notice", () => {
  it("shows the device/browser policy notice on the login page", () => {
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    expect(screen.getByText("⚠️ One Device & One Browser Policy")).toBeInTheDocument();
    expect(screen.getByText(/Your account is restricted to one device and one browser\./)).toBeInTheDocument();
  });

  it("still shows a rejected-login error alongside the notice, without replacing it", async () => {
    api.auth.signin.mockRejectedValue(Object.assign(new Error("Your account is restricted to the device and browser where it was first registered."), { code: "DEVICE_NOT_REGISTERED" }));
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText("e.g. pte001"), { target: { value: "pte001" } });
    fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("Sign In"));

    expect(await screen.findByText(/restricted to the device and browser where it was first registered/)).toBeInTheDocument();
    expect(screen.getByText("⚠️ One Device & One Browser Policy")).toBeInTheDocument();
  });
});

describe("Admin — account-created message", () => {
  it("shows a copyable account-created message containing the one-device/one-browser warning after creating a user", async () => {
    api.admin.createUser.mockResolvedValue({ user: { username: "pte099" }, temporaryPassword: "Tmp12345" });
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("+ Create user"));
    fireEvent.change(screen.getByPlaceholderText("pte002"), { target: { value: "pte099" } });
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "New Student" } });
    fireEvent.click(screen.getByText("Create user"));

    await screen.findByText("Account created");
    const messageBox = document.querySelector("textarea[readonly]");
    expect(messageBox.value).toContain("👤 Username: pte099");
    expect(messageBox.value).toContain("🔑 Password: Tmp12345");
    expect(messageBox.value).toContain("Your account is device restricted. It will only work on one device and one browser.");
    expect(messageBox.value).toContain("If you need to change your device or browser, please contact the administrator for assistance.");
    expect(messageBox.value).toContain("MyPTEScore");
  });

  it("closing the account-created modal does not affect the existing temporary-password toast", async () => {
    api.admin.createUser.mockResolvedValue({ user: { username: "pte098" }, temporaryPassword: "Tmp99999" });
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("+ Create user"));
    fireEvent.change(screen.getByPlaceholderText("pte002"), { target: { value: "pte098" } });
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Another Student" } });
    fireEvent.click(screen.getByText("Create user"));

    // Existing behaviour, unchanged: the toast still carries the temporary password.
    expect(await screen.findByText(/Temporary password: Tmp99999/)).toBeInTheDocument();
    await screen.findByText("Account created");
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(screen.queryByText("Account created")).not.toBeInTheDocument());
  });
});

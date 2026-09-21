import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// Temporary/emergency admin feature — see the removal note at the top of
// client/src/pages/admin/AdminSubscriptionExtension.jsx. This whole test file is deleted as part
// of removing that feature; nothing here is shared with any other test.

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
      subscriptionExtension: {
        extendUser: vi.fn(),
        bulkPreview: vi.fn(),
        bulkExtend: vi.fn(),
        history: vi.fn()
      },
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
  api.admin.getStats.mockResolvedValue(emptyStats());
  api.admin.getAuditLog.mockResolvedValue({ logs: [] });
  api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
  api.admin.questions.types.mockResolvedValue({ types: [] });
  api.admin.questions.list.mockResolvedValue({ data: [], page: 1, limit: 20, total: 0, totalPages: 1 });
  api.admin.listUsers.mockResolvedValue(usersPage([]));
  api.admin.getUser.mockResolvedValue({ user: sampleUser(), sessions: [] });
  api.dashboard.mockResolvedValue({ stats: { overall: 0, practiceCount: 0, streak: 0, targetScore: 79 }, bySection: [], recent: [] });
  api.questions.mockResolvedValue({ questions: [] });
});

async function openUserDetail(userOverrides = {}) {
  api.admin.listUsers.mockResolvedValueOnce(usersPage([sampleUser(userOverrides)]));
  api.admin.getUser.mockResolvedValue({ user: sampleUser(userOverrides), sessions: [] });
  renderAt("/admin", adminAuthUser());
  fireEvent.click(await screen.findByText("Users"));
  fireEvent.click(await screen.findByText("Manage"));
  await screen.findByText("Actions");
}

describe("individual Extend Subscription", () => {
  it("shows the Extend Subscription button only for a user with an active subscription", async () => {
    await openUserDetail({ subscriptionStatus: "ACTIVE" });
    expect(screen.getByText("Extend Subscription")).toBeInTheDocument();
  });

  it("hides the Extend Subscription button for a user without an active subscription", async () => {
    await openUserDetail({ subscriptionStatus: "EXPIRED" });
    expect(screen.queryByText("Extend Subscription")).not.toBeInTheDocument();
  });

  it("opens the modal with the current expiry shown", async () => {
    await openUserDetail();
    fireEvent.click(screen.getByText("Extend Subscription"));
    const dialog = await screen.findByRole("dialog", { name: "Extend Subscription" });
    expect(within(dialog).getByText("Current Expiry")).toBeInTheDocument();
    expect(within(dialog).getByText("9/30/2026")).toBeInTheDocument();
  });

  it("disables the confirm button until both days and reason are valid", async () => {
    await openUserDetail();
    fireEvent.click(screen.getByText("Extend Subscription"));
    const dialog = await screen.findByRole("dialog", { name: "Extend Subscription" });
    const confirmBtn = within(dialog).getByRole("button", { name: "Extend Subscription" });
    expect(confirmBtn).toBeDisabled(); // reason starts blank

    fireEvent.change(within(dialog).getByLabelText("Extra days"), { target: { value: "0" } });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Portal technical issue" } });
    expect(confirmBtn).toBeDisabled(); // 0 is not a positive integer
    expect(within(dialog).getByText("Extra days must be a positive whole number.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Extra days"), { target: { value: "7" } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("requires a non-blank reason even when days is valid", async () => {
    await openUserDetail();
    fireEvent.click(screen.getByText("Extend Subscription"));
    const dialog = await screen.findByRole("dialog", { name: "Extend Subscription" });
    fireEvent.change(within(dialog).getByLabelText("Extra days"), { target: { value: "7" } });
    expect(within(dialog).getByRole("button", { name: "Extend Subscription" })).toBeDisabled();
    expect(within(dialog).getByText("A reason is required.")).toBeInTheDocument();
  });

  it("computes and shows the correct new expiry preview", async () => {
    await openUserDetail();
    fireEvent.click(screen.getByText("Extend Subscription"));
    const dialog = await screen.findByRole("dialog", { name: "Extend Subscription" });
    fireEvent.change(within(dialog).getByLabelText("Extra days"), { target: { value: "7" } });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Portal technical issue" } });
    expect(await within(dialog).findByText("10/7/2026")).toBeInTheDocument(); // 9/30 + 7 days
  });

  it("submits the extension and shows a success message", async () => {
    api.admin.subscriptionExtension.extendUser.mockResolvedValue({
      success: true, extensionId: "EXT-2026-001",
      user: sampleUser({ subscriptionEndDate: "2026-10-07T00:00:00.000Z" })
    });
    await openUserDetail();
    fireEvent.click(screen.getByText("Extend Subscription"));
    const dialog = await screen.findByRole("dialog", { name: "Extend Subscription" });
    fireEvent.change(within(dialog).getByLabelText("Extra days"), { target: { value: "7" } });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Portal technical issue" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Extend Subscription" }));
    await waitFor(() => expect(api.admin.subscriptionExtension.extendUser).toHaveBeenCalledWith("u1", 7, "Portal technical issue"));
  });

  it("shows an error message when the server rejects the extension", async () => {
    api.admin.subscriptionExtension.extendUser.mockRejectedValue(new Error("This user does not currently have an active subscription to extend."));
    await openUserDetail();
    fireEvent.click(screen.getByText("Extend Subscription"));
    const dialog = await screen.findByRole("dialog", { name: "Extend Subscription" });
    fireEvent.change(within(dialog).getByLabelText("Extra days"), { target: { value: "7" } });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Portal technical issue" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Extend Subscription" }));
    expect(await within(dialog).findByText("This user does not currently have an active subscription to extend.")).toBeInTheDocument();
  });
});

describe("bulk Extend All Active Subscriptions", () => {
  it("shows the correct active-user count after Preview", async () => {
    api.admin.subscriptionExtension.bulkPreview.mockResolvedValue({
      affectedUsers: 72, days: 7,
      sample: [{ username: "userA", name: "User A", previousExpiry: "2026-09-30T00:00:00.000Z", newExpiry: "2026-10-07T00:00:00.000Z" }]
    });
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("Extend All Active Subscriptions"));
    fireEvent.change(screen.getByLabelText("Extra days"), { target: { value: "7" } });
    fireEvent.click(screen.getByText("Preview"));
    expect(await screen.findByText("72")).toBeInTheDocument();
    expect(api.admin.subscriptionExtension.bulkPreview).toHaveBeenCalledWith(7);
  });

  it("requires confirmation before applying the bulk extension, then applies it", async () => {
    api.admin.subscriptionExtension.bulkPreview.mockResolvedValue({ affectedUsers: 72, days: 7, sample: [] });
    api.admin.subscriptionExtension.bulkExtend.mockResolvedValue({ success: true, affectedUsers: 72, daysAdded: 7, extensionId: "EXT-2026-002" });
    renderAt("/admin", adminAuthUser());
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByText("Extend All Active Subscriptions"));
    const mainDialog = await screen.findByRole("dialog", { name: "Extend All Active Subscriptions" });
    fireEvent.change(within(mainDialog).getByLabelText("Extra days"), { target: { value: "7" } });
    fireEvent.change(within(mainDialog).getByLabelText("Reason"), { target: { value: "Portal technical issue" } });
    fireEvent.click(within(mainDialog).getByText("Preview"));
    await within(mainDialog).findByText("72");

    fireEvent.click(within(mainDialog).getByRole("button", { name: "Extend All Active Subscriptions" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Confirm bulk extension" });
    expect(within(confirmDialog).getByText(/Are you sure you want to extend 72 active subscriptions by 7 days\?/)).toBeInTheDocument();
    expect(api.admin.subscriptionExtension.bulkExtend).not.toHaveBeenCalled();

    fireEvent.click(within(confirmDialog).getByText("Confirm Extension"));
    await waitFor(() => expect(api.admin.subscriptionExtension.bulkExtend).toHaveBeenCalledWith(7, "Portal technical issue", expect.any(String)));
    expect(await screen.findByText(/Extended 72 active subscriptions by 7 days/)).toBeInTheDocument();
  });
});

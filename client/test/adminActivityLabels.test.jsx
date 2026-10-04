import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";
import { pagerText } from "./pagerHelpers.js";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn(),
      media: { upload: vi.fn() },
      questions: { types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn() }
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function renderAdminDashboard() {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify({ role: "admin", name: "Admin", username: "admin" }));
  return render(<MemoryRouter initialEntries={["/admin"]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.admin.getStats.mockResolvedValue({ totalUsers: 3, accountStatus: { active: 3, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 3, failed: 0, refunded: 0 }, subscription: { active: 3, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
  api.admin.questions.stats.mockResolvedValue({ total: 10, active: 8, inactive: 2, byEvaluationType: { objective: 6, subjective: 4 } });
});

describe("admin dashboard — question activity labels", () => {
  it("shows human-friendly labels for every question audit action, including which question it affected", async () => {
    api.admin.getAuditLog.mockResolvedValue({
      logs: [
        { id: "l1", action: "QUESTION_CREATED", admin: { username: "admin" }, target: null, metadata: { title: "New MCQ" }, createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "l2", action: "QUESTION_UPDATED", admin: { username: "admin" }, target: null, metadata: { title: "Edited Q" }, createdAt: "2026-09-01T00:01:00.000Z" },
        { id: "l3", action: "QUESTION_ACTIVATED", admin: { username: "admin" }, target: null, metadata: { title: "Published Q" }, createdAt: "2026-09-01T00:02:00.000Z" },
        { id: "l4", action: "QUESTION_DEACTIVATED", admin: { username: "admin" }, target: null, metadata: { title: "Draft Q" }, createdAt: "2026-09-01T00:03:00.000Z" },
        { id: "l5", action: "QUESTION_DELETED", admin: { username: "admin" }, target: null, metadata: { title: "Removed Q" }, createdAt: "2026-09-01T00:04:00.000Z" }
      ]
    });
    renderAdminDashboard();

    expect(await screen.findByText(/created a question/)).toBeInTheDocument();
    expect(screen.getByText(/updated a question/)).toBeInTheDocument();
    expect(screen.getByText(/\bpublished a question/)).toBeInTheDocument();
    expect(screen.getByText(/unpublished a question/)).toBeInTheDocument();
    expect(screen.getByText(/deleted a question/)).toBeInTheDocument();

    // The stored/raw action names (e.g. "QUESTION_CREATED") are never shown verbatim to the admin.
    expect(screen.queryByText(/QUESTION_CREATED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/QUESTION_DEACTIVATED/)).not.toBeInTheDocument();

    // The affected question's title is shown, the same way a user action shows the target user.
    expect(screen.getByText('"New MCQ"')).toBeInTheDocument();
    expect(screen.getByText('"Removed Q"')).toBeInTheDocument();
  });

  it("still shows the existing human-friendly labels for user-management actions unchanged", async () => {
    api.admin.getAuditLog.mockResolvedValue({
      logs: [{ id: "l1", action: "USER_BLOCKED", admin: { username: "admin" }, target: { username: "pte001" }, metadata: {}, createdAt: "2026-09-01T00:00:00.000Z" }]
    });
    renderAdminDashboard();
    expect(await screen.findByText(/blocked/)).toBeInTheDocument();
    expect(screen.getByText("pte001")).toBeInTheDocument();
  });
});

function activityPage(page, totalPages, username) {
  return {
    logs: [{ id: `l-${page}`, action: "USER_BLOCKED", admin: { username: "admin" }, target: { username }, metadata: {}, createdAt: "2026-09-01T00:00:00.000Z" }],
    total: totalPages * 8,
    page,
    limit: 8,
    totalPages
  };
}

describe("admin dashboard — activity pagination", () => {
  it("fetches a page only when its pager button is clicked, never ahead of time", async () => {
    api.admin.getAuditLog.mockResolvedValue(activityPage(1, 3, "pte001"));
    renderAdminDashboard();
    await screen.findByText("pte001");

    // The first paint costs exactly one page — nothing is prefetched.
    expect(api.admin.getAuditLog).toHaveBeenCalledTimes(1);
    expect(api.admin.getAuditLog).toHaveBeenLastCalledWith(8, 1);

    api.admin.getAuditLog.mockResolvedValue(activityPage(2, 3, "pte002"));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(await screen.findByText("pte002")).toBeInTheDocument();
    expect(api.admin.getAuditLog).toHaveBeenCalledTimes(2);
    expect(api.admin.getAuditLog).toHaveBeenLastCalledWith(8, 2);
    expect(pagerText()).toMatch(/Page 2 of 3/);
  });

  it("disables Previous on the first page and Next on the last", async () => {
    api.admin.getAuditLog.mockResolvedValue(activityPage(3, 3, "pte003"));
    renderAdminDashboard();
    await screen.findByText("pte003");

    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Previous/ })).not.toBeDisabled();
  });

  // A response with no paging fields at all is what every other admin test mocks, and what the
  // endpoint returned before it was paged — it must still render as a single unpaged list.
  it("hides the pager entirely when there is only one page", async () => {
    api.admin.getAuditLog.mockResolvedValue({
      logs: [{ id: "l1", action: "USER_BLOCKED", admin: { username: "admin" }, target: { username: "pte001" }, metadata: {}, createdAt: "2026-09-01T00:00:00.000Z" }]
    });
    renderAdminDashboard();
    await screen.findByText("pte001");

    expect(screen.queryByRole("button", { name: /Next/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Previous/ })).not.toBeInTheDocument();
  });
});

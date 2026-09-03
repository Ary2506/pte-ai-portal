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
      questions: { types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn() },
      testSessions: { list: vi.fn(), get: vi.fn() }
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(), details: vi.fn() }
  }
}));

function adminAuthUser() { return { role: "admin", name: "Admin", username: "admin" }; }
function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

function sessionRow(overrides = {}) {
  return {
    _id: "ts1", user: { username: "pte001", name: "Test Student" }, status: "COMPLETED",
    totalScore: 3, totalMaxScore: 4, pendingSubjective: false,
    startedAt: "2026-08-31T09:00:00.000Z", submittedAt: "2026-08-31T09:20:00.000Z", expiresAt: "2026-08-31T09:20:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: { active: 0, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 }, subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
  api.admin.getAuditLog.mockResolvedValue({ logs: [] });
  api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
  api.dashboard.mockResolvedValue({ stats: { overall: 0, practiceCount: 0, streak: 0, targetScore: 79 }, bySection: [], recent: [] });
});

async function openMockTestsTab() {
  renderAt("/admin", adminAuthUser());
  fireEvent.click(await screen.findByText("Test Sessions"));
}

describe("Admin — mock test session visibility (list)", () => {
  it("renders the list with student, status, and score", async () => {
    api.admin.testSessions.list.mockResolvedValue({ testSessions: [sessionRow()], total: 1, page: 1, limit: 20, totalPages: 1 });
    await openMockTestsTab();

    expect(await screen.findByText("pte001")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();
  });

  it("supports pagination — Next requests the next page", async () => {
    api.admin.testSessions.list.mockResolvedValue({
      testSessions: [sessionRow({ _id: "ts1", user: { username: "pte001" } })],
      total: 25, page: 1, limit: 20, totalPages: 2
    });
    await openMockTestsTab();
    await screen.findByText("pte001");

    api.admin.testSessions.list.mockResolvedValue({
      testSessions: [sessionRow({ _id: "ts2", user: { username: "pte003" } })],
      total: 25, page: 2, limit: 20, totalPages: 2
    });
    fireEvent.click(screen.getByText("Next ›"));

    await waitFor(() => expect(api.admin.testSessions.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    expect(await screen.findByText("pte003")).toBeInTheDocument();
  });

  it("shows an error state if the list request fails", async () => {
    api.admin.testSessions.list.mockRejectedValue(new Error("Admin access required"));
    await openMockTestsTab();
    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
  });
});

describe("Admin — mock test session visibility (detail)", () => {
  it("opens a session's detail and renders its submissions", async () => {
    api.admin.testSessions.list.mockResolvedValue({ testSessions: [sessionRow()], total: 1, page: 1, limit: 20, totalPages: 1 });
    api.admin.testSessions.get.mockResolvedValue({
      testSession: sessionRow(),
      results: [{
        _id: "sub1", section: "reading", type: "mcq-single",
        question: { _id: "q1", title: "Reading MCQ", prompt: "Pick one.", options: ["A", "B"] },
        answer: 0, score: 1, maxScore: 1, evaluationType: "objective", evaluationStatus: "COMPLETED",
        feedback: { correct: true, feedback: ["Correct."] }
      }]
    });
    await openMockTestsTab();
    fireEvent.click(await screen.findByText("View"));

    await waitFor(() => expect(api.admin.testSessions.get).toHaveBeenCalledWith("ts1"));
    expect(await screen.findByText("Reading MCQ")).toBeInTheDocument();
    expect(screen.getByText("Your answer: A")).toBeInTheDocument();
  });
});

describe("Admin — mock test session access is admin-only", () => {
  it("a non-admin never reaches the admin panel at all (existing role redirect)", async () => {
    renderAt("/admin", { role: "student", name: "Student", username: "pte001" });
    await waitFor(() => expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument());
    expect(api.admin.testSessions.list).not.toHaveBeenCalled();
  });
});

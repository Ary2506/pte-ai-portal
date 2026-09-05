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
  },
  forceLogout: vi.fn()
}));

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.dashboard.mockResolvedValue({
    stats: { overall: 0, practiceCount: 0, targetScore: 79 }, bySection: [], recent: [],
    streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false }, weeklyActivity: []
  });
  api.history.mockResolvedValue({ submissions: [] });
  api.testSessions.list.mockResolvedValue({ testSessions: [] });
});

describe("Phase 23 — header search is real, not decorative", () => {
  it("shows only genuinely matching, real destinations and navigates on click", async () => {
    renderAt("/dashboard", studentAuthUser());
    const input = await screen.findByPlaceholderText("Search anything...");
    fireEvent.change(input, { target: { value: "Read Aloud" } });
    const result = await screen.findByRole("option", { name: /Read Aloud/ });
    expect(result).toBeInTheDocument();

    api.questions.mockResolvedValue({ questions: [] });
    fireEvent.click(result);
    await screen.findByText("No practice questions available yet.");
  });

  it("shows an honest 'no matches' state instead of fabricating results", async () => {
    renderAt("/dashboard", studentAuthUser());
    const input = await screen.findByPlaceholderText("Search anything...");
    fireEvent.change(input, { target: { value: "zzz-nonexistent-page" } });
    expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  });

  it("never lists Admin destinations for a student", async () => {
    renderAt("/dashboard", studentAuthUser());
    const input = await screen.findByPlaceholderText("Search anything...");
    fireEvent.change(input, { target: { value: "Admin" } });
    expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  });

  it("Enter navigates to the highlighted result", async () => {
    api.questions.mockResolvedValue({ questions: [] });
    renderAt("/dashboard", studentAuthUser());
    const input = await screen.findByPlaceholderText("Search anything...");
    fireEvent.change(input, { target: { value: "Practice History" } });
    await screen.findByRole("option", { name: "Practice History" });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Practice History", { selector: "h1" });
  });
});

describe("Phase 23 — Practice History section filter", () => {
  const ROWS = [
    { _id: "s1", type: "read-aloud", section: "speaking", evaluationType: "subjective", score: 80, maxScore: 90, evaluationStatus: "COMPLETED", createdAt: "2026-01-01T00:00:00.000Z" },
    { _id: "s2", type: "mcq-single", section: "reading", evaluationType: "objective", score: 1, maxScore: 1, evaluationStatus: "COMPLETED", createdAt: "2026-01-02T00:00:00.000Z" }
  ];

  it("filters the practice-attempts table by section without touching the real fetched data", async () => {
    api.history.mockResolvedValue({ submissions: ROWS });
    renderAt("/history", studentAuthUser());
    await screen.findByText("read-aloud");
    expect(screen.getByText("mcq-single")).toBeInTheDocument();

    // "Speaking"/"Writing"/etc. also appear as mock-table column headers on this same page —
    // the filter tabs are scoped by role to disambiguate.
    fireEvent.click(screen.getByRole("tab", { name: "Speaking" }));
    expect(screen.getByText("read-aloud")).toBeInTheDocument();
    expect(screen.queryByText("mcq-single")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("mcq-single")).toBeInTheDocument();
  });

  it("shows an honest empty state distinct from 'no submissions at all' when a filter matches nothing", async () => {
    api.history.mockResolvedValue({ submissions: ROWS });
    renderAt("/history", studentAuthUser());
    await screen.findByText("read-aloud");
    fireEvent.click(screen.getByRole("tab", { name: "Writing" }));
    expect(await screen.findByText("No practice attempts match this filter.")).toBeInTheDocument();
  });
});

describe("Phase 23 — a real fetch failure shows a friendly error with Retry, distinct from genuine empty content", () => {
  it("shows a retry-capable error state, and Retry re-fetches successfully", async () => {
    api.questions.mockRejectedValueOnce(new Error("Failed to fetch"));
    renderAt("/reading", studentAuthUser());

    await screen.findByText("Unable to load your questions");
    expect(screen.getByText("Please check your connection and try again.")).toBeInTheDocument();
    // The raw browser error is never shown to the student.
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();

    api.questions.mockResolvedValueOnce({ questions: [{ _id: "q1", section: "reading", type: "fill-blanks", title: "Q1", prompt: "P", options: ["a", "b"] }] });
    fireEvent.click(screen.getByText("Retry"));
    await screen.findByText("Q1");
  });
});

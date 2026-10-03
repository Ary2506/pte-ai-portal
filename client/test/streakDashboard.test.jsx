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

const studentUser = {
  role: "student", name: "Student", username: "pte001",
  subscriptionStatus: "ACTIVE",
  subscriptionStartDate: "2026-08-01T00:00:00.000Z",
  subscriptionEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
};

beforeEach(() => { vi.clearAllMocks(); });

describe("dashboard — real daily learning streak", () => {
  it("shows the current streak, longest streak, and a 'learned today' badge", async () => {
    api.dashboard.mockResolvedValue({
      stats: { overall: 60, practiceCount: 4, targetScore: 79 },
      bySection: [], recent: [],
      streak: { currentStreak: 5, longestStreak: 12, lastLearningDate: "2026-08-31", learnedToday: true },
      weeklyActivity: []
    });
    renderAt("/dashboard", studentUser);

    // The card is plain data now — no flame emoji, no cheerleading line. The facts it has to
    // carry are unchanged: current streak, longest streak, and whether today is done.
    expect(await screen.findByText("Practice streak")).toBeInTheDocument();
    expect(document.querySelector(".streak-figure strong")).toHaveTextContent("5");
    expect(screen.getByText("Done today")).toBeInTheDocument();
    expect(screen.getByText("12 days")).toBeInTheDocument();
  });

  it("shows the not-learned-today prompt when the student hasn't practiced yet today", async () => {
    api.dashboard.mockResolvedValue({
      stats: { overall: 0, practiceCount: 0, targetScore: 79 },
      bySection: [], recent: [],
      streak: { currentStreak: 3, longestStreak: 3, lastLearningDate: "2026-08-30", learnedToday: false },
      weeklyActivity: []
    });
    renderAt("/dashboard", studentUser);

    expect(await screen.findByText("Practice streak")).toBeInTheDocument();
    expect(document.querySelector(".streak-figure strong")).toHaveTextContent("3");
    expect(screen.getByText("Not yet today")).toBeInTheDocument();
  });

  it("shows a zero-day streak state for a student with no learning activity yet", async () => {
    api.dashboard.mockResolvedValue({
      stats: { overall: 0, practiceCount: 0, targetScore: 79 },
      bySection: [], recent: [],
      streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false },
      weeklyActivity: []
    });
    renderAt("/dashboard", studentUser);

    expect(await screen.findByText("Practice streak")).toBeInTheDocument();
    expect(document.querySelector(".streak-figure strong")).toHaveTextContent("0");
  });

  it("renders the weekly activity indicator with one entry per returned day", async () => {
    api.dashboard.mockResolvedValue({
      stats: { overall: 0, practiceCount: 0, targetScore: 79 },
      bySection: [], recent: [],
      streak: { currentStreak: 1, longestStreak: 1, lastLearningDate: "2026-08-31", learnedToday: true },
      weeklyActivity: [
        { date: "2026-08-25", active: false },
        { date: "2026-08-26", active: true },
        { date: "2026-08-27", active: true },
        { date: "2026-08-28", active: false },
        { date: "2026-08-29", active: true },
        { date: "2026-08-30", active: false },
        { date: "2026-08-31", active: true }
      ]
    });
    renderAt("/dashboard", studentUser);

    expect(await screen.findByText("Last 7 days")).toBeInTheDocument();
    // 4 active + 3 inactive days in the fixture above. A missed day is an empty cell rather than
    // a red cross, so the two states are told apart by class, and each day names itself for a
    // screen reader instead of relying on colour.
    const days = document.querySelectorAll(".streak-day");
    expect(days).toHaveLength(7);
    expect(document.querySelectorAll(".streak-day.is-active")).toHaveLength(4);
    expect(screen.getByText("4 of 7")).toBeInTheDocument();
    expect(screen.getByText("2026-08-26: practised")).toBeInTheDocument();
    expect(screen.getByText("2026-08-25: no practice")).toBeInTheDocument();
  });
});

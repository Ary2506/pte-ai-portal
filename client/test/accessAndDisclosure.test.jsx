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
  }
}));

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
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
  api.dashboard.mockResolvedValue({
    stats: { overall: 0, practiceCount: 0, targetScore: 79 }, bySection: [], recent: [],
    streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false }, weeklyActivity: []
  });
});

describe("Access control — Part 19/27 item 31", () => {
  it("an unauthenticated visitor requesting a protected practice route sees the login page, not the practice UI, and no protected API is ever called", async () => {
    renderAt("/practice", null);
    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    expect(screen.queryByText("PTE Practice", { selector: "h1" })).not.toBeInTheDocument();
    expect(api.questions).not.toHaveBeenCalled();
    expect(api.dashboard).not.toHaveBeenCalled();
  });

  it("an unauthenticated visitor requesting /speaking directly also lands on the login page", async () => {
    renderAt("/speaking", null);
    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    expect(api.questions).not.toHaveBeenCalled();
  });
});

describe("AI limitation disclosure — Part 7/27 item 30", () => {
  it("Speaking practice discloses that only the transcript is evaluated, never audio/pronunciation, before recording starts", async () => {
    api.questions.mockResolvedValue({ questions: [{ _id: "q1", type: "read-aloud", title: "Read Aloud", prompt: "Read this." }] });
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Read Aloud", { selector: "h2" });
    expect(screen.getByText(/Only your transcript is evaluated — pronunciation and audio quality are not analyzed\./)).toBeInTheDocument();
  });
});

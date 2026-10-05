import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// The plan is derived, not templated. The old page fell back to four hardcoded task strings
// ("Complete 10 speaking questions"…) whenever the request was slow, so every student saw the
// same advice regardless of how they were actually doing.

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    dashboard: vi.fn(), history: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })), plan: vi.fn(), submit: vi.fn(),
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  },
  forceLogout: vi.fn()
}));

const student = { id: "s1", role: "student", name: "Sam", username: "pte001", targetScore: 79, subscriptionStatus: "ACTIVE" };
const today = () => new Date().toISOString();
const attempt = (over = {}) => ({
  _id: Math.random().toString(36).slice(2), section: "reading", type: "mcq-single",
  score: 8, maxScore: 10, evaluationStatus: "COMPLETED", createdAt: today(), ...over
});

function renderPlan() {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify(student));
  return render(<MemoryRouter initialEntries={["/plan"]}><App /></MemoryRouter>);
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe("no fabricated plan content", () => {
  it("shows an honest empty state instead of canned tasks before any practice", async () => {
    api.history.mockResolvedValue({ submissions: [], total: 0 });
    renderPlan();
    expect(await screen.findByText("Your plan starts with your first attempt")).toBeInTheDocument();
    expect(screen.queryByText(/Complete 10 speaking questions/)).not.toBeInTheDocument();
  });

  it("does not fall back to a template when the request fails", async () => {
    api.history.mockRejectedValue(new Error("down"));
    renderPlan();
    expect(await screen.findByText("Your plan starts with your first attempt")).toBeInTheDocument();
    expect(screen.queryByText(/Learn 10 high-frequency/)).not.toBeInTheDocument();
  });
});

describe("the week is ordered by real weakness", () => {
  it("puts the weakest section first", async () => {
    api.history.mockResolvedValue({
      submissions: [
        ...Array.from({ length: 3 }, () => attempt({ section: "speaking", score: 2, maxScore: 10, type: "read-aloud" })),
        ...Array.from({ length: 3 }, () => attempt({ section: "reading", score: 9, maxScore: 10 }))
      ], total: 6
    });
    renderPlan();
    await screen.findByText("A suggested order, weakest section first");
    const days = document.querySelectorAll(".plan-day");
    expect(days).toHaveLength(7);
    expect(days[0].querySelector(".plan-day__focus").textContent).toBe("Speaking");
    // Saturday is the mock and Sunday is review; both are fixed days of the calendar week now,
    // not whichever day the rolling window happened to end on.
    expect(days[5].querySelector(".plan-day__focus").textContent).toBe("Mock test");
    expect(days[6].querySelector(".plan-day__focus").textContent).toBe("Review");
  });

  it("marks a day done from a real scored attempt in that section on that date", async () => {
    api.history.mockResolvedValue({
      submissions: [
        ...Array.from({ length: 3 }, () => attempt({ section: "speaking", score: 2, maxScore: 10, type: "read-aloud", createdAt: "2020-01-01T00:00:00.000Z" })),
        ...Array.from({ length: 3 }, () => attempt({ section: "reading", score: 9, maxScore: 10, createdAt: "2020-01-01T00:00:00.000Z" }))
      ], total: 6
    });
    renderPlan();
    await screen.findByText("A suggested order, weakest section first");
    // Every attempt is years old, so no day this week can be done.
    expect(document.querySelectorAll(".plan-day.is-done")).toHaveLength(0);
  });

  it("states the target gap from AI-scored attempts, not from reading accuracy", async () => {
    api.history.mockResolvedValue({
      submissions: [
        attempt({ score: 7, maxScore: 10 }),  // 70% accurate, but raw marks — not comparable
        attempt({ section: "writing", type: "essay", evaluationType: "subjective", score: 68, maxScore: 90 }),
        attempt({ section: "writing", type: "essay", evaluationType: "subjective", score: 72, maxScore: 90 })
      ], total: 3
    });
    renderPlan();
    // AI average is 70 against a target of 79 → 9 points to go.
    expect(await screen.findByText(/9 points from your target of 79, on AI-scored tasks/)).toBeInTheDocument();
  });

  it("says what is missing rather than comparing a target to objective accuracy", async () => {
    api.history.mockResolvedValue({
      submissions: Array.from({ length: 4 }, () => attempt({ score: 7, maxScore: 10 })), total: 4
    });
    renderPlan();
    expect(await screen.findByText(/AI-scored speaking or writing tasks to track progress/)).toBeInTheDocument();
  });
});

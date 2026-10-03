import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), activity: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
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

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function activity({ days = {}, streak, from = daysAgo(40), joinedAt = daysAgo(40), truncated = false } = {}) {
  return { from, to: today, joinedAt, truncated, days, streak };
}

// The streak moved from the dashboard to the profile, where it now has room for a full
// contribution-style calendar. What it has to report is unchanged: current streak, longest
// streak, whether today is done, and which days actually had practice.
describe("profile — real daily learning streak", () => {
  beforeEach(() => {
    api.history.mockResolvedValue({ submissions: [], total: 0 });
  });

  it("shows the current streak, longest streak, and that today is done", async () => {
    api.activity.mockResolvedValue(activity({
      days: { [today]: 2 },
      streak: { currentStreak: 5, longestStreak: 12, lastLearningDate: today, learnedToday: true }
    }));
    renderAt("/profile", studentUser);

    await screen.findByText("Your practice record");
    const strip = document.querySelector(".streak-panel .metric-strip");
    expect(strip).toHaveTextContent("5");
    expect(strip).toHaveTextContent("12");
    expect(strip).toHaveTextContent("Practised today");
  });

  it("prompts when the student has not practised yet today", async () => {
    api.activity.mockResolvedValue(activity({
      days: { [daysAgo(1)]: 1 },
      streak: { currentStreak: 3, longestStreak: 3, lastLearningDate: daysAgo(1), learnedToday: false }
    }));
    renderAt("/profile", studentUser);

    await screen.findByText("Your practice record");
    expect(screen.getByText("Practise today to keep it going")).toBeInTheDocument();
  });

  it("shows dashes, not zeros, for a student with no learning activity yet", async () => {
    api.activity.mockResolvedValue(activity({
      days: {},
      streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false }
    }));
    renderAt("/profile", studentUser);

    await screen.findByText("Your practice record");
    const strip = document.querySelector(".streak-panel .metric-strip");
    // Longest streak, last activity and days practised have nothing to report.
    expect(strip.querySelectorAll(".metric-empty").length).toBeGreaterThanOrEqual(3);
  });

  it("draws one cell per day in the range and marks only the days with real activity", async () => {
    api.activity.mockResolvedValue(activity({
      from: daysAgo(6), joinedAt: daysAgo(6),
      days: { [today]: 1, [daysAgo(2)]: 4, [daysAgo(5)]: 12 },
      streak: { currentStreak: 1, longestStreak: 2, lastLearningDate: today, learnedToday: true }
    }));
    renderAt("/profile", studentUser);

    await screen.findByText("Your practice record");
    // Seven real days; the rest of the grid is padding outside the recorded range.
    const real = document.querySelectorAll(".streak-cal__grid .streak-cal__day:not(.is-empty)");
    expect(real.length).toBe(7);
    // Three of them had practice, at three different intensities.
    expect(document.querySelectorAll(".streak-cal__grid .streak-cal__day.is-l1").length).toBe(1);
    expect(document.querySelectorAll(".streak-cal__grid .streak-cal__day.is-l2").length).toBe(1);
    expect(document.querySelectorAll(".streak-cal__grid .streak-cal__day.is-l4").length).toBe(1);
    expect(screen.getByText(/Practised on/)).toHaveTextContent("3");
  });

  it("labels each day the way a person reads a date, for the hover tooltip", async () => {
    api.activity.mockResolvedValue(activity({
      from: "2026-10-01", joinedAt: "2026-10-01",
      days: { "2026-10-03": 8, "2026-10-01": 1 },
      streak: { currentStreak: 1, longestStreak: 1, lastLearningDate: "2026-10-03", learnedToday: false }
    }));
    renderAt("/profile", studentUser);

    await screen.findByText("Your practice record");
    const cells = [...document.querySelectorAll(".streak-cal__grid .streak-cal__day[aria-label]")];
    const labels = cells.map((c) => c.getAttribute("aria-label"));
    expect(labels).toContain("8 activities on October 3rd");
    expect(labels).toContain("1 activity on October 1st");
    expect(labels).toContain("No practice on October 2nd");

    // Hovering a day shows that same text in a single tooltip over the calendar — not a
    // pseudo-element inside the scroller, which clipped the text at the container's edge.
    const third = cells.find((c) => c.getAttribute("aria-label") === "8 activities on October 3rd");
    fireEvent.mouseEnter(third);
    expect(document.querySelector(".streak-cal__tip")).toHaveTextContent("8 activities on October 3rd");
    expect(document.querySelectorAll(".streak-cal__tip").length).toBe(1);

    fireEvent.mouseLeave(document.querySelector(".streak-cal"));
    expect(document.querySelector(".streak-cal__tip")).toBeNull();
  });

  it("offers a since-joining view as well as the last 30 days", async () => {
    api.activity.mockResolvedValue(activity({
      from: daysAgo(6), joinedAt: daysAgo(6),
      days: { [today]: 1 },
      streak: { currentStreak: 1, longestStreak: 1, lastLearningDate: today, learnedToday: true }
    }));
    renderAt("/profile", studentUser);

    await screen.findByText("Your practice record");
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Since joining" })).toBeInTheDocument();
  });

  it("never draws blank days before the account existed", async () => {
    // A week-old account asked for a 30-day window would otherwise show three weeks of empty
    // cells that read as missed practice.
    api.activity.mockResolvedValue(activity({
      from: daysAgo(6), joinedAt: daysAgo(6),
      days: { [today]: 1 },
      streak: { currentStreak: 1, longestStreak: 1, lastLearningDate: today, learnedToday: true }
    }));
    renderAt("/profile", studentUser);

    await screen.findByText("Your practice record");
    expect(document.querySelectorAll(".streak-cal__grid .streak-cal__day:not(.is-empty)").length).toBe(7);
  });
});

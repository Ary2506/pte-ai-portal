import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// Performance Intelligence must be trustworthy before it is impressive: every figure traces to a
// real attempt, and anything the data cannot support shows an empty state instead of a number.

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    dashboard: vi.fn(() => Promise.resolve({ stats: {}, bySection: [], recent: [], streak: {}, weeklyActivity: [] })),
    history: vi.fn(), questions: vi.fn(), submit: vi.fn(), plan: vi.fn(),
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  },
  forceLogout: vi.fn()
}));

const student = { id: "s1", role: "student", name: "Sam", username: "pte001", targetScore: 79, subscriptionStatus: "ACTIVE" };

function renderProgress(user = student) {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={["/progress"]}><App /></MemoryRouter>);
}

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const attempt = (over = {}) => ({
  _id: Math.random().toString(36).slice(2), section: "reading", type: "mcq-single",
  score: 8, maxScore: 10, evaluationStatus: "COMPLETED", createdAt: day(1), ...over
});

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });

describe("empty and error states", () => {
  it("invites the student to start rather than showing zeros, when nothing is scored", async () => {
    api.history.mockResolvedValue({ submissions: [], total: 0 });
    renderProgress();
    expect(await screen.findByText("No scored attempts yet")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("offers a retry when history fails to load", async () => {
    api.history.mockRejectedValue(new Error("Network down"));
    renderProgress();
    expect(await screen.findByText("Could not load your performance data")).toBeInTheDocument();
    expect(screen.getByText("Network down")).toBeInTheDocument();

    api.history.mockResolvedValue({ submissions: [], total: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2));
  });
});

describe("figures come from the attempts themselves", () => {
  it("computes the average, best and target gap from real rows", async () => {
    api.history.mockResolvedValue({
      submissions: [
        attempt({ score: 6, maxScore: 10, createdAt: day(5) }),
        attempt({ score: 9, maxScore: 10, createdAt: day(4) }),
        attempt({ score: 7, maxScore: 10, createdAt: day(3) }),
        attempt({ score: 10, maxScore: 10, createdAt: day(2) })
      ], total: 4
    });
    renderProgress();
    // (60+90+70+100)/4 = 80 against a target of 79 → one point above.
    await screen.findByText(/You are averaging/);
    expect(screen.getByText(/1 point above it\./)).toBeInTheDocument();
    const ring = document.querySelector(".score-ring__body strong");
    expect(ring).toHaveTextContent("80");
  });

  it("will not chart a trend from too few attempts", async () => {
    api.history.mockResolvedValue({ submissions: [attempt(), attempt()], total: 2 });
    renderProgress();
    expect(await screen.findByText("Not enough attempts to chart a trend")).toBeInTheDocument();
    expect(document.querySelector(".intel-chart")).toBeNull();
  });

  it("shows a dash, never a zero, for a 7-day change with no baseline", async () => {
    api.history.mockResolvedValue({
      submissions: Array.from({ length: 4 }, () => attempt({ createdAt: day(1) })), total: 4
    });
    renderProgress();
    await screen.findByText("Score trajectory");
    // Every attempt is inside the window, so there is nothing to compare against.
    const windows = document.querySelector(".trend-windows");
    expect(windows.querySelectorAll(".metric-empty").length).toBeGreaterThan(0);
  });
});

describe("focus areas only recommend what the data supports", () => {
  it("names a weak task type with the gap that justifies it", async () => {
    api.history.mockResolvedValue({
      submissions: [
        ...Array.from({ length: 3 }, () => attempt({ type: "reorder", score: 3, maxScore: 10 })),
        ...Array.from({ length: 3 }, () => attempt({ type: "mcq-single", score: 9, maxScore: 10 }))
      ], total: 6
    });
    renderProgress();
    await screen.findByText("What to practise next");
    // Scoped to the focus list: the same task type also appears in the task-type table below.
    const focus = document.querySelector(".focus-list");
    expect(focus).toHaveTextContent("Reorder");
    expect(focus).toHaveTextContent(/below your Reading average/);
    // The reasoning is shown, not just the verdict: 3 attempts at 30 vs an average of 60.
    expect(focus).toHaveTextContent(/over 3 attempts/);
  });

  it("recommends nothing when there is too little to compare", async () => {
    api.history.mockResolvedValue({ submissions: [attempt(), attempt()], total: 2 });
    renderProgress();
    expect(await screen.findByText("Not enough data to pick a focus yet")).toBeInTheDocument();
  });

  it("marks a single-attempt task type as low sample so it is never ranked on", async () => {
    api.history.mockResolvedValue({
      submissions: [
        ...Array.from({ length: 3 }, () => attempt({ type: "reorder", score: 5, maxScore: 10 })),
        attempt({ type: "write-dictation", score: 1, maxScore: 10 })
      ], total: 4
    });
    renderProgress();
    await screen.findByText("Performance by task");
    expect(screen.getByText("Low sample")).toBeInTheDocument();
  });
});

describe("filtering", () => {
  it("recomputes the figures for one section only", async () => {
    api.history.mockResolvedValue({
      submissions: [
        attempt({ section: "reading", score: 10, maxScore: 10 }),
        attempt({ section: "speaking", score: 2, maxScore: 10, type: "read-aloud" })
      ], total: 2
    });
    renderProgress();
    await screen.findByText(/You are averaging/);
    expect(document.querySelector(".score-ring__body strong")).toHaveTextContent("60");

    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(document.querySelector(".score-ring__body strong")).toHaveTextContent("100"));
  });
});

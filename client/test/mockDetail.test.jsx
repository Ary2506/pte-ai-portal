import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// My Results used to offer a "View Details" action on each mock attempt, opening a modal that
// listed every question in the attempt in one long scroll. Both were removed: the row's section
// totals are what a student actually scans this table for, and the modal was an eighty-question
// scroll that nobody read to the end of.
//
// This file now pins the removal, so the button cannot creep back in unnoticed. The equivalent
// per-question view still exists for admins (AdminTestSessions, via MockResultRow).
vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn(),
      testSessions: { list: vi.fn(), get: vi.fn() } },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(),
    questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(), active: vi.fn(), details: vi.fn() }
  },
  forceLogout: vi.fn()
}));

const ATTEMPT = {
  _id: "ts1",
  submittedAt: new Date("2026-10-17T21:41:00Z").toISOString(),
  totalScore: 1,
  totalMaxScore: 80,
  sectionScores: [
    { section: "speaking", score: 0, maxScore: 20 },
    { section: "writing", score: 1, maxScore: 20 },
    { section: "reading", score: 0, maxScore: 20 },
    { section: "listening", score: 0, maxScore: 20 }
  ]
};

function renderHistory() {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "S", username: "pte001" }));
  return render(<MemoryRouter initialEntries={["/history"]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.history.mockResolvedValue({ submissions: [], total: 0 });
  api.testSessions.list.mockResolvedValue({ testSessions: [ATTEMPT] });
});

describe("a mock attempt row carries its own totals", () => {
  it("shows the overall mark and every section score", async () => {
    renderHistory();

    // Marks, not raw points: one mark per question, so the attempt is out of 80 and each
    // section out of the 20 it issued.
    expect(await screen.findByText("1/80")).toBeInTheDocument();
    const row = screen.getByText("1/80").closest("tr");
    expect(row).toHaveTextContent("1/20");
    expect(row).toHaveTextContent("0/20");
  });

  it("offers no details action, and fetches no per-question rows", async () => {
    renderHistory();
    await screen.findByText("1/80");

    expect(screen.queryByText("View Details")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
    // The removed modal was the only caller; nothing should request that payload now.
    await waitFor(() => expect(api.testSessions.details).not.toHaveBeenCalled());
  });

  it("never opens the attempt detail dialog", async () => {
    renderHistory();
    await screen.findByText("1/80");

    expect(screen.queryByText("Mock Test Details")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

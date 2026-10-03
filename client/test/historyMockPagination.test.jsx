import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// Two things here: the mock-attempts table pages (it previously rendered every completed session
// in one list), and "View all" from Progress and the Dashboard lands on the practice-attempts
// section of My Results rather than the top of the page.

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    dashboard: vi.fn(), history: vi.fn(), questions: vi.fn(), submit: vi.fn(), plan: vi.fn(),
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(), details: vi.fn() }
  },
  forceLogout: vi.fn()
}));

const student = { id: "s1", role: "student", name: "Sam", username: "pte001", targetScore: 79, subscriptionStatus: "ACTIVE" };

function mockSession(n) {
  return {
    _id: `m${n}`,
    submittedAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    totalScore: n, totalMaxScore: 40,
    sectionScores: [{ section: "reading", score: n, maxScore: 10 }]
  };
}

function renderAt(path) {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify(student));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.history.mockResolvedValue({ submissions: [], total: 0, page: 1, totalPages: 1 });
  api.testSessions.list.mockResolvedValue({ testSessions: [] });
});

describe("mock attempts pagination", () => {
  it("shows ten per page and moves between pages without refetching", async () => {
    const sessions = Array.from({ length: 23 }, (_, i) => mockSession(i + 1));
    api.testSessions.list.mockResolvedValue({ testSessions: sessions });
    renderAt("/history");

    await screen.findByText("Mock test attempts");
    await waitFor(() => expect(document.querySelectorAll(".table-wrap tbody tr").length).toBe(10));
    // Scoped to the pager: the mock record's average hint also mentions the attempt count.
    const pager = screen.getByText(/Page 1 of 3/);
    expect(pager).toHaveTextContent("23 attempts");

    const callsBefore = api.testSessions.list.mock.calls.length;
    fireEvent.click(screen.getAllByText("Next ›")[0]);
    await screen.findByText(/Page 2 of 3/);
    // The rows were already loaded; paging is a slice, not a request.
    expect(api.testSessions.list.mock.calls.length).toBe(callsBefore);

    fireEvent.click(screen.getAllByText("Next ›")[0]);
    await screen.findByText(/Page 3 of 3/);
    expect(document.querySelectorAll(".table-wrap tbody tr").length).toBe(3);
    expect(screen.getAllByText("Next ›")[0]).toBeDisabled();
  });

  it("shows no pager at all when everything fits on one page", async () => {
    api.testSessions.list.mockResolvedValue({ testSessions: [mockSession(1), mockSession(2)] });
    renderAt("/history");
    await screen.findByText("Mock test attempts");
    await waitFor(() => expect(document.querySelectorAll(".table-wrap tbody tr").length).toBe(2));
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument();
  });
});

describe("the mock record summarises the same rows the table pages through", () => {
  it("reports completed, best, latest and average as percentages", async () => {
    // 10/40, 20/40, 30/40 → 25%, 50%, 75%. Newest first, so 10/40 is the latest.
    api.testSessions.list.mockResolvedValue({
      testSessions: [
        { ...mockSession(1), totalScore: 10, totalMaxScore: 40 },
        { ...mockSession(2), totalScore: 20, totalMaxScore: 40 },
        { ...mockSession(3), totalScore: 30, totalMaxScore: 40 }
      ]
    });
    renderAt("/history");
    await screen.findByText("Mock test attempts");
    const strip = document.querySelector(".metric-strip");
    await waitFor(() => expect(strip.querySelector(".metric-value")).toHaveTextContent("3"));
    expect(strip).toHaveTextContent("75%");   // best
    expect(strip).toHaveTextContent("25%");   // latest
    expect(strip).toHaveTextContent("50%");   // average
  });

  it("shows dashes rather than zeros before any mock is completed", async () => {
    api.testSessions.list.mockResolvedValue({ testSessions: [] });
    renderAt("/history");
    await screen.findByText("Mock test attempts");
    const strip = document.querySelector(".metric-strip");
    await waitFor(() => expect(strip.querySelectorAll(".metric-empty").length).toBe(4));
  });
});

describe("View all lands on the practice attempts section", () => {
  it("links there from Progress", async () => {
    api.history.mockResolvedValue({
      submissions: Array.from({ length: 4 }, (_, i) => ({
        _id: `a${i}`, section: "reading", type: "mcq-single", score: 8, maxScore: 10,
        evaluationStatus: "COMPLETED", createdAt: new Date().toISOString()
      })), total: 4, page: 1, totalPages: 1
    });
    renderAt("/progress");
    const link = await screen.findByRole("link", { name: "View all" });
    expect(link).toHaveAttribute("href", "/history#practice-attempts");
  });

  it("gives My Results a heading for that link to reach", async () => {
    renderAt("/history");
    await screen.findByText("Practice attempts");
    expect(document.getElementById("practice-attempts")).not.toBeNull();
  });
});

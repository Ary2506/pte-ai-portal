import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  forceLogout: vi.fn(),
  publicApi: { sharedAnswer: vi.fn(), sharedAnswerAudioUrl: vi.fn() },
  api: {
    auth: { signin: vi.fn(), me: vi.fn(() => Promise.resolve({})), logout: vi.fn(() => Promise.resolve()) },
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function renderAt(path) {
  localStorage.clear();
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "Student", username: "pte001" }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

// 60 questions. The student answered q1..q20 first, then answered q21..q60 over and over — 150
// attempts in all, so the first 20 questions sit far outside the newest 50 (and the newest 100).
const QUESTIONS = Array.from({ length: 60 }, (_, i) => ({
  _id: `q${i + 1}`, section: "reading", type: "mcq-single", title: `MCQ ${i + 1}`, prompt: "Pick one.", options: ["A", "B"], evaluationType: "objective"
}));
const attempt = (n, qi, score) => ({
  _id: `s${n}`, section: "reading", type: "mcq-single", evaluationType: "objective", evaluationStatus: "COMPLETED",
  score, maxScore: 1, createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(), question: { _id: `q${qi}` }
});
function attempts() {
  const all = [];
  let n = 0;
  for (let q = 1; q <= 20; q++) all.push(attempt(++n, q, q === 1 ? 0 : 1)); // q1 first scored 0
  all.push(attempt(++n, 1, 1)); // ...then retried and scored 1: the best attempt must win
  while (all.length < 150) for (let q = 21; q <= 60 && all.length < 150; q++) all.push(attempt(++n, q, 1));
  return all.reverse(); // newest first, as the server sorts
}

/** The real /submissions/history paging contract: page + limit, newest first, totalPages. */
function serveHistory(rows, { failOnPage = null, totalPagesOverride = null } = {}) {
  api.history.mockImplementation(async ({ page = 1, limit = 50 } = {}) => {
    if (page === failOnPage) throw new Error("Network down");
    const totalPages = totalPagesOverride ?? Math.max(1, Math.ceil(rows.length / limit));
    return { submissions: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit, totalPages };
  });
}

const doneCount = () => document.body.textContent.match(/Done (\d+), Found/)?.[1];
const rowBadge = (title) => screen.getByText(title).closest(".question-list-row")?.textContent || "";

beforeEach(() => {
  vi.clearAllMocks();
  api.questions.mockResolvedValue({ questions: QUESTIONS });
});

describe("practice Done/Undone with more than 50 attempts at one task", () => {
  it("reads every page, in the summary shape, and marks every answered question Done", async () => {
    serveHistory(attempts());
    renderAt("/reading?type=mcq-single");
    await waitFor(() => expect(doneCount()).toBe("60"));
    expect(api.history).toHaveBeenCalledTimes(2); // 150 attempts = 2 pages of 100
    expect(api.history).toHaveBeenNthCalledWith(1, { section: "reading", type: "mcq-single", summary: 1, limit: 100, page: 1 });
    expect(api.history).toHaveBeenNthCalledWith(2, { section: "reading", type: "mcq-single", summary: 1, limit: 100, page: 2 });
    // The questions answered first — beyond the newest 50 and the newest 100 — still show Done.
    expect(rowBadge("Multiple Choice Single - 2")).toContain("Done");
    expect(rowBadge("Multiple Choice Single - 10")).toContain("Done"); // the list shows 10 rows a page
    // Best attempt kept across pages: q1's later 1/1 beats its earlier 0/1.
    expect(rowBadge("Multiple Choice Single - 1")).toContain("Done · 1/1");
    expect(screen.queryByText(/could not all be loaded/)).not.toBeInTheDocument();
  });

  it("the Answered / Your average / Best figures count every attempt, not the newest 50", async () => {
    serveHistory(attempts());
    renderAt("/reading?type=mcq-single");
    await waitFor(() => expect(doneCount()).toBe("60"));
    const header = document.body.textContent;
    expect(header).toMatch(/Answered\s*60\s*of 60/i);
    expect(header).toMatch(/Your average\s*100/i);
    expect(header).toMatch(/Best\s*100/i);
  });

  it("a page that fails leaves the questions usable and says progress is incomplete, with Retry", async () => {
    serveHistory(attempts(), { failOnPage: 2 });
    renderAt("/reading?type=mcq-single");
    expect(await screen.findByText(/could not all be loaded/)).toBeInTheDocument();
    expect(doneCount()).toBe("40"); // what page 1 holds — shown, and flagged as partial
    serveHistory(attempts());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(doneCount()).toBe("60"));
    expect(screen.queryByText(/could not all be loaded/)).not.toBeInTheDocument();
  });

  it("a history that cannot be read at all is flagged, never shown as 'nothing answered'", async () => {
    api.history.mockRejectedValue(new Error("Network down"));
    renderAt("/reading?type=mcq-single");
    expect(await screen.findByText(/could not all be loaded/)).toBeInTheDocument();
    expect(screen.getByText("Multiple Choice Single - 1")).toBeInTheDocument(); // questions still open
  });

  it("stops at the safety limit and reports it rather than looping", async () => {
    serveHistory(attempts(), { totalPagesOverride: 999 });
    renderAt("/reading?type=mcq-single");
    expect(await screen.findByText(/could not all be loaded/)).toBeInTheDocument();
    expect(api.history).toHaveBeenCalledTimes(50);
  });

  it("a short history is one request and no notice", async () => {
    serveHistory(attempts().slice(0, 30));
    renderAt("/reading?type=mcq-single");
    await waitFor(() => expect(doneCount()).toBeDefined());
    expect(api.history).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/could not all be loaded/)).not.toBeInTheDocument();
  });
});

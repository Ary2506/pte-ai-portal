import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// Practice re-attempts, after two rounds of change.
//
// Originally: Practice.jsx built its per-question `progress` map only inside load(), which runs on
// [section, slug]. Nothing updated it when an attempt finished, so the "Done · n/90" badge never
// moved after a retry and reopening a question restored the first attempt's answer forever.
//
// Now, by design: reopening an attempted question starts CLEAN — the same way a mock test always
// has — and the badge reports the student's BEST attempt rather than their latest, so a weaker
// retry never looks like lost progress.
vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(),
    questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  },
  forceLogout: vi.fn()
}));

// Two questions on purpose: with exactly one, Practice.jsx opens it directly and there is no
// list to assert the badge on.
const QUESTIONS = [
  { _id: "w1", type: "essay", section: "writing", title: "Essay Q", prompt: "Write about something.", evaluationType: "subjective" },
  { _id: "w2", type: "essay", section: "writing", title: "Second Essay", prompt: "And another.", evaluationType: "subjective" }
];

function attempt(overrides) {
  return {
    question: { _id: "w1" }, section: "writing", type: "essay",
    evaluationStatus: "COMPLETED", evaluationType: "subjective",
    maxScore: 90, createdAt: new Date().toISOString(),
    ...overrides
  };
}

const FIRST = attempt({ _id: "sub-1", answer: "the first attempt", transcript: "the first attempt", score: 30 });

function renderWriting() {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "S", username: "pte001" }));
  return render(<MemoryRouter initialEntries={["/writing"]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.questionIndex.mockImplementation(() => Promise.resolve({ questions: QUESTIONS }));
  api.questions.mockImplementation(() => Promise.resolve({ questions: QUESTIONS }));
  api.history.mockResolvedValue({ submissions: [FIRST], total: 1 });
});

describe("reopening a question that was already attempted", () => {
  it("starts clean rather than restoring the old answer", async () => {
    renderWriting();

    fireEvent.click(await screen.findByText("Essay Q"));

    // An empty form, not the previous attempt's evaluation — the student retries from scratch.
    const box = await screen.findByPlaceholderText("Type your answer here...");
    expect(box).toHaveValue("");
    expect(document.body).not.toHaveTextContent("the first attempt");
  });
});

describe("the list badge reports the best attempt", () => {
  it("moves up when a retry scores higher", async () => {
    api.submit.mockResolvedValue({ submission: attempt({ _id: "sub-2", answer: "better", score: 80 }) });
    renderWriting();

    await waitFor(() => expect(document.body).toHaveTextContent("30/90"));

    fireEvent.click(await screen.findByText("Essay Q"));
    const box = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(box, { target: { value: "better" } });
    fireEvent.click(await screen.findByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());

    fireEvent.click((await screen.findAllByText("Back to list"))[0]);

    await waitFor(() => expect(document.body).toHaveTextContent("80/90"));
    expect(document.body).not.toHaveTextContent("30/90");
  });

  it("stays put when a retry scores lower", async () => {
    // The point of showing the best rather than the latest: a bad retry must not read as if the
    // student had gone backwards.
    api.submit.mockResolvedValue({ submission: attempt({ _id: "sub-2", answer: "worse", score: 10 }) });
    renderWriting();

    await waitFor(() => expect(document.body).toHaveTextContent("30/90"));

    fireEvent.click(await screen.findByText("Essay Q"));
    const box = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(box, { target: { value: "worse" } });
    fireEvent.click(await screen.findByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());

    fireEvent.click((await screen.findAllByText("Back to list"))[0]);

    await waitFor(() => expect(document.body).toHaveTextContent("30/90"));
    expect(document.body).not.toHaveTextContent("10/90");
  });

  it("is not displaced by a retry whose evaluation failed", async () => {
    api.submit.mockResolvedValue({
      submission: attempt({ _id: "sub-2", answer: "x", score: 0, evaluationStatus: "FAILED" })
    });
    renderWriting();

    await waitFor(() => expect(document.body).toHaveTextContent("30/90"));

    fireEvent.click(await screen.findByText("Essay Q"));
    const box = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.click(await screen.findByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());

    fireEvent.click((await screen.findAllByText("Back to list"))[0]);

    // A failed evaluation carries no usable score, so the earlier real result stands.
    await waitFor(() => expect(document.body).toHaveTextContent("30/90"));
  });

  it("picks the best out of a history that arrives newest-first", async () => {
    // GET /submissions/history is ordered newest-first, so the strongest attempt is rarely the
    // first row. The loader has to compare rather than take the one it happens to see first.
    api.history.mockResolvedValue({
      submissions: [
        attempt({ _id: "c", answer: "latest", score: 40 }),
        attempt({ _id: "b", answer: "best", score: 75 }),
        attempt({ _id: "a", answer: "first", score: 20 })
      ],
      total: 3
    });

    renderWriting();

    await waitFor(() => expect(document.body).toHaveTextContent("75/90"));
    expect(document.body).not.toHaveTextContent("40/90");
  });
});

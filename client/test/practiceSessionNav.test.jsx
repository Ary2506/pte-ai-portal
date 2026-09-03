import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  }
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
});

afterEach(() => { vi.useRealTimers(); });

describe("Practice session — multi-question navigation (Part 6/11/12)", () => {
  const TWO_MCQ = [
    { _id: "q1", section: "reading", type: "mcq-single", title: "Question One", prompt: "Pick one.", options: ["A", "B"] },
    { _id: "q2", section: "reading", type: "mcq-single", title: "Question Two", prompt: "Pick one.", options: ["C", "D"] }
  ];

  it("shows a question list first when more than one question is available; opening one shows a counter and Next/Previous, and Next advances", async () => {
    api.questions.mockResolvedValue({ questions: TWO_MCQ });
    api.history.mockResolvedValue({ submissions: [] });
    renderAt("/reading", studentAuthUser());

    // Question list step first — not dropped straight into question 1.
    await screen.findByText("Done 0, Found 2 questions");
    fireEvent.click(screen.getByText("Question One").closest(".question-list-row"));

    await screen.findByText("Question 1 / 2");
    expect(screen.getByText("Question 1 / 2")).toBeInTheDocument();
    expect(screen.getByText("Previous").closest("button")).toBeDisabled();

    fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Question Two");
    expect(screen.getByText("Question 2 / 2")).toBeInTheDocument();
    expect(screen.getByText("Next").closest("button")).toBeDisabled();
  });

  it("Previous returns to the earlier question without submitting anything", async () => {
    api.questions.mockResolvedValue({ questions: TWO_MCQ });
    api.history.mockResolvedValue({ submissions: [] });
    renderAt("/reading", studentAuthUser());

    await screen.findByText("Done 0, Found 2 questions");
    fireEvent.click(screen.getByText("Question One").closest(".question-list-row"));

    await screen.findByText("Question 1 / 2");
    fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Question Two");
    fireEvent.click(screen.getByText("Previous"));
    await screen.findByText("Question 1 / 2");
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("marks a question as Done (with its real score) in the list when the student's history already has a submission for it", async () => {
    api.questions.mockResolvedValue({ questions: TWO_MCQ });
    api.history.mockResolvedValue({ submissions: [{ _id: "sub1", question: { _id: "q1" }, score: 1, maxScore: 1, evaluationStatus: "COMPLETED" }] });
    renderAt("/reading", studentAuthUser());

    await screen.findByText("Done 1, Found 2 questions");
    const row1 = screen.getByText("Question One").closest(".question-list-row");
    const row2 = screen.getByText("Question Two").closest(".question-list-row");
    expect(row1).toHaveTextContent("Done · 1/1");
    expect(row2).toHaveTextContent("Undone");
  });

  it("Back to list returns from a question to the question-list step", async () => {
    api.questions.mockResolvedValue({ questions: TWO_MCQ });
    api.history.mockResolvedValue({ submissions: [] });
    renderAt("/reading", studentAuthUser());

    await screen.findByText("Done 0, Found 2 questions");
    fireEvent.click(screen.getByText("Question One").closest(".question-list-row"));
    await screen.findByText("Question 1 / 2");

    fireEvent.click(screen.getByText("Back to list"));
    await screen.findByText("Done 0, Found 2 questions");
  });

  it("does not show question-navigation chrome when only one question exists", async () => {
    api.questions.mockResolvedValue({ questions: [TWO_MCQ[0]] });
    renderAt("/reading", studentAuthUser());
    await screen.findByText("Question One");
    expect(screen.queryByText(/Question 1 \//)).not.toBeInTheDocument();
  });
});

describe("Multiple Choice Multiple (mcq-multiple) — Phase 17 new UI", () => {
  const MCQ_MULTI = {
    _id: "qm1", section: "reading", type: "mcq-multiple", title: "Pick two", prompt: "Select all that apply.",
    options: ["Apple", "Banana", "Carrot", "Date"]
  };

  it("allows selecting multiple checkboxes and submits them as an array", async () => {
    api.questions.mockResolvedValue({ questions: [MCQ_MULTI] });
    api.submit.mockResolvedValue({
      submission: {
        _id: "sub1", score: 2, maxScore: 2, evaluationType: "objective", evaluationStatus: "COMPLETED",
        feedback: { correct: true, feedback: ["You selected 2 correct and 0 incorrect option(s)."] }
      }
    });
    renderAt("/reading?type=mcq-multiple", studentAuthUser());

    await screen.findByText("Pick two");
    fireEvent.click(screen.getByText("Apple"));
    fireEvent.click(screen.getByText("Carrot"));
    fireEvent.click(screen.getByText("Submit Answer"));

    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    const sentAnswer = JSON.parse(api.submit.mock.calls[0][0].get("answer"));
    expect(sentAnswer.sort()).toEqual([0, 2]);
    expect(await screen.findByText("Correct!")).toBeInTheDocument();
  });

  it("keeps Submit disabled until at least one option is selected", async () => {
    api.questions.mockResolvedValue({ questions: [MCQ_MULTI] });
    renderAt("/reading?type=mcq-multiple", studentAuthUser());
    await screen.findByText("Pick two");
    expect(screen.getByText("Submit Answer")).toBeDisabled();
    fireEvent.click(screen.getByText("Apple"));
    expect(screen.getByText("Submit Answer")).not.toBeDisabled();
  });

  it("deep-links from the URL's ?type= param directly to mcq-multiple, not the section's default tab", async () => {
    api.questions.mockResolvedValue({ questions: [MCQ_MULTI] });
    renderAt("/reading?type=mcq-multiple", studentAuthUser());
    await screen.findByText("Pick two");
    expect(screen.getByText("Multiple Choice Multiple").closest("button")).toHaveClass("active");
  });
});

describe("Mock timer never displays a negative time", () => {
  it("never shows a negative countdown — it clamps at zero, then immediately switches to a dedicated Time's Up state rather than lingering on 00:00 or going negative", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.testSessions.start.mockResolvedValue({
      testSession: { _id: "ts1", status: "IN_PROGRESS", totalQuestions: 1, expiresAt: new Date(Date.now() + 1000).toISOString() },
      questions: [{ _id: "q1", section: "reading", type: "mcq-single", title: "Q", prompt: "P", options: ["A", "B"] }]
    });
    api.testSessions.complete.mockReturnValue(new Promise(() => {})); // never resolves — isolates the display from the completion race
    renderAt("/mock", studentAuthUser());

    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("00:01");
    expect(screen.queryByText(/^-/)).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(5000); // well past expiry
    expect(await screen.findByText("Time's Up")).toBeInTheDocument();
    // At no point was a negative or stale countdown ever shown once expiry was detected.
    expect(screen.queryByText(/^-/)).not.toBeInTheDocument();
  });
});

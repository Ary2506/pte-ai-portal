import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(), details: vi.fn() }
  }
}));

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

function mockAttempt() {
  return {
    _id: "ts1", submittedAt: "2026-08-31T10:00:00.000Z", totalScore: 2, totalMaxScore: 4,
    sectionScores: [{ section: "reading", score: 1, maxScore: 1 }, { section: "listening", score: 1, maxScore: 3 }]
  };
}

function detailResponse() {
  return {
    testSession: mockAttempt(),
    results: [
      {
        _id: "sub1", section: "reading", type: "mcq-single",
        question: { _id: "q1", title: "Reading MCQ", prompt: "Pick the best answer.", options: ["Wrong", "Right"] },
        answer: 1, score: 1, maxScore: 1, evaluationType: "objective", evaluationStatus: "COMPLETED",
        feedback: { correct: true, feedback: ["Correct."] }
      },
      {
        _id: "sub2", section: "listening", type: "write-dictation",
        question: { _id: "q2", title: "Dictation", prompt: "Type what you hear." },
        answer: "hello there", transcript: "hello there", score: 1, maxScore: 3, evaluationType: "objective",
        evaluationStatus: "COMPLETED", feedback: { correct: false, feedback: ["1 of 2 words matched."] }
      },
      {
        _id: "sub3", section: "speaking", type: "read-aloud",
        question: { _id: "q3", title: "Read Aloud", prompt: "Read this aloud." },
        transcript: "my spoken answer", score: 60, maxScore: 90, evaluationType: "subjective",
        evaluationStatus: "COMPLETED", scoringMethod: "heuristic",
        feedback: { strengths: ["Clear structure"], improvements: [], overall: "Solid attempt.", note: "Heuristic note.", scoringMethod: "heuristic" }
      }
    ]
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.history.mockResolvedValue({ submissions: [] });
  api.testSessions.list.mockResolvedValue({ testSessions: [mockAttempt()] });
});

describe("History — mock attempt question-level details", () => {
  it("shows a View Details action for a completed mock attempt", async () => {
    renderAt("/history", studentAuthUser());
    expect(await screen.findByText("View Details")).toBeInTheDocument();
  });

  it("fetches and renders question-level results when opened", async () => {
    api.testSessions.details.mockResolvedValue(detailResponse());
    renderAt("/history", studentAuthUser());
    fireEvent.click(await screen.findByText("View Details"));

    await waitFor(() => expect(api.testSessions.details).toHaveBeenCalledWith("ts1"));
    expect(await screen.findByText("Reading MCQ")).toBeInTheDocument();
    expect(screen.getByText("Dictation")).toBeInTheDocument();
    expect(screen.getByText("Read Aloud")).toBeInTheDocument();
  });

  it("renders feedback for both objective and subjective results", async () => {
    api.testSessions.details.mockResolvedValue(detailResponse());
    renderAt("/history", studentAuthUser());
    fireEvent.click(await screen.findByText("View Details"));

    expect(await screen.findByText("Correct!")).toBeInTheDocument();
    expect(screen.getByText("Not quite.")).toBeInTheDocument();
    expect(screen.getByText("Heuristic Practice Evaluation")).toBeInTheDocument();
    expect(screen.getByText("Clear structure")).toBeInTheDocument();
  });

  it("shows the student's own answer for a choice-based question", async () => {
    api.testSessions.details.mockResolvedValue(detailResponse());
    renderAt("/history", studentAuthUser());
    fireEvent.click(await screen.findByText("View Details"));

    await screen.findByText("Reading MCQ");
    expect(screen.getByText("Your answer: Right")).toBeInTheDocument();
  });

  it("never renders an answer key or explanation field, even though the mocked payload has none to leak", async () => {
    api.testSessions.details.mockResolvedValue(detailResponse());
    renderAt("/history", studentAuthUser());
    fireEvent.click(await screen.findByText("View Details"));

    await screen.findByText("Reading MCQ");
    // The safe question objects above intentionally carry no answer/explanation field at all —
    // this asserts the detail view never introduces text that looks like one being surfaced.
    expect(screen.queryByText(/answer key/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Wrong")).not.toBeInTheDocument(); // an unchosen raw option label, not a rendered "answer"
  });
});

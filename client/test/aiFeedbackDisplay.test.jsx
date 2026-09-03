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
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn()
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

beforeEach(() => { vi.clearAllMocks(); });

describe("Writing — AI mistake explanation and criteria breakdown", () => {
  const WRITING_QUESTION = { _id: "q1", title: "Write Essay", prompt: "Discuss both views.", type: "essay", evaluationType: "subjective" };

  it("shows a criteria breakdown and a mistake explanation with correction, without exposing any provider internals", async () => {
    api.questions.mockResolvedValue({ questions: [WRITING_QUESTION] });
    api.submit.mockResolvedValue({
      submission: {
        _id: "s1", score: 65, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED", scoringMethod: "ai",
        feedback: {
          strengths: ["Clear main idea"],
          improvements: ["Watch subject-verb agreement"],
          overall: "Good attempt with a few grammar slips.",
          scoringMethod: "ai",
          criteria: { content: 70, form: 60, grammar: 55, vocabulary: 65 },
          mistakes: [{ type: "grammar", studentText: "He go", problem: "Wrong verb form", correction: "He goes", explanation: "Third person singular needs -s." }]
        }
      }
    });
    renderAt("/writing", studentAuthUser());
    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "He go to school every day." } });
    fireEvent.click(screen.getByText("Submit for AI Feedback"));

    expect(await screen.findByText("AI Practice Evaluation")).toBeInTheDocument();
    expect(screen.getByText("Breakdown")).toBeInTheDocument();
    expect(screen.getByText("content: 70 / 100")).toBeInTheDocument();
    expect(screen.getByText("grammar: 55 / 100")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el.tagName === "P" && el.textContent === 'grammar — "He go"')).toBeInTheDocument();
    expect(screen.getByText("Wrong verb form")).toBeInTheDocument();
    expect(screen.getByText('Suggested correction: "He goes"')).toBeInTheDocument();
    expect(screen.getByText("Third person singular needs -s.")).toBeInTheDocument();
  });

  it("renders no breakdown or mistakes section for a heuristic result, which never fabricates them", async () => {
    api.questions.mockResolvedValue({ questions: [WRITING_QUESTION] });
    api.submit.mockResolvedValue({
      submission: {
        _id: "s2", score: 70, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED", scoringMethod: "heuristic",
        feedback: { strengths: ["Good length"], improvements: [], overall: "Solid attempt.", scoringMethod: "heuristic", criteria: null, mistakes: [] }
      }
    });
    renderAt("/writing", studentAuthUser());
    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "My essay response." } });
    fireEvent.click(screen.getByText("Submit for AI Feedback"));

    expect(await screen.findByText("Heuristic Practice Evaluation")).toBeInTheDocument();
    expect(screen.queryByText("Breakdown")).not.toBeInTheDocument();
    expect(screen.queryByText("Mistakes")).not.toBeInTheDocument();
  });
});

describe("Reading — deterministic correct-answer explanation for a wrong objective answer", () => {
  const MCQ_QUESTION = { _id: "q2", title: "Capital city", prompt: "What is the capital of the UK?", type: "mcq-single", options: ["Paris", "London"] };

  it("shows the correct answer and explanation when the student answered incorrectly, with no AI involved", async () => {
    api.questions.mockResolvedValue({ questions: [MCQ_QUESTION] });
    api.submit.mockResolvedValue({
      submission: {
        _id: "s3", score: 0, maxScore: 1, evaluationType: "objective", evaluationStatus: "COMPLETED",
        feedback: {
          correct: false,
          feedback: ["Not quite the right answer.", "The question asks for the capital of the United Kingdom, which is London."],
          correctAnswerText: "London"
        }
      }
    });
    renderAt("/reading", studentAuthUser());
    fireEvent.click(await screen.findByText("Paris"));
    fireEvent.click(screen.getByText("Submit Answer"));

    expect(await screen.findByText("Not quite.")).toBeInTheDocument();
    expect(screen.getByText("Correct answer: London")).toBeInTheDocument();
    expect(screen.getByText("The question asks for the capital of the United Kingdom, which is London.")).toBeInTheDocument();
  });

  it("does not show a redundant 'Correct answer' line when the student answered correctly", async () => {
    api.questions.mockResolvedValue({ questions: [MCQ_QUESTION] });
    api.submit.mockResolvedValue({
      submission: {
        _id: "s4", score: 1, maxScore: 1, evaluationType: "objective", evaluationStatus: "COMPLETED",
        feedback: { correct: true, feedback: ["Correct."], correctAnswerText: "London" }
      }
    });
    renderAt("/reading", studentAuthUser());
    fireEvent.click(await screen.findByText("London"));
    fireEvent.click(screen.getByText("Submit Answer"));

    expect(await screen.findByText("Correct!")).toBeInTheDocument();
    expect(screen.queryByText(/Correct answer:/)).not.toBeInTheDocument();
  });
});

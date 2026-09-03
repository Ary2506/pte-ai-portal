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
    dashboard: vi.fn(),
    plan: vi.fn(),
    questions: vi.fn(),
    history: vi.fn(),
    submit: vi.fn(),
    retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

const WRITING_QUESTION = { _id: "q1", title: "Write Essay", prompt: "Discuss both views.", type: "essay", evaluationType: "subjective" };

function completedResult(overrides = {}) {
  return {
    _id: "s1", score: 70, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED",
    scoringMethod: "heuristic",
    feedback: { strengths: ["Good length"], improvements: ["Watch grammar"], overall: "Solid attempt.", note: "Heuristic note.", scoringMethod: "heuristic" },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.questions.mockResolvedValue({ questions: [WRITING_QUESTION] });
});

describe("Writing practice", () => {
  it("lets the student enter an answer", async () => {
    renderAt("/writing", studentAuthUser());
    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "My essay response." } });
    expect(textarea.value).toBe("My essay response.");
  });

  it("disables submit for an empty answer", async () => {
    renderAt("/writing", studentAuthUser());
    const button = await screen.findByText("Submit for AI Feedback");
    expect(button).toBeDisabled();
  });

  it("submits the answer to the backend and never sends a client-chosen score", async () => {
    api.submit.mockResolvedValue({ submission: completedResult() });
    renderAt("/writing", studentAuthUser());
    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "My essay response with enough words." } });
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    const formData = api.submit.mock.calls[0][0];
    expect(formData.get("section")).toBe("writing");
    expect(formData.get("score")).toBeNull();
  });

  it("shows a loading state while evaluation is in flight", async () => {
    let resolveSubmit;
    api.submit.mockReturnValue(new Promise(res => { resolveSubmit = res; }));
    renderAt("/writing", studentAuthUser());
    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "My essay response." } });
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("Evaluating...")).toBeInTheDocument();
    resolveSubmit({ submission: completedResult() });
  });

  it("renders an AI-labeled result when scoringMethod is ai", async () => {
    api.submit.mockResolvedValue({ submission: completedResult({ scoringMethod: "ai", feedback: { strengths: ["Strong vocabulary"], improvements: [], overall: "Well done.", note: "AI note.", scoringMethod: "ai" } }) });
    renderAt("/writing", studentAuthUser());
    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "My essay." } });
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("AI Practice Evaluation")).toBeInTheDocument();
    expect(screen.getByText("Strong vocabulary")).toBeInTheDocument();
  });

  it("labels a heuristic result as heuristic, not AI", async () => {
    api.submit.mockResolvedValue({ submission: completedResult() });
    renderAt("/writing", studentAuthUser());
    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "My essay." } });
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("Heuristic Practice Evaluation")).toBeInTheDocument();
  });

  it("shows a failed evaluation with a retry option instead of a fake score", async () => {
    api.submit.mockResolvedValue({ submission: { _id: "s1", score: 0, maxScore: 90, evaluationType: "subjective", evaluationStatus: "FAILED", scoringMethod: null, feedback: { overall: "AI evaluation is temporarily unavailable. Please try again." } } });
    renderAt("/writing", studentAuthUser());
    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "My essay." } });
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("Evaluation failed.")).toBeInTheDocument();
    expect(screen.getByText("Retry Evaluation")).toBeInTheDocument();
  });
});

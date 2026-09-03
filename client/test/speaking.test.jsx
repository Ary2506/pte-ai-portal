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

const SPEAKING_QUESTION = { _id: "q1", title: "Read Aloud", prompt: "Read the passage aloud.", type: "read-aloud", evaluationType: "subjective" };

function completedResult(overrides = {}) {
  return {
    _id: "s1", score: 65, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED",
    scoringMethod: "heuristic",
    feedback: { strengths: ["Clear response"], improvements: [], overall: "Good effort.", note: "Heuristic note.", scoringMethod: "heuristic" },
    ...overrides
  };
}

async function recordAndStop() {
  fireEvent.click(await screen.findByText("Start Recording"));
  await screen.findByText("Stop Recording");
  fireEvent.click(screen.getByText("Stop Recording"));
  await waitFor(() => expect(screen.getByText("Submit for AI Feedback")).not.toBeDisabled());
}

beforeEach(() => {
  vi.clearAllMocks();
  api.questions.mockResolvedValue({ questions: [SPEAKING_QUESTION] });

  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }))
  };
  global.MediaRecorder = class {
    constructor(stream) { this.stream = stream; }
    start() { this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
    stop() { this.onstop?.(); }
  };
});

describe("Speaking practice", () => {
  it("starts recording when the record button is clicked", async () => {
    renderAt("/speaking", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Recording"));
    expect(await screen.findByText("Stop Recording")).toBeInTheDocument();
  });

  it("stops recording and enables submission", async () => {
    renderAt("/speaking", studentAuthUser());
    await recordAndStop();
    expect(screen.getByText("Submit for AI Feedback")).not.toBeDisabled();
  });

  it("sends the recorded audio to the backend", async () => {
    api.submit.mockResolvedValue({ submission: completedResult() });
    renderAt("/speaking", studentAuthUser());
    await recordAndStop();
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    const formData = api.submit.mock.calls[0][0];
    expect(formData.get("section")).toBe("speaking");
    expect(formData.get("audio")).toBeTruthy();
    expect(formData.get("score")).toBeNull();
  });

  it("shows an evaluating state while the request is in flight", async () => {
    let resolveSubmit;
    api.submit.mockReturnValue(new Promise(res => { resolveSubmit = res; }));
    renderAt("/speaking", studentAuthUser());
    await recordAndStop();
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("Evaluating...")).toBeInTheDocument();
    resolveSubmit({ submission: completedResult() });
  });

  it("renders the evaluation result after submission", async () => {
    api.submit.mockResolvedValue({ submission: completedResult() });
    renderAt("/speaking", studentAuthUser());
    await recordAndStop();
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("Heuristic Practice Evaluation")).toBeInTheDocument();
    expect(screen.getByText("Clear response")).toBeInTheDocument();
  });

  it("shows a failed evaluation with a retry option instead of a fake score", async () => {
    api.submit.mockResolvedValue({ submission: { _id: "s1", score: 0, maxScore: 90, evaluationType: "subjective", evaluationStatus: "FAILED", scoringMethod: null, feedback: { overall: "AI evaluation is temporarily unavailable. Please try again." } } });
    renderAt("/speaking", studentAuthUser());
    await recordAndStop();
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("Evaluation failed.")).toBeInTheDocument();
    expect(screen.getByText("Retry Evaluation")).toBeInTheDocument();
  });
});

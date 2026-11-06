import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {},
    dashboard: vi.fn(), plan: vi.fn(),
    questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(() => Promise.resolve({ submissions: [] })), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

// The practice page passes the shared Speaking task no `type` prop, so every practice answer used to be
// submitted with type "undefined" -- visible in the database as 57 speaking submissions with that type.
const QUESTION = { _id: "q1", title: "Answer Short Question", prompt: "Answer the question you hear.", type: "answer-short-question", evaluationType: "subjective" };
const RESULT = { _id: "s1", score: 65, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED", scoringMethod: "ai", feedback: { strengths: ["ok"], improvements: [], overall: "Good effort.", note: "n", scoringMethod: "ai" } };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "S", username: "pte001" }));
  api.history.mockResolvedValue({ submissions: [] });
  api.questions.mockResolvedValue({ questions: [QUESTION] });
  api.submit.mockResolvedValue({ submission: RESULT });
  global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] })) };
  global.window.SpeechRecognition = undefined;
  global.window.webkitSpeechRecognition = undefined;
  global.MediaRecorder = class {
    constructor(s) { this.stream = s; }
    start() { this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
    stop() { this.onstop?.(); }
  };
});

describe("Speaking practice submits the question's real type", () => {
  it("sends type=answer-short-question, not the string 'undefined'", async () => {
    render(<MemoryRouter initialEntries={["/speaking?type=answer-short-question"]}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Start Recording"));
    await screen.findByText("Stop Recording");
    fireEvent.click(screen.getByText("Stop Recording"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for AI Feedback" })).not.toBeDisabled());
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    const form = api.submit.mock.calls[0][0];
    expect(form.get("type")).toBe("answer-short-question");
    expect(form.get("questionId")).toBe("q1");
  });
});

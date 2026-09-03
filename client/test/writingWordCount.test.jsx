import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

const SWT_QUESTION = { _id: "swt1", title: "Summarize Written Text", type: "swt", prompt: "Summarize in one sentence.", passage: "A passage." };
const ESSAY_QUESTION = { _id: "essay1", title: "Write Essay", type: "essay", prompt: "Discuss both views." };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

function typeWords(n) {
  const textarea = screen.getByPlaceholderText("Type your answer here...");
  const words = Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  fireEvent.change(textarea, { target: { value: words } });
}

describe("Writing word-count guidance", () => {
  it("shows the 40–100 range for SWT", async () => {
    api.questions.mockResolvedValue({ questions: [SWT_QUESTION] });
    renderAt("/writing", studentAuthUser());
    await screen.findByPlaceholderText("Type your answer here...");
    expect(screen.getByText("0 / 40–100 words")).toBeInTheDocument();
  });

  it("shows the 200–300 range for Essay", async () => {
    api.questions.mockResolvedValue({ questions: [ESSAY_QUESTION] });
    renderAt("/writing", studentAuthUser());
    await screen.findByPlaceholderText("Type your answer here...");
    expect(screen.getByText("0 / 200–300 words")).toBeInTheDocument();
  });

  it("shows a below-minimum state with informational styling", async () => {
    api.questions.mockResolvedValue({ questions: [SWT_QUESTION] });
    renderAt("/writing", studentAuthUser());
    await screen.findByPlaceholderText("Type your answer here...");
    typeWords(10);

    const badge = screen.getByText("10 / 40–100 words");
    expect(badge.className).toContain("low");
    expect(badge.className).not.toContain("good");
    expect(badge.className).not.toContain("high");
  });

  it("shows an in-range state with success styling", async () => {
    api.questions.mockResolvedValue({ questions: [SWT_QUESTION] });
    renderAt("/writing", studentAuthUser());
    await screen.findByPlaceholderText("Type your answer here...");
    typeWords(70);

    const badge = screen.getByText("70 / 40–100 words");
    expect(badge.className).toContain("good");
  });

  it("shows an above-maximum state with warning styling", async () => {
    api.questions.mockResolvedValue({ questions: [ESSAY_QUESTION] });
    renderAt("/writing", studentAuthUser());
    await screen.findByPlaceholderText("Type your answer here...");
    typeWords(350);

    const badge = screen.getByText("350 / 200–300 words");
    expect(badge.className).toContain("high");
  });

  it("never rejects submission based on word count — the button only requires non-empty text", async () => {
    api.questions.mockResolvedValue({ questions: [SWT_QUESTION] });
    api.submit.mockResolvedValue({ submission: { _id: "s1", score: 60, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED", scoringMethod: "heuristic", feedback: { strengths: [], improvements: [], overall: "ok" } } });
    renderAt("/writing", studentAuthUser());
    await screen.findByPlaceholderText("Type your answer here...");
    typeWords(5); // well under the 40-word minimum

    expect(screen.getByText("Submit for AI Feedback")).not.toBeDisabled();
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("Heuristic Practice Evaluation")).toBeInTheDocument();
  });
});

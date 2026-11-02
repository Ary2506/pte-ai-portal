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
    questionTranscript: vi.fn(),
    history: vi.fn(() => Promise.resolve({ submissions: [] })), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

const SENTENCE = "The supermarket is situated close to the theater.";
const REPEAT_QUESTION = {
  _id: "rs1", title: "Repeat Sentence Core 1", type: "repeat-sentence", evaluationType: "subjective",
  prompt: "Listen to the sentence, then repeat it exactly as you hear it.", audioUrl: "/audio/repeat-sentence/core/core-001.mp3"
};

function renderAt(path) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "Student", username: "pte001" }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.history.mockResolvedValue({ submissions: [] });
  api.questions.mockResolvedValue({ questions: [REPEAT_QUESTION] });
  api.questionTranscript.mockResolvedValue({ transcript: SENTENCE });
});

describe("Repeat Sentence — Transcript button", () => {
  it("offers a Transcript button but does not show or even request the transcript up front", async () => {
    renderAt("/speaking?type=repeat-sentence");
    expect(await screen.findByRole("button", { name: /Transcript/ })).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
    expect(api.questionTranscript).not.toHaveBeenCalled();
  });

  it("fetches the transcript when clicked and shows it", async () => {
    renderAt("/speaking?type=repeat-sentence");
    fireEvent.click(await screen.findByRole("button", { name: /Transcript/ }));
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
    expect(api.questionTranscript).toHaveBeenCalledWith("rs1");
  });

  it("hides it again, and shows it a second time without fetching twice", async () => {
    renderAt("/speaking?type=repeat-sentence");
    fireEvent.click(await screen.findByRole("button", { name: "Transcript" }));
    await screen.findByText(SENTENCE);
    fireEvent.click(screen.getByRole("button", { name: "Hide Transcript" }));
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
    expect(api.questionTranscript).toHaveBeenCalledTimes(1);
  });

  it("shows nothing, and recovers, when the transcript cannot be loaded", async () => {
    api.questionTranscript.mockRejectedValueOnce(new Error("The transcript is not available during a mock test."));
    renderAt("/speaking?type=repeat-sentence");
    fireEvent.click(await screen.findByRole("button", { name: "Transcript" }));
    await waitFor(() => expect(api.questionTranscript).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
    // the button is usable again and a retry succeeds
    fireEvent.click(await screen.findByRole("button", { name: "Transcript" }));
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
  });

  it("is not offered for other speaking tasks", async () => {
    api.questions.mockResolvedValue({ questions: [{ _id: "a1", title: "Answer Short Question", type: "answer-short-question", evaluationType: "subjective", prompt: "Answer.", audioUrl: "/a.mp3" }] });
    renderAt("/speaking?type=answer-short-question");
    await screen.findByText("Start Recording");
    expect(screen.queryByRole("button", { name: /Transcript/ })).not.toBeInTheDocument();
  });
});

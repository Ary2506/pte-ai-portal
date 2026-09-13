import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";
import readAloudJson from "../content/speaking/read-aloud/read_aloud.json";
import { READ_ALOUD_QUESTIONS } from "../src/practice/ReadAloudPractice.jsx";

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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }))
  };
  global.MediaRecorder = class {
    constructor(stream) { this.stream = stream; }
    start() { this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
    stop() { this.onstop?.(); }
  };
  // jsdom doesn't implement the Blob object-URL APIs — real browsers always do; only the test
  // environment needs a stand-in so the Replay Recording feature can be exercised here.
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("Read Aloud content — read_aloud.json is the single source of truth", () => {
  it("the built practice list's order and count come directly from the raw JSON, with no separate id list", () => {
    expect(READ_ALOUD_QUESTIONS.length).toBe(readAloudJson.length);
    expect(READ_ALOUD_QUESTIONS.map(q => Number(q._id))).toEqual(readAloudJson.map(q => q.id));
    expect(new Set(readAloudJson.map(q => q.id)).size).toBe(readAloudJson.length); // no duplicates
    readAloudJson.forEach(q => expect(q.type).toBe("Read Aloud"));
  });

  it("every question carries its exact, untouched question/answer text from the JSON", () => {
    READ_ALOUD_QUESTIONS.forEach((q, i) => {
      const source = readAloudJson[i];
      expect(q.title).toBe(source.title);
      expect(q.passage).toBe(source.question); // exact text, not reworded
      expect(q.answer).toBe(source.answer); // exact answer field, never the question field
    });
  });

  it("currently contains exactly the 15 specified questions, first and last matching the given order", () => {
    expect(readAloudJson.length).toBe(15);
    expect(READ_ALOUD_QUESTIONS[0].title).toBe("Language Appearance");
    expect(READ_ALOUD_QUESTIONS[READ_ALOUD_QUESTIONS.length - 1].title).toBe("Community Gardening");
  });
});

describe("Read Aloud practice flow (Practice → Speaking → Read Aloud)", () => {
  it("opens directly into question 1 of 15 with the passage visible and the answer hidden", async () => {
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Question 1 of 15");
    expect(screen.getByRole("heading", { name: "Language Appearance" })).toBeInTheDocument();
    expect(screen.getByText(/It seems that language appeared from nowhere/)).toBeInTheDocument();
    // The passage itself is always visible (it's the question); it's the dedicated answer-reveal
    // block that must stay hidden until "Show Answer" is clicked.
    expect(document.querySelector(".answer-reveal")).not.toBeInTheDocument();
    expect(screen.getByText("Show Answer")).toBeInTheDocument();
  });

  it("never calls the DB question API for Read Aloud — it is fully local content", async () => {
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Question 1 of 15");
    expect(api.questions).not.toHaveBeenCalled();
  });

  it("Show Answer reveals the exact answer field and can be hidden again", async () => {
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Question 1 of 15");
    fireEvent.click(screen.getByText("Show Answer"));
    await screen.findByText("Hide Answer");
    // Question and answer text happen to be identical in this dataset, so the assertion is scoped
    // to the dedicated reveal block rather than the passage text (which is always visible).
    const reveal = document.querySelector(".answer-reveal");
    expect(reveal).toBeInTheDocument();
    expect(reveal).toHaveTextContent("It seems that language appeared from nowhere");
    fireEvent.click(screen.getByText("Hide Answer"));
    expect(document.querySelector(".answer-reveal")).not.toBeInTheDocument();
  });

  it("Next/Previous move through questions in order and update the counter; Previous is disabled on question 1", async () => {
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Question 1 of 15");
    expect(screen.getByText("Previous")).toBeDisabled();

    fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Question 2 of 15");
    expect(screen.getByRole("heading", { name: "Elephant" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Previous"));
    await screen.findByText("Question 1 of 15");
    expect(screen.getByRole("heading", { name: "Language Appearance" })).toBeInTheDocument();
  });

  it("resets recording and hides the answer again when moving to a new question", async () => {
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Question 1 of 15");
    fireEvent.click(screen.getByText("Show Answer"));
    await screen.findByText("Hide Answer");

    fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Question 2 of 15");
    expect(screen.getByText("Show Answer")).toBeInTheDocument();
  });

  it("records, replays, and submits — using the real existing AI-evaluation pipeline with no questionId", async () => {
    api.submit.mockResolvedValue({
      submission: {
        _id: "sub1", score: 70, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED",
        scoringMethod: "heuristic",
        feedback: { strengths: ["Clear pace"], improvements: [], overall: "Good.", scoringMethod: "heuristic" }
      }
    });
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Question 1 of 15");

    fireEvent.click(screen.getByText("Start Recording"));
    await screen.findByText("Stop Recording");
    fireEvent.click(screen.getByText("Stop Recording"));

    const replayButton = await screen.findByText("Replay Recording", { exact: false });
    expect(replayButton.closest("button")).not.toBeDisabled();

    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    const formData = api.submit.mock.calls[0][0];
    expect(formData.get("section")).toBe("speaking");
    expect(formData.get("type")).toBe("read-aloud");
    expect(formData.get("questionId")).toBeNull(); // local content has no real Mongo id to send
    expect(await screen.findByText("Heuristic Practice Evaluation")).toBeInTheDocument();
  });

  it("shows Practice Completed with an honest summary after Finish on question 15 — no fabricated score", async () => {
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Question 1 of 15");

    // 14 "Next" clicks walk from question 1 to question 15; the 15th click (its button now
    // labeled "Finish", since we're on the last question) moves past it to the completion screen.
    for (let i = 0; i < 14; i += 1) {
      fireEvent.click(screen.getByText("Next"));
      await screen.findByText(`Question ${i + 2} of 15`);
    }
    expect(screen.getByText("Finish")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Finish"));

    expect(await screen.findByText("Practice Completed 🎉")).toBeInTheDocument();
    expect(screen.getByText("0 of 15 questions submitted for AI feedback.")).toBeInTheDocument();
    expect(screen.queryByText(/Average score/)).not.toBeInTheDocument(); // never invented when nothing was submitted
    expect(screen.getByText("Restart Practice")).toBeInTheDocument();
  });
});

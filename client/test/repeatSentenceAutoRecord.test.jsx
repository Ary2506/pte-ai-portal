import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const REPEAT_QUESTION = {
  _id: "rs1", section: "speaking", title: "Repeat Sentence Core 1", type: "repeat-sentence",
  evaluationType: "subjective", prompt: "Listen to the sentence, then repeat it exactly as you hear it.",
  audioUrl: "/audio/repeat-sentence/core/core-001.mp3"
};

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
function renderAt(path) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(studentAuthUser()));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

// The prompt audio finishing is the only start signal, so every test here fires it the way the
// browser does. jsdom never actually plays the clip.
function promptAudioEnds() {
  fireEvent.ended(document.querySelector("audio.audio"));
}

let stopSpy;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.history.mockResolvedValue({ submissions: [] });
  api.questions.mockResolvedValue({ questions: [REPEAT_QUESTION] });
  api.submit.mockResolvedValue({
    submission: {
      _id: "sub-rs-1", score: 70, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED",
      transcript: "The supermarket is close to the theater.",
      feedback: { strengths: [], improvements: [], overall: "Good attempt.", note: "n" }
    }
  });
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }], getAudioTracks: () => [{ label: "Mic" }] }))
  };
  stopSpy = vi.fn();
  global.MediaRecorder = class {
    constructor(stream) { this.stream = stream; this.state = "recording"; }
    start() { this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
    stop() { stopSpy(); this.state = "inactive"; this.onstop?.(); }
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Repeat Sentence — hands-free record and submit", () => {
  it("shows no Start Recording button, and no Stop Recording button once it is recording", async () => {
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    expect(screen.queryByText("Start Recording")).not.toBeInTheDocument();

    promptAudioEnds();
    await screen.findByText("Recording...");
    expect(screen.queryByText("Stop Recording")).not.toBeInTheDocument();
  });

  it("starts recording by itself when the prompt audio finishes", async () => {
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    promptAudioEnds();
    await screen.findByText("Recording...");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("submits the answer by itself once the 30s limit runs out", async () => {
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    promptAudioEnds();
    await screen.findByText("Recording...");

    await vi.advanceTimersByTimeAsync(30 * 1000);

    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Good attempt.")).toBeInTheDocument();
  });

  it("lets the student submit early, which stops the recording and sends that take", async () => {
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    promptAudioEnds();
    await screen.findByText("Recording...");

    await vi.advanceTimersByTimeAsync(4 * 1000);
    fireEvent.click(screen.getByRole("button", { name: "Submit for AI Feedback" }));

    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(stopSpy).toHaveBeenCalledTimes(1);
    // Nothing submits a second time when the old limit would have expired.
    await vi.advanceTimersByTimeAsync(40 * 1000);
    expect(api.submit).toHaveBeenCalledTimes(1);
  });

  it("does not start a second take when the student replays the prompt audio", async () => {
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    promptAudioEnds();
    await screen.findByText("Recording...");

    promptAudioEnds();
    await vi.advanceTimersByTimeAsync(1000);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("re-arms after Re-do, so the next play of the audio records again", async () => {
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    promptAudioEnds();
    await screen.findByText("Recording...");

    fireEvent.click(screen.getByRole("button", { name: "Re-do" }));
    await screen.findByText("Record your answer");
    expect(api.submit).not.toHaveBeenCalled();

    promptAudioEnds();
    await screen.findByText("Recording...");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("leaves the recorder armed again when the microphone is refused", async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(() => Promise.reject(new Error("denied")));
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    promptAudioEnds();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));

    navigator.mediaDevices.getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }], getAudioTracks: () => [{ label: "Mic" }] }));
    promptAudioEnds();
    await screen.findByText("Recording...");
  });
});

// main.jsx wraps the app in <React.StrictMode>, which in development mounts, runs cleanups, then
// mounts again. Testing Library's plain render() does not, so a flag that a cleanup clears and
// nothing restores looks fine in every other test here and is dead on the real page. This block
// renders the way the app actually runs.
describe("Repeat Sentence under StrictMode, as the real app mounts it", () => {
  function renderStrict(path) {
    localStorage.setItem("pte_token", "test-token");
    localStorage.setItem("pte_user", JSON.stringify(studentAuthUser()));
    return render(
      <React.StrictMode>
        <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
      </React.StrictMode>
    );
  }

  it("still starts recording by itself when the audio ends after a double mount", async () => {
    renderStrict("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");

    promptAudioEnds();
    await screen.findByText("Recording...");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
  });

  it("still submits by itself when the limit runs out", async () => {
    renderStrict("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    promptAudioEnds();
    await screen.findByText("Recording...");

    await vi.advanceTimersByTimeAsync(30 * 1000);
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  });
});

describe("Other speaking tasks keep their manual controls", () => {
  it("Answer Short Question still has Start Recording and does not record when its audio ends", async () => {
    api.questions.mockResolvedValue({
      questions: [{ _id: "asq1", section: "speaking", title: "Answer Short Question", type: "answer-short-question", evaluationType: "subjective", prompt: "Answer.", audioUrl: "/a.mp3" }]
    });
    renderAt("/speaking?type=answer-short-question");
    const startButton = await screen.findByText("Start Recording");

    promptAudioEnds();
    await vi.advanceTimersByTimeAsync(1000);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Submit for AI Feedback" })).toBeDisabled();

    fireEvent.click(startButton);
    await screen.findByText("Stop Recording");
  });
});

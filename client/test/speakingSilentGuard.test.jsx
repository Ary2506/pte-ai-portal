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
    history: vi.fn(() => Promise.resolve({ submissions: [] })), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

// Every Speaking task except Repeat Sentence shares this component. A recording is judged on the
// recorded audio itself: silent -> not submitted (it would be scored 0 for nothing said); audible ->
// submitted even though the browser produced no transcript (the server transcribes it).
const QUESTION = { _id: "q1", title: "Read Aloud 1", prompt: "Read this.", type: "read-aloud", evaluationType: "subjective" };
const RESULT = { _id: "s1", score: 65, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED", scoringMethod: "ai", feedback: { strengths: ["ok"], improvements: [], overall: "Good effort.", note: "n", scoringMethod: "ai" } };

let decodedLevel;
const original = globalThis.AudioContext;

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
    start() { this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
    stop() { this.onstop?.(); }
  };
  Blob.prototype.arrayBuffer ??= function () { return Promise.resolve(new ArrayBuffer(8)); };
  globalThis.AudioContext = class {
    decodeAudioData() { return Promise.resolve({ sampleRate: 1000, getChannelData: () => Float32Array.from({ length: 2000 }, () => decodedLevel) }); }
    close() {}
  };
});
afterEach(() => { globalThis.AudioContext = original; });

async function recordAndSubmit() {
  render(<MemoryRouter initialEntries={["/speaking?type=read-aloud"]}><App /></MemoryRouter>);
  fireEvent.click(await screen.findByText("Start Recording"));
  await screen.findByText("Stop Recording");
  fireEvent.click(screen.getByText("Stop Recording"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Submit for AI Feedback" })).not.toBeDisabled());
  fireEvent.click(screen.getByText("Submit for AI Feedback"));
}

describe("Speaking — judged on the recorded audio", () => {
  it("does not submit a recording that is silent all the way through, and says why", async () => {
    decodedLevel = 0;
    await recordAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't hear any sound/);
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("submits an audible recording even though the browser gave no transcript", async () => {
    decodedLevel = 0.05;
    await recordAndSubmit();
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(api.submit.mock.calls[0][0].get("transcript")).toBe("");
  });

  it("submits a very quiet but audible recording (soft speaker)", async () => {
    decodedLevel = 0.006;
    await recordAndSubmit();
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  });
});

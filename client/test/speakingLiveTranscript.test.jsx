import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

// The live words are a browser preview only. They must grow while the student speaks, never duplicate
// when a phrase turns final, survive the browser ending its own session after a pause, and never get
// in the way of the recorder or the upload. The server transcript replaces them after scoring.
const QUESTION = { _id: "q1", title: "Read Aloud 1", prompt: "Read this.", type: "read-aloud", evaluationType: "subjective" };
const RESULT = { _id: "s1", score: 65, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED", scoringMethod: "ai", transcript: "the final server transcript of the answer", feedback: { strengths: ["ok"], improvements: [], overall: "Good effort.", note: "n", scoringMethod: "ai" } };

let recognizers, recorderStarts, recorderStops;
const original = globalThis.AudioContext;

class FakeRecognition {
  constructor() { this.started = false; this.stopped = false; recognizers.push(this); }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  // results: [[text, isFinal], ...] -- the whole list for this session, as the browser delivers it
  say(results, resultIndex = 0) {
    const list = results.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal }));
    act(() => this.onresult({ resultIndex, results: list }));
  }
  endByItself() { act(() => this.onend()); }
}

beforeEach(() => {
  vi.clearAllMocks();
  recognizers = []; recorderStarts = 0; recorderStops = 0;
  localStorage.clear();
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "S", username: "pte001" }));
  api.history.mockResolvedValue({ submissions: [] });
  api.questions.mockResolvedValue({ questions: [QUESTION] });
  api.submit.mockResolvedValue({ submission: RESULT });
  global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] })) };
  global.window.SpeechRecognition = FakeRecognition;
  global.window.webkitSpeechRecognition = undefined;
  global.MediaRecorder = class {
    start() { recorderStarts += 1; this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
    stop() { recorderStops += 1; this.onstop?.(); }
  };
  Blob.prototype.arrayBuffer ??= function () { return Promise.resolve(new ArrayBuffer(8)); };
  globalThis.AudioContext = undefined; // no analyser: the silence check then lets the answer through
});
afterEach(() => { globalThis.AudioContext = original; });

async function startRecording() {
  render(<MemoryRouter initialEntries={["/speaking?type=read-aloud"]}><App /></MemoryRouter>);
  fireEvent.click(await screen.findByText("Start Recording"));
  await screen.findByText("Stop Recording");
  await waitFor(() => expect(recognizers).toHaveLength(1));
}

describe("Speaking — live transcript preview", () => {
  it("shows a waiting state, then the words as they arrive, without duplicating them when they turn final", async () => {
    await startRecording();
    expect(screen.getByText("Waiting for you to speak...")).toBeInTheDocument();
    recognizers[0].say([["I believe that", false]]);
    expect(screen.getByText("I believe that")).toBeInTheDocument();
    recognizers[0].say([["I believe that education plays", false]]);
    expect(screen.getByText("I believe that education plays")).toBeInTheDocument();
    recognizers[0].say([["I believe that education plays an important role", true]]);
    recognizers[0].say([["I believe that education plays an important role", true], ["in our society", false]], 1);
    expect(screen.getByText("I believe that education plays an important role in our society")).toBeInTheDocument();
    expect(screen.getByText("Live transcript")).toBeInTheDocument();
  });

  it("keeps the words when the browser ends its session after a pause, and carries on in a new one", async () => {
    await startRecording();
    recognizers[0].say([["first part", true]]);
    recognizers[0].endByItself();
    expect(recognizers).toHaveLength(2);
    expect(recognizers[1].started).toBe(true);
    expect(screen.getByText("first part")).toBeInTheDocument(); // the pause did not clear it
    recognizers[1].say([["second part", false]]);
    expect(screen.getByText("first part second part")).toBeInTheDocument();
  });

  it("never touches the recorder: it records once, and stops the preview with it", async () => {
    await startRecording();
    recognizers[0].say([["hello", true]]);
    recognizers[0].endByItself();
    expect(recorderStarts).toBe(1);
    expect(recorderStops).toBe(0);
    fireEvent.click(screen.getByText("Stop Recording"));
    expect(recorderStops).toBe(1);
    recognizers.at(-1).endByItself();
    expect(recognizers).toHaveLength(2); // no new session after the student has stopped
    expect(screen.getByText("Recording completed.")).toBeInTheDocument();
  });

  it("says the preview is unavailable when the browser has no speech recognition, and still records and submits", async () => {
    global.window.SpeechRecognition = undefined;
    render(<MemoryRouter initialEntries={["/speaking?type=read-aloud"]}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Start Recording"));
    await screen.findByText("Stop Recording");
    expect(screen.getByText(/Live preview is unavailable in this browser/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Stop Recording"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for AI Feedback" })).not.toBeDisabled());
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    const form = api.submit.mock.calls[0][0];
    expect(form.get("audio").size).toBeGreaterThan(0);
    expect(form.get("transcript")).toBe("");
    expect(form.get("serverTranscript")).toBe("1");
  });

  it("switches the preview off, without ending the recording, when the browser refuses the recognizer", async () => {
    await startRecording();
    act(() => recognizers[0].onerror({ error: "network" }));
    expect(screen.getByText(/Live preview is unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Stop Recording")).toBeInTheDocument();
    recognizers[0].endByItself();
    expect(recognizers).toHaveLength(1); // not restarted in a loop
    expect(recorderStops).toBe(0);
  });

  it("uploads the recording with the preview as a draft, then shows the server transcript", async () => {
    await startRecording();
    recognizers[0].say([["draft words", true]]);
    fireEvent.click(screen.getByText("Stop Recording"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for AI Feedback" })).not.toBeDisabled());
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    const form = api.submit.mock.calls[0][0];
    expect(form.get("audio").size).toBeGreaterThan(0);
    expect(form.get("transcript")).toBe("draft words");
    expect(form.get("serverTranscript")).toBe("1");
    expect(await screen.findByText("the final server transcript of the answer")).toBeInTheDocument();
    expect(screen.getByText("Final transcript")).toBeInTheDocument();
    expect(screen.getByText("Final transcript received from the server.")).toBeInTheDocument();
    expect(screen.queryByText("draft words")).not.toBeInTheDocument();
  });
});

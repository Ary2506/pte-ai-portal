import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";
import { waitForLiveMicTrack, previewLanguage } from "../src/practice/Speaking.jsx";

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
  evaluationType: "subjective", prompt: "Listen, then repeat.",
  audioUrl: "/audio/repeat-sentence/core/core-001.mp3"
};

function renderAt(path) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "Student", username: "pte001" }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

// A headset microphone as the browser actually hands it over: the track exists straight away but
// is muted while the device switches out of playback mode, and fires "unmute" when audio flows.
function headsetTrack({ label = "Earbuds (Bluetooth)", muted = true } = {}) {
  const listeners = {};
  return {
    label,
    muted,
    stop: vi.fn(),
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener: (name, fn) => { listeners[name] = (listeners[name] || []).filter(f => f !== fn); },
    // what the device does once the handover completes
    goLive() { this.muted = false; (listeners.unmute || []).forEach(fn => fn()); }
  };
}

function streamOf(track) {
  return { getTracks: () => [track], getAudioTracks: () => [track] };
}

let recorderStarts;

// Mirrors MAX_SILENT_PREVIEW_SESSIONS in Speaking.jsx.
const MAX_SILENT_SESSIONS_BEFORE_GIVING_UP = 4;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.history.mockResolvedValue({ submissions: [] });
  api.questions.mockResolvedValue({ questions: [REPEAT_QUESTION] });
  api.submit.mockResolvedValue({
    submission: {
      _id: "s1", score: 70, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED",
      feedback: { strengths: [], improvements: [], overall: "Done.", note: "n" }
    }
  });
  recorderStarts = 0;
  global.MediaRecorder = class {
    constructor(stream) { this.stream = stream; this.state = "recording"; recorderStarts += 1; }
    start() { this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) }); }
    stop() { this.state = "inactive"; this.onstop?.(); }
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForLiveMicTrack", () => {
  it("resolves at once for a track that is already delivering audio", async () => {
    await expect(waitForLiveMicTrack(headsetTrack({ muted: false }), 50)).resolves.toBeUndefined();
  });

  it("resolves at once for a track that reports no muted flag at all", async () => {
    await expect(waitForLiveMicTrack({ label: "Built-in" }, 50)).resolves.toBeUndefined();
  });

  it("waits for a muted headset track and resolves when it unmutes", async () => {
    const track = headsetTrack();
    let settled = false;
    const waiting = waitForLiveMicTrack(track, 5000).then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(400);
    expect(settled).toBe(false); // still handing over

    track.goLive();
    await waiting;
    expect(settled).toBe(true);
  });

  it("gives up after the timeout so a dead headset still records", async () => {
    const track = headsetTrack();
    const waiting = waitForLiveMicTrack(track, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("stops listening to the track once it has resolved", async () => {
    const track = headsetTrack();
    const waiting = waitForLiveMicTrack(track, 5000);
    track.goLive();
    await waiting;
    track.goLive(); // a second unmute must not throw or resolve anything twice
    await expect(waiting).resolves.toBeUndefined();
  });
});

describe("Repeat Sentence with earphones", () => {
  it("does not start recording into the gap while the headset is still handing over its microphone", async () => {
    const track = headsetTrack();
    global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve(streamOf(track))) };
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");

    fireEvent.ended(document.querySelector("audio.audio"));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));

    // The microphone is open but muted: nothing may be recorded yet.
    await vi.advanceTimersByTimeAsync(600);
    expect(recorderStarts).toBe(0);
    expect(screen.getByText("Record your answer")).toBeInTheDocument();

    track.goLive();
    await screen.findByText("Recording...");
    expect(recorderStarts).toBe(1);
  });

  it("asks for echo cancellation, so the prompt audio in the earphones is not recorded back", async () => {
    const track = headsetTrack({ muted: false });
    global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve(streamOf(track))) };
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");

    fireEvent.ended(document.querySelector("audio.audio"));
    await screen.findByText("Recording...");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  });

  it("records anyway when the headset microphone never wakes up, rather than hanging for ever", async () => {
    const track = headsetTrack();
    global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve(streamOf(track))) };
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");

    fireEvent.ended(document.querySelector("audio.audio"));
    await vi.advanceTimersByTimeAsync(2500); // the settle pause plus the full wake timeout
    await screen.findByText("Recording...");
    expect(recorderStarts).toBe(1);
  });

  it("names the microphone it is recording through, so the wrong input is visible", async () => {
    const track = headsetTrack({ label: "Earbuds (Bluetooth)", muted: false });
    global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve(streamOf(track))) };
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");

    fireEvent.ended(document.querySelector("audio.audio"));
    await screen.findByText("Recording...");
    expect(screen.getByText(/Microphone level . Earbuds \(Bluetooth\)/)).toBeInTheDocument();
  });

  it("releases the microphone instead of recording when the take is abandoned during the handover", async () => {
    const track = headsetTrack();
    global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve(streamOf(track))) };
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");

    fireEvent.ended(document.querySelector("audio.audio"));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Re-do" }));

    track.goLive();
    await vi.advanceTimersByTimeAsync(500);
    expect(recorderStarts).toBe(0);
    expect(track.stop).toHaveBeenCalled();
  });
});

describe("previewLanguage", () => {
  it("keeps the student's own English variety, which is what the recognizer is most accurate on", () => {
    expect(previewLanguage("en-IN")).toBe("en-IN");
    expect(previewLanguage("en-GB")).toBe("en-GB");
    expect(previewLanguage("en-AU")).toBe("en-AU");
    expect(previewLanguage("en")).toBe("en");
  });

  it("normalizes an underscore locale", () => {
    expect(previewLanguage("en_IN")).toBe("en-IN");
  });

  it("falls back to en-US for a non-English or missing locale", () => {
    expect(previewLanguage("hi-IN")).toBe("en-US");
    expect(previewLanguage("fr-FR")).toBe("en-US");
    expect(previewLanguage("")).toBe("en-US");
    expect(previewLanguage(undefined)).toBe("en-US");
    expect(previewLanguage("engineering")).toBe("en-US"); // not a locale, must not pass the test
  });
});

describe("Live transcript when the microphone never reaches the speech service", () => {
  class SilentRecognition {
    constructor() { SilentRecognition.instances.push(this); }
    start() { setTimeout(() => this.onend?.(), 10); } // ends at once, having heard nothing
    stop() { this.onend?.(); }
  }

  beforeEach(() => {
    SilentRecognition.instances = [];
    window.SpeechRecognition = SilentRecognition;
    const track = headsetTrack({ label: "Earbuds (Bluetooth)", muted: false });
    global.navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve(streamOf(track))) };
  });

  afterEach(() => {
    delete window.SpeechRecognition;
  });

  it("stops restarting and says the microphone is not reaching the preview, instead of 'Listening...' for ever", async () => {
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    fireEvent.ended(document.querySelector("audio.audio"));
    await screen.findByText("Recording...");

    await waitFor(() => expect(screen.getByText(/No sound is reaching the live preview/)).toBeInTheDocument());
    expect(screen.getByText(/Your recording is still being captured/)).toBeInTheDocument();

    // It gave up rather than looping: a bounded number of attempts were made.
    const attempts = SilentRecognition.instances.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(SilentRecognition.instances.length).toBe(attempts);
  });

  it("does not give up on a student who is simply pausing between words", async () => {
    // Sessions that run for seconds and end without words are a quiet student, not a dead
    // microphone, so the preview must keep listening however many of them go by.
    class PausingRecognition {
      constructor() { PausingRecognition.instances.push(this); }
      start() { setTimeout(() => this.onend?.(), 4000); } // a real session length, no words heard
      stop() { this.onend?.(); }
    }
    PausingRecognition.instances = [];
    window.SpeechRecognition = PausingRecognition;

    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    fireEvent.ended(document.querySelector("audio.audio"));
    await screen.findByText("Recording...");

    await vi.advanceTimersByTimeAsync(25 * 1000); // six sessions' worth of thinking time
    expect(screen.queryByText(/No sound is reaching the live preview/)).not.toBeInTheDocument();
    expect(PausingRecognition.instances.length).toBeGreaterThan(MAX_SILENT_SESSIONS_BEFORE_GIVING_UP);
  });

  it("still records and submits normally while the preview is showing nothing", async () => {
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Record your answer");
    fireEvent.ended(document.querySelector("audio.audio"));
    await screen.findByText("Recording...");
    await waitFor(() => expect(screen.getByText(/No sound is reaching the live preview/)).toBeInTheDocument());

    await vi.advanceTimersByTimeAsync(30 * 1000);
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  });
});

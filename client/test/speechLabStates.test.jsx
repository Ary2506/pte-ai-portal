import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SpeakingTask from "../src/practice/Speaking.jsx";
import { api } from "../src/api.js";

// The speech lab moves through five states. The box used to render only two, so "evaluating" and
// "recorded, ready to submit" looked identical to "not started" — the student could not tell
// whether the app was listening, thinking, or waiting for them.

vi.mock("../src/api.js", () => ({ api: { submit: vi.fn() } }));

const question = { _id: "q1", type: "read-aloud", section: "speaking", title: "Read Aloud", prompt: "Read it." };
const state = () => document.querySelector(".record-box")?.dataset.state;

beforeEach(() => {
  vi.clearAllMocks();
  // A minimal MediaRecorder + getUserMedia, enough to drive the state machine.
  global.MediaRecorder = class {
    constructor() { this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  };
  global.MediaRecorder.isTypeSupported = () => true;
  navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] })) };
  global.URL.createObjectURL = vi.fn(() => "blob:x");
  global.URL.revokeObjectURL = vi.fn();
});

async function record() {
  fireEvent.click(await screen.findByText("Start Recording"));
  await screen.findByText("Stop Recording");
  fireEvent.click(screen.getByText("Stop Recording"));
}

describe("the recorder announces which state it is in", () => {
  it("starts ready, and shows the transcript-only disclosure before recording", async () => {
    render(<SpeakingTask question={question} />);
    await screen.findByText("Record your answer");
    expect(state()).toBe("ready");
    expect(screen.getByText(/Only your transcript is evaluated/)).toBeInTheDocument();
  });

  it("switches to recording, with a live waveform rather than a static icon", async () => {
    render(<SpeakingTask question={question} />);
    fireEvent.click(await screen.findByText("Start Recording"));
    await waitFor(() => expect(state()).toBe("recording"));
    expect(document.querySelector(".record-wave")).not.toBeNull();
    expect(screen.getByText("Recording...")).toBeInTheDocument();
  });

  it("becomes recorded once there is something to submit", async () => {
    render(<SpeakingTask question={question} />);
    await record();
    await waitFor(() => expect(state()).toBe("recorded"));
    expect(screen.getByText("Ready to submit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for AI Feedback" })).not.toBeDisabled();
  });

  it("shows an evaluating state while the attempt is being scored, not the ready state", async () => {
    let settle;
    api.submit.mockReturnValue(new Promise((res) => { settle = res; }));
    render(<SpeakingTask question={question} />);
    await record();
    await waitFor(() => expect(state()).toBe("recorded"));

    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    await waitFor(() => expect(state()).toBe("evaluating"));
    expect(screen.getByText("Scoring your answer")).toBeInTheDocument();

    settle({ submission: { score: 8, maxScore: 10, evaluationStatus: "COMPLETED", feedback: {} } });
    await waitFor(() => expect(state()).toBe("result"));
  });
});

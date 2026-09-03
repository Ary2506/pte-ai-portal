import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function speakingQuestion(type, title) {
  return { _id: `${type}-1`, title, prompt: "Speak now.", type, evaluationType: "subjective" };
}

let stopSpy;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }))
  };
  stopSpy = vi.fn();
  global.MediaRecorder = class {
    constructor(stream) { this.stream = stream; }
    start() { this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
    stop() { stopSpy(); this.onstop?.(); }
  };
});

afterEach(() => {
  vi.useRealTimers();
});

async function startRecording() {
  fireEvent.click(await screen.findByText("Start Recording"));
  await screen.findByText("Stop Recording");
}

describe("Speaking duration cap — per-type limits", () => {
  it("shows the 40s limit for Read Aloud before recording starts", async () => {
    api.questions.mockResolvedValue({ questions: [speakingQuestion("read-aloud", "Read Aloud")] });
    renderAt("/speaking", studentAuthUser());
    expect(await screen.findByText("Ready · limit 00:40")).toBeInTheDocument();
  });

  it("shows the 15s limit for Repeat Sentence", async () => {
    api.questions.mockResolvedValue({ questions: [speakingQuestion("repeat-sentence", "Repeat Sentence")] });
    renderAt("/speaking", studentAuthUser());
    expect(await screen.findByText("Ready · limit 00:15")).toBeInTheDocument();
  });

  it("shows the 40s limit for Describe Image", async () => {
    api.questions.mockResolvedValue({ questions: [speakingQuestion("describe-image", "Describe Image")] });
    renderAt("/speaking", studentAuthUser());
    expect(await screen.findByText("Ready · limit 00:40")).toBeInTheDocument();
  });

  it("shows the 10s limit for Answer Short Question", async () => {
    api.questions.mockResolvedValue({ questions: [speakingQuestion("answer-short-question", "Answer Short Question")] });
    renderAt("/speaking", studentAuthUser());
    expect(await screen.findByText("Ready · limit 00:10")).toBeInTheDocument();
  });
});

describe("Speaking duration cap — auto-stop behavior", () => {
  it("automatically stops recording once the type-specific limit is reached (10s for Answer Short Question)", async () => {
    api.questions.mockResolvedValue({ questions: [speakingQuestion("answer-short-question", "Answer Short Question")] });
    renderAt("/speaking", studentAuthUser());
    await startRecording();

    await vi.advanceTimersByTimeAsync(10 * 1000);

    await waitFor(() => expect(screen.getByText("Start Recording")).toBeInTheDocument());
    expect(stopSpy).toHaveBeenCalledTimes(1); // MediaRecorder.stop() called exactly once
    expect(screen.getByText("Submit for AI Feedback")).not.toBeDisabled(); // a real blob was produced
  });

  it("does not call stop() a second time from a stale interval tick after auto-stop already fired", async () => {
    api.questions.mockResolvedValue({ questions: [speakingQuestion("answer-short-question", "Answer Short Question")] });
    renderAt("/speaking", studentAuthUser());
    await startRecording();

    await vi.advanceTimersByTimeAsync(30 * 1000); // well past the 10s limit
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("a manual Stop Recording click before the limit does not later auto-fire a second stop", async () => {
    api.questions.mockResolvedValue({ questions: [speakingQuestion("read-aloud", "Read Aloud")] });
    renderAt("/speaking", studentAuthUser());
    await startRecording();

    await vi.advanceTimersByTimeAsync(5 * 1000);
    fireEvent.click(screen.getByText("Stop Recording"));
    expect(stopSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 1000); // long past the 40s limit — nothing left to fire
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("stops the interval on unmount instead of leaking it into the next render", async () => {
    api.questions.mockResolvedValue({ questions: [speakingQuestion("read-aloud", "Read Aloud")] });
    const { unmount } = renderAt("/speaking", studentAuthUser());
    await startRecording();

    unmount();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(stopSpy).not.toHaveBeenCalled(); // unmounted before the interval could ever call stop()
  });
});

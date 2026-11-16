import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

const swt = (n) => ({ _id: `swt${n}`, section: "writing", type: "swt", title: `Passage ${n}`, prompt: "Summarize in one sentence.", passage: "A passage." });
const timerText = () => screen.getByRole("timer").textContent.trim();
const elapse = (ms) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Only the clock the countdown reads: promises and the rest of the app's timers stay real.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], shouldAdvanceTime: false });
  api.history.mockResolvedValue({ submissions: [] });
});
afterEach(() => { vi.useRealTimers(); });

async function openFirst(questions) {
  api.questions.mockResolvedValue({ questions });
  renderAt("/writing?type=swt", studentAuthUser());
  fireEvent.click((await screen.findByText("Passage 1")).closest("button"));
  await screen.findByPlaceholderText("Type your answer here...");
}

describe("Summarize Written Text — 10-minute practice timer", () => {
  it("starts at 10:00 as soon as the question appears and counts down", async () => {
    await openFirst([swt(1), swt(2)]);
    expect(timerText()).toBe("10:00");
    elapse(65_000);
    expect(timerText()).toBe("08:55");
  });

  it("starts again from 10:00 on Next and on Previous", async () => {
    await openFirst([swt(1), swt(2)]);
    elapse(120_000);
    expect(timerText()).toBe("08:00");

    fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Passage 2");
    expect(timerText()).toBe("10:00");
    elapse(30_000);
    expect(timerText()).toBe("09:30");

    fireEvent.click(screen.getByText("Previous"));
    await screen.findByText("Passage 1");
    expect(timerText()).toBe("10:00");
  });

  it("turns red in the last minute and shows Time's up at zero, without blocking submission", async () => {
    await openFirst([swt(1), swt(2)]);
    elapse(9 * 60_000 + 1_000);
    expect(screen.getByRole("timer")).toHaveClass("low");
    elapse(60_000);
    expect(timerText()).toBe("Time's up");
    fireEvent.change(screen.getByPlaceholderText("Type your answer here..."), { target: { value: "A summary." } });
    expect(screen.getByText("Submit for AI Feedback").closest("button")).not.toBeDisabled();
  });

  it("Re-do gives the full ten minutes again", async () => {
    await openFirst([swt(1), swt(2)]);
    elapse(200_000);
    fireEvent.click(screen.getByText("Re-do"));
    expect(timerText()).toBe("10:00");
  });
});

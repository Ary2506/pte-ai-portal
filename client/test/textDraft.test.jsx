import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// Typing is deliberately NOT kept across a reload.
//
// An earlier version auto-saved every keystroke to localStorage. That was reverted: in a mock,
// Save is the one deliberate act that records an answer, and a box that silently refilled itself
// blurred the line between "I saved this" and "I happened to type this". Practice follows the
// same rule so the two behave alike.
//
// Saved drafts — the ones behind the mock's Save button — are a separate mechanism and are still
// persisted; test/mock.test.jsx covers those.
vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(),
    questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(), active: vi.fn() }
  },
  forceLogout: vi.fn()
}));

const QUESTIONS = [
  { _id: "w1", type: "essay", section: "writing", title: "Essay Q", prompt: "Write about something.", evaluationType: "subjective" },
  { _id: "w2", type: "essay", section: "writing", title: "Second Essay", prompt: "And another.", evaluationType: "subjective" }
];

function renderWriting() {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "S", username: "pte001" }));
  return render(<MemoryRouter initialEntries={["/writing"]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.questionIndex.mockImplementation(() => Promise.resolve({ questions: QUESTIONS }));
  api.questions.mockImplementation(() => Promise.resolve({ questions: QUESTIONS }));
  api.history.mockResolvedValue({ submissions: [], total: 0 });
  api.testSessions.active.mockResolvedValue({ testSession: null });
});

describe("typing is not carried across a reload", () => {
  it("writes nothing to storage while the student types", async () => {
    renderWriting();

    fireEvent.click(await screen.findByText("Essay Q"));
    const box = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(box, { target: { value: "a half-written answer" } });

    // Give any debounce a chance to fire before concluding nothing was written.
    await new Promise(resolve => setTimeout(resolve, 600));

    const stored = Object.keys(localStorage).filter(key => key.includes("text"));
    expect(stored).toEqual([]);
  });

  it("opens an empty box after the page is reloaded", async () => {
    const { unmount } = renderWriting();

    fireEvent.click(await screen.findByText("Essay Q"));
    fireEvent.change(await screen.findByPlaceholderText("Type your answer here..."),
      { target: { value: "a half-written answer" } });

    unmount();
    renderWriting();
    fireEvent.click(await screen.findByText("Essay Q"));

    const reopened = await screen.findByPlaceholderText("Type your answer here...");
    await waitFor(() => expect(reopened).toHaveValue(""));
  });

  it("still remembers which question was open", async () => {
    // Position is remembered; the typing inside it is not. The two are separate decisions.
    const { unmount } = renderWriting();
    fireEvent.click(await screen.findByText("Second Essay"));
    await screen.findByText("And another.");

    unmount();
    renderWriting();

    expect(await screen.findByText("And another.")).toBeInTheDocument();
  });
});

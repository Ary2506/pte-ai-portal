import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";

// Proves ReadAloudPractice.jsx is genuinely data-driven off read_aloud.json's own length and
// order — not a separately maintained id list, and not a number hardcoded anywhere in the
// component — by mocking the JSON to a size other than the real 15 and confirming the whole UI
// (counter, navigation, Finish placement) tracks that size exactly.
vi.mock("../content/speaking/read-aloud/read_aloud.json", () => ({
  default: [
    { id: 1, title: "Mock One", type: "Read Aloud", question: "First mock passage.", answer: "First mock passage." },
    { id: 2, title: "Mock Two", type: "Read Aloud", question: "Second mock passage.", answer: "Second mock passage." },
    { id: 3, title: "Mock Three", type: "Read Aloud", question: "Third mock passage.", answer: "Third mock passage." },
  ]
}));

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
});

describe("Read Aloud total is dynamic, never a hardcoded count", () => {
  it("a 3-question content file drives a 3-question practice flow end to end", async () => {
    renderAt("/speaking", studentAuthUser());
    await screen.findByText("Question 1 of 3");
    expect(screen.getByRole("heading", { name: "Mock One" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Question 2 of 3");
    expect(screen.getByRole("heading", { name: "Mock Two" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Question 3 of 3");
    expect(screen.getByRole("heading", { name: "Mock Three" })).toBeInTheDocument();
    expect(screen.getByText("Finish")).toBeInTheDocument(); // last question, not the 15th

    fireEvent.click(screen.getByText("Finish"));
    await screen.findByText("Practice Completed 🎉");
    expect(screen.getByText("You've gone through all 3 Read Aloud questions.")).toBeInTheDocument();
  });
});

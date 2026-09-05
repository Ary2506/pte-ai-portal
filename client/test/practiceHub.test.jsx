import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn(),
      questions: { types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn() }
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

// One active question per section, matching what GET /api/questions?section=X actually returns —
// the hub derives per-type content availability from exactly this shape, never a separate count
// endpoint.
function questionsFor(section) {
  const bySection = {
    speaking: [{ _id: "s1", type: "read-aloud", title: "Read Aloud Q" }],
    writing: [{ _id: "w1", type: "essay", title: "Essay Q" }],
    reading: [{ _id: "r1", type: "mcq-single", title: "MCQ Q", options: ["A", "B"] }],
    listening: [{ _id: "l1", type: "write-dictation", title: "Dictation Q" }]
  };
  return bySection[section] || [];
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.dashboard.mockResolvedValue({
    stats: { overall: 0, practiceCount: 0, targetScore: 79 }, bySection: [], recent: [],
    streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false }, weeklyActivity: []
  });
  api.questions.mockImplementation((section) => Promise.resolve({ questions: questionsFor(section) }));
});

describe("Practice Hub", () => {
  it("renders a supported task type with real content as a real, enabled, clickable row", async () => {
    renderAt("/practice", studentAuthUser());
    await screen.findByRole("heading", { name: "PTE Practice" });
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4)); // exactly one request per section, never per task type
    const row = screen.getByText("Read Aloud").closest(".practice-row");
    expect(row.tagName).toBe("BUTTON");
    expect(row).not.toHaveClass("disabled");
    expect(row).not.toBeDisabled();
  });

  it("shows 'No content yet' for a supported type with zero active content (e.g. reading MCQ Multiple), and it is not clickable", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    const rows = screen.getAllByText("Multiple Choice Multiple").map(el => el.closest(".practice-row"));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(row => {
      expect(row).toHaveClass("disabled");
      expect(row.tagName).toBe("SPAN"); // a disabled row is never a real <button>
    });
    expect(screen.getAllByText("No content yet").length).toBeGreaterThan(0);
  });

  it("Phase 20: Write Email is now genuinely supported — shows 'No content yet' (a content gap), never 'Coming Soon' (a functionality gap)", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    const row = screen.getByText("Write Email").closest(".practice-row");
    expect(row).toHaveClass("disabled"); // still not clickable — there's zero active content, not zero support
    expect(row.tagName).toBe("SPAN");
    expect(row).toHaveTextContent("No content yet");
    expect(row).not.toHaveTextContent("Coming Soon");
  });

  it("Phase 20: no task type in the PTE Practice menu shows 'Coming Soon' any more — every listed type is genuinely supported", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    expect(screen.queryByText("Coming Soon")).not.toBeInTheDocument();
  });

  it("does not show an AI Score badge on a purely objective task", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    const rows = screen.getAllByText("Multiple Choice Single").map(el => el.closest(".practice-row"));
    rows.forEach(row => expect(row.querySelector(".practice-row-badge.ai")).toBeNull());
  });

  it("shows an AI Score badge on a task type that actually gets AI evaluation and has content", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    const row = screen.getByText("Read Aloud").closest(".practice-row");
    expect(row.querySelector(".practice-row-badge.ai")).not.toBeNull();
    expect(row).toHaveTextContent("AI Score");
  });

  it("clicking Read Aloud navigates into the speaking practice session for that task", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByText("Read Aloud").closest(".practice-row"));
    await screen.findByText("Read Aloud Q");
  });

  it("clicking Write Essay navigates into the writing practice session", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByText("Write Essay").closest(".practice-row"));
    await screen.findByText("Essay Q");
  });

  it("clicking Multiple Choice Single (reading) navigates into the reading practice session", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getAllByText("Multiple Choice Single")[0].closest(".practice-row"));
    await screen.findByText("MCQ Q");
  });

  it("clicking Write From Dictation navigates into the listening practice session", async () => {
    renderAt("/practice", studentAuthUser());
    await waitFor(() => expect(api.questions).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByText("Write From Dictation").closest(".practice-row"));
    await screen.findByText("Dictation Q");
  });

  it("shows a PTE Core / PTE Academic-UKVI toggle without inventing a real content split", async () => {
    renderAt("/practice", studentAuthUser());
    await screen.findByRole("heading", { name: "PTE Practice" });
    expect(screen.getByText("PTE Core")).toBeInTheDocument();
    const academic = screen.getByText("PTE Academic / UKVI");
    expect(academic).toHaveAttribute("title", expect.stringContaining("isn't split by exam variant yet"));
  });

  it("shows a More section with real links and honestly-disabled not-yet-built items", async () => {
    renderAt("/practice", studentAuthUser());
    await screen.findByRole("heading", { name: "PTE Practice" });
    expect(screen.getByText("Mock Tests").closest("a")).toHaveAttribute("href", "/mock");
    expect(screen.getByText("Vocabulary").closest("span")).toHaveClass("disabled");
  });
});

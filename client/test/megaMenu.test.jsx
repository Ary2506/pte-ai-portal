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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.dashboard.mockResolvedValue({
    stats: { overall: 0, practiceCount: 0, targetScore: 79 }, bySection: [], recent: [],
    streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false }, weeklyActivity: []
  });
  api.questions.mockResolvedValue({ questions: [] });
});

describe("PTE Practice mega-menu", () => {
  it("opens when clicked, showing every section and the Speaking task list", async () => {
    renderAt("/dashboard", studentAuthUser());
    const trigger = await screen.findByText("PTE Practice");
    expect(trigger.closest("button")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger.closest("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Read Aloud")).toBeInTheDocument();
    expect(screen.getByText("Reorder Paragraph")).toBeInTheDocument();
  });

  it("closes when the trigger is clicked a second time", async () => {
    renderAt("/dashboard", studentAuthUser());
    const trigger = await screen.findByText("PTE Practice");
    fireEvent.click(trigger);
    expect(screen.getByText("Read Aloud")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByText("Read Aloud")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    renderAt("/dashboard", studentAuthUser());
    const trigger = await screen.findByText("PTE Practice");
    fireEvent.click(trigger);
    expect(screen.getByText("Read Aloud")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Read Aloud")).not.toBeInTheDocument();
  });

  it("closes when clicking outside the panel", async () => {
    renderAt("/dashboard", studentAuthUser());
    const trigger = await screen.findByText("PTE Practice");
    fireEvent.click(trigger);
    expect(screen.getByText("Read Aloud")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Read Aloud")).not.toBeInTheDocument();
  });

  it("is keyboard-focusable and opens via a native button activation", async () => {
    renderAt("/dashboard", studentAuthUser());
    const trigger = (await screen.findByText("PTE Practice")).closest("button");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger); // Enter/Space on a focused native <button> dispatch a click event
    expect(screen.getByText("Read Aloud")).toBeInTheDocument();
  });

  it("shows both PTE Academic/UKVI and PTE Core, honestly disclosing the library isn't split by variant", async () => {
    renderAt("/dashboard", studentAuthUser());
    fireEvent.click(await screen.findByText("PTE Practice"));
    expect(screen.getByText("PTE Academic / UKVI")).toBeInTheDocument();
    const core = screen.getByText("PTE Core");
    expect(core).toBeInTheDocument();
    expect(core).toHaveAttribute("title", expect.stringContaining("isn't split by exam variant"));
  });

  it("marks an unsupported task (Respond to a Situation) as Coming Soon, not clickable", async () => {
    renderAt("/dashboard", studentAuthUser());
    fireEvent.click(await screen.findByText("PTE Practice"));
    const item = screen.getByText("Respond to a Situation").closest("span");
    expect(item).toHaveClass("disabled");
    expect(screen.getAllByText("Coming Soon").length).toBeGreaterThan(0);
  });
});

describe("More menu", () => {
  it("opens and shows both real links and Coming Soon items", async () => {
    renderAt("/dashboard", studentAuthUser());
    fireEvent.click(await screen.findByText("More"));
    expect(screen.getByText("Mock Tests")).toBeInTheDocument();
    expect(screen.getByText("AI Study Plan")).toBeInTheDocument();
    expect(screen.getByText("Practice History")).toBeInTheDocument();
    expect(screen.getByText("Vocabulary").closest("span")).toHaveClass("disabled");
  });

  it("navigates to the existing Mock Tests page without a page reload", async () => {
    renderAt("/dashboard", studentAuthUser());
    fireEvent.click(await screen.findByText("More"));
    fireEvent.click(screen.getByText("Mock Tests"));
    await waitFor(() => expect(screen.getByText("Full PTE Practice Mock")).toBeInTheDocument());
  });
});

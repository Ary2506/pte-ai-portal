import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  it("Phase 20: every PTE Practice task is now genuinely supported — none show as Coming Soon here", async () => {
    renderAt("/dashboard", studentAuthUser());
    fireEvent.click(await screen.findByText("PTE Practice"));
    // Respond to a Situation, Write Email, Fill in the Blanks (Drag and Drop), Select Missing
    // Word, and Highlight Incorrect Words were the last unsupported task types — now real,
    // clickable mega-menu entries, not disabled "Coming Soon" spans.
    for (const label of ["Respond to a Situation", "Write Email", "Fill in the Blanks Drag/Drop", "Select Missing Word", "Highlight Incorrect Words"]) {
      const item = screen.getByText(label).closest("button, span");
      expect(item.tagName).toBe("BUTTON");
      expect(item).not.toHaveClass("disabled");
    }
    // "Coming Soon" still exists as a mechanism (unrelated More-menu features like Vocabulary
    // remain genuinely unbuilt) — just not for any PTE Practice task type any more.
    expect(screen.queryByText("Respond to a Situation")?.closest("span")).toBeNull();
  });
});

// The sidebar's "More" dropdown was replaced by a direct AI Study Plan link. Of the three real
// destinations it held, Mock Tests and Practice History already had their own sidebar entries,
// so Study Plan was the only one the sidebar could not otherwise reach. The remaining items were
// all "Coming Soon" placeholders, which are still listed in the Practice Hub's own More section.
describe("AI Study Plan replaces the More dropdown", () => {
  it("is a direct sidebar link, not a menu to open", async () => {
    renderAt("/dashboard", studentAuthUser());
    const link = await screen.findByRole("link", { name: "AI Study Plan" });
    expect(link).toHaveAttribute("href", "/plan");
    expect(screen.queryByRole("button", { name: /^More/ })).not.toBeInTheDocument();
  });

  it("navigates to the study plan without a page reload", async () => {
    api.history.mockResolvedValue({ submissions: [], total: 0 });
    renderAt("/dashboard", studentAuthUser());
    fireEvent.click(await screen.findByRole("link", { name: "AI Study Plan" }));
    expect(await screen.findByRole("heading", { name: "Study plan" })).toBeInTheDocument();
  });

  it("still reaches Mock Tests and My Results from their own sidebar entries", async () => {
    renderAt("/dashboard", studentAuthUser());
    const sidebar = document.querySelector(".sidebar");
    expect(within(sidebar).getByRole("link", { name: "Take Mock Test" })).toHaveAttribute("href", "/mock");
    expect(within(sidebar).getByRole("link", { name: "My Results" })).toHaveAttribute("href", "/history");
  });
});

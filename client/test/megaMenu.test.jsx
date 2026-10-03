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

// The sidebar's PTE Practice mega-menu was replaced by a direct link to the Practice Hub. The
// dropdown listed every section and task; the hub lists the same things with availability,
// progress and filters attached, so the menu was a second, thinner view of one destination.
// What these pin is that nothing the menu could reach became unreachable.
describe("PTE Practice goes straight to the Practice Hub", () => {
  it("is a direct sidebar link, not a menu to open", async () => {
    renderAt("/dashboard", studentAuthUser());
    const sidebar = document.querySelector(".sidebar");
    const link = within(sidebar).getByRole("link", { name: "PTE Practice" });
    expect(link).toHaveAttribute("href", "/practice");
    expect(within(sidebar).queryByRole("button", { name: /PTE Practice/ })).not.toBeInTheDocument();
  });

  it("navigates to the hub without a page reload", async () => {
    renderAt("/dashboard", studentAuthUser());
    const sidebar = document.querySelector(".sidebar");
    fireEvent.click(within(sidebar).getByRole("link", { name: "PTE Practice" }));
    expect(await screen.findByRole("heading", { name: "PTE Practice" })).toBeInTheDocument();
  });

  it("still exposes every section and task type, now on the hub itself", async () => {
    api.questions.mockImplementation((section) => Promise.resolve({
      questions: section === "speaking" ? [{ _id: "s1", type: "read-aloud", title: "Read Aloud Q" }] : []
    }));
    renderAt("/practice", studentAuthUser());
    await screen.findByRole("heading", { name: "PTE Practice" });
    for (const label of ["Speaking", "Writing", "Reading", "Listening"]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    // A task the menu used to list is still listed, and still reachable.
    expect(screen.getByText("Read Aloud")).toBeInTheDocument();
  });

  it("keeps both exam variants disclosed on the hub", async () => {
    renderAt("/practice", studentAuthUser());
    await screen.findByRole("heading", { name: "PTE Practice" });
    expect(screen.getByText("PTE Core")).toBeInTheDocument();
    expect(screen.getByText("PTE Academic / UKVI")).toBeInTheDocument();
  });

  it("still reaches a specific task directly from global search", async () => {
    renderAt("/dashboard", studentAuthUser());
    const input = await screen.findByLabelText("Search anything");
    fireEvent.change(input, { target: { value: "Read Aloud" } });
    const option = await screen.findByRole("option", { name: /Read Aloud/ });
    expect(option).toBeInTheDocument();
  });
});

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

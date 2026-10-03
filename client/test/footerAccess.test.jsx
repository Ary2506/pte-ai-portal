import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// The footer renders on every signed-in page and repeats the product's destinations, so it is a
// second place admin navigation could leak to a student. The existing separation test looks for
// the text "Admin Panel"; this link is labelled "Admin", so that test would not have caught it.

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    dashboard: vi.fn(() => Promise.resolve({ stats: {}, bySection: [], recent: [], streak: {}, weeklyActivity: [] })),
    history: vi.fn(() => Promise.resolve({ submissions: [], total: 0 })),
    questions: vi.fn(() => Promise.resolve({ questions: [] })),
    plan: vi.fn(), submit: vi.fn(),
    admin: { getStats: vi.fn(() => Promise.resolve({})), getAuditLog: vi.fn(() => Promise.resolve({ entries: [] })), listUsers: vi.fn(() => Promise.resolve({ users: [] })) },
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(() => Promise.resolve({ testSessions: [] })) }
  },
  forceLogout: vi.fn()
}));

function renderAs(role) {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify({
    id: "u1", role, name: "Sam", username: "pte001", subscriptionStatus: "ACTIVE", targetScore: 79
  }));
  return render(<MemoryRouter initialEntries={["/dashboard"]}><App /></MemoryRouter>);
}

const footer = () => document.querySelector(".app-footer");

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });

describe("the footer carries no admin route at all", () => {
  it("does not show Admin to a student", async () => {
    renderAs("student");
    await screen.findByText("Copyright © " + new Date().getFullYear() + " PTE CORE AI. All Rights Reserved.");
    expect(within(footer()).queryByText("Admin")).not.toBeInTheDocument();
    expect(within(footer()).queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("does not show Admin to an administrator either — the sidebar owns that route", async () => {
    renderAs("admin");
    await screen.findByText(/All Rights Reserved/);
    expect(within(footer()).queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("still gives a student every destination they are entitled to", async () => {
    renderAs("student");
    await screen.findByText(/All Rights Reserved/);
    for (const label of ["Practice", "Mock Tests", "My Results", "Progress", "Study Plan"]) {
      expect(within(footer()).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });
});

describe("the footer is on every page, not just the dashboard", () => {
  it("renders on My Results too", async () => {
    localStorage.setItem("pte_token", "t");
    localStorage.setItem("pte_user", JSON.stringify({ id: "u1", role: "student", name: "Sam", username: "pte001", subscriptionStatus: "ACTIVE" }));
    render(<MemoryRouter initialEntries={["/history"]}><App /></MemoryRouter>);
    await screen.findByText(/All Rights Reserved/);
    expect(footer()).not.toBeNull();
  });
});

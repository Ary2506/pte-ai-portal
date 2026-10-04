import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";
import { openSignIn } from "./openSignIn.js";
import { PRACTICE_SECTIONS, PRACTICE_TASKS } from "../src/practiceTaskRegistry.js";
import { SAMPLE_FEEDBACK } from "../src/landing/Voices.jsx";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    dashboard: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(),
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  },
  forceLogout: vi.fn()
}));

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });
const renderLanding = () => render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

describe("the signed-out surface is a landing page, not a login screen", () => {
  it("leads with the product, and does not show the sign-in form until asked", () => {
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Your PTE\s*score,\s*engineered/i);
    expect(screen.queryByPlaceholderText("e.g. pte001")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens and closes the sign-in sheet", async () => {
    renderLanding();
    await openSignIn();
    expect(screen.getByPlaceholderText("e.g. pte001")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close sign in"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the sheet on Escape", async () => {
    renderLanding();
    await openSignIn();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("is a centred modal card, not an edge-docked drawer", async () => {
    renderLanding();
    const dialog = await openSignIn();
    expect(dialog).toHaveClass("ld-modal__card");
    expect(dialog.closest(".ld-modal")).toBeInTheDocument();
    // The brand mark heads the card, which is what makes it read as a focal dialog.
    expect(dialog.querySelector(".ld-modal__mark")).toBeInTheDocument();
  });

  it("does not wear the retired .auth-card class, which painted it the app's slate surface", async () => {
    renderLanding();
    const dialog = await openSignIn();
    // html[data-theme="dark"] .auth-card{background:var(--surface)} outranked the landing's own
    // --ld-surface on specificity, so the card rendered blue-grey inside a near-black page.
    expect(dialog).not.toHaveClass("auth-card");
    expect(document.querySelector(".auth-card")).toBeNull();
  });

  it("marks the sheet as a modal dialog and puts focus in the first field", async () => {
    renderLanding();
    const dialog = await openSignIn();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText("e.g. pte001")));
  });
});

describe("a forced sign-out is not hidden behind a closed panel", () => {
  it("opens the sheet on load and shows the notice when one is waiting", async () => {
    sessionStorage.setItem("pte_login_notice", "You were signed out because you signed in elsewhere.");
    renderLanding();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("You were signed out because you signed in elsewhere.")).toBeInTheDocument();
    // Read once and cleared, so a reload does not resurrect it.
    expect(sessionStorage.getItem("pte_login_notice")).toBeNull();
  });
});

describe("authentication behaviour is carried over unchanged", () => {
  it("signs in and routes a student to the dashboard", async () => {
    api.auth.signin.mockResolvedValue({ token: "t", user: { role: "student", name: "S", username: "pte001" } });
    api.dashboard.mockResolvedValue({ stats: {}, bySection: [], recent: [], streak: {}, weeklyActivity: [] });
    renderLanding();
    await openSignIn();

    fireEvent.change(screen.getByPlaceholderText("e.g. pte001"), { target: { value: "pte001" } });
    fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(api.auth.signin).toHaveBeenCalledWith({ username: "pte001", password: "pw" }));
  });

  it("keeps the show/hide password control", async () => {
    renderLanding();
    await openSignIn();
    const field = screen.getByPlaceholderText("Your password");
    expect(field).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByLabelText("Show password"));
    expect(field).toHaveAttribute("type", "text");
  });
});

describe("the page states only things that are true", () => {
  it("labels every illustrative report as sample data, not as a real result", () => {
    renderLanding();
    // Both the hero and the mock-tests section show invented figures, so both must say so.
    const labelled = screen.getAllByText(/Sample report/i);
    expect(labelled.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".ld-hero")).toHaveTextContent(/Sample report/i);
    expect(document.getElementById("mock-tests")).toHaveTextContent(/Sample report/i);
  });

  it("counts practice task types from the registry instead of asserting a number", () => {
    const real = PRACTICE_SECTIONS.reduce((n, s) => n + PRACTICE_TASKS[s].filter(t => t.supported).length, 0);
    renderLanding();
    const metric = screen.getByText("Practice task types").closest(".ld-metrics__item");
    expect(metric.querySelector(".ld-metrics__value").textContent).toBe(String(real));
  });

  // The page carries a feedback section now, so the old blanket "no testimonials" assertion no
  // longer describes it. What still has to hold is narrower and more useful: no invented counts,
  // ratings or star scores anywhere, and no claim that a specific number of people use this.
  it("states no student counts, ratings or star scores", () => {
    const { container } = renderLanding();
    expect(container.textContent).not.toMatch(/\d[\d,.]*\s*(k|m)?\+?\s*(students|learners|users|reviews|ratings)/i);
    expect(container.textContent).not.toMatch(/rated\s|out of 5|★|⭐/i);
    expect(container.textContent).not.toMatch(/thousands (have|of)/i);
  });
});

// Two nav links pointed at the same anchor, so "Practice" and "Mock Tests" scrolled to the same
// block. Every item must reach a target that exists and that nothing else claims.
describe("page navigation", () => {
  it("gives every nav link its own destination", async () => {
    renderLanding();
    const nav = document.querySelector(".ld-nav__links");
    const targets = [...nav.querySelectorAll("a")].map(a => a.getAttribute("href"));
    expect(targets.length).toBeGreaterThan(1);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("points every nav link at an element that actually exists", async () => {
    renderLanding();
    const nav = document.querySelector(".ld-nav__links");
    for (const link of nav.querySelectorAll("a")) {
      const id = link.getAttribute("href").slice(1);
      expect(document.getElementById(id), `${link.textContent} -> #${id}`).not.toBeNull();
    }
  });

  it("sends Practice and Mock Tests to different places", async () => {
    renderLanding();
    const nav = document.querySelector(".ld-nav__links");
    const href = (name) => [...nav.querySelectorAll("a")].find(a => a.textContent === name)?.getAttribute("href");
    expect(href("Practice")).not.toBe(href("Mock Tests"));
    expect(href("Mock Tests")).toBe("#mock-tests");
  });

  it("lands on a full section rather than a single card in a grid", async () => {
    renderLanding();
    const target = document.getElementById("mock-tests");
    expect(target.tagName).toBe("SECTION");
    expect(target).toHaveClass("ld-mock");
    // Not the bento tile it used to point at.
    expect(target).not.toHaveClass("ld-tile");
  });
});

describe("the mock tests section describes the real thing", () => {
  it("states what a mock actually is in this product", async () => {
    renderLanding();
    const section = document.getElementById("mock-tests");
    expect(section).toHaveTextContent(/One question from every section/i);
    expect(section).toHaveTextContent(/twenty-minute clock/i);
    // The server really does auto-submit on expiry, and really does score from the answers given.
    expect(section).toHaveTextContent(/submits for you when time runs out/i);
    expect(section).toHaveTextContent(/Nothing is preset/i);
  });

  it("labels its report figures as a sample, like the hero does", async () => {
    renderLanding();
    const section = document.getElementById("mock-tests");
    expect(section).toHaveTextContent(/Sample report/i);
  });

  it("shows all four sections in the report preview", async () => {
    renderLanding();
    const section = document.getElementById("mock-tests");
    for (const name of ["Speaking", "Writing", "Reading", "Listening"]) {
      expect(section).toHaveTextContent(name);
    }
  });
});

describe("the learner feedback column", () => {
  it("shows a name and a quote for each entry, and no job titles", () => {
    renderLanding();
    for (const person of SAMPLE_FEEDBACK) {
      // Two copies exist: the readable set and the aria-hidden duplicate that closes the loop.
      expect(screen.getAllByText(person.name).length).toBeGreaterThan(0);
      expect(screen.getAllByText(person.quote).length).toBeGreaterThan(0);
    }
    const column = document.querySelector(".ld-marquee");
    expect(column.textContent).not.toMatch(/engineer|intern at|developer|@|at [A-Z]/);
  });

  it("duplicates the set for a seamless loop, with the copy hidden from assistive tech", () => {
    renderLanding();
    const sets = document.querySelectorAll(".ld-marquee__set");
    expect(sets).toHaveLength(2);
    expect(sets[0]).not.toHaveAttribute("aria-hidden");
    expect(sets[1]).toHaveAttribute("aria-hidden", "true");
    expect(sets[0].children).toHaveLength(SAMPLE_FEEDBACK.length);
    expect(sets[1].children).toHaveLength(SAMPLE_FEEDBACK.length);
  });

  it("replaces the reference's mentor claim with something this product actually does", () => {
    renderLanding();
    expect(screen.queryByText(/mentor/i)).not.toBeInTheDocument();
    expect(screen.getByText(/follows your weakest skill/i)).toBeInTheDocument();
  });

  it("keeps the placeholder feedback in one swappable export", () => {
    // If this ever becomes real, consented feedback it still lands here — the section reads from
    // this array alone, so nothing in the markup has to change.
    expect(Array.isArray(SAMPLE_FEEDBACK)).toBe(true);
    expect(SAMPLE_FEEDBACK.every(p => p.name && p.quote)).toBe(true);
  });
});

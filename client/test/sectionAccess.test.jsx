import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";
import { lockReason, isFullAccess, sectionInfo } from "../src/access.js";
import { buildWeek } from "../src/pages/StudyPlan.jsx";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(),
      revokeSessions: vi.fn(), addPurchase: vi.fn(), listPurchases: vi.fn(),
      subscriptionExtension: { extendUser: vi.fn(), revokeUser: vi.fn(), cancelUser: vi.fn(), bulkPreview: vi.fn(), bulkExtend: vi.fn(), history: vi.fn() },
      testSessions: { list: vi.fn(), get: vi.fn() },
      questions: { types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn() }
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(), active: vi.fn() }
  },
  forceLogout: vi.fn()
}));

const DAY = 86400000;
const iso = (days) => new Date(Date.now() + days * DAY).toISOString();

// What /auth/me now returns: each section's status, computed by the server.
function student(sections, extra = {}) {
  return {
    id: "u1", role: "student", name: "Student", username: "pte001",
    subscriptionStatus: "ACTIVE",
    subscriptionStartDate: iso(-5),
    subscriptionEndDate: iso(30),
    sections,
    ...extra
  };
}
const row = (section, status, endDays = 30) => ({ section, status, startDate: iso(-5), endDate: status === "NOT_PURCHASED" ? null : iso(endDays) });

const LISTENING_ONLY = student([
  row("speaking", "NOT_PURCHASED"), row("writing", "NOT_PURCHASED"),
  row("reading", "NOT_PURCHASED"), row("listening", "ACTIVE")
]);
const READING_LAPSED = student([
  row("speaking", "ACTIVE"), row("writing", "ACTIVE"),
  row("reading", "EXPIRED", -3), row("listening", "ACTIVE")
]);

function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.questionIndex.mockImplementation((section) => Promise.resolve({ questions: [{ _id: `${section}-1`, type: section === "listening" ? "write-dictation" : "mcq-single" }] }));
  api.questions.mockResolvedValue({ questions: [] });
  api.history.mockResolvedValue({ submissions: [] });
  api.testSessions.active.mockResolvedValue({ testSession: null });
  api.testSessions.list.mockResolvedValue({ testSessions: [] });
  api.dashboard.mockResolvedValue({});
});

describe("access.js", () => {
  it("reads a user with no sections list as full access — a session from before this existed", () => {
    const stale = { role: "student", subscriptionStatus: "ACTIVE" };
    expect(isFullAccess(stale)).toBe(true);
    expect(lockReason(stale, "reading")).toBeNull();
  });

  it("reads no signed-in user, and an admin, as full access", () => {
    expect(isFullAccess(null)).toBe(true);
    expect(isFullAccess({ role: "admin" })).toBe(true);
  });

  it("tells a section never bought apart from one that lapsed", () => {
    expect(lockReason(LISTENING_ONLY, "reading").kind).toBe("not-purchased");
    expect(lockReason(LISTENING_ONLY, "reading").label).toBe("Not in your plan");
    expect(lockReason(READING_LAPSED, "reading").kind).toBe("expired");
    expect(lockReason(READING_LAPSED, "reading").label).toMatch(/^Expired /);
    expect(lockReason(READING_LAPSED, "speaking")).toBeNull();
  });

  it("treats a section missing from the list as not purchased", () => {
    expect(sectionInfo(student([row("listening", "ACTIVE")]), "reading").status).toBe("NOT_PURCHASED");
  });
});

describe("practice hub — locked sections shown, never clickable", () => {
  it("disables every task in a section outside the plan, with its reason", async () => {
    renderAt("/practice", LISTENING_ONLY);
    // Reading-only task names: "Multiple Choice Single" also exists in Listening, which this student holds.
    const readingRows = await waitFor(() => {
      const rows = ["Reorder Paragraph", "Fill in the Blanks Dropdown"]
        .map(name => screen.getByText(name).closest(".practice-row"));
      expect(rows.every(Boolean)).toBe(true);
      return rows;
    });
    for (const r of readingRows) {
      expect(r.tagName).toBe("SPAN");
      expect(r).toHaveClass("disabled");
      expect(r).toHaveTextContent("Not in your plan");
      expect(r).not.toHaveTextContent("No content yet"); // the lock, not a content gap
    }
  });

  it("never asks the server for a locked section's questions", async () => {
    renderAt("/practice", LISTENING_ONLY);
    await waitFor(() => expect(api.questionIndex).toHaveBeenCalledTimes(1));
    expect(api.questionIndex).toHaveBeenCalledWith("listening");
  });

  it("keeps the sections the student holds startable", async () => {
    renderAt("/practice", LISTENING_ONLY);
    await waitFor(() => {
      const dictation = screen.getByText("Write From Dictation").closest(".practice-row");
      expect(dictation.tagName).toBe("BUTTON");
    });
  });

  it("marks a lapsed section as expired, not as never bought", async () => {
    renderAt("/practice", READING_LAPSED);
    const header = await screen.findByText("Reading", { selector: ".practice-column-head" });
    const column = header.closest(".practice-column");
    expect(column).toHaveClass("is-locked");
    expect(within(column).getAllByText(/Expired/).length).toBeGreaterThan(0);
  });

  it("changes nothing for a full-access student, or one signed in from before sections existed", async () => {
    const { sections, ...stale } = LISTENING_ONLY;
    renderAt("/practice", stale);
    await waitFor(() => expect(api.questionIndex).toHaveBeenCalledTimes(4));
    expect(screen.queryByText("Not in your plan")).not.toBeInTheDocument();
  });
});

describe("section pages — locked by URL too", () => {
  it("shows why a locked section did not open, and loads none of its questions", async () => {
    renderAt("/reading?type=mcq-single", LISTENING_ONLY);
    expect(await screen.findByText("Reading is not in your plan")).toBeInTheDocument();
    expect(screen.getByText(/Contact the administrator to add it/)).toBeInTheDocument();
    expect(api.questions).not.toHaveBeenCalled();
  });

  it("says a lapsed section expired", async () => {
    renderAt("/reading", READING_LAPSED);
    expect(await screen.findByText("Reading access has expired")).toBeInTheDocument();
  });

  it("shows the server's reason, without signing out, when the stored user is behind the server", async () => {
    const err = Object.assign(new Error("Your Listening access has expired. Contact the administrator to renew it."), { code: "SECTION_EXPIRED" });
    api.questions.mockRejectedValue(err);
    // The stored user still says Listening is active; the server knows it lapsed a minute ago.
    renderAt("/listening?type=write-dictation", LISTENING_ONLY);
    expect(await screen.findByText("This section is locked")).toBeInTheDocument();
    expect(screen.getByText(/Your Listening access has expired/)).toBeInTheDocument();
    expect(localStorage.getItem("pte_token")).toBe("test-token");
  });
});

describe("mock tests — disabled on a partial plan", () => {
  it("disables Start and names what is missing", async () => {
    renderAt("/mock", READING_LAPSED);
    const start = await screen.findByRole("button", { name: "Start Mock Test" });
    expect(start).toBeDisabled();
    expect(screen.getByText(/Mock tests need all four sections active/)).toHaveTextContent(/Reading \(expired/);
    fireEvent.click(start);
    expect(api.testSessions.start).not.toHaveBeenCalled();
  });

  it("stays available on a full plan", async () => {
    renderAt("/mock", student(["speaking", "writing", "reading", "listening"].map(s => row(s, "ACTIVE"))));
    expect(await screen.findByRole("button", { name: "Start Mock Test" })).not.toBeDisabled();
  });
});

describe("header — days left", () => {
  it("names the section running out first when sections end on different dates", async () => {
    renderAt("/practice", student([
      row("speaking", "ACTIVE", 3), row("writing", "ACTIVE", 3),
      row("reading", "ACTIVE", 50), row("listening", "NOT_PURCHASED")
    ], { subscriptionEndDate: iso(50) }));
    expect(await screen.findByText("Speaking: 3 days left")).toBeInTheDocument();
  });

  it("reads exactly as before when every section ends together", async () => {
    renderAt("/practice", student(["speaking", "writing", "reading", "listening"].map(s => row(s, "ACTIVE", 30))));
    expect(await screen.findByText("30 days left")).toBeInTheDocument();
  });
});

describe("search — locked tasks are found but not opened", () => {
  it("marks a locked task and does not navigate to it", async () => {
    renderAt("/practice", LISTENING_ONLY);
    const input = await screen.findByRole("combobox", { name: "Search anything" });
    fireEvent.change(input, { target: { value: "Reorder" } });
    const result = await screen.findByRole("option", { name: /Reorder Paragraph — Reading/ });
    expect(result).toHaveAttribute("aria-disabled", "true");
    expect(result).toHaveTextContent("Not in your plan");
    fireEvent.click(result);
    expect(screen.queryByText("Reading is not in your plan")).not.toBeInTheDocument(); // stayed put
  });
});

describe("study plan — stays inside the plan", () => {
  it("rotates only through open sections and swaps the mock day out", () => {
    const week = buildWeek([], [], [], new Date("2026-11-16T12:00:00Z"), { allowed: ["listening"], mockAvailable: false });
    expect(week.filter(d => d.kind === "mock")).toHaveLength(0);
    expect(week.filter(d => d.kind === "section").every(d => d.section === "listening")).toBe(true);
  });

  it("builds the same week as before with no restriction given", () => {
    const week = buildWeek([], [], [], new Date("2026-11-16T12:00:00Z"));
    expect(week.filter(d => d.kind === "mock")).toHaveLength(1);
    expect(new Set(week.filter(d => d.kind === "section").map(d => d.section)).size).toBe(4);
  });
});

describe("admin — granting sections", () => {
  const ADMIN = { id: "a1", role: "admin", name: "Admin", username: "admin" };

  it("creates a paid account with the sections ticked", async () => {
    api.admin.listUsers.mockResolvedValue({ users: [], total: 0, page: 1, totalPages: 1 });
    api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: {}, paymentStatus: {}, subscription: {} });
    api.admin.getAuditLog.mockResolvedValue({ logs: [], total: 0, page: 1, totalPages: 1 });
    api.admin.createUser.mockResolvedValue({ user: { username: "pte050" }, temporaryPassword: "x1y2z3" });
    renderAt("/admin?tab=users", ADMIN);

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    fireEvent.change(screen.getByPlaceholderText("pte002"), { target: { value: "pte050" } });
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Listener" } });
    // All four start ticked; untick three.
    for (const name of ["Speaking", "Writing", "Reading"]) fireEvent.click(screen.getByRole("checkbox", { name }));
    fireEvent.click(screen.getAllByRole("button", { name: "Create user" }).at(-1));

    await waitFor(() => expect(api.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ username: "pte050", sections: ["listening"] })));
  });

  it("shows each section's own state and adds a purchase for the ones ticked", async () => {
    const u = { ...LISTENING_ONLY, id: "s9", username: "pte009", accountStatus: "ACTIVE", paymentStatus: "PAID", createdAt: iso(-10) };
    api.admin.listUsers.mockResolvedValue({ users: [u], total: 1, page: 1, totalPages: 1 });
    api.admin.getStats.mockResolvedValue({ totalUsers: 1, accountStatus: {}, paymentStatus: {}, subscription: {} });
    api.admin.getAuditLog.mockResolvedValue({ logs: [], total: 0, page: 1, totalPages: 1 });
    api.admin.getUser.mockResolvedValue({ user: u, sessions: [], loginAttempts: [] });
    api.admin.listPurchases.mockResolvedValue({ purchases: [] });
    api.admin.addPurchase.mockResolvedValue({ user: u, purchase: {} });
    renderAt("/admin?tab=users", ADMIN);

    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const sectionsTable = await waitFor(() => {
      const t = document.querySelector(".section-access-table");
      expect(t).not.toBeNull();
      return t;
    });
    expect(within(sectionsTable).getAllByText("Not purchased")).toHaveLength(3);
    expect(within(sectionsTable).getByText("Active")).toBeInTheDocument();

    const form = document.querySelector(".section-purchase-form");
    // Listening is already active: shown, marked, and not something this form can buy again.
    const listening = within(form).getByRole("checkbox", { name: /Listening/ });
    expect(listening).toBeDisabled();
    expect(listening).not.toBeChecked();
    expect(listening.closest("label")).toHaveTextContent("Active");
    expect(within(form).getByRole("checkbox", { name: "Reading" })).not.toBeDisabled();
    fireEvent.click(within(form).getByRole("checkbox", { name: "Reading" }));
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "60" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add purchase" }));

    await waitFor(() => expect(api.admin.addPurchase).toHaveBeenCalledWith("s9", { sections: ["reading"], days: 60, paymentId: undefined }));
  });
});

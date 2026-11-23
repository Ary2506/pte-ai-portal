import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api, endStudentViewSession } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  forceLogout: vi.fn(),
  endStudentViewSession: vi.fn(),
  publicApi: { sharedAnswer: vi.fn(), sharedAnswerAudioUrl: vi.fn() },
  api: {
    auth: { signin: vi.fn(), me: vi.fn(() => Promise.resolve({})), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(), startStudentView: vi.fn(),
      questions: { types: vi.fn(), stats: vi.fn(), list: vi.fn() }
    },
    dashboard: vi.fn(), plan: vi.fn(), activity: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(), ownRecordingSrc: vi.fn(), shareSubmission: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(() => Promise.resolve({ testSessions: [] })), active: vi.fn() }
  }
}));

const ADMIN = { id: "a1", username: "admin", name: "Administrator", role: "admin" };
const STUDENT = { id: "s1", username: "pte001", name: "Student One", role: "student", subscriptionStatus: "ACTIVE",
  subscriptionEndDate: new Date(Date.now() + 20 * 864e5).toISOString() };
const VIEW = { token: "view-pass", expiresAt: new Date(Date.now() + 3600e3).toISOString(), student: STUDENT };

function renderAt(path) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("pte_token", "admin-token");
  localStorage.setItem("pte_user", JSON.stringify(ADMIN));
  api.dashboard.mockResolvedValue({ stats: { overall: 0, practiceCount: 0, targetScore: 79 }, bySection: [], recent: [],
    streak: { currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false }, weeklyActivity: [] });
  api.history.mockResolvedValue({ submissions: [], total: 0, totalPages: 1 });
});
afterEach(() => { sessionStorage.clear(); });

describe("the student website, as an admin sees it", () => {
  it("shows the student's own site, labelled read-only, in a tab holding a view pass", async () => {
    sessionStorage.setItem("pte_student_view", JSON.stringify(VIEW));
    renderAt("/dashboard");
    await waitFor(() => expect(document.querySelector(".student-view-banner")).not.toBeNull());
    expect(document.querySelector(".student-view-banner")).toHaveTextContent("Viewing Student: pte001 — Read Only");
    // The student's navigation, not the admin's.
    const sidebar = document.querySelector(".sidebar");
    expect(within(sidebar).getByRole("link", { name: /PTE Practice/ })).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: /My Results/ })).toBeInTheDocument();
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
    expect(screen.getByText("Exit student view")).toBeInTheDocument();
    // The admin's own sign-in is untouched.
    expect(localStorage.getItem("pte_token")).toBe("admin-token");
    expect(JSON.parse(localStorage.getItem("pte_user")).role).toBe("admin");
  });

  it("keeps admin pages out of reach in the view", async () => {
    sessionStorage.setItem("pte_student_view", JSON.stringify(VIEW));
    renderAt("/admin");
    await waitFor(() => expect(document.querySelector(".student-view-banner")).not.toBeNull());
    expect(api.admin.getStats).not.toHaveBeenCalled();
  });

  function withLocation(run) {
    const assign = vi.fn();
    const original = window.location;
    delete window.location;
    window.location = { ...original, assign, pathname: "/dashboard" };
    return Promise.resolve(run(assign)).finally(() => { window.location = original; });
  }

  it("Back to Admin Panel ends the view on the server, then returns to /admin, signed in as the admin", async () => {
    sessionStorage.setItem("pte_student_view", JSON.stringify(VIEW));
    let finish;
    endStudentViewSession.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await withLocation(async (assign) => {
      renderAt("/dashboard");
      fireEvent.click(await screen.findByRole("button", { name: "Back to Admin Panel" }));
      // Waiting on the server: nothing is claimed yet, and a second press sends nothing more.
      const busy = await screen.findByRole("button", { name: "Ending view…" });
      expect(busy).toBeDisabled();
      fireEvent.click(busy);
      expect(endStudentViewSession).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("pte_student_view")).not.toBeNull();
      expect(assign).not.toHaveBeenCalled();

      finish({ ended: true });
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/admin"));
      expect(sessionStorage.getItem("pte_student_view")).toBeNull();
      expect(localStorage.getItem("pte_token")).toBe("admin-token");
      expect(api.auth.logout).not.toHaveBeenCalled();
    });
  });

  it("Exit student view in the sidebar does the same", async () => {
    sessionStorage.setItem("pte_student_view", JSON.stringify(VIEW));
    endStudentViewSession.mockResolvedValue({ ended: true });
    await withLocation(async (assign) => {
      renderAt("/dashboard");
      fireEvent.click(await screen.findByText("Exit student view"));
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/admin"));
      expect(endStudentViewSession).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("pte_student_view")).toBeNull();
      expect(api.auth.logout).not.toHaveBeenCalled();
    });
  });

  it("if ending the view fails, says so and keeps the view open", async () => {
    sessionStorage.setItem("pte_student_view", JSON.stringify(VIEW));
    endStudentViewSession.mockRejectedValue(new Error("Could not reach the server to end this student view. Check your connection and try again."));
    await withLocation(async (assign) => {
      renderAt("/dashboard");
      fireEvent.click(await screen.findByRole("button", { name: "Back to Admin Panel" }));
      expect(await screen.findByText(/Could not reach the server to end this student view/)).toBeInTheDocument();
      expect(assign).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("pte_student_view")).not.toBeNull();
      expect(document.querySelector(".student-view-banner")).toHaveTextContent("Viewing Student: pte001 — Read Only");
      // The admin can try again.
      expect(screen.getByRole("button", { name: "Back to Admin Panel" })).toBeEnabled();
      expect(localStorage.getItem("pte_token")).toBe("admin-token");
    });
  });

  it("without a view pass the same tab is simply the admin", async () => {
    api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: { active: 0, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 }, subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
    api.admin.getAuditLog.mockResolvedValue({ logs: [] });
    renderAt("/admin");
    await waitFor(() => expect(api.admin.getStats).toHaveBeenCalled());
    expect(document.querySelector(".student-view-banner")).toBeNull();
  });
});

describe("Admin → Users → View", () => {
  function usersPage(admin) {
    localStorage.setItem("pte_user", JSON.stringify(admin));
    api.admin.getStats.mockResolvedValue({ totalUsers: 1, accountStatus: { active: 1, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 1, failed: 0, refunded: 0 }, subscription: { active: 1, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
    api.admin.getAuditLog.mockResolvedValue({ logs: [] });
    api.admin.listUsers.mockResolvedValue({ users: [{ id: "s1", username: "pte001", name: "Student One", role: "student", accountStatus: "ACTIVE", paymentStatus: "PAID", subscriptionStatus: "ACTIVE", sessionStatus: "INACTIVE", sections: [] }], total: 1, page: 1, totalPages: 1 });
    renderAt("/admin");
  }

  it.each([
    ["not permitted by the server", { ...ADMIN, canViewStudents: false }],
    ["with no permission flag at all", ADMIN]
  ])("is not shown to an admin %s", async (_label, admin) => {
    usersPage(admin);
    fireEvent.click(await screen.findByText("Users"));
    expect(await screen.findByText("Manage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View the student website/ })).not.toBeInTheDocument();
  });

  it("opens the student view for that student in a new tab", async () => {
    localStorage.setItem("pte_user", JSON.stringify({ ...ADMIN, canViewStudents: true }));
    api.admin.getStats.mockResolvedValue({ totalUsers: 1, accountStatus: { active: 1, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 1, failed: 0, refunded: 0 }, subscription: { active: 1, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
    api.admin.getAuditLog.mockResolvedValue({ logs: [] });
    api.admin.listUsers.mockResolvedValue({ users: [{ id: "s1", username: "pte001", name: "Student One", role: "student", accountStatus: "ACTIVE", paymentStatus: "PAID", subscriptionStatus: "ACTIVE", sessionStatus: "INACTIVE", sections: [] }], total: 1, page: 1, totalPages: 1 });
    api.admin.startStudentView.mockResolvedValue(VIEW);
    const tab = { location: { href: "" }, close: vi.fn(), opener: "x" };
    const open = vi.spyOn(window, "open").mockReturnValue(tab);
    renderAt("/admin");
    fireEvent.click(await screen.findByText("Users"));
    fireEvent.click(await screen.findByRole("button", { name: "View the student website as pte001 (read only)" }));
    await waitFor(() => expect(tab.location.href).toMatch(/^\/student-view#/));
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(api.admin.startStudentView).toHaveBeenCalledWith("s1");
    expect(tab.opener).toBeNull();
    expect(JSON.parse(decodeURIComponent(tab.location.href.split("#")[1])).student.username).toBe("pte001");
    open.mockRestore();
  });
});

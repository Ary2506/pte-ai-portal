import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
function adminAuthUser() { return { role: "admin", name: "Admin", username: "admin" }; }
function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

// All four issued as "reading" mcq-single questions — a valid stand-in for exercising Mock's
// own timer/navigation/confirmation/expiry logic without re-testing each task component's own
// submit flow (already covered by writing.test.jsx/speaking.test.jsx).
function mockQuestions() {
  return [0, 1, 2, 3].map(i => ({
    _id: `q${i}`, section: "reading", type: "mcq-single", title: `Reading Q${i + 1}`,
    prompt: "Choose the best answer.", options: ["A", "B"], evaluationType: "objective"
  }));
}

function startedSession(msFromNow = 20 * 60 * 1000) {
  return {
    testSession: { _id: "ts1", status: "IN_PROGRESS", totalQuestions: 4, expiresAt: new Date(Date.now() + msFromNow).toISOString() },
    questions: mockQuestions()
  };
}

function objectiveResult(overrides = {}) {
  return { _id: "sub1", score: 1, maxScore: 1, evaluationType: "objective", feedback: { correct: true, feedback: [] }, ...overrides };
}

async function answerCurrentQuestion() {
  const optionA = (await screen.findAllByText("A"))[0];
  fireEvent.click(optionA);
  fireEvent.click(screen.getByText("Submit Answer"));
  await waitFor(() => expect(screen.getByText(/Correct!|Not quite\./)).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  api.dashboard.mockResolvedValue({ stats: { overall: 0, practiceCount: 0, streak: 0, targetScore: 79 }, bySection: [], recent: [] });
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("Mock test — countdown timer", () => {
  it("renders a countdown once the mock starts", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());

    fireEvent.click(await screen.findByText("Start Mock Test"));
    expect(await screen.findByText("Time Remaining")).toBeInTheDocument();
    expect(await screen.findByText("20:00")).toBeInTheDocument();
  });

  it("counts down as real time (simulated) elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());

    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("20:00");

    await vi.advanceTimersByTimeAsync(61 * 1000);
    expect(await screen.findByText("18:59")).toBeInTheDocument();
  });

  it("stops ticking after the component unmounts — no interval left running", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.testSessions.start.mockResolvedValue(startedSession());
    const { unmount } = renderAt("/mock", studentAuthUser());

    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("20:00");
    unmount();

    await vi.advanceTimersByTimeAsync(20 * 60 * 1000 + 5000);
    // If the interval were still running it would have fired the auto-submit complete() call.
    expect(api.testSessions.complete).not.toHaveBeenCalled();
  });
});

describe("Mock test — question overview and navigation", () => {
  it("renders one overview entry per issued question", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));

    await screen.findByText("Question 1 of 4");
    for (let i = 1; i <= 4; i++) expect(screen.getByRole("button", { name: String(i) })).toBeInTheDocument();
  });

  it("marks the current question and updates answered/unanswered state as questions are answered", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    api.submit.mockResolvedValue({ submission: objectiveResult() });
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    const q1Button = screen.getByRole("button", { name: "1" });
    expect(q1Button.className).toContain("current");
    expect(q1Button.className).not.toContain("answered");

    await answerCurrentQuestion();
    // Still the current question right after answering it — "current" takes priority over
    // "answered" in the overview's own state while it's the one on screen.
    expect(screen.getByRole("button", { name: "1" }).className).toContain("current");

    // Jumping via the overview only ever indexes into the four questions already on screen.
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    await screen.findByText("Question 2 of 4");
    expect(screen.getByRole("button", { name: "1" }).className).toContain("answered");
    expect(screen.getByRole("button", { name: "2" }).className).toContain("current");
    expect(screen.getByRole("button", { name: "3" }).className).toContain("unanswered");
  });

  it("lets Next advance past an unanswered question, matching the overview strip's own free navigation", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    // Question 1 is never answered here — Next must still be enabled and work.
    expect(screen.getByText("Next ›")).not.toBeDisabled();
    fireEvent.click(screen.getByText("Next ›"));
    await screen.findByText("Question 2 of 4");
    expect(screen.getByRole("button", { name: "1" }).className).toContain("unanswered");
  });
});

describe("Mock test — finish confirmation", () => {
  it("shows a confirmation dialog instead of completing immediately", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    expect(await screen.findByText("Finish mock test?")).toBeInTheDocument();
    expect(api.testSessions.complete).not.toHaveBeenCalled();
  });

  it("warns about unanswered questions in the confirmation copy", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    expect(await screen.findByText(/You still have unanswered questions\./)).toBeInTheDocument();
  });

  it("cancel closes the dialog and never calls complete", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    await screen.findByText("Finish mock test?");
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.queryByText("Finish mock test?")).not.toBeInTheDocument());
    expect(api.testSessions.complete).not.toHaveBeenCalled();
  });

  it("only calls complete once the dialog is confirmed", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    api.testSessions.complete.mockResolvedValue({ testSession: { status: "COMPLETED", totalScore: 2, totalMaxScore: 4, sectionScores: [{ section: "reading", score: 2, maxScore: 4 }] } });
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    await screen.findByText("Finish mock test?");
    fireEvent.click(screen.getAllByText("Finish Test")[1]); // the confirm-panel's button, not the trigger

    await waitFor(() => expect(api.testSessions.complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Practice Score")).toBeInTheDocument();
  });
});

describe("Mock test — expiry", () => {
  it("auto-submits exactly once when the countdown reaches zero, and shows the expired state cleanly", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.testSessions.start.mockResolvedValue(startedSession(2000));
    api.testSessions.complete.mockRejectedValue(Object.assign(new Error("Your allotted test time has ended."), { code: "TEST_SESSION_EXPIRED" }));
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    await vi.advanceTimersByTimeAsync(2500);
    expect(await screen.findByText("Mock Test Expired")).toBeInTheDocument();
    expect(screen.getByText(/Your allotted test time has ended\. Your test can no longer accept answers\./)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(10000);
    expect(api.testSessions.complete).toHaveBeenCalledTimes(1); // never retried automatically
  });

  it("never shows a fabricated score when the server rejects the auto-submit as expired", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.testSessions.start.mockResolvedValue(startedSession(1000));
    api.testSessions.complete.mockRejectedValue(Object.assign(new Error("expired"), { code: "TEST_SESSION_EXPIRED" }));
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    await vi.advanceTimersByTimeAsync(1500);
    await screen.findByText("Mock Test Expired");
    expect(screen.queryByText("Practice Score")).not.toBeInTheDocument();
  });
});

describe("Mock test — duplicate completion", () => {
  it("shows a dedicated already-completed state instead of a generic error", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    api.testSessions.complete.mockRejectedValue(Object.assign(new Error("already completed"), { code: "SESSION_ALREADY_COMPLETED" }));
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    await screen.findByText("Finish mock test?");
    fireEvent.click(screen.getAllByText("Finish Test")[1]);

    expect(await screen.findByText("This Test Was Already Completed")).toBeInTheDocument();
  });
});

describe("Mock test — progress bar", () => {
  it("reflects the current question position and updates on Next, Previous, and overview navigation", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemin", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(bar).toHaveAttribute("aria-valuetext", "Question 1 of 4"); // never relies on color alone

    fireEvent.click(screen.getByText("Next ›"));
    await screen.findByText("Question 2 of 4");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");

    fireEvent.click(screen.getByRole("button", { name: "1" })); // overview navigation
    await screen.findByText("Question 1 of 4");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });
});

describe("Mock test — Finish button loading state", () => {
  it("shows 'Finishing...' while completion is in flight, and prevents a second completion request", async () => {
    let resolveComplete;
    api.testSessions.start.mockResolvedValue(startedSession());
    api.testSessions.complete.mockReturnValue(new Promise(res => { resolveComplete = res; }));
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    await screen.findByText("Finish mock test?");
    fireEvent.click(screen.getAllByText("Finish Test")[1]);

    const finishingButton = await screen.findByText("Finishing...");
    expect(finishingButton).toBeDisabled();
    fireEvent.click(finishingButton); // clicking a disabled button fires nothing
    expect(api.testSessions.complete).toHaveBeenCalledTimes(1);

    resolveComplete({ testSession: { status: "COMPLETED", totalScore: 1, totalMaxScore: 4, sectionScores: [{ section: "reading", score: 1, maxScore: 4 }] } });
    expect(await screen.findByText("Practice Score")).toBeInTheDocument();
  });

  it("restores the normal Finish Test label if completion fails with a generic error", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    api.testSessions.complete.mockRejectedValue(new Error("Network error"));
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    await screen.findByText("Finish mock test?");
    fireEvent.click(screen.getAllByText("Finish Test")[1]);

    await waitFor(() => expect(api.testSessions.complete).toHaveBeenCalledTimes(1));
    const restoredButton = await screen.findByText("Finish Test");
    expect(restoredButton).not.toBeDisabled();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });
});

describe("Mock test — accessible state announcements", () => {
  it("announces finishing and completion politely, without interrupting", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    api.testSessions.complete.mockResolvedValue({ testSession: { status: "COMPLETED", totalScore: 1, totalMaxScore: 4, sectionScores: [{ section: "reading", score: 1, maxScore: 4 }] } });
    const { container } = renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    await screen.findByText("Finish mock test?");
    fireEvent.click(screen.getAllByText("Finish Test")[1]);

    await screen.findByText("Practice Score");
    const politeRegion = container.querySelector('[aria-live="polite"]');
    expect(politeRegion.textContent).toBe("Your mock test has been completed and scored.");
  });

  it("announces expiry assertively", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.testSessions.start.mockResolvedValue(startedSession(1000));
    api.testSessions.complete.mockRejectedValue(Object.assign(new Error("expired"), { code: "TEST_SESSION_EXPIRED" }));
    const { container } = renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    await vi.advanceTimersByTimeAsync(1500);
    await screen.findByText("Mock Test Expired");
    // Both the timer's own "time is up" announcement and finish()'s subsequent server-rejection
    // announcement fire in sequence (two real, separate state updates a screen reader would
    // announce one after the other) — asserting the final, most specific one here.
    const assertiveRegion = container.querySelector('[aria-live="assertive"]');
    expect(assertiveRegion.textContent).toBe("Your test session has expired.");
  });

  it("does not spam an announcement on every timer tick — only once when crossing the low-time threshold", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.testSessions.start.mockResolvedValue(startedSession(5 * 60 * 1000)); // 5 minutes, so it crosses the 2-minute mark mid-test
    const { container } = renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    await vi.advanceTimersByTimeAsync(100 * 1000); // 200s remaining — still above the 2-minute threshold
    const politeRegion = container.querySelector('[aria-live="polite"]');
    expect(politeRegion.textContent).toBe("");

    await vi.advanceTimersByTimeAsync(90 * 1000); // 110s remaining — now under the 2-minute threshold
    expect(politeRegion.textContent).toBe("Less than 2 minutes remaining.");
  });
});

describe("Mock test — admin is unaffected by the student subscription-logout timer", () => {
  it("an admin starting a mock gets its own test-session timer, with no forced logout from the subscription timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: { active: 0, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 }, subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
    api.admin.getAuditLog.mockResolvedValue({ logs: [] });
    api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", adminAuthUser());

    fireEvent.click(await screen.findByText("Start Mock Test"));
    expect(await screen.findByText("20:00")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    // Still on the mock, still logged in — the (admin-exempt) subscription-expiry logout timer
    // from useAuth never fires for an admin, and it is a separate mechanism from this timer.
    expect(localStorage.getItem("pte_token")).toBe("test-token");
    expect(screen.getByText("Time Remaining")).toBeInTheDocument();
  });
});

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
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
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
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
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
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(api.testSessions.complete).not.toHaveBeenCalled();
  });

  it("says how many were attempted, and what leaving the rest behind costs", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Submit with questions unanswered?");
    expect(dialog).toHaveTextContent("You have attempted 0 of 4 questions");
    expect(dialog).toHaveTextContent("score nothing");
    expect(dialog).toHaveTextContent("Are you sure you want to submit?");
  });

  it("cancel closes the dialog and never calls complete", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.testSessions.complete).not.toHaveBeenCalled();
  });

  it("only calls complete once the dialog is confirmed", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    api.testSessions.complete.mockResolvedValue({ testSession: { status: "COMPLETED", totalScore: 2, totalMaxScore: 4, sectionScores: [{ section: "reading", score: 2, maxScore: 4 }] } });
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));
    await screen.findByText("Question 1 of 4");

    fireEvent.click(screen.getByText("Finish Test"));
    await screen.findByRole("dialog");
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
    await screen.findByRole("dialog");
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

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Question 2 of 4");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");

    fireEvent.click(screen.getByRole("button", { name: "1" })); // overview navigation
    await screen.findByText("Question 1 of 4");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });
});

describe("Mock test — Finish sits with the clock", () => {
  it("is in the status row beside the timer, and there is only one of it", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByText("Question 1 of 4");

    const finishButtons = screen.getAllByRole("button", { name: "Finish Test" });
    expect(finishButtons).toHaveLength(1);
    // Beside the clock, not at the foot of the page — at eighty questions the bottom of the page
    // is a long scroll from wherever the student is reading.
    expect(finishButtons[0].closest(".mock-progress-bar")).toBeTruthy();
    expect(finishButtons[0].closest(".mock-progress-bar__end").querySelector(".mock-timer")).toBeTruthy();
    expect(finishButtons[0].closest(".mock-nav")).toBeNull();
  });

  it("takes the primary tier on the last question, where finishing is the way forward", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByText("Question 1 of 4");

    expect(screen.getByRole("button", { name: "Finish Test" }).className).toContain("btn--tertiary");

    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText(`Question ${i + 2} of 4`);
    }

    // Next is gone on the last question; Finish is promoted in its place, still beside the clock.
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    const finish = screen.getByRole("button", { name: "Finish Test" });
    expect(finish.className).toContain("btn--primary");
    expect(screen.getAllByRole("button", { name: "Finish Test" })).toHaveLength(1);
  });
});

describe("Mock test — where the question overview lives", () => {
  it("sits in the mock's own right-hand column, beside the question rather than above it", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByText("Question 1 of 4");

    const overview = document.querySelector(".mock-qnav");
    expect(overview).toBeTruthy();
    // A sibling of the task, in the mock's own grid — NOT inside the task subtree, which is
    // keyed by question id and so is torn down and rebuilt on every Next.
    expect(overview.closest(".mock-layout")).toBeTruthy();
    expect(overview.closest(".mock-layout__main")).toBeNull();
    expect(overview.closest(".task-layout")).toBeNull();
  });

  it("still numbers every question by its position in the whole test", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByText("Question 1 of 4");

    const numbers = [...document.querySelectorAll(".mock-qnav-item")].map(b => b.textContent);
    expect(numbers).toEqual(["1", "2", "3", "4"]);
  });
});

describe("Mock test — the overview survives moving between questions", () => {
  it("keeps the very same DOM node across Next, so it cannot flicker or jump", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByText("Question 1 of 4");

    const before = document.querySelector(".mock-qnav");
    const firstButton = before.querySelector(".mock-qnav-item");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Question 2 of 4");

    // Identity, not equality: a remounted panel would be a different element, which is what made
    // the list rebuild on every question when it lived inside the keyed task subtree.
    expect(document.querySelector(".mock-qnav")).toBe(before);
    expect(before.querySelector(".mock-qnav-item")).toBe(firstButton);
  });

  it("still moves the current-question highlight", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByText("Question 1 of 4");

    const items = () => [...document.querySelectorAll(".mock-qnav-item")];
    expect(items()[0].className).toContain("current");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Question 2 of 4");
    expect(items()[0].className).not.toContain("current");
    expect(items()[1].className).toContain("current");
  });
});

describe("Mock test — no coaching during a scored exam", () => {
  it("hides the tips panel, which ordinary practice shows", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByText("Question 1 of 4");

    expect(document.querySelector(".panel.tips")).toBeNull();
    // The overview is still there, in the mock's own column.
    expect(document.querySelector(".mock-layout > .mock-qnav")).toBeTruthy();
  });

  it("hides the writing composition panel too — the rail holds the overview and nothing else", async () => {
    api.testSessions.start.mockResolvedValue({
      testSession: { _id: "ts2", status: "IN_PROGRESS", totalQuestions: 1, expiresAt: new Date(Date.now() + 9e5).toISOString() },
      questions: [{ _id: "w1", section: "writing", type: "swt", title: "Summarize Written Text",
        prompt: "Summarize in one sentence.", passage: "A passage.", evaluationType: "subjective" }]
    });
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByPlaceholderText("Type your answer here...");

    expect(document.querySelector(".compose-panel")).toBeNull();
    expect(document.querySelector(".panel.tips")).toBeNull();
    expect(document.querySelector(".mock-layout > .mock-qnav")).toBeTruthy();
  });

  it("still enforces and reports the character cap with the panel hidden", async () => {
    api.testSessions.start.mockResolvedValue({
      testSession: { _id: "ts3", status: "IN_PROGRESS", totalQuestions: 1, expiresAt: new Date(Date.now() + 9e5).toISOString() },
      questions: [{ _id: "w2", section: "writing", type: "swt", title: "Summarize Written Text",
        prompt: "Summarize in one sentence.", passage: "A passage.", evaluationType: "subjective" }]
    });
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    const textarea = await screen.findByPlaceholderText("Type your answer here...");

    // Hiding the readout must not mean losing the limit. SWT caps at 500 characters, spaces
    // excluded, and the cap is a hard block: input that would exceed it is refused outright
    // rather than silently truncated.
    fireEvent.change(textarea, { target: { value: "a".repeat(500) } });
    expect(textarea.value.length).toBe(500);
    fireEvent.change(textarea, { target: { value: "a".repeat(501) } });
    expect(textarea.value.length).toBe(500); // the 501st character never lands

    // ...and the counter that replaces the panel says so.
    const counter = document.querySelector(".compose-inline");
    expect(counter).toBeTruthy();
    expect(counter.textContent).toContain("500");
    expect(counter.textContent).toContain("limit reached");
  });

  it("leaves the tips panel in place for the same task outside a mock", async () => {
    api.questions.mockResolvedValue({ questions: [{
      _id: "r1", section: "reading", type: "mcq-single", title: "Reading Q1",
      prompt: "Choose the best answer.", options: ["A", "B"], evaluationType: "objective"
    }] });
    renderAt("/reading?type=mcq-single", studentAuthUser());

    await screen.findByText("Choose the best answer.");
    expect(document.querySelector(".panel.tips")).toBeTruthy();
  });
});

describe("Mock test — confirming a completed test", () => {
  it("still asks before submitting when every question has been attempted", async () => {
    api.testSessions.start.mockResolvedValue(startedSession());
    api.submit.mockResolvedValue({ submission: objectiveResult() });
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
    await screen.findByText("Question 1 of 4");

    for (let i = 0; i < 4; i++) {
      await answerCurrentQuestion();
      if (i < 3) {
        fireEvent.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByText(`Question ${i + 2} of 4`);
      }
    }

    fireEvent.click(screen.getByText("Finish Test"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Submit your test?");
    expect(dialog).toHaveTextContent("You have attempted all 4 questions");
    expect(dialog).toHaveTextContent("Are you sure you want to submit?");
    // Nothing is submitted until the student confirms, finished or not.
    expect(api.testSessions.complete).not.toHaveBeenCalled();
  });
});

// Each task component keeps the student's answer and its result in its own state, so moving to
// the next question has to give React a reason to build a fresh instance.
//
// Writing was the one that leaked: question 25 opened holding question 24's typed answer and its
// AI evaluation. Reading and Listening happened to survive on a useEffect keyed to question._id
// that clears their state, and Speaking was already keyed — but all four are covered here,
// because "it works for a different reason" is not the same as "it is tested".
describe("Mock test — a question never inherits the previous one's answer", () => {
  function sessionOf(questions) {
    return {
      testSession: { _id: "ts-leak", status: "IN_PROGRESS", totalQuestions: questions.length,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() },
      questions
    };
  }

  async function startAt(questions) {
    api.testSessions.start.mockResolvedValue(sessionOf(questions));
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByRole("button", { name: "Start Mock Test" }));
  }

  it("writing: the next question opens with an empty editor and no evaluation", async () => {
    await startAt([0, 1].map(i => ({
      _id: `w${i}`, section: "writing", type: "swt", title: "Summarize Written Text",
      prompt: `Summarize passage ${i + 1}.`, passage: `Passage ${i + 1}.`, evaluationType: "subjective"
    })));
    api.submit.mockResolvedValue({
      submission: { _id: "sub-w1", score: 60, maxScore: 90, evaluationType: "subjective",
        evaluationStatus: "COMPLETED", scoringMethod: "heuristic",
        feedback: { strengths: [], improvements: [], overall: "Question 1's writing feedback." } }
    });

    const textarea = await screen.findByPlaceholderText("Type your answer here...");
    fireEvent.change(textarea, { target: { value: "My summary of the first passage." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for AI Feedback" }));
    expect(await screen.findByText("Question 1's writing feedback.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Summarize passage 2.");
    expect(screen.getByPlaceholderText("Type your answer here...").value).toBe("");
    expect(screen.queryByText("Question 1's writing feedback.")).not.toBeInTheDocument();
    expect(screen.queryByText("My summary of the first passage.")).not.toBeInTheDocument();
  });

  it("reading: the next question opens with nothing selected and no result", async () => {
    await startAt([0, 1].map(i => ({
      _id: `r${i}`, section: "reading", type: "mcq-single", title: `Reading Q${i + 1}`,
      prompt: `Choose for passage ${i + 1}.`, options: ["A", "B"], evaluationType: "objective"
    })));
    api.submit.mockResolvedValue({ submission: objectiveResult() });

    await screen.findByText("Choose for passage 1.");
    fireEvent.click((await screen.findAllByText("A"))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));
    await waitFor(() => expect(screen.getByText(/Correct!|Not quite\./)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Choose for passage 2.");
    expect(screen.queryByText(/Correct!|Not quite\./)).not.toBeInTheDocument();
    for (const radio of document.querySelectorAll('input[type="radio"]')) {
      expect(radio.checked).toBe(false);
    }
  });

  it("listening: the next question opens with nothing selected and no result", async () => {
    await startAt([0, 1].map(i => ({
      _id: `l${i}`, section: "listening", type: "mcq-single", title: `Listening Q${i + 1}`,
      prompt: `Listen and choose ${i + 1}.`, options: ["A", "B"],
      audioUrl: `https://example.com/clip-${i + 1}.mp3`, evaluationType: "objective"
    })));
    api.submit.mockResolvedValue({ submission: objectiveResult() });

    await screen.findByText("Listen and choose 1.");
    fireEvent.click((await screen.findAllByText("A"))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByText(/Correct!|Not quite\./)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Listen and choose 2.");
    expect(screen.queryByText(/Correct!|Not quite\./)).not.toBeInTheDocument();
    for (const radio of document.querySelectorAll('input[type="radio"]')) {
      expect(radio.checked).toBe(false);
    }
    // The new question's own clip, not the previous one's.
    expect(document.querySelector("audio.audio").getAttribute("src")).toBe("https://example.com/clip-2.mp3");
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
    await screen.findByRole("dialog");
    fireEvent.click(screen.getAllByText("Finish Test")[1]);

    // Matched by role: the label lives in a <span> inside the button now, so findByText would
    // hand back the span rather than the control whose disabled state this asserts.
    const finishingButton = await screen.findByRole("button", { name: "Finishing..." });
    expect(finishingButton).toBeDisabled();
    expect(finishingButton).toHaveAttribute("aria-busy", "true");
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
    await screen.findByRole("dialog");
    fireEvent.click(screen.getAllByText("Finish Test")[1]);

    await waitFor(() => expect(api.testSessions.complete).toHaveBeenCalledTimes(1));
    const restoredButton = await screen.findByText("Finish Test");
    expect(restoredButton).not.toBeDisabled();
    // The failure is a toast now: the test is still on screen and still finishable, so the
    // message belongs beside the page rather than pushing the question layout around.
    expect(screen.getByText("Network error").closest(".toast")).toHaveClass("toast-error");
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
    await screen.findByRole("dialog");
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

// Regression test for a real bug: <SpeakingTaskModule> was rendered in Mock.jsx with no `key`
// prop, so when two speaking questions appeared back to back in one mock test, React reused the
// same component instance across both — its internal `result` state (the just-submitted AI
// feedback for question 1) survived into question 2's render even though question 2's own
// prompt/audio correctly updated, i.e. exactly "question N shown, but the answer/result on screen
// belongs to question N-1". Fixed by keying the element on `q._id` (matching how PracticeTask
// already keys the same component outside Mock), which forces a full remount — and therefore a
// full state reset — on every question change. This test fails on the un-keyed render and passes
// once it's keyed.
describe("Mock test — speaking question identity (result must not leak between questions)", () => {
  function speakingMockQuestions() {
    return [
      { _id: "rts-1", section: "speaking", type: "respond-to-situation", title: "RTS #51 — Italian Food",
        prompt: "Situation one: your friends want Italian food.", answer: "Model answer for situation one.",
        audioUrl: "/audio/respond-to-situation/respond-to-situation-01.wav", evaluationType: "subjective" },
      { _id: "rts-2", section: "speaking", type: "respond-to-situation", title: "RTS #52 — Dinner with Colleague",
        prompt: "Situation two: you feel too ill for dinner plans.", answer: "Model answer for situation two.",
        audioUrl: "/audio/respond-to-situation/respond-to-situation-02.wav", evaluationType: "subjective" }
    ];
  }

  beforeEach(() => {
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }))
    };
    global.MediaRecorder = class {
      constructor(stream) { this.stream = stream; }
      start() { this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
      stop() { this.onstop?.(); }
    };
  });

  it("clears question 1's AI result when navigating to question 2, and shows question 2's own prompt/audio", async () => {
    api.testSessions.start.mockResolvedValue({
      testSession: { _id: "ts-speaking", status: "IN_PROGRESS", totalQuestions: 2, expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() },
      questions: speakingMockQuestions()
    });
    api.submit.mockResolvedValue({
      submission: { _id: "sub-rts-1", score: 72, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED",
        scoringMethod: "heuristic", feedback: { strengths: ["Clear response"], improvements: [], overall: "Question 1's feedback.", note: "n", scoringMethod: "heuristic" } }
    });
    renderAt("/mock", studentAuthUser());
    fireEvent.click(await screen.findByText("Start Mock Test"));

    // Answer question 1.
    expect(await screen.findByText("Situation one: your friends want Italian food.")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("Start Recording"));
    await screen.findByText("Stop Recording");
    fireEvent.click(screen.getByText("Stop Recording"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for AI Feedback" })).not.toBeDisabled());
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    expect(await screen.findByText("Question 1's feedback.")).toBeInTheDocument();

    // Move to question 2 — its own prompt/audio must show, and question 1's result must be gone.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Situation two: you feel too ill for dinner plans.")).toBeInTheDocument();
    expect(screen.queryByText("Question 1's feedback.")).not.toBeInTheDocument();
    expect(screen.getByText("Record your answer")).toBeInTheDocument();
    expect(screen.getByText("Start Recording")).toBeInTheDocument();
    const audioEl = document.querySelector("audio.audio");
    expect(audioEl.getAttribute("src")).toBe("/audio/respond-to-situation/respond-to-situation-02.wav");
  });
});

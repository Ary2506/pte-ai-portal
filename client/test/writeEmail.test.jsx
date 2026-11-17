import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";
import Writing from "../src/practice/Writing.jsx";
// The real data the importer loads, extracted page by page from write-email-samples.pdf, so these
// tests exercise the 12 actual questions rather than a stand-in.
import BANK from "../../server/src/data/writeEmail.json";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn()
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
function renderAt(path) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(studentAuthUser()));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

// As GET /api/questions returns them: one row per page, in page order.
const QUESTIONS = BANK.map((q) => ({
  _id: `we${q.number}`, section: "writing", type: "write-email", evaluationType: "subjective",
  title: q.title, prompt: q.prompt, answer: q.answer
}));
// The Write Email layout titles each question "#<n> <title>", n being its PDF page.
const heading = () => document.querySelector(".email-practice__title h3")?.textContent;
const titled = (q) => `#${q.number} ${q.title}`;
const timerText = () => screen.getByRole("timer").textContent.trim();
const elapse = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const textarea = () => screen.getByPlaceholderText("Type your answer here...");
const words = (n) => Array.from({ length: n }, () => "word").join(" ");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], shouldAdvanceTime: false });
  api.questions.mockResolvedValue({ questions: QUESTIONS });
  api.history.mockResolvedValue({ submissions: [] });
});
afterEach(() => { vi.useRealTimers(); });

const rows = () => [...document.querySelectorAll(".question-list-row")].map((row) => ({
  number: row.querySelector(".question-row-number")?.textContent.trim(),
  title: row.querySelector(".question-list-title")?.textContent
}));

// The list shows ten rows a page, so a question is reached the way a student finds one by name:
// through the list's search box.
async function open(title) {
  renderAt("/writing?type=write-email");
  await screen.findByText("Moving Furniture");
  fireEvent.change(screen.getByPlaceholderText("Search by title or question number..."), { target: { value: title } });
  fireEvent.click((await screen.findByText(title)).closest("button"));
  await screen.findByPlaceholderText("Type your answer here...");
}

describe("Write Email — 12 native questions from the source PDF", () => {
  it("lists all 12 questions in page order, numbered #1–#12, each under its own PDF title", async () => {
    // No countdown here, and testing-library's waits poll on setInterval, which the fake clock
    // above freezes; with it, this test only passed when the DOM happened to settle in time.
    vi.useRealTimers();
    renderAt("/writing?type=write-email");
    await screen.findByText("Moving Furniture");
    expect(api.questions).toHaveBeenCalledWith("writing", "write-email");
    const firstPage = rows();
    expect(firstPage).toHaveLength(10);
    // The list's pager: rows 11–12 are on page 2. It is disabled while progress is still loading.
    const next = screen.getByText("Next").closest("button");
    await waitFor(() => expect(next).not.toBeDisabled());
    fireEvent.click(next);
    await screen.findByText("Party Suggestions");
    const all = [...firstPage, ...rows()];
    expect(all.map((r) => r.title)).toEqual(BANK.map((q) => q.title));
    expect(all.map((r) => r.number)).toEqual(BANK.map((q) => `#${q.number}`));
    // No PDF viewer any more.
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByText("Download PDF")).not.toBeInTheDocument();
  });

  it.each(BANK.map((q) => [q.number, q.title]))("question %i (%s) shows its full scenario and every bullet point", async (number, title) => {
    const q = BANK[number - 1];
    await open(title);
    expect(heading()).toBe(titled(q));
    const prompt = document.querySelector(".email-practice .email-prompt");
    const [intro, ...points] = q.prompt.split("\n");
    expect(prompt.querySelector("p").textContent).toBe(intro);
    // Each point on its own line, written "- point" as the exam shows it.
    expect([...prompt.querySelectorAll(".email-prompt__point")].map((p) => p.textContent))
      .toEqual(points.map((p) => p.replace(/^• /, "- ")));
  });

  it("runs a 9-minute countdown from the moment the question appears", async () => {
    await open("Moving Furniture");
    expect(timerText()).toBe("Remain: 09:00");
    elapse(61_000);
    expect(timerText()).toBe("Remain: 07:59");
    elapse(8 * 60_000);
    expect(screen.getByRole("timer")).toHaveTextContent("Time's up");
  });

  it("counts only in the Composition panel: there is no second word count under the answer box", async () => {
    await open("Moving Furniture");
    expect(document.querySelector(".email-practice")).not.toHaveTextContent("Word Count");
    fireEvent.change(textarea(), { target: { value: words(95) } });
    expect(document.getElementById("writing-words")).toHaveTextContent("95/200");
    expect(document.querySelector(".email-practice")).not.toHaveTextContent("Word Count");
  });

  it("has the Composition panel beside the question, as Summarize Written Text does: 80–120 target, words out of 200, characters, sentences", async () => {
    await open("Moving Furniture");
    const panel = document.querySelector(".task-rail .compose-panel");
    expect(panel).toHaveTextContent("Composition");
    expect(panel.querySelector("h3")).toHaveTextContent("Write Email");
    expect(panel.querySelector(".compose-target__head")).toHaveTextContent("Word target80–120");
    expect(panel).toHaveTextContent("80 more words to reach the minimum.");
    fireEvent.change(textarea(), { target: { value: "Dear Jim. " + words(98) + "." } });
    expect(document.getElementById("writing-words")).toHaveTextContent("100/200");
    expect(panel).toHaveTextContent("Within the target range.");
    expect(panel.querySelector(".compose-stats")).toHaveTextContent(/Sentences\s*2/);
  });

  it("stops accepting new words at the 200-word limit, but always lets the answer be shortened", async () => {
    await open("Moving Furniture");
    fireEvent.change(textarea(), { target: { value: words(200) } });
    expect(document.getElementById("writing-words")).toHaveTextContent("200/200");
    expect(screen.getByText("You have reached the 200-word limit.")).toBeInTheDocument();
    // A 201st word is refused, typed or pasted.
    fireEvent.change(textarea(), { target: { value: `${words(200)} extra` } });
    expect(textarea().value.split(" ")).toHaveLength(200);
    fireEvent.change(textarea(), { target: { value: words(250) } });
    expect(textarea().value.split(" ")).toHaveLength(200);
    // Removing words always works.
    fireEvent.change(textarea(), { target: { value: words(150) } });
    expect(document.getElementById("writing-words")).toHaveTextContent("150/200");
    expect(screen.queryByText("You have reached the 200-word limit.")).not.toBeInTheDocument();
  });

  it("shows the Write Email tips in the rail", async () => {
    await open("Moving Furniture");
    expect(document.querySelector(".task-rail")).toHaveTextContent("Cover every bullet point you were given.");
  });

  it("lays the page out like the exam: instructions, #n title, timer, prompt, box, then Submit/Re-do/Answer beside Previous/Next", async () => {
    await open("Movie Invitation");
    const page = document.querySelector(".email-practice");
    expect(page.querySelector(".email-practice__intro")).toHaveTextContent("You will have 9 minutes. You should aim to write 80 - 120 words.");
    const all = [...page.querySelectorAll("*")];
    const order = [".email-practice__intro", ".email-practice__title", ".email-practice__remain", ".email-prompt",
      ".email-practice__answer", ".email-practice__actions"]
      .map((sel) => all.indexOf(page.querySelector(sel)));
    expect(order.every((pos) => pos >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const actions = page.querySelector(".email-practice__actions");
    expect(actions.querySelector(".email-practice__actions-main")).toHaveTextContent(/Submit.*Re-do.*Answer/);
    expect(actions.querySelector(".email-practice__actions-nav")).toHaveTextContent(/Previous.*Next/);
    // The shared navigation bar above the question is not shown for Write Email.
    expect(document.querySelector(".btn-bar")).toBeNull();
    // Back to list stays reachable.
    fireEvent.click(screen.getByText("Back to list"));
    expect(await screen.findByText("Moving Furniture")).toBeInTheDocument();
  });

  it("Next and Previous walk through all 12 questions in order, restarting the timer each time", async () => {
    await open("Moving Furniture");
    for (let i = 1; i < 12; i += 1) {
      elapse(30_000);
      fireEvent.click(screen.getByText("Next"));
      await waitFor(() => expect(heading()).toBe(titled(BANK[i])));
      expect(timerText()).toBe("Remain: 09:00");
    }
    expect(screen.getByText("Next").closest("button")).toBeDisabled();
    for (let i = 10; i >= 0; i -= 1) {
      fireEvent.click(screen.getByText("Previous"));
      await waitFor(() => expect(heading()).toBe(titled(BANK[i])));
    }
    expect(screen.getByText("Previous").closest("button")).toBeDisabled();
  });

  it("submits through the existing submission API as a write-email answer for that question", async () => {
    api.submit.mockResolvedValue({ submission: {
      _id: "s1", score: 72, maxScore: 90, evaluationType: "subjective", evaluationStatus: "COMPLETED", scoringMethod: "ai",
      feedback: { strengths: ["Covers all three points"], improvements: [], overall: "Clear email.", note: null, scoringMethod: "ai" }
    } });
    await open("Lost Bag");
    fireEvent.change(textarea(), { target: { value: words(90) } });
    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    const form = api.submit.mock.calls[0][0];
    expect(form.get("section")).toBe("writing");
    expect(form.get("type")).toBe("write-email");
    expect(form.get("questionId")).toBe("we4");
    expect(form.get("transcript")).toBe(words(90));
    expect(await screen.findByText("Covers all three points")).toBeInTheDocument();
    // Scored: the timer is put away and the answer is locked.
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(textarea()).toBeDisabled();
  });

  it("Re-do clears the answer and gives the full nine minutes again", async () => {
    await open("Stairs Light");
    fireEvent.change(textarea(), { target: { value: words(40) } });
    elapse(200_000);
    fireEvent.click(screen.getByText("Re-do"));
    expect(textarea()).toHaveValue("");
    expect(timerText()).toBe("Remain: 09:00");
  });

  it("the Answer switch reveals that page's sample email, line breaks intact, and hides it again", async () => {
    await open("Party Suggestions");
    expect(document.querySelector(".email-sample")).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    const sample = document.querySelector(".answer-reveal .email-sample");
    expect(sample.textContent).toBe(BANK[11].answer);
    expect(sample.textContent.endsWith("Best regards,\nDhruv")).toBe(true);
    fireEvent.click(screen.getByRole("switch"));
    expect(document.querySelector(".email-sample")).toBeNull();
  });
});

// Once these questions are live, a Mock Test's writing section can draw one. Mock renders the
// standard Writing layout (and passes the question title as `type`), so that path must hold too.
describe("Write Email inside a Mock Test", () => {
  it("renders in the standard layout with no practice timer, and files the answer as write-email", async () => {
    api.submit.mockResolvedValue({ submission: { _id: "m1", evaluationStatus: "PENDING", evaluationType: "subjective", score: 0, maxScore: 90 } });
    const q = QUESTIONS[0];
    render(<Writing type={q.title} question={q} testSessionId="session1" onAnswered={() => {}} />);
    expect(document.querySelector(".email-practice")).toBeNull();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect([...document.querySelectorAll(".email-prompt .email-prompt__point")]).toHaveLength(3);
    fireEvent.change(textarea(), { target: { value: words(90) } });
    fireEvent.click(screen.getByText("Submit for AI Feedback"));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    const form = api.submit.mock.calls[0][0];
    expect(form.get("type")).toBe("write-email");
    expect(form.get("testSessionId")).toBe("session1");
  });
});

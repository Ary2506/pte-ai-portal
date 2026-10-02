import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// Reading & Writing: Fill in the Blanks. Each blank has its own dropdown, which is what separates
// it from fill-blanks (one blank, one option list) and fill-blanks-dragdrop (many blanks, one
// shared word bank). These tests cover the two states: choosing, and the marked-up passage after
// it has been scored.

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn()
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function studentAuthUser() { return { role: "student", name: "Student", username: "pte001" }; }
function renderAt(path) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(studentAuthUser()));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

// The stored shape: blanks live inside `content`, each with its own options. `answer` is withheld
// from the browser until the attempt is scored, so it is deliberately absent here.
const QUESTION = {
  _id: "fib1", section: "reading", type: "fib-dropdown", title: "Resultant Force",
  prompt: "Choose the word that best completes each blank.",
  evaluationType: "objective", maxScore: 2,
  content: [
    { type: "text", value: "The overall result of two or " },
    { type: "blank", options: ["any", "less", "some", "more"] },
    { type: "text", value: " forces acting on an object is called the resultant force. If the forces are " },
    { type: "blank", options: ["equal", "unequal", "opposite", "parallel"] },
    { type: "text", value: ", they balance each other." }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.history.mockResolvedValue({ submissions: [] });
  api.questions.mockResolvedValue({ questions: [QUESTION] });
});

async function open() {
  renderAt("/reading?type=fib-dropdown");
  await screen.findByText("Resultant Force");
}

// Submit only enables once every blank has a value, and the state update that flips it is
// asynchronous. Clicking before then is silently ignored, which is a race every one of these
// tests would otherwise run — so the wait lives here rather than in each of them.
// Choosing retries until the value sticks. On a cold first render the component initialises its
// per-blank state in a mount effect, and a change fired between the first paint and that effect
// is overwritten by it — so a lone fireEvent.change can silently do nothing. A real user cannot
// click faster than that first effect, so retrying reproduces their experience rather than
// masking a defect they could actually hit.
async function chooseBlank(label, optionIndex) {
  const select = screen.getByLabelText(label);
  await waitFor(() => {
    fireEvent.change(select, { target: { value: String(optionIndex) } });
    expect(select.value).toBe(String(optionIndex));
  });
}

async function submitAnswer() {
  const button = screen.getByRole("button", { name: "Submit Answer" });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
}

describe("Fill in the Blanks (Dropdown) — answering", () => {
  it("renders one dropdown per blank, inline in the passage", async () => {
    await open();
    expect(screen.getByLabelText("Blank 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Blank 2")).toBeInTheDocument();
    expect(document.querySelectorAll(".dropdown-blank select").length).toBe(2);
  });

  it("gives each blank its own options rather than one shared pool", async () => {
    await open();
    const first = [...screen.getByLabelText("Blank 1").options].map(o => o.textContent);
    const second = [...screen.getByLabelText("Blank 2").options].map(o => o.textContent);
    expect(first).toEqual(expect.arrayContaining(["any", "less", "some", "more"]));
    expect(first).not.toEqual(expect.arrayContaining(["unequal"]));
    expect(second).toEqual(expect.arrayContaining(["equal", "unequal", "opposite", "parallel"]));
  });

  it("keeps Submit disabled until every blank has been chosen", async () => {
    await open();
    const submit = screen.getByRole("button", { name: "Submit Answer" });
    expect(submit).toBeDisabled();
    await chooseBlank("Blank 1", 3);
    expect(submit).toBeDisabled(); // one of two
    await chooseBlank("Blank 2", 0);
    expect(submit).not.toBeDisabled();
  });

  it("submits one option index per blank, in passage order", async () => {
    await open();
    api.submit.mockResolvedValue({ submission: { score: 2, maxScore: 2, evaluationType: "objective", feedback: { correct: true } } });
    await chooseBlank("Blank 1", 3);
    await chooseBlank("Blank 2", 0);
    await submitAnswer();

    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    const sent = api.submit.mock.calls[0][0];
    expect(JSON.parse(sent.get("answer"))).toEqual([3, 0]);
    expect(sent.get("type")).toBe("fib-dropdown");
  });
});

describe("Fill in the Blanks (Dropdown) — after scoring", () => {
  it("marks each blank in place: wrong in red with the answer beside it, right in green", async () => {
    await open();
    // Blank 1 answered wrongly (picked "less", answer is "more"), blank 2 correctly.
    api.submit.mockResolvedValue({
      submission: {
        score: 1, maxScore: 2, evaluationType: "objective",
        feedback: { correct: false, correctIndexes: [3, 0], correctAnswerText: "more, equal", feedback: ["1 of 2 blanks are correct."] }
      }
    });
    await chooseBlank("Blank 1", 1);
    await chooseBlank("Blank 2", 0);
    await submitAnswer();

    await screen.findByText(/1 of 2 blanks are correct/);
    expect(document.querySelectorAll(".dropdown-blank.is-wrong").length).toBe(1);
    expect(document.querySelectorAll(".dropdown-blank.is-right").length).toBe(1);
    // The correction sits next to the blank it belongs to, not in a list below the passage.
    expect(screen.getByText("(Answer: more)")).toBeInTheDocument();
    expect(screen.getByText("(Answer: equal)")).toBeInTheDocument();
  });

  it("shows no marking before the attempt is scored, since the key has not been sent yet", async () => {
    await open();
    await chooseBlank("Blank 1", 3);
    expect(document.querySelectorAll(".dropdown-blank.is-right, .dropdown-blank.is-wrong").length).toBe(0);
    expect(screen.queryByText(/\(Answer:/)).not.toBeInTheDocument();
  });

  it("locks the dropdowns once scored so an answer cannot be changed after the fact", async () => {
    await open();
    api.submit.mockResolvedValue({
      submission: { score: 2, maxScore: 2, evaluationType: "objective", feedback: { correct: true, correctIndexes: [3, 0], correctAnswerText: "more, equal" } }
    });
    await chooseBlank("Blank 1", 3);
    await chooseBlank("Blank 2", 0);
    await submitAnswer();

    await waitFor(() => expect(screen.getByLabelText("Blank 1")).toBeDisabled());
    expect(screen.getByLabelText("Blank 2")).toBeDisabled();
  });
});

describe("Fill in the Blanks (Dropdown) — the unchosen state", () => {
  it("offers only the real words in the list, with no blank row to pick", async () => {
    await open();
    const visible = [...screen.getByLabelText("Blank 1").options].filter(o => !o.hidden);
    expect(visible.map(o => o.textContent)).toEqual(["any", "less", "some", "more"]);
  });

  it("starts empty rather than preselecting the first word", async () => {
    await open();
    // A preselected option would both look answered and let Submit enable on a choice the
    // student never made.
    expect(screen.getByLabelText("Blank 1").value).toBe("");
    expect(screen.getByRole("button", { name: "Submit Answer" })).toBeDisabled();
  });
});

describe("Fill in the Blanks (Dropdown) — Re-do", () => {
  it("clears every dropdown back to unchosen, before submitting", async () => {
    await open();
    await chooseBlank("Blank 1", 1);
    await chooseBlank("Blank 2", 2);
    expect(screen.getByRole("button", { name: "Submit Answer" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Re-do" }));

    await waitFor(() => expect(screen.getByLabelText("Blank 1").value).toBe(""));
    expect(screen.getByLabelText("Blank 2").value).toBe("");
    // Nothing chosen means nothing to submit.
    expect(screen.getByRole("button", { name: "Submit Answer" })).toBeDisabled();
  });

  it("clears the marking and the selections after an answer has been scored", async () => {
    await open();
    api.submit.mockResolvedValue({
      submission: {
        score: 1, maxScore: 2, evaluationType: "objective",
        feedback: { correct: false, correctIndexes: [3, 0], correctAnswerText: "more, equal", feedback: ["1 of 2 blanks are correct."] }
      }
    });
    await chooseBlank("Blank 1", 1);
    await chooseBlank("Blank 2", 0);
    await submitAnswer();
    await screen.findByText(/1 of 2 blanks are correct/);
    expect(document.querySelectorAll(".dropdown-blank.is-wrong").length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Re-do" }));

    await waitFor(() => expect(screen.getByLabelText("Blank 1").value).toBe(""));
    expect(document.querySelectorAll(".dropdown-blank.is-right, .dropdown-blank.is-wrong").length).toBe(0);
    expect(screen.queryByText(/\(Answer:/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Blank 1")).not.toBeDisabled();
  });
});

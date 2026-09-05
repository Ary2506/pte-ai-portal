import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  api.history.mockResolvedValue({ submissions: [] });
});

describe("Phase 20 — Fill in the Blanks, inline dropdown (reading)", () => {
  it("renders the blank as a real <select> inside the sentence, not a separate option list", async () => {
    api.questions.mockResolvedValue({
      questions: [{ _id: "fb1", section: "reading", type: "fill-blanks", title: "FIB", prompt: "Choose the word.", passage: "The committee will ____ the proposal.", options: ["review", "ignore", "reject"] }]
    });
    renderAt("/reading?type=fill-blanks", studentAuthUser());
    await screen.findByText("FIB");
    const select = document.querySelector(".fill-blank-inline select");
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/The committee will/)).toBeInTheDocument();
    // Not rendered as the generic radio-option list.
    expect(document.querySelector(".options")).not.toBeInTheDocument();
  });
});

describe("Phase 20 — Fill in the Blanks, Drag and Drop (reading)", () => {
  const DRAG_Q = {
    _id: "dfd1", section: "reading", type: "fill-blanks-dragdrop", title: "Drag Fill", prompt: "Drag the words into the blanks.",
    passage: "The ____ sat on the ____.", options: ["cat", "mat", "dog"]
  };

  it("places a word by click-select-then-click-blank (the keyboard-accessible path), and submits the correct answer array", async () => {
    api.questions.mockResolvedValue({ questions: [DRAG_Q] });
    api.submit.mockResolvedValue({
      submission: { _id: "s1", score: 2, maxScore: 2, evaluationType: "objective", evaluationStatus: "COMPLETED", feedback: { correct: true, feedback: ["All blanks filled correctly!"] } }
    });
    renderAt("/reading?type=fill-blanks-dragdrop", studentAuthUser());
    await screen.findByText("Drag Fill");
    // The word pool only appears once the placement state (set in a useEffect) has flushed —
    // wait for it rather than assuming it's there synchronously right after the title renders.
    fireEvent.click(await screen.findByText("cat"));
    const blanks = document.querySelectorAll(".drag-fill-blank");
    expect(blanks.length).toBe(2);
    fireEvent.click(blanks[0]);
    expect(blanks[0]).toHaveTextContent("cat");

    // Select "mat" and place it into the second blank.
    fireEvent.click(screen.getByText("mat"));
    fireEvent.click(blanks[1]);
    expect(blanks[1]).toHaveTextContent("mat");

    // "dog" (the decoy) remains in the pool, unplaced.
    expect(screen.getByText("dog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Submit Answer"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    const sentAnswer = JSON.parse(api.submit.mock.calls[0][0].get("answer"));
    expect(sentAnswer).toEqual([0, 1]); // cat=index0, mat=index1, in blank order
    expect(await screen.findByText("Correct!")).toBeInTheDocument();
  });

  it("clicking a filled blank clears it back to the word pool", async () => {
    api.questions.mockResolvedValue({ questions: [DRAG_Q] });
    renderAt("/reading?type=fill-blanks-dragdrop", studentAuthUser());
    await screen.findByText("Drag Fill");

    fireEvent.click(await screen.findByText("cat"));
    const blanks = document.querySelectorAll(".drag-fill-blank");
    fireEvent.click(blanks[0]);
    expect(blanks[0]).toHaveTextContent("cat");
    // "cat" now appears only inside the filled blank, not as a pool chip — "mat" and "dog" remain.
    expect(document.querySelectorAll(".drag-fill-chip")).toHaveLength(2);
    expect([...document.querySelectorAll(".drag-fill-chip")].some(el => el.textContent === "cat")).toBe(false);

    fireEvent.click(blanks[0]); // clear it
    expect([...document.querySelectorAll(".drag-fill-chip")].some(el => el.textContent === "cat")).toBe(true); // back in the pool
  });

  it("keeps Submit disabled until every blank is filled", async () => {
    api.questions.mockResolvedValue({ questions: [DRAG_Q] });
    renderAt("/reading?type=fill-blanks-dragdrop", studentAuthUser());
    await screen.findByText("Drag Fill");
    expect(screen.getByText("Submit Answer")).toBeDisabled();

    fireEvent.click(await screen.findByText("cat"));
    fireEvent.click(document.querySelectorAll(".drag-fill-blank")[0]);
    expect(screen.getByText("Submit Answer")).toBeDisabled(); // second blank still empty

    fireEvent.click(screen.getByText("mat"));
    fireEvent.click(document.querySelectorAll(".drag-fill-blank")[1]);
    expect(screen.getByText("Submit Answer")).not.toBeDisabled();
  });
});

describe("Phase 20 — Highlight Incorrect Words (listening)", () => {
  it("renders the transcript's words as clickable toggle buttons and submits the selected indices", async () => {
    const q = { _id: "hiw1", section: "listening", type: "highlight-incorrect-words", title: "Highlight", prompt: "Click the wrong words.", audioUrl: "https://example.com/clip.mp3", options: ["The", "cat", "sta", "on", "the", "mot"], evaluationType: "objective" };
    api.questions.mockResolvedValue({ questions: [q] });
    api.submit.mockResolvedValue({
      submission: { _id: "s2", score: 2, maxScore: 2, evaluationType: "objective", evaluationStatus: "COMPLETED", feedback: { correct: true, feedback: [] } }
    });
    renderAt("/listening?type=highlight-incorrect-words", studentAuthUser());
    await screen.findByText("Highlight");

    expect(document.querySelector('audio[src="https://example.com/clip.mp3"]')).toBeInTheDocument();
    const words = document.querySelectorAll(".highlight-word");
    expect(words.length).toBe(6);

    fireEvent.click(screen.getByText("sta"));
    fireEvent.click(screen.getByText("mot"));
    expect(screen.getByText("sta")).toHaveClass("selected");

    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => expect(api.submit).toHaveBeenCalled());
    const sentAnswer = JSON.parse(api.submit.mock.calls[0][0].get("answer"));
    expect(sentAnswer.sort()).toEqual([2, 5]);
  });
});

describe("Phase 22 — Listening Fill in the Blanks shows the blanked passage alongside the audio", () => {
  it("renders question.passage (previously invisible in ListeningTask) so the blank is actually readable", async () => {
    api.questions.mockResolvedValue({
      questions: [{
        _id: "lfb1", section: "listening", type: "fill-blanks", title: "Library Hours",
        prompt: "Listen to the recording, then choose the word that correctly completes the sentence.",
        passage: "The library closes early on ____.", audioUrl: "https://example.com/lib.mp3",
        options: ["Sundays", "Mondays", "Wednesdays", "Fridays"], evaluationType: "objective"
      }]
    });
    renderAt("/listening?type=fill-blanks", studentAuthUser());
    await screen.findByText("Library Hours");
    expect(document.querySelector('audio[src="https://example.com/lib.mp3"]')).toBeInTheDocument();
    expect(screen.getByText("The library closes early on ____.")).toBeInTheDocument();
    expect(screen.getByText("Sundays")).toBeInTheDocument();
  });
});

describe("Phase 20 — Select Missing Word (listening) reuses the choice UI with audio", () => {
  it("renders as a radio-option list with the question's audio", async () => {
    api.questions.mockResolvedValue({
      questions: [{ _id: "smw1", section: "listening", type: "select-missing-word", title: "Missing Word", prompt: "Select the missing word.", audioUrl: "https://example.com/mw.mp3", options: ["quickly", "slowly", "never"], evaluationType: "objective" }]
    });
    renderAt("/listening?type=select-missing-word", studentAuthUser());
    await screen.findByText("Missing Word");
    expect(document.querySelector('audio[src="https://example.com/mw.mp3"]')).toBeInTheDocument();
    expect(document.querySelector(".options")).toBeInTheDocument();
    expect(screen.getByText("quickly")).toBeInTheDocument();
  });
});

describe("Phase 20 — Respond to a Situation (speaking) reuses SpeakingTask with its audio prompt", () => {
  it("renders the situation audio alongside the recording controls", async () => {
    api.questions.mockResolvedValue({
      questions: [{ _id: "sit1", section: "speaking", type: "respond-to-situation", title: "Situation", prompt: "Respond appropriately.", audioUrl: "https://example.com/situation.mp3" }]
    });
    renderAt("/speaking?type=respond-to-situation", studentAuthUser());
    await screen.findByText("Situation");
    expect(document.querySelector('audio[src="https://example.com/situation.mp3"]')).toBeInTheDocument();
    expect(screen.getByText("Start Recording")).toBeInTheDocument();
  });
});

describe("Phase 20 — Write Email (writing) reuses WritingTask", () => {
  it("renders a text editor for the email prompt", async () => {
    api.questions.mockResolvedValue({
      questions: [{ _id: "em1", section: "writing", type: "write-email", title: "Email Task", prompt: "Write an email requesting leave." }]
    });
    renderAt("/writing?type=write-email", studentAuthUser());
    await screen.findByText("Email Task");
    expect(screen.getByPlaceholderText("Type your answer here...")).toBeInTheDocument();
  });
});

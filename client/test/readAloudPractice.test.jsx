import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";
import readAloudJson from "../content/speaking/read-aloud/read_aloud.json";

// Read Aloud no longer has a component of its own. Its questions live in the question bank like
// every other speaking task and render through Speaking.jsx, so the flow tests here drive that
// shared component rather than a dedicated one. read_aloud.json survives as the *authoring*
// source — server/src/migrateReadAloudToDb.js syncs it into MongoDB — which is why its integrity
// is still worth asserting even though the client no longer reads it.

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
function renderAt(path, user) {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

// The shape migrateReadAloudToDb.js writes: instruction in `prompt`, text to read in `passage`.
function dbReadAloud(n, overrides = {}) {
  return {
    _id: `ra${n}`,
    section: "speaking",
    type: "read-aloud",
    title: `Read Aloud ${n}`,
    prompt: "Read the passage aloud. You have 60 seconds.",
    passage: `Passage number ${n} to be read aloud by the student.`,
    answer: `Model answer ${n}.`,
    evaluationType: "subjective",
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.history.mockResolvedValue({ submissions: [] });
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }))
  };
  global.MediaRecorder = class {
    constructor(stream) { this.stream = stream; }
    start() { this.ondataavailable?.({ data: new Blob(["fake-audio-bytes"], { type: "audio/webm" }) }); }
    stop() { this.onstop?.(); }
  };
  // jsdom doesn't implement the Blob object-URL APIs — real browsers always do; only the test
  // environment needs a stand-in so Replay Recording can be exercised here.
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("read_aloud.json — still the authoring source for the question bank", () => {
  it("has no duplicate ids, so every entry maps to exactly one database row", () => {
    const ids = readAloudJson.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry carries the fields the migration requires", () => {
    readAloudJson.forEach(q => {
      expect(q.id).toBeDefined();
      expect(typeof q.title).toBe("string");
      expect(q.title.trim()).not.toBe("");
      expect(typeof q.question).toBe("string"); // becomes `passage` in the bank
      expect(q.question.trim()).not.toBe("");
      expect(q.type).toBe("Read Aloud");
    });
  });

  it("currently contains the 111 specified questions, in the given order", () => {
    expect(readAloudJson.length).toBe(111);
    expect(readAloudJson[0].title).toBe("Language Appearance");
    expect(readAloudJson[14].title).toBe("Community Gardening"); // last of the original 15
    expect(readAloudJson[15].title).toBe("Visit to Canada"); // first of the 96 added from client PDFs
    expect(readAloudJson[readAloudJson.length - 1].title).toBe("Shakespeare");
  });
});

describe("Read Aloud through the shared Speaking task", () => {
  async function openFirstQuestion(questions) {
    api.questions.mockResolvedValue({ questions });
    renderAt("/speaking?type=read-aloud", studentAuthUser());
    fireEvent.click(await screen.findByText(questions[0].title));
    // The question position is a readout split across elements ("Question <b>1</b> / 2"), so it
    // is matched on its container rather than as one text node.
    return waitFor(() =>
      expect(document.querySelector(".btn-bar__position")?.textContent).toMatch(/Question\s*1\s*\//));
  }

  it("fetches from the question bank — no bundled content path any more", async () => {
    await openFirstQuestion([dbReadAloud(1), dbReadAloud(2)]);
    expect(api.questions).toHaveBeenCalledWith("speaking", "read-aloud");
  });

  it("renders the text to read in its own passage block, not as the instruction line", async () => {
    await openFirstQuestion([dbReadAloud(1), dbReadAloud(2)]);
    const passage = document.querySelector(".passage");
    expect(passage).toBeInTheDocument();
    expect(passage).toHaveTextContent("Passage number 1 to be read aloud");
    // The instruction stays separate, so the two are never conflated.
    expect(screen.getByText(/Read the passage aloud/)).toBeInTheDocument();
  });

  it("reveals the model answer on demand, and hides it again", async () => {
    await openFirstQuestion([dbReadAloud(1), dbReadAloud(2)]);
    expect(document.querySelector(".answer-reveal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show Answer"));
    await screen.findByText("Hide Answer");
    expect(document.querySelector(".answer-reveal")).toHaveTextContent("Model answer 1.");
    fireEvent.click(screen.getByText("Hide Answer"));
    expect(document.querySelector(".answer-reveal")).not.toBeInTheDocument();
  });

  it("shows Read Aloud's own tips, not the generic speaking ones", async () => {
    await openFirstQuestion([dbReadAloud(1), dbReadAloud(2)]);
    expect(screen.getByText("Read Aloud tips")).toBeInTheDocument();
    expect(screen.getByText(/Use natural intonation/)).toBeInTheDocument();
  });

  it("offers Replay Recording only once something has been recorded", async () => {
    await openFirstQuestion([dbReadAloud(1), dbReadAloud(2)]);
    expect(screen.queryByText("Replay Recording")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Start Recording"));
    await screen.findByText("Stop Recording");
    fireEvent.click(screen.getByText("Stop Recording"));

    expect(await screen.findByText("Replay Recording")).toBeInTheDocument();
  });

  it("ends on a completion summary rather than a dead-ended Next button", async () => {
    await openFirstQuestion([dbReadAloud(1), dbReadAloud(2)]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(document.querySelector(".btn-bar__position")?.textContent).toMatch(/Question\s*2\s*\//));

    // Last question: Next has become Finish.
    fireEvent.click(screen.getByText("Finish"));
    await screen.findByText("Practice complete");
    expect(screen.getByText(/0 of 2 answered/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back to list"));
    await waitFor(() => expect(screen.getByText("Read Aloud 1")).toBeInTheDocument());
  });
});

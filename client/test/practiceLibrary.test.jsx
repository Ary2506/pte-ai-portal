import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// The Practice Hub became a library: search, section and status filters, and per-task progress
// derived from the student's own attempts. The rows themselves are unchanged — practiceHub
// .test.jsx still pins their semantics — so these cover only what the library layer adds.

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })), history: vi.fn(), submit: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  },
  forceLogout: vi.fn()
}));

const QUESTIONS = {
  speaking: [{ _id: "s1", type: "read-aloud", title: "Read Aloud Q" }, { _id: "s2", type: "read-aloud", title: "Read Aloud Q2" }],
  writing: [{ _id: "w1", type: "essay", title: "Essay Q" }],
  reading: [{ _id: "r1", type: "mcq-single", title: "MCQ Q" }],
  listening: [{ _id: "l1", type: "write-dictation", title: "Dictation Q" }]
};

// The hub paints once before the question bank resolves, so a progress assertion has to wait for
// that load — otherwise it reads the row's pre-load "No content yet" state.
async function readAloudRow() {
  await waitFor(() => expect(api.questionIndex).toHaveBeenCalledTimes(4));
  let row;
  await waitFor(() => {
    row = screen.getByText("Read Aloud").closest(".practice-row");
    expect(row).not.toHaveTextContent("No content yet");
  });
  return row;
}

function renderHub() {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "S", username: "pte001" }));
  return render(<MemoryRouter initialEntries={["/practice"]}><App /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.questionIndex.mockImplementation((section) => Promise.resolve({ questions: QUESTIONS[section] || [] }));
  api.questions.mockImplementation((section) => Promise.resolve({ questions: QUESTIONS[section] || [] }));
  api.history.mockResolvedValue({ submissions: [], total: 0 });
});

describe("library totals are counted, not asserted", () => {
  it("counts the questions that actually exist", async () => {
    renderHub();
    await screen.findByText("Questions available");
    const strip = document.querySelector(".library-summary");
    // 2 speaking + 1 writing + 1 reading + 1 listening.
    expect(strip).toHaveTextContent("5");
  });

  it("counts a section larger than the per-request document cap", async () => {
    // The hub used to count by fetching every question of a section in FULL, which is capped at
    // 200 documents. Speaking had 365 active and Reading 344, so the library reported 560 of the
    // 869 questions that existed, and the ones past the cap were invisible to it. The count must
    // equal what the database holds — not a cap, and not a number written into the page.
    const many = (section, type, n) =>
      Array.from({ length: n }, (_, i) => ({ _id: `${section}-${i}`, type, title: `${section} ${i}` }));
    const BIG = {
      speaking: many("speaking", "read-aloud", 365),
      reading: many("reading", "mcq-single", 344),
      listening: many("listening", "write-dictation", 137),
      writing: many("writing", "essay", 23)
    };
    api.questionIndex.mockImplementation((section) => Promise.resolve({ questions: BIG[section] || [] }));

    renderHub();
    await screen.findByText("Questions available");
    await waitFor(() => {
      const metric = screen.getByText("Questions available").closest(".metric");
      expect(metric).toHaveTextContent("869");
    });
    // The figure a capped fetch would have produced must not appear.
    expect(screen.getByText("Questions available").closest(".metric")).not.toHaveTextContent("560");
  });

  it("counts every question once, even when a section mixes task types", async () => {
    api.questionIndex.mockImplementation((section) => Promise.resolve({
      questions: section === "speaking"
        ? [
            ...Array.from({ length: 183 }, (_, i) => ({ _id: `rs${i}`, type: "repeat-sentence", title: `RS ${i}` })),
            ...Array.from({ length: 132 }, (_, i) => ({ _id: `ra${i}`, type: "read-aloud", title: `RA ${i}` }))
          ]
        : []
    }));

    renderHub();
    await screen.findByText("Questions available");
    await waitFor(() => {
      const metric = screen.getByText("Questions available").closest(".metric");
      expect(metric).toHaveTextContent("315"); // 183 + 132, summed across types
    });
  });

  it("shows a dash rather than 0% average before anything is scored", async () => {
    renderHub();
    await screen.findByText("Practice average");
    const metric = screen.getByText("Practice average").closest(".metric");
    expect(metric.querySelector(".metric-empty")).not.toBeNull();
  });
});

describe("per-task progress comes from the student's own attempts", () => {
  it("marks a task in progress when some of its questions are done", async () => {
    api.history.mockResolvedValue({
      submissions: [{
        _id: "a1", section: "speaking", type: "read-aloud", score: 8, maxScore: 10,
        evaluationStatus: "COMPLETED", createdAt: new Date().toISOString(), question: { _id: "s1" }
      }], total: 1
    });
    renderHub();
    const row = await readAloudRow();
    expect(row).toHaveTextContent("In progress");
    expect(row).toHaveTextContent("1 attempt");
    expect(row).toHaveTextContent("avg 80");
  });

  it("only says Completed once every question of that type has been attempted", async () => {
    const base = {
      section: "speaking", type: "read-aloud", score: 8, maxScore: 10,
      evaluationStatus: "COMPLETED", createdAt: new Date().toISOString()
    };
    api.history.mockResolvedValue({
      submissions: [
        { ...base, _id: "a1", question: { _id: "s1" } },
        { ...base, _id: "a2", question: { _id: "s2" } }
      ], total: 2
    });
    renderHub();
    const row = await readAloudRow();
    expect(row).toHaveTextContent("Completed");
  });

  it("does not call a type complete just because one question was re-done many times", async () => {
    const base = {
      section: "speaking", type: "read-aloud", score: 8, maxScore: 10,
      evaluationStatus: "COMPLETED", createdAt: new Date().toISOString(), question: { _id: "s1" }
    };
    api.history.mockResolvedValue({
      submissions: [1, 2, 3, 4, 5].map(n => ({ ...base, _id: `a${n}` })), total: 5
    });
    renderHub();
    const row = await readAloudRow();
    expect(row).toHaveTextContent("In progress");
    expect(row).not.toHaveTextContent("Completed");
    expect(row).toHaveTextContent("5 attempts");
  });
});

describe("filters", () => {
  it("narrows to one section", async () => {
    renderHub();
    await screen.findByText("Read Aloud");
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(screen.queryByText("Read Aloud")).not.toBeInTheDocument());
    expect(screen.getByText("Multiple Choice Single")).toBeInTheDocument();
  });

  it("searches task labels", async () => {
    renderHub();
    await screen.findByText("Read Aloud");
    fireEvent.change(screen.getByLabelText("Search task types"), { target: { value: "essay" } });
    await waitFor(() => expect(screen.queryByText("Read Aloud")).not.toBeInTheDocument());
    expect(screen.getByText("Write Essay")).toBeInTheDocument();
  });

  it("explains an empty result instead of showing a blank panel", async () => {
    renderHub();
    await screen.findByText("Read Aloud");
    fireEvent.change(screen.getByLabelText("Search task types"), { target: { value: "zzzz" } });
    expect(await screen.findByText("No task types match these filters")).toBeInTheDocument();
  });

  it("offers no status filter — the status is shown on each row instead", async () => {
    renderHub();
    await screen.findByText("Read Aloud");
    for (const label of ["Any status", "Not started", "In progress", "Completed"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    // The per-row status itself stays: it is information, not a control.
    expect(document.querySelector(".practice-row-status")).not.toBeNull();
  });
});

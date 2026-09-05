import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn(),
      questions: {
        types: vi.fn(), stats: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn()
      }
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

function adminAuthUser() { return { role: "admin", name: "Admin", username: "admin" }; }
function renderAdminQuestions() {
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(adminAuthUser()));
  const view = render(<MemoryRouter initialEntries={["/admin"]}><App /></MemoryRouter>);
  return view;
}

const TYPES = [
  { type: "mcq-single", label: "Multiple Choice (single answer)", evaluationType: "objective", shape: "choice-single", sections: ["reading", "listening"] },
  { type: "reorder", label: "Re-order Paragraphs", evaluationType: "objective", shape: "reorder", sections: ["reading"] },
  { type: "essay", label: "Essay", evaluationType: "subjective", shape: "prompt-only", sections: ["writing"] }
];

function questionRow(overrides = {}) {
  return {
    _id: "q1", title: "Renewable energy passage", section: "reading", type: "mcq-single",
    evaluationType: "objective", difficulty: "easy", active: true, createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function fullQuestion(overrides = {}) {
  return {
    _id: "q1", title: "Renewable energy passage", section: "reading", type: "mcq-single",
    prompt: "What is the benefit?", options: ["A", "B", "C"], answer: 1, explanation: "Because B.",
    evaluationType: "objective", maxScore: 1, difficulty: "easy", active: true, createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.admin.getStats.mockResolvedValue({ totalUsers: 0, accountStatus: { active: 0, blocked: 0, suspended: 0 }, paymentStatus: { pending: 0, paid: 0, failed: 0, refunded: 0 }, subscription: { active: 0, expired: 0, notActivated: 0, expiringWithin7Days: 0 } });
  api.admin.getAuditLog.mockResolvedValue({ logs: [] });
  api.admin.questions.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, bySection: {}, byEvaluationType: {}, byDifficulty: {} });
  api.admin.questions.types.mockResolvedValue({ types: TYPES });
  api.admin.questions.list.mockResolvedValue({ data: [questionRow()], page: 1, limit: 20, total: 1, totalPages: 1 });
  api.admin.questions.get.mockResolvedValue({ question: fullQuestion() });
});

async function openQuestionsTab() {
  renderAdminQuestions();
  fireEvent.click(await screen.findByText("Questions"));
  await screen.findByText("Question bank");
}

describe("admin question table", () => {
  it("renders the question table with real data", async () => {
    await openQuestionsTab();
    expect(await screen.findByText("Renewable energy passage")).toBeInTheDocument();
    expect(screen.getByText("reading")).toBeInTheDocument();
  });

  it("shows a loading state, then an empty state when no questions match", async () => {
    api.admin.questions.list.mockResolvedValue({ data: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    await openQuestionsTab();
    expect(await screen.findByText("No questions match these filters.")).toBeInTheDocument();
  });

  it("shows an error state when the list request fails", async () => {
    api.admin.questions.list.mockRejectedValue(new Error("Network error"));
    await openQuestionsTab();
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });
});

describe("search, filters, and pagination", () => {
  it("sends the search term to the API", async () => {
    await openQuestionsTab();
    const input = await screen.findByPlaceholderText(/Search by title/);
    fireEvent.change(input, { target: { value: "renewable" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.admin.questions.list).toHaveBeenCalledWith(expect.objectContaining({ search: "renewable" })));
  });

  it("re-queries when the section filter changes", async () => {
    await openQuestionsTab();
    fireEvent.change(await screen.findByLabelText("Filter by section"), { target: { value: "listening" } });
    await waitFor(() => expect(api.admin.questions.list).toHaveBeenCalledWith(expect.objectContaining({ section: "listening" })));
  });

  it("requests the next page", async () => {
    api.admin.questions.list.mockResolvedValueOnce({ data: [questionRow()], page: 1, limit: 20, total: 40, totalPages: 2 });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("Next ›"));
    await waitFor(() => expect(api.admin.questions.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });
});

describe("create form", () => {
  it("renders the create form with dynamic fields for the selected type", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    expect(await screen.findByText("Options")).toBeInTheDocument(); // mcq-single is the default reading type
  });

  it("changes the visible fields when the question type changes to essay", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "writing" } });
    await waitFor(() => expect(screen.queryByText("Options")).not.toBeInTheDocument());
  });

  it("shows a validation error returned by the server", async () => {
    api.admin.questions.create.mockRejectedValue(Object.assign(new Error("At least 2 options are required."), { code: "VALIDATION_ERROR" }));
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByPlaceholderText("Short internal name for this question"), { target: { value: "Bad Q" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Pick one" } });
    fireEvent.click(screen.getByText("Save question"));
    expect(await screen.findByText("At least 2 options are required.")).toBeInTheDocument();
  });

  it("creates a question successfully", async () => {
    api.admin.questions.create.mockResolvedValue({ question: fullQuestion({ title: "New MCQ" }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByPlaceholderText("Short internal name for this question"), { target: { value: "New MCQ" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Pick one" } });
    fireEvent.click(screen.getByText("Save question"));
    await waitFor(() => expect(api.admin.questions.create).toHaveBeenCalled());
  });

  it("Phase 20: shows the passage/word-pool/blank-assignment fields for Fill in the Blanks (Drag and Drop), and submits the right payload shape", async () => {
    api.admin.questions.types.mockResolvedValue({
      types: [...TYPES, { type: "fill-blanks-dragdrop", label: "Fill in the Blanks (Drag and Drop)", evaluationType: "objective", shape: "drag-fill", sections: ["reading"] }]
    });
    api.admin.questions.create.mockResolvedValue({ question: fullQuestion({ title: "Drag Fill Q", type: "fill-blanks-dragdrop" }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "fill-blanks-dragdrop" } });

    const passageField = await screen.findByPlaceholderText("The ____ sat on the ____.");
    fireEvent.change(passageField, { target: { value: "The ____ sat on the mat." } });
    expect(screen.getByText("Word pool (decoy words allowed — not every word needs a blank)")).toBeInTheDocument();
    expect(screen.getByText("Correct word for each blank")).toBeInTheDocument();

    fireEvent.change(await screen.findByPlaceholderText("Short internal name for this question"), { target: { value: "Drag Fill Q" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Drag the word into the blank." } });
    const optionInputs = screen.getAllByPlaceholderText(/Item \d/);
    fireEvent.change(optionInputs[0], { target: { value: "cat" } });
    fireEvent.change(optionInputs[1], { target: { value: "dog" } });

    fireEvent.click(screen.getByText("Save question"));
    await waitFor(() => expect(api.admin.questions.create).toHaveBeenCalledWith(expect.objectContaining({
      type: "fill-blanks-dragdrop", passage: "The ____ sat on the mat.", options: ["cat", "dog"], answer: [0]
    })));
  });
});

describe("edit and deactivate", () => {
  it("edits a question successfully", async () => {
    api.admin.questions.update.mockResolvedValue({ question: fullQuestion({ title: "Edited title" }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("Edit"));
    const titleInput = await screen.findByDisplayValue("Renewable energy passage");
    fireEvent.change(titleInput, { target: { value: "Edited title" } });
    fireEvent.click(screen.getByText("Save question"));
    await waitFor(() => expect(api.admin.questions.update).toHaveBeenCalledWith("q1", expect.objectContaining({ title: "Edited title" })));
  });

  it("deactivates a question after confirmation", async () => {
    api.admin.questions.setStatus.mockResolvedValue({ question: fullQuestion({ active: false }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("Deactivate"));
    fireEvent.click(await screen.findByText("Deactivate now"));
    await waitFor(() => expect(api.admin.questions.setStatus).toHaveBeenCalledWith("q1", false));
  });
});

describe("student preview", () => {
  it("shows the prompt and options but never the answer or explanation", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("View"));
    const preview = (await screen.findByText("Student preview")).closest(".modal-panel");
    expect(within(preview).getByText("What is the benefit?")).toBeInTheDocument();
    expect(within(preview).queryByText("Because B.")).not.toBeInTheDocument();
    expect(preview.textContent).not.toMatch(/Because B\./);
  });
});

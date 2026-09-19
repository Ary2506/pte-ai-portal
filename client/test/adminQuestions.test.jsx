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
      media: { upload: vi.fn() },
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
  { type: "essay", label: "Essay", evaluationType: "subjective", shape: "prompt-only", sections: ["writing"] },
  { type: "describe-image", label: "Describe Image", evaluationType: "subjective", shape: "prompt-image", sections: ["speaking"] }
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
  await screen.findByText("Question Library");
}

function fillBasicMcq() {
  fireEvent.change(screen.getByPlaceholderText("Short internal name for this question"), { target: { value: "New MCQ" } });
  fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Pick one" } });
  const optionInputs = screen.getAllByPlaceholderText(/Item \d/);
  fireEvent.change(optionInputs[0], { target: { value: "Option A" } });
  fireEvent.change(optionInputs[1], { target: { value: "Option B" } });
  fireEvent.click(screen.getAllByLabelText(/Mark option \d correct/)[0]);
}

describe("admin question table", () => {
  it("renders the question table with real data", async () => {
    await openQuestionsTab();
    expect(await screen.findByText("Renewable energy passage")).toBeInTheDocument();
    expect(screen.getByText("reading")).toBeInTheDocument();
  });

  it("Phase 4: every cell carries a data-label matching its column header, enabling the CSS-only mobile card fallback", async () => {
    await openQuestionsTab();
    await screen.findByText("Renewable energy passage");
    const titleCell = screen.getByText("Renewable energy passage").closest("td");
    expect(titleCell).toHaveAttribute("data-label", "Question");
    const statusCell = screen.getByText("Published").closest("td");
    expect(statusCell).toHaveAttribute("data-label", "Status");
  });

  it("Phase 4: the create form's live preview carries the responsive layout class for the desktop two-column CSS", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    const preview = await screen.findByTestId("live-preview");
    expect(preview).toHaveClass("form-section", "form-section-preview");
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

describe("create form — dynamic fields", () => {
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
});

describe("create form — draft/publish", () => {
  it("Save as Draft sends active: false", async () => {
    api.admin.questions.create.mockResolvedValue({ question: fullQuestion({ title: "New MCQ", active: false }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fillBasicMcq();
    fireEvent.click(screen.getByText("Save as Draft"));
    await waitFor(() => expect(api.admin.questions.create).toHaveBeenCalledWith(expect.objectContaining({ active: false })));
  });

  it("Publish sends active: true", async () => {
    api.admin.questions.create.mockResolvedValue({ question: fullQuestion({ title: "New MCQ" }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fillBasicMcq();
    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(api.admin.questions.create).toHaveBeenCalledWith(expect.objectContaining({ active: true })));
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

    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(api.admin.questions.create).toHaveBeenCalledWith(expect.objectContaining({
      type: "fill-blanks-dragdrop", passage: "The ____ sat on the mat.", options: ["cat", "dog"], answer: [0], active: true
    })));
  });

  it("lets an admin set a model answer for a subjective, media-based type (Describe Image)", async () => {
    api.admin.questions.create.mockResolvedValue({ question: fullQuestion({ title: "Chart Q", type: "describe-image" }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "speaking" } });
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "describe-image" } });

    fireEvent.change(await screen.findByPlaceholderText("Short internal name for this question"), { target: { value: "Chart Q" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Describe the chart." } });
    fireEvent.change(screen.getByPlaceholderText("https://..."), { target: { value: "https://example.com/chart.png" } });
    fireEvent.change(screen.getByPlaceholderText("A model answer for this question"), { target: { value: "This chart shows..." } });

    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(api.admin.questions.create).toHaveBeenCalledWith(expect.objectContaining({
      type: "describe-image", imageUrl: "https://example.com/chart.png", answer: "This chart shows..."
    })));
  });
});

describe("create form — client-side validation", () => {
  it("blocks submission and shows an inline error when required content is missing", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    // Title/prompt left blank, options left blank — mcq-single is the default type.
    fireEvent.click(screen.getByText("Publish"));
    expect(await screen.findByText("A question title is required.")).toBeInTheDocument();
    expect(screen.getByText("A prompt is required.")).toBeInTheDocument();
    expect(api.admin.questions.create).not.toHaveBeenCalled();
  });

  it("blocks an MCQ with fewer than 2 filled options and no selected answer", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(screen.getByPlaceholderText("Short internal name for this question"), { target: { value: "Bad Q" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Pick one" } });
    fireEvent.click(screen.getByText("Publish"));
    expect(await screen.findByText("At least 2 options are required.")).toBeInTheDocument();
    expect(screen.getByText("Select the correct option.")).toBeInTheDocument();
    expect(api.admin.questions.create).not.toHaveBeenCalled();
  });

  it("requires an image URL for an image-based question type before it can be saved", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "speaking" } });
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "describe-image" } });
    fireEvent.change(screen.getByPlaceholderText("Short internal name for this question"), { target: { value: "Chart Q" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Describe the chart." } });

    fireEvent.click(screen.getByText("Publish"));
    expect(await screen.findByText("An image is required for this question type.")).toBeInTheDocument();
    expect(api.admin.questions.create).not.toHaveBeenCalled();
  });

  it("does not incorrectly require options/answer for a subjective, non-media type (essay)", async () => {
    api.admin.questions.create.mockResolvedValue({ question: fullQuestion({ title: "My Essay", type: "essay", section: "writing" }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "writing" } });
    fireEvent.change(screen.getByPlaceholderText("Short internal name for this question"), { target: { value: "My Essay" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Write about your hometown." } });

    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(api.admin.questions.create).toHaveBeenCalled());
    expect(screen.queryByText("At least 2 options are required.")).not.toBeInTheDocument();
  });

  it("clears a field's error once it is fixed, without needing another save attempt", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.click(screen.getByText("Publish"));
    expect(await screen.findByText("A question title is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Short internal name for this question"), { target: { value: "Now titled" } });
    await waitFor(() => expect(screen.queryByText("A question title is required.")).not.toBeInTheDocument());
  });
});

describe("create form — media upload", () => {
  it("uploads an image through the Phase 2 endpoint with the correct multipart field, and uses the returned URL", async () => {
    api.admin.media.upload.mockResolvedValue({ url: "http://localhost:5000/media/questions/images/abc.jpg", kind: "image", filename: "abc.jpg", mimetype: "image/jpeg", size: 1234 });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "speaking" } });
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "describe-image" } });

    const file = new File(["fake-image-bytes"], "chart.jpg", { type: "image/jpeg" });
    const fileInput = screen.getByLabelText("Upload image");
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(api.admin.media.upload).toHaveBeenCalledWith(file));
    await waitFor(() => expect(screen.getByPlaceholderText("https://...")).toHaveValue("http://localhost:5000/media/questions/images/abc.jpg"));
    expect(screen.getByAltText("Selected question")).toBeInTheDocument();
  });

  it("uploads audio through the same Phase 2 endpoint and shows an audio preview", async () => {
    api.admin.media.upload.mockResolvedValue({ url: "http://localhost:5000/media/questions/audio/xyz.webm", kind: "audio", filename: "xyz.webm", mimetype: "audio/webm", size: 5678 });
    api.admin.questions.types.mockResolvedValue({
      types: [...TYPES, { type: "respond-to-situation", label: "Respond to a Situation", evaluationType: "subjective", shape: "prompt-audio", sections: ["speaking"] }]
    });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "speaking" } });
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "respond-to-situation" } });

    const file = new File(["fake-audio-bytes"], "prompt.webm", { type: "audio/webm" });
    const fileInput = screen.getByLabelText("Upload audio");
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(api.admin.media.upload).toHaveBeenCalledWith(file));
    await waitFor(() => expect(screen.getByPlaceholderText("https://...")).toHaveValue("http://localhost:5000/media/questions/audio/xyz.webm"));
  });

  it("shows an error and does not crash the form when the upload fails", async () => {
    api.admin.media.upload.mockRejectedValue(new Error("Unsupported file type."));
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "speaking" } });
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "describe-image" } });

    const file = new File(["not an image"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload image"), { target: { files: [file] } });

    expect(await screen.findByText("Unsupported file type.")).toBeInTheDocument();
    // The manual URL fallback must still be usable after a failed upload.
    fireEvent.change(screen.getByPlaceholderText("https://..."), { target: { value: "https://example.com/manual.png" } });
    expect(screen.getByPlaceholderText("https://...")).toHaveValue("https://example.com/manual.png");
  });

  it("the manual URL input still works with no upload at all (fallback path)", async () => {
    api.admin.questions.create.mockResolvedValue({ question: fullQuestion({ title: "Chart Q", type: "describe-image" }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "speaking" } });
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "describe-image" } });
    fireEvent.change(screen.getByPlaceholderText("Short internal name for this question"), { target: { value: "Chart Q" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Describe it." } });
    fireEvent.change(screen.getByPlaceholderText("https://..."), { target: { value: "https://example.com/manual.png" } });

    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(api.admin.questions.create).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: "https://example.com/manual.png" })));
    expect(api.admin.media.upload).not.toHaveBeenCalled();
  });
});

describe("live in-form preview", () => {
  it("updates as the admin edits the title and prompt", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));

    fireEvent.change(screen.getByPlaceholderText("Short internal name for this question"), { target: { value: "Live Preview Title" } });
    fireEvent.change(screen.getByPlaceholderText("What the student is asked to do"), { target: { value: "Live preview prompt text" } });

    const preview = await screen.findByTestId("live-preview");
    expect(within(preview).getByText("Live Preview Title")).toBeInTheDocument();
    expect(within(preview).getByText("Live preview prompt text")).toBeInTheDocument();
  });

  it("reflects the selected shape — e.g. shows an image once the URL is set for an image type", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "speaking" } });
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "describe-image" } });
    fireEvent.change(screen.getByPlaceholderText("https://..."), { target: { value: "https://example.com/preview.png" } });

    const preview = await screen.findByTestId("live-preview");
    const previewImg = within(preview).getByAltText("Question image");
    expect(previewImg).toHaveAttribute("src", "https://example.com/preview.png");
  });

  it("never shows the model answer or explanation in the live preview", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("+ Create question"));
    fireEvent.change(await screen.findByLabelText("Section"), { target: { value: "speaking" } });
    fireEvent.change(await screen.findByLabelText("Question type"), { target: { value: "describe-image" } });
    fireEvent.change(screen.getByPlaceholderText("A model answer for this question"), { target: { value: "Secret model answer text" } });

    const preview = await screen.findByTestId("live-preview");
    expect(within(preview).queryByText("Secret model answer text")).not.toBeInTheDocument();
  });
});

describe("edit, publish state, and deletion", () => {
  it("edits a question via Update, preserving its current publish state", async () => {
    api.admin.questions.update.mockResolvedValue({ question: fullQuestion({ title: "Edited title" }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("Edit"));
    const titleInput = await screen.findByDisplayValue("Renewable energy passage");
    fireEvent.change(titleInput, { target: { value: "Edited title" } });
    fireEvent.click(screen.getByText("Update"));
    await waitFor(() => expect(api.admin.questions.update).toHaveBeenCalledWith("q1", expect.objectContaining({ title: "Edited title", active: true })));
  });

  it("shows Unpublish for a published question being edited, and it sends active: false", async () => {
    api.admin.questions.update.mockResolvedValue({ question: fullQuestion({ active: false }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("Edit"));
    const modal = (await screen.findByText("Edit question")).closest(".modal-panel");
    await within(modal).findByDisplayValue("Renewable energy passage");
    fireEvent.click(within(modal).getByText("Unpublish"));
    await waitFor(() => expect(api.admin.questions.update).toHaveBeenCalledWith("q1", expect.objectContaining({ active: false })));
  });

  it("shows Publish for a draft question being edited, and it sends active: true", async () => {
    api.admin.questions.get.mockResolvedValue({ question: fullQuestion({ active: false }) });
    api.admin.questions.update.mockResolvedValue({ question: fullQuestion({ active: true }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("Edit"));
    await screen.findByDisplayValue("Renewable energy passage");
    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(api.admin.questions.update).toHaveBeenCalledWith("q1", expect.objectContaining({ active: true })));
  });

  it("unpublishes a question from the list after confirmation", async () => {
    api.admin.questions.setStatus.mockResolvedValue({ question: fullQuestion({ active: false }) });
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("Unpublish"));
    fireEvent.click(await screen.findByText("Unpublish now"));
    await waitFor(() => expect(api.admin.questions.setStatus).toHaveBeenCalledWith("q1", false));
  });

  it("a genuine server-side rejection still surfaces after client-side validation passes", async () => {
    api.admin.questions.update.mockRejectedValue(Object.assign(new Error("This title is already in use."), { code: "VALIDATION_ERROR" }));
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("Edit"));
    await screen.findByDisplayValue("Renewable energy passage");
    fireEvent.click(screen.getByText("Update"));
    expect(await screen.findByText("This title is already in use.")).toBeInTheDocument();
  });
});

describe("student preview (list view, unchanged)", () => {
  it("shows the prompt and options but never the answer or explanation", async () => {
    await openQuestionsTab();
    fireEvent.click(await screen.findByText("View"));
    const preview = (await screen.findByText("Student preview")).closest(".modal-panel");
    expect(within(preview).getByText("What is the benefit?")).toBeInTheDocument();
    expect(within(preview).queryByText("Because B.")).not.toBeInTheDocument();
    expect(preview.textContent).not.toMatch(/Because B\./);
  });
});

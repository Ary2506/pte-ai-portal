import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {},
    dashboard: vi.fn(), plan: vi.fn(),
    questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    questionTranscript: vi.fn(),
    history: vi.fn(() => Promise.resolve({ submissions: [] })), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

// Speaking and Writing practice shows "<task name> <n>" instead of each question's own topic title,
// except Describe Image and Summarize Written Text.
function renderAt(path) {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify({ role: "student", name: "S", username: "pte001" }));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}
const topical = (type, section, titles, extra = {}) =>
  titles.map((title, i) => ({ _id: `${type}-${i + 1}`, section, type, title, prompt: "Do the task.", evaluationType: "subjective", ...extra }));
const heading = () => document.querySelector(".task-main h2")?.textContent;
const rowTitles = () => [...document.querySelectorAll(".question-list-row")].map((row) => ({
  number: row.querySelector(".question-row-number")?.textContent,
  title: row.querySelector(".question-list-title")?.textContent
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.history.mockResolvedValue({ submissions: [] });
});

describe("Speaking practice — numbered titles", () => {
  const READ_ALOUD = topical("read-aloud", "speaking", ["Visit to Canada", "Climate Change", "Education System"]);

  it("the question list shows 'Read Aloud 1/2/3', never the topic titles", async () => {
    api.questions.mockResolvedValue({ questions: READ_ALOUD });
    renderAt("/speaking?type=read-aloud");
    await screen.findByText("Read Aloud 1");
    expect(rowTitles()).toEqual([
      { number: "#1", title: "Read Aloud 1" },
      { number: "#2", title: "Read Aloud 2" },
      { number: "#3", title: "Read Aloud 3" }
    ]);
    expect(screen.queryByText("Visit to Canada")).not.toBeInTheDocument();
    expect(screen.queryByText("Climate Change")).not.toBeInTheDocument();
  });

  it("the question heading uses the same number, and stays right moving next / previous / back to the list", async () => {
    api.questions.mockResolvedValue({ questions: READ_ALOUD });
    renderAt("/speaking?type=read-aloud");
    fireEvent.click((await screen.findByText("Read Aloud 2")).closest("button"));
    expect(heading()).toBe("Read Aloud 2");
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(heading()).toBe("Read Aloud 3");
    fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
    fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
    expect(heading()).toBe("Read Aloud 1");
    fireEvent.click(screen.getByText("Back to list"));
    expect(rowTitles().map((r) => r.title)).toEqual(["Read Aloud 1", "Read Aloud 2", "Read Aloud 3"]);
  });

  it("survives a refresh: the restored question still shows its own number", async () => {
    api.questions.mockResolvedValue({ questions: READ_ALOUD });
    const first = renderAt("/speaking?type=read-aloud");
    fireEvent.click((await screen.findByText("Read Aloud 3")).closest("button"));
    expect(heading()).toBe("Read Aloud 3");
    first.unmount(); // a refresh: everything remounts, only localStorage survives
    renderAt("/speaking?type=read-aloud");
    await screen.findByText("Read Aloud 3", { selector: "h2" });
    expect(heading()).toBe("Read Aloud 3");
  });

  it("numbers each type on its own, using that type's own name", async () => {
    api.questions.mockResolvedValue({ questions: topical("answer-short-question", "speaking", ["Colours", "Animals"]) });
    renderAt("/speaking?type=answer-short-question");
    await screen.findByText("Answer Short Question 1");
    expect(rowTitles().map((r) => r.title)).toEqual(["Answer Short Question 1", "Answer Short Question 2"]);
    expect(screen.queryByText("Colours")).not.toBeInTheDocument();
  });

  it("Repeat Sentence is numbered too, and keeps its Transcript button", async () => {
    api.questions.mockResolvedValue({ questions: topical("repeat-sentence", "speaking", ["Repeat Sentence #368", "Repeat Sentence #848"], { audioUrl: "/a.mp3" }) });
    renderAt("/speaking?type=repeat-sentence");
    fireEvent.click((await screen.findByText("Repeat Sentence 2")).closest("button"));
    expect(heading()).toBe("Repeat Sentence 2");
    expect(screen.getByRole("button", { name: "Transcript" })).toBeInTheDocument();
  });

  it("EXCEPTION: Describe Image keeps its own titles, exactly as before", async () => {
    api.questions.mockResolvedValue({ questions: topical("describe-image", "speaking", ["Bar Chart of Sales", "Map of the Campus"], { imageUrl: "https://example.com/x.png" }) });
    renderAt("/speaking?type=describe-image");
    await screen.findByText("Bar Chart of Sales");
    expect(rowTitles().map((r) => r.title)).toEqual(["Bar Chart of Sales", "Map of the Campus"]);
    fireEvent.click(screen.getByText("Map of the Campus").closest("button"));
    expect(heading()).toBe("Map of the Campus");
  });
});

describe("Writing practice — numbered titles", () => {
  it("Write Essay shows 'Write Essay 1/2', never the topic", async () => {
    api.questions.mockResolvedValue({ questions: topical("essay", "writing", ["Technology and Society", "Remote Work"]) });
    renderAt("/writing?type=essay");
    await screen.findByText("Write Essay 1");
    expect(rowTitles().map((r) => r.title)).toEqual(["Write Essay 1", "Write Essay 2"]);
    expect(screen.queryByText("Technology and Society")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Write Essay 2").closest("button"));
    expect(heading()).toBe("Write Essay 2");
  });

  it("EXCEPTION: Summarize Written Text keeps its own titles, exactly as before", async () => {
    api.questions.mockResolvedValue({ questions: topical("swt", "writing", ["The Rise of the Smartphone", "Urban Farming"], { passage: "A passage." }) });
    renderAt("/writing?type=swt");
    await screen.findByText("The Rise of the Smartphone");
    expect(rowTitles().map((r) => r.title)).toEqual(["The Rise of the Smartphone", "Urban Farming"]);
    fireEvent.click(screen.getByText("Urban Farming").closest("button"));
    expect(heading()).toBe("Urban Farming");
  });
});

describe("Other sections are unaffected", () => {
  it("Reading keeps its own titles", async () => {
    api.questions.mockResolvedValue({ questions: topical("mcq-single", "reading", ["Photosynthesis", "The Roman Empire"], { options: ["A", "B"], evaluationType: "objective" }) });
    renderAt("/reading?type=mcq-single");
    await screen.findByText("Photosynthesis");
    expect(rowTitles().map((r) => r.title)).toEqual(["Photosynthesis", "The Roman Empire"]);
  });

  it("Listening keeps its own titles", async () => {
    api.questions.mockResolvedValue({ questions: topical("write-dictation", "listening", ["Library Hours", "Lab Safety"], { audioUrl: "/a.mp3", evaluationType: "objective" }) });
    renderAt("/listening?type=write-dictation");
    await screen.findByText("Library Hours");
    expect(rowTitles().map((r) => r.title)).toEqual(["Library Hours", "Lab Safety"]);
  });
});

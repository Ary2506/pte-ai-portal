import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  forceLogout: vi.fn(),
  publicApi: { sharedAnswer: vi.fn(), sharedAnswerAudioUrl: vi.fn() },
  api: {
    auth: { signin: vi.fn(), me: vi.fn(() => Promise.resolve({})), logout: vi.fn(() => Promise.resolve()) },
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(), questionTranscript: vi.fn(),
    ownRecordingSrc: vi.fn(), shareSubmission: vi.fn(), unshareSubmission: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

const student = { id: "u1", role: "student", name: "Tamanna", username: "pte001" };
function renderAt(path) {
  localStorage.clear();
  localStorage.setItem("pte_token", "test-token");
  localStorage.setItem("pte_user", JSON.stringify(student));
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

const RA = { _id: "q1", section: "speaking", type: "read-aloud", title: "Visit to Canada", prompt: "Read the passage aloud.", passage: "The best time to visit Canada is during fall months.", evaluationType: "subjective" };
const attempt = (id, createdAt, over = {}) => ({
  _id: id, section: "speaking", type: "read-aloud", evaluationType: "subjective", evaluationStatus: "COMPLETED",
  score: 71, maxScore: 90, createdAt, question: { _id: "q1", title: "Visit to Canada" }, hasAudio: true, share: null, ...over
});
const ATTEMPTS = [
  attempt("s2", "2026-11-17T09:30:00.000Z", { score: 71 }),
  attempt("s1", "2026-11-16T15:05:00.000Z", { score: 39 }),
  attempt("s0", "2026-11-15T08:00:00.000Z", { hasAudio: false })
];

let ownAttempts;
beforeEach(() => {
  vi.clearAllMocks();
  ownAttempts = ATTEMPTS;
  api.questions.mockResolvedValue({ questions: [RA] });
  // The practice page's own progress fetch takes no question filter; the recordings list does.
  api.history.mockImplementation((params) => Promise.resolve({ submissions: params?.question ? ownAttempts : [] }));
  api.ownRecordingSrc.mockImplementation((id) => Promise.resolve({ src: `https://signed.example/${id}.webm`, isBlob: false }));
});

const items = () => [...document.querySelectorAll(".my-recordings__item")];

describe("Read Aloud — my recordings", () => {
  it("lists only my own attempts at this question, each with its date, player and real score", async () => {
    renderAt("/speaking?type=read-aloud");
    await waitFor(() => expect(items()).toHaveLength(2)); // the attempt without audio is not a recording
    expect(api.history).toHaveBeenCalledWith({ summary: 1, type: "read-aloud", question: "q1", limit: 10 });

    const [newest, older] = items();
    expect(newest).toHaveTextContent("Tamanna");
    expect(newest.querySelector("time").getAttribute("dateTime")).toBe("2026-11-17T09:30:00.000Z");
    expect(newest).toHaveTextContent("Score 71/90");
    expect(older).toHaveTextContent("Score 39/90");
    await waitFor(() => expect(newest.querySelector("audio")).not.toBeNull());
    expect(newest.querySelector("audio").getAttribute("src")).toBe("https://signed.example/s2.webm");
    expect(newest.querySelector("audio").hasAttribute("controls")).toBe(true);
    expect(api.ownRecordingSrc).toHaveBeenCalledWith("s2");
    expect(api.ownRecordingSrc).toHaveBeenCalledWith("s1");
  });

  it("shares the exact attempt chosen, through the existing Share Answer popup", async () => {
    const url = "http://localhost:5173/shared-answer/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
    api.shareSubmission.mockResolvedValue({ share: { url, createdAt: new Date().toISOString(), expiresAt: "2026-12-17T09:30:00.000Z" } });
    renderAt("/speaking?type=read-aloud");
    await waitFor(() => expect(items()).toHaveLength(2));
    fireEvent.click(within(items()[1]).getByRole("button", { name: /^Share your recording/ }));
    const dialog = await screen.findByRole("dialog", { name: "Answer Link Created" });
    expect(api.shareSubmission).toHaveBeenCalledWith("s1");
    expect(within(dialog).getByRole("textbox", { name: "Share link" })).toHaveValue(url);
    fireEvent.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(within(items()[1]).getByText("Shared")).toBeInTheDocument());
  });

  it("shows nothing when there are no recordings yet", async () => {
    ownAttempts = [];
    renderAt("/speaking?type=read-aloud");
    await screen.findByText(RA.passage);
    await waitFor(() => expect(api.history).toHaveBeenCalledWith(expect.objectContaining({ question: "q1" })));
    expect(document.querySelector(".my-recordings")).toBeNull();
  });

  it("does not appear on other Speaking tasks", async () => {
    api.questions.mockResolvedValue({ questions: [{ ...RA, _id: "rs1", type: "repeat-sentence", title: "RS", passage: undefined, audioUrl: "/a.mp3" }] });
    renderAt("/speaking?type=repeat-sentence");
    await screen.findByText("Repeat Sentence 1");
    expect(api.history).not.toHaveBeenCalledWith(expect.objectContaining({ question: expect.anything() }));
    expect(document.querySelector(".my-recordings")).toBeNull();
  });
});

// Seven recordings at one question, newest first: s7 (newest) … s1 (oldest).
const SEVEN = Array.from({ length: 7 }, (_, i) => attempt(`s${7 - i}`, new Date(Date.UTC(2026, 10, 17, 12 - i)).toISOString(), { score: 80 - i }));

describe("Read Aloud — latest 5 on the question page, all on My Results", () => {
  beforeEach(() => { api.testSessions.list.mockResolvedValue({ testSessions: [] }); });

  it("shows exactly the newest 5 recordings, newest first, then the note and the My Results link", async () => {
    ownAttempts = SEVEN;
    renderAt("/speaking?type=read-aloud");
    await waitFor(() => expect(items()).toHaveLength(5));
    expect(items().map((li) => li.querySelector("time").getAttribute("dateTime"))).toEqual(SEVEN.slice(0, 5).map((r) => r.createdAt));
    for (const li of items()) {
      expect(li.querySelector(".my-recordings__chip")).toHaveTextContent(/^Score \d+\/90$/);
      expect(within(li).getByRole("button", { name: /^Share your recording/ })).toBeInTheDocument();
    }
    expect(screen.getByText("Showing your latest 5 recordings. To view and share your other recordings, visit My Results.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to My Results →" })).toHaveAttribute("href", "/history#read-aloud-recordings");
  });

  it("shows no note when there are 5 recordings or fewer", async () => {
    ownAttempts = SEVEN.slice(0, 5);
    renderAt("/speaking?type=read-aloud");
    await waitFor(() => expect(items()).toHaveLength(5));
    expect(screen.queryByText(/Showing your latest 5 recordings/)).not.toBeInTheDocument();
  });

  it("the My Results link opens the complete recording history there, where an older recording shares itself", async () => {
    ownAttempts = SEVEN;
    // My Results' own attempts table reads the student's history too; give it the same rows.
    api.history.mockImplementation((params) => Promise.resolve(
      params?.question ? { submissions: ownAttempts }
        : params?.type === "read-aloud" ? { submissions: SEVEN, total: 7, page: 1, totalPages: 1 }
          : { submissions: SEVEN }
    ));
    api.shareSubmission.mockResolvedValue({ share: { url: "http://localhost:5173/shared-answer/x", createdAt: new Date().toISOString(), expiresAt: "2026-12-17T00:00:00.000Z" } });
    renderAt("/speaking?type=read-aloud");
    fireEvent.click(await screen.findByRole("link", { name: "Go to My Results →" }));
    expect(await screen.findByRole("heading", { name: "Practice History" })).toBeInTheDocument();

    const history = await screen.findByRole("region", { name: "Read Aloud recordings" });
    await waitFor(() => expect(history.querySelectorAll(".my-recordings__item")).toHaveLength(7));
    expect(api.history).toHaveBeenCalledWith({ summary: 1, type: "read-aloud", limit: 10, page: 1 });
    const rows = [...history.querySelectorAll(".my-recordings__item")];
    expect(rows[0]).toHaveTextContent("Visit to Canada");
    // The oldest recording (s1), beyond the latest five, has its own Share — and shares itself.
    fireEvent.click(within(rows[6]).getByRole("button", { name: /^Share your recording/ }));
    await screen.findByRole("dialog", { name: "Answer Link Created" });
    expect(api.shareSubmission).toHaveBeenCalledWith("s1");
  });

  it("pages through a long history, ten at a time", async () => {
    const pageRows = (page) => Array.from({ length: page === 1 ? 10 : 2 }, (_, i) => attempt(`p${page}-${i}`, new Date(Date.UTC(2026, 10, 17, 0, 60 - i - page * 10)).toISOString()));
    api.history.mockImplementation((params) => Promise.resolve(
      params?.type === "read-aloud" && !params?.question
        ? { submissions: pageRows(params.page), total: 12, page: params.page, totalPages: 2 }
        : { submissions: SEVEN }
    ));
    renderAt("/history");
    const history = await screen.findByRole("region", { name: "Read Aloud recordings" });
    await waitFor(() => expect(history.querySelectorAll(".my-recordings__item")).toHaveLength(10));
    fireEvent.click(within(history).getByText("Next"));
    await waitFor(() => expect(history.querySelectorAll(".my-recordings__item")).toHaveLength(2));
    expect(api.history).toHaveBeenCalledWith({ summary: 1, type: "read-aloud", limit: 10, page: 2 });
  });
});

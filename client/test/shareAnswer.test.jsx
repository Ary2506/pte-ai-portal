import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api, publicApi } from "../src/api.js";

vi.mock("../src/api.js", () => ({
  forceLogout: vi.fn(),
  publicApi: { sharedAnswer: vi.fn(), sharedAnswerAudioUrl: vi.fn() },
  api: {
    auth: { signin: vi.fn(), me: vi.fn(() => Promise.resolve({})), logout: vi.fn(() => Promise.resolve()) },
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), questionIndex: vi.fn(() => Promise.resolve({ questions: [] })),
    history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    shareSubmission: vi.fn(), unshareSubmission: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn(() => Promise.resolve({ testSessions: [] })) }
  }
}));

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const studentUser = { id: "u1", role: "student", name: "Student", username: "pte001", subscriptionStatus: "ACTIVE", subscriptionEndDate: new Date(Date.now() + 20 * 864e5).toISOString() };

function renderAt(path, user) {
  localStorage.clear();
  if (user) {
    localStorage.setItem("pte_token", "test-token");
    localStorage.setItem("pte_user", JSON.stringify(user));
  }
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

const REPORT = {
  taskType: "read-aloud", taskLabel: "Read Aloud", questionTitle: "Visit to Canada",
  answeredAt: "2026-11-17T10:00:00.000Z", score: 71, maxScore: 90,
  criteria: [{ key: "content", label: "Content", value: 80, max: 100 }, { key: "fluency", label: "Fluency", value: 72, max: 100 }],
  transcript: "The best time to visit Canada is during fall months.",
  overall: "Clear reading with a few hesitations.", strengths: ["Steady pace."], improvements: ["Stress key words."],
  mistakes: [{ problem: "\"fall months\" was rushed.", studentText: "fall months", correction: "fall months" }],
  hasAudio: true, expiresAt: "2026-12-17T10:00:00.000Z"
};

beforeEach(() => {
  vi.clearAllMocks();
  publicApi.sharedAnswer.mockResolvedValue({ report: REPORT });
  publicApi.sharedAnswerAudioUrl.mockResolvedValue({ url: "https://signed.example/a.webm?sig=1", expiresAt: new Date(Date.now() + 3600e3).toISOString() });
});

describe("the public shared-answer page", () => {
  it("opens without signing in, with no app navigation, showing only the real report", async () => {
    renderAt(`/shared-answer/${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Visit to Canada" })).toBeInTheDocument();
    expect(publicApi.sharedAnswer).toHaveBeenCalledWith(TOKEN);
    // None of the app around it: no sidebar, no sign-in sheet, no landing page.
    expect(document.querySelector(".sidebar, nav")).toBeNull();
    expect(screen.queryByText(/Sign In/i)).not.toBeInTheDocument();
    // Only the criteria the evaluation produced; no invented Pronunciation row.
    const table = document.querySelector(".shared-report__table");
    expect(within(table).getByText("Content").closest("tr")).toHaveTextContent("80/100");
    expect(within(table).getByText("Fluency").closest("tr")).toHaveTextContent("72/100");
    expect(within(table).queryByText("Pronunciation")).toBeNull();
    expect(table.querySelector("tfoot")).toHaveTextContent("71/90");
    // Transcript, with only the phrase the feedback flagged marked.
    expect(document.querySelector(".shared-report__transcript")).toHaveTextContent(REPORT.transcript);
    expect([...document.querySelectorAll(".shared-report__transcript mark")].map((m) => m.textContent)).toEqual(["fall months"]);
    expect(screen.getByText("Stress key words.")).toBeInTheDocument();
    // Kept out of search engines.
    expect(document.head.querySelector('meta[name="robots"]').content).toContain("noindex");
    // Nothing from the student-only API was called.
    expect(api.history).not.toHaveBeenCalled();
    expect(api.dashboard).not.toHaveBeenCalled();
  });

  it("loads nothing for the recording until Play, then plays it from a temporary URL and fetches a new one when it fails", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    renderAt(`/shared-answer/${TOKEN}`);
    await screen.findByRole("heading", { name: "Visit to Canada" });
    // Opening the link costs the report alone: no audio URL, no audio.
    expect(publicApi.sharedAnswerAudioUrl).not.toHaveBeenCalled();
    expect(document.querySelector("audio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play the recording" }));
    const audio = await waitFor(() => {
      const el = document.querySelector("audio.shared-report__audio");
      expect(el).not.toBeNull();
      return el;
    });
    expect(audio.getAttribute("src")).toBe("https://signed.example/a.webm?sig=1");
    publicApi.sharedAnswerAudioUrl.mockResolvedValueOnce({ url: "https://signed.example/a.webm?sig=2", expiresAt: new Date(Date.now() + 3600e3).toISOString() });
    fireEvent.error(audio);
    await waitFor(() => expect(document.querySelector("audio.shared-report__audio").getAttribute("src")).toBe("https://signed.example/a.webm?sig=2"));
    expect(publicApi.sharedAnswerAudioUrl).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledTimes(1); // started by the Play press, not again by the refresh
    play.mockRestore();
  });

  it.each([
    ["SHARE_EXPIRED", "This link has expired"],
    ["SHARE_REVOKED", "This answer is no longer shared"],
    ["SHARE_NOT_FOUND", "Shared answer not found"]
  ])("explains a %s link instead of showing a report", async (code, heading) => {
    publicApi.sharedAnswer.mockRejectedValueOnce(Object.assign(new Error("Server message."), { code }));
    renderAt(`/shared-answer/${TOKEN}`);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText("Server message.")).toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("is the same standalone page for a signed-in student", async () => {
    renderAt(`/shared-answer/${TOKEN}`, studentUser);
    expect(await screen.findByRole("heading", { name: "Visit to Canada" })).toBeInTheDocument();
    expect(document.querySelector(".sidebar, nav")).toBeNull();
  });
});

describe("sharing from Practice History", () => {
  const row = (over) => ({
    _id: "s1", section: "speaking", type: "read-aloud", evaluationType: "subjective", evaluationStatus: "COMPLETED",
    score: 71, maxScore: 90, createdAt: new Date().toISOString(), question: { title: "Visit to Canada" }, hasAudio: true, share: null, ...over
  });

  function showHistory(rows) {
    // The attempts table gets these rows; the Speaking recordings section on the same page
    // (requested with withAudio=1) is left empty, so each row appears once.
    api.history.mockImplementation((params) => Promise.resolve(params?.withAudio
      ? { submissions: [], total: 0, totalPages: 1 }
      : { submissions: rows, total: rows.length, totalPages: 1 }));
    renderAt("/history", studentUser);
  }

  it("offers Share only on scored speaking answers that have a recording", async () => {
    showHistory([
      row({ _id: "ok" }),
      row({ _id: "noaudio", hasAudio: false, question: { title: "No Audio" } }),
      row({ _id: "writing", section: "writing", type: "swt", question: { title: "Essay Row" } }),
      row({ _id: "pending", evaluationStatus: "PENDING", question: { title: "Pending Row" } })
    ]);
    await screen.findByText("No Audio");
    expect(screen.getAllByRole("button", { name: /^Share your answer/ })).toHaveLength(1);
  });

  it("creates the link, shows the ApeUni-style popup, and copies it", async () => {
    const url = `http://localhost:5173/shared-answer/${TOKEN}`;
    api.shareSubmission.mockResolvedValue({ share: {
      url, createdAt: new Date().toISOString(), expiresAt: "2026-12-17T10:00:00.000Z",
      summary: { taskCode: "RA", taskLabel: "Read Aloud", questionTitle: "Visit to Canada", score: 71, maxScore: 90 }
    } });
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    showHistory([row()]);
    fireEvent.click(await screen.findByRole("button", { name: /^Share your answer/ }));

    const dialog = await screen.findByRole("dialog", { name: "Answer Link Created" });
    expect(api.shareSubmission).toHaveBeenCalledTimes(1);
    expect(api.shareSubmission).toHaveBeenCalledWith("s1");
    expect(within(dialog).getByText("Send the following link to your friends to share your answer!")).toBeInTheDocument();
    expect(within(dialog).getByText("RA · Visit to Canada · PTE CORE AI Score 71/90")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Share link" })).toHaveValue(url);

    // Copy Link copies the link alone, so pasting it into an address bar opens it rather than
    // searching for the text around it.
    fireEvent.click(within(dialog).getByText("Copy Link"));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(url));
    expect(await within(dialog).findByText("Copied!")).toBeInTheDocument();
    // Copy message is the ready-to-send WhatsApp text: what the answer is, then the link.
    fireEvent.click(within(dialog).getByText("Copy message"));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`RA · Visit to Canada · PTE CORE AI Score 71/90\n${url}`));

    fireEvent.click(within(dialog).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The row now shows it is shared and can be stopped.
    expect(screen.getByText("Stop sharing")).toBeInTheDocument();
  });

  it("an answer already shared shows its existing link with the original expiry, under a plain Share button", async () => {
    const url = `http://localhost:5173/shared-answer/${TOKEN}`;
    api.shareSubmission.mockResolvedValue({ share: {
      url, createdAt: "2026-11-20T10:00:00.000Z", expiresAt: "2026-12-20T10:00:00.000Z", reused: true,
      summary: { taskCode: "RA", taskLabel: "Read Aloud", questionTitle: "Visit to Canada", score: 71, maxScore: 90 }
    } });
    showHistory([row({ share: { expiresAt: "2026-12-20T10:00:00.000Z" } })]);
    const button = await screen.findByRole("button", { name: /^Share your answer/ });
    expect(button).toHaveTextContent(/^Share$/);
    expect(screen.queryByText("Share again")).toBeNull();
    fireEvent.click(button);

    const dialog = await screen.findByRole("dialog", { name: "Your Answer Link" });
    expect(within(dialog).getByRole("textbox", { name: "Share link" })).toHaveValue(url);
    expect(dialog).toHaveTextContent(new Date("2026-12-20T10:00:00.000Z").toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }));
  });

  it("stops sharing after confirmation", async () => {
    api.unshareSubmission.mockResolvedValue({ revoked: 1 });
    showHistory([row({ share: { expiresAt: "2026-12-17T10:00:00.000Z" } })]);
    fireEvent.click(await screen.findByText("Stop sharing"));
    const confirm = await screen.findByRole("dialog", { name: "Stop sharing this answer?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(api.unshareSubmission).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.queryByText("Stop sharing")).not.toBeInTheDocument());
  });

  it("shows the server's reason when a link cannot be created", async () => {
    api.shareSubmission.mockRejectedValue(Object.assign(new Error("The recording for this answer is no longer stored, so it cannot be shared."), { code: "RECORDING_UNAVAILABLE" }));
    showHistory([row()]);
    fireEvent.click(await screen.findByRole("button", { name: /^Share your answer/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer stored");
    expect(screen.queryByText("Copy Link")).not.toBeInTheDocument();
  });
});

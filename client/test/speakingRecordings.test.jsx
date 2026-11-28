import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import MyRecordings, { SpeakingRecordingHistory } from "../src/practice/MyRecordings.jsx";
import { api } from "../src/api.js";

// Recordings for every Speaking task: under each question, and on My Results with a task filter.
// Audio is never requested until a recording is played.
vi.mock("../src/api.js", () => ({
  api: { history: vi.fn(), ownRecordingSrc: vi.fn(), shareSubmission: vi.fn() }
}));

const row = (id, type, title, over = {}) => ({
  _id: id, type, section: "speaking", evaluationStatus: "COMPLETED", score: 60, maxScore: 90, durationSeconds: 5,
  createdAt: "2026-11-27T09:00:00.000Z", question: { _id: `q-${id}`, title }, hasAudio: true, share: null,
  audioAvailableUntil: null, ...over
});
const page = (rows) => ({ submissions: rows, total: rows.length, page: 1, totalPages: 1, recordingRetentionDays: 7 });

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}
function renderHistory(path = "/history") {
  return render(<MemoryRouter initialEntries={[path]}><SpeakingRecordingHistory /><Where /></MemoryRouter>);
}
const region = () => screen.getByRole("region", { name: "Speaking recordings" });
const items = () => [...region().querySelectorAll(".my-recordings__item")];

beforeEach(() => { vi.clearAllMocks(); });

describe("My Results — Speaking recordings", () => {
  it("lists every Speaking task's recordings by default, each labelled with its task, without loading audio", async () => {
    api.history.mockResolvedValue(page([
      row("a", "read-aloud", "Visit to Canada"), row("b", "repeat-sentence", "Repeat Sentence #848"), row("c", "describe-image", "Bar chart")
    ]));
    renderHistory();
    await waitFor(() => expect(items()).toHaveLength(3));
    expect(api.history).toHaveBeenCalledTimes(1);
    expect(api.history).toHaveBeenCalledWith({ summary: 1, section: "speaking", withAudio: 1, limit: 10, page: 1 });
    expect(items().map((li) => li.querySelector(".my-recordings__task").textContent)).toEqual(["Read Aloud", "Repeat Sentence", "Describe Image"]);
    expect(within(region()).getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(api.ownRecordingSrc).not.toHaveBeenCalled();
    expect(region().querySelector("audio")).toBeNull();
  });

  it("a task tab lists only that task, from page 1, and is kept in the address", async () => {
    api.history.mockResolvedValue(page([row("a", "read-aloud", "Visit to Canada")]));
    renderHistory();
    await waitFor(() => expect(items()).toHaveLength(1));
    api.history.mockResolvedValue(page([row("b", "repeat-sentence", "Repeat Sentence #848")]));
    fireEvent.click(within(region()).getByRole("tab", { name: "Repeat Sentence" }));
    await waitFor(() => expect(api.history).toHaveBeenLastCalledWith({ summary: 1, type: "repeat-sentence", withAudio: 1, limit: 10, page: 1 }));
    await waitFor(() => expect(items()[0]).toHaveTextContent("Repeat Sentence #848"));
    expect(items()[0].querySelector(".my-recordings__task")).toBeNull(); // the tab already says which task
    expect(screen.getByTestId("where")).toHaveTextContent("?recordings=repeat-sentence");
  });

  it("opens already filtered when arriving from a question's Go to My Results link", async () => {
    api.history.mockResolvedValue(page([row("c", "describe-image", "Bar chart")]));
    renderHistory("/history?recordings=describe-image#speaking-recordings");
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(api.history).toHaveBeenCalledTimes(1);
    expect(api.history).toHaveBeenCalledWith({ summary: 1, type: "describe-image", withAudio: 1, limit: 10, page: 1 });
    expect(within(region()).getByRole("tab", { name: "Describe Image" })).toHaveAttribute("aria-selected", "true");
  });

  it("says when a task has no recordings in the retention period", async () => {
    api.history.mockResolvedValue(page([]));
    renderHistory("/history?recordings=answer-short-question");
    expect(await within(region()).findByText("No Answer Short Question recordings in the last 7 days.")).toBeInTheDocument();
  });
});

describe("under a question", () => {
  const question = { _id: "q-rs", type: "repeat-sentence", title: "Repeat Sentence #848" };
  const renderList = (refreshKey) => (
    <MemoryRouter><MyRecordings question={question} refreshKey={refreshKey} /></MemoryRouter>
  );

  it("links to My Results already filtered to the question's task", async () => {
    api.history.mockResolvedValue({ submissions: Array.from({ length: 6 }, (_, i) => row(`r${i}`, "repeat-sentence", "RS")), total: 6 });
    render(renderList("x:COMPLETED"));
    expect(await screen.findByRole("link", { name: "Go to My Results →" })).toHaveAttribute("href", "/history?recordings=repeat-sentence#speaking-recordings");
  });

  it("reloads when a retried score comes back, so it never shows a stale 'Not scored'", async () => {
    api.history.mockResolvedValue({ submissions: [row("r1", "repeat-sentence", "RS", { evaluationStatus: "FAILED" })], total: 1 });
    const { rerender } = render(renderList("r1:FAILED"));
    expect(await screen.findByText("Score Not scored")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Share your recording/ })).toBeNull();

    api.history.mockResolvedValue({ submissions: [row("r1", "repeat-sentence", "RS", { score: 64 })], total: 1 });
    rerender(renderList("r1:COMPLETED")); // the same answer, now scored
    expect(await screen.findByText("Score 64/90")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Share your recording/ })).toBeInTheDocument();
    expect(api.history).toHaveBeenCalledTimes(2);
  });
});

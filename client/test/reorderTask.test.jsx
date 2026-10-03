import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReadingTask } from "../src/PracticeObjective.jsx";
import { api } from "../src/api.js";

// Re-order Paragraphs: it used to throw on first render (order started null and was only filled
// by an effect), and it used to move items with up/down buttons. It is drag-to-SWAP now, so these
// pin both the render fix and the swap semantics the client asked for: dropping 4 onto 2
// exchanges those two and leaves everything else alone.

vi.mock("../src/api.js", () => ({ api: { submit: vi.fn() } }));

const question = {
  _id: "q1",
  type: "reorder",
  section: "reading",
  title: "Pest Control",
  prompt: "Arrange these sentences into the correct logical order.",
  options: ["First sentence.", "Second sentence.", "Third sentence.", "Fourth sentence."],
  maxScore: 3
};

const items = () => [...document.querySelectorAll(".reorder-item")];
const texts = () => items().map(n => n.querySelector(".reorder-text").textContent);
const labels = () => items().map(n => n.querySelector(".reorder-pos").textContent);

function dragOnto(fromPos, toPos) {
  const nodes = items();
  fireEvent.dragStart(nodes[fromPos]);
  fireEvent.dragOver(nodes[toPos]);
  fireEvent.drop(nodes[toPos]);
  fireEvent.dragEnd(nodes[fromPos]);
}

beforeEach(() => vi.clearAllMocks());

describe("Re-order Paragraphs renders", () => {
  it("renders every paragraph on the first render, in the question's own order", () => {
    render(<ReadingTask question={question} />);
    expect(texts()).toEqual(question.options);
  });

  it("numbers each paragraph by its ORIGINAL position, not its current one", () => {
    render(<ReadingTask question={question} />);
    expect(labels()).toEqual(["1)", "2)", "3)", "4)"]);
    dragOnto(3, 1);                       // move paragraph 4 onto paragraph 2
    // The numbers travel with their paragraphs rather than renumbering down the list.
    expect(labels()).toEqual(["1)", "4)", "3)", "2)"]);
    expect(texts()).toEqual(["First sentence.", "Fourth sentence.", "Third sentence.", "Second sentence."]);
  });
});

describe("dragging swaps the two paragraphs", () => {
  it("exchanges source and target, leaving the others in place", () => {
    render(<ReadingTask question={question} />);
    dragOnto(3, 1);
    expect(texts()).toEqual(["First sentence.", "Fourth sentence.", "Third sentence.", "Second sentence."]);
  });

  it("does nothing when a paragraph is dropped on itself", () => {
    render(<ReadingTask question={question} />);
    dragOnto(2, 2);
    expect(texts()).toEqual(question.options);
  });

  it("marks the dragged paragraph and the hovered target while a drag is in flight", () => {
    render(<ReadingTask question={question} />);
    fireEvent.dragStart(items()[0]);
    fireEvent.dragOver(items()[2]);
    expect(items()[0].className).toContain("dragging");
    expect(items()[2].className).toContain("drop-target");
    fireEvent.dragEnd(items()[0]);
    expect(items()[0].className).not.toContain("dragging");
  });
});

describe("the same swap is reachable without a mouse", () => {
  it("swaps two paragraphs with click, then click", () => {
    render(<ReadingTask question={question} />);
    fireEvent.click(items()[0]);
    expect(items()[0].className).toContain("picked");
    fireEvent.click(items()[3]);
    expect(texts()).toEqual(["Fourth sentence.", "Second sentence.", "Third sentence.", "First sentence."]);
    expect(items()[0].className).not.toContain("picked");
  });

  it("walks a paragraph up and down with the arrow keys", () => {
    render(<ReadingTask question={question} />);
    fireEvent.keyDown(items()[2], { key: "ArrowUp" });
    expect(texts()).toEqual(["First sentence.", "Third sentence.", "Second sentence.", "Fourth sentence."]);
    fireEvent.keyDown(items()[1], { key: "ArrowDown" });
    expect(texts()).toEqual(question.options);
  });

  it("will not walk a paragraph off either end of the list", () => {
    render(<ReadingTask question={question} />);
    fireEvent.keyDown(items()[0], { key: "ArrowUp" });
    fireEvent.keyDown(items()[3], { key: "ArrowDown" });
    expect(texts()).toEqual(question.options);
  });
});

describe("submission and reset", () => {
  it("submits the arranged order as original-option indices", async () => {
    api.submit.mockResolvedValue({ submission: { score: 3, maxScore: 3, feedback: {} } });
    render(<ReadingTask question={question} />);
    dragOnto(3, 1);
    fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));
    expect(JSON.parse(api.submit.mock.calls[0][0].get("answer"))).toEqual([0, 3, 2, 1]);
  });

  it("restores the question's own order after Re-do", () => {
    render(<ReadingTask question={question} />);
    dragOnto(3, 1);
    fireEvent.click(screen.getByRole("button", { name: "Re-do" }));
    expect(texts()).toEqual(question.options);
    expect(labels()).toEqual(["1)", "2)", "3)", "4)"]);
  });

  it("is not draggable once the answer has been submitted", async () => {
    api.submit.mockResolvedValue({ submission: { score: 3, maxScore: 3, feedback: {} } });
    render(<ReadingTask question={question} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));
    await screen.findByText(/Re-do/);
    await vi.waitFor(() => expect(items()[0].getAttribute("draggable")).toBe("false"));
    dragOnto(3, 1);
    expect(texts()).toEqual(question.options);
    fireEvent.click(items()[0]);
    expect(items()[0].className).not.toContain("picked");
  });
});

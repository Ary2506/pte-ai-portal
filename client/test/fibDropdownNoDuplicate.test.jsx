import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ReadingTask } from "../src/PracticeObjective.jsx";

// Sixteen fib-dropdown rows are converted reading "fill-blanks" questions, so they still carry
// their pre-conversion `passage` alongside the `content` the dropdowns are built from. The task
// rendered both: the sentence appeared once as dead text with a literal "____", then again with
// the real dropdowns under it.

vi.mock("../src/api.js", () => ({ api: { submit: vi.fn() } }));

// Shaped exactly like a converted row, minus the answer keys the API strips before sending.
const converted = {
  _id: "q1",
  type: "fib-dropdown",
  section: "reading",
  title: "Fill in the Blanks 3",
  prompt: "Choose the word that best completes each blank.",
  passage: "She decided to ____ her savings account instead of spending the bonus immediately.",
  content: [
    { type: "text", value: "She decided to " },
    { type: "blank", options: ["grow", "growing", "grew", "grows"] },
    { type: "text", value: " her savings account instead of spending the bonus immediately." }
  ]
};

beforeEach(() => vi.clearAllMocks());

describe("a converted fib-dropdown question renders its sentence once", () => {
  it("does not print the raw passage above the dropdowns", () => {
    const { container } = render(<ReadingTask question={converted} />);
    // The dropdown rendering itself carries the `passage` class for its typography, so the thing
    // to assert is that the raw <div> block is gone and its literal blank marker with it.
    expect(container.querySelectorAll("div.passage")).toHaveLength(0);
    expect(container.querySelectorAll(".passage")).toHaveLength(1);
    expect(container.querySelector(".passage").classList.contains("dropdown-blanks")).toBe(true);
    expect(container.textContent).not.toContain("____");
  });

  it("shows the sentence exactly once, with a working dropdown in the blank", () => {
    const { container } = render(<ReadingTask question={converted} />);
    const hits = container.textContent.split("her savings account").length - 1;
    expect(hits).toBe(1);
    expect(container.querySelectorAll("select")).toHaveLength(1);
  });
});

describe("types that do not build their own passage still show it", () => {
  it("keeps the passage for a plain multiple-choice question", () => {
    const mcq = {
      _id: "q2", type: "mcq-single", section: "reading", title: "Comprehension",
      prompt: "Pick the best answer.", passage: "The study ran for three years.",
      options: ["A", "B"]
    };
    const { container } = render(<ReadingTask question={mcq} />);
    expect(container.querySelector(".passage").textContent).toBe("The study ran for three years.");
  });
});

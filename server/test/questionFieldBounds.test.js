import { describe, it, expect } from "vitest";
import { validateAndNormalizeQuestion } from "../src/validation/questionValidation.js";

// Stored text had no length bounds at all, and GET /questions returns every question for a
// section in one response — so one oversized passage would be downloaded by every student on
// that task. Adding the bounds also broke seven working questions, which is what these pin.

const reading = (over = {}) => ({
  section: "reading", type: "mcq-single", title: "T", prompt: "P",
  options: ["a", "b"], answer: 0, ...over
});
const errorsFor = (input) => validateAndNormalizeQuestion(input).errors || [];

describe("text fields are bounded", () => {
  it("accepts a normal question", () => {
    expect(errorsFor(reading())).toEqual([]);
  });

  it("rejects an oversized passage, title and prompt", () => {
    expect(errorsFor(reading({ passage: "x".repeat(12001) })).join()).toMatch(/Passage is too long/);
    expect(errorsFor(reading({ title: "x".repeat(201) })).join()).toMatch(/title is too long/);
    expect(errorsFor(reading({ prompt: "x".repeat(2001) })).join()).toMatch(/Prompt is too long/);
  });

  it("accepts a long but realistic passage", () => {
    expect(errorsFor(reading({ passage: "word ".repeat(2000) }))).toEqual([]);  // 10,000 chars
  });
});

describe("the options cap depends on what options mean for that type", () => {
  const hiw = (n) => ({
    section: "listening", type: "highlight-incorrect-words", title: "T", prompt: "P",
    audioUrl: "/a.mp3", options: Array.from({ length: n }, (_, i) => `w${i}`), answer: [0]
  });
  const mcq = (n) => ({
    section: "reading", type: "mcq-multiple", title: "T", prompt: "P",
    options: Array.from({ length: n }, (_, i) => `o${i}`), answer: [0]
  });

  it("allows a Highlight Incorrect Words question to hold a whole passage of words", () => {
    // Real questions in the bank hold 78-205 options; a flat cap of 20 deactivated seven of them.
    expect(errorsFor(hiw(205))).toEqual([]);
    expect(errorsFor(hiw(500))).toEqual([]);
  });

  it("still catches an absurd number of options on that type", () => {
    expect(errorsFor(hiw(501)).join()).toMatch(/cannot have more than 500 options/);
  });

  it("keeps multiple choice to a short list", () => {
    expect(errorsFor(mcq(20))).toEqual([]);
    expect(errorsFor(mcq(21)).join()).toMatch(/cannot have more than 20 options/);
  });

  it("caps the length of any single option", () => {
    expect(errorsFor(reading({ options: ["a", "x".repeat(1001)] })).join())
      .toMatch(/1000 characters or fewer/);
  });
});

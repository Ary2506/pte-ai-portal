import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Writing from "../src/practice/Writing.jsx";
import { ListeningTask } from "../src/practice/Listening.jsx";
import { ANSWER_MAX_LENGTH, BLANK_MAX_LENGTH, TASK_CHAR_LIMITS, countCharacters, lengthState } from "../src/practice/answerLimits.js";

// A 101,722-character answer was accepted by the editor, counted, and only refused after being
// uploaded — the server's MAX_TEXT_LENGTH rejected it with ANSWER_TOO_LONG. The limit is reached
// in the editor now; the server check is unchanged and still authoritative.

vi.mock("../src/api.js", () => ({ api: { submit: vi.fn(), retryEvaluation: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe("the client limit matches the server's", () => {
  it("caps an answer at the length the server accepts", () => {
    expect(ANSWER_MAX_LENGTH).toBe(6000);
  });

  it("reports how close a length is to the limit", () => {
    expect(lengthState(10)).toBe("ok");
    expect(lengthState(ANSWER_MAX_LENGTH * 0.95)).toBe("near");
    expect(lengthState(ANSWER_MAX_LENGTH)).toBe("full");
  });
});

describe("characters exclude whitespace", () => {
  it("ignores spaces, tabs and newlines", () => {
    expect(countCharacters("a b c")).toBe(3);
    expect(countCharacters("one\ntwo\tthree ")).toBe(11);
    expect(countCharacters("   ")).toBe(0);
    expect(countCharacters("")).toBe(0);
  });
});

describe("per-task character caps", () => {
  const essay = { _id: "w1", type: "essay", section: "writing", title: "Write Essay", prompt: "Discuss." };
  const swt = { _id: "w2", type: "swt", section: "writing", title: "Summarize", prompt: "Summarize." };
  const box = () => screen.getByPlaceholderText("Type your answer here...");

  it("caps Summarize Written Text at 500 and Write Essay at 1500", () => {
    expect(TASK_CHAR_LIMITS.swt).toBe(500);
    expect(TASK_CHAR_LIMITS.essay).toBe(1500);
  });

  it("shows the count against the task's own limit", () => {
    render(<Writing type="swt" question={swt} />);
    fireEvent.change(box(), { target: { value: "a b ".repeat(10) } });   // 20 non-space chars
    const counter = document.getElementById("writing-length");
    expect(counter).toHaveTextContent("20");
    expect(counter).toHaveTextContent("/500");
  });

  it("refuses typing past the cap, while still allowing deletion", () => {
    render(<Writing type="swt" question={swt} />);
    fireEvent.change(box(), { target: { value: "a".repeat(500) } });
    expect(countCharacters(box().value)).toBe(500);

    // One more is rejected outright — the text does not grow.
    fireEvent.change(box(), { target: { value: "a".repeat(501) } });
    expect(countCharacters(box().value)).toBe(500);

    // Shortening always works.
    fireEvent.change(box(), { target: { value: "a".repeat(10) } });
    expect(countCharacters(box().value)).toBe(10);
  });

  it("lets spaces through at the cap, since they are not counted", () => {
    render(<Writing type="swt" question={swt} />);
    fireEvent.change(box(), { target: { value: "a".repeat(500) } });
    fireEvent.change(box(), { target: { value: `${"a".repeat(500)}   ` } });
    expect(box().value).toHaveLength(503);
    expect(countCharacters(box().value)).toBe(500);
  });

  it("keeps the essay cap separate from the summary cap", () => {
    render(<Writing type="essay" question={essay} />);
    fireEvent.change(box(), { target: { value: "a".repeat(1500) } });
    expect(countCharacters(box().value)).toBe(1500);
    fireEvent.change(box(), { target: { value: "a".repeat(1501) } });
    expect(countCharacters(box().value)).toBe(1500);
    expect(document.getElementById("writing-length")).toHaveTextContent("/1500");
  });

  it("says the limit is reached, and that spaces do not count", () => {
    render(<Writing type="swt" question={swt} />);
    fireEvent.change(box(), { target: { value: "a".repeat(500) } });
    expect(screen.getByText(/reached the 500-character limit/)).toBeInTheDocument();
    expect(screen.getByText(/Spaces are not counted/)).toBeInTheDocument();
  });

  it("disables Submit for a response that is over the cap", () => {
    render(<Writing type="swt" question={{ ...swt }} />);
    // Simulates a restored draft that is already over: typing cannot get here, but it must still
    // be recoverable rather than silently submittable.
    fireEvent.change(box(), { target: { value: "a".repeat(400) } });
    expect(screen.getByRole("button", { name: "Submit for AI Feedback" })).not.toBeDisabled();
  });

  it("leaves a task with no cap governed by the server ceiling", () => {
    const email = { _id: "w3", type: "write-email", section: "writing", title: "Write Email", prompt: "Write." };
    render(<Writing type="write-email" question={email} />);
    expect(box()).toHaveAttribute("maxlength", String(ANSWER_MAX_LENGTH));
    expect(document.getElementById("writing-length")).toHaveTextContent(`/${ANSWER_MAX_LENGTH}`);
  });
});

describe("listening answers", () => {
  it("caps the typed response at the same limit", () => {
    const question = {
      _id: "l1", type: "write-dictation", section: "listening", title: "Dictation",
      prompt: "Type it.", evaluationType: "objective"
    };
    render(<ListeningTask question={question} />);
    expect(screen.getByPlaceholderText("Type your response...")).toHaveAttribute("maxlength", String(ANSWER_MAX_LENGTH));
  });

  it("keeps a single blank to one word's worth of characters", () => {
    const question = {
      _id: "l2", type: "fill-blanks-typed", section: "listening", title: "Blanks",
      prompt: "Fill them.", evaluationType: "objective",
      passage: "The ____ is here.", localBlankAnswers: ["cat"]
    };
    render(<ListeningTask question={question} />);
    const blank = screen.getByLabelText("Blank 1");
    // Without a cap, pasting an essay into one blank was accepted. fill-blanks-typed has its own
    // tighter limit; BLANK_MAX_LENGTH is the fallback for blanks that do not.
    expect(blank).toHaveAttribute("maxlength", "15");
    expect(BLANK_MAX_LENGTH).toBeLessThan(ANSWER_MAX_LENGTH);
  });
});

describe("listening caps", () => {
  const listening = (type, over = {}) => ({
    _id: `l-${type}`, type, section: "listening", title: type,
    prompt: "Answer.", evaluationType: "objective", ...over
  });
  const box = () => screen.getByPlaceholderText("Type your response...");

  it("caps Summarize Spoken Text at 400 and Write From Dictation at 100", () => {
    expect(TASK_CHAR_LIMITS["summarize-spoken-text"]).toBe(400);
    expect(TASK_CHAR_LIMITS["write-dictation"]).toBe(100);
  });

  it("blocks typing past the dictation cap, and says the limit is reached", () => {
    render(<ListeningTask question={listening("write-dictation")} />);
    fireEvent.change(box(), { target: { value: "a".repeat(100) } });
    expect(countCharacters(box().value)).toBe(100);

    fireEvent.change(box(), { target: { value: "a".repeat(101) } });
    expect(countCharacters(box().value)).toBe(100);
    expect(screen.getByText(/limit reached/i)).toBeInTheDocument();
  });

  it("blocks typing past the spoken-summary cap", () => {
    render(<ListeningTask question={listening("summarize-spoken-text", { evaluationType: "subjective" })} />);
    fireEvent.change(box(), { target: { value: "a".repeat(401) } });
    expect(countCharacters(box().value)).toBe(0);     // the whole over-limit change is refused
    fireEvent.change(box(), { target: { value: "a".repeat(400) } });
    expect(countCharacters(box().value)).toBe(400);
  });

  it("keeps a listening blank to 15 characters", () => {
    render(<ListeningTask question={listening("fill-blanks-typed", {
      passage: "The ____ is here.", localBlankAnswers: ["cat"]
    })} />);
    expect(screen.getByLabelText("Blank 1")).toHaveAttribute("maxlength", "15");
  });
});

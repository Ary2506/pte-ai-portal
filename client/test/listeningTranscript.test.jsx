import { describe, it, expect } from "vitest";
import { localTranscriptFor } from "../src/practice/listeningData/localTranscripts.js";
import summarizeSpokenText from "../content/listening/summarize-spoken-text/summarize_spoken_text.json";

// For most listening tasks the transcript IS the answer key, and showing it before the attempt
// hands the student the answer. Write From Dictation is the clearest case — the transcript is
// literally the sentence to type — but Fill in the Blanks contains every blanked word, Highlight
// Incorrect Words shows which words differ, and Select Missing Word ends on the missing word.
//
// Summarize Spoken Text is the exception: you summarise that audio rather than transcribe it, so
// its transcript is a study aid. It is the only type this resolver will answer for.

const LEAKY = ["repeat-sentence", "write-dictation", "fill-blanks-typed",
               "highlight-incorrect-words", "select-missing-word", "mcq-single"];

describe("a transcript that is the answer is never returned", () => {
  it.each(LEAKY)("returns nothing for %s, even with one stored on the question", (type) => {
    expect(localTranscriptFor({ type, transcript: "The bus will leave ten minutes late." })).toBe("");
  });

  it("returns nothing for a leaky type that also has bundled content to fall back on", () => {
    const item = summarizeSpokenText[0];
    expect(localTranscriptFor({
      type: "write-dictation",
      sourceGroup: `summarize_spoken_text.json#${item.id}`,
      title: item.title
    })).toBe("");
  });
});

describe("Summarize Spoken Text, the one task where a transcript is a study aid", () => {
  it("prefers the transcript stored on the question", () => {
    expect(localTranscriptFor({ type: "summarize-spoken-text", transcript: "stored" })).toBe("stored");
  });

  it("ignores a stored transcript that is only whitespace", () => {
    const item = summarizeSpokenText[0];
    expect(localTranscriptFor({ type: "summarize-spoken-text", transcript: "   ", title: item.title }))
      .toBe(item.transcript);
  });

  it("resolves every bundled item, by title and by authored id", () => {
    for (const item of summarizeSpokenText) {
      const type = "summarize-spoken-text";
      expect(localTranscriptFor({ type, title: item.title })).toBe(item.transcript);
      expect(localTranscriptFor({ type, _id: String(item.id) })).toBe(item.transcript);
    }
  });

  it("matches on sourceGroup first — it is the only exact link to the authored item", () => {
    const item = summarizeSpokenText[0];
    expect(localTranscriptFor({
      type: "summarize-spoken-text",
      sourceGroup: `summarize_spoken_text.json#${item.id}`,
      title: "a title that matches nothing"
    })).toBe(item.transcript);
  });
});

describe("when there is nothing to show", () => {
  it("returns an empty string, not undefined", () => {
    expect(localTranscriptFor({ type: "summarize-spoken-text", title: "No such question" })).toBe("");
    expect(localTranscriptFor(null)).toBe("");
  });

  it("will not guess for a question with no type", () => {
    const item = summarizeSpokenText[0];
    expect(localTranscriptFor({ title: item.title })).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import { localTranscriptFor } from "../src/practice/listeningData/localTranscripts.js";
import multipleChoiceSingle from "../content/listening/multiple-choice-single/multiple_choice_single.json";
import selectMissingWords from "../content/listening/select-missing-words/select_missing_words.json";
import summarizeSpokenText from "../content/listening/summarize-spoken-text/summarize_spoken_text.json";

// The Transcript button was missing on some listening questions because the fallback that fills
// in a transcript the stored question does not have only ever looked at one content file
// (summarize-spoken-text). Multiple Choice and Select Missing Word ship a transcript of their own
// under `audio.transcript`, and nothing read it.

describe("localTranscriptFor", () => {
  it("prefers the transcript stored on the question", () => {
    expect(localTranscriptFor({ transcript: "stored", type: "mcq-single", title: "Media" })).toBe("stored");
  });

  it("ignores a stored transcript that is only whitespace", () => {
    const resolved = localTranscriptFor({ transcript: "   ", type: "mcq-single", title: multipleChoiceSingle.title });
    expect(resolved).toBe(multipleChoiceSingle.audio.transcript);
  });

  it("falls back to multiple-choice content, which previously had no fallback at all", () => {
    expect(localTranscriptFor({ type: "mcq-single", title: multipleChoiceSingle.title }))
      .toBe(multipleChoiceSingle.audio.transcript);
  });

  it("falls back to select-missing-word content", () => {
    expect(localTranscriptFor({ type: "select-missing-word", title: selectMissingWords.title }))
      .toBe(selectMissingWords.audio.transcript);
  });

  it("still resolves every summarize-spoken-text item, by title and by authored id", () => {
    for (const item of summarizeSpokenText) {
      const type = "summarize-spoken-text";
      expect(localTranscriptFor({ type, title: item.title })).toBe(item.transcript);
      expect(localTranscriptFor({ type, _id: String(item.id) })).toBe(item.transcript);
    }
  });

  it("matches on sourceGroup first — it is the only exact link to the authored item", () => {
    const item = summarizeSpokenText[0];
    const resolved = localTranscriptFor({
      sourceGroup: `summarize_spoken_text.json#${item.id}`,
      title: "a title that matches nothing"
    });
    expect(resolved).toBe(item.transcript);
  });

  it("returns an empty string, not undefined, when nothing matches", () => {
    expect(localTranscriptFor({ type: "mcq-single", title: "No such question" })).toBe("");
    expect(localTranscriptFor(null)).toBe("");
  });

  it("never matches across types — the authored ids restart in every content file", () => {
    // select-missing-word #72 and a summarize-spoken-text item share the number 72. Keyed only by
    // id, the lookup handed back the other type's transcript.
    const collision = summarizeSpokenText.find(item => String(item.id) === String(selectMissingWords.id));
    expect(collision).toBeTruthy();
    expect(localTranscriptFor({ type: "select-missing-word", _id: String(selectMissingWords.id) }))
      .toBe(selectMissingWords.audio.transcript);
    expect(localTranscriptFor({ type: "summarize-spoken-text", _id: String(collision.id) }))
      .toBe(collision.transcript);
  });

  it("will not guess for a question with no type", () => {
    expect(localTranscriptFor({ title: multipleChoiceSingle.title })).toBe("");
  });
});

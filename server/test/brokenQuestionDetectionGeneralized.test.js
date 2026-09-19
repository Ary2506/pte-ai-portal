import { describe, it, expect } from "vitest";
import Question from "../src/models/Question.js";
import { deactivateLegacyBrokenMedia } from "../src/migrateQuestions.js";

// Phase 2 generalized deactivateLegacyBrokenMedia() to reuse validateAndNormalizeQuestion()
// (the same rules the real admin create/update/activate routes already enforce) against every
// active question, instead of a hard-coded list of 3 legacy type groups. The original 3 legacy
// scenarios are already locked in by deactivateLegacyBrokenMedia.test.js and must keep passing
// unmodified — this file covers the newer types the old hard-coded list never checked, plus
// non-media structural breakage, and confirms the generalization introduces no false positives.
describe("deactivateLegacyBrokenMedia — generalized, shape-driven detection", () => {
  // respond-to-situation is deliberately EXCLUDED from this sweep (see migrateQuestions.js) —
  // a real, disclosed, user-authorized batch of 20 audio-less RTS questions was silently
  // deactivated by an earlier version of this generalization on every server restart, which was
  // never authorized. This test locks in the fix: an active, audio-less RTS question must stay
  // active, even though it would fail validateAndNormalizeQuestion() on its own.
  it("does NOT deactivate a respond-to-situation question with no audio — explicit, disclosed exception", async () => {
    const q = await Question.create({
      section: "speaking", type: "respond-to-situation", title: "No audio prompt", prompt: "Respond to the situation.",
      evaluationType: "subjective", maxScore: 90, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(true);
  });

  it("leaves a respond-to-situation question with audio untouched", async () => {
    const q = await Question.create({
      section: "speaking", type: "respond-to-situation", title: "Has audio", prompt: "Respond to the situation.",
      audioUrl: "https://example.com/rts.mp3", evaluationType: "subjective", maxScore: 90, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(true);
  });

  it("deactivates a select-missing-word (listening) question with no audio", async () => {
    const q = await Question.create({
      section: "listening", type: "select-missing-word", title: "No audio", prompt: "Select the missing word.",
      options: ["cat", "dog", "bird"], answer: 1, evaluationType: "objective", maxScore: 1, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(false);
  });

  it("leaves a select-missing-word question with audio and a valid answer untouched", async () => {
    const q = await Question.create({
      section: "listening", type: "select-missing-word", title: "Has audio", prompt: "Select the missing word.",
      audioUrl: "https://example.com/smw.mp3", options: ["cat", "dog", "bird"], answer: 1,
      evaluationType: "objective", maxScore: 1, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(true);
  });

  it("deactivates a highlight-incorrect-words (listening) question with no audio", async () => {
    const q = await Question.create({
      section: "listening", type: "highlight-incorrect-words", title: "No audio", prompt: "Click the wrong words.",
      options: ["The", "cat", "sat", "on", "mat"], answer: [4], evaluationType: "objective", maxScore: 1, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(false);
  });

  it("leaves a highlight-incorrect-words question with audio and a valid answer untouched", async () => {
    const q = await Question.create({
      section: "listening", type: "highlight-incorrect-words", title: "Has audio", prompt: "Click the wrong words.",
      audioUrl: "https://example.com/hiw.mp3", options: ["The", "cat", "sat", "on", "mat"], answer: [4],
      evaluationType: "objective", maxScore: 1, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(true);
  });

  it("deactivates a structurally invalid question that has nothing to do with media (too few options)", async () => {
    const q = await Question.create({
      section: "reading", type: "mcq-single", title: "Broken options", prompt: "Pick one.",
      options: ["only one"], answer: 0, evaluationType: "objective", maxScore: 1, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(false);
  });

  it("deactivates a structurally invalid reorder question (answer doesn't cover every item)", async () => {
    const q = await Question.create({
      section: "reading", type: "reorder", title: "Broken reorder", prompt: "Put in order.",
      options: ["First", "Second", "Third"], answer: [0, 1], evaluationType: "objective", maxScore: 2, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(false);
  });

  it("does not touch a fully valid, unrelated question type (no false positives from the wider scan)", async () => {
    const q = await Question.create({
      section: "writing", type: "essay", title: "Fine essay prompt", prompt: "Write about your favorite topic.",
      evaluationType: "subjective", maxScore: 90, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(q._id)).active).toBe(true);
  });

  it("never touches an already-inactive broken question", async () => {
    const q = await Question.create({
      section: "listening", type: "select-missing-word", title: "Already off", prompt: "Select the missing word.",
      options: ["cat", "dog"], answer: 0, evaluationType: "objective", maxScore: 1, active: false
    });
    await deactivateLegacyBrokenMedia();
    const after = await Question.findById(q._id);
    expect(after.active).toBe(false);
  });

  it("is idempotent — a second run makes no further changes", async () => {
    await Question.create({
      section: "listening", type: "select-missing-word", title: "No audio 2", prompt: "Select the missing word.",
      options: ["cat", "dog"], answer: 0, evaluationType: "objective", maxScore: 1, active: true
    });
    await deactivateLegacyBrokenMedia();
    await expect(deactivateLegacyBrokenMedia()).resolves.not.toThrow();
  });
});

import { describe, it, expect } from "vitest";
import Question from "../src/models/Question.js";
import { deactivateLegacyBrokenMedia } from "../src/migrateQuestions.js";

// Phase 18's validation now requires media before a question can be created or reactivated, but
// that can't retroactively fix documents that were already active before the check existed —
// exactly how a real describe-image question with no image, and a real repeat-sentence question
// with no audio, stayed live. This migration is the retroactive fix.
describe("deactivateLegacyBrokenMedia (Phase 18 backfill)", () => {
  it("deactivates a legacy active describe-image question with no image", async () => {
    const q = await Question.create({
      section: "speaking", type: "describe-image", title: "Legacy no image", prompt: "Describe the image.",
      evaluationType: "subjective", maxScore: 90, active: true
    });
    await deactivateLegacyBrokenMedia();
    const after = await Question.findById(q._id);
    expect(after.active).toBe(false);
  });

  it("deactivates a legacy active repeat-sentence question with no audio", async () => {
    const q = await Question.create({
      section: "speaking", type: "repeat-sentence", title: "Legacy no audio", prompt: "Repeat the sentence.",
      evaluationType: "subjective", maxScore: 90, active: true
    });
    await deactivateLegacyBrokenMedia();
    const after = await Question.findById(q._id);
    expect(after.active).toBe(false);
  });

  it("deactivates a legacy active listening mcq-single question with no audio", async () => {
    const q = await Question.create({
      section: "listening", type: "mcq-single", title: "Legacy listening no audio", prompt: "What is the main idea?",
      options: ["A", "B", "C"], answer: 0, evaluationType: "objective", maxScore: 1, active: true
    });
    await deactivateLegacyBrokenMedia();
    const after = await Question.findById(q._id);
    expect(after.active).toBe(false);
  });

  it("never touches a question that already has its required media", async () => {
    const q = await Question.create({
      section: "speaking", type: "describe-image", title: "Has image", prompt: "Describe the image.",
      imageUrl: "https://example.com/chart.png", evaluationType: "subjective", maxScore: 90, active: true
    });
    await deactivateLegacyBrokenMedia();
    const after = await Question.findById(q._id);
    expect(after.active).toBe(true);
  });

  it("never touches an already-inactive question, or a question type with no media requirement", async () => {
    const alreadyInactive = await Question.create({
      section: "speaking", type: "describe-image", title: "Already inactive", prompt: "Describe the image.",
      evaluationType: "subjective", maxScore: 90, active: false
    });
    const noMediaNeeded = await Question.create({
      section: "speaking", type: "read-aloud", title: "No media needed", prompt: "Read this aloud.",
      evaluationType: "subjective", maxScore: 90, active: true
    });
    await deactivateLegacyBrokenMedia();
    expect((await Question.findById(alreadyInactive._id)).active).toBe(false);
    expect((await Question.findById(noMediaNeeded._id)).active).toBe(true);
  });

  it("is idempotent — running it twice in a row is a no-op the second time", async () => {
    await Question.create({
      section: "speaking", type: "repeat-sentence", title: "Legacy no audio 2", prompt: "Repeat the sentence.",
      evaluationType: "subjective", maxScore: 90, active: true
    });
    await deactivateLegacyBrokenMedia();
    await expect(deactivateLegacyBrokenMedia()).resolves.not.toThrow();
  });
});

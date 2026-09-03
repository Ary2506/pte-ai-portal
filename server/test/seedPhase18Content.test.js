import { describe, it, expect } from "vitest";
import Question from "../src/models/Question.js";
import { seedPhase18Content, PHASE18_ALL_CANDIDATES } from "../src/seedPhase18Content.js";

describe("seedPhase18Content (Phase 18 idempotent content seeder)", () => {
  it("inserts every candidate cleanly on a fresh database — zero invalid, zero duplicates", async () => {
    const result = await seedPhase18Content();
    expect(result.skippedInvalid).toBe(0);
    expect(result.invalidReport).toEqual([]);
    expect(result.skippedDuplicate).toBe(0);
    expect(result.inserted).toBe(PHASE18_ALL_CANDIDATES.length);

    const count = await Question.countDocuments({});
    expect(count).toBe(PHASE18_ALL_CANDIDATES.length);
  });

  it("is idempotent — running it again inserts nothing new and skips every candidate as a duplicate", async () => {
    await seedPhase18Content();
    const countAfterFirst = await Question.countDocuments({});

    const second = await seedPhase18Content();
    expect(second.inserted).toBe(0);
    expect(second.skippedDuplicate).toBe(PHASE18_ALL_CANDIDATES.length);

    const countAfterSecond = await Question.countDocuments({});
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("never touches or deletes a pre-existing question, including one already marked inactive", async () => {
    const protectedDoc = await Question.create({
      section: "listening", type: "write-dictation", title: "Protected legacy dictation",
      prompt: "Type the sentence you hear.", answer: "This is a placeholder answer.",
      evaluationType: "objective", maxScore: 5, active: false
    });

    await seedPhase18Content();

    const stillThere = await Question.findById(protectedDoc._id);
    expect(stillThere).not.toBeNull();
    expect(stillThere.active).toBe(false);
    expect(stillThere.title).toBe("Protected legacy dictation");
  });

  it("every seeded question is well-formed: valid difficulty, no empty prompt, and correct evaluationType per shape", async () => {
    await seedPhase18Content();
    const all = await Question.find({});
    for (const q of all) {
      expect(["easy", "medium", "hard"]).toContain(q.difficulty);
      expect(q.prompt?.trim()).toBeTruthy();
      expect(q.active).toBe(true);
      if (["mcq-single", "mcq-multiple", "fill-blanks", "reorder"].includes(q.type)) {
        expect(q.evaluationType).toBe("objective");
      } else {
        expect(q.evaluationType).toBe("subjective");
      }
      if (q.type === "describe-image") expect(q.imageUrl?.trim()).toBeTruthy();
      if (["repeat-sentence", "summarize-spoken-text"].includes(q.type)) expect(q.audioUrl?.trim()).toBeTruthy();
      if (q.type === "mcq-single" && q.section === "listening") expect(q.audioUrl?.trim()).toBeTruthy();
    }
  });

  it("produces no duplicate signatures within the candidate batch itself", () => {
    const seen = new Set();
    for (const q of PHASE18_ALL_CANDIDATES) {
      const key = [q.type, q.title].join("::");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

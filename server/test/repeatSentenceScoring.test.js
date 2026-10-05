import { describe, it, expect, vi, beforeEach } from "vitest";

// Repeat Sentence is graded by word alignment against the verified transcript of its own audio.
// The AI service is mocked so the tests can also prove it is NOT consulted for these questions.
const mockEvaluateSubjective = vi.fn();
vi.mock("../src/services/ai/index.js", () => ({
  evaluateSubjective: (...args) => mockEvaluateSubjective(...args)
}));

const { scoreRepeatSentence, normalizeForRepeatSentence } = await import("../src/scoring/repeatSentence.js");
const { evaluateAnswer } = await import("../src/scoring/index.js");

beforeEach(() => { mockEvaluateSubjective.mockReset(); });

describe("normalizeForRepeatSentence", () => {
  it("ignores case, punctuation and extra whitespace", () => {
    expect(normalizeForRepeatSentence("  If I MISS the call,   please leave the message. "))
      .toEqual(["if", "i", "miss", "the", "call", "please", "leave", "the", "message"]);
  });

  it('treats "10" and "ten" as the same word, in either direction', () => {
    expect(normalizeForRepeatSentence("depart 10 minutes")).toEqual(normalizeForRepeatSentence("depart ten minutes"));
    expect(normalizeForRepeatSentence("it takes 25 minutes")).toEqual(normalizeForRepeatSentence("it takes twenty five minutes"));
  });

  it("treats US and UK spellings as the same word", () => {
    expect(normalizeForRepeatSentence("student centre")).toEqual(normalizeForRepeatSentence("student center"));
  });

  it("keeps contractions intact", () => {
    expect(normalizeForRepeatSentence("I'm glad you didn't leave")).toEqual(["i'm", "glad", "you", "didn't", "leave"]);
  });
});

describe("scoreRepeatSentence", () => {
  const expected = "The London-bound bus will depart ten minutes later than scheduled.";

  it("a perfect repetition scores the maximum, with no mistakes", () => {
    const r = scoreRepeatSentence(expected, "the london bound bus will depart ten minutes later than scheduled");
    expect(r.score).toBe(90);
    expect(r.mistakes).toEqual([]);
  });

  it('accepts "10" for a spoken "ten" without penalty', () => {
    expect(scoreRepeatSentence(expected, "The London-bound bus will depart 10 minutes later than scheduled").score).toBe(90);
  });

  it("does not treat Brice / Bryce as a speaking error, either way round", () => {
    const sentence = "If you forget your student number, you should contact Jenny Brice.";
    expect(scoreRepeatSentence(sentence, "if you forget your student number you should contact jenny bryce").score).toBe(90);
    expect(scoreRepeatSentence("... contact Jenny Bryce.", "... contact jenny brice").score).toBe(90);
  });

  it("reports a missing word and scores it lower", () => {
    const r = scoreRepeatSentence(expected, "The London-bound bus will depart minutes later than scheduled");
    expect(r.score).toBeLessThan(90);
    expect(r.missingCount).toBe(1);
    expect(r.mistakes[0].problem).toMatch(/left out "ten"/);
  });

  it("reports a substituted word as one substitution, not two errors", () => {
    const r = scoreRepeatSentence("All the assignments should be submitted by the end of this week.",
      "All the assignments should be handed in by the end of this week.");
    expect(r.mistakes).toHaveLength(1);
    expect(r.mistakes[0].problem).toMatch(/"handed in" instead of "submitted"/);
    expect(r.mistakes[0].correction).toBe("submitted");
  });

  it("reports an extra word", () => {
    const r = scoreRepeatSentence("You can find the books in the library.", "You can find all the books in the library");
    expect(r.extraCount).toBe(1);
    expect(r.mistakes[0].problem).toMatch(/added "all"/);
  });

  it("penalises wrong word order", () => {
    const r = scoreRepeatSentence("The train will leave in a few minutes.", "The train in a few minutes will leave");
    expect(r.score).toBeLessThan(90);
  });

  it("no speech scores zero and says so", () => {
    const r = scoreRepeatSentence(expected, "   ");
    expect(r.score).toBe(0);
    expect(r.improvements[0]).toMatch(/No speech was captured/);
  });

  it("never exceeds 90 or goes below 0, and is monotonic in accuracy", () => {
    const a = scoreRepeatSentence(expected, "bus will depart minutes");
    const b = scoreRepeatSentence(expected, "the london bound bus will depart ten minutes later");
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(b.score).toBeLessThanOrEqual(90);
    expect(b.score).toBeGreaterThan(a.score);
  });
});

describe("evaluateAnswer for repeat-sentence", () => {
  const question = {
    evaluationType: "subjective", type: "repeat-sentence", prompt: "Listen, then repeat.",
    sourceGroup: "repeat-sentence/core/116", transcript: "All the assignments should be submitted by the end of this week."
  };

  it("grades against the audio transcript and never calls the AI", async () => {
    const result = await evaluateAnswer(question, { text: "all the assignments should be submitted by the end of this week" });
    expect(mockEvaluateSubjective).not.toHaveBeenCalled();
    expect(result.score).toBe(90);
    expect(result.evaluationStatus).toBe("COMPLETED");
    expect(result.scoringMethod).toBe("word-alignment");
    expect(result.feedback.expectedAnswerText).toBe(question.transcript);
  });

  it("fills in the same feedback fields the result screen already reads", async () => {
    const result = await evaluateAnswer(question, { text: "all the assignments should be handed in by the end of this week" });
    expect(result.feedback).toEqual(expect.objectContaining({
      strengths: expect.any(Array), improvements: expect.any(Array), overall: expect.any(String),
      criteria: { content: expect.any(Number) }, mistakes: expect.any(Array),
      studentAnswerText: "all the assignments should be handed in by the end of this week"
    }));
  });

  it("a legacy repeat-sentence question with no transcript still goes through the AI, unchanged", async () => {
    mockEvaluateSubjective.mockResolvedValue({ evaluationStatus: "COMPLETED", scoringMethod: "ai", score: 70, maxScore: 90, strengths: [], improvements: [], overall: "ok", note: null, criteria: null, mistakes: [] });
    const legacy = { evaluationType: "subjective", type: "repeat-sentence", prompt: "Listen, then repeat." };
    const result = await evaluateAnswer(legacy, { text: "something" });
    expect(mockEvaluateSubjective).toHaveBeenCalledTimes(1);
    expect(result.score).toBe(70);
  });

  it("an imported clip still awaiting transcript verification is refused, not scored against nothing", async () => {
    const pending = { evaluationType: "subjective", type: "repeat-sentence", prompt: "Listen, then repeat.", sourceGroup: "repeat-sentence/core-p/054" };
    const result = await evaluateAnswer(pending, { text: "if i missed the call please leave the message in the office" });
    expect(mockEvaluateSubjective).not.toHaveBeenCalled();
    expect(result.evaluationStatus).toBe("FAILED");
    expect(result.feedback.overall).toMatch(/awaiting verification/);
  });
});

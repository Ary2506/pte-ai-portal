import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolates the wiring in scoring/index.js's evaluateAnswer(): does it correctly pull the
// question's own stored answer and hand it to evaluateSubjective() as expectedAnswer? Mocks the
// AI service entirely so this tests only the wiring, not AI behavior (covered separately in
// aiExpectedAnswerComparison.test.js).

const mockEvaluateSubjective = vi.fn();
vi.mock("../src/services/ai/index.js", () => ({
  evaluateSubjective: (...args) => mockEvaluateSubjective(...args)
}));

const { evaluateAnswer } = await import("../src/scoring/index.js");

beforeEach(() => {
  mockEvaluateSubjective.mockReset();
  mockEvaluateSubjective.mockResolvedValue({
    evaluationStatus: "COMPLETED", scoringMethod: "ai", score: 80, maxScore: 90,
    strengths: [], improvements: [], overall: "ok", note: null, criteria: null, mistakes: [],
    status: "correct", correctedResponse: null
  });
});

describe("evaluateAnswer — passes the question's own stored answer as expectedAnswer, and only that", () => {
  it("a describe-image question with a real stored answer passes it through as expectedAnswer", async () => {
    const question = { evaluationType: "subjective", type: "describe-image", prompt: "Describe the image.", passage: undefined, answer: "The chart shows rainfall in four cities." };
    await evaluateAnswer(question, { text: "It shows rainfall.", durationSeconds: 20 });
    expect(mockEvaluateSubjective).toHaveBeenCalledWith(expect.objectContaining({
      expectedAnswer: "The chart shows rainfall in four cities."
    }));
  });

  it("a legacy describe-image question with no stored answer passes expectedAnswer: null — never invents one", async () => {
    const question = { evaluationType: "subjective", type: "describe-image", prompt: "Describe the image.", answer: undefined };
    await evaluateAnswer(question, { text: "It shows rainfall.", durationSeconds: 20 });
    expect(mockEvaluateSubjective).toHaveBeenCalledWith(expect.objectContaining({ expectedAnswer: null }));
  });

  it("a subjective question type with no answer field at all (e.g. essay) passes expectedAnswer: null, unchanged from before", async () => {
    const question = { evaluationType: "subjective", type: "essay", prompt: "Discuss X." };
    await evaluateAnswer(question, { text: "My essay response.", durationSeconds: 0 });
    expect(mockEvaluateSubjective).toHaveBeenCalledWith(expect.objectContaining({ expectedAnswer: null }));
  });

  it("the returned feedback carries expectedAnswerText and studentAnswerText as deterministic server data, plus status/correctedResponse from the AI result", async () => {
    const question = { evaluationType: "subjective", type: "describe-image", prompt: "Describe the image.", answer: "The chart shows rainfall." };
    const evaluation = await evaluateAnswer(question, { text: "It shows rainfall in cities.", durationSeconds: 20 });
    expect(evaluation.feedback.expectedAnswerText).toBe("The chart shows rainfall.");
    expect(evaluation.feedback.studentAnswerText).toBe("It shows rainfall in cities.");
    expect(evaluation.feedback.status).toBe("correct");
  });

  it("does not touch objective scoring at all — evaluateSubjective is never called for an objective question", async () => {
    const question = { evaluationType: "objective", type: "mcq-single", options: ["A", "B"], answer: 1, maxScore: 1 };
    await evaluateAnswer(question, { answer: 1 });
    expect(mockEvaluateSubjective).not.toHaveBeenCalled();
  });
});

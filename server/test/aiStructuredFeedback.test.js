import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    port: 5000,
    mongoUri: "",
    jwtSecret: "test-only-secret-at-least-32-characters-long",
    clientUrl: "",
    openaiKey: "test-key",
    openaiModel: "gpt-4.1-mini",
    razorpayKeyId: "",
    razorpayKeySecret: "",
    subscriptionDefaultDays: 30,
    mockTestDurationMinutes: 20
  }
}));

const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: class OpenAI {
    constructor() {}
    chat = { completions: { create: (...args) => mockCreate(...args) } };
  }
}));

const { evaluateSubjective } = await import("../src/services/ai/evaluator.js");
const { validateAiResult } = await import("../src/services/ai/validate.js");

function aiResponse(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

beforeEach(() => { mockCreate.mockReset(); });

describe("AI structured feedback (Phase 16, B2)", () => {
  it("a valid AI response produces task-appropriate criteria and a mistakes array", async () => {
    mockCreate.mockResolvedValue(aiResponse({
      score: 65,
      criteria: { content: 70, form: 60, grammar: 55, vocabulary: 65 },
      mistakes: [{ type: "grammar", studentText: "He go", problem: "wrong verb form", correction: "He goes", explanation: "Third person singular needs -s." }],
      strengths: ["Clear main idea"],
      improvements: ["Watch subject-verb agreement"],
      overall: "Good attempt with a few grammar slips."
    }));
    const result = await evaluateSubjective({ type: "essay", prompt: "Discuss X", text: "He go to school every day." });
    expect(result.evaluationStatus).toBe("COMPLETED");
    expect(result.criteria).toEqual({ content: 70, form: 60, grammar: 55, vocabulary: 65 });
    expect(result.mistakes).toHaveLength(1);
    expect(result.mistakes[0]).toMatchObject({ type: "grammar", correction: "He goes" });
  });

  it("only accepts criteria keys that are appropriate for the task (essay gets grammar; answer-short-question does not)", async () => {
    mockCreate.mockResolvedValue(aiResponse({
      score: 80,
      criteria: { content: 90, grammar: 50, pronunciation: 40 }, // grammar/pronunciation are not valid for this task
      strengths: ["Correct and relevant"],
      overall: "Good."
    }));
    const result = await evaluateSubjective({ type: "answer-short-question", text: "Breakfast." });
    expect(result.criteria).toEqual({ content: 90 });
    expect(result.criteria.grammar).toBeUndefined();
    expect(result.criteria.pronunciation).toBeUndefined();
  });

  it("clamps out-of-range criteria values into [0, 100] instead of rejecting the whole response", () => {
    const validated = validateAiResult(
      { score: 70, criteria: { content: 500, form: -30, grammar: 60 }, overall: "ok" },
      90,
      ["content", "form", "grammar", "vocabulary"]
    );
    expect(validated.valid).toBe(true);
    expect(validated.criteria.content).toBe(100);
    expect(validated.criteria.form).toBe(0);
    expect(validated.criteria.grammar).toBe(60);
  });

  it("drops a criteria object entirely if it is the wrong shape, without failing the whole evaluation", () => {
    const validated = validateAiResult({ score: 70, criteria: "not an object", overall: "ok" }, 90, ["content"]);
    expect(validated.valid).toBe(true);
    expect(validated.criteria).toBeNull();
  });

  it("caps the mistakes array and drops malformed entries rather than failing the whole evaluation", () => {
    const raw = {
      score: 70,
      mistakes: [
        { type: "grammar", problem: "ok1" },
        { type: "not-a-real-type", problem: "ok2" },
        { problem: "" }, // empty problem — dropped
        "not an object", // dropped
        { type: "vocabulary", problem: "ok3" },
        { type: "vocabulary", problem: "ok4" },
        { type: "vocabulary", problem: "ok5" },
        { type: "vocabulary", problem: "ok6" }
      ],
      overall: "ok"
    };
    const validated = validateAiResult(raw, 90, ["content"]);
    expect(validated.valid).toBe(true);
    expect(validated.mistakes.length).toBeLessThanOrEqual(5);
    expect(validated.mistakes.every(m => m.problem)).toBe(true);
    expect(validated.mistakes.find(m => m.type === "not-a-real-type")).toBeUndefined();
  });

  it("an invalid AI JSON response fails safely with no criteria/mistakes fabricated", async () => {
    mockCreate.mockResolvedValue(aiResponse({ notAScore: true }));
    const result = await evaluateSubjective({ type: "essay", text: "x" });
    expect(result.evaluationStatus).toBe("FAILED");
    expect(result.score).toBe(0);
    expect(result.criteria).toBeNull();
    expect(result.mistakes).toEqual([]);
  });

  it("a thrown/timeout provider error fails safely with no criteria/mistakes fabricated", async () => {
    mockCreate.mockRejectedValue(new Error("request timed out"));
    const result = await evaluateSubjective({ type: "essay", text: "x" });
    expect(result.evaluationStatus).toBe("FAILED");
    expect(result.criteria).toBeNull();
    expect(result.mistakes).toEqual([]);
    expect(result.overall).toMatch(/unavailable/i);
  });

  it("never sends authentication/session data to the AI provider — only task/answer text", async () => {
    mockCreate.mockResolvedValue(aiResponse({ score: 60, overall: "ok" }));
    await evaluateSubjective({ type: "essay", prompt: "Discuss X", text: "My essay response." });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const sentContent = JSON.stringify(mockCreate.mock.calls[0][0]);
    expect(sentContent).not.toMatch(/password|passwordHash|jwt|token|deviceId|sessionId|Bearer /i);
  });
});

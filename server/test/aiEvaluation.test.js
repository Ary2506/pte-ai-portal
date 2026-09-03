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
    subscriptionDefaultDays: 30
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

function aiResponse(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

beforeEach(() => { mockCreate.mockReset(); });

describe("AI evaluation (mocked provider)", () => {
  it("parses a valid structured AI response correctly", async () => {
    mockCreate.mockResolvedValue(aiResponse({ score: 72, strengths: ["Clear structure"], improvements: ["Watch grammar"], overall: "Solid attempt." }));
    const result = await evaluateSubjective({ type: "essay", prompt: "Discuss X", text: "A reasonably developed essay response." });
    expect(result.evaluationStatus).toBe("COMPLETED");
    expect(result.scoringMethod).toBe("ai");
    expect(result.score).toBe(72);
    expect(result.strengths).toContain("Clear structure");
  });

  it("treats a malformed/invalid AI response as FAILED, never a fabricated score", async () => {
    mockCreate.mockResolvedValue(aiResponse({ notAScore: "oops" }));
    const result = await evaluateSubjective({ type: "essay", text: "x" });
    expect(result.evaluationStatus).toBe("FAILED");
    expect(result.scoringMethod).toBeNull();
    expect(result.score).toBe(0);
  });

  it("clamps an out-of-range score into [0, maxScore]", async () => {
    mockCreate.mockResolvedValue(aiResponse({ score: 999, overall: "great work" }));
    const tooHigh = await evaluateSubjective({ type: "essay", text: "x" });
    expect(tooHigh.score).toBeLessThanOrEqual(90);

    mockCreate.mockResolvedValue(aiResponse({ score: -50, overall: "needs work" }));
    const tooLow = await evaluateSubjective({ type: "essay", text: "x" });
    expect(tooLow.score).toBeGreaterThanOrEqual(0);
  });

  it("returns a stable, student-safe FAILED result when the provider call throws — no raw provider error leaks", async () => {
    mockCreate.mockRejectedValue(new Error("upstream connection reset by peer at 10.0.0.4:443"));
    const result = await evaluateSubjective({ type: "essay", text: "x" });
    expect(result.evaluationStatus).toBe("FAILED");
    expect(result.overall).not.toMatch(/10\.0\.0\.4|connection reset/);
    expect(result.overall).toMatch(/unavailable/i);
  });
});

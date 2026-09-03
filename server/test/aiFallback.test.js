import { describe, it, expect, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    port: 5000,
    mongoUri: "",
    jwtSecret: "test-only-secret-at-least-32-characters-long",
    clientUrl: "",
    openaiKey: "", // deliberately unset
    openaiModel: "gpt-4.1-mini",
    razorpayKeyId: "",
    razorpayKeySecret: "",
    subscriptionDefaultDays: 30
  }
}));

const { evaluateSubjective } = await import("../src/services/ai/evaluator.js");

describe("AI fallback when OPENAI_API_KEY is missing", () => {
  it("uses the heuristic evaluator and clearly labels it — never pretends AI ran", async () => {
    const result = await evaluateSubjective({
      type: "essay",
      text: "This is a reasonably long practice essay with more than one sentence. It should score decently on length alone."
    });
    expect(result.evaluationStatus).toBe("COMPLETED");
    expect(result.scoringMethod).toBe("heuristic");
    expect(result.note).toMatch(/heuristic/i);
    expect(result.score).toBeGreaterThan(0);
  });
});

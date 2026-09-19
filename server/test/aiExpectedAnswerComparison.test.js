import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers the ONE flow the client asked to improve: the existing "AI Answer Submit" ->
// evaluateSubjective() -> "AI Answer Result" path, extended to compare the student's actual
// answer against the question's own stored expected answer (Describe Image, the only subjective
// type with one on file today) when present, and to prove every other task is byte-for-byte
// unaffected when it isn't.

vi.mock("../src/config.js", () => ({
  config: {
    port: 5000, mongoUri: "", jwtSecret: "test-only-secret-at-least-32-characters-long", clientUrl: "",
    openaiKey: "test-key", openaiModel: "gpt-4.1-mini", razorpayKeyId: "", razorpayKeySecret: "", subscriptionDefaultDays: 30
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
const { buildPrompt } = await import("../src/services/ai/prompts.js");
const { validateAiResult } = await import("../src/services/ai/validate.js");

function aiResponse(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

beforeEach(() => { mockCreate.mockReset(); });

describe("buildPrompt — expected-answer comparison is additive, never a default", () => {
  it("omits every expected-answer instruction when expectedAnswer is not provided — byte-for-byte the same prompt as before this feature existed", () => {
    const withoutFeature = buildPrompt({ type: "describe-image", prompt: "Describe the chart.", response: "It shows rainfall." });
    expect(withoutFeature.user).not.toMatch(/expected\/model answer/i);
    expect(withoutFeature.user).not.toMatch(/"status"/);
    expect(withoutFeature.user).not.toMatch(/"correctedResponse"/);
  });

  it("includes the expected answer and comparison instructions only when one is actually passed", () => {
    const { user } = buildPrompt({
      type: "describe-image", prompt: "Describe the chart.", response: "It shows rainfall.",
      expectedAnswer: "The chart shows average rainfall in four cities."
    });
    expect(user).toMatch(/Expected\/model answer for this exact question: The chart shows average rainfall in four cities\./);
    expect(user).toMatch(/"status"/);
    expect(user).toMatch(/"correctedResponse"/);
    expect(user).toMatch(/MEANING, not exact wording/);
  });

  it("a blank/whitespace-only expectedAnswer is treated the same as none at all", () => {
    const { user } = buildPrompt({ type: "describe-image", response: "text", expectedAnswer: "   " });
    expect(user).not.toMatch(/expected\/model answer/i);
  });
});

describe("validateAiResult — status/correctedResponse are sanitized, never trusted blindly", () => {
  it("accepts a valid status value", () => {
    const v = validateAiResult({ score: 80, status: "partially_correct", overall: "ok" }, 90, ["content"]);
    expect(v.status).toBe("partially_correct");
  });

  it("nulls out an invalid/unexpected status value rather than trusting it", () => {
    const v = validateAiResult({ score: 80, status: "kinda-right", overall: "ok" }, 90, ["content"]);
    expect(v.status).toBeNull();
  });

  it("accepts a correctedResponse string and trims/caps it", () => {
    const v = validateAiResult({ score: 80, correctedResponse: "  Yes, I am a boy.  ", overall: "ok" }, 90, ["content"]);
    expect(v.correctedResponse).toBe("Yes, I am a boy.");
  });

  it("nulls out a non-string or empty correctedResponse", () => {
    expect(validateAiResult({ score: 80, correctedResponse: 123, overall: "ok" }, 90, ["content"]).correctedResponse).toBeNull();
    expect(validateAiResult({ score: 80, correctedResponse: "   ", overall: "ok" }, 90, ["content"]).correctedResponse).toBeNull();
  });

  it("status/correctedResponse are absent (null) when the AI response never mentioned them — never fabricated", () => {
    const v = validateAiResult({ score: 80, overall: "ok" }, 90, ["content"]);
    expect(v.status).toBeNull();
    expect(v.correctedResponse).toBeNull();
  });
});

describe("evaluateSubjective — end-to-end with a mocked AI provider", () => {
  it("passes expectedAnswer through to the prompt and surfaces status/correctedResponse from a well-formed AI response", async () => {
    mockCreate.mockResolvedValue(aiResponse({
      score: 85, status: "correct",
      mistakes: [],
      strengths: ["Correct meaning, natural phrasing"], improvements: [], overall: "Great job."
    }));
    const result = await evaluateSubjective({
      type: "describe-image", prompt: "Are you a boy?", text: "Yes, I'm a boy.",
      expectedAnswer: "Yes, I am a boy."
    });
    expect(result.evaluationStatus).toBe("COMPLETED");
    expect(result.status).toBe("correct");
    expect(result.mistakes).toEqual([]);

    const sentPrompt = mockCreate.mock.calls[0][0].messages[1].content;
    expect(sentPrompt).toMatch(/Yes, I am a boy\./); // the expected answer really reached the model
    expect(sentPrompt).toMatch(/Yes, I'm a boy\./); // and so did the actual student text, untouched
  });

  it("identifies a wrong-content answer as incorrect with a real content mistake, not fabricated praise", async () => {
    mockCreate.mockResolvedValue(aiResponse({
      score: 20, status: "incorrect",
      mistakes: [{ type: "content", studentText: "Yes, I am a girl.", problem: "Answer contradicts the expected meaning.", correction: "Yes, I am a boy.", explanation: "The expected answer confirms being a boy, not a girl." }],
      correctedResponse: "Yes, I am a boy.",
      strengths: [], improvements: ["Re-read the question before answering."], overall: "The content does not match what was expected."
    }));
    const result = await evaluateSubjective({
      type: "describe-image", prompt: "Are you a boy?", text: "Yes, I am a girl.",
      expectedAnswer: "Yes, I am a boy."
    });
    expect(result.status).toBe("incorrect");
    expect(result.mistakes[0].type).toBe("content");
    expect(result.correctedResponse).toBe("Yes, I am a boy.");
  });

  it("identifies a grammar-only slip on an otherwise-correct answer as a grammar mistake, not content", async () => {
    mockCreate.mockResolvedValue(aiResponse({
      score: 70, status: "partially_correct",
      mistakes: [{ type: "grammar", studentText: "Yes I boy.", problem: "Missing the verb 'am' and article structure.", correction: "Yes, I am a boy.", explanation: "The sentence needs the verb 'am' to be grammatically complete." }],
      correctedResponse: "Yes, I am a boy.",
      strengths: ["Correct intended meaning"], improvements: ["Watch sentence structure."], overall: "The meaning is right, but the grammar needs work."
    }));
    const result = await evaluateSubjective({
      type: "describe-image", prompt: "Are you a boy?", text: "Yes I boy.",
      expectedAnswer: "Yes, I am a boy."
    });
    expect(result.status).toBe("partially_correct");
    expect(result.mistakes[0].type).toBe("grammar");
  });

  it("a question with no expectedAnswer behaves exactly as before — no status/correctedResponse requested or returned", async () => {
    mockCreate.mockResolvedValue(aiResponse({ score: 60, overall: "Fine effort." }));
    const result = await evaluateSubjective({ type: "essay", prompt: "Discuss X", text: "My essay." });
    expect(result.status).toBeNull();
    expect(result.correctedResponse).toBeNull();
    const sentPrompt = mockCreate.mock.calls[0][0].messages[1].content;
    expect(sentPrompt).not.toMatch(/expected\/model answer/i);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

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

const { app } = await import("../src/app.js");
const { createUser, createQuestion } = await import("./helpers.js");

function aiResponse(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

beforeEach(() => { mockCreate.mockReset(); mockCreate.mockResolvedValue(aiResponse({ score: 60, overall: "ok" })); });

describe("AI cost control (Phase 16, B9)", () => {
  it("never calls the AI provider for an objective (MCQ) submission, even with a real key configured", async () => {
    await createUser({ username: "costctl1", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
    const token = await login("costctl1");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1)).field("questionId", q._id.toString());
    expect(res.status).toBe(201);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does call the AI provider for a subjective (essay) submission", async () => {
    await createUser({ username: "costctl2", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("costctl2");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay").field("answer", JSON.stringify("My essay text.")).field("transcript", "My essay text.")
      .field("questionId", q._id.toString());
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("does not re-call the AI provider when the result page is viewed again — feedback is persisted, not regenerated", async () => {
    await createUser({ username: "costctl3", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("costctl3");

    const submit = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay").field("answer", JSON.stringify("My essay text.")).field("transcript", "My essay text.")
      .field("questionId", q._id.toString());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const firstFeedback = submit.body.submission.feedback;

    // Viewing history (a GET) must never trigger a new AI call, and must return the exact same
    // persisted feedback both times.
    const historyOnce = await request(app).get("/api/submissions/history").set("Authorization", `Bearer ${token}`);
    const historyTwice = await request(app).get("/api/submissions/history").set("Authorization", `Bearer ${token}`);
    expect(mockCreate).toHaveBeenCalledTimes(1); // still just the one call from submission time
    expect(historyOnce.body.submissions[0].feedback.overall).toBe(firstFeedback.overall);
    expect(historyTwice.body.submissions[0].feedback.overall).toBe(firstFeedback.overall);
  });

  it("prefers the question's own stored explanation for an objective mistake, without ever calling AI", async () => {
    await createUser({ username: "costctl4", password: "password123" });
    const q = await createQuestion({
      section: "reading", type: "mcq-single", options: ["Paris", "London"], answer: 1,
      explanation: "The question asks for the capital of the United Kingdom, which is London.",
      evaluationType: "objective"
    });
    const token = await login("costctl4");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(0)).field("questionId", q._id.toString());

    expect(res.status).toBe(201);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.body.submission.feedback.correct).toBe(false);
    expect(res.body.submission.feedback.correctAnswerText).toBe("London");
    expect(res.body.submission.feedback.feedback).toContain("The question asks for the capital of the United Kingdom, which is London.");
  });
});

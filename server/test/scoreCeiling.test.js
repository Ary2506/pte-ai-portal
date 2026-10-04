import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import Submission from "../src/models/Submission.js";

// A score can never beat the marks that were available for it. This is not only a cosmetic
// "100/90" in the results table: every section total, dashboard average and progress percentage
// is a sum over these rows, so one row above its own maximum pushes a whole section past 100%.
//
// Four paths put a score on a submission — objective marking, the AI evaluator, the heuristic
// fallback, and the client-supplied `localResult` used for bundled practice content that has no
// Question row. Only some of them clamped. The last one took whatever it was given.

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("a stored score never exceeds its own maximum", () => {
  it("refuses a client-supplied local result that scores above its maximum", async () => {
    await createUser({ username: "ceil1", password: "password123" });
    const token = await login("ceil1");

    await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "summarize-spoken-text")
      .field("answer", JSON.stringify("A summary."))
      .field("localQuestionId", "3942")
      .field("localResult", JSON.stringify({ score: 100, maxScore: 90, feedback: { overall: "x" } }));

    const stored = await Submission.findOne({ localQuestionId: "3942" });
    expect(stored).toBeTruthy();
    // The crafted result is discarded entirely and the answer is scored normally, rather than
    // being quietly rewritten into a number the client never sent.
    expect(stored.score).toBeLessThanOrEqual(stored.maxScore);
    expect(stored.score === 100 && stored.maxScore === 90).toBe(false);
  });

  it("refuses a local result whose maximum is beyond what any task is worth", async () => {
    await createUser({ username: "ceil2", password: "password123" });
    const token = await login("ceil2");

    await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "summarize-spoken-text")
      .field("answer", JSON.stringify("A summary."))
      .field("localQuestionId", "3943")
      .field("localResult", JSON.stringify({ score: 5000, maxScore: 5000, feedback: { overall: "x" } }));

    const stored = await Submission.findOne({ localQuestionId: "3943" });
    expect(stored.maxScore).toBeLessThanOrEqual(90);
    expect(stored.score).toBeLessThanOrEqual(stored.maxScore);
  });

  it("still accepts an honest local result unchanged", async () => {
    await createUser({ username: "ceil3", password: "password123" });
    const token = await login("ceil3");

    await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "write-dictation")
      .field("answer", JSON.stringify("the meeting is on monday"))
      .field("localQuestionId", "3944")
      .field("localResult", JSON.stringify({ score: 3, maxScore: 5, feedback: { overall: "ok" } }));

    const stored = await Submission.findOne({ localQuestionId: "3944" });
    expect(stored.score).toBe(3);
    expect(stored.maxScore).toBe(5);
  });
});

describe("the model clamps whatever any scoring path hands it", () => {
  it("pulls a score above its maximum back down to it", async () => {
    const user = await createUser({ username: "ceil4", password: "password123" });
    const submission = await Submission.create({
      user: user._id, section: "writing", type: "essay",
      score: 140, maxScore: 90, evaluationType: "subjective"
    });
    expect(submission.score).toBe(90);
  });

  it("pulls a negative score up to zero", async () => {
    const user = await createUser({ username: "ceil5", password: "password123" });
    const submission = await Submission.create({
      user: user._id, section: "reading", type: "mcq-multiple",
      score: -3, maxScore: 2, evaluationType: "objective"
    });
    expect(submission.score).toBe(0);
  });

  it("leaves a valid score alone", async () => {
    const user = await createUser({ username: "ceil6", password: "password123" });
    const submission = await Submission.create({
      user: user._id, section: "reading", type: "reorder",
      score: 3, maxScore: 4, evaluationType: "objective"
    });
    expect(submission.score).toBe(3);
    expect(submission.maxScore).toBe(4);
  });
});

describe("a mock test's totals cannot exceed their own maximum", () => {
  it("sums to a total no greater than the marks available", async () => {
    await createUser({ username: "ceil7", password: "password123" });
    const token = await login("ceil7");
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });

    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = started.body.testSession._id;
    for (const question of started.body.questions) {
      await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
        .field("section", question.section).field("type", question.type)
        .field("answer", JSON.stringify(1))
        .field("questionId", question._id).field("testSessionId", sessionId);
    }

    const done = await request(app).post(`/api/test-sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${token}`);
    const session = done.body.testSession;

    expect(session.totalScore).toBeLessThanOrEqual(session.totalMaxScore);
    for (const section of session.sectionScores) {
      expect(section.score).toBeLessThanOrEqual(section.maxScore);
      expect(section.score).toBeGreaterThanOrEqual(0);
    }
  });
});

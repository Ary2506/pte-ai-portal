import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import { markForSubmission } from "../src/routes/testSessions.js";
import Submission from "../src/models/Submission.js";
import TestSession from "../src/models/TestSession.js";

// A mock is marked one mark per QUESTION, not by the raw points a task happens to carry. Before
// this, a 90-point speaking answer and a 1-point multiple choice contributed wildly different
// amounts to the same total, so a section's score said more about which task types it contained
// than about how the student did.
async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

const subjective = (score, maxScore = 90) =>
  ({ score, maxScore, evaluationType: "subjective", evaluationStatus: "COMPLETED" });
const objective = (score, maxScore) =>
  ({ score, maxScore, evaluationType: "objective", evaluationStatus: "COMPLETED" });

describe("what one AI-evaluated answer is worth", () => {
  it("scores nothing below 40%", () => {
    expect(markForSubmission(subjective(0))).toBe(0);
    expect(markForSubmission(subjective(35))).toBe(0);     // 38.9%
    expect(markForSubmission(subjective(35.99))).toBe(0);  // just under 40%
  });

  it("scores half a mark from 40% up to but not including 60%", () => {
    expect(markForSubmission(subjective(36))).toBe(0.5);   // exactly 40%
    expect(markForSubmission(subjective(45))).toBe(0.5);   // 50%
    expect(markForSubmission(subjective(53.99))).toBe(0.5); // just under 60%
  });

  it("scores a full mark from 60% upwards", () => {
    expect(markForSubmission(subjective(54))).toBe(1);     // exactly 60%
    expect(markForSubmission(subjective(80))).toBe(1);
    expect(markForSubmission(subjective(90))).toBe(1);     // 100%
  });

  it("uses the band boundaries, not the raw score, whatever the maximum", () => {
    // Same 50% on a differently-scaled task must earn the same half mark.
    expect(markForSubmission(subjective(5, 10))).toBe(0.5);
    expect(markForSubmission(subjective(1, 2))).toBe(0.5);
  });
});

describe("what one ordinary answer is worth", () => {
  it("gives a full mark only for a complete match", () => {
    expect(markForSubmission(objective(1, 1))).toBe(1);
    expect(markForSubmission(objective(3, 3))).toBe(1);
  });

  it("gives nothing for a partial match — the answer either matches the key or it does not", () => {
    expect(markForSubmission(objective(2, 3))).toBe(0);
    expect(markForSubmission(objective(0, 1))).toBe(0);
  });
});

describe("answers that were never graded", () => {
  it("scores nothing while still pending or after a failed evaluation", () => {
    expect(markForSubmission({ score: 80, maxScore: 90, evaluationType: "subjective", evaluationStatus: "PENDING" })).toBe(0);
    expect(markForSubmission({ score: 80, maxScore: 90, evaluationType: "subjective", evaluationStatus: "FAILED" })).toBe(0);
  });

  it("scores nothing rather than dividing by a missing maximum", () => {
    expect(markForSubmission({ score: 5, maxScore: 0, evaluationType: "objective" })).toBe(0);
    expect(markForSubmission(null)).toBe(0);
    expect(markForSubmission(undefined)).toBe(0);
  });
});

describe("a completed attempt totals those marks", () => {
  it("marks each section out of the questions it issued, not the ones answered", async () => {
    await createUser({ username: "mark1", password: "password123" });
    const token = await login("mark1");
    await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
    await createQuestion({ section: "listening", type: "write-dictation", answer: "hello world today", evaluationType: "objective", maxScore: 3 });

    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = started.body.testSession._id;
    const reading = started.body.questions.find(q => q.section === "reading");

    // Answer only the reading question, correctly. Everything else is left untouched.
    await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", reading.type).field("answer", JSON.stringify(1))
      .field("questionId", reading._id).field("testSessionId", sessionId);

    const done = await request(app).post(`/api/test-sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${token}`);

    expect(done.status).toBe(200);
    const session = done.body.testSession;
    // One mark earned, out of the four questions the attempt issued — the three unanswered ones
    // still count against the total.
    expect(session.totalScore).toBe(1);
    expect(session.totalMaxScore).toBe(4);

    const readingRow = session.sectionScores.find(s => s.section === "reading");
    const speakingRow = session.sectionScores.find(s => s.section === "speaking");
    expect(readingRow).toMatchObject({ score: 1, maxScore: 1 });
    // Issued but never answered: no marks, but it is still out of the question that was set.
    expect(speakingRow).toMatchObject({ score: 0, maxScore: 1 });
  });

  it("sends each answer's mark with the results, so the report cannot disagree with the total", async () => {
    await createUser({ username: "mark2", password: "password123" });
    const token = await login("mark2");
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });

    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = started.body.testSession._id;
    const reading = started.body.questions.find(q => q.section === "reading");
    await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", reading.type).field("answer", JSON.stringify(0))
      .field("questionId", reading._id).field("testSessionId", sessionId);

    const done = await request(app).post(`/api/test-sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${token}`);

    expect(done.body.results).toHaveLength(1);
    // Wrong option, so no mark — and the row says so in the same terms as the total.
    expect(done.body.results[0].mark).toBe(0);
    expect(done.body.testSession.totalScore).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

async function seedOnePerSection() {
  await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
  await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
  await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
  await createQuestion({ section: "listening", type: "write-dictation", answer: "hello world today", evaluationType: "objective", maxScore: 3 });
}

describe("mock session score integrity", () => {
  it("computes totalScore/sectionScores from stored submissions only — a forged completion body changes nothing", async () => {
    await createUser({ username: "score1", password: "password123" });
    await seedOnePerSection();
    const token = await login("score1");
    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = started.body.testSession._id;
    const readingQ = started.body.questions.find(q => q.section === "reading");

    await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", readingQ.type).field("answer", JSON.stringify(0)) // wrong answer (correct is 1)
      .field("questionId", readingQ._id).field("testSessionId", sessionId);

    const res = await request(app).post(`/api/test-sessions/${sessionId}/complete`).set("Authorization", `Bearer ${token}`)
      .send({ totalScore: 999, totalMaxScore: 1, sectionScores: [{ section: "reading", score: 999, maxScore: 1 }], answeredQuestions: 999 });

    expect(res.status).toBe(200);
    const readingScore = res.body.testSession.sectionScores.find(s => s.section === "reading").score;
    expect(readingScore).toBe(0); // the real (wrong) answer's score, never the forged 999
    expect(res.body.testSession.totalScore).not.toBe(999);
  });

  it("cannot forge score/evaluationStatus/scoringMethod on an individual submission", async () => {
    await createUser({ username: "score2", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("score2");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(0)) // wrong
      .field("questionId", String(q._id))
      .field("score", "90").field("evaluationStatus", "COMPLETED").field("scoringMethod", "ai");

    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(0); // real (wrong-answer) score, not the forged 90
  });
});

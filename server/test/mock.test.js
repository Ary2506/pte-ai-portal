import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import Submission from "../src/models/Submission.js";

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

async function runMock(token, { readingChoice, dictationText, writingText }) {
  const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
  const sessionId = started.body.testSession._id;
  const questions = started.body.questions;

  for (const q of questions) {
    if (q.section === "reading") {
      await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
        .field("section", "reading").field("type", q.type).field("answer", JSON.stringify(readingChoice))
        .field("questionId", q._id).field("testSessionId", sessionId);
    } else if (q.section === "listening") {
      await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
        .field("section", "listening").field("type", q.type).field("answer", JSON.stringify(dictationText)).field("transcript", dictationText)
        .field("questionId", q._id).field("testSessionId", sessionId);
    } else if (q.section === "writing") {
      await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
        .field("section", "writing").field("type", q.type).field("answer", JSON.stringify(writingText)).field("transcript", writingText)
        .field("questionId", q._id).field("testSessionId", sessionId);
    } else {
      await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
        .field("section", "speaking").field("type", q.type).field("transcript", "A short spoken answer.")
        .field("questionId", q._id).field("testSessionId", sessionId);
    }
  }

  const completed = await request(app).post(`/api/test-sessions/${sessionId}/complete`).set("Authorization", `Bearer ${token}`);
  return { sessionId, questions, result: completed.body.testSession };
}

describe("mock test", () => {
  it("creates a real test session when started", async () => {
    await createUser({ username: "mock1", password: "password123" });
    await seedOnePerSection();
    const token = await login("mock1");

    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body.testSession.status).toBe("IN_PROGRESS");
    expect(res.body.questions.length).toBeGreaterThan(0);
    // The question payload must never leak the answer key.
    for (const q of res.body.questions) expect(q.answer).toBeUndefined();
  });

  it("stores each answer as a real Submission linked to the session", async () => {
    await createUser({ username: "mock2", password: "password123" });
    await seedOnePerSection();
    const token = await login("mock2");
    const { sessionId, questions } = await runMock(token, { readingChoice: 1, dictationText: "hello world today", writingText: "A reasonable essay response with several sentences. It covers the topic." });

    const stored = await Submission.find({ testSession: sessionId });
    expect(stored.length).toBe(questions.length);
  });

  it("calculates the total score from the actual answers submitted", async () => {
    await createUser({ username: "mock3", password: "password123" });
    await seedOnePerSection();
    const token = await login("mock3");
    const { result } = await runMock(token, { readingChoice: 1, dictationText: "hello world today", writingText: "A reasonable essay response with several sentences. It covers the topic." });

    expect(result.status).toBe("COMPLETED");
    const readingScore = result.sectionScores.find(s => s.section === "reading").score;
    const listeningScore = result.sectionScores.find(s => s.section === "listening").score;
    expect(readingScore).toBe(1); // correct MCQ answer
    expect(listeningScore).toBe(3); // exact dictation match
    expect(result.totalScore).toBeGreaterThan(0);
  });

  it("produces a different result when the answers are different — no hardcoded score", async () => {
    await createUser({ username: "mock4a", password: "password123" });
    await createUser({ username: "mock4b", password: "password123" });
    await seedOnePerSection();
    const tokenGood = await login("mock4a");
    const tokenBad = await login("mock4b");

    const good = await runMock(tokenGood, { readingChoice: 1, dictationText: "hello world today", writingText: "text" });
    const bad = await runMock(tokenBad, { readingChoice: 0, dictationText: "completely different words", writingText: "text" });

    expect(good.result.totalScore).not.toBe(bad.result.totalScore);
    expect(good.result.totalScore).toBeGreaterThan(bad.result.totalScore);
  });
});

describe("history", () => {
  it("shows a completed mock attempt in the student's history", async () => {
    await createUser({ username: "hist1", password: "password123" });
    await seedOnePerSection();
    const token = await login("hist1");
    await runMock(token, { readingChoice: 1, dictationText: "hello world today", writingText: "text" });

    const res = await request(app).get("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.testSessions.length).toBe(1);
    expect(res.body.testSessions[0].status).toBe("COMPLETED");
  });

  it("only shows a student their own history, never another student's", async () => {
    await createUser({ username: "hist2", password: "password123" });
    await createUser({ username: "hist3", password: "password123" });
    await seedOnePerSection();
    const tokenA = await login("hist2");
    const tokenB = await login("hist3");
    await runMock(tokenA, { readingChoice: 1, dictationText: "hello world today", writingText: "text" });

    const asB = await request(app).get("/api/test-sessions").set("Authorization", `Bearer ${tokenB}`);
    expect(asB.body.testSessions.length).toBe(0);

    const historyAsB = await request(app).get("/api/submissions/history").set("Authorization", `Bearer ${tokenB}`);
    expect(historyAsB.body.submissions.length).toBe(0);
  });
});

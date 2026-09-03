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
  await createQuestion({
    section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective",
    explanation: "B is correct because the passage says so."
  });
  await createQuestion({ section: "listening", type: "write-dictation", answer: "hello world today", evaluationType: "objective", maxScore: 3 });
}

async function startMock(token) {
  const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
  return { sessionId: res.body.testSession._id, questions: res.body.questions };
}

async function answerAll(token, sessionId, questions) {
  for (const q of questions) {
    const answer = q.section === "listening" ? "hello world today" : q.section === "reading" ? 1 : "text";
    await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", q.section).field("type", q.type).field("answer", JSON.stringify(answer))
      .field("transcript", "text").field("questionId", q._id).field("testSessionId", sessionId);
  }
}

describe("mock attempt question-level detail", () => {
  it("lets the authenticated owner retrieve their own attempt details", async () => {
    await createUser({ username: "detail1", password: "password123" });
    await seedOnePerSection();
    const token = await login("detail1");
    const { sessionId, questions } = await startMock(token);
    await answerAll(token, sessionId, questions);

    const res = await request(app).get(`/api/test-sessions/${sessionId}/details`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.testSession._id).toBe(sessionId);
    expect(res.body.results.length).toBe(4);
    for (const r of res.body.results) {
      expect(r).toHaveProperty("score");
      expect(r).toHaveProperty("maxScore");
      expect(r).toHaveProperty("evaluationStatus");
      expect(r).toHaveProperty("feedback");
      expect(r.question).toBeTruthy();
      expect(r.question).toHaveProperty("prompt");
    }
  });

  it("never exposes the linked question's answer or explanation field", async () => {
    await createUser({ username: "detail2", password: "password123" });
    await seedOnePerSection();
    const token = await login("detail2");
    const { sessionId, questions } = await startMock(token);
    await answerAll(token, sessionId, questions);

    const res = await request(app).get(`/api/test-sessions/${sessionId}/details`).set("Authorization", `Bearer ${token}`);
    for (const r of res.body.results) {
      expect(r.question.answer).toBeUndefined();
      expect(r.question.explanation).toBeUndefined();
      expect(Object.keys(r.question)).not.toContain("answer");
      expect(Object.keys(r.question)).not.toContain("explanation");
    }
    // Note: an objective submission's own feedback.feedback[] legitimately contains
    // explanation-derived pedagogical text — that is pre-existing Phase 3 behavior
    // (scoring/objective.js), already shown to the student immediately after they submitted.
    // It is not the same thing as the question object's own answer/explanation fields, which
    // the assertions above are what this test is actually about.
  });

  it("rejects a request with no token", async () => {
    await createUser({ username: "detail3", password: "password123" });
    await seedOnePerSection();
    const token = await login("detail3");
    const { sessionId } = await startMock(token);

    const res = await request(app).get(`/api/test-sessions/${sessionId}/details`);
    expect(res.status).toBe(401);
  });

  it("rejects another user retrieving someone else's attempt details", async () => {
    await createUser({ username: "detail4", password: "password123" });
    await createUser({ username: "detail5", password: "password123" });
    await seedOnePerSection();
    const tokenA = await login("detail4");
    const tokenB = await login("detail5");
    const { sessionId } = await startMock(tokenA);

    const res = await request(app).get(`/api/test-sessions/${sessionId}/details`).set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("returns a clean 400 for a malformed session id", async () => {
    await createUser({ username: "detail6", password: "password123" });
    const token = await login("detail6");

    const res = await request(app).get("/api/test-sessions/not-a-real-id/details").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

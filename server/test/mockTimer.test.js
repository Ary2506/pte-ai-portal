import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import TestSession from "../src/models/TestSession.js";

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

async function startMock(token) {
  const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
  return { sessionId: res.body.testSession._id, questions: res.body.questions, testSession: res.body.testSession };
}

// The 20-minute deadline is simulated by writing an already-past expiresAt directly to the
// TestSession document (the same pattern Phase 6 used for subscriptionEndDate) — no real
// waiting, no fake-timer library needed on the backend since expiry is a plain Date comparison.
describe("mock session server-authoritative timer", () => {
  it("stamps a new mock session with a server-computed expiresAt around 20 minutes out", async () => {
    await createUser({ username: "timer1", password: "password123" });
    await seedOnePerSection();
    const token = await login("timer1");
    const before = Date.now();

    const { testSession } = await startMock(token);
    const after = Date.now();

    const expiresAt = new Date(testSession.expiresAt).getTime();
    const startedAt = new Date(testSession.startedAt).getTime();
    expect(startedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(startedAt).toBeLessThanOrEqual(after + 1000);
    expect(expiresAt - startedAt).toBe(20 * 60 * 1000);
  });

  it("ignores a client-supplied expiresAt/startedAt/duration on session creation", async () => {
    await createUser({ username: "timer2", password: "password123" });
    await seedOnePerSection();
    const token = await login("timer2");
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`)
      .send({ expiresAt: farFuture, startedAt: farFuture, duration: 999999 });

    const expiresAt = new Date(res.body.testSession.expiresAt).getTime();
    expect(expiresAt).toBeLessThan(Date.now() + 21 * 60 * 1000); // nowhere near the forged 1-year value
  });

  it("rejects a submission once the session's server-side expiresAt has passed", async () => {
    await createUser({ username: "timer3", password: "password123" });
    await seedOnePerSection();
    const token = await login("timer3");
    const { sessionId, questions } = await startMock(token);
    await TestSession.updateOne({ _id: sessionId }, { expiresAt: new Date(Date.now() - 1000) });

    const readingQ = questions.find(q => q.section === "reading");
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", readingQ.type).field("answer", JSON.stringify(1))
      .field("questionId", readingQ._id).field("testSessionId", sessionId);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TEST_SESSION_EXPIRED");

    const stored = await TestSession.findById(sessionId);
    expect(stored.status).toBe("EXPIRED");
  });

  it("rejects completion once the session's server-side expiresAt has passed, and does not score it", async () => {
    await createUser({ username: "timer4", password: "password123" });
    await seedOnePerSection();
    const token = await login("timer4");
    const { sessionId } = await startMock(token);
    await TestSession.updateOne({ _id: sessionId }, { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app).post(`/api/test-sessions/${sessionId}/complete`).set("Authorization", `Bearer ${token}`)
      .send({ totalScore: 90, sectionScores: [{ section: "reading", score: 1, maxScore: 1 }] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TEST_SESSION_EXPIRED");

    const stored = await TestSession.findById(sessionId);
    expect(stored.status).toBe("EXPIRED");
    expect(stored.totalScore).toBe(0); // never touched by the forged body above
  });

  it("treats an expired IN_PROGRESS session as expired on a plain read, without a background job", async () => {
    await createUser({ username: "timer5", password: "password123" });
    await seedOnePerSection();
    const token = await login("timer5");
    const { sessionId } = await startMock(token);
    await TestSession.updateOne({ _id: sessionId }, { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app).get(`/api/test-sessions/${sessionId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.testSession.status).toBe("EXPIRED");
  });

  it("never lets a completed session be completed again, even after its expiry time has also passed", async () => {
    await createUser({ username: "timer6", password: "password123" });
    await seedOnePerSection();
    const token = await login("timer6");
    const { sessionId, questions } = await startMock(token);
    for (const q of questions) {
      await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
        .field("section", q.section).field("type", q.type)
        .field("answer", JSON.stringify(q.section === "listening" ? "hello world today" : q.section === "reading" ? 1 : "text"))
        .field("transcript", "text")
        .field("questionId", q._id).field("testSessionId", sessionId);
    }
    const first = await request(app).post(`/api/test-sessions/${sessionId}/complete`).set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.testSession.status).toBe("COMPLETED");

    await TestSession.updateOne({ _id: sessionId }, { expiresAt: new Date(Date.now() - 1000) });
    const second = await request(app).post(`/api/test-sessions/${sessionId}/complete`).set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("SESSION_ALREADY_COMPLETED");
  });
});

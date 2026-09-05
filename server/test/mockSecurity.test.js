import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import TestSession from "../src/models/TestSession.js";

// Kept under ~10 signins per file — the login rate limiter (10/5min) is in-memory per Express
// app instance, and each Vitest test file gets a fresh module registry.
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

describe("mock session question-set integrity", () => {
  it("records the exact questions issued, matching the returned question set", async () => {
    await createUser({ username: "qset1", password: "password123" });
    await seedOnePerSection();
    const token = await login("qset1");

    const { sessionId, questions } = await startMock(token);
    const stored = await TestSession.findById(sessionId);
    const storedIds = stored.questionIds.map(String).sort();
    const issuedIds = questions.map(q => q._id).sort();
    expect(storedIds).toEqual(issuedIds);
  });

  it("accepts a submission for a question that was actually issued to the session", async () => {
    await createUser({ username: "qset2", password: "password123" });
    await seedOnePerSection();
    const token = await login("qset2");
    const { sessionId, questions } = await startMock(token);
    const readingQ = questions.find(q => q.section === "reading");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", readingQ.type).field("answer", JSON.stringify(1))
      .field("questionId", readingQ._id).field("testSessionId", sessionId);

    expect(res.status).toBe(201);
  });

  it("rejects a submission for an active question that was never issued to this session", async () => {
    await createUser({ username: "qset3", password: "password123" });
    await seedOnePerSection();
    const token = await login("qset3");
    const { sessionId } = await startMock(token);
    // Created only after the mock started, so it is guaranteed not to have been a candidate —
    // creating it beforehand would let the picker's own shuffle occasionally choose it, which
    // would make this test flaky rather than a real test of the enforcement.
    const outsider = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 0 });

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(0))
      .field("questionId", String(outsider._id)).field("testSessionId", sessionId);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("QUESTION_NOT_IN_SESSION");
  });

  it("ignores a client-supplied questionIds array on session creation — always server-picked", async () => {
    await createUser({ username: "qset4", password: "password123" });
    await seedOnePerSection();
    const forged = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 0 });
    const token = await login("qset4");

    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`)
      .send({ questionIds: [String(forged._id)] });

    expect(res.status).toBe(201);
    const stored = await TestSession.findById(res.body.testSession._id);
    // The forged id must not be the only (or an extra) entry — the real per-section pick still ran.
    expect(stored.questionIds.length).toBe(res.body.questions.length);
  });

  it("rejects a test-session submission that omits questionId, instead of letting it slip past the belongs/duplicate checks", async () => {
    // Both the belongs-check and the duplicate-submission guard only run `if (question)` — before
    // this fix, omitting questionId entirely skipped both, letting a student attach unlimited
    // freeform, AI/heuristic-scored "submissions" (any section/type string) to their own
    // in-progress session, each one counted into that section's score total at /complete.
    await createUser({ username: "qset6", password: "password123" });
    await seedOnePerSection();
    const token = await login("qset6");
    const { sessionId } = await startMock(token);

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify("free credit"))
      .field("testSessionId", sessionId); // deliberately no questionId

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("still rejects an attacker submitting to another user's session (with no questionId) as FORBIDDEN, not the questionId-missing 400", async () => {
    await createUser({ username: "qset7a", password: "password123" });
    await createUser({ username: "qset7b", password: "password123" });
    await seedOnePerSection();
    const tokenOwner = await login("qset7a");
    const tokenAttacker = await login("qset7b");
    const { sessionId } = await startMock(tokenOwner);

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${tokenAttacker}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(0))
      .field("testSessionId", sessionId);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("standalone practice (no testSessionId) is unaffected by question-set enforcement", async () => {
    await createUser({ username: "qset5", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("qset5");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1))
      .field("questionId", String(q._id));

    expect(res.status).toBe(201);
  });
});

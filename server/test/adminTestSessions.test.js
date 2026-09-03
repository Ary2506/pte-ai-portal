import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createUser, createQuestion } from "./helpers.js";

// Kept under ~10 signins per file — see mockSecurity.test.js's own note on the login rate limit.
async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

async function seedOnePerSection() {
  await createQuestion({
    section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective",
    explanation: "The secret explanation."
  });
  await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
  await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
  await createQuestion({ section: "listening", type: "write-dictation", answer: "hello world today", evaluationType: "objective", maxScore: 3 });
}

async function startMock(token) {
  const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
  return res.body.testSession._id;
}

describe("admin mock/test-session visibility — list and detail", () => {
  it("lists mock sessions across students, paginated like the existing users list", async () => {
    await createAdmin({ username: "admints1", password: "password123" });
    await createUser({ username: "student_ts1", password: "password123" });
    await seedOnePerSection();
    const adminToken = await login("admints1");
    const studentToken = await login("student_ts1");
    await startMock(studentToken);

    const res = await request(app).get("/api/admin/test-sessions?page=1&limit=20").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.testSessions.length).toBeGreaterThanOrEqual(1);
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("totalPages");
    const row = res.body.testSessions.find(s => s.user?.username === "student_ts1");
    expect(row).toBeTruthy();
    expect(row).toHaveProperty("status");
    expect(row).toHaveProperty("totalScore");
    expect(row).toHaveProperty("expiresAt");
  });

  it("paginates — a limit of 1 returns exactly one row but reports the true total", async () => {
    await createAdmin({ username: "admints2", password: "password123" });
    await createUser({ username: "student_ts2a", password: "password123" });
    await createUser({ username: "student_ts2b", password: "password123" });
    await seedOnePerSection();
    const adminToken = await login("admints2");
    const tokenA = await login("student_ts2a");
    const tokenB = await login("student_ts2b");
    await startMock(tokenA);
    await startMock(tokenB);

    const res = await request(app).get("/api/admin/test-sessions?page=1&limit=1").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.testSessions.length).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.totalPages).toBeGreaterThanOrEqual(2);
  });

  it("lets admin open a session's detail with submissions, and never exposes the answer/explanation", async () => {
    await createAdmin({ username: "admints3", password: "password123" });
    await createUser({ username: "student_ts3", password: "password123" });
    await seedOnePerSection();
    const adminToken = await login("admints3");
    const studentToken = await login("student_ts3");
    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${studentToken}`);
    const sessionId = started.body.testSession._id;
    const readingQ = started.body.questions.find(q => q.section === "reading");
    await request(app).post("/api/submissions").set("Authorization", `Bearer ${studentToken}`)
      .field("section", "reading").field("type", readingQ.type).field("answer", JSON.stringify(1))
      .field("questionId", readingQ._id).field("testSessionId", sessionId);

    const res = await request(app).get(`/api/admin/test-sessions/${sessionId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.testSession.user.username).toBe("student_ts3");
    expect(res.body.results.length).toBe(1);
    expect(res.body.results[0].score).toBe(1);
    // The question object itself never carries these two fields — a submission's own
    // feedback text is a separate, pre-existing mechanic (scoring/objective.js) and is not
    // what this assertion is about.
    expect(res.body.results[0].question.answer).toBeUndefined();
    expect(res.body.results[0].question.explanation).toBeUndefined();
    expect(Object.keys(res.body.results[0].question)).not.toContain("answer");
    expect(Object.keys(res.body.results[0].question)).not.toContain("explanation");
  });
});

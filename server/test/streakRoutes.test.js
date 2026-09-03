import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("streak — non-learning actions do not earn credit", () => {
  it("viewing the dashboard alone never starts or advances a streak", async () => {
    await createUser({ username: "streakr1", password: "password123" });
    const token = await login("streakr1");

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.body.streak).toEqual({ currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false });
  });

  it("starting a mock test without completing it does not earn streak credit", async () => {
    await createUser({ username: "streakr2", password: "password123" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
    const token = await login("streakr2");

    await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.body.streak.currentStreak).toBe(0);
    expect(res.body.streak.learnedToday).toBe(false);
  });
});

describe("streak — a completed practice submission earns credit", () => {
  it("a successful objective submission sets the streak to 1 and learnedToday to true", async () => {
    await createUser({ username: "streakr3", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
    const token = await login("streakr3");

    const sub = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1)).field("questionId", q._id.toString());
    expect(sub.status).toBe(201);

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.body.streak.currentStreak).toBe(1);
    expect(res.body.streak.learnedToday).toBe(true);
  });

  it("a rejected/failed submission request never earns streak credit", async () => {
    await createUser({ username: "streakr4", password: "password123" });
    const token = await login("streakr4");

    // Missing required fields (section/type) — a 400, no Submission is ever created.
    const bad = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`).field("answer", "x");
    expect(bad.status).toBe(400);

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.body.streak.currentStreak).toBe(0);
  });
});

describe("streak — duplicate submissions do not artificially increase the streak", () => {
  it("a duplicate (409) submission for the same session question leaves the streak unchanged", async () => {
    await createUser({ username: "streakr5", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
    const token = await login("streakr5");

    const start = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = start.body.testSession._id;
    const questionId = start.body.questions.find(x => x.type === "mcq-single")?._id || q._id.toString();

    const first = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1))
      .field("questionId", questionId).field("testSessionId", sessionId);
    expect(first.status).toBe(201);

    const dup = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(0))
      .field("questionId", questionId).field("testSessionId", sessionId);
    expect(dup.status).toBe(409);

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.body.streak.currentStreak).toBe(1); // still 1 — not 2, not corrupted by the duplicate
  });
});

describe("streak — mock completion counts as a learning activity", () => {
  it("completing a mock test (with no prior practice that day) earns streak credit", async () => {
    await createUser({ username: "streakr6", password: "password123" });
    await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
    await createQuestion({ section: "listening", type: "write-dictation", answer: "hello world", evaluationType: "objective", maxScore: 2 });
    const token = await login("streakr6");

    const start = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = start.body.testSession._id;

    const complete = await request(app).post(`/api/test-sessions/${sessionId}/complete`).set("Authorization", `Bearer ${token}`);
    expect(complete.status).toBe(200);
    expect(complete.body.testSession.status).toBe("COMPLETED");

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.body.streak.currentStreak).toBe(1);
    expect(res.body.streak.learnedToday).toBe(true);
  });
});

describe("streak — isolated per student", () => {
  it("one student's streak activity never affects or leaks into another student's streak", async () => {
    await createUser({ username: "streakr7", password: "password123" });
    await createUser({ username: "streakr8", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
    const tokenA = await login("streakr7");
    const tokenB = await login("streakr8");

    await request(app).post("/api/submissions").set("Authorization", `Bearer ${tokenA}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1)).field("questionId", q._id.toString());

    const resA = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${tokenA}`);
    const resB = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${tokenB}`);
    expect(resA.body.streak.currentStreak).toBe(1);
    expect(resB.body.streak.currentStreak).toBe(0);
  });
});

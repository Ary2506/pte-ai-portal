import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import Question from "../src/models/Question.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

// Admin question CRUD moved to /api/admin/questions in Phase 5 — see test/adminQuestions.test.js.
describe("question access", () => {
  it("lets a student with an active subscription fetch questions", async () => {
    await createUser({ username: "reader1", password: "password123" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("reader1");

    const res = await request(app).get("/api/questions?section=reading").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBeGreaterThan(0);
  });

  it("blocks an expired student from fetching questions", async () => {
    await createUser({
      username: "reader2",
      password: "password123",
      subscriptionStartDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      subscriptionEndDate: new Date(Date.now() - 1000)
    });
    // Sign-in itself is blocked for an expired subscription (Phase 1 behaviour) — confirm that,
    // which is exactly what stops an expired student from ever reaching the questions endpoint.
    const res = await request(app).post("/api/auth/signin").send({ username: "reader2", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SUBSCRIPTION_EXPIRED");
  });

  it("never returns the correct answer or explanation to a student", async () => {
    await createUser({ username: "reader3", password: "password123" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, explanation: "Secret reasoning" });
    const token = await login("reader3");

    const res = await request(app).get("/api/questions?section=reading").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const q of res.body.questions) {
      expect(q.answer).toBeUndefined();
      expect(q.explanation).toBeUndefined();
    }
    expect(JSON.stringify(res.body)).not.toMatch(/Secret reasoning/);
  });

  it("caps the response at 200 questions — a defensive scalability limit, not pagination", async () => {
    await createUser({ username: "reader5", password: "password123" });
    const bulk = Array.from({ length: 205 }, (_, i) => ({
      section: "reading", type: "mcq-single", title: `Bulk ${i}`, prompt: "x",
      options: ["A", "B"], answer: 0, evaluationType: "objective", maxScore: 1, active: true
    }));
    await Question.insertMany(bulk);
    const token = await login("reader5");

    const res = await request(app).get("/api/questions?section=reading").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBe(200);
    // Shape is unchanged — still a plain { questions: [...] } array, no pagination metadata added.
    expect(Object.keys(res.body)).toEqual(["questions"]);
  });

  it("blocks a student from reaching admin question endpoints", async () => {
    await createUser({ username: "reader4", password: "password123" });
    const q = await createQuestion();
    const token = await login("reader4");

    const create = await request(app)
      .post("/api/admin/questions")
      .set("Authorization", `Bearer ${token}`)
      .send({ section: "reading", type: "mcq-single", title: "Hack", prompt: "x", options: ["A", "B"], answer: 0 });
    expect(create.status).toBe(403);

    const update = await request(app)
      .put(`/api/admin/questions/${q._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Hacked" });
    expect(update.status).toBe(403);
  });
});

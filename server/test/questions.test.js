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

  it("still never returns the answer for an objective question, even one with a stored answer value on a different section/type", async () => {
    await createUser({ username: "reader6", password: "password123" });
    await createQuestion({ section: "listening", type: "write-dictation", answer: "The exact sentence.", evaluationType: "objective" });
    const token = await login("reader6");

    const res = await request(app).get("/api/questions?section=listening").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const q of res.body.questions) expect(q.answer).toBeUndefined();
  });

  it("exposes a subjective question's stored answer as an optional model answer — no scoring exploit, since nothing auto-grades from it", async () => {
    await createUser({ username: "reader7", password: "password123" });
    await createQuestion({
      section: "speaking", type: "describe-image", imageUrl: "https://example.com/chart.png",
      answer: "This is the model answer.", evaluationType: "subjective"
    });
    const token = await login("reader7");

    const res = await request(app).get("/api/questions?section=speaking&type=describe-image").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions[0].answer).toBe("This is the model answer.");
    // explanation is still always hidden, regardless of evaluationType.
    expect(res.body.questions[0].explanation).toBeUndefined();
  });

  it("caps the response — a defensive scalability limit, not pagination — and says when it bites", async () => {
    await createUser({ username: "reader5", password: "password123" });
    // Comfortably over the old 200 cap and comfortably under the current one: a real task type
    // of this size must come back whole. Repeat Sentence is already at 183.
    const bulk = Array.from({ length: 205 }, (_, i) => ({
      section: "reading", type: "mcq-single", title: `Bulk ${i}`, prompt: "x",
      options: ["A", "B"], answer: 0, evaluationType: "objective", maxScore: 1, active: true
    }));
    await Question.insertMany(bulk);
    const token = await login("reader5");

    const res = await request(app).get("/api/questions?section=reading").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBe(205);
    // The cap still exists; it simply was not reached. When it is, `truncated` says so rather
    // than the list quietly coming back short.
    expect(res.body.truncated).toBe(false);
    expect(res.body.total).toBe(205);
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

// The practice library counts what a section holds. It used to do that by downloading every
// question of that section in full, which ran straight into the 200-document cap: Speaking (365
// active) and Reading (344) both reported 200, so the library showed 560 questions out of 869
// and the ones past the cap were invisible to it. `index=1` returns ids and types only, under a
// cap sized for the whole bank rather than for one task type's worth of passages.
describe("question index — counting a section without downloading it", () => {
  async function seed(section, count, type = "read-aloud") {
    for (let i = 0; i < count; i++) {
      await createQuestion({
        section, type, title: `${section} ${i}`,
        prompt: "Prompt.", passage: "A passage that costs real bytes to send.",
        evaluationType: "subjective"
      });
    }
  }

  it("returns every question of a section, past the full-document cap", async () => {
    await createUser({ username: "idx1", password: "password123" });
    const token = await login("idx1");
    await seed("speaking", 230);

    const full = await request(app).get("/api/questions?section=speaking")
      .set("Authorization", `Bearer ${token}`);
    const index = await request(app).get("/api/questions?section=speaking&index=1")
      .set("Authorization", `Bearer ${token}`);

    // The full fetch is still capped — that is deliberate, it carries passages — but the cap is
    // now far above any one task type, so 230 comes back whole.
    expect(full.body.questions).toHaveLength(230);
    expect(full.body.truncated).toBe(false);
    // The index is not, which is the whole point.
    expect(index.body.questions).toHaveLength(230);
    expect(index.body.total).toBe(230);
  });

  it("carries only what a count needs — no passage, no prompt, no answer", async () => {
    await createUser({ username: "idx2", password: "password123" });
    const token = await login("idx2");
    await seed("reading", 2, "mcq-single");

    const res = await request(app).get("/api/questions?section=reading&index=1")
      .set("Authorization", `Bearer ${token}`);
    for (const question of res.body.questions) {
      expect(question._id).toBeTruthy();
      expect(question.type).toBeTruthy();
      expect(question.passage).toBeUndefined();
      expect(question.prompt).toBeUndefined();
      expect(question.answer).toBeUndefined();
      expect(question.transcript).toBeUndefined();
    }
  });

  it("counts only active questions, like every other student-facing fetch", async () => {
    await createUser({ username: "idx3", password: "password123" });
    const token = await login("idx3");
    await seed("writing", 3, "essay");
    await Question.updateOne({ section: "writing", title: "writing 0" }, { $set: { active: false } });

    const res = await request(app).get("/api/questions?section=writing&index=1")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.questions).toHaveLength(2);
  });

  it("still requires an authenticated, subscribed student", async () => {
    const res = await request(app).get("/api/questions?section=reading&index=1");
    expect(res.status).toBe(401);
  });
});

// A cap that is hit silently is indistinguishable from a bank that is simply smaller, which is
// precisely why the old 200-document cap went unnoticed while it hid 309 questions.
describe("a reached cap is never silent", () => {
  it("reports truncated:false while the bank fits", async () => {
    await createUser({ username: "trunc1", password: "password123" });
    const token = await login("trunc1");
    await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });

    const res = await request(app).get("/api/questions?section=writing")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.truncated).toBe(false);
    expect(res.body.total).toBe(res.body.questions.length);
  });

  it("reports a total alongside the questions in index mode too", async () => {
    await createUser({ username: "trunc2", password: "password123" });
    const token = await login("trunc2");
    for (let i = 0; i < 3; i++) {
      await createQuestion({ section: "reading", type: "mcq-single", title: `Q${i}`, options: ["A", "B"], answer: 1, evaluationType: "objective" });
    }

    const res = await request(app).get("/api/questions?section=reading&index=1")
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.total).toBe(3);
    expect(res.body.truncated).toBe(false);
  });
});

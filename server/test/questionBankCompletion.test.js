import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

// Phase 11 restored two question types to the active bank using content already committed to
// the project (server/src/seed.js), not invented here — these tests prove the *generic*
// validation/fetch/submission/scoring/mock-selection machinery genuinely works end-to-end for
// both, since no active question of either type existed to exercise these paths before.
describe("speaking/answer-short-question and listening/mcq-single — validation", () => {
  it("admin creation server-derives the correct evaluationType/maxScore for both types", async () => {
    await createAdmin({ username: "qbcadmin1", password: "password123" });
    const token = await login("qbcadmin1");

    const speaking = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "speaking", type: "answer-short-question", title: "Answer Short Question",
      prompt: "What do we call the first meal of the day?", difficulty: "easy"
    });
    expect(speaking.status).toBe(201);
    expect(speaking.body.question.evaluationType).toBe("subjective");
    expect(speaking.body.question.maxScore).toBe(90);

    const listening = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "listening", type: "mcq-single", title: "Multiple Choice",
      prompt: "Listen and choose the matching statement.", audioUrl: "https://example.com/audio.mp3",
      options: ["A", "B", "C", "D"], answer: 2, difficulty: "medium"
    });
    expect(listening.status).toBe(201);
    expect(listening.body.question.evaluationType).toBe("objective");
    expect(listening.body.question.maxScore).toBe(1);
  });
});

describe("speaking/answer-short-question and listening/mcq-single — safe student fetch", () => {
  it("never exposes answer or explanation for either type via the student practice endpoint", async () => {
    await createUser({ username: "qbcstudent1", password: "password123" });
    await createQuestion({ section: "speaking", type: "answer-short-question", evaluationType: "subjective" });
    await createQuestion({
      section: "listening", type: "mcq-single", options: ["A", "B", "C"], answer: 1,
      explanation: "B is correct because of the audio content."
    });
    const token = await login("qbcstudent1");

    const speakingRes = await request(app).get("/api/questions?section=speaking&type=answer-short-question").set("Authorization", `Bearer ${token}`);
    expect(speakingRes.body.questions[0].answer).toBeUndefined();

    const listeningRes = await request(app).get("/api/questions?section=listening&type=mcq-single").set("Authorization", `Bearer ${token}`);
    expect(listeningRes.body.questions[0].answer).toBeUndefined();
    expect(listeningRes.body.questions[0].explanation).toBeUndefined();
    expect(JSON.stringify(listeningRes.body)).not.toContain("B is correct because");
  });
});

describe("speaking/answer-short-question and listening/mcq-single — submission and scoring", () => {
  it("answer-short-question is evaluated as a normal subjective response, no fabricated pronunciation data", async () => {
    await createUser({ username: "qbcstudent2", password: "password123" });
    const q = await createQuestion({ section: "speaking", type: "answer-short-question", evaluationType: "subjective" });
    const token = await login("qbcstudent2");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "speaking").field("type", "answer-short-question")
      .field("transcript", "Breakfast").field("questionId", String(q._id));

    expect(res.status).toBe(201);
    expect(res.body.submission.evaluationType).toBe("subjective");
    expect(res.body.submission.maxScore).toBe(90);
    expect(res.body.submission.feedback.note).toMatch(/does not analyze grammar, vocabulary, or \(for speaking\) pronunciation/);
  });

  it("listening/mcq-single scores correct and incorrect answers exactly like the existing reading/mcq-single scorer", async () => {
    await createUser({ username: "qbcstudent3", password: "password123" });
    const q = await createQuestion({ section: "listening", type: "mcq-single", options: ["A", "B", "C", "D"], answer: 3 });
    const token = await login("qbcstudent3");

    const correct = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "mcq-single").field("answer", JSON.stringify(3)).field("questionId", String(q._id));
    expect(correct.status).toBe(201);
    expect(correct.body.submission.score).toBe(1);
    expect(correct.body.submission.feedback.correct).toBe(true);
  });
});

describe("speaking/answer-short-question and listening/mcq-single — mock selection", () => {
  it("the mock engine can select answer-short-question when it is the only active speaking candidate", async () => {
    await createUser({ username: "qbcstudent4", password: "password123" });
    await createQuestion({ section: "speaking", type: "answer-short-question", evaluationType: "subjective" });
    await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    await createQuestion({ section: "listening", type: "write-dictation", answer: "hello world", maxScore: 2 });
    const token = await login("qbcstudent4");

    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(201);
    const speakingQ = res.body.questions.find(q => q.section === "speaking");
    expect(speakingQ.type).toBe("answer-short-question");
  });

  it("the mock engine can select listening/mcq-single when it is the only active listening candidate", async () => {
    await createUser({ username: "qbcstudent5", password: "password123" });
    await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    await createQuestion({ section: "listening", type: "mcq-single", options: ["A", "B", "C"], answer: 0 });
    const token = await login("qbcstudent5");

    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(201);
    const listeningQ = res.body.questions.find(q => q.section === "listening");
    expect(listeningQ.type).toBe("mcq-single");
    expect(listeningQ.answer).toBeUndefined(); // safe fields even inside a mock's question payload
  });
});

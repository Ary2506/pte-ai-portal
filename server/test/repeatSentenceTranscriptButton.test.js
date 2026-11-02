import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser } from "./helpers.js";
import Question from "../src/models/Question.js";
import TestSession from "../src/models/TestSession.js";

// GET /api/questions/:id/transcript backs the Repeat Sentence "Transcript" button.
const SENTENCE = "The supermarket is situated close to the theater.";

async function login(username) {
  const res = await request(app).post("/api/auth/signin").send({ username, password: "password123" });
  return res.body.token;
}
async function repeatSentence(overrides = {}) {
  return Question.create({
    section: "speaking", type: "repeat-sentence", title: "Repeat Sentence 1", prompt: "Listen, then repeat.",
    audioUrl: "/audio/repeat-sentence/core/core-001.mp3", transcript: SENTENCE, evaluationType: "subjective", active: true, ...overrides
  });
}
const get = (token, id) => request(app).get(`/api/questions/${id}/transcript`).set("Authorization", `Bearer ${token}`);

describe("GET /api/questions/:id/transcript", () => {
  it("returns the transcript of a repeat-sentence question to a signed-in student", async () => {
    await createUser({ username: "tb1", password: "password123" });
    const q = await repeatSentence();
    const res = await get(await login("tb1"), q._id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transcript: SENTENCE });
  });

  it("still never ships the transcript in the question list", async () => {
    await createUser({ username: "tb2", password: "password123" });
    await repeatSentence();
    const res = await request(app).get("/api/questions?section=speaking&type=repeat-sentence").set("Authorization", `Bearer ${await login("tb2")}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("situated close to the theater");
  });

  it("requires a signed-in student", async () => {
    const q = await repeatSentence();
    expect((await request(app).get(`/api/questions/${q._id}/transcript`)).status).toBe(401);
  });

  it("is limited to repeat-sentence: it cannot be used to read another type's answer key", async () => {
    await createUser({ username: "tb3", password: "password123" });
    const dictation = await Question.create({
      section: "listening", type: "write-dictation", title: "Dictation", prompt: "Type it.", audioUrl: "/a.mp3",
      transcript: "Secret dictation sentence.", answer: "Secret dictation sentence.", evaluationType: "objective", active: true
    });
    const res = await get(await login("tb3"), dictation._id);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Secret dictation");
  });

  it("404s for an inactive question, one with no transcript yet, an unknown id, and a malformed id", async () => {
    await createUser({ username: "tb4", password: "password123" });
    const token = await login("tb4");
    const inactive = await repeatSentence({ active: false });
    const pending = await repeatSentence({ transcript: undefined, sourceGroup: "repeat-sentence/core-p/054" });
    expect((await get(token, inactive._id)).status).toBe(404);
    expect((await get(token, pending._id)).status).toBe(404);
    expect((await get(token, "64b000000000000000000000")).status).toBe(404);
    expect((await get(token, "not-an-id")).status).toBe(404);
  });

  it("is refused while that question belongs to a mock test the student has open", async () => {
    const user = await createUser({ username: "tb5", password: "password123" });
    const q = await repeatSentence();
    await TestSession.create({ user: user._id, testType: "mock", totalQuestions: 1, questionIds: [q._id], startedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    const res = await get(await login("tb5"), q._id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRANSCRIPT_LOCKED_IN_MOCK");
    expect(JSON.stringify(res.body)).not.toContain("situated close to the theater");
  });

  it("is available again once that mock is finished, or has run out of time", async () => {
    const user = await createUser({ username: "tb6", password: "password123" });
    const q = await repeatSentence();
    const token = await login("tb6");
    const session = await TestSession.create({ user: user._id, testType: "mock", totalQuestions: 1, questionIds: [q._id], startedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    await TestSession.updateOne({ _id: session._id }, { status: "COMPLETED" });
    expect((await get(token, q._id)).status).toBe(200);
    await TestSession.updateOne({ _id: session._id }, { status: "IN_PROGRESS", expiresAt: new Date(Date.now() - 1000) });
    expect((await get(token, q._id)).status).toBe(200);
  });

  it("another student's open mock does not lock it for this student", async () => {
    const other = await createUser({ username: "tb7a", password: "password123" });
    await createUser({ username: "tb7b", password: "password123" });
    const q = await repeatSentence();
    await TestSession.create({ user: other._id, testType: "mock", totalQuestions: 1, questionIds: [q._id], startedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    expect((await get(await login("tb7b"), q._id)).status).toBe(200);
  });
});

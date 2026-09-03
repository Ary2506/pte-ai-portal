import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import Submission from "../src/models/Submission.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

async function submitDictation(token, questionId, text) {
  return request(app)
    .post("/api/submissions")
    .set("Authorization", `Bearer ${token}`)
    .field("section", "listening")
    .field("type", "write-dictation")
    .field("answer", JSON.stringify(text))
    .field("questionId", questionId.toString());
}

describe("write-dictation scoring — missing/empty answer key is invalid, never exploitable", () => {
  it("rejects with INVALID_ANSWER_FORMAT and creates no Submission when the question has no answer key at all", async () => {
    await createUser({ username: "dict1", password: "password123" });
    const q = await createQuestion({ section: "listening", type: "write-dictation" }); // no `answer` passed at all
    const token = await login("dict1");

    const before = await Submission.countDocuments({});
    const res = await submitDictation(token, q._id, "hello world");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_ANSWER_FORMAT");
    const after = await Submission.countDocuments({});
    expect(after).toBe(before); // no score awarded — the submission was never created
  });

  it("this is the exact original bug scenario: a blank submission against a missing answer key must NOT score full credit", async () => {
    await createUser({ username: "dict2", password: "password123" });
    const q = await createQuestion({ section: "listening", type: "write-dictation" });
    const token = await login("dict2");

    const res = await submitDictation(token, q._id, "");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_ANSWER_FORMAT");
  });

  it("rejects when the question's answer key is an empty string", async () => {
    await createUser({ username: "dict3", password: "password123" });
    const q = await createQuestion({ section: "listening", type: "write-dictation", answer: "" });
    const token = await login("dict3");

    const res = await submitDictation(token, q._id, "hello world");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_ANSWER_FORMAT");
  });

  it("rejects when the question's answer key is whitespace-only", async () => {
    await createUser({ username: "dict4", password: "password123" });
    const q = await createQuestion({ section: "listening", type: "write-dictation", answer: "   " });
    const token = await login("dict4");

    const res = await submitDictation(token, q._id, "hello world");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_ANSWER_FORMAT");
  });

  it("still scores an exact match with full credit when the question has a real answer key (unchanged algorithm)", async () => {
    await createUser({ username: "dict5", password: "password123" });
    const q = await createQuestion({ section: "listening", type: "write-dictation", answer: "the meeting starts at noon" });
    const token = await login("dict5");

    const res = await submitDictation(token, q._id, "the meeting starts at noon");
    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(res.body.submission.maxScore);
    expect(res.body.submission.feedback.correct).toBe(true);
  });

  it("still gives partial credit for a partially-correct real answer key (unchanged algorithm)", async () => {
    await createUser({ username: "dict6", password: "password123" });
    const q = await createQuestion({ section: "listening", type: "write-dictation", answer: "the meeting starts at noon" });
    const token = await login("dict6");

    const res = await submitDictation(token, q._id, "the meeting starts at midnight");
    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBeGreaterThan(0);
    expect(res.body.submission.score).toBeLessThan(res.body.submission.maxScore);
    expect(res.body.submission.feedback.correct).toBe(false);
  });
});

describe("dictation hardening does not affect other objective question types", () => {
  it("mcq-single scoring is unchanged", async () => {
    await createUser({ username: "dict7", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("dict7");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1)).field("questionId", String(q._id));
    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(1);
  });
});

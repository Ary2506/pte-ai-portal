import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import TestSession from "../src/models/TestSession.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("submission correctness and ownership", () => {
  it("accepts a valid objective answer and scores it server-side", async () => {
    await createUser({ username: "sub1", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("sub1");

    const res = await request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${token}`)
      .field("section", "reading")
      .field("type", "mcq-single")
      .field("answer", JSON.stringify(1))
      .field("questionId", q._id.toString());

    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(1);
    expect(res.body.submission.evaluationType).toBe("objective");
  });

  it("a client cannot inject a fake score — the server always computes it", async () => {
    await createUser({ username: "sub2", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("sub2");

    // Deliberately submit the WRONG answer while also sending a forged "score" field.
    const res = await request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${token}`)
      .field("section", "reading")
      .field("type", "mcq-single")
      .field("answer", JSON.stringify(0))
      .field("questionId", q._id.toString())
      .field("score", "999");

    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(0);
  });

  it("rejects submitting to another user's test session", async () => {
    await createUser({ username: "sub3", password: "password123" });
    await createUser({ username: "sub4", password: "password123" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const tokenOwner = await login("sub3");
    const tokenAttacker = await login("sub4");

    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${tokenOwner}`);
    const sessionId = started.body.testSession._id;

    const res = await request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${tokenAttacker}`)
      .field("section", "reading")
      .field("type", "mcq-single")
      .field("answer", JSON.stringify(0))
      .field("testSessionId", sessionId);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("rejects a duplicate answer for the same question within one test session", async () => {
    await createUser({ username: "sub5", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("sub5");

    const session = await TestSession.create({ user: (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).body.user.id, totalQuestions: 1 });

    const first = await request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1))
      .field("questionId", q._id.toString()).field("testSessionId", session._id.toString());
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(0))
      .field("questionId", q._id.toString()).field("testSessionId", session._id.toString());
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("DUPLICATE_SUBMISSION");
  });

  it("rejects any further submission once the test session is completed", async () => {
    await createUser({ username: "sub6", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("sub6");

    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = started.body.testSession._id;
    await request(app).post(`/api/test-sessions/${sessionId}/complete`).set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post("/api/submissions")
      .set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1))
      .field("questionId", q._id.toString()).field("testSessionId", sessionId);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SESSION_ALREADY_COMPLETED");
  });
});

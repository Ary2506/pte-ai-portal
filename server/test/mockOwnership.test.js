import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

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
  return res.body.testSession._id;
}

describe("mock session ownership and malformed input", () => {
  it("rejects a second student reading another student's test session", async () => {
    await createUser({ username: "own1", password: "password123" });
    await createUser({ username: "own2", password: "password123" });
    await seedOnePerSection();
    const tokenA = await login("own1");
    const tokenB = await login("own2");
    const sessionId = await startMock(tokenA);

    const res = await request(app).get(`/api/test-sessions/${sessionId}`).set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("rejects a second student completing another student's test session", async () => {
    await createUser({ username: "own3", password: "password123" });
    await createUser({ username: "own4", password: "password123" });
    await seedOnePerSection();
    const tokenA = await login("own3");
    const tokenB = await login("own4");
    const sessionId = await startMock(tokenA);

    const res = await request(app).post(`/api/test-sessions/${sessionId}/complete`).set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("returns a clean 400 for a malformed test session id instead of crashing, and the server stays reachable", async () => {
    await createUser({ username: "malformed1", password: "password123" });
    const token = await login("malformed1");

    const res = await request(app).get("/api/test-sessions/not-a-real-object-id").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });

  it("returns a clean 400 for a malformed questionId on a mock submission", async () => {
    await createUser({ username: "malformed2", password: "password123" });
    await seedOnePerSection();
    const token = await login("malformed2");
    const sessionId = await startMock(token);

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", JSON.stringify(1))
      .field("questionId", "not-a-real-object-id").field("testSessionId", sessionId);

    expect(res.status).toBe(400);
  });
});

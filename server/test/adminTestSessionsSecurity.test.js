import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createUser, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

async function seedOnePerSection() {
  await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
  await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
  await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
  await createQuestion({ section: "listening", type: "write-dictation", answer: "hello world today", evaluationType: "objective", maxScore: 3 });
}

async function startMock(token) {
  const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
  return res.body.testSession._id;
}

describe("admin mock/test-session visibility — access control", () => {
  it("rejects a non-admin student from the list endpoint", async () => {
    await createUser({ username: "student_ts4", password: "password123" });
    const token = await login("student_ts4");

    const res = await request(app).get("/api/admin/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("rejects a non-admin student from the detail endpoint too", async () => {
    await createAdmin({ username: "admints5", password: "password123" });
    await createUser({ username: "student_ts5", password: "password123" });
    await seedOnePerSection();
    const adminToken = await login("admints5");
    const studentToken = await login("student_ts5");
    const sessionId = await startMock(studentToken);

    const res = await request(app).get(`/api/admin/test-sessions/${sessionId}`).set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
  });

  it("returns a clean 400 for a malformed session id on the detail endpoint", async () => {
    await createAdmin({ username: "admints6", password: "password123" });
    const adminToken = await login("admints6");

    const res = await request(app).get("/api/admin/test-sessions/not-a-real-id").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a well-formed but non-existent session id on the detail endpoint", async () => {
    await createAdmin({ username: "admints7", password: "password123" });
    const adminToken = await login("admints7");

    const res = await request(app).get("/api/admin/test-sessions/6a0000000000000000000000").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request to the list endpoint", async () => {
    const res = await request(app).get("/api/admin/test-sessions");
    expect(res.status).toBe(401);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import TestSession from "../src/models/TestSession.js";

// A mock runs for two hours. A refresh, a closed tab or a browser that reloads itself used to
// leave the attempt open on the server, clock still running, while the student was shown the
// "Start Mock Test" screen with no way back into it.
//
// GET /test-sessions/active hands the attempt back whole: the same questions in the same order
// (the session stores questionIds), and the answers already submitted.
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

describe("resuming a mock test in progress", () => {
  it("returns nothing when the student has no attempt open", async () => {
    await createUser({ username: "res1", password: "password123" });
    const res = await request(app).get("/api/test-sessions/active")
      .set("Authorization", `Bearer ${await login("res1")}`);

    expect(res.status).toBe(200);
    expect(res.body.testSession).toBeNull();
  });

  it("refuses an anonymous caller", async () => {
    const res = await request(app).get("/api/test-sessions/active");
    expect(res.status).toBe(401);
  });

  it("hands back the same questions, in the order they were issued", async () => {
    await createUser({ username: "res2", password: "password123" });
    const token = await login("res2");
    await seedOnePerSection();

    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(started.status).toBe(201);
    const issued = started.body.questions.map(q => String(q._id));

    const resumed = await request(app).get("/api/test-sessions/active").set("Authorization", `Bearer ${token}`);

    expect(resumed.status).toBe(200);
    expect(String(resumed.body.testSession._id)).toBe(String(started.body.testSession._id));
    // Order matters: question 34 has to be the same question 34 it was before the refresh.
    expect(resumed.body.questions.map(q => String(q._id))).toEqual(issued);
  });

  it("never leaks the answer key in the resumed questions", async () => {
    await createUser({ username: "res3", password: "password123" });
    const token = await login("res3");
    await seedOnePerSection();
    await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);

    const resumed = await request(app).get("/api/test-sessions/active").set("Authorization", `Bearer ${token}`);

    // Same projection a freshly started test uses — resuming must not be a way around it.
    for (const question of resumed.body.questions) {
      expect(question.answer).toBeUndefined();
      expect(question.explanation).toBeUndefined();
    }
  });

  it("brings back the answers already submitted", async () => {
    await createUser({ username: "res4", password: "password123" });
    const token = await login("res4");
    await seedOnePerSection();

    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = started.body.testSession._id;
    const reading = started.body.questions.find(q => q.section === "reading");

    await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", reading.type).field("answer", JSON.stringify(1))
      .field("questionId", reading._id).field("testSessionId", sessionId);

    const resumed = await request(app).get("/api/test-sessions/active").set("Authorization", `Bearer ${token}`);

    expect(resumed.body.submissions).toHaveLength(1);
    const [row] = resumed.body.submissions;
    expect(String(row.question._id)).toBe(String(reading._id));
    expect(row.answer).toBe(1);
  });

  it("does not resume another student's attempt", async () => {
    await createUser({ username: "res5", password: "password123" });
    await createUser({ username: "res6", password: "password123" });
    await seedOnePerSection();
    await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${await login("res5")}`);

    const other = await request(app).get("/api/test-sessions/active")
      .set("Authorization", `Bearer ${await login("res6")}`);

    expect(other.body.testSession).toBeNull();
  });

  it("does not resume a completed attempt", async () => {
    await createUser({ username: "res7", password: "password123" });
    const token = await login("res7");
    await seedOnePerSection();
    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    await request(app).post(`/api/test-sessions/${started.body.testSession._id}/complete`)
      .set("Authorization", `Bearer ${token}`);

    const resumed = await request(app).get("/api/test-sessions/active").set("Authorization", `Bearer ${token}`);

    expect(resumed.body.testSession).toBeNull();
  });

  it("expires an attempt whose time ran out rather than resuming it", async () => {
    await createUser({ username: "res8", password: "password123" });
    const token = await login("res8");
    await seedOnePerSection();
    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);

    // Wind the clock past its deadline, as if the tab had been left closed overnight.
    await TestSession.updateOne({ _id: started.body.testSession._id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } });

    const resumed = await request(app).get("/api/test-sessions/active").set("Authorization", `Bearer ${token}`);

    expect(resumed.body.testSession).toBeNull();
    const after = await TestSession.findById(started.body.testSession._id).lean();
    expect(after.status).toBe("EXPIRED");
  });
});

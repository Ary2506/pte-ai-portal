import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import User from "../src/models/User.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("client cannot control evaluation outcome", () => {
  it("ignores a client-supplied score, scoringMethod, and evaluationStatus", async () => {
    await createUser({ username: "cheat1", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("cheat1");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay")
      .field("answer", JSON.stringify("A short answer."))
      .field("transcript", "A short answer.")
      .field("questionId", q._id.toString())
      .field("score", "90")
      .field("scoringMethod", "ai")
      .field("evaluationStatus", "COMPLETED")
      .field("feedback", JSON.stringify({ overall: "perfect, trust me" }));

    expect(res.status).toBe(201);
    expect(res.body.submission.scoringMethod).toBe("heuristic"); // server decided, not the client
    expect(res.body.submission.feedback.overall).not.toMatch(/trust me/);
  });
});

describe("AI cost control", () => {
  it("does not allow retrying an evaluation that already completed", async () => {
    await createUser({ username: "retry1", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("retry1");

    const submitRes = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay")
      .field("answer", JSON.stringify("A complete essay response with enough content to score."))
      .field("transcript", "A complete essay response with enough content to score.")
      .field("questionId", q._id.toString());
    expect(submitRes.body.submission.evaluationStatus).toBe("COMPLETED");

    const retryRes = await request(app).post(`/api/submissions/${submitRes.body.submission._id}/retry-evaluation`).set("Authorization", `Bearer ${token}`);
    expect(retryRes.status).toBe(409);
    expect(retryRes.body.code).toBe("RETRY_NOT_ALLOWED");
  });

  it("rejects retrying another user's submission", async () => {
    await createUser({ username: "retry2", password: "password123" });
    await createUser({ username: "retry3", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const ownerToken = await login("retry2");
    const attackerToken = await login("retry3");

    const submitRes = await request(app).post("/api/submissions").set("Authorization", `Bearer ${ownerToken}`)
      .field("section", "writing").field("type", "essay")
      .field("answer", JSON.stringify("A complete essay response with enough content."))
      .field("transcript", "A complete essay response with enough content.")
      .field("questionId", q._id.toString());

    const res = await request(app).post(`/api/submissions/${submitRes.body.submission._id}/retry-evaluation`).set("Authorization", `Bearer ${attackerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("subscription/account gating still applies to evaluation submissions", () => {
  it("rejects a submission once the subscription has expired mid-session", async () => {
    await createUser({ username: "expired1", password: "password123", subscriptionEndDate: new Date(Date.now() + 2000) });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("expired1");
    await User.updateOne({ username: "expired1" }, { subscriptionEndDate: new Date(Date.now() - 1000) });

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay").field("answer", JSON.stringify("text")).field("transcript", "text")
      .field("questionId", q._id.toString());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SUBSCRIPTION_EXPIRED");
  });

  it("rejects a submission from a blocked account", async () => {
    await createUser({ username: "blocked1", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("blocked1");
    await User.updateOne({ username: "blocked1" }, { accountStatus: "BLOCKED" });

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay").field("answer", JSON.stringify("text")).field("transcript", "text")
      .field("questionId", q._id.toString());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BLOCKED");
  });
});

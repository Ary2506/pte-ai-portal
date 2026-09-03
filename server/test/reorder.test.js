import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

async function submitReorder(token, questionId, order) {
  return request(app)
    .post("/api/submissions")
    .set("Authorization", `Bearer ${token}`)
    .field("section", "reading")
    .field("type", "reorder")
    .field("answer", JSON.stringify(order))
    .field("questionId", questionId.toString());
}

describe("re-order paragraphs scoring", () => {
  it("scores a fully correct order with full marks", async () => {
    await createUser({ username: "reorder1", password: "password123" });
    const q = await createQuestion({
      section: "reading", type: "reorder",
      options: ["Finally...", "First...", "After that...", "They then..."],
      answer: [1, 2, 3, 0]
    });
    const token = await login("reorder1");

    const res = await submitReorder(token, q._id, [1, 2, 3, 0]);
    expect(res.status).toBe(201);
    expect(res.body.submission.feedback.correct).toBe(true);
    expect(res.body.submission.score).toBe(res.body.submission.maxScore);
  });

  it("gives partial credit for a partially-correct order, not a flat 0/1", async () => {
    await createUser({ username: "reorder2", password: "password123" });
    const q = await createQuestion({
      section: "reading", type: "reorder",
      options: ["Finally...", "First...", "After that...", "They then..."],
      answer: [1, 2, 3, 0]
    });
    const token = await login("reorder2");

    // Correct adjacent pairs (1,2) and (2,3) preserved; only the final item is out of place.
    const res = await submitReorder(token, q._id, [1, 2, 3, 0].slice().reverse());
    expect(res.status).toBe(201);
    expect(res.body.submission.feedback.correct).toBe(false);
    expect(res.body.submission.score).toBeGreaterThanOrEqual(0);
    expect(res.body.submission.score).toBeLessThan(res.body.submission.maxScore);
  });

  it("rejects a submission with an invalid answer shape", async () => {
    await createUser({ username: "reorder3", password: "password123" });
    const q = await createQuestion({
      section: "reading", type: "reorder",
      options: ["Finally...", "First...", "After that...", "They then..."],
      answer: [1, 2, 3, 0]
    });
    const token = await login("reorder3");

    // Duplicate index and wrong length — not a valid permutation of the four options.
    const res = await submitReorder(token, q._id, [1, 1, 2]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_ANSWER_FORMAT");
  });
});

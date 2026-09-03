import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

// scoreMultipleChoice (server/src/scoring/objective.js) had zero backend test coverage before
// this phase — a genuine pre-existing gap found while adding the Phase 17 frontend UI for this
// type. This exercises the real route end-to-end with a test-DB fixture question, the same
// pattern every other backend test in this suite already uses — not new production content (the
// real question bank's mcq-multiple gap, reading/listening = 0, is untouched, per Part 26).
describe("mcq-multiple — server-side scoring via a real submission", () => {
  it("awards full credit for selecting exactly the correct set of options", async () => {
    await createUser({ username: "multi1", password: "password123" });
    const q = await createQuestion({
      section: "reading", type: "mcq-multiple", evaluationType: "objective",
      options: ["Apple", "Banana", "Carrot", "Date"], answer: [0, 2]
    });
    const token = await login("multi1");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-multiple").field("answer", JSON.stringify([0, 2])).field("questionId", q._id.toString());

    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(2);
    expect(res.body.submission.maxScore).toBe(2);
    expect(res.body.submission.feedback.correct).toBe(true);
    expect(res.body.submission.feedback.correctAnswerText).toBe("Apple, Carrot");
  });

  it("gives partial credit (+1 per correct, -1 per incorrect, floored at 0), not all-or-nothing", async () => {
    await createUser({ username: "multi2", password: "password123" });
    const q = await createQuestion({
      section: "reading", type: "mcq-multiple", evaluationType: "objective",
      options: ["Apple", "Banana", "Carrot", "Date"], answer: [0, 2]
    });
    const token = await login("multi2");

    // Selects one correct (Apple) and one incorrect (Banana): 1 - 1 = 0.
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-multiple").field("answer", JSON.stringify([0, 1])).field("questionId", q._id.toString());

    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(0);
    expect(res.body.submission.feedback.correct).toBe(false);
    expect(res.body.submission.feedback.studentAnswerText).toBe("Apple, Banana");
  });

  it("never calls AI for mcq-multiple — it is fully server-side deterministic", async () => {
    await createUser({ username: "multi3", password: "password123" });
    const q = await createQuestion({
      section: "listening", type: "mcq-multiple", evaluationType: "objective",
      options: ["A", "B", "C"], answer: [1]
    });
    const token = await login("multi3");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "mcq-multiple").field("answer", JSON.stringify([1])).field("questionId", q._id.toString());

    expect(res.status).toBe(201);
    expect(res.body.submission.evaluationType).toBe("objective");
    expect(res.body.submission.scoringMethod).toBeNull();
  });
});

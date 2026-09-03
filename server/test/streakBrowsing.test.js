import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

// Phase 17, Part 17 / Part 27 item 35: opening the Practice Hub, opening a section/task page, and
// opening a specific question must never themselves earn streak credit — all three collapse to
// the same underlying call, GET /api/questions, which is read-only and never calls
// recordLearningActivity (only a real Submission or a completed TestSession does — see
// routes/submissions.js and routes/testSessions.js, unchanged this phase).
describe("streak — browsing/opening questions never earns credit", () => {
  it("repeatedly fetching the question list for every section (as the Practice Hub and each task page do) leaves the streak untouched", async () => {
    await createUser({ username: "browse1", password: "password123" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" });
    await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    const token = await login("browse1");

    for (const section of ["speaking", "writing", "reading", "listening"]) {
      const res = await request(app).get(`/api/questions?section=${section}`).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    }

    const dash = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(dash.body.streak).toEqual({ currentStreak: 0, longestStreak: 0, lastLearningDate: null, learnedToday: false });
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

// Reported from the running app: reopening an already-attempted practice question showed the
// FIRST attempt's answer and score, not the most recent one, and the "Done · n/90" badge never
// moved after a better retry.
//
// Practice.jsx builds its per-question map by walking GET /submissions/history and keeping the
// first row it sees for each question id, so the whole behaviour depends on that endpoint
// returning newest-first. These tests pin that contract down.
async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

async function submitAnswer(token, { questionId, localQuestionId, answer }) {
  // The client sends `answer` JSON-encoded (Writing.jsx: form.append("answer", JSON.stringify(text))),
  // and the route JSON.parses it, so a raw string is rejected as malformed.
  const body = { section: "listening", type: "summarize-spoken-text", answer: JSON.stringify(answer) };
  if (questionId) body.questionId = String(questionId);
  if (localQuestionId) body.localQuestionId = localQuestionId;
  return request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`).send(body);
}

describe("re-attempting a practice question", () => {
  it("records a second attempt rather than rejecting it", async () => {
    await createUser({ username: "att1", password: "password123" });
    const token = await login("att1");
    const q = await createQuestion({
      section: "listening", type: "summarize-spoken-text",
      title: "Bilingualism", prompt: "Summarise.", evaluationType: "subjective"
    });

    const first = await submitAnswer(token, { questionId: q._id, answer: "first attempt text" });
    const second = await submitAnswer(token, { questionId: q._id, answer: "second attempt text" });

    expect(first.status).toBe(201);
    // Practice has no duplicate guard — only mock-test submissions do — so a retry must be a new row.
    expect(second.status).toBe(201);
    expect(second.body.submission._id).not.toBe(first.body.submission._id);
  });

  it("returns the most recent attempt first in history", async () => {
    await createUser({ username: "att2", password: "password123" });
    const token = await login("att2");
    const q = await createQuestion({
      section: "listening", type: "summarize-spoken-text",
      title: "Bilingualism", prompt: "Summarise.", evaluationType: "subjective"
    });

    await submitAnswer(token, { questionId: q._id, answer: "OLDEST answer" });
    await submitAnswer(token, { questionId: q._id, answer: "NEWEST answer" });

    const res = await request(app)
      .get("/api/submissions/history?section=listening&type=summarize-spoken-text")
      .set("Authorization", `Bearer ${token}`);

    const rows = res.body.submissions || [];
    const forQuestion = rows.filter(s => String(s.question?._id || s.question) === String(q._id));
    expect(forQuestion.length).toBe(2);

    // This is the exact rule Practice.jsx relies on: it keeps the FIRST row per question id, so
    // the first one here must be the newest attempt or the student sees a stale answer forever.
    expect(forQuestion[0].answer).toBe("NEWEST answer");
  });

  it("orders strictly by createdAt descending across many attempts", async () => {
    await createUser({ username: "att3", password: "password123" });
    const token = await login("att3");
    const q = await createQuestion({
      section: "listening", type: "summarize-spoken-text",
      title: "Postal Relay Systems", prompt: "Summarise.", evaluationType: "subjective"
    });

    for (const n of [1, 2, 3, 4]) {
      await submitAnswer(token, { questionId: q._id, answer: `attempt ${n}` });
    }

    const res = await request(app)
      .get("/api/submissions/history?section=listening&type=summarize-spoken-text")
      .set("Authorization", `Bearer ${token}`);

    const times = (res.body.submissions || []).map(s => new Date(s.createdAt).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
    expect(res.body.submissions[0].answer).toBe("attempt 4");
  });

  it("does the same for bundled local content, which has no Question document", async () => {
    await createUser({ username: "att4", password: "password123" });
    const token = await login("att4");

    await submitAnswer(token, { localQuestionId: "sst-bilingualism", answer: "OLDEST answer" });
    await submitAnswer(token, { localQuestionId: "sst-bilingualism", answer: "NEWEST answer" });

    const res = await request(app)
      .get("/api/submissions/history?section=listening&type=summarize-spoken-text")
      .set("Authorization", `Bearer ${token}`);

    const rows = (res.body.submissions || []).filter(s => s.localQuestionId === "sst-bilingualism");
    expect(rows.length).toBe(2);
    expect(rows[0].answer).toBe("NEWEST answer");
  });
});

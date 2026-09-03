import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createUser, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("historical safety", () => {
  it("refuses to hard-delete a question that has student submissions", async () => {
    await createAdmin({ username: "lifeadmin1", password: "password123" });
    await createUser({ username: "lifestudent1", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const adminToken = await login("lifeadmin1");
    const studentToken = await login("lifestudent1");

    await request(app).post("/api/submissions").set("Authorization", `Bearer ${studentToken}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", "1").field("questionId", q._id.toString());

    const del = await request(app).delete(`/api/admin/questions/${q._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("QUESTION_IN_USE");
  });

  it("keeps a deactivated question's historical submission intact and visible", async () => {
    await createAdmin({ username: "lifeadmin2", password: "password123" });
    await createUser({ username: "lifestudent2", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const adminToken = await login("lifeadmin2");
    const studentToken = await login("lifestudent2");

    await request(app).post("/api/submissions").set("Authorization", `Bearer ${studentToken}`)
      .field("section", "reading").field("type", "mcq-single").field("answer", "1").field("questionId", q._id.toString());

    await request(app).patch(`/api/admin/questions/${q._id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ active: false });

    const history = await request(app).get("/api/submissions/history").set("Authorization", `Bearer ${studentToken}`);
    expect(history.status).toBe(200);
    expect(history.body.submissions.length).toBe(1);
    expect(history.body.submissions[0].score).toBe(1); // the original score is untouched
  });
});

describe("practice and mock selection only ever use active, answer-free questions", () => {
  it("never returns an inactive question to practice mode", async () => {
    await createUser({ username: "lifestudent3", password: "password123" });
    await createQuestion({ section: "reading", type: "mcq-single", title: "Inactive one", options: ["A", "B"], answer: 0, active: false });
    const token = await login("lifestudent3");

    const res = await request(app).get("/api/questions?section=reading").set("Authorization", `Bearer ${token}`);
    expect(res.body.questions.every(q => q.title !== "Inactive one")).toBe(true);
  });

  it("only selects active questions for a mock test and never leaks an answer", async () => {
    await createUser({ username: "lifestudent4", password: "password123" });
    await createQuestion({ section: "reading", type: "mcq-single", title: "Active reading Q", options: ["A", "B"], answer: 1, active: true });
    await createQuestion({ section: "reading", type: "reorder", title: "Inactive reorder Q", options: ["A", "B"], answer: [0, 1], active: false });
    const token = await login("lifestudent4");

    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(201);
    const reading = res.body.questions.find(q => q.section === "reading");
    expect(reading.title).toBe("Active reading Q");
    for (const q of res.body.questions) {
      expect(q.answer).toBeUndefined();
      expect(q.explanation).toBeUndefined();
    }
  });
});

describe("the removed public /uploads mount stays removed", () => {
  it("returns 404 for any direct /uploads path, with no auth attempted", async () => {
    const res = await request(app).get("/uploads/anything-at-all.webm");
    expect(res.status).toBe(404);
  });
});

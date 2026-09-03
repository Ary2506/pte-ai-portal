import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createUser, createQuestion } from "./helpers.js";
import Question from "../src/models/Question.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("admin question CRUD", () => {
  it("lets an admin create a valid question, with evaluationType/maxScore derived server-side", async () => {
    await createAdmin({ username: "qadmin1", password: "password123" });
    const token = await login("qadmin1");

    const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "reading", type: "mcq-single", title: "New MCQ", prompt: "Pick the right one.",
      options: ["A", "B", "C"], answer: 1, explanation: "B is correct.", difficulty: "easy",
      evaluationType: "subjective", maxScore: 999 // deliberately wrong — must be ignored/derived
    });

    expect(res.status).toBe(201);
    expect(res.body.question.evaluationType).toBe("objective"); // derived from type, not trusted
    expect(res.body.question.maxScore).toBe(1); // derived, not the forged 999
  });

  it("lets an admin read a question with full admin-only fields", async () => {
    await createAdmin({ username: "qadmin2", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, explanation: "Because." });
    const token = await login("qadmin2");

    const res = await request(app).get(`/api/admin/questions/${q._id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.question.answer).toBe(1);
    expect(res.body.question.explanation).toBe("Because.");
  });

  it("lets an admin update a question", async () => {
    await createAdmin({ username: "qadmin3", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("qadmin3");

    const res = await request(app).put(`/api/admin/questions/${q._id}`).set("Authorization", `Bearer ${token}`).send({ title: "Updated title" });
    expect(res.status).toBe(200);
    expect(res.body.question.title).toBe("Updated title");
  });

  it("lets an admin deactivate and reactivate a question", async () => {
    await createAdmin({ username: "qadmin4", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("qadmin4");

    const off = await request(app).patch(`/api/admin/questions/${q._id}/status`).set("Authorization", `Bearer ${token}`).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.question.active).toBe(false);

    const on = await request(app).patch(`/api/admin/questions/${q._id}/status`).set("Authorization", `Bearer ${token}`).send({ active: true });
    expect(on.body.question.active).toBe(true);
  });

  it("refuses to activate a question with a missing answer key, even though deactivation always succeeds", async () => {
    await createAdmin({ username: "qadmin7b", password: "password123" });
    // Bypasses API validation on purpose — this is exactly the shape the real Phase 10 bug had:
    // an objective question, already active, with no answer key at all.
    const broken = await createQuestion({ section: "listening", type: "write-dictation", active: true });
    const token = await login("qadmin7b");

    const off = await request(app).patch(`/api/admin/questions/${broken._id}/status`).set("Authorization", `Bearer ${token}`).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.question.active).toBe(false);

    const on = await request(app).patch(`/api/admin/questions/${broken._id}/status`).set("Authorization", `Bearer ${token}`).send({ active: true });
    expect(on.status).toBe(400);
    expect(on.body.code).toBe("VALIDATION_ERROR");

    const stillOff = await Question.findById(broken._id);
    expect(stillOff.active).toBe(false); // the rejected activation must not have taken effect
  });

  it("rejects an invalid question (missing options for a choice question)", async () => {
    await createAdmin({ username: "qadmin5", password: "password123" });
    const token = await login("qadmin5");

    const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "reading", type: "mcq-single", title: "Bad MCQ", prompt: "x", options: ["only one"], answer: 0
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unsupported question type", async () => {
    await createAdmin({ username: "qadmin6", password: "password123" });
    const token = await login("qadmin6");

    const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "reading", type: "made-up-type", title: "x", prompt: "x"
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(/unsupported/i);
  });

  it("blocks a non-admin student from the admin question API entirely", async () => {
    await createUser({ username: "qstudent1", password: "password123" });
    const q = await createQuestion();
    const token = await login("qstudent1");

    const list = await request(app).get("/api/admin/questions").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(403);
    const create = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({});
    expect(create.status).toBe(403);
    const patch = await request(app).patch(`/api/admin/questions/${q._id}/status`).set("Authorization", `Bearer ${token}`).send({ active: false });
    expect(patch.status).toBe(403);
    const del = await request(app).delete(`/api/admin/questions/${q._id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(403);
  });
});

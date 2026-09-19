import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createQuestion } from "./helpers.js";
import AuditLog from "../src/models/AuditLog.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("Question Management audit logging", () => {
  it("creating a question writes an audit entry identifying the admin and the new question", async () => {
    const admin = await createAdmin({ username: "auditadmin1", password: "password123" });
    const token = await login("auditadmin1");

    const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "reading", type: "mcq-single", title: "Audit create test", prompt: "Pick one.",
      options: ["A", "B"], answer: 0
    });
    expect(res.status).toBe(201);

    // Fire-and-forget write (see utils/audit.js) — give it a tick to land before asserting.
    await new Promise(r => setTimeout(r, 50));
    const entry = await AuditLog.findOne({ action: "QUESTION_CREATED" }).sort({ createdAt: -1 });
    expect(entry).toBeTruthy();
    expect(String(entry.adminUser)).toBe(String(admin._id));
    expect(String(entry.metadata.questionId)).toBe(String(res.body.question._id));
    expect(entry.metadata.title).toBe("Audit create test");
    expect(entry.metadata.section).toBe("reading");
    expect(entry.metadata.type).toBe("mcq-single");
  });

  it("updating a question writes an audit entry with before/after and the changed fields", async () => {
    const admin = await createAdmin({ username: "auditadmin2", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, title: "Original title" });
    const token = await login("auditadmin2");

    const res = await request(app).put(`/api/admin/questions/${q._id}`).set("Authorization", `Bearer ${token}`).send({ title: "Changed title" });
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 50));
    const entry = await AuditLog.findOne({ action: "QUESTION_UPDATED" }).sort({ createdAt: -1 });
    expect(entry).toBeTruthy();
    expect(String(entry.adminUser)).toBe(String(admin._id));
    expect(String(entry.metadata.questionId)).toBe(String(q._id));
    expect(entry.metadata.before.title).toBe("Original title");
    expect(entry.metadata.after.title).toBe("Changed title");
    expect(entry.metadata.changedFields).toContain("title");
  });

  it("activating and deactivating a question each write their own audit entry", async () => {
    const admin = await createAdmin({ username: "auditadmin3", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("auditadmin3");

    const off = await request(app).patch(`/api/admin/questions/${q._id}/status`).set("Authorization", `Bearer ${token}`).send({ active: false });
    expect(off.status).toBe(200);
    const on = await request(app).patch(`/api/admin/questions/${q._id}/status`).set("Authorization", `Bearer ${token}`).send({ active: true });
    expect(on.status).toBe(200);

    await new Promise(r => setTimeout(r, 50));
    const deactivated = await AuditLog.findOne({ action: "QUESTION_DEACTIVATED" }).sort({ createdAt: -1 });
    const activated = await AuditLog.findOne({ action: "QUESTION_ACTIVATED" }).sort({ createdAt: -1 });
    expect(deactivated).toBeTruthy();
    expect(activated).toBeTruthy();
    expect(String(deactivated.metadata.questionId)).toBe(String(q._id));
    expect(String(activated.metadata.questionId)).toBe(String(q._id));
    expect(String(deactivated.adminUser)).toBe(String(admin._id));
    expect(String(activated.adminUser)).toBe(String(admin._id));
  });

  it("deleting a question writes an audit entry that still identifies the now-deleted question", async () => {
    const admin = await createAdmin({ username: "auditadmin4", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, title: "To be deleted" });
    const token = await login("auditadmin4");

    const res = await request(app).delete(`/api/admin/questions/${q._id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    await new Promise(r => setTimeout(r, 50));
    const entry = await AuditLog.findOne({ action: "QUESTION_DELETED" }).sort({ createdAt: -1 });
    expect(entry).toBeTruthy();
    expect(String(entry.adminUser)).toBe(String(admin._id));
    expect(String(entry.metadata.questionId)).toBe(String(q._id));
    expect(entry.metadata.title).toBe("To be deleted");
  });

  it("audit entries never appear for a non-admin's rejected attempt", async () => {
    const q = await createQuestion();
    const before = await AuditLog.countDocuments({ action: { $in: ["QUESTION_CREATED", "QUESTION_UPDATED", "QUESTION_DELETED"] } });

    // No admin created here — requireAdmin rejects before the route body ever runs.
    const res = await request(app).delete(`/api/admin/questions/${q._id}`);
    expect(res.status).toBe(401);

    const after = await AuditLog.countDocuments({ action: { $in: ["QUESTION_CREATED", "QUESTION_UPDATED", "QUESTION_DELETED"] } });
    expect(after).toBe(before);
  });
});

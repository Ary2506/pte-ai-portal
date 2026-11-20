import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin, createQuestion } from "./helpers.js";
import Session from "../src/models/Session.js";
import AuditLog from "../src/models/AuditLog.js";
import TestSession from "../src/models/TestSession.js";
import Submission from "../src/models/Submission.js";

// Student Website View: an admin sees the student-facing site as one student sees it, read only,
// without signing in as them.
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(256, 7)]);
const login = async (username) => (await request(app).post("/api/auth/signin").send({ username, password: "password123" })).body.token;
const as = (token) => ({ Authorization: `Bearer ${token}` });

afterEach(() => { delete process.env.STUDENT_VIEW_ADMIN_IDS; });

async function setup() {
  const admin = await createAdmin({ username: "viewadmin" });
  // Student View fails closed: only admins listed here may use it.
  process.env.STUDENT_VIEW_ADMIN_IDS = String(admin._id);
  const student = await createUser({ username: "viewstudent" });
  const adminToken = await login("viewadmin");
  const studentToken = await login("viewstudent");
  const q = await createQuestion({ section: "speaking", type: "read-aloud", title: "RA One", prompt: "Read it.", evaluationType: "subjective" });
  const answer = (await request(app).post("/api/submissions").set(as(studentToken))
    .field("section", "speaking").field("type", "read-aloud").field("questionId", String(q._id)).field("transcript", "Words.")
    .attach("audio", WEBM, { filename: "a.webm", contentType: "audio/webm" })).body.submission;
  const view = await request(app).post(`/api/admin/users/${student._id}/view-session`).set(as(adminToken));
  return { admin, student, adminToken, studentToken, answer, view };
}

describe("opening a student view", () => {
  it("gives an admin a short-lived read-only pass for one student, and logs it", async () => {
    const { student, view } = await setup();
    expect(view.status).toBe(200);
    expect(view.body.student.username).toBe("viewstudent");
    expect(new Date(view.body.expiresAt) - Date.now()).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
    expect(view.body).not.toHaveProperty("student.passwordHash");
    const log = await AuditLog.findOne({ action: "STUDENT_VIEW_STARTED" });
    expect(String(log.targetUser)).toBe(String(student._id));
  });

  it("is refused to students, and for a target that is not a student", async () => {
    const { admin, studentToken, adminToken } = await setup();
    expect((await request(app).post(`/api/admin/users/${admin._id}/view-session`).set(as(studentToken))).status).toBe(403);
    expect((await request(app).post(`/api/admin/users/${admin._id}/view-session`).set(as(adminToken))).status).toBe(404);
  });

  it("honours STUDENT_VIEW_ADMIN_IDS when it is set", async () => {
    const { student, adminToken } = await setup();
    process.env.STUDENT_VIEW_ADMIN_IDS = "000000000000000000000000";
    expect((await request(app).post(`/api/admin/users/${student._id}/view-session`).set(as(adminToken))).status).toBe(403);
  });
});

describe("what the pass can see", () => {
  it("reads every student page's data as that student", async () => {
    const { answer, view } = await setup();
    const v = as(view.body.token);
    expect((await request(app).get("/api/auth/me").set(v)).body.user.username).toBe("viewstudent");
    const history = await request(app).get("/api/submissions/history?summary=1").set(v);
    expect(history.body.submissions.map((s) => s._id)).toContain(answer._id);
    for (const path of ["/api/dashboard", "/api/dashboard/activity", "/api/dashboard/study-plan", "/api/questions?section=speaking&type=read-aloud", "/api/test-sessions", "/api/test-sessions/active"]) {
      expect((await request(app).get(path).set(v)).status, path).toBe(200);
    }
  });

  it("can play the student's own recording", async () => {
    const { answer, view } = await setup();
    const v = as(view.body.token);
    const where = await request(app).get(`/api/submissions/${answer._id}/audio-url`).set(v);
    expect(where.status).toBe(200);
    const audio = await request(app).get(where.body.path || `/api/submissions/${answer._id}/audio`).set(v);
    expect(audio.status).toBe(200);
  });

  it("cannot reach admin pages with it", async () => {
    const { view } = await setup();
    expect((await request(app).get("/api/admin/users").set(as(view.body.token))).status).toBe(403);
  });
});

describe("read only", () => {
  it("refuses every write: submit, share, revoke, retry, profile, mock, sign-out", async () => {
    const { answer, view } = await setup();
    const v = as(view.body.token);
    const attempts = [
      request(app).post("/api/submissions").set(v).field("section", "speaking").field("type", "read-aloud"),
      request(app).post(`/api/submissions/${answer._id}/share`).set(v),
      request(app).delete(`/api/submissions/${answer._id}/share`).set(v),
      request(app).post(`/api/submissions/${answer._id}/retry-evaluation`).set(v),
      request(app).patch("/api/auth/target-score").set(v).send({ targetScore: 79 }),
      request(app).post("/api/test-sessions").set(v),
      request(app).post("/api/auth/logout").set(v)
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("READ_ONLY_VIEW");
    }
    expect(await Submission.countDocuments()).toBe(1);
  });

  it("does not save a mock attempt's expiry when it is only being looked at", async () => {
    const { student, view } = await setup();
    const ts = await TestSession.create({ user: student._id, totalQuestions: 1, questionIds: [], expiresAt: new Date(Date.now() - 60_000) });
    const res = await request(app).get("/api/test-sessions/active").set(as(view.body.token));
    expect(res.body.testSession).toBeNull(); // shown as over, as the student would see it
    expect((await TestSession.findById(ts._id)).status).toBe("IN_PROGRESS"); // but nothing was written
  });
});

describe("the student's own session is untouched", () => {
  it("creates no session for the student, and the student keeps working alongside", async () => {
    const { student, studentToken, view } = await setup();
    const before = await Session.find({ user: student._id }).lean();
    await request(app).get("/api/dashboard").set(as(view.body.token));
    await request(app).get("/api/submissions/history").set(as(view.body.token));
    const after = await Session.find({ user: student._id }).lean();
    expect(after.map((s) => String(s._id))).toEqual(before.map((s) => String(s._id)));
    expect(after.every((s) => !s.revokedAt)).toBe(true);
    // The student is still signed in and can still submit.
    expect((await request(app).get("/api/auth/me").set(as(studentToken))).status).toBe(200);
    expect((await request(app).get("/api/dashboard").set(as(studentToken))).status).toBe(200);
  });

  it("the student submits an answer while being viewed, and the view sees it on its next read", async () => {
    const { student, studentToken, view } = await setup();
    const sessionsBefore = (await Session.find({ user: student._id }).lean()).map((s) => String(s._id));
    const seenBefore = (await request(app).get("/api/submissions/history?summary=1").set(as(view.body.token))).body.total;
    const q = await createQuestion({ section: "reading", type: "mcq-single", title: "MCQ", prompt: "Pick.", options: ["A", "B"], answer: 0, evaluationType: "objective" });
    const res = await request(app).post("/api/submissions").set(as(studentToken))
      .field("section", "reading").field("type", "mcq-single").field("questionId", String(q._id)).field("answer", JSON.stringify(0));
    expect(res.status).toBe(201);
    expect((await request(app).get("/api/submissions/history?summary=1").set(as(view.body.token))).body.total).toBe(seenBefore + 1);
    expect((await Session.find({ user: student._id }).lean()).map((s) => String(s._id))).toEqual(sessionsBefore);
    expect((await request(app).get("/api/auth/me").set(as(studentToken))).status).toBe(200);
  });

  it("ends when the admin signs out", async () => {
    const { adminToken, view } = await setup();
    await request(app).post("/api/auth/logout").set(as(adminToken));
    const res = await request(app).get("/api/auth/me").set(as(view.body.token));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("STUDENT_VIEW_ENDED");
  });
});

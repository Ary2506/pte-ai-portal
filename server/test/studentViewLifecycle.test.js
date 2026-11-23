import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin } from "./helpers.js";
import Session from "../src/models/Session.js";
import AuditLog from "../src/models/AuditLog.js";
import StudentViewSession from "../src/models/StudentViewSession.js";

// Ending a Student View ("Back to Admin Panel" / "Exit student view"): the server revokes that one
// pass at once and records STUDENT_VIEW_ENDED exactly once, leaving everyone else's sign-in and
// every other view alone. Kept apart from studentView.test.js because the sign-in limiter allows
// only so many logins per file.
const login = async (username) => (await request(app).post("/api/auth/signin").send({ username, password: "password123" })).body.token;
const as = (token) => ({ Authorization: `Bearer ${token}` });
const end = (token) => request(app).post("/api/student-view/end").set(as(token));
const openView = async (adminToken, student) =>
  (await request(app).post(`/api/admin/users/${student._id}/view-session`).set(as(adminToken))).body;

afterEach(() => {
  delete process.env.STUDENT_VIEW_ADMIN_IDS;
  vi.useRealTimers();
});

async function setup() {
  const admin = await createAdmin({ username: "lifeadmin" });
  process.env.STUDENT_VIEW_ADMIN_IDS = String(admin._id);
  const student = await createUser({ username: "lifestudent" });
  const adminToken = await login("lifeadmin");
  const studentToken = await login("lifestudent");
  const view = await openView(adminToken, student);
  return { admin, student, adminToken, studentToken, view };
}

describe("ending a student view", () => {
  it("revokes that pass immediately", async () => {
    const { view } = await setup();
    expect((await request(app).get("/api/auth/me").set(as(view.token))).status).toBe(200);

    const res = await end(view.token);
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(true);

    const record = await StudentViewSession.findOne({});
    expect(record.endedAt).toBeInstanceOf(Date);
    expect(record.endReason).toBe("EXITED");
  });

  it("leaves the revoked pass unable to make any further request", async () => {
    const { view } = await setup();
    await end(view.token);
    for (const path of ["/api/auth/me", "/api/dashboard", "/api/submissions/history?summary=1", "/api/test-sessions"]) {
      const res = await request(app).get(path).set(as(view.token));
      expect(res.status, path).toBe(401);
      expect(res.body.code, path).toBe("STUDENT_VIEW_ENDED");
    }
    // Ending it again is refused the same way — and records nothing more.
    const again = await end(view.token);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe("STUDENT_VIEW_ENDED");
  });

  it("keeps the student signed in and their session untouched", async () => {
    const { student, studentToken, view } = await setup();
    const before = await Session.find({ user: student._id }).lean();
    await end(view.token);
    const after = await Session.find({ user: student._id }).lean();
    expect(after).toHaveLength(before.length);
    expect(after.every((s) => !s.revokedAt)).toBe(true);
    const me = await request(app).get("/api/auth/me").set(as(studentToken));
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe("lifestudent");
  });

  it("keeps the admin signed in too", async () => {
    const { adminToken, view } = await setup();
    await end(view.token);
    const me = await request(app).get("/api/auth/me").set(as(adminToken));
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe("lifeadmin");
  });

  it("does not affect another admin's separate view of the same student", async () => {
    const { admin, student, view } = await setup();
    const other = await createAdmin({ username: "lifeadmin2" });
    process.env.STUDENT_VIEW_ADMIN_IDS = `${admin._id},${other._id}`;
    const otherView = await openView(await login("lifeadmin2"), student);
    expect(otherView.token).toBeTruthy();

    await end(view.token);
    expect((await request(app).get("/api/auth/me").set(as(view.token))).status).toBe(401);
    const stillOpen = await request(app).get("/api/auth/me").set(as(otherView.token));
    expect(stillOpen.status).toBe(200);
    expect(stillOpen.body.user.username).toBe("lifestudent");
    expect(await StudentViewSession.countDocuments({ endedAt: null })).toBe(1);
  });

  it("does not affect the same admin's other view in another tab", async () => {
    const { student, adminToken, view } = await setup();
    const secondTab = await openView(adminToken, student);
    await end(view.token);
    expect((await request(app).get("/api/auth/me").set(as(secondTab.token))).status).toBe(200);
  });

  it("records STUDENT_VIEW_ENDED exactly once, with ids and times only", async () => {
    const { admin, student, view } = await setup();
    // Two presses at once and one afterwards: one end, one entry.
    await Promise.all([end(view.token), end(view.token)]);
    await end(view.token);

    const logs = await AuditLog.find({ action: "STUDENT_VIEW_ENDED" }).lean();
    expect(logs).toHaveLength(1);
    const [log] = logs;
    expect(String(log.adminUser)).toBe(String(admin._id));
    expect(String(log.targetUser)).toBe(String(student._id));
    expect(log.metadata.studentId).toBe(String(student._id));
    expect(log.metadata.reason).toBe("EXITED");
    expect(new Date(log.metadata.startedAt).getTime()).toBeLessThanOrEqual(new Date(log.metadata.endedAt).getTime());
    const record = await StudentViewSession.findOne({});
    expect(log.metadata.viewId).toBe(String(record._id));
    // Nothing that could open the view again, or anything else, is kept.
    const stored = JSON.stringify(log);
    expect(stored).not.toContain(view.token);
    expect(stored).not.toMatch(/token|password|passwordHash|adminSession/i);
  });

  it("records no end when the tab is simply closed or navigated away from", async () => {
    const { view } = await setup();
    // A closed tab or a navigation sends nothing; the pass just goes on reading until it expires.
    for (let i = 0; i < 3; i++) await request(app).get("/api/auth/me").set(as(view.token));
    expect(await AuditLog.countDocuments({ action: "STUDENT_VIEW_ENDED" })).toBe(0);
    expect((await StudentViewSession.findOne({})).endedAt).toBeNull();
  });

  it("is only for a view pass: a normal sign-in cannot call it", async () => {
    const { adminToken, studentToken } = await setup();
    for (const token of [adminToken, studentToken]) {
      const res = await end(token);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("NOT_A_STUDENT_VIEW");
    }
    expect((await request(app).post("/api/student-view/end")).status).toBe(401);
    expect(await StudentViewSession.countDocuments({ endedAt: null })).toBe(1);
  });

  it("keeps every other write refused from a view pass", async () => {
    const { view } = await setup();
    for (const attempt of [
      request(app).post("/api/auth/logout").set(as(view.token)),
      request(app).patch("/api/auth/target-score").set(as(view.token)).send({ targetScore: 65 })
    ]) {
      const res = await attempt;
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("READ_ONLY_VIEW");
    }
  });
});

describe("other ways a view ends still work", () => {
  it("ends when the admin signs out, with the student still signed in", async () => {
    const { adminToken, studentToken, view } = await setup();
    await request(app).post("/api/auth/logout").set(as(adminToken));
    const res = await request(app).get("/api/auth/me").set(as(view.token));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("STUDENT_VIEW_ENDED");
    expect((await request(app).get("/api/auth/me").set(as(studentToken))).status).toBe(200);
  });

  it("ends when the pass expires", async () => {
    const { view } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000 + 60_000);
    const res = await request(app).get("/api/auth/me").set(as(view.token));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_INVALID");
    expect((await end(view.token)).status).toBe(401);
  });
});

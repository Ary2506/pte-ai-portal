import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin } from "./helpers.js";

// Who may open Student View: only the admins listed in STUDENT_VIEW_ADMIN_IDS, and nobody at all when
// the setting is missing or malformed (studentViewAccess.js). Kept apart from studentView.test.js so
// each file stays inside the sign-in rate limit (30 per 5 minutes per IP), which these tests do not
// relax.
const login = async (username) => (await request(app).post("/api/auth/signin").send({ username, password: "password123" })).body.token;
const as = (token) => ({ Authorization: `Bearer ${token}` });

afterEach(() => { delete process.env.STUDENT_VIEW_ADMIN_IDS; });

async function setup() {
  const admin = await createAdmin({ username: "viewadmin" });
  process.env.STUDENT_VIEW_ADMIN_IDS = String(admin._id);
  const student = await createUser({ username: "viewstudent" });
  const adminToken = await login("viewadmin");
  const studentToken = await login("viewstudent");
  const view = await request(app).post(`/api/admin/users/${student._id}/view-session`).set(as(adminToken));
  return { admin, student, adminToken, studentToken, view };
}

describe("only the listed admins (fails closed)", () => {
  const open = async (adminToken, student) =>
    request(app).post(`/api/admin/users/${student._id}/view-session`).set(as(adminToken));

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["not an ObjectId", "admin"],
    ["a stray comma", "LISTED,"],
    ["one bad entry beside a good one", "LISTED,not-an-id"],
    ["a 23-character id", "LISTED".slice(0, 0) + "0".repeat(23)]
  ])("STUDENT_VIEW_ADMIN_IDS %s → every admin is refused", async (_label, value) => {
    const { admin, student, adminToken } = await setup();
    if (value === undefined) delete process.env.STUDENT_VIEW_ADMIN_IDS;
    else process.env.STUDENT_VIEW_ADMIN_IDS = value.replace("LISTED", String(admin._id));
    const res = await open(adminToken, student);
    expect(res.status).toBe(403);
    expect((await request(app).get("/api/auth/me").set(as(adminToken))).body.user.canViewStudents).toBe(false);
  });

  it("a second, unlisted admin (like a testing admin) is refused, and is not offered the button", async () => {
    const { student } = await setup();
    await createAdmin({ username: "testingadmin" });
    const other = await login("testingadmin");
    expect((await open(other, student)).status).toBe(403);
    expect((await request(app).get("/api/auth/me").set(as(other))).body.user.canViewStudents).toBe(false);
  });

  it("two listed admins may both use it; the flag tells the client to show View", async () => {
    const { admin, student, adminToken } = await setup();
    const second = await createAdmin({ username: "secondadmin" });
    process.env.STUDENT_VIEW_ADMIN_IDS = ` ${admin._id} , ${second._id} `;
    const secondToken = await login("secondadmin");
    expect((await open(adminToken, student)).status).toBe(200);
    expect((await open(secondToken, student)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set(as(secondToken))).body.user.canViewStudents).toBe(true);
  });

  it("students are never offered it, and cannot start one", async () => {
    const { admin, studentToken } = await setup();
    const me = (await request(app).get("/api/auth/me").set(as(studentToken))).body.user;
    expect(me).not.toHaveProperty("canViewStudents");
    expect((await request(app).post(`/api/admin/users/${admin._id}/view-session`).set(as(studentToken))).status).toBe(403);
  });

  it("taking the admin off the list stops a view that is already open", async () => {
    const { view } = await setup();
    expect((await request(app).get("/api/auth/me").set(as(view.body.token))).status).toBe(200);
    process.env.STUDENT_VIEW_ADMIN_IDS = "000000000000000000000000";
    const res = await request(app).get("/api/auth/me").set(as(view.body.token));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("STUDENT_VIEW_ENDED");
  });

  it("the setting going missing stops an open view too", async () => {
    const { view } = await setup();
    delete process.env.STUDENT_VIEW_ADMIN_IDS;
    expect((await request(app).get("/api/dashboard").set(as(view.body.token))).body.code).toBe("STUDENT_VIEW_ENDED");
  });
});

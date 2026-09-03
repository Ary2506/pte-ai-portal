import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("admin dashboard stats", () => {
  it("computes real counts from the database, not hardcoded numbers", async () => {
    await createAdmin({ username: "statadmin", password: "password123" });
    await createUser({ username: "active_a", password: "password123", accountStatus: "ACTIVE", paymentStatus: "PAID" });
    await createUser({ username: "blocked_a", password: "password123", accountStatus: "BLOCKED" });
    await createUser({
      username: "expired_a",
      password: "password123",
      paymentStatus: "PAID",
      subscriptionStartDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      subscriptionEndDate: new Date(Date.now() - 1000)
    });
    await createUser({
      username: "expiring_a",
      password: "password123",
      paymentStatus: "PAID",
      subscriptionEndDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    });
    await createUser({ username: "pending_a", password: "password123", paymentStatus: "PENDING", subscriptionStartDate: null, subscriptionEndDate: null });

    const token = await login("statadmin");
    const res = await request(app).get("/api/admin/dashboard/stats").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBe(5);
    expect(res.body.accountStatus.blocked).toBe(1);
    expect(res.body.subscription.expired).toBeGreaterThanOrEqual(1);
    expect(res.body.subscription.expiringWithin7Days).toBeGreaterThanOrEqual(1);
    expect(res.body.paymentStatus.pending).toBeGreaterThanOrEqual(1);
  });

  it("blocks a non-admin from reading dashboard stats", async () => {
    await createUser({ username: "plainstat", password: "password123" });
    const token = await login("plainstat");
    const res = await request(app).get("/api/admin/dashboard/stats").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_REQUIRED");
  });
});

describe("admin user list filters and pagination", () => {
  it("filters by payment status and subscription state without loading everything", async () => {
    await createAdmin({ username: "filteradmin", password: "password123" });
    await createUser({ username: "paid1", password: "password123", paymentStatus: "PAID" });
    await createUser({ username: "pending1", password: "password123", paymentStatus: "PENDING", subscriptionStartDate: null, subscriptionEndDate: null });
    const token = await login("filteradmin");

    const paidOnly = await request(app).get("/api/admin/users?paymentStatus=PAID").set("Authorization", `Bearer ${token}`);
    expect(paidOnly.status).toBe(200);
    expect(paidOnly.body.users.every(u => u.paymentStatus === "PAID")).toBe(true);

    const page = await request(app).get("/api/admin/users?page=1&limit=1").set("Authorization", `Bearer ${token}`);
    expect(page.body.users.length).toBe(1);
    expect(page.body.totalPages).toBeGreaterThanOrEqual(2);
  });

  it("reports session status per user", async () => {
    await createAdmin({ username: "sessionadmin", password: "password123" });
    await createUser({ username: "hassession", password: "password123" });
    await login("hassession");
    const adminToken = await login("sessionadmin");

    const res = await request(app).get("/api/admin/users?search=hassession").set("Authorization", `Bearer ${adminToken}`);
    const row = res.body.users.find(u => u.username === "hassession");
    expect(row.sessionStatus).toBe("ACTIVE");
  });
});

describe("audit log", () => {
  it("records admin actions without ever including a password", async () => {
    await createAdmin({ username: "auditadmin", password: "password123" });
    const target = await createUser({ username: "audittarget", password: "password123" });
    const token = await login("auditadmin");

    await request(app).post(`/api/admin/users/${target._id}/renew`).set("Authorization", `Bearer ${token}`).send({ days: 30 });
    await request(app).patch(`/api/admin/users/${target._id}/password`).set("Authorization", `Bearer ${token}`).send({});

    const res = await request(app).get("/api/admin/audit-log?limit=10").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const actions = res.body.logs.map(l => l.action);
    expect(actions).toContain("SUBSCRIPTION_RENEWED");
    expect(actions).toContain("PASSWORD_RESET");
    // The action label legitimately contains "password" (PASSWORD_RESET) — what must never
    // appear is an actual credential inside a log entry's metadata.
    for (const log of res.body.logs) {
      expect(log.metadata.password).toBeUndefined();
      expect(log.metadata.temporaryPassword).toBeUndefined();
      expect(log.metadata.passwordHash).toBeUndefined();
    }
  });
});

describe("malformed request handling", () => {
  it("returns 400 instead of crashing when a route param is not a valid ObjectId", async () => {
    await createAdmin({ username: "castadmin", password: "password123" });
    const token = await login("castadmin");

    const res = await request(app).get("/api/admin/users/not-a-valid-id").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);

    // The server must still be alive and answering after that request.
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });
});

describe("admin self-protection", () => {
  it("prevents an admin from blocking their own account", async () => {
    const admin = await createAdmin({ username: "selfblock", password: "password123" });
    const token = await login("selfblock");
    const res = await request(app)
      .patch(`/api/admin/users/${admin._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ accountStatus: "BLOCKED" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CANNOT_MODIFY_SELF");
  });
});

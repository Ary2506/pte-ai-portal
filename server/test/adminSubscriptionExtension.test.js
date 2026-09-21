import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin } from "./helpers.js";
import { SubscriptionExtension } from "../src/models/SubscriptionExtension.js";
import Session from "../src/models/Session.js";
import { config } from "../src/config.js";

// POST /api/auth/signin has its own strict rate limit (max 10 per 5 minutes) — a real security
// feature, unrelated to this feature, that a file with this many auth'd tests would otherwise
// trip. This mints a session + JWT exactly the way that route does, without going through it —
// legitimate here because none of these tests are testing the signin flow itself, only what
// requireAuth/requireAdmin (which only ever look at the Session + JWT, never how they were
// created) do with an already-authenticated request.
async function tokenFor(user) {
  const session = await Session.create({ user: user._id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  return jwt.sign({ userId: user._id.toString(), sessionId: session._id.toString() }, config.jwtSecret, { expiresIn: "7d" });
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe("admin subscription extension — individual", () => {
  it("lets an admin extend an active subscription by exactly N days", async () => {
    const admin = await createAdmin({ username: "extadmin1" });
    const adminToken = await tokenFor(admin);
    const target = await createUser({ username: "extuser1", subscriptionEndDate: new Date("2026-09-30T00:00:00.000Z") });

    const res = await request(app)
      .post(`/api/admin/subscription-extension/users/${target._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7, reason: "Portal technical issue" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(new Date(res.body.newExpiry).toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(res.body.user.subscriptionEndDate).toBe("2026-10-07T00:00:00.000Z");
    expect(res.body.extensionId).toMatch(/^EXT-\d{4}-\d{3}$/);
  });

  it("blocks a non-admin from extending a subscription", async () => {
    const target = await createUser({ username: "extuser2" });
    const plain = await createUser({ username: "extplain1" });
    const token = await tokenFor(plain);

    const res = await request(app)
      .post(`/api/admin/subscription-extension/users/${target._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ days: 7, reason: "test" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_REQUIRED");
  });

  it("rejects extending a user with no subscription", async () => {
    const admin = await createAdmin({ username: "extadmin2" });
    const adminToken = await tokenFor(admin);
    const target = await createUser({
      username: "extuser3", paymentStatus: "PENDING", subscriptionStartDate: null, subscriptionEndDate: null
    });

    const res = await request(app)
      .post(`/api/admin/subscription-extension/users/${target._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7, reason: "test" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SUBSCRIPTION_NOT_ACTIVE");
    const reloaded = await request(app).get(`/api/admin/users/${target._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(reloaded.body.user.subscriptionEndDate).toBeNull();
  });

  it("rejects extending a user with an expired subscription", async () => {
    const admin = await createAdmin({ username: "extadmin3" });
    const adminToken = await tokenFor(admin);
    const expiredDate = daysFromNow(-5);
    const target = await createUser({ username: "extuser4", subscriptionEndDate: expiredDate });

    const res = await request(app)
      .post(`/api/admin/subscription-extension/users/${target._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7, reason: "test" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SUBSCRIPTION_NOT_ACTIVE");
    const reloaded = await request(app).get(`/api/admin/users/${target._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(new Date(reloaded.body.user.subscriptionEndDate).getTime()).toBe(expiredDate.getTime());
  });

  it("rejects extending a user whose payment is not PAID (inactive/refunded)", async () => {
    const admin = await createAdmin({ username: "extadmin4" });
    const adminToken = await tokenFor(admin);
    const target = await createUser({
      username: "extuser5", paymentStatus: "REFUNDED", subscriptionEndDate: daysFromNow(30)
    });

    const res = await request(app)
      .post(`/api/admin/subscription-extension/users/${target._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7, reason: "test" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SUBSCRIPTION_NOT_ACTIVE");
  });

  it("rejects non-positive or non-integer days", async () => {
    const admin = await createAdmin({ username: "extadmin5" });
    const adminToken = await tokenFor(admin);
    const target = await createUser({ username: "extuser6", subscriptionEndDate: daysFromNow(30) });

    for (const days of [0, -3, 1.5, "abc"]) {
      const res = await request(app)
        .post(`/api/admin/subscription-extension/users/${target._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ days, reason: "test" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects a missing or blank reason", async () => {
    const admin = await createAdmin({ username: "extadmin6" });
    const adminToken = await tokenFor(admin);
    const target = await createUser({ username: "extuser7", subscriptionEndDate: daysFromNow(30) });

    const missing = await request(app)
      .post(`/api/admin/subscription-extension/users/${target._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7 });
    expect(missing.status).toBe(400);

    const blank = await request(app)
      .post(`/api/admin/subscription-extension/users/${target._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7, reason: "   " });
    expect(blank.status).toBe(400);
  });

  it("records a correctly-structured history row for the individual extension", async () => {
    const admin = await createAdmin({ username: "extadmin7" });
    const adminToken = await tokenFor(admin);
    const target = await createUser({ username: "extuser8", subscriptionEndDate: new Date("2026-10-05T00:00:00.000Z") });

    const res = await request(app)
      .post(`/api/admin/subscription-extension/users/${target._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 10, reason: "Portal technical issue" });

    const row = await SubscriptionExtension.findOne({ user: target._id });
    expect(row).toBeTruthy();
    expect(row.type).toBe("INDIVIDUAL");
    expect(row.daysAdded).toBe(10);
    expect(row.reason).toBe("Portal technical issue");
    expect(row.previousExpiry.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(row.newExpiry.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(row.extensionId).toBe(res.body.extensionId);
  });
});

describe("admin subscription extension — bulk", () => {
  it("extends only currently-active subscriptions, leaving expired/no-subscription/inactive-payment users untouched", async () => {
    const admin = await createAdmin({ username: "bulkadmin1" });
    const adminToken = await tokenFor(admin);

    const activeA = await createUser({ username: "bulkactivea", subscriptionEndDate: new Date("2026-09-30T00:00:00.000Z") });
    const activeB = await createUser({ username: "bulkactiveb", subscriptionEndDate: new Date("2026-10-15T00:00:00.000Z") });
    const expiredDate = daysFromNow(-3);
    const expired = await createUser({ username: "bulkexpired", subscriptionEndDate: expiredDate });
    const noSub = await createUser({
      username: "bulknosub", paymentStatus: "PENDING", subscriptionStartDate: null, subscriptionEndDate: null
    });
    const refunded = await createUser({ username: "bulkrefunded", paymentStatus: "REFUNDED", subscriptionEndDate: daysFromNow(30) });

    const res = await request(app)
      .post("/api/admin/subscription-extension/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7, reason: "Portal technical issue", clientRequestId: "test-req-bulk-scope" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.affectedUsers).toBeGreaterThanOrEqual(2); // at least our two active users

    const a = await request(app).get(`/api/admin/users/${activeA._id}`).set("Authorization", `Bearer ${adminToken}`);
    const b = await request(app).get(`/api/admin/users/${activeB._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(a.body.user.subscriptionEndDate).toBe("2026-10-07T00:00:00.000Z");
    expect(b.body.user.subscriptionEndDate).toBe("2026-10-22T00:00:00.000Z");

    const e = await request(app).get(`/api/admin/users/${expired._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(new Date(e.body.user.subscriptionEndDate).getTime()).toBe(expiredDate.getTime());

    const n = await request(app).get(`/api/admin/users/${noSub._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(n.body.user.subscriptionEndDate).toBeNull();

    const r = await request(app).get(`/api/admin/users/${refunded._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(r.body.user.paymentStatus).toBe("REFUNDED");
  });

  it("reports the correct affected-user count from a preview that matches the confirm step", async () => {
    const admin = await createAdmin({ username: "bulkadmin2" });
    const adminToken = await tokenFor(admin);
    await createUser({ username: "bulkpreviewa", subscriptionEndDate: daysFromNow(10) });
    await createUser({ username: "bulkpreviewb", subscriptionEndDate: daysFromNow(20) });
    await createUser({ username: "bulkpreviewexpired", subscriptionEndDate: daysFromNow(-1) });

    const preview = await request(app)
      .post("/api/admin/subscription-extension/bulk/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 5 });
    expect(preview.status).toBe(200);

    const confirm = await request(app)
      .post("/api/admin/subscription-extension/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 5, reason: "test", clientRequestId: "test-req-preview-match" });

    expect(confirm.body.affectedUsers).toBe(preview.body.affectedUsers);
  });

  it("prevents a duplicate bulk extension from applying twice for the same client request id", async () => {
    const admin = await createAdmin({ username: "bulkadmin3" });
    const adminToken = await tokenFor(admin);
    const user = await createUser({ username: "bulkduptest", subscriptionEndDate: new Date("2026-09-30T00:00:00.000Z") });

    const first = await request(app)
      .post("/api/admin/subscription-extension/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7, reason: "Portal technical issue", clientRequestId: "dup-req-1" });
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeFalsy();

    const second = await request(app)
      .post("/api/admin/subscription-extension/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 7, reason: "Portal technical issue", clientRequestId: "dup-req-1" });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.extensionId).toBe(first.body.extensionId);
    expect(second.body.affectedUsers).toBe(first.body.affectedUsers);

    const reloaded = await request(app).get(`/api/admin/users/${user._id}`).set("Authorization", `Bearer ${adminToken}`);
    // Extended exactly once (+7), never twice (+14).
    expect(reloaded.body.user.subscriptionEndDate).toBe("2026-10-07T00:00:00.000Z");

    const rows = await SubscriptionExtension.find({ user: user._id });
    expect(rows.length).toBe(1);
  });

  it("creates one history row per affected user, all sharing the same bulk extensionId", async () => {
    const admin = await createAdmin({ username: "bulkadmin4" });
    const adminToken = await tokenFor(admin);
    const u1 = await createUser({ username: "bulkhist1", subscriptionEndDate: daysFromNow(10) });
    const u2 = await createUser({ username: "bulkhist2", subscriptionEndDate: daysFromNow(20) });

    const res = await request(app)
      .post("/api/admin/subscription-extension/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ days: 3, reason: "Portal technical issue", clientRequestId: "test-req-history" });

    const rows = await SubscriptionExtension.find({ extensionId: res.body.extensionId, type: "BULK" });
    const userIds = rows.map(r => String(r.user));
    expect(userIds).toContain(String(u1._id));
    expect(userIds).toContain(String(u2._id));
    rows.forEach(r => {
      expect(r.daysAdded).toBe(3);
      expect(r.reason).toBe("Portal technical issue");
      expect(r.extensionId).toBe(res.body.extensionId);
    });
  });

  it("blocks a non-admin from calling bulk preview or bulk confirm", async () => {
    const plain = await createUser({ username: "bulkplain1" });
    const token = await tokenFor(plain);

    const preview = await request(app)
      .post("/api/admin/subscription-extension/bulk/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ days: 7 });
    expect(preview.status).toBe(403);

    const confirm = await request(app)
      .post("/api/admin/subscription-extension/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({ days: 7, reason: "test", clientRequestId: "test-req-nonadmin" });
    expect(confirm.status).toBe(403);
  });
});

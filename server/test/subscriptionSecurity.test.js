import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createUser } from "./helpers.js";
import User from "../src/models/User.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("E. a student cannot manipulate their own subscription", () => {
  it("has no route through which a student can change their own subscription dates or payment status", async () => {
    // A normal, already-active student (the realistic case — an inactive one couldn't log in
    // at all, which is a different, already-covered protection).
    const self = await createUser({ username: "cheatstudent5", password: "password123" });
    const originalEnd = self.subscriptionEndDate.getTime();
    const token = await login("cheatstudent5");

    const patchSub = await request(app).patch(`/api/admin/users/${self._id}/subscription`).set("Authorization", `Bearer ${token}`)
      .send({ paymentStatus: "REFUNDED", subscriptionEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() });
    expect(patchSub.status).toBe(403);

    const unchanged = await User.findById(self._id);
    expect(unchanged.paymentStatus).toBe("PAID"); // whatever it was, untouched by the forged request
    expect(unchanged.subscriptionEndDate.getTime()).toBe(originalEnd); // not pushed out to +365 days
  });

  it("cannot renew or extend their own subscription, even while legitimately logged in", async () => {
    const self = await createUser({ username: "cheatstudent6", password: "password123" });
    const originalEnd = self.subscriptionEndDate.getTime();
    const token = await login("cheatstudent6");

    const renewSelf = await request(app).post(`/api/admin/users/${self._id}/renew`).set("Authorization", `Bearer ${token}`).send({ days: 3650 });
    expect(renewSelf.status).toBe(403);

    const unchanged = await User.findById(self._id);
    expect(unchanged.subscriptionEndDate.getTime()).toBe(originalEnd);
  });

  it("cannot forge role, subscription, or payment fields through the one self-facing endpoint it has", async () => {
    await createUser({ username: "forgestudent7", password: "password123" });
    const token = await login("forgestudent7");

    // /api/auth/me is read-only and reflects only server state.
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("student");
    expect(me.body.user.subscriptionStatus).toBe("ACTIVE");
  });
});

describe("F. existing protections remain intact alongside subscription checks", () => {
  it("keeps a blocked account blocked regardless of an otherwise-active subscription", async () => {
    await createUser({ username: "blockedstudent8", password: "password123" });
    const token = await login("blockedstudent8");
    await User.updateOne({ username: "blockedstudent8" }, { accountStatus: "BLOCKED" });

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BLOCKED");
  });

  it("keeps a student out of admin APIs regardless of their own subscription status", async () => {
    await createUser({ username: "plainstudent9", password: "password123" });
    const token = await login("plainstudent9");
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("never applies the student subscription check to an admin, even with no subscription dates at all", async () => {
    await createAdmin({ username: "subadmin10", password: "password123", subscriptionStartDate: null, subscriptionEndDate: null, paymentStatus: "PENDING" });
    const token = await login("subadmin10");
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

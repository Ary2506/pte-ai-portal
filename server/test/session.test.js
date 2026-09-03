import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin } from "./helpers.js";
import User from "../src/models/User.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("active subscription", () => {
  it("allows access to a protected route", async () => {
    await createUser({ username: "active1", password: "password123" });
    const token = await login("active1");
    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("blocks access once the subscription lapses mid-session, with the shared error code", async () => {
    await createUser({
      username: "active2",
      password: "password123",
      subscriptionEndDate: new Date(Date.now() + 2000)
    });
    const token = await login("active2");
    const ok = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);

    await User.updateOne({ username: "active2" }, { subscriptionEndDate: new Date(Date.now() - 1000) });
    const expired = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(expired.status).toBe(403);
    expect(expired.body.code).toBe("SUBSCRIPTION_EXPIRED");
  });
});

describe("session revocation", () => {
  it("lets an admin force-logout a user, and the revoked session is rejected", async () => {
    await createUser({ username: "revokeme", password: "password123" });
    await createAdmin({ username: "admin1", password: "password123" });

    const userToken = await login("revokeme");
    const adminToken = await login("admin1");

    const before = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${userToken}`);
    expect(before.status).toBe(200);

    const target = await User.findOne({ username: "revokeme" });
    const revoke = await request(app)
      .post(`/api/admin/users/${target._id}/revoke-sessions`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.revokedCount).toBeGreaterThan(0);

    const after = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${userToken}`);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("SESSION_REVOKED");
  });
});

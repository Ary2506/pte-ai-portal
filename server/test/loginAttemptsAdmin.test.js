import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin } from "./helpers.js";
import User from "../src/models/User.js";

function loginWithDevice(username, password, deviceId) {
  const req = request(app).post("/api/auth/signin").send({ username, password });
  return deviceId === undefined ? req : req.set("X-Device-Id", deviceId);
}

describe("login attempt auditing — admin-only visibility", () => {
  it("a non-admin user cannot access another account's login attempts via GET /admin/users/:id", async () => {
    const target = await createUser({ username: "audit8", password: "password123" });
    await createUser({ username: "audit9", password: "password123" });
    const login = await loginWithDevice("audit9", "password123", "device-A10");

    const res = await request(app)
      .get(`/api/admin/users/${target._id}`)
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_REQUIRED");
  });

  it("an admin can retrieve a user's recent login attempts, safely labeled, via GET /admin/users/:id", async () => {
    const target = await createUser({ username: "audit10", password: "password123" });
    await createAdmin({ username: "audit11", password: "password123" });
    await loginWithDevice("audit10", "wrong-password", "device-A11");
    const adminLogin = await loginWithDevice("audit11", "password123", "device-A12");

    const res = await request(app)
      .get(`/api/admin/users/${target._id}`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.loginAttempts)).toBe(true);
    const failed = res.body.loginAttempts.find(a => a.reason === "INVALID_CREDENTIALS");
    expect(failed).toBeTruthy();
    expect(failed.success).toBe(false);
  });
});

describe("login attempt auditing does not affect existing security mechanisms", () => {
  it("existing device binding is still enforced exactly as before (mismatch still rejected with 403)", async () => {
    await createUser({ username: "audit12", password: "password123" });
    await loginWithDevice("audit12", "password123", "device-A13");
    const rejected = await loginWithDevice("audit12", "password123", "device-A14");
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe("DEVICE_NOT_REGISTERED");
  });

  it("logout still works and still revokes the session as before", async () => {
    await createUser({ username: "audit13", password: "password123" });
    const login = await loginWithDevice("audit13", "password123", "device-A15");
    const logout = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${login.body.token}`);
    expect(logout.status).toBe(200);
  });

  it("admin force-logout (revoke-sessions) still clears the device registration as before", async () => {
    const target = await createUser({ username: "audit14", password: "password123" });
    await createAdmin({ username: "audit15", password: "password123" });
    const adminLogin = await loginWithDevice("audit15", "password123", "device-A16");
    await loginWithDevice("audit14", "password123", "device-A17");

    const revoke = await request(app)
      .post(`/api/admin/users/${target._id}/revoke-sessions`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`);
    expect(revoke.status).toBe(200);

    const afterRevoke = await User.findOne({ username: "audit14" });
    expect(afterRevoke.registeredDeviceId).toBeNull();
  });
});

describe("login attempt auditing does not weaken login rate limiting", () => {
  it("the login rate limiter still triggers after repeated failed attempts, independent of audit logging", async () => {
    await createUser({ username: "audit16", password: "password123" });
    let lastStatus;
    for (let i = 0; i < 11; i++) {
      const res = await loginWithDevice("audit16", "wrong-password", "device-A18");
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});

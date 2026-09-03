import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser } from "./helpers.js";
import LoginAttempt from "../src/models/LoginAttempt.js";

function loginWithDevice(username, password, deviceId) {
  const req = request(app).post("/api/auth/signin").send({ username, password });
  return deviceId === undefined ? req : req.set("X-Device-Id", deviceId);
}

describe("login attempt auditing — failure scenarios recorded", () => {
  it("a wrong password produces an INVALID_CREDENTIALS audit event tied to the real account", async () => {
    const user = await createUser({ username: "audit1", password: "password123" });
    const res = await loginWithDevice("audit1", "wrong-password", "device-A1");
    expect(res.status).toBe(401);

    const attempts = await LoginAttempt.find({ user: user._id });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(false);
    expect(attempts[0].reason).toBe("INVALID_CREDENTIALS");
  });

  it("a nonexistent username produces an INVALID_CREDENTIALS audit event with no user reference, never revealing whether the username exists", async () => {
    const res = await loginWithDevice("no-such-user-audit", "whatever123", "device-A2");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");

    const attempts = await LoginAttempt.find({ user: null, reason: "INVALID_CREDENTIALS" });
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });

  it("a device mismatch produces a DEVICE_NOT_REGISTERED audit event", async () => {
    const user = await createUser({ username: "audit2", password: "password123" });
    await loginWithDevice("audit2", "password123", "device-A3");
    const rejected = await loginWithDevice("audit2", "password123", "device-A4");
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe("DEVICE_NOT_REGISTERED");

    const attempts = await LoginAttempt.find({ user: user._id, reason: "DEVICE_NOT_REGISTERED" });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(false);
  });

  it("rejection because the account is already active on another device is audited as ACCOUNT_ALREADY_ACTIVE", async () => {
    const user = await createUser({ username: "audit3", password: "password123" });
    await loginWithDevice("audit3", "password123", "device-A5");
    const rejected = await loginWithDevice("audit3", "password123", "device-A5");
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("ACCOUNT_ALREADY_ACTIVE");

    const attempts = await LoginAttempt.find({ user: user._id, reason: "ACCOUNT_ALREADY_ACTIVE" });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(false);
  });

  it("a blocked account's login attempt is audited as ACCOUNT_BLOCKED", async () => {
    const user = await createUser({ username: "audit4", password: "password123", accountStatus: "BLOCKED" });
    const res = await loginWithDevice("audit4", "password123", "device-A6");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BLOCKED");

    const attempts = await LoginAttempt.find({ user: user._id, reason: "ACCOUNT_BLOCKED" });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(false);
  });

  it("a suspended account's login attempt is audited as ACCOUNT_SUSPENDED", async () => {
    const user = await createUser({ username: "audit5", password: "password123", accountStatus: "SUSPENDED" });
    const res = await loginWithDevice("audit5", "password123", "device-A7");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");

    const attempts = await LoginAttempt.find({ user: user._id, reason: "ACCOUNT_SUSPENDED" });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(false);
  });
});

describe("login attempt auditing — success is never misrecorded as a failure", () => {
  it("a successful sign-in records exactly one success:true SUCCESS event and no failure event", async () => {
    const user = await createUser({ username: "audit6", password: "password123" });
    const res = await loginWithDevice("audit6", "password123", "device-A8");
    expect(res.status).toBe(200);

    const attempts = await LoginAttempt.find({ user: user._id });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(true);
    expect(attempts[0].reason).toBe("SUCCESS");
  });
});

describe("login attempt auditing — no sensitive data stored", () => {
  it("audit records never contain a password, password hash, token, or session secret field", async () => {
    await createUser({ username: "audit7", password: "password123" });
    await loginWithDevice("audit7", "wrong-password", "device-A9");

    const attempts = await LoginAttempt.find({}).lean();
    for (const a of attempts) {
      const keys = Object.keys(a);
      expect(keys).not.toContain("password");
      expect(keys).not.toContain("passwordHash");
      expect(keys).not.toContain("token");
      expect(keys).not.toContain("sessionSecret");
      const raw = JSON.stringify(a);
      expect(raw).not.toContain("password123");
    }
  });
});

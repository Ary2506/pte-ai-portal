import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser } from "./helpers.js";
import User from "../src/models/User.js";
import Session from "../src/models/Session.js";

// Kept under ~10 signins per file — see mockSecurity.test.js's own note on the login rate limit.
function loginWithDevice(username, password, deviceId) {
  const req = request(app).post("/api/auth/signin").send({ username, password });
  return deviceId === undefined ? req : req.set("X-Device-Id", deviceId);
}

describe("one-device/one-browser enforcement", () => {
  it("the first login registers the device and succeeds", async () => {
    await createUser({ username: "device1", password: "password123" });
    const res = await loginWithDevice("device1", "password123", "device-A");
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    const user = await User.findOne({ username: "device1" });
    expect(user.registeredDeviceId).toBe("device-A");
  });

  it("a later login from the same registered device is accepted", async () => {
    await createUser({ username: "device2", password: "password123" });
    const first = await loginWithDevice("device2", "password123", "device-B");
    expect(first.status).toBe(200);
    await Session.updateMany({}, { revokedAt: new Date() }); // free the single-session slot so device identity is what's under test

    const second = await loginWithDevice("device2", "password123", "device-B");
    expect(second.status).toBe(200);
  });

  it("rejects a login from a different device/browser once one is already registered, and creates no new session", async () => {
    await createUser({ username: "device3", password: "password123" });
    const first = await loginWithDevice("device3", "password123", "device-C");
    expect(first.status).toBe(200);
    await Session.updateMany({}, { revokedAt: new Date() });

    const sessionsBefore = await Session.countDocuments({});
    const second = await loginWithDevice("device3", "password123", "device-D");
    expect(second.status).toBe(403);
    expect(second.body.code).toBe("DEVICE_NOT_REGISTERED");
    const sessionsAfter = await Session.countDocuments({});
    expect(sessionsAfter).toBe(sessionsBefore);
  });

  it("rejects a login with no device header at all once a device is already registered — a missing header can never satisfy an existing registration", async () => {
    await createUser({ username: "device4", password: "password123" });
    await loginWithDevice("device4", "password123", "device-E");
    await Session.updateMany({}, { revokedAt: new Date() });

    const res = await loginWithDevice("device4", "password123", undefined);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DEVICE_NOT_REGISTERED");
  });
});

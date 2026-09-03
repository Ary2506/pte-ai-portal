import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin } from "./helpers.js";
import User from "../src/models/User.js";

function loginWithDevice(username, password, deviceId) {
  const req = request(app).post("/api/auth/signin").send({ username, password });
  return deviceId === undefined ? req : req.set("X-Device-Id", deviceId);
}

describe("logout does not release the device binding", () => {
  it("logging out and attempting to log back in from a different device is still rejected — logout cannot be used to bypass the restriction", async () => {
    await createUser({ username: "device5", password: "password123" });
    const login = await loginWithDevice("device5", "password123", "device-F");
    const token = login.body.token;

    const logout = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const attemptFromOtherDevice = await loginWithDevice("device5", "password123", "device-G");
    expect(attemptFromOtherDevice.status).toBe(403);
    expect(attemptFromOtherDevice.body.code).toBe("DEVICE_NOT_REGISTERED");
  });
});

describe("admin accounts are exempt from device binding", () => {
  it("an admin can sign in from two genuinely different devices, matching every other per-student-only restriction", async () => {
    await createAdmin({ username: "deviceadmin1", password: "password123" });
    const first = await loginWithDevice("deviceadmin1", "password123", "device-H");
    expect(first.status).toBe(200);

    const second = await loginWithDevice("deviceadmin1", "password123", "device-I");
    expect(second.status).toBe(200);
  });
});

describe("admin force-logout releases the device registration", () => {
  it("force-logout via the admin panel clears registeredDeviceId, letting the student register a new device afterward — the 'contact the administrator' promise made to students", async () => {
    await createAdmin({ username: "deviceadmin2", password: "password123" });
    await createUser({ username: "device6", password: "password123" });
    const adminLogin = await loginWithDevice("deviceadmin2", "password123", "admin-device");
    const adminToken = adminLogin.body.token;
    await loginWithDevice("device6", "password123", "device-J");

    const target = await User.findOne({ username: "device6" });
    const revoke = await request(app).post(`/api/admin/users/${target._id}/revoke-sessions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revoke.status).toBe(200);

    const afterRevoke = await User.findOne({ username: "device6" });
    expect(afterRevoke.registeredDeviceId).toBeNull();

    const loginFromNewDevice = await loginWithDevice("device6", "password123", "device-K");
    expect(loginFromNewDevice.status).toBe(200);
  });
});

describe("admin visibility into device registration", () => {
  it("GET /admin/users/:id reports a deviceRegistered boolean on the user, not the raw registeredDeviceId field", async () => {
    await createAdmin({ username: "deviceadmin3", password: "password123" });
    await createUser({ username: "device7", password: "password123" });
    const adminLogin = await loginWithDevice("deviceadmin3", "password123", "admin-device-2");
    const adminToken = adminLogin.body.token;
    await loginWithDevice("device7", "password123", "device-L");

    const target = await User.findOne({ username: "device7" });
    const res = await request(app).get(`/api/admin/users/${target._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.deviceRegistered).toBe(true);
    // The raw registeredDeviceId value is never on the user object itself — only the derived
    // boolean. (The pre-existing per-session deviceId in `sessions[]` is separate, already
    // admin-only, already-existing visibility — untouched and correctly still present.)
    expect(res.body.user.registeredDeviceId).toBeUndefined();
  });

  it("reports deviceRegistered: false for a student who has never logged in", async () => {
    await createAdmin({ username: "deviceadmin4", password: "password123" });
    const target = await createUser({ username: "device8", password: "password123" });
    const adminLogin = await loginWithDevice("deviceadmin4", "password123", "admin-device-3");
    const adminToken = adminLogin.body.token;

    const res = await request(app).get(`/api/admin/users/${target._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.deviceRegistered).toBe(false);
  });
});

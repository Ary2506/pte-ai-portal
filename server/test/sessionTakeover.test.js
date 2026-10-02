import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const users = new Map();
const sessions = [];

vi.mock("../src/models/User.js", () => ({ default: {
  findOne: vi.fn(async ({ username }) => users.get(username) || null),
  findById: vi.fn(async (id) => [...users.values()].find(u => String(u._id) === String(id)) || null)
}}));
vi.mock("../src/models/LoginAttempt.js", () => ({ default: { create: vi.fn(async () => ({})) } }));
vi.mock("../src/models/Session.js", () => ({ default: {
  create: vi.fn(async (doc) => { const s = { ...doc, _id: `s${sessions.length + 1}`, revokedAt: null }; sessions.push(s); return s; }),
  findOne: vi.fn(async (q) => sessions.find(s => String(s.user) === String(q.user) && s.revokedAt === null) || null),
  updateMany: vi.fn(async (q) => {
    const hit = sessions.filter(s => String(s.user) === String(q.user) && s.revokedAt === null);
    hit.forEach(s => { s.revokedAt = new Date(); });
    return { modifiedCount: hit.length };
  })
}}));

const bcrypt = await import("bcryptjs");
const { app } = await import("../src/app.js");

// A username per test: the per-account login limiter buckets by username, so sharing one
// across tests exhausts its five attempts and the later ones come back 429.
let currentUser = "admin";
async function signin(deviceId) {
  return request(app).post("/api/auth/signin").set("X-Device-Id", deviceId).send({ username: currentUser, password: "pw" });
}
async function newAccount(name, role = "admin") {
  currentUser = name;
  users.set(name, {
    _id: "u-" + name, username: name, role, accountStatus: "ACTIVE",
    passwordHash: await bcrypt.default.hash("pw", 4),
    registeredDeviceId: null, paymentStatus: "PAID", save: vi.fn(async () => {}),
    // A student needs live access, or signin stops at the subscription gate before reaching the
    // session logic these tests are about.
    subscriptionStartDate: new Date(Date.now() - 86400000),
    subscriptionEndDate: new Date(Date.now() + 30 * 86400000)
  });
}

beforeEach(async () => {
  sessions.length = 0;
  users.clear();
  users.set("admin", {
    _id: "u1", username: "admin", role: "admin", accountStatus: "ACTIVE",
    passwordHash: await bcrypt.default.hash("pw", 4),
    registeredDeviceId: null, paymentStatus: "PAID", save: vi.fn(async () => {}),
    // A student needs live access, or signin stops at the subscription gate before reaching the
    // session logic these tests are about.
    subscriptionStartDate: new Date(Date.now() - 86400000),
    subscriptionEndDate: new Date(Date.now() + 30 * 86400000)
  });
});

describe("one account, one live session", () => {
  it("lets the same admin account sign in from a second browser", async () => {
    await newAccount("admin1");
    expect((await signin("chrome")).status).toBe(200);
    const second = await signin("edge");
    console.log("  second browser status:", second.status, second.body.code || "");
    expect(second.status).toBe(200);
  });

  it("revokes the first browser's session when the second signs in", async () => {
    await newAccount("admin2");
    await signin("chrome");
    const first = sessions[0];
    expect(first.revokedAt).toBeNull();
    await signin("edge");
    console.log("  first session revoked:", !!first.revokedAt, "| live sessions:", sessions.filter(s => !s.revokedAt).length);
    expect(first.revokedAt).not.toBeNull();
    expect(sessions.filter(s => !s.revokedAt).length).toBe(1);
  });

  it("allows a different device instead of rejecting it as unregistered", async () => {
    await newAccount("student1", "student");
    await signin("laptop-A");
    const onB = await signin("laptop-B");
    console.log("  device B status:", onB.status, onB.body.code || "");
    expect(onB.status).toBe(200);
    expect(onB.body.code).not.toBe("DEVICE_NOT_REGISTERED");
  });
});

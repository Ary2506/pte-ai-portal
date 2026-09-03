import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createUser } from "./helpers.js";
import User from "../src/models/User.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe("A. new activation grants exactly 30 days, server-derived", () => {
  it("ignores any client-supplied start/expiry dates and grants exactly the requested duration from the server clock", async () => {
    await createAdmin({ username: "subadmin1", password: "password123" });
    const token = await login("subadmin1");

    const before = Date.now();
    const res = await request(app).post("/api/admin/users").set("Authorization", `Bearer ${token}`).send({
      username: "actstudent1", name: "Activation Test", paymentStatus: "PAID", subscriptionDays: 30,
      // forged — POST /users never even reads these fields, so this proves it, not just asserts it
      subscriptionStartDate: "2000-01-01T00:00:00.000Z", subscriptionEndDate: "2099-12-31T00:00:00.000Z"
    });
    const after = Date.now();

    expect(res.status).toBe(201);
    const start = new Date(res.body.user.subscriptionStartDate).getTime();
    const end = new Date(res.body.user.subscriptionEndDate).getTime();
    expect(start).toBeGreaterThanOrEqual(before - 1000);
    expect(start).toBeLessThanOrEqual(after + 1000);
    expect(end - start).toBe(THIRTY_DAYS_MS);
  });
});

describe("B. renewing an active subscription extends from the existing expiry", () => {
  it("adds the renewal days on top of remaining time instead of discarding it", async () => {
    await createAdmin({ username: "subadmin2", password: "password123" });
    const originalEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days still remaining
    const target = await createUser({ username: "activestudent2", password: "password123", subscriptionEndDate: originalEnd });
    const token = await login("subadmin2");

    const res = await request(app).post(`/api/admin/users/${target._id}/renew`).set("Authorization", `Bearer ${token}`).send({ days: 30 });
    expect(res.status).toBe(200);

    const newEnd = new Date(res.body.user.subscriptionEndDate).getTime();
    // 10 days were already banked; +30 more should land exactly 30 days past the ORIGINAL
    // expiry (40 days from now), never 30 days from right now (which would erase the 10).
    expect(newEnd - originalEnd.getTime()).toBe(THIRTY_DAYS_MS);
  });
});

describe("C. renewing an expired subscription starts fresh from now", () => {
  it("grants exactly 30 days from the server's current time, not stacked on the old expiry", async () => {
    await createAdmin({ username: "subadmin3", password: "password123" });
    const target = await createUser({
      username: "expiredstudent3", password: "password123",
      subscriptionStartDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      subscriptionEndDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    });
    const token = await login("subadmin3");

    const before = Date.now();
    const res = await request(app).post(`/api/admin/users/${target._id}/renew`).set("Authorization", `Bearer ${token}`).send({ days: 30 });
    const after = Date.now();

    const newStart = new Date(res.body.user.subscriptionStartDate).getTime();
    const newEnd = new Date(res.body.user.subscriptionEndDate).getTime();
    expect(newStart).toBeGreaterThanOrEqual(before - 1000);
    expect(newStart).toBeLessThanOrEqual(after + 1000);
    expect(newEnd - newStart).toBe(THIRTY_DAYS_MS);
  });
});

describe("D. expiry boundary", () => {
  it("allows access right up to expiry and denies it from the expiry instant onward", async () => {
    await createUser({ username: "boundarystudent4", password: "password123", subscriptionEndDate: new Date(Date.now() + 3000) });
    const token = await login("boundarystudent4");

    const justBefore = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(justBefore.status).toBe(200);

    await User.updateOne({ username: "boundarystudent4" }, { subscriptionEndDate: new Date(Date.now() - 1) });
    const atExpiry = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(atExpiry.status).toBe(403);
    expect(atExpiry.body.code).toBe("SUBSCRIPTION_EXPIRED");
  });
});

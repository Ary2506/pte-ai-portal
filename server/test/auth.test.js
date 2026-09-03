import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser } from "./helpers.js";

describe("public registration", () => {
  it("rejects POST /api/auth/signup", async () => {
    const res = await request(app).post("/api/auth/signup").send({ username: "new1", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PUBLIC_REGISTRATION_DISABLED");
  });

  it("rejects POST /api/auth/register", async () => {
    const res = await request(app).post("/api/auth/register").send({ username: "new2", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PUBLIC_REGISTRATION_DISABLED");
  });

  it("never creates an account via either route", async () => {
    await request(app).post("/api/auth/signup").send({ username: "shouldnotexist", password: "password123", name: "X" });
    const login = await request(app).post("/api/auth/signin").send({ username: "shouldnotexist", password: "password123" });
    expect(login.status).toBe(401);
  });
});

describe("login", () => {
  it("allows a valid user to sign in", async () => {
    await createUser({ username: "student1", password: "password123" });
    const res = await request(app).post("/api/auth/signin").send({ username: "student1", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe("student1");
  });

  it("rejects an invalid password", async () => {
    await createUser({ username: "student2", password: "password123" });
    const res = await request(app).post("/api/auth/signin").send({ username: "student2", password: "wrongpass" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a blocked account", async () => {
    await createUser({ username: "student3", password: "password123", accountStatus: "BLOCKED" });
    const res = await request(app).post("/api/auth/signin").send({ username: "student3", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BLOCKED");
  });

  it("rejects an expired subscription", async () => {
    await createUser({
      username: "student4",
      password: "password123",
      subscriptionStartDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      subscriptionEndDate: new Date(Date.now() - 24 * 60 * 60 * 1000)
    });
    const res = await request(app).post("/api/auth/signin").send({ username: "student4", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SUBSCRIPTION_EXPIRED");
  });

  it("never returns passwordHash on login or /me", async () => {
    await createUser({ username: "student5", password: "password123" });
    const login = await request(app).post("/api/auth/signin").send({ username: "student5", password: "password123" });
    expect(login.body.user.passwordHash).toBeUndefined();

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(me.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a second simultaneous login for the same account", async () => {
    await createUser({ username: "student6", password: "password123" });
    const first = await request(app).post("/api/auth/signin").send({ username: "student6", password: "password123" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/auth/signin").send({ username: "student6", password: "password123" });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ACCOUNT_ALREADY_ACTIVE");
  });
});

describe("removed admin-bootstrap vulnerability", () => {
  it("no longer exposes POST /api/auth/bootstrap-admin", async () => {
    const user = await createUser({ username: "student7", password: "password123" });
    const login = await request(app).post("/api/auth/signin").send({ username: "student7", password: "password123" });
    const res = await request(app)
      .post("/api/auth/bootstrap-admin")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(404);
    expect(user.role).toBe("student");
  });
});

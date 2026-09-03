import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createAdmin } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("admin user management", () => {
  it("lets an admin create a user with a subscription", async () => {
    await createAdmin({ username: "admin2", password: "password123" });
    const adminToken = await login("admin2");

    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "pte001", name: "New Student", paymentStatus: "PAID", subscriptionDays: 30 });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe("pte001");
    expect(res.body.user.subscriptionStatus).toBe("ACTIVE");
    expect(res.body.temporaryPassword).toBeTruthy();
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("blocks a non-admin from creating a user", async () => {
    await createUser({ username: "plain1", password: "password123" });
    const token = await login("plain1");

    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ username: "hacker", name: "Hacker" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_REQUIRED");
  });

  it("blocks a non-admin from listing users or changing anyone's subscription", async () => {
    const target = await createUser({ username: "plain2", password: "password123" });
    const token = await login("plain2");

    const list = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(403);

    const sub = await request(app)
      .patch(`/api/admin/users/${target._id}/subscription`)
      .set("Authorization", `Bearer ${token}`)
      .send({ paymentStatus: "PAID", subscriptionEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) });
    expect(sub.status).toBe(403);
  });

  it("resets a user's password securely, invalidating their old session", async () => {
    const target = await createUser({ username: "resetme", password: "password123" });
    await createAdmin({ username: "admin3", password: "password123" });
    const adminToken = await login("admin3");
    const userToken = await login("resetme");

    const reset = await request(app)
      .patch(`/api/admin/users/${target._id}/password`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toBeTruthy();
    expect(reset.body.user.passwordHash).toBeUndefined();

    const staleCheck = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${userToken}`);
    expect(staleCheck.status).toBe(401);

    const oldPasswordLogin = await request(app)
      .post("/api/auth/signin")
      .send({ username: "resetme", password: "password123" });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post("/api/auth/signin")
      .send({ username: "resetme", password: reset.body.temporaryPassword });
    expect(newPasswordLogin.status).toBe(200);
  });
});

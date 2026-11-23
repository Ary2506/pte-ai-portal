import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("malformed raw JSON request body", () => {
  it("returns a clean 400 (not a 500) when the request body isn't valid JSON at all", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .set("Content-Type", "application/json")
      .send("{not valid json");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["an object (NoSQL-style operator)", { $ne: "" }],
    ["an array", ["password123"]],
    ["a number", 12345678]
  ])("returns a clean 400 (not a 500) when the sign-in password is %s", async (_label, password) => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ username: "malformed-password-check", password });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

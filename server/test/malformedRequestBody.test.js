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
});

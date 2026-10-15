import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

// Found by probing the running API rather than by reading it: several classes of bad REQUEST were
// being reported as 500 Unexpected server error. That is wrong in three ways at once -- it tells
// the client the server broke when the client sent something invalid, it suggests retrying
// something that can never succeed, and it logs a full stack trace for ordinary bad input, which
// buries genuine faults.
async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("a malformed request is answered as a client error", () => {
  it("rejects wrong field types with 400, not 500", async () => {
    await createUser({ username: "errc1", password: "password123" });
    const q = await createQuestion({
      section: "writing", type: "essay", title: "E", prompt: "Write.", evaluationType: "subjective"
    });

    // `type` as an array fails schema casting. Previously this surfaced as 500.
    const res = await request(app).post("/api/submissions")
      .set("Authorization", `Bearer ${await login("errc1")}`)
      .send({ section: 123, type: [], questionId: String(q._id), answer: "x" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("answers an oversized body with 413, not 500", async () => {
    await createUser({ username: "errc2", password: "password123" });

    // Over the 2mb express.json limit. body-parser raises entity.too.large with status 413, which
    // the error middleware used to ignore on its way to a generic 500.
    const res = await request(app).post("/api/submissions")
      .set("Authorization", `Bearer ${await login("errc2")}`)
      .send({ section: "writing", type: "essay", answer: "a".repeat(3 * 1024 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("still answers unparseable JSON with 400", async () => {
    const res = await request(app).post("/api/auth/signin")
      .set("Content-Type", "application/json")
      .send("{not valid json");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("never returns a stack trace or a filesystem path to the client", async () => {
    const res = await request(app).post("/api/auth/signin")
      .set("Content-Type", "application/json")
      .send("{not valid json");

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/node_modules/);
    expect(body).not.toMatch(/at \w+ \(/);
    expect(body).not.toMatch(/[A-Za-z]:\\\\/);
  });
});

describe("security headers are set on every response", () => {
  it("sends the four headers a JSON API needs", async () => {
    const res = await request(app).get("/api/health");

    // Stops a browser sniffing a response as HTML and executing it.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    // Nothing here is ever meant to be framed.
    expect(res.headers["x-frame-options"]).toBe("DENY");
    // Keeps record ids in URLs out of the Referer sent to other sites.
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("does not advertise the server stack", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("omits HSTS on a plain connection, so localhost is never pinned to https", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });

  it("sends HSTS when the proxy reports the request arrived over https", async () => {
    const res = await request(app).get("/api/health").set("X-Forwarded-Proto", "https");
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
  });
});

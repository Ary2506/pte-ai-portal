import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createUser } from "./helpers.js";
import { isRemoteStorage, putObject } from "../src/storage.js";

// GET /media/questions/:kind/:file replaced an express.static mount on server/public/question-media.
// The static mount was the bug: a container's disk does not survive a deploy, so admin-uploaded
// question media vanished at the next release while the question rows went on pointing at it.
//
// Two properties have to survive that swap. The route must keep serving the same URL shape, so
// existing question rows need no migration; and it must not have become an open file reader for
// the server's filesystem now that it builds a key from path parameters.
const VALID_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 1)]);

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

async function uploadImage(username) {
  await createAdmin({ username, password: "password123" });
  const res = await request(app).post("/api/admin/media/upload")
    .set("Authorization", `Bearer ${await login(username)}`)
    .attach("file", VALID_JPEG, { filename: "chart.jpg", contentType: "image/jpeg" });
  expect(res.status).toBe(201);
  return res.body;
}

describe("serving admin-uploaded question media", () => {
  it("serves a file that was just uploaded", async () => {
    const { url } = await uploadImage("qmedia1");

    const res = await request(app).get(url).redirects(0);

    expect([200, 302]).toContain(res.status);
    if (res.status === 302) expect(res.headers.location).toContain("X-Amz-Signature");
  });

  it("needs no token, because a browser cannot send one on an <img> tag", async () => {
    const { url } = await uploadImage("qmedia2");

    // No Authorization header at all. This is the question bank, which every signed-in student
    // sees anyway; requiring a token here would simply break every question image. Student
    // recordings are the private case and are gated in routes/submissions.js instead.
    const res = await request(app).get(url).redirects(0);

    expect([200, 302]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });

  it("is reachable by a signed-in student as well as an admin", async () => {
    const { url } = await uploadImage("qmedia3");
    await createUser({ username: "qmediastudent", password: "password123" });

    const res = await request(app).get(url)
      .set("Authorization", `Bearer ${await login("qmediastudent")}`).redirects(0);

    expect([200, 302]).toContain(res.status);
  });

  it("404s a file that does not exist rather than erroring", async () => {
    const res = await request(app)
      .get("/media/questions/images/00000000-0000-4000-8000-000000000000.jpg").redirects(0);

    if (isRemoteStorage) {
      // A signature is minted without checking the object, so the miss surfaces at R2 itself.
      expect([302, 404]).toContain(res.status);
    } else {
      expect(res.status).toBe(404);
    }
  });

  it("refuses an unknown kind", async () => {
    const res = await request(app).get("/media/questions/secrets/anything.jpg").redirects(0);
    expect(res.status).toBe(404);
  });
});

describe("the route cannot be walked out of its prefix", () => {
  // The old static mount got this from express.static. The key is now assembled from path
  // parameters, so it has to be proven again.
  const TRAVERSALS = [
    "/media/questions/images/..%2f..%2f..%2fpackage.json",
    "/media/questions/images/%2e%2e%2f%2e%2e%2fpackage.json",
    "/media/questions/audio/..%5c..%5cpackage.json",
    "/media/questions/images/.env",
    "/media/questions/..%2faudio/x.webm"
  ];

  for (const target of TRAVERSALS) {
    it(`refuses ${target}`, async () => {
      const res = await request(app).get(target).redirects(0);
      expect([400, 403, 404]).toContain(res.status);
      // Whatever the status, no file content came back.
      expect(String(res.text || "")).not.toContain("\"dependencies\"");
      expect(String(res.text || "")).not.toContain("MONGODB_URI");
    });
  }

  it("will not write a key that resolves outside its storage root", async () => {
    // Guards the storage layer directly rather than the route. Only meaningful for the local
    // driver: an R2 key is a flat string, so "../" in one is an odd name, not a traversal.
    if (isRemoteStorage) return;
    await expect(putObject("question-media/../../package.json", Buffer.from("x"), "text/plain"))
      .rejects.toThrow(/outside its storage root/i);
  });
});

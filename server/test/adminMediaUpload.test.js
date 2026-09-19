import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { app } from "../src/app.js";
import { createAdmin, createUser } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

// Real signature bytes so the magic-byte check passes; enough padding to be a plausible file.
const VALID_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 1)]);
const VALID_WEBM_AUDIO = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
const NOT_MEDIA = Buffer.from("this is definitely not an image or audio file, just plain text");

describe("admin media upload", () => {
  it("rejects an unauthenticated upload", async () => {
    const res = await request(app).post("/api/admin/media/upload")
      .attach("file", VALID_JPEG, { filename: "chart.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin student's upload", async () => {
    await createUser({ username: "mediastudent1", password: "password123" });
    const token = await login("mediastudent1");

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      .attach("file", VALID_JPEG, { filename: "chart.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(403);
  });

  it("accepts a valid image upload and returns a usable, absolute URL", async () => {
    await createAdmin({ username: "mediaadmin1", password: "password123" });
    const token = await login("mediaadmin1");

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      .attach("file", VALID_JPEG, { filename: "chart.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("image");
    expect(res.body.url).toMatch(/^http:\/\/.+\/media\/questions\/images\/[a-f0-9-]+\.jpg$/);
  });

  it("accepts a valid audio upload and returns a usable, absolute URL", async () => {
    await createAdmin({ username: "mediaadmin2", password: "password123" });
    const token = await login("mediaadmin2");

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      .attach("file", VALID_WEBM_AUDIO, { filename: "prompt.webm", contentType: "audio/webm" });

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("audio");
    expect(res.body.url).toMatch(/^http:\/\/.+\/media\/questions\/audio\/[a-f0-9-]+\.webm$/);
  });

  it("rejects an unsupported MIME type", async () => {
    await createAdmin({ username: "mediaadmin3", password: "password123" });
    const token = await login("mediaadmin3");

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      .attach("file", NOT_MEDIA, { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects a file whose declared type doesn't match its actual content (magic-byte check)", async () => {
    await createAdmin({ username: "mediaadmin4", password: "password123" });
    const token = await login("mediaadmin4");

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      // Claims to be a JPEG via Content-Type, but the bytes are plain text.
      .attach("file", NOT_MEDIA, { filename: "fake.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FILE_SIGNATURE");
  });

  it("rejects an oversized image (over the 8MB image limit)", async () => {
    await createAdmin({ username: "mediaadmin5", password: "password123" });
    const token = await login("mediaadmin5");
    const oversizedImage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9 * 1024 * 1024, 1)]);

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      .attach("file", oversizedImage, { filename: "big.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects an oversized audio file (over the multer-level 15MB cap)", async () => {
    await createAdmin({ username: "mediaadmin6", password: "password123" });
    const token = await login("mediaadmin6");
    const oversizedAudio = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16 * 1024 * 1024, 1)]);

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      .attach("file", oversizedAudio, { filename: "big.webm", contentType: "audio/webm" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects a request with no file attached", async () => {
    await createAdmin({ username: "mediaadmin7", password: "password123" });
    const token = await login("mediaadmin7");

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_REQUIRED");
  });

  it("the returned URL is actually accessible through the running server", async () => {
    await createAdmin({ username: "mediaadmin8", password: "password123" });
    const token = await login("mediaadmin8");

    const upload = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      .attach("file", VALID_JPEG, { filename: "chart.jpg", contentType: "image/jpeg" });
    expect(upload.status).toBe(201);

    const relativePath = new URL(upload.body.url).pathname;
    const fetched = await request(app).get(relativePath);
    expect(fetched.status).toBe(200);
    expect(Buffer.compare(fetched.body.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]))).toBe(0);
  });

  it("ignores a malicious original filename entirely — the stored file always lives under the intended media directory with a server-generated name", async () => {
    await createAdmin({ username: "mediaadmin9", password: "password123" });
    const token = await login("mediaadmin9");

    const res = await request(app).post("/api/admin/media/upload").set("Authorization", `Bearer ${token}`)
      .attach("file", VALID_JPEG, { filename: "../../../../etc/passwd.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    // The returned URL/filename never contains the attacker-supplied name or any path segments.
    expect(res.body.filename).not.toContain("..");
    expect(res.body.filename).not.toContain("/");
    expect(res.body.filename).not.toContain("etc");
    expect(res.body.url).toMatch(/^http:\/\/.+\/media\/questions\/images\/[a-f0-9-]+\.jpg$/);

    // And the file was genuinely written inside the intended directory, not escaped from it.
    const mediaRoot = path.resolve("public/question-media/images");
    const onDisk = fs.readdirSync(mediaRoot);
    expect(onDisk).toContain(res.body.filename);
  });

  it("a path-traversal attempt on the static-serve route itself cannot escape the media directory", async () => {
    const res = await request(app).get("/media/questions/images/..%2f..%2f..%2fpackage.json");
    expect([400, 403, 404]).toContain(res.status);
  });
});

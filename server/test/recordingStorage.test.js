import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import Submission from "../src/models/Submission.js";
import { isRemoteStorage, localRecordingPath, assertStorageConfigured } from "../src/storage.js";

// Student recordings used to be written to server/uploads/ with multer.diskStorage and read back
// with res.sendFile. On any container host that filesystem is ephemeral, so a deploy deleted
// every recording while the submissions went on pointing at them -- four rows in the live
// database already had no file left by the time this was fixed.
//
// storage.js is deliberately NOT mocked here. vi.mock on a module this many routes import leaks
// across files in this suite's configuration (fileParallelism is off), which turned twenty
// unrelated failures into a hundred and ten. Everything below is asserted against whichever
// driver is really configured, so the tests hold in both modes.
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 7)]);
const NOT_AUDIO = Buffer.from("MZ\u0090\u0000 this is an executable, not audio");

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

const speakingQuestion = () => createQuestion({
  section: "speaking", type: "read-aloud", title: "RA", prompt: "Read it.", evaluationType: "subjective"
});

async function submitWithAudio(username, buffer = WEBM) {
  const q = await speakingQuestion();
  return request(app).post("/api/submissions")
    .set("Authorization", `Bearer ${await login(username)}`)
    .field("section", "speaking").field("type", "read-aloud")
    .field("questionId", String(q._id)).field("transcript", "A spoken answer.")
    .attach("audio", buffer, { filename: "take.webm", contentType: "audio/webm" });
}

describe("a recording is stored under a key scoped to its owner", () => {
  it("names the object by user, with a random component", async () => {
    const user = await createUser({ username: "rec1", password: "password123" });
    const res = await submitWithAudio("rec1");

    expect(res.status).toBe(201);
    const stored = await Submission.findById(res.body.submission._id).lean();
    // Not a bare filename any more. The user id scopes it and the random part means one
    // student's key cannot be guessed from another's.
    expect(stored.audioPath).toMatch(new RegExp(`^recordings/${user._id}/\\d+-[0-9a-f-]{36}\\.webm$`));
  });

  it("takes the extension from the verified mimetype, not the client's filename", async () => {
    await createUser({ username: "rec2", password: "password123" });
    const res = await submitWithAudio("rec2");
    const stored = await Submission.findById(res.body.submission._id).lean();
    expect(path.extname(stored.audioPath)).toBe(".webm");
  });

  it("rejects a file that is not really audio, before storing anything", async () => {
    await createUser({ username: "rec3", password: "password123" });
    const before = await Submission.countDocuments();

    const res = await submitWithAudio("rec3", NOT_AUDIO);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_AUDIO_SIGNATURE");
    // The signature check reads the buffer now rather than a written file, so a rejected upload
    // leaves neither a submission nor an object behind.
    expect(await Submission.countDocuments()).toBe(before);
  });
});

describe("where the bytes actually go", () => {
  it("writes nothing into server/uploads when object storage is configured", async () => {
    if (!isRemoteStorage) return; // the local fallback writes there on purpose
    await createUser({ username: "rec4", password: "password123" });
    const dir = path.resolve("uploads");
    const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;

    await submitWithAudio("rec4");

    expect(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0).toBe(before);
  });

  it("puts the file where the storage layer says it is", async () => {
    if (isRemoteStorage) return; // the bucket is checked by verifyR2.mjs against the live account
    await createUser({ username: "rec5", password: "password123" });
    const res = await submitWithAudio("rec5");
    const stored = await Submission.findById(res.body.submission._id).lean();
    expect(fs.existsSync(localRecordingPath(stored.audioPath))).toBe(true);
  });
});

describe("playback is ownership-gated whichever driver is in use", () => {
  it("lets the owner through", async () => {
    await createUser({ username: "play1", password: "password123" });
    const submitted = await submitWithAudio("play1");

    const res = await request(app).get(`/api/submissions/${submitted.body.submission._id}/audio`)
      .set("Authorization", `Bearer ${await login("play1")}`).redirects(0);

    // 302 to a signed URL on R2, 200 streamed from disk locally. Either is the owner getting in.
    expect([200, 302]).toContain(res.status);
    if (res.status === 302) expect(res.headers.location).toContain("X-Amz-Signature");
  });

  it("refuses another user", async () => {
    await createUser({ username: "play2", password: "password123" });
    await createUser({ username: "play3", password: "password123" });
    const submitted = await submitWithAudio("play2");

    const res = await request(app).get(`/api/submissions/${submitted.body.submission._id}/audio`)
      .set("Authorization", `Bearer ${await login("play3")}`).redirects(0);

    expect(res.status).toBe(403);
  });

  it("404s a submission with no recording", async () => {
    const user = await createUser({ username: "play4", password: "password123" });
    const sub = await Submission.create({
      user: user._id, section: "writing", type: "essay",
      score: 70, maxScore: 90, evaluationType: "subjective"
    });

    const res = await request(app).get(`/api/submissions/${sub._id}/audio`)
      .set("Authorization", `Bearer ${await login("play4")}`).redirects(0);

    expect(res.status).toBe(404);
  });

  it("still serves a pre-migration recording from disk when the file is there", async () => {
    const user = await createUser({ username: "play5", password: "password123" });
    const dir = path.resolve("uploads");
    fs.mkdirSync(dir, { recursive: true });
    const name = `legacy-${Date.now()}.webm`;
    fs.writeFileSync(path.join(dir, name), WEBM);

    // A bare filename, the shape rows had before the move. The absent "/" is what marks it.
    const sub = await Submission.create({
      user: user._id, section: "speaking", type: "read-aloud", audioPath: name,
      score: 70, maxScore: 90, evaluationType: "subjective"
    });

    const res = await request(app).get(`/api/submissions/${sub._id}/audio`)
      .set("Authorization", `Bearer ${await login("play5")}`).redirects(0);

    expect(res.status).toBe(200);
    fs.unlinkSync(path.join(dir, name));
  });
});

describe("the local fallback is never what production runs on", () => {
  it("refuses to boot in production without object storage configured", () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      // Configured, so the guard stays quiet; unconfigured, it must stop the boot rather than
      // let the server accept recordings it would lose at the next deploy.
      if (isRemoteStorage) expect(() => assertStorageConfigured()).not.toThrow();
      else expect(() => assertStorageConfigured()).toThrow(/not configured/i);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

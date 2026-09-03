import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

// Real signature bytes so the magic-byte check passes; enough padding to be a plausible file.
const VALID_WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
const NOT_AUDIO = Buffer.from("this is definitely not an audio file, just plain text padding data here");

describe("writing evaluation validation", () => {
  it("evaluates a valid essay and returns a real score", async () => {
    await createUser({ username: "write1", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("write1");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay")
      .field("answer", JSON.stringify("Technology has changed how people work and communicate in many ways."))
      .field("transcript", "Technology has changed how people work and communicate in many ways.")
      .field("questionId", q._id.toString());

    expect(res.status).toBe(201);
    expect(res.body.submission.evaluationStatus).toBe("COMPLETED");
    expect(res.body.submission.scoringMethod).toBe("heuristic");
    expect(res.body.submission.score).toBeGreaterThan(0);
  });

  it("rejects an empty writing answer", async () => {
    await createUser({ username: "write2", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("write2");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay").field("answer", JSON.stringify("   ")).field("transcript", "   ")
      .field("questionId", q._id.toString());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMPTY_ANSWER");
  });

  it("rejects an oversized writing answer before it would reach the AI/heuristic evaluator", async () => {
    await createUser({ username: "write3", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("write3");
    const hugeText = "word ".repeat(2000); // well past the 6000-character limit

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay").field("answer", JSON.stringify(hugeText)).field("transcript", hugeText)
      .field("questionId", q._id.toString());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ANSWER_TOO_LONG");
  });

  it("rejects an oversized answer even when a short transcript is sent alongside it", async () => {
    await createUser({ username: "write4", password: "password123" });
    const q = await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    const token = await login("write4");
    const hugeAnswer = "word ".repeat(2000);

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay")
      .field("answer", JSON.stringify(hugeAnswer))
      .field("transcript", "short") // deliberately mismatched — transcript alone must not mask a huge answer
      .field("questionId", q._id.toString());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ANSWER_TOO_LONG");
  });
});

describe("speaking audio validation", () => {
  it("accepts a valid audio upload", async () => {
    await createUser({ username: "speak1", password: "password123" });
    const q = await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    const token = await login("speak1");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "speaking").field("type", "read-aloud").field("transcript", "This is my spoken answer to the prompt.")
      .field("questionId", q._id.toString())
      .attach("audio", VALID_WEBM, { filename: "answer.webm", contentType: "audio/webm" });

    expect(res.status).toBe(201);
    expect(res.body.submission.audioPath).toBeTruthy();
  });

  it("rejects an upload whose declared MIME type is not an allowed audio type", async () => {
    await createUser({ username: "speak2", password: "password123" });
    const q = await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    const token = await login("speak2");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "speaking").field("type", "read-aloud").field("transcript", "answer")
      .field("questionId", q._id.toString())
      .attach("audio", NOT_AUDIO, { filename: "answer.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_AUDIO_TYPE");
  });

  it("rejects a file whose claimed audio MIME type does not match its actual content (magic-byte check)", async () => {
    await createUser({ username: "speak3", password: "password123" });
    const q = await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    const token = await login("speak3");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "speaking").field("type", "read-aloud").field("transcript", "answer")
      .field("questionId", q._id.toString())
      // Claims to be audio/webm via Content-Type, but the bytes are plain text.
      .attach("audio", NOT_AUDIO, { filename: "fake.webm", contentType: "audio/webm" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_AUDIO_SIGNATURE");
  });

  it("rejects an oversized audio upload", async () => {
    await createUser({ username: "speak4", password: "password123" });
    const q = await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    const token = await login("speak4");
    const oversized = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16 * 1024 * 1024, 1)]);

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "speaking").field("type", "read-aloud").field("transcript", "answer")
      .field("questionId", q._id.toString())
      .attach("audio", oversized, { filename: "big.webm", contentType: "audio/webm" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUDIO_TOO_LARGE");
  }, 20000);

  it("rejects access to another user's recording", async () => {
    await createUser({ username: "speak5", password: "password123" });
    await createUser({ username: "speak6", password: "password123" });
    const q = await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    const ownerToken = await login("speak5");
    const attackerToken = await login("speak6");

    const submitRes = await request(app).post("/api/submissions").set("Authorization", `Bearer ${ownerToken}`)
      .field("section", "speaking").field("type", "read-aloud").field("transcript", "answer")
      .field("questionId", q._id.toString())
      .attach("audio", VALID_WEBM, { filename: "answer.webm", contentType: "audio/webm" });
    const submissionId = submitRes.body.submission._id;

    const asOwner = await request(app).get(`/api/submissions/${submissionId}/audio`).set("Authorization", `Bearer ${ownerToken}`);
    expect(asOwner.status).toBe(200);

    const asAttacker = await request(app).get(`/api/submissions/${submissionId}/audio`).set("Authorization", `Bearer ${attackerToken}`);
    expect(asAttacker.status).toBe(403);
  });
});


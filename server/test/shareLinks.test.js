import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import fs from "fs";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import Submission from "../src/models/Submission.js";
import ShareLink, { SHARE_LIFETIME_MS } from "../src/models/ShareLink.js";
import User from "../src/models/User.js";
import { hashShareToken } from "../src/routes/shareLinks.js";
import { localObjectPath, objectExists } from "../src/storage.js";

// Share Answer, end to end through the real routes. Storage is whichever driver is configured —
// the local disk in this suite — and is not mocked (see recordingStorage.test.js for why).
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4096, 7)]);
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => { vi.useRealTimers(); });

async function login(username, password = "password123") {
  return (await request(app).post("/api/auth/signin").send({ username, password })).body.token;
}

async function speakingAnswer(username) {
  const q = await createQuestion({ section: "speaking", type: "read-aloud", title: "Visit to Canada", prompt: "Read it.", evaluationType: "subjective" });
  const token = await login(username);
  const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
    .field("section", "speaking").field("type", "read-aloud").field("questionId", String(q._id))
    .field("transcript", "The best time to visit Canada is during the fall months.")
    .attach("audio", WEBM, { filename: "take.webm", contentType: "audio/webm" });
  expect(res.status).toBe(201);
  return { token, submission: res.body.submission };
}

const share = (token, submissionId) =>
  request(app).post(`/api/submissions/${submissionId}/share`).set("Authorization", `Bearer ${token}`);
const tokenOf = (url) => url.split("/shared-answer/")[1];

describe("creating a share link", () => {
  it("gives the paid owner a 30-day link to an unguessable token, storing only its hash and a separate copy of the audio", async () => {
    await createUser({ username: "sharer1" });
    const { token, submission } = await speakingAnswer("sharer1");
    const before = Date.now();
    const res = await share(token, submission._id);
    expect(res.status).toBe(201);

    const { url, expiresAt, createdAt, summary } = res.body.share;
    // What the copied message describes, and nothing more.
    expect(summary).toEqual({ taskCode: "RA", taskLabel: "Read Aloud", questionTitle: "Visit to Canada", score: submission.score, maxScore: submission.maxScore });
    expect(url).toMatch(/^http:\/\/localhost:5173\/shared-answer\/[A-Za-z0-9_-]{43}$/);
    expect(url).not.toContain(String(submission._id));
    expect(new Date(expiresAt) - new Date(createdAt)).toBe(SHARE_LIFETIME_MS);
    expect(new Date(createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const row = await ShareLink.findOne({});
    expect(row.tokenHash).toBe(hashShareToken(tokenOf(url)));
    expect(JSON.stringify(row)).not.toContain(tokenOf(url));
    expect(row.sharedAudioObjectKey).toBe(`shared-audio/${row._id}/${submission.audioPath.split("/").pop()}`);

    // The copy is real and independent; the original is untouched.
    expect(await objectExists(row.sharedAudioObjectKey)).toBe(true);
    expect(fs.readFileSync(localObjectPath(row.sharedAudioObjectKey))).toEqual(WEBM);
    expect(fs.readFileSync(localObjectPath(submission.audioPath))).toEqual(WEBM);
  });

  it("refuses anyone but the owner", async () => {
    await createUser({ username: "sharer2" });
    await createUser({ username: "other2" });
    const { submission } = await speakingAnswer("sharer2");
    const res = await share(await login("other2"), submission._id);
    expect(res.status).toBe(403);
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it("refuses a student whose subscription has ended", async () => {
    await createUser({ username: "sharer3" });
    const { token, submission } = await speakingAnswer("sharer3");
    await User.updateOne({ username: "sharer3" }, { $set: { subscriptionEndDate: new Date(Date.now() - DAY) } });
    const res = await share(token, submission._id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SUBSCRIPTION_EXPIRED");
  });

  it("refuses an answer that is not a scored speaking answer with a recording", async () => {
    const user = await createUser({ username: "sharer4" });
    const token = await login("sharer4");
    const writing = await Submission.create({ user: user._id, section: "writing", type: "swt", evaluationType: "subjective", evaluationStatus: "COMPLETED" });
    expect((await share(token, writing._id)).body.code).toBe("SHARE_NOT_ALLOWED");
    const pending = await Submission.create({ user: user._id, section: "speaking", type: "read-aloud", evaluationType: "subjective", evaluationStatus: "PENDING", audioPath: "recordings/x/y.webm" });
    expect((await share(token, pending._id)).body.code).toBe("SHARE_NOT_READY");
    const silent = await Submission.create({ user: user._id, section: "speaking", type: "read-aloud", evaluationType: "subjective", evaluationStatus: "COMPLETED" });
    expect((await share(token, silent._id)).body.code).toBe("RECORDING_UNAVAILABLE");
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it("creates no link when the original recording is already gone", async () => {
    await createUser({ username: "sharer5" });
    const { token, submission } = await speakingAnswer("sharer5");
    fs.rmSync(localObjectPath(submission.audioPath));
    const res = await share(token, submission._id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RECORDING_UNAVAILABLE");
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it("without SHARE_LINK_SECRET, sharing again adds a link without breaking the one already sent; Stop sharing withdraws both and deletes their copies", async () => {
    await createUser({ username: "sharer6" });
    const { token, submission } = await speakingAnswer("sharer6");
    const first = tokenOf((await share(token, submission._id)).body.share.url);
    const second = tokenOf((await share(token, submission._id)).body.share.url);
    expect(second).not.toBe(first);
    expect((await request(app).get(`/api/public/shared-answers/${first}`)).status).toBe(200);
    expect((await request(app).get(`/api/public/shared-answers/${second}`)).status).toBe(200);
    const copies = (await ShareLink.find({})).map((l) => l.sharedAudioObjectKey);
    expect(copies).toHaveLength(2);

    const del = await request(app).delete(`/api/submissions/${submission._id}/share`).set("Authorization", `Bearer ${token}`);
    expect(del.body.revoked).toBe(2);
    expect((await request(app).get(`/api/public/shared-answers/${first}`)).body.code).toBe("SHARE_REVOKED");
    expect((await request(app).get(`/api/public/shared-answers/${second}`)).body.code).toBe("SHARE_REVOKED");
    // The shared copies are gone at once; the student's own recording is untouched.
    for (const key of copies) expect(await objectExists(key)).toBe(false);
    expect(await objectExists(submission.audioPath)).toBe(true);
  });
});

describe("one live link per answer (SHARE_LINK_SECRET set)", () => {
  const SECRET = "test-share-link-secret-0123456789abcdefghijklmnop";
  beforeEach(() => { process.env.SHARE_LINK_SECRET = SECRET; });
  afterEach(() => { delete process.env.SHARE_LINK_SECRET; });

  it("sharing again shows the same link with its original expiry, and makes no new link or copy", async () => {
    await createUser({ username: "reuse1" });
    const { token, submission } = await speakingAnswer("reuse1");
    const first = await share(token, submission._id);
    expect(first.status).toBe(201);
    expect(first.body.share.reused).toBe(false);

    vi.useFakeTimers({ now: Date.now() + 3 * DAY, toFake: ["Date"] });
    const again = await share(token, submission._id);
    expect(again.status).toBe(200);
    expect(again.body.share.reused).toBe(true);
    expect(again.body.share.url).toBe(first.body.share.url);
    expect(again.body.share.expiresAt).toBe(first.body.share.expiresAt); // not extended
    expect(again.body.share.summary).toEqual(first.body.share.summary);
    expect(await ShareLink.countDocuments()).toBe(1);

    // Still only the token's hash is stored, never the token.
    const row = await ShareLink.findOne({});
    expect(row.tokenHash).toBe(hashShareToken(tokenOf(first.body.share.url)));
    expect(JSON.stringify(row)).not.toContain(tokenOf(first.body.share.url));
    expect(first.body.share.url).toMatch(/\/shared-answer\/[A-Za-z0-9_-]{43}$/);
  });

  it("shows the link again even after the original recording has expired from storage", async () => {
    await createUser({ username: "reuse2" });
    const { token, submission } = await speakingAnswer("reuse2");
    const url = (await share(token, submission._id)).body.share.url;
    fs.rmSync(localObjectPath(submission.audioPath));
    const again = await share(token, submission._id);
    expect(again.status).toBe(200);
    expect(again.body.share.url).toBe(url);
  });

  it("makes a new link once the old one has expired or been stopped", async () => {
    await createUser({ username: "reuse3" });
    const { token, submission } = await speakingAnswer("reuse3");
    const first = (await share(token, submission._id)).body.share.url;

    // The link's 30 days are over (moving the clock instead would also end the student's session).
    await ShareLink.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const afterExpiry = await share(token, submission._id);
    expect(afterExpiry.status).toBe(201);
    expect(afterExpiry.body.share.url).not.toBe(first);

    await request(app).delete(`/api/submissions/${submission._id}/share`).set("Authorization", `Bearer ${token}`);
    const afterStop = await share(token, submission._id);
    expect(afterStop.status).toBe(201);
    expect(afterStop.body.share.url).not.toBe(afterExpiry.body.share.url);
    expect((await request(app).get(`/api/public/shared-answers/${tokenOf(afterExpiry.body.share.url)}`)).body.code).toBe("SHARE_REVOKED");
  });

  it("after the secret changes, makes a new link rather than show a wrong one; the old link keeps working", async () => {
    await createUser({ username: "reuse4" });
    const { token, submission } = await speakingAnswer("reuse4");
    const old = (await share(token, submission._id)).body.share.url;
    process.env.SHARE_LINK_SECRET = `${SECRET}-rotated`;
    const fresh = await share(token, submission._id);
    expect(fresh.status).toBe(201);
    expect(fresh.body.share.url).not.toBe(old);
    expect((await request(app).get(`/api/public/shared-answers/${tokenOf(old)}`)).status).toBe(200);
  });

  it("a link made before reuse existed (random token) is not shown again; the answer gets one new reusable link", async () => {
    await createUser({ username: "reuse5" });
    const { token, submission } = await speakingAnswer("reuse5");
    delete process.env.SHARE_LINK_SECRET;
    const legacy = (await share(token, submission._id)).body.share.url;
    process.env.SHARE_LINK_SECRET = SECRET;
    const next = (await share(token, submission._id)).body.share.url;
    expect(next).not.toBe(legacy);
    expect((await share(token, submission._id)).body.share.url).toBe(next);
    expect((await request(app).get(`/api/public/shared-answers/${tokenOf(legacy)}`)).status).toBe(200);
  });

  it("limits new links per student per hour, but showing an existing link again is never limited", async () => {
    const user = await createUser({ username: "reuse6" });
    const { token, submission } = await speakingAnswer("reuse6");
    const url = (await share(token, submission._id)).body.share.url;
    const filler = Array.from({ length: 29 }, (_, i) => ({
      owner: user._id, submission: submission._id, tokenHash: hashShareToken(`filler-${i}`.padEnd(43, "x")),
      sharedAudioObjectKey: `shared-audio/filler-${i}/x.webm`, expiresAt: new Date(Date.now() + DAY), status: "REVOKED"
    }));
    await ShareLink.insertMany(filler);
    // 30 links this hour: showing the existing one still works ...
    const again = await share(token, submission._id);
    expect(again.status).toBe(200);
    expect(again.body.share.url).toBe(url);
    // ... but a new one (after Stop sharing) is refused.
    await request(app).delete(`/api/submissions/${submission._id}/share`).set("Authorization", `Bearer ${token}`);
    const refused = await share(token, submission._id);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("RATE_LIMITED");
  });
});

describe("opening a shared answer without signing in", () => {
  async function shared(username) {
    await createUser({ username });
    const { token, submission } = await speakingAnswer(username);
    const url = (await share(token, submission._id)).body.share.url;
    return { ownerToken: token, submission, shareToken: tokenOf(url) };
  }

  it("returns only the whitelisted report, uncached and unindexed", async () => {
    const { shareToken } = await shared("open1");
    const res = await request(app).get(`/api/public/shared-answers/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
    const { report } = res.body;
    expect(Object.keys(report).sort()).toEqual([
      "answeredAt", "criteria", "durationSeconds", "expiresAt", "hasAudio", "improvements", "maxScore", "mistakes",
      "overall", "questionTitle", "score", "strengths", "taskLabel", "taskType", "transcript"
    ]);
    expect(report.questionTitle).toBe("Visit to Canada");
    expect(report.taskLabel).toBe("Read Aloud");
    expect(report.transcript).toBe("The best time to visit Canada is during the fall months.");
    // Nothing that identifies a record, a person or a storage location.
    const body = JSON.stringify(res.body);
    for (const leak of ["_id", "user", "audioPath", "recordings/", "shared-audio/", "tokenHash", "sharedAudioObjectKey", "open1"]) {
      expect(body).not.toContain(leak);
    }
  });

  it("issues a fresh audio URL on every request, plays the copy with seeking, and never copies again", async () => {
    const { shareToken } = await shared("open2");
    const first = await request(app).get(`/api/public/shared-answers/${shareToken}/audio-url`);
    expect(first.status).toBe(200);
    expect(first.body.path).toBe(`/api/public/shared-answers/${shareToken}/audio`);
    expect(JSON.stringify(first.body)).not.toContain("shared-audio/");
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get(`/api/public/shared-answers/${shareToken}/audio-url`)).status).toBe(200);
      const audio = await request(app).get(first.body.path).buffer(true).parse((r, cb) => {
        const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(audio.status).toBe(200);
      expect(audio.body).toEqual(WEBM);
    }
    const ranged = await request(app).get(first.body.path).set("Range", "bytes=0-9");
    expect(ranged.status).toBe(206);
    expect(await ShareLink.countDocuments()).toBe(1);
    const dir = localObjectPath(`shared-audio/${(await ShareLink.findOne())._id}/x`).replace(/[\\/]x$/, "");
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it("keeps playing after the original recording is removed by its own retention", async () => {
    const { submission, shareToken } = await shared("open3");
    fs.rmSync(localObjectPath(submission.audioPath)); // what a 7-day rule on recordings/ would do
    const { body } = await request(app).get(`/api/public/shared-answers/${shareToken}/audio-url`);
    expect((await request(app).get(body.path)).status).toBe(200);
  });

  it("stays open for the full 30 days even if the owner's subscription ends, and closes after", async () => {
    const { shareToken } = await shared("open4");
    const created = (await ShareLink.findOne()).createdAt.getTime();
    await User.updateOne({ username: "open4" }, { $set: { subscriptionEndDate: new Date(Date.now() - DAY) } });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(created + 29 * DAY + 23 * 60 * 60 * 1000); // day 30, one hour before expiry
    expect((await request(app).get(`/api/public/shared-answers/${shareToken}`)).status).toBe(200);
    expect((await request(app).get(`/api/public/shared-answers/${shareToken}/audio-url`)).status).toBe(200);

    vi.setSystemTime(created + SHARE_LIFETIME_MS + 1000);
    for (const path of ["", "/audio-url", "/audio"]) {
      const res = await request(app).get(`/api/public/shared-answers/${shareToken}${path}`);
      expect(res.status).toBe(410);
      expect(res.body.code).toBe("SHARE_EXPIRED");
    }
  });

  it("stops the report and the audio the moment the owner revokes the link", async () => {
    const { ownerToken, submission, shareToken } = await shared("open5");
    const del = await request(app).delete(`/api/submissions/${submission._id}/share`).set("Authorization", `Bearer ${ownerToken}`);
    expect(del.body.revoked).toBe(1);
    for (const path of ["", "/audio-url", "/audio"]) {
      const res = await request(app).get(`/api/public/shared-answers/${shareToken}${path}`);
      expect(res.status).toBe(410);
      expect(res.body.code).toBe("SHARE_REVOKED");
    }
  });

  it("lets only the owner revoke", async () => {
    const { submission, shareToken } = await shared("open6");
    await createUser({ username: "stranger6" });
    const res = await request(app).delete(`/api/submissions/${submission._id}/share`).set("Authorization", `Bearer ${await login("stranger6")}`);
    expect(res.status).toBe(403);
    expect((await request(app).get(`/api/public/shared-answers/${shareToken}`)).status).toBe(200);
  });

  it("answers unknown and malformed tokens with not-found, and grants nothing else", async () => {
    const { shareToken } = await shared("open7");
    for (const bad of ["x".repeat(43), "short", `${shareToken}a`, "../../submissions/history"]) {
      const res = await request(app).get(`/api/public/shared-answers/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(404);
    }
    // The share token is not a session: it opens no other route.
    const history = await request(app).get("/api/submissions/history").set("Authorization", `Bearer ${shareToken}`);
    expect(history.status).toBe(401);
  });
});

describe("practice history lists what can be shared", () => {
  it("marks answers with a recording and a live link, without exposing the storage key", async () => {
    await createUser({ username: "hist1" });
    const { token, submission } = await speakingAnswer("hist1");
    await share(token, submission._id);
    const res = await request(app).get("/api/submissions/history?summary=1").set("Authorization", `Bearer ${token}`);
    const row = res.body.submissions.find((s) => s._id === String(submission._id));
    expect(row.hasAudio).toBe(true);
    expect(new Date(row.share.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(row).not.toHaveProperty("audioPath");
  });
});

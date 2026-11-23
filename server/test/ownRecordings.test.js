import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import mongoose from "mongoose";
import Submission from "../src/models/Submission.js";
import { createUser, createQuestion } from "./helpers.js";

// Read Aloud's "My recordings" list: one question's attempts, and the URL each recording plays
// from. Both must only ever reach the signed-in student's own submissions.
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(256, 7)]);

async function login(username) {
  return (await request(app).post("/api/auth/signin").send({ username, password: "password123" })).body.token;
}
async function answer(token, questionId) {
  const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
    .field("section", "speaking").field("type", "read-aloud").field("questionId", String(questionId))
    .field("transcript", "Spoken words.").attach("audio", WEBM, { filename: "take.webm", contentType: "audio/webm" });
  return res.body.submission;
}
const ra = (title) => createQuestion({ section: "speaking", type: "read-aloud", title, prompt: "Read it.", evaluationType: "subjective" });

describe("one question's own attempts", () => {
  it("returns only this student's attempts at the given question, newest first, with date, score and hasAudio", async () => {
    await createUser({ username: "ra1" });
    await createUser({ username: "ra1other" });
    const [q1, q2] = [await ra("Q1"), await ra("Q2")];
    const mine = await login("ra1");
    const first = await answer(mine, q1._id);
    const second = await answer(mine, q1._id);
    await answer(mine, q2._id);
    await answer(await login("ra1other"), q1._id);

    const res = await request(app).get(`/api/submissions/history?summary=1&type=read-aloud&question=${q1._id}`).set("Authorization", `Bearer ${mine}`);
    expect(res.status).toBe(200);
    expect(res.body.submissions.map((s) => s._id)).toEqual([second._id, first._id]);
    for (const row of res.body.submissions) {
      expect(row.hasAudio).toBe(true);
      expect(row.createdAt).toBeTruthy();
      expect(typeof row.score).toBe("number");
      expect(row).not.toHaveProperty("audioPath");
      expect(row).not.toHaveProperty("user");
    }
  });

  it("rejects a malformed question id", async () => {
    await createUser({ username: "ra2" });
    const res = await request(app).get("/api/submissions/history?summary=1&question=nope").set("Authorization", `Bearer ${await login("ra2")}`);
    expect(res.status).toBe(400);
  });
});

describe("the owner's recording URL", () => {
  it("is given to the owner and refused to anyone else", async () => {
    await createUser({ username: "ra3" });
    await createUser({ username: "ra3other" });
    const owner = await login("ra3");
    const sub = await answer(owner, (await ra("Q3"))._id);

    const ok = await request(app).get(`/api/submissions/${sub._id}/audio-url`).set("Authorization", `Bearer ${owner}`);
    expect(ok.status).toBe(200);
    expect(ok.body.path || ok.body.url).toBeTruthy();
    expect(JSON.stringify(ok.body)).not.toContain("recordings/");
    if (ok.body.path) {
      const audio = await request(app).get(ok.body.path).set("Authorization", `Bearer ${owner}`);
      expect(audio.status).toBe(200);
    }

    const other = await request(app).get(`/api/submissions/${sub._id}/audio-url`).set("Authorization", `Bearer ${await login("ra3other")}`);
    expect(other.status).toBe(403);
    expect((await request(app).get(`/api/submissions/${sub._id}/audio-url`)).status).toBe(401);
  });
});

// Recordings are deleted from storage after the retention period (an R2 lifecycle rule; 7 days by
// default here too). Past it, a recording is not listed as playable and its URL is not handed out.
describe("recording retention", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const age = (id, days) => Submission.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - days * DAY) } }
  );

  it("lists only recordings still kept with withAudio=1, and marks older ones as having no audio", async () => {
    await createUser({ username: "ret1" });
    const token = await login("ret1");
    const q = await ra("Retention");
    const fresh = await answer(token, q._id);
    const old = await answer(token, q._id);
    await age(old._id, 8);

    const kept = await request(app).get(`/api/submissions/history?summary=1&type=read-aloud&withAudio=1`).set("Authorization", `Bearer ${token}`);
    expect(kept.status).toBe(200);
    expect(kept.body.submissions.map((s) => s._id)).toEqual([fresh._id]);
    expect(kept.body.total).toBe(1);
    expect(kept.body.recordingRetentionDays).toBe(7);
    const until = new Date(kept.body.submissions[0].audioAvailableUntil).getTime();
    expect(until - new Date(kept.body.submissions[0].createdAt).getTime()).toBe(7 * DAY);

    const all = await request(app).get(`/api/submissions/history?summary=1&type=read-aloud`).set("Authorization", `Bearer ${token}`);
    const byId = Object.fromEntries(all.body.submissions.map((s) => [s._id, s]));
    expect(byId[fresh._id].hasAudio).toBe(true);
    expect(byId[old._id].hasAudio).toBe(false);
  });

  it("answers 410 RECORDING_EXPIRED for an expired recording's URL and file, and still 403 for someone else's", async () => {
    await createUser({ username: "ret2" });
    await createUser({ username: "ret2other" });
    const token = await login("ret2");
    const sub = await answer(token, (await ra("Retention 2"))._id);
    await age(sub._id, 8);

    for (const path of [`/api/submissions/${sub._id}/audio-url`, `/api/submissions/${sub._id}/audio`]) {
      const res = await request(app).get(path).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(410);
      expect(res.body.code).toBe("RECORDING_EXPIRED");
    }
    const other = await request(app).get(`/api/submissions/${sub._id}/audio-url`).set("Authorization", `Bearer ${await login("ret2other")}`);
    expect(other.status).toBe(403);
  });
});

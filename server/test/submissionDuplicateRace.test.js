import { describe, it, expect } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import Submission from "../src/models/Submission.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

// Deterministic, no HTTP, no timing dependency — proves the unique partial index itself exists
// and rejects a duplicate (testSession, question) pair, independent of the route's own findOne
// pre-check (which these tests deliberately bypass by writing through Mongoose directly).
describe("Submission model — unique partial index (database-level)", () => {
  it("rejects a direct duplicate insert for the same testSession + question", async () => {
    const testSession = new mongoose.Types.ObjectId();
    const question = new mongoose.Types.ObjectId();
    const user = new mongoose.Types.ObjectId();
    const base = { user, question, testSession, section: "reading", type: "mcq-single", evaluationType: "objective", score: 1, maxScore: 1 };

    await Submission.create(base);
    await expect(Submission.create(base)).rejects.toMatchObject({ code: 11000 });

    const count = await Submission.countDocuments({ testSession, question });
    expect(count).toBe(1);
  });

  it("does NOT constrain standalone practice submissions (testSession: null) for the same question", async () => {
    const question = new mongoose.Types.ObjectId();
    const user = new mongoose.Types.ObjectId();
    const base = { user, question, testSession: null, section: "reading", type: "mcq-single", evaluationType: "objective", score: 1, maxScore: 1 };

    await Submission.create(base);
    await Submission.create(base); // must NOT throw — retrying a practice question is legitimate

    const count = await Submission.countDocuments({ testSession: null, question });
    expect(count).toBe(2);
  });

  it("does NOT constrain a freeform submission with no linked question, even under a real testSession", async () => {
    const testSession = new mongoose.Types.ObjectId();
    const user = new mongoose.Types.ObjectId();
    const base = { user, testSession, section: "speaking", type: "read-aloud", evaluationType: "subjective", score: 50, maxScore: 90 };

    await Submission.create(base);
    await Submission.create(base); // no `question` field at all — must NOT throw

    const count = await Submission.countDocuments({ testSession, question: { $exists: false } });
    expect(count).toBe(2);
  });
});

describe("POST /api/submissions — duplicate-submission race, through the real route", () => {
  it("under two concurrent requests for the same testSession+question, exactly one succeeds (201), exactly one is rejected (409 DUPLICATE_SUBMISSION), and exactly one Submission exists afterward", async () => {
    await createUser({ username: "race1", password: "password123" });
    await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("race1");

    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    const sessionId = started.body.testSession._id;
    const readingQ = started.body.questions.find(q => q.section === "reading");

    const submitOnce = () => request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", readingQ.type).field("answer", JSON.stringify(1))
      .field("questionId", readingQ._id).field("testSessionId", sessionId);

    // Fired together so both requests' findOne pre-checks race the same window — but the
    // assertions below hold either way: if the race manifests, the unique index catches the
    // loser; if the requests happen to fully serialize instead, the pre-check catches it. Both
    // paths produce the same externally-observable outcome, so this cannot flake on which
    // mechanism wins — only the outcome is asserted, never which specific request "won".
    const [a, b] = await Promise.all([submitOnce(), submitOnce()]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);
    expect(statuses).not.toContain(500);

    const rejected = a.status === 409 ? a : b;
    expect(rejected.body.code).toBe("DUPLICATE_SUBMISSION");

    const count = await Submission.countDocuments({ testSession: sessionId, question: readingQ._id });
    expect(count).toBe(1);
  });
});

describe("POST /api/submissions — malformed JSON answer", () => {
  it("returns 400 VALIDATION_ERROR for a non-JSON answer value, and creates no Submission", async () => {
    await createUser({ username: "malformedjson1", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("malformedjson1");

    const before = await Submission.countDocuments({});
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single")
      .field("answer", "hello world") // not valid JSON — a real value would be JSON.stringify("...")
      .field("questionId", String(q._id));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    const after = await Submission.countDocuments({});
    expect(after).toBe(before);
  });

  it("still accepts a properly JSON-encoded answer exactly as before", async () => {
    await createUser({ username: "validjson1", password: "password123" });
    const q = await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1 });
    const token = await login("validjson1");

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "mcq-single")
      .field("answer", JSON.stringify(1))
      .field("questionId", String(q._id));

    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(1);
  });
});

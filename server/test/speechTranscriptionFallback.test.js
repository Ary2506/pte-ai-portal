import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Opt in BEFORE anything imports config / the transcription module: both read the environment once.
vi.hoisted(() => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.TRANSCRIPTION_IN_TEST = "1";
});

// The general AI evaluator is mocked so no test reaches the network through it; only the transcription
// call (global fetch) is stubbed per test.
const mockEvaluateSubjective = vi.fn();
vi.mock("../src/services/ai/index.js", () => ({ evaluateSubjective: (...a) => mockEvaluateSubjective(...a) }));

const { default: request } = await import("supertest");
const { app } = await import("../src/app.js");
const { createUser } = await import("./helpers.js");
const { default: Question } = await import("../src/models/Question.js");
const { default: Submission } = await import("../src/models/Submission.js");

const SENTENCE = "The supermarket is situated close to the theater.";
const VALID_WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2048, 1)]);

let fetchMock;
beforeEach(() => {
  mockEvaluateSubjective.mockReset();
  mockEvaluateSubjective.mockResolvedValue({ evaluationStatus: "COMPLETED", scoringMethod: "ai", score: 70, maxScore: 90, strengths: [], improvements: [], overall: "ok", note: null, criteria: null, mistakes: [] });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const whisper = (body, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const heard = (text) => whisper({ text, segments: [{ no_speech_prob: 0.02 }] });
const silence = () => whisper({ text: "Thank you.", segments: [{ no_speech_prob: 0.93 }] }); // Whisper's classic hallucination on silence

async function login(username) {
  return (await request(app).post("/api/auth/signin").send({ username, password: "password123" })).body.token;
}
async function repeatSentence() {
  return Question.create({ section: "speaking", type: "repeat-sentence", title: "RS", prompt: "Listen, then repeat.", transcript: SENTENCE, evaluationType: "subjective", sourceGroup: "repeat-sentence/core/001", active: true });
}
async function shortQuestion() {
  return Question.create({ section: "speaking", type: "answer-short-question", title: "ASQ", prompt: "What do you wear on your feet?", evaluationType: "subjective", active: true });
}
function submit(token, q, { transcript = "", audio = VALID_WEBM, type } = {}) {
  const r = request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
    .field("section", "speaking").field("type", type || q.type).field("transcript", transcript).field("durationSeconds", "30").field("questionId", q._id.toString());
  return audio ? r.attach("audio", audio, { filename: "speaking.webm", contentType: "audio/webm" }) : r;
}

describe("speech transcription fallback — when the browser sent no transcript", () => {
  it("transcribes the recording and scores what was actually said (E: valid speech)", async () => {
    await createUser({ username: "st1", password: "password123" });
    const q = await repeatSentence();
    heard("The supermarket is situated close to the theater.");
    const res = await submit(await login("st1"), q);
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/api\.groq\.com\/openai\/v1\/audio\/transcriptions/);
    const sent = fetchMock.mock.calls[0][1].body;
    expect(sent.get("model")).toBe("whisper-large-v3");
    expect(sent.get("file").name).toBe("recording.webm"); // the extension must match the container
    expect(res.body.submission.evaluationStatus).toBe("COMPLETED");
    expect(res.body.submission.score).toBe(90);
    expect(res.body.submission.transcript).toBe("The supermarket is situated close to the theater.");
  });

  it("works the same for the other speaking tasks, which hand the text to the existing evaluator", async () => {
    await createUser({ username: "st2", password: "password123" });
    const q = await shortQuestion();
    heard("Shoes.");
    const res = await submit(await login("st2"), q);
    expect(res.body.submission.evaluationStatus).toBe("COMPLETED");
    expect(mockEvaluateSubjective).toHaveBeenCalledWith(expect.objectContaining({ text: "Shoes." }));
  });

  it("genuine silence is still scored by the existing rules: Whisper hearing nothing is NOT a failure (A)", async () => {
    await createUser({ username: "st3", password: "password123" });
    const q = await repeatSentence();
    silence();
    const res = await submit(await login("st3"), q);
    expect(res.status).toBe(201);
    expect(res.body.submission.evaluationStatus).toBe("COMPLETED");
    expect(res.body.submission.score).toBe(0);
    expect(res.body.submission.transcript).toBe(""); // the hallucinated "Thank you." was NOT adopted as the answer
    expect(res.body.submission.feedback.improvements[0]).toMatch(/No speech was captured/);
  });

  it("bare punctuation from noise is silence too, not a transcript (found against the live service)", async () => {
    await createUser({ username: "st3b", password: "password123" });
    const q = await repeatSentence();
    whisper({ text: " . ", segments: [{ no_speech_prob: 0.1 }] });
    const res = await submit(await login("st3b"), q);
    expect(res.body.submission.evaluationStatus).toBe("COMPLETED");
    expect(res.body.submission.transcript).toBe("");
    expect(res.body.submission.score).toBe(0);
  });

  it("an unreachable speech service is a FAILED submission with a retry, never a zero score (D)", async () => {
    await createUser({ username: "st4", password: "password123" });
    const q = await repeatSentence();
    whisper({ error: "overloaded" }, 503);
    const res = await submit(await login("st4"), q);
    expect(res.status).toBe(201);
    expect(res.body.submission.evaluationStatus).toBe("FAILED");
    expect(res.body.submission.scoringMethod).toBeNull();
    expect(res.body.submission.feedback.overall).toMatch(/temporarily unavailable/);
    expect(res.body.submission.feedback.overall).toMatch(/not a score/);
    expect(mockEvaluateSubjective).not.toHaveBeenCalled(); // nothing was evaluated
  });

  it("a network failure or timeout is treated the same way", async () => {
    await createUser({ username: "st5", password: "password123" });
    const q = await repeatSentence();
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const res = await submit(await login("st5"), q);
    expect(res.body.submission.evaluationStatus).toBe("FAILED");
    expect(res.body.submission.feedback.overall).toMatch(/temporarily unavailable/);
  });

  it("audio the speech service refuses as unreadable says so and asks for a new recording (B/C)", async () => {
    await createUser({ username: "st6", password: "password123" });
    const q = await repeatSentence();
    whisper({ error: "could not process file" }, 400);
    const res = await submit(await login("st6"), q);
    expect(res.body.submission.evaluationStatus).toBe("FAILED");
    expect(res.body.submission.feedback.overall).toMatch(/could not be read/);
    expect(res.body.submission.feedback.overall).toMatch(/record your answer again/i);
  });

  it("retrying a failed answer transcribes the STORED recording again and scores it", async () => {
    await createUser({ username: "st7", password: "password123" });
    const q = await repeatSentence();
    const token = await login("st7");
    whisper({ error: "overloaded" }, 503);
    const first = await submit(token, q);
    expect(first.body.submission.evaluationStatus).toBe("FAILED");

    heard("the supermarket is situated close to the theater");
    const retry = await request(app).post(`/api/submissions/${first.body.submission._id}/retry-evaluation`).set("Authorization", `Bearer ${token}`);
    expect(retry.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retry.body.submission.evaluationStatus).toBe("COMPLETED");
    expect(retry.body.submission.score).toBe(90); // Repeat Sentence's own scorer, not the general AI
    expect(retry.body.submission.transcript).toBe("the supermarket is situated close to the theater");
    expect(mockEvaluateSubjective).not.toHaveBeenCalled();
    const stored = await Submission.findById(first.body.submission._id);
    expect(stored.evaluationStatus).toBe("COMPLETED");
  });

  it("a retry that fails again stays FAILED instead of falling back to a zero", async () => {
    await createUser({ username: "st8", password: "password123" });
    const q = await repeatSentence();
    const token = await login("st8");
    whisper({}, 503);
    const first = await submit(token, q);
    whisper({}, 503);
    const retry = await request(app).post(`/api/submissions/${first.body.submission._id}/retry-evaluation`).set("Authorization", `Bearer ${token}`);
    expect(retry.status).toBe(200);
    expect(retry.body.submission.evaluationStatus).toBe("FAILED");
  });
});

describe("speech transcription fallback — nothing changes when it should not", () => {
  it("does not call the speech service when the browser supplied a transcript", async () => {
    await createUser({ username: "st9", password: "password123" });
    const q = await repeatSentence();
    const res = await submit(await login("st9"), q, { transcript: "the supermarket is situated close to the theater" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.body.submission.score).toBe(90);
  });

  it("does not call it when there is no recording to transcribe", async () => {
    await createUser({ username: "st10", password: "password123" });
    const q = await repeatSentence();
    const res = await submit(await login("st10"), q, { audio: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
  });

  it("does not touch non-speaking sections", async () => {
    await createUser({ username: "st11", password: "password123" });
    const essay = await Question.create({ section: "writing", type: "essay", title: "E", prompt: "Discuss.", evaluationType: "subjective", active: true });
    const token = await login("st11");
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "essay").field("answer", JSON.stringify("Technology has changed how people work.")).field("transcript", "Technology has changed how people work.").field("questionId", essay._id.toString());
    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

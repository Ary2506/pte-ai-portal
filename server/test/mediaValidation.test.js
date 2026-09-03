import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser } from "./helpers.js";
import Question from "../src/models/Question.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}
async function adminToken() {
  await createUser({ username: "medadmin1", password: "password123", role: "admin" });
  return login("medadmin1");
}

// Phase 18: closes a real, confirmed gap — describe-image and repeat-sentence questions could
// previously be created and activated with no image/audio at all (validation/questionValidation.js
// only checked media for dictation/prompt-audio shapes).
describe("media-required validation (Phase 18)", () => {
  it("rejects creating a describe-image question with no image", async () => {
    const token = await adminToken();
    const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "speaking", type: "describe-image", title: "No image", prompt: "Describe the scene.", difficulty: "medium"
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/image is required/i);
  });

  it("accepts a describe-image question once a real imageUrl is provided", async () => {
    const token = await adminToken();
    const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "speaking", type: "describe-image", title: "Has image", prompt: "Describe the scene.",
      imageUrl: "https://example.com/original-chart.png", difficulty: "medium"
    });
    expect(res.status).toBe(201);
    expect(res.body.question.imageUrl).toBe("https://example.com/original-chart.png");
  });

  it("rejects creating a repeat-sentence question with no audio", async () => {
    const token = await adminToken();
    const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "speaking", type: "repeat-sentence", title: "No audio", prompt: "Repeat the sentence.", difficulty: "medium"
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/audio clip is required/i);
  });

  it("accepts a repeat-sentence question once a real audioUrl is provided", async () => {
    const token = await adminToken();
    const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "speaking", type: "repeat-sentence", title: "Has audio", prompt: "Repeat the sentence.",
      audioUrl: "https://example.com/original-clip.mp3", difficulty: "medium"
    });
    expect(res.status).toBe(201);
    expect(res.body.question.audioUrl).toBe("https://example.com/original-clip.mp3");
  });

  it("does not require audio for other prompt-only speaking/writing types (read-aloud, answer-short-question, essay)", async () => {
    const token = await adminToken();
    for (const [section, type] of [["speaking", "read-aloud"], ["speaking", "answer-short-question"], ["writing", "essay"]]) {
      const res = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
        section, type, title: `No media needed (${type})`, prompt: "A prompt with no media requirement.", difficulty: "easy"
      });
      expect(res.status).toBe(201);
    }
  });

  it("still requires an audio URL for dictation and summarize-spoken-text (unchanged existing behavior)", async () => {
    const token = await adminToken();
    const dictation = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "listening", type: "write-dictation", title: "No audio dictation", prompt: "Type what you hear.", answer: "A sentence.", difficulty: "medium"
    });
    expect(dictation.status).toBe(400);

    const sst = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "listening", type: "summarize-spoken-text", title: "No audio SST", prompt: "Summarize what you hear.", difficulty: "medium"
    });
    expect(sst.status).toBe(400);
  });

  it("PUT itself refuses to strip the image from an existing describe-image question — validation applies consistently, not only at activation", async () => {
    const token = await adminToken();
    const create = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "speaking", type: "describe-image", title: "Has image", prompt: "Describe the scene.",
      imageUrl: "https://example.com/chart.png", difficulty: "medium"
    });
    const id = create.body.question._id;

    const strip = await request(app).put(`/api/admin/questions/${id}`).set("Authorization", `Bearer ${token}`).send({
      section: "speaking", type: "describe-image", title: "Has image", prompt: "Describe the scene.", imageUrl: "", difficulty: "medium"
    });
    expect(strip.status).toBe(400);

    const still = await Question.findById(id);
    expect(still.imageUrl).toBe("https://example.com/chart.png"); // unchanged — the failed PUT never saved
  });

  it("rejects a listening mcq-single/mcq-multiple question with no audio, but does not require audio for the same types in reading", async () => {
    const token = await adminToken();

    const listeningNoAudio = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "listening", type: "mcq-single", title: "No audio listening MCQ", prompt: "What is the main idea?",
      options: ["A", "B", "C"], answer: 0, difficulty: "medium"
    });
    expect(listeningNoAudio.status).toBe(400);
    expect(listeningNoAudio.body.message).toMatch(/audio clip is required/i);

    const listeningMultiNoAudio = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "listening", type: "mcq-multiple", title: "No audio listening MCQ multi", prompt: "Which are mentioned?",
      options: ["A", "B", "C"], answer: [0, 1], difficulty: "medium"
    });
    expect(listeningMultiNoAudio.status).toBe(400);

    const listeningWithAudio = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "listening", type: "mcq-single", title: "Has audio listening MCQ", prompt: "What is the main idea?",
      options: ["A", "B", "C"], answer: 0, audioUrl: "https://example.com/clip.mp3", difficulty: "medium"
    });
    expect(listeningWithAudio.status).toBe(201);

    const readingNoAudio = await request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send({
      section: "reading", type: "mcq-single", title: "Reading MCQ needs no audio", prompt: "What does the passage say?",
      options: ["A", "B", "C"], answer: 0, difficulty: "medium"
    });
    expect(readingNoAudio.status).toBe(201);
  });

  it("the activation guard blocks a legacy/pre-existing describe-image document with no image (written directly, bypassing the validated API)", async () => {
    const token = await adminToken();
    // Simulates data that predates this validation rule (or was written outside the admin API) —
    // exactly the shape the real, already-inactive legacy describe-image question could have.
    const legacy = await Question.create({
      section: "speaking", type: "describe-image", title: "Legacy, no image", prompt: "Describe the scene.",
      difficulty: "medium", evaluationType: "subjective", maxScore: 90, active: false
    });

    const reactivate = await request(app).patch(`/api/admin/questions/${legacy._id}/status`).set("Authorization", `Bearer ${token}`).send({ active: true });
    expect(reactivate.status).toBe(400);
    expect(reactivate.body.message).toMatch(/image is required/i);
  });
});

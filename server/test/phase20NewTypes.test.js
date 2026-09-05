import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

// The signin route is rate-limited to 10 attempts per 5 minutes per IP (routes/auth.js), and that
// limiter's in-memory store persists across every test in this file's run — so login() calls are
// kept deliberately scarce here: admin-route validation is checked through one shared admin
// login, and every scoring test creates its question directly via the createQuestion() helper
// (bypassing HTTP and its login) rather than going through the admin API.
async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}
async function freshAdmin() {
  const username = `p20a${Date.now()}${Math.floor(Math.random() * 100000)}`;
  await createUser({ username, password: "password123", role: "admin" });
  return login(username, "password123");
}
async function freshStudent() {
  const username = `p20s${Date.now()}${Math.floor(Math.random() * 100000)}`;
  await createUser({ username, password: "password123", role: "student" });
  return login(username, "password123");
}

describe("Phase 20 — admin creation & media validation for every new type (one shared admin login)", () => {
  it("enforces each new type's required fields through the real admin route", async () => {
    const token = await freshAdmin();
    const create = payload => request(app).post("/api/admin/questions").set("Authorization", `Bearer ${token}`).send(payload);

    // Respond to a Situation — audio required (shape: prompt-audio).
    expect((await create({ section: "speaking", type: "respond-to-situation", title: "No audio", prompt: "Respond.", difficulty: "medium" })).status).toBe(400);
    const situationCreated = await create({ section: "speaking", type: "respond-to-situation", title: "Has audio", prompt: "Respond.", audioUrl: "https://example.com/situation.mp3", difficulty: "medium" });
    expect(situationCreated.status).toBe(201);
    expect(situationCreated.body.question.evaluationType).toBe("subjective");

    // Write Email — text-only, no special field required beyond title/prompt.
    const emailCreated = await create({ section: "writing", type: "write-email", title: "Email prompt", prompt: "Write an email requesting leave.", difficulty: "medium" });
    expect(emailCreated.status).toBe(201);
    expect(emailCreated.body.question.evaluationType).toBe("subjective");

    // Select Missing Word — audio required, same rule as any other listening choice question.
    expect((await create({ section: "listening", type: "select-missing-word", title: "No audio", prompt: "Select.", options: ["quickly", "slowly", "never"], answer: 0, difficulty: "medium" })).status).toBe(400);
    const smwCreated = await create({ section: "listening", type: "select-missing-word", title: "Has audio", prompt: "Select.", options: ["quickly", "slowly", "never"], answer: 0, audioUrl: "https://example.com/missing-word.mp3", difficulty: "medium" });
    expect(smwCreated.status).toBe(201);

    // Highlight Incorrect Words — audio required; options are the transcript's individual words.
    expect((await create({ section: "listening", type: "highlight-incorrect-words", title: "No audio", prompt: "Click the wrong words.", options: ["The", "cat", "sta", "on", "the", "mat"], answer: [2], difficulty: "medium" })).status).toBe(400);
    const hiwCreated = await create({ section: "listening", type: "highlight-incorrect-words", title: "Has audio", prompt: "Click the wrong words.", options: ["The", "cat", "sta", "on", "the", "mat"], answer: [2], audioUrl: "https://example.com/highlight.mp3", difficulty: "medium" });
    expect(hiwCreated.status).toBe(201);

    // Fill in the Blanks (Drag and Drop) — blank count must match answer length, indices must be valid.
    expect((await create({ section: "reading", type: "fill-blanks-dragdrop", title: "Mismatch", prompt: "Drag.", passage: "The ____ sat on the ____.", options: ["cat", "mat", "dog"], answer: [0], difficulty: "medium" })).status).toBe(400);
    expect((await create({ section: "reading", type: "fill-blanks-dragdrop", title: "Bad index", prompt: "Drag.", passage: "The ____ sat on the ____.", options: ["cat", "mat", "dog"], answer: [0, 9], difficulty: "medium" })).status).toBe(400);
    expect((await create({ section: "reading", type: "fill-blanks-dragdrop", title: "No blanks", prompt: "Drag.", passage: "The cat sat on the mat.", options: ["cat", "mat", "dog"], answer: [], difficulty: "medium" })).status).toBe(400);
    const dragCreated = await create({ section: "reading", type: "fill-blanks-dragdrop", title: "Two blanks with a decoy", prompt: "Drag.", passage: "The ____ sat on the ____.", options: ["cat", "mat", "dog"], answer: [0, 1], difficulty: "medium" });
    expect(dragCreated.status).toBe(201);
    expect(dragCreated.body.question.maxScore).toBe(2);
  });
});

describe("Phase 20 — submission/scoring for each new type (question created directly, one student login per test)", () => {
  it("Respond to a Situation is evaluated through the existing subjective pipeline", async () => {
    const q = await createQuestion({ section: "speaking", type: "respond-to-situation", prompt: "Respond appropriately.", evaluationType: "subjective" });
    const token = await freshStudent();
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "speaking").field("type", "respond-to-situation").field("transcript", "I would apologize and offer a solution.")
      .field("questionId", q._id.toString());
    expect(res.status).toBe(201);
    expect(res.body.submission.evaluationType).toBe("subjective");
    expect(["COMPLETED", "FAILED"]).toContain(res.body.submission.evaluationStatus);
  });

  it("Write Email is evaluated through the existing subjective (writing) pipeline", async () => {
    const q = await createQuestion({ section: "writing", type: "write-email", prompt: "Write an email requesting leave.", evaluationType: "subjective" });
    const token = await freshStudent();
    const text = "Dear Manager, I am writing to request leave next week. Regards, Student";
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "write-email").field("answer", JSON.stringify(text)).field("transcript", text)
      .field("questionId", q._id.toString());
    expect(res.status).toBe(201);
    expect(res.body.submission.evaluationType).toBe("subjective");
  });

  it("Select Missing Word scores exactly like mcq-single (full credit for the correct index)", async () => {
    const q = await createQuestion({ section: "listening", type: "select-missing-word", options: ["quickly", "slowly", "never"], answer: 0, evaluationType: "objective" });
    const token = await freshStudent();
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "select-missing-word").field("answer", "0").field("questionId", q._id.toString());
    expect(res.status).toBe(201);
    expect(res.body.submission.feedback.correct).toBe(true);
    expect(res.body.submission.score).toBe(res.body.submission.maxScore);
  });

  it("Highlight Incorrect Words gives partial credit exactly like mcq-multiple", async () => {
    const q = await createQuestion({
      section: "listening", type: "highlight-incorrect-words",
      options: ["The", "cat", "sta", "on", "the", "mot"], answer: [2, 5], evaluationType: "objective"
    });
    const token = await freshStudent();
    // Flags one real wrong word (index 2) and misses the other — partial credit, not all-or-nothing.
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "highlight-incorrect-words")
      .field("answer", JSON.stringify([2])).field("questionId", q._id.toString());
    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(1);
    expect(res.body.submission.maxScore).toBe(2);
    expect(res.body.submission.feedback.correct).toBe(false);
  });

  it("Fill in the Blanks (Drag and Drop) scores per-blank partial credit and rejects a malformed submission", async () => {
    const q = await createQuestion({
      section: "reading", type: "fill-blanks-dragdrop", passage: "The ____ sat on the ____.",
      options: ["cat", "mat", "dog"], answer: [0, 1], evaluationType: "objective", maxScore: 2
    });
    const token = await freshStudent();

    const malformed = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "fill-blanks-dragdrop").field("answer", JSON.stringify([0])).field("questionId", q._id.toString());
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("INVALID_ANSWER_FORMAT");

    const partial = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", "fill-blanks-dragdrop").field("answer", JSON.stringify([0, 2])).field("questionId", q._id.toString());
    expect(partial.status).toBe(201);
    expect(partial.body.submission.score).toBe(1);
    expect(partial.body.submission.maxScore).toBe(2);
    expect(partial.body.submission.feedback.correct).toBe(false);
  });
});

describe("Phase 20 — answer-key protection holds for every new type (one student login)", () => {
  it("never leaks answer/explanation to a student fetching any of the 5 new types", async () => {
    await createQuestion({ section: "speaking", type: "respond-to-situation", prompt: "Respond.", evaluationType: "subjective", audioUrl: "https://example.com/a.mp3" });
    await createQuestion({ section: "writing", type: "write-email", prompt: "Write an email.", evaluationType: "subjective" });
    await createQuestion({ section: "listening", type: "select-missing-word", options: ["a", "b"], answer: 0, evaluationType: "objective", audioUrl: "https://example.com/b.mp3" });
    await createQuestion({ section: "listening", type: "highlight-incorrect-words", options: ["a", "b", "c"], answer: [1], evaluationType: "objective", audioUrl: "https://example.com/c.mp3" });
    await createQuestion({ section: "reading", type: "fill-blanks-dragdrop", passage: "A ____ B.", options: ["x", "y"], answer: [0], evaluationType: "objective" });

    const token = await freshStudent();
    for (const [section, type] of [
      ["speaking", "respond-to-situation"], ["writing", "write-email"],
      ["listening", "select-missing-word"], ["listening", "highlight-incorrect-words"], ["reading", "fill-blanks-dragdrop"]
    ]) {
      const res = await request(app).get(`/api/questions?section=${section}&type=${type}`).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      for (const q of res.body.questions) {
        expect(q).not.toHaveProperty("answer");
        expect(q).not.toHaveProperty("explanation");
      }
    }
  });
});

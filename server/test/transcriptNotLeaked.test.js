import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";

// For most listening tasks the transcript IS the answer key. Sent with the question it hands the
// student the answer, and it is readable straight out of the network tab whatever the UI does.
//
// Write From Dictation is the plainest case - the transcript is literally the sentence to type -
// but Fill in the Blanks contains every blanked word, Highlight Incorrect Words shows which words
// differ, and Select Missing Word ends on the missing word.

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

const SECRET = "The bus to London will leave ten minutes later than planned.";

describe("a transcript that is the answer never reaches the browser", () => {
  const leaky = [
    ["write-dictation", { answer: SECRET, maxScore: 11 }],
    ["fill-blanks-typed", { passage: "The bus leaves ____ minutes late.", answer: ["ten"], content: [{ type: "text", value: "x" }] }],
    ["highlight-incorrect-words", { options: ["The", "bus", "leaves"], answer: [1] }],
    ["select-missing-word", { options: ["ten", "nine"], answer: 0 }],
    ["mcq-single", { options: ["ten", "nine"], answer: 0 }],
  ];

  it.each(leaky)("strips it from a listening %s question", async (type, extra) => {
    const u = "leak-" + type.replace(/[^a-z]/g, "");
    await createUser({ username: u, password: "password123" });
    await createQuestion({
      section: "listening", type, title: type, prompt: "Listen.",
      audioUrl: "https://example.com/a.mp3", transcript: SECRET,
      evaluationType: "objective", ...extra
    });

    const res = await request(app).get(`/api/questions?section=listening&type=${type}`)
      .set("Authorization", `Bearer ${await login(u)}`);
    expect(res.status).toBe(200);
    const q = res.body.questions.find(x => x.type === type);
    expect(q).toBeTruthy();
    expect(q.transcript).toBeUndefined();
    // Belt and braces: the sentence must not appear anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain("ten minutes later than planned");
  });

  it("keeps the transcript for Summarize Spoken Text, where it is a study aid", async () => {
    await createUser({ username: "leaksst", password: "password123" });
    await createQuestion({
      section: "listening", type: "summarize-spoken-text", title: "SST",
      prompt: "Summarise.", audioUrl: "https://example.com/b.mp3",
      transcript: "A passage about urban transport planning.",
      evaluationType: "subjective"
    });

    const res = await request(app).get("/api/questions?section=listening&type=summarize-spoken-text")
      .set("Authorization", `Bearer ${await login("leaksst")}`);
    const q = res.body.questions.find(x => x.type === "summarize-spoken-text");
    // You summarise that audio rather than transcribe it, so the transcript gives nothing away.
    expect(q.transcript).toBe("A passage about urban transport planning.");
  });
});

describe("Write From Dictation is marked against what the audio says", () => {
  it("scores a student who typed the transcript as fully correct", async () => {
    await createUser({ username: "wfdscore", password: "password123" });
    const token = await login("wfdscore");
    const q = await createQuestion({
      section: "listening", type: "write-dictation", title: "WFD",
      prompt: "Write the sentence.", audioUrl: "https://example.com/c.mp3",
      transcript: SECRET, answer: SECRET, evaluationType: "objective", maxScore: 11
    });

    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "write-dictation")
      .field("answer", JSON.stringify(SECRET)).field("questionId", String(q._id));

    expect(res.status).toBe(201);
    expect(res.body.submission.score).toBe(res.body.submission.maxScore);
  });
});

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser } from "./helpers.js";
import Question from "../src/models/Question.js";

const bank = JSON.parse(fs.readFileSync(path.resolve("src/data/repeatSentenceBank.json"), "utf8"));
const byGroup = Object.fromEntries(bank.map(e => [e.sourceGroup, e]));

describe("repeat sentence bank file", () => {
  it("holds 59 Core-P and 125 Normal Core questions, 184 in all", () => {
    expect(bank.filter(e => e.set === "core-p")).toHaveLength(59);
    expect(bank.filter(e => e.set === "core")).toHaveLength(125);
    expect(bank).toHaveLength(184);
  });

  it("keeps the two sets apart: separate sourceGroups, separate audio folders, no shared clip", () => {
    for (const e of bank) {
      const folder = e.set === "core-p" ? "/audio/repeat-sentence/core-p/" : "/audio/repeat-sentence/core/";
      expect(e.audioUrl.startsWith(folder)).toBe(true);
      expect(e.sourceGroup.startsWith(e.set === "core-p" ? "repeat-sentence/core-p/" : "repeat-sentence/core/")).toBe(true);
    }
    expect(new Set(bank.map(e => e.audioUrl)).size).toBe(184);
    expect(new Set(bank.map(e => e.sourceGroup)).size).toBe(184);
  });

  it("every clip is actually on disk", () => {
    for (const e of bank) expect(fs.existsSync(path.resolve("../client/public", "." + e.audioUrl)), e.audioUrl).toBe(true);
  });

  it("has exactly one pending question — Core-P 54 — with no transcript chosen for it", () => {
    const pending = bank.filter(e => !e.transcript);
    expect(pending.map(e => e.sourceGroup)).toEqual(["repeat-sentence/core-p/054"]);
    expect(pending[0].transcriptVerificationStatus).toBe("pending");
    expect(pending[0].audioUrl).toBe("/audio/repeat-sentence/core-p/core-p-054.mp3");
  });

  it("applies the five reviewed decisions", () => {
    expect(byGroup["repeat-sentence/core-p/008"].transcript).toMatch(/depart ten minutes/);
    expect(byGroup["repeat-sentence/core-p/028"].transcript).toMatch(/leave ten minutes/);
    expect(byGroup["repeat-sentence/core/111"].transcript).toMatch(/Jenny Brice\.$/);
    expect(byGroup["repeat-sentence/core/116"].transcript).toBe("All the assignments should be submitted by the end of this week.");
    expect(byGroup["repeat-sentence/core/116"].transcript).not.toMatch(/handed in/);
  });

  it("no transcript contains a digit (spoken numbers are stored as words)", () => {
    for (const e of bank) if (e.transcript) expect(e.transcript, e.sourceGroup).not.toMatch(/\d/);
  });
});

async function login(username) {
  const res = await request(app).post("/api/auth/signin").send({ username, password: "password123" });
  return res.body.token;
}

async function seedRepeatSentence() {
  return Question.create({
    section: "speaking", type: "repeat-sentence", title: "Repeat Sentence Core 1", prompt: "Listen to the sentence, then repeat it exactly as you hear it.",
    audioUrl: "/audio/repeat-sentence/core/core-001.mp3", transcript: "The supermarket is situated close to the theater.",
    evaluationType: "subjective", sourceGroup: "repeat-sentence/core/001", active: true
  });
}

describe("the expected sentence never reaches a student before they answer", () => {
  it("GET /api/questions omits transcript (and answer) for repeat-sentence but still sends the audio", async () => {
    await createUser({ username: "rs1", password: "password123" });
    await seedRepeatSentence();
    const token = await login("rs1");
    const res = await request(app).get("/api/questions?section=speaking&type=repeat-sentence").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].audioUrl).toBe("/audio/repeat-sentence/core/core-001.mp3");
    expect(res.body.questions[0].transcript).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/situated close to the theater/);
  });

  it("a mock test omits it too", async () => {
    await createUser({ username: "rs2", password: "password123" });
    await seedRepeatSentence();
    const token = await login("rs2");
    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body.questions.some(q => q.type === "repeat-sentence")).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/situated close to the theater/);
  });

  it("the stored question still keeps its transcript for scoring", async () => {
    const q = await seedRepeatSentence();
    expect((await Question.findById(q._id)).transcript).toBe("The supermarket is situated close to the theater.");
  });
});

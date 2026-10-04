import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createUser, createQuestion } from "./helpers.js";
import { config } from "../src/config.js";

// How a mock test is built. It used to be one question per section — four in total — and this
// covers the move to a full-length sitting of config.mockQuestionsPerSection per section.
//
// Two things matter beyond the count. Selection has to be type-BALANCED, because the real banks
// are lopsided (reading is 147 fib-dropdown and 104 drag-fill out of 344; writing is 16 essays
// out of 23), so a flat random sample would hand a student twenty of whatever a section holds
// most of. And it has to actually vary between attempts, which is the part that is easy to
// believe is working when it is not.

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

/** `count` reading questions spread over two types, so balance is observable. */
async function seedReading({ dropdowns, reorders }) {
  for (let i = 0; i < dropdowns; i++) {
    await createQuestion({
      section: "reading", type: "mcq-single", title: `Dropdown ${i}`,
      options: ["A", "B"], answer: 1, evaluationType: "objective"
    });
  }
  for (let i = 0; i < reorders; i++) {
    await createQuestion({
      section: "reading", type: "mcq-multiple", title: `Multi ${i}`,
      options: ["A", "B", "C"], answer: [0, 2], evaluationType: "objective"
    });
  }
}

async function startMock(token) {
  const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
  return res.body;
}

describe("mock test composition — how many, and from where", () => {
  it("takes up to the configured quota from each section", async () => {
    await createUser({ username: "comp1", password: "password123" });
    const per = config.mockQuestionsPerSection;
    for (let i = 0; i < per + 5; i++) {
      await createQuestion({ section: "speaking", type: "read-aloud", title: `RA ${i}`, evaluationType: "subjective" });
    }
    await seedReading({ dropdowns: per + 5, reorders: 0 });

    const body = await startMock(await login("comp1"));
    const bySection = {};
    for (const q of body.questions) bySection[q.section] = (bySection[q.section] || 0) + 1;

    expect(bySection.speaking).toBe(per);
    expect(bySection.reading).toBe(per);
    // Sections with no bank simply do not contribute — a mock is still built from what exists.
    expect(bySection.writing).toBeUndefined();
    expect(body.testSession.totalQuestions).toBe(body.questions.length);
  });

  it("takes everything a section has when its bank is smaller than the quota, with no repeats", async () => {
    await createUser({ username: "comp2", password: "password123" });
    await seedReading({ dropdowns: 3, reorders: 0 });

    const body = await startMock(await login("comp2"));
    const ids = body.questions.map(q => q._id);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3); // a short bank must not be padded by reusing a question
  });

  it("spreads across task types instead of draining the biggest one first", async () => {
    await createUser({ username: "comp3", password: "password123" });
    const per = config.mockQuestionsPerSection;
    // A deliberately lopsided bank: plenty of one type, a handful of the other. A flat random
    // sample would return mostly the first type; balanced selection must take all of the scarce
    // one before doubling up on the plentiful one.
    await seedReading({ dropdowns: per * 3, reorders: 4 });

    const body = await startMock(await login("comp3"));
    const reading = body.questions.filter(q => q.section === "reading");
    const multi = reading.filter(q => q.type === "mcq-multiple");
    expect(reading.length).toBe(per);
    expect(multi.length).toBe(4);
  });

  it("keeps the sections in exam order — a student is not made to switch skill every question", async () => {
    await createUser({ username: "comp4", password: "password123" });
    await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" });
    await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" });
    await seedReading({ dropdowns: 1, reorders: 0 });
    await createQuestion({ section: "listening", type: "write-dictation", answer: "a b c", evaluationType: "objective", maxScore: 3 });

    const body = await startMock(await login("comp4"));
    expect(body.questions.map(q => q.section)).toEqual(["speaking", "writing", "reading", "listening"]);
  });

  it("never leaks an answer key into the question list", async () => {
    await createUser({ username: "comp5", password: "password123" });
    await seedReading({ dropdowns: 5, reorders: 0 });

    const body = await startMock(await login("comp5"));
    for (const question of body.questions) {
      expect(question.answer).toBeUndefined();
      expect(question.explanation).toBeUndefined();
    }
  });
});

describe("mock test composition — it actually varies between attempts", () => {
  it("does not serve the same questions, in the same order, every time", async () => {
    await createUser({ username: "shuffle1", password: "password123" });
    const token = await login("shuffle1");
    // A bank several times the quota, so two attempts drawing the same set would be a real signal
    // rather than a coincidence.
    await seedReading({ dropdowns: config.mockQuestionsPerSection * 4, reorders: 0 });

    const attempts = [];
    for (let i = 0; i < 4; i++) {
      const body = await startMock(token);
      attempts.push(body.questions.map(q => q._id).join(","));
    }
    expect(new Set(attempts).size).toBeGreaterThan(1);
  });

  it("varies the order even when the bank is exactly the quota, so every attempt holds the same set", async () => {
    await createUser({ username: "shuffle2", password: "password123" });
    const token = await login("shuffle2");
    await seedReading({ dropdowns: config.mockQuestionsPerSection, reorders: 0 });

    const orders = [];
    for (let i = 0; i < 5; i++) {
      const body = await startMock(token);
      const ids = body.questions.map(q => q._id);
      // Same set every time — there is nothing else to draw from.
      expect(ids.length).toBe(config.mockQuestionsPerSection);
      orders.push(ids.join(","));
    }
    // ...but not the same sequence. With 20 questions the odds of five identical shuffles are
    // nil, so a failure here means the order is not being randomised at all.
    expect(new Set(orders).size).toBeGreaterThan(1);
  });
});

describe("mock test duration", () => {
  it("scales the clock with the number of questions rather than using one flat total", async () => {
    await createUser({ username: "dur1", password: "password123" });
    await seedReading({ dropdowns: 6, reorders: 0 });

    const body = await startMock(await login("dur1"));
    const session = body.testSession;
    const span = new Date(session.expiresAt).getTime() - new Date(session.startedAt).getTime();
    const expected = Math.round(body.questions.length * config.mockMinutesPerQuestion) * 60 * 1000;
    expect(span).toBe(expected);
  });
});

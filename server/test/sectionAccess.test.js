import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createUser, createQuestion } from "./helpers.js";
import User from "../src/models/User.js";
import SectionPurchase from "../src/models/SectionPurchase.js";
import TestSession from "../src/models/TestSession.js";
import {
  sectionStatus, grantSections, effectiveSectionAccess, getSubscriptionStatus, isFullAccess
} from "../src/utils/subscription.js";
import { migrateSectionAccess } from "../src/migrateSectionAccess.js";

const DAY = 24 * 60 * 60 * 1000;
const fromNow = (days) => new Date(Date.now() + days * DAY);

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

// A student holding exactly these sections. Saved through the model so the pre-save hook derives
// the account window from them, the way every real write does.
async function studentWith(username, entries) {
  const user = await createUser({ username });
  user.sectionAccess = entries;
  await user.save();
  return user;
}

const active = (section, days = 30) => ({ section, startDate: fromNow(-1), endDate: fromNow(days) });
const lapsed = (section) => ({ section, startDate: fromNow(-40), endDate: fromNow(-10) });

async function seedOnePerSection() {
  return {
    speaking: await createQuestion({ section: "speaking", type: "read-aloud", evaluationType: "subjective" }),
    writing: await createQuestion({ section: "writing", type: "essay", evaluationType: "subjective" }),
    reading: await createQuestion({ section: "reading", type: "mcq-single", options: ["A", "B"], answer: 1, evaluationType: "objective" }),
    listening: await createQuestion({ section: "listening", type: "write-dictation", answer: "hello world today", evaluationType: "objective", maxScore: 3 })
  };
}

describe("section windows — each section expires on its own date", () => {
  it("runs the worked example: Speaking + Writing on Nov 1 for 30 days, Reading on Nov 8 for 60", () => {
    const nov1 = new Date("2026-11-01T10:00:00Z");
    const nov8 = new Date("2026-11-08T10:00:00Z");
    const user = { role: "student", paymentStatus: "PENDING" };

    grantSections(user, ["speaking", "writing"], 30, nov1);
    grantSections(user, ["reading"], 60, nov8);

    const dec1 = new Date(nov1.getTime() + 30 * DAY);
    const jan7 = new Date(nov8.getTime() + 60 * DAY);
    const justBefore = (d) => d.getTime() - 60 * 1000;
    const justAfter = (d) => d.getTime() + 60 * 1000;

    expect(sectionStatus(user, "speaking", justBefore(dec1))).toBe("ACTIVE");
    expect(sectionStatus(user, "speaking", justAfter(dec1))).toBe("EXPIRED");
    expect(sectionStatus(user, "writing", justAfter(dec1))).toBe("EXPIRED");
    expect(sectionStatus(user, "reading", justAfter(dec1))).toBe("ACTIVE"); // still has its own window
    expect(sectionStatus(user, "reading", justAfter(jan7))).toBe("EXPIRED");
    expect(sectionStatus(user, "listening", justAfter(nov1))).toBe("NOT_PURCHASED");
    // The account window is the latest-ending section, so the student can still sign in on Dec 2.
    expect(user.subscriptionEndDate.getTime()).toBe(jan7.getTime());
    expect(user.paymentStatus).toBe("PAID");
  });

  it("extends a still-active section from its own end, so no paid days are lost", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const user = { role: "student", paymentStatus: "PAID", sectionAccess: [
      { section: "reading", startDate: new Date("2026-11-01T00:00:00Z"), endDate: new Date("2026-11-20T00:00:00Z") }
    ] };
    const [change] = grantSections(user, ["reading"], 30, now);
    expect(change.endDate.toISOString()).toBe("2026-12-20T00:00:00.000Z"); // Nov 20 + 30, not Nov 10 + 30
    expect(user.sectionAccess[0].startDate.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("restarts a lapsed or cancelled section from today", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const user = { role: "student", paymentStatus: "PAID", sectionAccess: [
      { section: "reading", startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-10-01T00:00:00Z"), cancelledAt: new Date("2026-10-01T00:00:00Z") }
    ] };
    grantSections(user, ["reading"], 30, now);
    expect(user.sectionAccess[0].startDate.toISOString()).toBe(now.toISOString());
    expect(user.sectionAccess[0].endDate.toISOString()).toBe("2026-12-10T00:00:00.000Z");
    expect(user.sectionAccess[0].cancelledAt).toBeNull();
  });

  it("reads an account with no section data as holding all four sections on its window", async () => {
    const legacy = await createUser({ username: "legacy_sa1" });
    expect(legacy.sectionAccess).toBeUndefined();
    expect(effectiveSectionAccess(legacy)).toHaveLength(4);
    expect(isFullAccess(legacy)).toBe(true);
  });

  it("gives an unpaid account no sections whatever dates it carries", async () => {
    const refunded = await createUser({ username: "refunded_sa1", paymentStatus: "REFUNDED" });
    expect(sectionStatus(refunded, "reading")).toBe("NOT_PURCHASED");
  });
});

describe("questions — only sections the student holds", () => {
  it("refuses a section never bought, with SECTION_LOCKED", async () => {
    await seedOnePerSection();
    await studentWith("listenonly_q1", [active("listening")]);
    const token = await login("listenonly_q1");

    const res = await request(app).get("/api/questions?section=reading").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SECTION_LOCKED");

    const ok = await request(app).get("/api/questions?section=listening").set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.questions).toHaveLength(1);
  });

  it("refuses a lapsed section with SECTION_EXPIRED, while another section keeps the account usable", async () => {
    await seedOnePerSection();
    await studentWith("mixed_q2", [lapsed("reading"), active("listening")]);
    const token = await login("mixed_q2");
    expect(token).toBeTruthy(); // one active section is enough to sign in

    const res = await request(app).get("/api/questions?section=reading").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SECTION_EXPIRED");
  });

  it("also guards the counts-only index the practice hub reads", async () => {
    await seedOnePerSection();
    await studentWith("listenonly_q3", [active("listening")]);
    const token = await login("listenonly_q3");
    const res = await request(app).get("/api/questions?section=speaking&index=1").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns only held sections when no section is asked for", async () => {
    await seedOnePerSection();
    await studentWith("listenonly_q4", [active("listening")]);
    const token = await login("listenonly_q4");
    const res = await request(app).get("/api/questions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.map(q => q.section)).toEqual(["listening"]);
  });

  it("cannot be widened by repeating the section parameter", async () => {
    await seedOnePerSection();
    await studentWith("listenonly_q5", [active("listening")]);
    const token = await login("listenonly_q5");
    const res = await request(app).get("/api/questions?section=reading&section=listening").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.every(q => q.section === "listening")).toBe(true);
  });

  it("still gives a full-access student and an admin everything, exactly as before", async () => {
    await seedOnePerSection();
    await createUser({ username: "fullaccess_q6" });
    await createAdmin({ username: "admin_q6" });
    for (const name of ["fullaccess_q6", "admin_q6"]) {
      const token = await login(name);
      const res = await request(app).get("/api/questions").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(new Set(res.body.questions.map(q => q.section)).size).toBe(4);
    }
  });

  it("locks the Repeat Sentence transcript with its section", async () => {
    const q = await createQuestion({ section: "speaking", type: "repeat-sentence", evaluationType: "subjective", transcript: "Say this back." });
    await studentWith("listenonly_q7", [active("listening")]);
    const token = await login("listenonly_q7");
    const res = await request(app).get(`/api/questions/${q._id}/transcript`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SECTION_LOCKED");
  });

  it("is not a reason to sign the student out — the session keeps working", async () => {
    await seedOnePerSection();
    await studentWith("listenonly_q8", [active("listening")]);
    const token = await login("listenonly_q8");
    await request(app).get("/api/questions?section=reading").set("Authorization", `Bearer ${token}`);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    const byName = Object.fromEntries(me.body.user.sections.map(s => [s.section, s.status]));
    expect(byName).toEqual({ speaking: "NOT_PURCHASED", writing: "NOT_PURCHASED", reading: "NOT_PURCHASED", listening: "ACTIVE" });
  });
});

describe("submissions — answering needs the section", () => {
  it("rejects an answer to a question in a section not held, judged by the question, not the request", async () => {
    const { reading } = await seedOnePerSection();
    await studentWith("listenonly_s1", [active("listening")]);
    const token = await login("listenonly_s1");
    // Claims "listening", but the question it answers is a reading question.
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "mcq-single").field("answer", JSON.stringify(1))
      .field("questionId", String(reading._id));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SECTION_LOCKED");
  });

  it("rejects an answer to question-less content by the request's section", async () => {
    await studentWith("listenonly_s2", [active("listening")]);
    const token = await login("listenonly_s2");
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "writing").field("type", "swt").field("answer", JSON.stringify("Some summary text."));
    expect(res.status).toBe(403);
  });

  it("accepts an answer in a held section", async () => {
    const { listening } = await seedOnePerSection();
    await studentWith("listenonly_s3", [active("listening")]);
    const token = await login("listenonly_s3");
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "listening").field("type", "write-dictation").field("answer", JSON.stringify("hello world today"))
      .field("questionId", String(listening._id));
    expect(res.status).not.toBe(403);
  });
});

describe("mock tests — all four sections, or none", () => {
  it("refuses a partial plan and names the missing sections", async () => {
    await seedOnePerSection();
    await studentWith("partial_m1", [active("reading"), active("writing"), lapsed("listening")]);
    const token = await login("partial_m1");
    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MOCK_REQUIRES_FULL_ACCESS");
    expect(res.body.missingSections).toEqual(["speaking", "listening"]);
    expect(await TestSession.countDocuments({})).toBe(0);
  });

  it("lets a full plan start one, as before", async () => {
    await seedOnePerSection();
    await createUser({ username: "full_m2" });
    const token = await login("full_m2");
    const res = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(201);
  });

  it("keeps accepting answers to a mock already running when one of its sections lapses mid-paper", async () => {
    await seedOnePerSection();
    const user = await studentWith("full_m3", ["speaking", "writing", "reading", "listening"].map(s => active(s)));
    const token = await login("full_m3");
    const started = await request(app).post("/api/test-sessions").set("Authorization", `Bearer ${token}`);
    expect(started.status).toBe(201);

    // Reading runs out while the student is sitting the paper.
    const fresh = await User.findById(user._id);
    fresh.sectionAccess = fresh.sectionAccess.map(e => (e.section === "reading" ? lapsed("reading") : e));
    await fresh.save();

    const readingQ = started.body.questions.find(q => q.section === "reading");
    const res = await request(app).post("/api/submissions").set("Authorization", `Bearer ${token}`)
      .field("section", "reading").field("type", readingQ.type).field("answer", JSON.stringify(1))
      .field("questionId", readingQ._id).field("testSessionId", started.body.testSession._id);
    expect(res.status).not.toBe(403);
    expect(res.body.code).not.toBe("SECTION_EXPIRED");
  });
});

describe("study plan — only sections the student can open", () => {
  it("never recommends a locked section", async () => {
    await studentWith("listenonly_p1", [active("listening")]);
    const token = await login("listenonly_p1");
    const res = await request(app).get("/api/dashboard/study-plan").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.weakest).toBe("listening");
    expect(res.body.sectionScores.map(s => s.section)).toEqual(["listening"]);
    expect(res.body.tasks.join(" ")).not.toMatch(/mini test/);
  });
});

describe("admin — granting sections", () => {
  it("creates a paid account with only the sections chosen, and records the purchase", async () => {
    await createAdmin({ username: "admin_a1" });
    const token = await login("admin_a1");
    const res = await request(app).post("/api/admin/users").set("Authorization", `Bearer ${token}`)
      .send({ username: "newlisten_a1", name: "New", paymentStatus: "PAID", subscriptionDays: 30, sections: ["listening"] });
    expect(res.status).toBe(201);
    const byName = Object.fromEntries(res.body.user.sections.map(s => [s.section, s.status]));
    expect(byName.listening).toBe("ACTIVE");
    expect(byName.reading).toBe("NOT_PURCHASED");
    expect(res.body.user.subscriptionStatus).toBe("ACTIVE");
    const rows = await SectionPurchase.find({ user: res.body.user.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("CREATE");
  });

  it("creates a full account when no sections are sent — what an older admin screen sends", async () => {
    await createAdmin({ username: "admin_a2" });
    const token = await login("admin_a2");
    const res = await request(app).post("/api/admin/users").set("Authorization", `Bearer ${token}`)
      .send({ username: "newfull_a2", name: "New", paymentStatus: "PAID", subscriptionDays: 30 });
    expect(res.status).toBe(201);
    expect(res.body.user.sections.every(s => s.status === "ACTIVE")).toBe(true);
  });

  it("rejects an unknown section name", async () => {
    await createAdmin({ username: "admin_a3" });
    const token = await login("admin_a3");
    const res = await request(app).post("/api/admin/users").set("Authorization", `Bearer ${token}`)
      .send({ username: "bad_a3", name: "Bad", paymentStatus: "PAID", sections: ["maths"] });
    expect(res.status).toBe(400);
  });

  it("adds a section a week later on its own window, leaving the first ones alone", async () => {
    await createAdmin({ username: "admin_a4" });
    const student = await studentWith("buyer_a4", [active("speaking", 23), active("writing", 23)]);
    const before = await User.findById(student._id);
    const speakingEnd = before.sectionAccess.find(e => e.section === "speaking").endDate.getTime();
    const token = await login("admin_a4");

    const res = await request(app).post(`/api/admin/users/${student._id}/purchases`).set("Authorization", `Bearer ${token}`)
      .send({ sections: ["reading"], days: 60, paymentId: "pay_123" });
    expect(res.status).toBe(201);

    const after = await User.findById(student._id);
    const end = (s) => after.sectionAccess.find(e => e.section === s).endDate.getTime();
    expect(end("speaking")).toBe(speakingEnd); // untouched
    expect(end("reading")).toBeGreaterThan(Date.now() + 59 * DAY);
    expect(after.subscriptionEndDate.getTime()).toBe(end("reading")); // account follows the latest
    expect(res.body.purchase.paymentId).toBe("pay_123");

    const history = await request(app).get(`/api/admin/users/${student._id}/purchases`).set("Authorization", `Bearer ${token}`);
    expect(history.body.purchases).toHaveLength(1);
    expect(history.body.purchases[0].sections).toEqual(["reading"]);
  });

  it("refuses a purchase that names no sections", async () => {
    await createAdmin({ username: "admin_a5" });
    const student = await createUser({ username: "buyer_a5" });
    const token = await login("admin_a5");
    const res = await request(app).post(`/api/admin/users/${student._id}/purchases`).set("Authorization", `Bearer ${token}`).send({ days: 30 });
    expect(res.status).toBe(400);
  });

  it("renews only the sections a partial student holds", async () => {
    await createAdmin({ username: "admin_a6" });
    const student = await studentWith("listenonly_a6", [active("listening", 5)]);
    const token = await login("admin_a6");
    const res = await request(app).post(`/api/admin/users/${student._id}/renew`).set("Authorization", `Bearer ${token}`).send({ days: 30 });
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.user.sections.map(s => [s.section, s.status]));
    expect(byName.listening).toBe("ACTIVE");
    expect(byName.reading).toBe("NOT_PURCHASED");
  });

  it("extends one named section without touching the others", async () => {
    await createAdmin({ username: "admin_a7" });
    const student = await studentWith("two_a7", [active("reading", 10), active("listening", 10)]);
    const before = await User.findById(student._id);
    const readingEnd = before.sectionAccess.find(e => e.section === "reading").endDate.getTime();
    const token = await login("admin_a7");

    const res = await request(app).post(`/api/admin/subscription-extension/users/${student._id}`).set("Authorization", `Bearer ${token}`)
      .send({ days: 5, reason: "Goodwill", sections: ["listening"] });
    expect(res.status).toBe(200);
    expect(res.body.sections).toEqual(["listening"]);
    const after = await User.findById(student._id);
    expect(after.sectionAccess.find(e => e.section === "reading").endDate.getTime()).toBe(readingEnd);
  });

  it("cancels one section while the account stays active on the rest", async () => {
    await createAdmin({ username: "admin_a8" });
    const student = await studentWith("two_a8", [active("speaking"), active("reading")]);
    const token = await login("admin_a8");
    const res = await request(app).post(`/api/admin/subscription-extension/users/${student._id}/cancel`).set("Authorization", `Bearer ${token}`)
      .send({ sections: ["speaking"] });
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.user.sections.map(s => [s.section, s.status]));
    expect(byName.speaking).toBe("CANCELLED");
    expect(byName.reading).toBe("ACTIVE");
    expect(res.body.user.subscriptionStatus).toBe("ACTIVE");
  });

  it("bulk-extends every active section and keeps the account window in step", async () => {
    await createAdmin({ username: "admin_a9" });
    const student = await studentWith("two_a9", [active("speaking", 10), lapsed("reading"), active("listening", 20)]);
    const before = await User.findById(student._id);
    const end = (u, s) => u.sectionAccess.find(e => e.section === s).endDate.getTime();
    const token = await login("admin_a9");

    const res = await request(app).post("/api/admin/subscription-extension/bulk").set("Authorization", `Bearer ${token}`)
      .send({ days: 7, reason: "Outage", clientRequestId: "bulk-a9" });
    expect(res.status).toBe(200);

    const after = await User.findById(student._id);
    expect(end(after, "speaking")).toBe(end(before, "speaking") + 7 * DAY);
    expect(end(after, "listening")).toBe(end(before, "listening") + 7 * DAY);
    expect(end(after, "reading")).toBe(end(before, "reading")); // lapsed: not revived
    expect(after.subscriptionEndDate.getTime()).toBe(end(after, "listening"));
  });

  it("still edits a pre-section account's dates exactly as before", async () => {
    await createAdmin({ username: "admin_a10" });
    const student = await createUser({ username: "legacy_a10" });
    const token = await login("admin_a10");
    const newEnd = fromNow(90);
    const res = await request(app).patch(`/api/admin/users/${student._id}/subscription`).set("Authorization", `Bearer ${token}`)
      .send({ subscriptionEndDate: newEnd.toISOString() });
    expect(res.status).toBe(200);
    expect(new Date(res.body.user.subscriptionEndDate).getTime()).toBe(newEnd.getTime());
    expect(res.body.user.sections.every(s => s.status === "ACTIVE")).toBe(true);
  });
});

describe("migrateSectionAccess", () => {
  it("writes down exactly the access each account already had, and nothing about its dates", async () => {
    const paid = await createUser({ username: "mig_paid" });
    const pending = await createUser({ username: "mig_pending", paymentStatus: "PENDING", subscriptionStartDate: null, subscriptionEndDate: null });
    const admin = await createAdmin({ username: "mig_admin" });
    const statusBefore = getSubscriptionStatus(paid);

    const dry = await migrateSectionAccess({ log: () => {} });
    expect(dry.written).toBe(0);
    expect((await User.findById(paid._id)).sectionAccess).toBeUndefined();

    const run = await migrateSectionAccess({ write: true, log: () => {} });
    expect(run.withSections).toBeGreaterThanOrEqual(1);

    const paidAfter = await User.findById(paid._id);
    expect(paidAfter.sectionAccess.map(e => e.section)).toEqual(["speaking", "writing", "reading", "listening"]);
    expect(paidAfter.sectionAccess.every(e => e.endDate.getTime() === paid.subscriptionEndDate.getTime())).toBe(true);
    expect(paidAfter.subscriptionEndDate.getTime()).toBe(paid.subscriptionEndDate.getTime());
    expect(getSubscriptionStatus(paidAfter)).toBe(statusBefore);

    expect((await User.findById(pending._id)).sectionAccess).toEqual([]);
    expect((await User.findById(admin._id)).sectionAccess).toBeUndefined();

    const again = await migrateSectionAccess({ write: true, log: () => {} });
    expect(again.pending).toBe(0); // safe to re-run
  });
});

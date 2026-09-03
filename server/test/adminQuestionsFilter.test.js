import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { createAdmin, createQuestion } from "./helpers.js";

async function login(username, password = "password123") {
  const res = await request(app).post("/api/auth/signin").send({ username, password });
  return res.body.token;
}

describe("admin question search & filters", () => {
  it("supports search, section/type/difficulty/status filters, none of which are decorative", async () => {
    await createAdmin({ username: "filteradmin1", password: "password123" });
    const token = await login("filteradmin1");

    await createQuestion({ section: "reading", type: "mcq-single", title: "Renewable energy passage", options: ["A", "B"], answer: 0, difficulty: "easy", active: true });
    await createQuestion({ section: "reading", type: "reorder", title: "Paragraph order task", options: ["A", "B", "C"], answer: [0, 1, 2], difficulty: "medium", active: true });
    await createQuestion({ section: "listening", type: "mcq-single", title: "Audio comprehension check", options: ["A", "B"], answer: 1, difficulty: "hard", active: false, evaluationType: "objective" });

    const bySearch = await request(app).get("/api/admin/questions?search=Renewable").set("Authorization", `Bearer ${token}`);
    expect(bySearch.body.data.some(q => q.title === "Renewable energy passage")).toBe(true);
    expect(bySearch.body.total).toBe(1);

    const bySection = await request(app).get("/api/admin/questions?section=listening").set("Authorization", `Bearer ${token}`);
    expect(bySection.body.data.every(q => q.section === "listening")).toBe(true);
    expect(bySection.body.total).toBe(1);

    const byType = await request(app).get("/api/admin/questions?type=reorder").set("Authorization", `Bearer ${token}`);
    expect(byType.body.data.every(q => q.type === "reorder")).toBe(true);

    const byDifficulty = await request(app).get("/api/admin/questions?difficulty=hard").set("Authorization", `Bearer ${token}`);
    expect(byDifficulty.body.data.every(q => q.difficulty === "hard")).toBe(true);

    const byStatus = await request(app).get("/api/admin/questions?status=inactive").set("Authorization", `Bearer ${token}`);
    expect(byStatus.body.data.every(q => q.active === false)).toBe(true);
    expect(byStatus.body.total).toBe(1);
  });

  it("paginates results and enforces a maximum page size", async () => {
    await createAdmin({ username: "filteradmin2", password: "password123" });
    const token = await login("filteradmin2");

    for (let i = 0; i < 5; i++) {
      await createQuestion({ section: "reading", type: "mcq-single", title: `Q${i}`, options: ["A", "B"], answer: 0 });
    }

    const page1 = await request(app).get("/api/admin/questions?page=1&limit=2").set("Authorization", `Bearer ${token}`);
    expect(page1.body.data.length).toBe(2);
    expect(page1.body.total).toBe(5);
    expect(page1.body.totalPages).toBe(3);

    const page2 = await request(app).get("/api/admin/questions?page=2&limit=2").set("Authorization", `Bearer ${token}`);
    expect(page2.body.data.length).toBe(2);
    expect(page2.body.data[0]._id).not.toBe(page1.body.data[0]._id);

    // Requesting an absurd limit must be clamped, never honored as-is.
    const hugeLimit = await request(app).get("/api/admin/questions?limit=100000").set("Authorization", `Bearer ${token}`);
    expect(hugeLimit.body.limit).toBeLessThanOrEqual(100);
    expect(hugeLimit.body.data.length).toBeLessThanOrEqual(100);
  });
});
